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

fn to_fbig(d: DBig, prec: usize) -> FBig {
    // Correct way: d.to_binary().value().with_precision(prec).value()
    d.to_binary().value().with_precision(prec).value()
}

fn is_aborted(abort_flag: &Option<js_sys::Int32Array>) -> bool {
    if let Some(flag) = abort_flag {
        if flag.get_index(0) != 0 {
            return true;
        }
    }
    false
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
    let required_len = (max_iter as usize + 1) * 2;
    let mut orbit = vec![0.0; required_len];

    // Constant 4.0 and 2.0
    let f4: FBig = FBig::from(4).with_precision(prec).value();

    for iter_idx in 0..=max_iter {
        if iter_idx % 1000 == 0 && is_aborted(&abort_flag) {
            break;
        }

        // Output f64: use to_f64() -> value()
        let zx_f64 = zx.to_f64().value();
        let zy_f64 = zy.to_f64().value();

        let idx = (iter_idx as usize) * 2;
        orbit[idx] = zx_f64 as f32;
        orbit[idx + 1] = zy_f64 as f32;

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
    let d_d = Rational::try_from(delta)
        .map(DBig::from)
        .unwrap_or(DBig::ZERO);

    let res = r_d + d_d;
    res.to_string()
}

#[wasm_bindgen]
pub fn sub_coord(val1: String, val2: String) -> f64 {
    let v1 = DBig::from_str(&val1).unwrap_or(DBig::ZERO);
    let v2 = DBig::from_str(&val2).unwrap_or(DBig::ZERO);
    let diff = v1 - v2;
    diff.to_f64().value()
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
    let center_x = DBig::from_str(&cx_str).unwrap_or(DBig::ZERO);
    let center_y = DBig::from_str(&cy_str).unwrap_or(DBig::ZERO);

    // Scale is the vertical span (approx).
    // Multiply x-step by aspect to cover wide screen
    // Dense Grid: Step 0.22 allows 5 points (-2 to 2) to cover approx -0.44 to 0.44 (90% view)
    let step_y = Rational::try_from(scale * 0.22)
        .map(DBig::from)
        .unwrap_or(DBig::ZERO);
    let step_x = Rational::try_from(scale * 0.22 * aspect)
        .map(DBig::from)
        .unwrap_or(DBig::ZERO);

    let f4: FBig = FBig::from(4).with_precision(prec).value();

    let mut best_iter = 0;
    let mut best_cx = center_x.clone();
    let mut best_cy = center_y.clone();

    // 5x5 Grid Search: Center-out spiral order for maximum stability
    let offsets: [(i32, i32); 25] = [
        (0, 0),
        (-1, 0),
        (1, 0),
        (0, -1),
        (0, 1),
        (-1, -1),
        (1, -1),
        (-1, 1),
        (1, 1),
        (-2, 0),
        (2, 0),
        (0, -2),
        (0, 2),
        (-2, -1),
        (-2, 1),
        (2, -1),
        (2, 1),
        (-1, -2),
        (1, -2),
        (-1, 2),
        (1, 2),
        (-2, -2),
        (2, -2),
        (-2, 2),
        (2, 2),
    ];

    for &(ox_i, oy_i) in offsets.iter() {
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

        let mut i = 0;
        while i < max_iter {
            if i % 1000 == 0 && is_aborted(&abort_flag) {
                break;
            }

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
            i += 1;
        }

        if i > best_iter {
            best_iter = i;
            best_cx = cx_probe;
            best_cy = cy_probe;

            if i >= max_iter {
                break;
            }
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
    fn test_add_coord() {
        let val = String::from("1.5");
        let delta = 0.5;
        let result = add_coord(val, delta);
        assert_eq!(result, "2");
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
        // max_iter = 2 -> required_len = (2 + 1) * 2 = 6
        assert_eq!(result, vec![0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    }

    #[wasm_bindgen_test]
    fn test_calculate_reference_diverge() {
        let result = calculate_reference("3.0".to_string(), "0.0".to_string(), 2, 53, None);
        // Iter 0: z=0,0 -> pushed 0,0. New z = 3,0
        // Iter 1: z=3,0 -> pushed 3,0. (3^2 + 0^2 > 4) -> breaks
        // Required len is 6, so pads with 0,0 until len 6
        assert_eq!(result, vec![0.0, 0.0, 3.0, 0.0, 0.0, 0.0]);
    }

    #[wasm_bindgen_test]
    fn test_calculate_reference_oscillate() {
        let result = calculate_reference("-1.0".to_string(), "0.0".to_string(), 3, 53, None);
        // c = (-1, 0)
        // Iter 0: z = (0, 0) -> pushed 0, 0. z_new = z^2+c = (-1, 0)
        // Iter 1: z = (-1, 0) -> pushed -1, 0. z_new = (-1)^2+c = (1,0) + (-1,0) = (0, 0)
        // Iter 2: z = (0, 0) -> pushed 0, 0. z_new = (0)^2+c = (-1, 0)
        // Iter 3: z = (-1, 0) -> pushed -1, 0. z_new = (-1)^2+c = (0, 0)
        // max_iter = 3 -> required_len = 8
        assert_eq!(result, vec![0.0, 0.0, -1.0, 0.0, 0.0, 0.0, -1.0, 0.0]);
    }

    #[wasm_bindgen_test]
    fn test_calculate_reference_invalid_input() {
        // We pass "invalid" so it defaults to 0.0 but we must pass precision > 0
        let result = calculate_reference("invalid".to_string(), "invalid".to_string(), 2, 53, None);
        // Should fall back to 0.0
        assert_eq!(result, vec![0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
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
