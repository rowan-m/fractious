use dashu::float::{DBig, FBig};
use dashu::Rational;
use std::convert::TryFrom;
use std::str::FromStr;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn init_hooks() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen]
pub struct Anchor {
    #[wasm_bindgen(getter_with_clone)]
    pub x: String,
    #[wasm_bindgen(getter_with_clone)]
    pub y: String,
    pub iter: u32,
}

fn bits_to_decimal_digits(bits: usize) -> usize {
    ((bits as f64 * std::f64::consts::LOG10_2).ceil() as usize).max(20)
}

fn to_fbig(d: DBig, prec: usize) -> FBig {
    let dec_prec = bits_to_decimal_digits(prec);
    let d_prec = d.with_precision(dec_prec).value();
    d_prec.to_binary().value().with_precision(prec).value()
}

fn is_aborted(abort_flag: &Option<js_sys::Int32Array>) -> bool {
    if let Some(flag) = abort_flag {
        if flag.get_index(0) != 0 {
            return true;
        }
    }
    false
}

fn split_fbig_to_4_f32(val: &FBig, prec: usize) -> (f32, f32, f32, f32) {
    let part0 = val.to_f32().value();
    let r1 = (val - FBig::try_from(part0).unwrap())
        .with_precision(prec)
        .value();
    let part1 = r1.to_f32().value();
    let r2 = (&r1 - &FBig::try_from(part1).unwrap())
        .with_precision(prec)
        .value();
    let part2 = r2.to_f32().value();
    let r3 = (&r2 - &FBig::try_from(part2).unwrap())
        .with_precision(prec)
        .value();
    let part3 = r3.to_f32().value();
    (part0, part1, part2, part3)
}

#[wasm_bindgen]
pub fn calculate_reference(
    c_re_str: String,
    c_im_str: String,
    max_iter: u32,
    prec: u32,
    abort_flag: Option<js_sys::Int32Array>,
) -> Vec<f32> {
    let prec = prec as usize;

    // Parse decimal strings directly to DBig
    let cx_d =
        DBig::from_str(&c_re_str).unwrap_or_else(|_| DBig::ZERO.with_precision(prec).value());
    let cy_d =
        DBig::from_str(&c_im_str).unwrap_or_else(|_| DBig::ZERO.with_precision(prec).value());

    let cx = to_fbig(cx_d, prec);
    let cy = to_fbig(cy_d, prec);

    // Initialize Z (zero)
    let mut zx = FBig::ZERO.with_precision(prec).value();
    let mut zy = FBig::ZERO.with_precision(prec).value();

    // ⚡ Bolt: Pre-allocate with resize to avoid repeated bounds checking and
    // potential reallocation overhead from push() inside the hot loop.
    let required_len = (max_iter as usize + 1) * 8;
    let mut orbit = vec![0.0; required_len];

    // Constant 4.0 and 2.0
    let f4: FBig = FBig::from(4).with_precision(prec).value();

    for iter_idx in 0..=max_iter {
        if iter_idx % 1000 == 0 && is_aborted(&abort_flag) {
            break;
        }

        let (zx0, zx1, zx2, zx3) = split_fbig_to_4_f32(&zx, prec);
        let (zy0, zy1, zy2, zy3) = split_fbig_to_4_f32(&zy, prec);

        let idx = (iter_idx as usize) * 8;
        orbit[idx] = zx0;
        orbit[idx + 1] = zx1;
        orbit[idx + 2] = zx2;
        orbit[idx + 3] = zx3;
        orbit[idx + 4] = zy0;
        orbit[idx + 5] = zy1;
        orbit[idx + 6] = zy2;
        orbit[idx + 7] = zy3;

        let zx2 = (&zx * &zx).with_precision(prec).value();
        let zy2 = (&zy * &zy).with_precision(prec).value();

        // Sum calculation to avoid Approximation allocation (compare to f4 directly)
        let sum2 = (&zx2 + &zy2).with_precision(prec).value();
        if sum2 > f4 {
            break;
        }

        let mut new_zy = zx;
        new_zy *= &zy;
        new_zy <<= 1;
        new_zy += &cy;
        zy = new_zy.with_precision(prec).value();

        let mut new_zx = zx2;
        new_zx -= &zy2;
        new_zx += &cx;
        zx = new_zx.with_precision(prec).value();
    }

    // No need to pad since we initialized with vec![0.0; required_len]

    orbit
}

#[wasm_bindgen]
pub fn add_coord(val: String, delta: f64) -> String {
    let r_d = DBig::from_str(&val).unwrap_or(DBig::ZERO);
    if delta == 0.0 || !delta.is_finite() {
        return r_d.to_string();
    }

    let d_d = Rational::try_from(delta)
        .map(|r| DBig::from(r).with_precision(15).value())
        .unwrap_or(DBig::ZERO);
    let delta_decimals = (-d_d.repr().exponent()).max(16) as usize;
    let target_prec = r_d.precision().max(delta_decimals);

    let res = (r_d.with_precision(target_prec).value() + d_d.with_precision(target_prec).value())
        .with_precision(target_prec)
        .value();
    res.to_string()
}

#[wasm_bindgen]
pub fn sub_coord(val1: String, val2: String) -> f64 {
    let v1 = DBig::from_str(&val1).unwrap_or(DBig::ZERO);
    let v2 = DBig::from_str(&val2).unwrap_or(DBig::ZERO);
    let diff = v1 - v2;
    diff.to_f64().value()
}

fn probe_perturbation_f64(ref_orbit: &[(f64, f64)], dcx: f64, dcy: f64, max_iter: u32) -> u32 {
    let ref_len = ref_orbit.len();
    if ref_len <= 1 {
        return 0;
    }
    let ref_max_m = ref_len - 1;
    let mut dx = 0.0_f64;
    let mut dy = 0.0_f64;
    let mut m = 0_usize;

    for i in 0..max_iter {
        let (xm_r, xm_i) = ref_orbit[m];
        // delta_{n+1} = 2 * X_m * delta_n + delta_n^2 + dc
        let two_x_d_r = 2.0 * (xm_r * dx - xm_i * dy);
        let two_x_d_i = 2.0 * (xm_r * dy + xm_i * dx);
        let d2_r = dx * dx - dy * dy;
        let d2_i = 2.0 * dx * dy;

        dx = two_x_d_r + d2_r + dcx;
        dy = two_x_d_i + d2_i + dcy;

        let next_m = m + 1;
        let (xnext_r, xnext_i) = ref_orbit[next_m];
        let zx = xnext_r + dx;
        let zy = xnext_i + dy;
        let zn_sq = zx * zx + zy * zy;

        if zn_sq > 4.0 {
            return i + 1;
        }

        let d_sq = dx * dx + dy * dy;
        if zn_sq < d_sq || next_m >= ref_max_m {
            dx = zx;
            dy = zy;
            m = 0;
        } else {
            m = next_m;
        }
    }

    max_iter
}

fn find_best_perturbation_offset(
    ref_orbit: &[(f64, f64)],
    ref_ox: f64,
    ref_oy: f64,
    scale: f64,
    aspect: f64,
    max_iter: u32,
) -> (f64, f64) {
    let mut best_ox = ref_ox;
    let mut best_oy = ref_oy;
    let mut best_iter = 0;
    let mut best_dist_sq = f64::MAX;

    // Stage 1: Coarse 11x11 survey across [-0.45, 0.45] of viewport
    let coarse_step_y = scale * 0.09;
    let coarse_step_x = scale * 0.09 * aspect;

    for gy in -5..=5 {
        for gx in -5..=5 {
            let ox = (gx as f64) * coarse_step_x;
            let oy = (gy as f64) * coarse_step_y;
            let dcx = ox - ref_ox;
            let dcy = oy - ref_oy;
            let iter = probe_perturbation_f64(ref_orbit, dcx, dcy, max_iter);
            let dist_sq = ox * ox + oy * oy;

            if iter > best_iter || (iter == best_iter && dist_sq < best_dist_sq) {
                best_iter = iter;
                best_ox = ox;
                best_oy = oy;
                best_dist_sq = dist_sq;
            }
        }
    }

    // Stage 2 & 3: Local hill-climbing refinement (5x5 neighborhood around current best)
    let mut step_x = coarse_step_x * 0.25;
    let mut step_y = coarse_step_y * 0.25;

    for _ in 0..2 {
        if best_iter >= max_iter {
            break;
        }
        let center_ox = best_ox;
        let center_oy = best_oy;

        for ly in -2..=2 {
            for lx in -2..=2 {
                if lx == 0 && ly == 0 {
                    continue;
                }
                let ox = center_ox + (lx as f64) * step_x;
                let oy = center_oy + (ly as f64) * step_y;
                let dcx = ox - ref_ox;
                let dcy = oy - ref_oy;
                let iter = probe_perturbation_f64(ref_orbit, dcx, dcy, max_iter);
                let dist_sq = ox * ox + oy * oy;

                if iter > best_iter || (iter == best_iter && dist_sq < best_dist_sq) {
                    best_iter = iter;
                    best_ox = ox;
                    best_oy = oy;
                    best_dist_sq = dist_sq;
                }
            }
        }

        step_x *= 0.25;
        step_y *= 0.25;
    }

    (best_ox, best_oy)
}

// Return tuple [x_str, y_str]
#[wasm_bindgen]
pub fn find_best_anchor(
    cx_str: String,
    cy_str: String,
    scale: f64,
    aspect: f64,
    max_iter: u32,
    prec: u32,
    abort_flag: Option<js_sys::Int32Array>,
) -> Anchor {
    let prec = prec as usize;
    let dec_prec = bits_to_decimal_digits(prec);
    let center_x = DBig::from_str(&cx_str)
        .unwrap_or(DBig::ZERO)
        .with_precision(dec_prec)
        .value();
    let center_y = DBig::from_str(&cy_str)
        .unwrap_or(DBig::ZERO)
        .with_precision(dec_prec)
        .value();

    // Scale is the vertical span (approx).
    // Multiply x-step by aspect to cover wide screen
    let step_y_f64 = scale * 0.22;
    let step_x_f64 = scale * 0.22 * aspect;
    let step_y = Rational::try_from(step_y_f64)
        .map(|r| DBig::from(r).with_precision(dec_prec).value())
        .unwrap_or(DBig::ZERO);
    let step_x = Rational::try_from(step_x_f64)
        .map(|r| DBig::from(r).with_precision(dec_prec).value())
        .unwrap_or(DBig::ZERO);

    let f4: FBig = FBig::from(4).with_precision(prec).value();

    let mut best_iter = 0;
    let mut best_cx = center_x.clone();
    let mut best_cy = center_y.clone();
    let mut best_ref_ox = 0.0_f64;
    let mut best_ref_oy = 0.0_f64;
    let mut best_ref_orbit: Vec<(f64, f64)> = Vec::new();

    // Phase 1: Inner 3x3 center-out spiral in arbitrary precision
    let inner_offsets: [(i32, i32); 9] = [
        (0, 0),
        (-1, 0),
        (1, 0),
        (0, -1),
        (0, 1),
        (-1, -1),
        (1, -1),
        (-1, 1),
        (1, 1),
    ];

    for &(ox_i, oy_i) in inner_offsets.iter() {
        if is_aborted(&abort_flag) {
            break;
        }

        let dx_val = DBig::from(ox_i);
        let dy_val = DBig::from(oy_i);

        let cx_probe = &center_x + (&step_x * dx_val);
        let cy_probe = &center_y + (&step_y * dy_val);

        let cx = to_fbig(cx_probe.clone(), prec);
        let cy = to_fbig(cy_probe.clone(), prec);

        let mut zx = FBig::ZERO.with_precision(prec).value();
        let mut zy = FBig::ZERO.with_precision(prec).value();
        let mut current_orbit: Vec<(f64, f64)> = Vec::with_capacity((max_iter as usize) + 1);

        let mut i = 0;
        while i < max_iter {
            if i % 1000 == 0 && is_aborted(&abort_flag) {
                break;
            }

            current_orbit.push((zx.to_f64().value(), zy.to_f64().value()));

            let zx2 = (&zx * &zx).with_precision(prec).value();
            let zy2 = (&zy * &zy).with_precision(prec).value();

            let sum2 = (&zx2 + &zy2).with_precision(prec).value();
            if sum2 > f4 {
                break;
            }

            let mut new_zy = zx;
            new_zy *= &zy;
            new_zy <<= 1;
            new_zy += &cy;
            zy = new_zy.with_precision(prec).value();

            let mut new_zx = zx2;
            new_zx -= &zy2;
            new_zx += &cx;
            zx = new_zx.with_precision(prec).value();
            i += 1;
        }

        if i == max_iter {
            current_orbit.push((zx.to_f64().value(), zy.to_f64().value()));
        }

        if i > best_iter {
            best_iter = i;
            best_cx = cx_probe;
            best_cy = cy_probe;
            best_ref_ox = (ox_i as f64) * step_x_f64;
            best_ref_oy = (oy_i as f64) * step_y_f64;
            best_ref_orbit = current_orbit;

            if i >= max_iter {
                break;
            }
        }
    }

    // Phase 2: If no inner spiral point reached max_iter, run a fast f64 perturbation
    // coarse-to-fine search (11x11 survey + 2-stage local hill-climbing) using the best
    // reference orbit found so far, then verify the winning hotspot in arbitrary precision.
    if best_iter < max_iter && !is_aborted(&abort_flag) && best_ref_orbit.len() > 1 {
        let (win_ox, win_oy) = find_best_perturbation_offset(
            &best_ref_orbit,
            best_ref_ox,
            best_ref_oy,
            scale,
            aspect,
            max_iter,
        );

        let dx_dbig = Rational::try_from(win_ox)
            .map(|r| DBig::from(r).with_precision(dec_prec).value())
            .unwrap_or(DBig::ZERO);
        let dy_dbig = Rational::try_from(win_oy)
            .map(|r| DBig::from(r).with_precision(dec_prec).value())
            .unwrap_or(DBig::ZERO);

        let cx_probe = &center_x + dx_dbig;
        let cy_probe = &center_y + dy_dbig;

        let cx = to_fbig(cx_probe.clone(), prec);
        let cy = to_fbig(cy_probe.clone(), prec);

        let mut zx = FBig::ZERO.with_precision(prec).value();
        let mut zy = FBig::ZERO.with_precision(prec).value();

        let mut i = 0;
        while i < max_iter {
            if i % 1000 == 0 && is_aborted(&abort_flag) {
                break;
            }

            let zx2 = (&zx * &zx).with_precision(prec).value();
            let zy2 = (&zy * &zy).with_precision(prec).value();

            let sum2 = (&zx2 + &zy2).with_precision(prec).value();
            if sum2 > f4 {
                break;
            }

            let mut new_zy = zx;
            new_zy *= &zy;
            new_zy <<= 1;
            new_zy += &cy;
            zy = new_zy.with_precision(prec).value();

            let mut new_zx = zx2;
            new_zx -= &zy2;
            new_zx += &cx;
            zx = new_zx.with_precision(prec).value();
            i += 1;
        }

        if i > best_iter {
            best_iter = i;
            best_cx = cx_probe;
            best_cy = cy_probe;
        }
    }

    Anchor {
        x: best_cx.to_string(),
        y: best_cy.to_string(),
        iter: best_iter,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    #[wasm_bindgen_test]
    fn test_split_fbig() {
        let d = DBig::from_str("-0.743643887037158704752191506114774").unwrap();
        let f = d.to_binary().value().with_precision(256).value();
        let (p0, p1, p2, p3) = split_fbig_to_4_f32(&f, 256);
        let reconstructed = (p0 as f64) + (p1 as f64) + (p2 as f64) + (p3 as f64);
        let diff = (reconstructed - -0.7436438870371587_f64).abs();
        assert!(diff < 1e-15);
    }

    #[wasm_bindgen_test]
    fn test_add_coord() {
        let val = String::from("1.5");
        let delta = 0.5;
        let result = add_coord(val, delta);
        assert_eq!(result, "2");
    }

    #[wasm_bindgen_test]
    fn test_add_coord_no_binary_noise() {
        let val = String::from("-1.7");
        let delta = 0.1;
        let result = add_coord(val, delta);
        assert_eq!(result, "-1.6");
    }

    #[wasm_bindgen_test]
    fn test_add_coord_precision() {
        let val = String::from("-0.743643887037158704752191506114774");
        let delta = 1e-22;
        let result = add_coord(val.clone(), delta);
        // If it lost precision, result would be equal to val
        assert_ne!(result, val);
        assert!(
            result.contains("1000000") || result.contains("99999") || result.contains("209150")
        );
    }

    #[wasm_bindgen_test]
    fn test_sub_coord() {
        let val1 = String::from("2.5");
        let val2 = String::from("1.0");
        let result = sub_coord(val1, val2);
        assert_eq!(result, 1.5);
    }

    #[wasm_bindgen_test]
    fn test_calculate_reference_origin() {
        let result = calculate_reference("0.0".to_string(), "0.0".to_string(), 2, 53, None);
        // max_iter = 2 -> required_len = (2 + 1) * 8 = 24
        assert_eq!(result, vec![0.0; 24]);
    }

    #[wasm_bindgen_test]
    fn test_calculate_reference_diverge() {
        let result = calculate_reference("3.0".to_string(), "0.0".to_string(), 2, 53, None);
        // Iter 0: z=0,0 -> pushed 0,0. New z = 3,0
        // Iter 1: z=3,0 -> pushed 3,0. (3^2 + 0^2 > 4) -> breaks
        // Required len is 24, so pads with 0,0 until len 24
        // zx0=3, zy=0
        let mut expected = vec![0.0; 24];
        expected[8] = 3.0; // zx0 at iter 1
        assert_eq!(result, expected);
    }

    #[wasm_bindgen_test]
    fn test_calculate_reference_oscillate() {
        let result = calculate_reference("-1.0".to_string(), "0.0".to_string(), 3, 53, None);
        // c = (-1, 0)
        // Iter 0: z = (0, 0) -> pushed 0, 0. z_new = z^2+c = (-1, 0)
        // Iter 1: z = (-1, 0) -> pushed -1, 0. z_new = (-1)^2+c = (1,0) + (-1,0) = (0, 0)
        // Iter 2: z = (0, 0) -> pushed 0, 0. z_new = (0)^2+c = (-1, 0)
        // Iter 3: z = (-1, 0) -> pushed -1, 0. z_new = (-1)^2+c = (0, 0)
        // max_iter = 3 -> required_len = 32
        // Vec structure for each iteration: [zx0..zx3, zy0..zy3]
        let mut expected = vec![0.0; 32];
        expected[8] = -1.0; // Iter 1: z=(-1, 0) -> zx0 = -1.0
        expected[24] = -1.0; // Iter 3: z=(-1, 0) -> zx0 = -1.0
        assert_eq!(result, expected);
    }

    #[wasm_bindgen_test]
    fn test_calculate_reference_invalid_input() {
        // We pass "invalid" so it defaults to 0.0 but we must pass precision > 0
        let result = calculate_reference("invalid".to_string(), "invalid".to_string(), 2, 53, None);
        // Should fall back to 0.0, which spans (2 + 1) * 8 = 24 elements
        assert_eq!(result, vec![0.0; 24]);
    }

    #[wasm_bindgen_test]
    fn test_find_best_anchor_center() {
        let cx = String::from("0");
        let cy = String::from("0");
        let scale = 1.0;
        let aspect = 1.0;
        let max_iter = 100;
        let prec = 53;
        let result = find_best_anchor(cx, cy, scale, aspect, max_iter, prec, None);
        assert_eq!(result.iter, 100);
        assert_eq!(result.x, "0");
        assert_eq!(result.y, "0");
    }

    #[wasm_bindgen_test]
    fn test_find_best_anchor_off_center() {
        // Center is out of bounds, but large step ensures an offset points to the origin
        let cx = String::from("2.2");
        let cy = String::from("0");
        let scale = 10.0;
        let aspect = 1.0;
        let max_iter = 100;
        let prec = 53;

        let result = find_best_anchor(cx, cy, scale, aspect, max_iter, prec, None);
        // The algorithm stops when it finds any offset that reaches max_iter
        assert_eq!(result.iter, 100);
        // Step size is scale * 0.22 = 10.0 * 0.22 = 2.2
        // Since center is at 2.2, offset (-1, 0) gives x = 2.2 - 2.2 = 0
        assert_eq!(result.x, "0");
        assert_eq!(result.y, "0");
    }
}
