use dashu::base::Abs;
use dashu::float::{DBig, FBig};
use dashu::Rational;
use std::convert::TryFrom;
use std::str::FromStr;
use wasm_bindgen::prelude::*;

/// Hard cap on reference orbit length (GPU buffer is 32 bytes per point).
const MAX_REFERENCE_ITER: u64 = 2_500_000;

#[wasm_bindgen]
pub fn init_hooks() {
    console_error_panic_hook::set_once();
}

fn bits_to_decimal_digits(bits: usize) -> usize {
    ((bits as f64 * std::f64::consts::LOG10_2).ceil() as usize).max(20)
}

fn f64_to_dbig(val: f64, dec_prec: usize) -> DBig {
    Rational::try_from(val)
        .map(|r| DBig::from(r).with_precision(dec_prec).value())
        .unwrap_or(DBig::ZERO)
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

fn split_f64_to_2_f32(val: f64) -> (f32, f32) {
    let hi = val as f32;
    let lo = (val - f64::from(hi)) as f32;
    (hi, lo)
}

fn split_f64_to_4_f32(val: f64) -> (f32, f32, f32, f32) {
    let part0 = val as f32;
    let r1 = val - f64::from(part0);
    let part1 = r1 as f32;
    let r2 = r1 - f64::from(part1);
    let part2 = r2 as f32;
    let part3 = (r2 - f64::from(part2)) as f32;
    (part0, part1, part2, part3)
}

/// Fixed inputs for iterating z -> z^2 + c at a given binary precision.
struct IterCtx<'a> {
    cx: FBig,
    cy: FBig,
    prec: usize,
    abort: &'a Option<js_sys::Int32Array>,
}

impl<'a> IterCtx<'a> {
    fn new(cx: &DBig, cy: &DBig, prec: usize, abort: &'a Option<js_sys::Int32Array>) -> Self {
        Self {
            cx: to_fbig(cx.clone(), prec),
            cy: to_fbig(cy.clone(), prec),
            prec,
            abort,
        }
    }
}

/// Brent cycle detection, so periodic (interior) orbits stop early during the anchor search.
struct CycleDetector {
    tx: FBig,
    ty: FBig,
    tx64: f64,
    ty64: f64,
    power: u32,
    lam: u32,
    tol: FBig,
}

impl CycleDetector {
    fn new(prec: usize) -> Self {
        let zero = FBig::ZERO.with_precision(prec).value();
        Self {
            tx: zero.clone(),
            ty: zero,
            tx64: 0.0,
            ty64: 0.0,
            power: 1,
            lam: 0,
            tol: FBig::ONE.with_precision(prec).value() >> (prec.saturating_sub(8) as isize),
        }
    }

    /// Returns true when z_n repeats an earlier orbit point within tolerance.
    fn repeats(&mut self, zx: &FBig, zy: &FBig, z64: (f64, f64), n: u32, prec: usize) -> bool {
        if n > 0 && (z64.0 - self.tx64).abs() < 1e-14 && (z64.1 - self.ty64).abs() < 1e-14 {
            let dx = (zx - &self.tx).with_precision(prec).value().abs();
            let dy = (zy - &self.ty).with_precision(prec).value().abs();
            if dx <= self.tol && dy <= self.tol {
                return true;
            }
        }
        if self.lam == self.power {
            self.tx = zx.clone();
            self.ty = zy.clone();
            self.tx64 = z64.0;
            self.ty64 = z64.1;
            self.power <<= 1;
            self.lam = 0;
        }
        self.lam += 1;
        false
    }
}

/// A Mandelbrot orbit z_0 = 0, z_{n+1} = z_n^2 + c in arbitrary precision. It can be
/// advanced in stages, optionally recording each point as quad-f32 (the GPU reference
/// layout: 8 floats per point) and/or f64 (for the perturbation probes).
struct Orbit {
    zx: FBig,
    zy: FBig,
    /// Index of the current point z_n, which has not been recorded yet.
    n: u32,
    escaped: bool,
    qs: Option<Vec<f32>>,
    f64s: Option<Vec<(f64, f64)>>,
}

impl Orbit {
    fn new(prec: usize, record_qs: bool, record_f64: bool) -> Self {
        let zero = FBig::ZERO.with_precision(prec).value();
        Self {
            zx: zero.clone(),
            zy: zero,
            n: 0,
            escaped: false,
            qs: record_qs.then(Vec::new),
            f64s: record_f64.then(Vec::new),
        }
    }

    /// Records and iterates points up to and including z_limit, stopping early on escape
    /// (the escape point is recorded) or when a cycle is detected (the repeating point is
    /// not recorded, so a later `advance` resumes exactly where this one stopped).
    /// Returns false if aborted.
    fn advance(
        &mut self,
        ctx: &IterCtx,
        limit: u32,
        mut cycles: Option<&mut CycleDetector>,
    ) -> bool {
        let prec = ctx.prec;
        if let Some(qs) = self.qs.as_mut() {
            qs.reserve((limit.saturating_sub(self.n) as usize + 1) * 8);
        }

        while !self.escaped && self.n <= limit {
            if self.n.is_multiple_of(1000) && is_aborted(ctx.abort) {
                return false;
            }

            let z64 = (self.zx.to_f64().value(), self.zy.to_f64().value());
            if let Some(detector) = cycles.as_deref_mut() {
                if detector.repeats(&self.zx, &self.zy, z64, self.n, prec) {
                    return true;
                }
            }
            if let Some(qs) = self.qs.as_mut() {
                let (x0, x1, x2, x3) = split_f64_to_4_f32(z64.0);
                let (y0, y1, y2, y3) = split_f64_to_4_f32(z64.1);
                qs.extend_from_slice(&[x0, x1, x2, x3, y0, y1, y2, y3]);
            }
            if let Some(f64s) = self.f64s.as_mut() {
                f64s.push(z64);
            }

            if z64.0 * z64.0 + z64.1 * z64.1 > 4.0 {
                self.escaped = true;
                break;
            }

            let zx2 = (&self.zx * &self.zx).with_precision(prec).value();
            let zy2 = (&self.zy * &self.zy).with_precision(prec).value();

            let mut new_zy = std::mem::replace(&mut self.zx, FBig::ZERO);
            new_zy *= &self.zy;
            new_zy <<= 1;
            new_zy += &ctx.cy;
            self.zy = new_zy.with_precision(prec).value();

            let mut new_zx = zx2;
            new_zx -= &zy2;
            new_zx += &ctx.cx;
            self.zx = new_zx.with_precision(prec).value();
            self.n += 1;
        }
        true
    }

    /// Search score: the escape iteration, or `limit` for orbits that stayed bounded
    /// (reached the limit or were found to be periodic).
    fn score(&self, limit: u32) -> u32 {
        if self.escaped {
            self.n
        } else {
            limit
        }
    }
}

#[wasm_bindgen]
pub fn add_coord(val: String, delta: f64) -> String {
    let r_d = DBig::from_str(&val).unwrap_or(DBig::ZERO);
    if delta == 0.0 || !delta.is_finite() {
        return r_d.to_string();
    }

    let d_d = f64_to_dbig(delta, 15);
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

/// Result of the anchor search.
struct AnchorSearch {
    x: DBig,
    y: DBig,
    ox: f64,
    oy: f64,
    score: u32,
    /// The anchor's orbit with quad-f32 points already recorded, when the winning
    /// candidate was one that recorded them (the view centre or the refined hotspot).
    orbit: Option<Orbit>,
}

fn search_anchor(
    cx_str: &str,
    cy_str: &str,
    scale: f64,
    aspect: f64,
    limit: u32,
    prec: usize,
    abort_flag: &Option<js_sys::Int32Array>,
) -> AnchorSearch {
    let dec_prec = bits_to_decimal_digits(prec);
    let center_x = DBig::from_str(cx_str)
        .unwrap_or(DBig::ZERO)
        .with_precision(dec_prec)
        .value();
    let center_y = DBig::from_str(cy_str)
        .unwrap_or(DBig::ZERO)
        .with_precision(dec_prec)
        .value();

    // Scale is the vertical span (approx).
    // Multiply x-step by aspect to cover wide screen
    let step_y_f64 = scale * 0.22;
    let step_x_f64 = scale * 0.22 * aspect;
    let step_y = f64_to_dbig(step_y_f64, dec_prec);
    let step_x = f64_to_dbig(step_x_f64, dec_prec);

    let mut best = AnchorSearch {
        x: center_x.clone(),
        y: center_y.clone(),
        ox: 0.0,
        oy: 0.0,
        score: 0,
        orbit: None,
    };
    let mut best_ref_orbit: Vec<(f64, f64)> = Vec::new();

    // Phase 1: Find an initial reference orbit in arbitrary precision. Once a candidate
    // survives past the immediate exterior (> 16 iterations), Phase 2 can survey the
    // rest of the viewport in hardware f64 perturbation instead of slow FBig probes.
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

    for (k, &(ox_i, oy_i)) in inner_offsets.iter().enumerate() {
        let cx_probe = &center_x + (&step_x * DBig::from(ox_i));
        let cy_probe = &center_y + (&step_y * DBig::from(oy_i));
        let ctx = IterCtx::new(&cx_probe, &cy_probe, prec, abort_flag);

        // Only the centre records the GPU layout up front: it wins most often, and
        // recording for every probe would slow the search down.
        let mut orbit = Orbit::new(prec, k == 0, true);
        let mut cycles = CycleDetector::new(prec);
        if !orbit.advance(&ctx, limit, Some(&mut cycles)) {
            break;
        }

        let score = orbit.score(limit);
        if score > best.score {
            best_ref_orbit = orbit.f64s.take().unwrap_or_default();
            best = AnchorSearch {
                x: cx_probe,
                y: cy_probe,
                ox: (ox_i as f64) * step_x_f64,
                oy: (oy_i as f64) * step_y_f64,
                score,
                orbit: orbit.qs.is_some().then_some(orbit),
            };
            if score > 16 || score >= limit {
                break;
            }
        }
    }

    // Phase 2: If no inner spiral point reached the limit, run a fast f64 perturbation
    // coarse-to-fine search (11x11 survey + 2-stage local hill-climbing) using the best
    // reference orbit found so far, then verify the winning hotspot in arbitrary precision.
    if best.score < limit && !is_aborted(abort_flag) && best_ref_orbit.len() > 1 {
        let (win_ox, win_oy) =
            find_best_perturbation_offset(&best_ref_orbit, best.ox, best.oy, scale, aspect, limit);

        if (win_ox - best.ox).abs() > 0.0 || (win_oy - best.oy).abs() > 0.0 {
            let cx_probe = &center_x + f64_to_dbig(win_ox, dec_prec);
            let cy_probe = &center_y + f64_to_dbig(win_oy, dec_prec);
            let ctx = IterCtx::new(&cx_probe, &cy_probe, prec, abort_flag);

            let mut orbit = Orbit::new(prec, true, false);
            let mut cycles = CycleDetector::new(prec);
            if orbit.advance(&ctx, limit, Some(&mut cycles)) {
                let score = orbit.score(limit);
                if score > best.score {
                    best = AnchorSearch {
                        x: cx_probe,
                        y: cy_probe,
                        ox: win_ox,
                        oy: win_oy,
                        score,
                        orbit: Some(orbit),
                    };
                }
            }
        }
    }

    best
}

const SA_ORDER: usize = 8;
const SA_FLOATS: usize = 4 + SA_ORDER * 4;

/// Computes an Order-8 Series Approximation polynomial over the disk `|dc| <= max_dc`
/// around the reference anchor, validated by 8 boundary probes on the circle `|u| = 1`.
fn compute_sa(qs: &[f32], max_dc: f64) -> Vec<f32> {
    let mut out = vec![0.0_f32; SA_FLOATS];
    let num_points = qs.len() / 8;
    if num_points <= 2 || !(1e-37..1e-3).contains(&max_dc) {
        return out;
    }
    let ref_iter = num_points - 1;

    let mut probes = [(0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64); 8];
    for (p, probe) in probes.iter_mut().enumerate() {
        let angle = (p as f64) * std::f64::consts::FRAC_PI_4;
        let (uy, ux) = angle.sin_cos();
        *probe = (ux, uy, 0.0, 0.0);
    }

    let mut ar = [0.0_f64; SA_ORDER];
    let mut ai = [0.0_f64; SA_ORDER];
    let mut best_ar = [0.0_f64; SA_ORDER];
    let mut best_ai = [0.0_f64; SA_ORDER];
    let mut skip_iter = 0_u32;

    for m in 0..ref_iter {
        let base = m * 8;
        let xr = f64::from(qs[base]) + f64::from(qs[base + 1]) + f64::from(qs[base + 2]);
        let xi = f64::from(qs[base + 4]) + f64::from(qs[base + 5]) + f64::from(qs[base + 6]);
        let tx = 2.0 * xr;
        let ty = 2.0 * xi;

        for k in (0..SA_ORDER).rev() {
            let mut sr = 0.0;
            let mut si = 0.0;
            for j in 0..k {
                let rj = ar[j];
                let ij = ai[j];
                let rk = ar[k - 1 - j];
                let ik = ai[k - 1 - j];
                sr += rj * rk - ij * ik;
                si += rj * ik + ij * rk;
            }
            let ak_r = ar[k];
            let ak_i = ai[k];
            ar[k] = (tx * ak_r - ty * ak_i) + sr + if k == 0 { max_dc } else { 0.0 };
            ai[k] = (tx * ak_i + ty * ak_r) + si;
        }

        let next_base = (m + 1) * 8;
        let xnr =
            f64::from(qs[next_base]) + f64::from(qs[next_base + 1]) + f64::from(qs[next_base + 2]);
        let xni = f64::from(qs[next_base + 4])
            + f64::from(qs[next_base + 5])
            + f64::from(qs[next_base + 6]);
        let mut valid = true;
        for (ux, uy, dr, di) in &mut probes {
            let dcx = *ux * max_dc;
            let dcy = *uy * max_dc;
            let wx = tx + *dr;
            let wy = ty + *di;
            let ndr = wx * *dr - wy * *di + dcx;
            let ndi = wx * *di + wy * *dr + dcy;
            *dr = ndr;
            *di = ndi;

            let zr = xnr + ndr;
            let zi = xni + ndi;
            let zsq = zr * zr + zi * zi;
            let dsq = ndr * ndr + ndi * ndi;
            if zsq > 4.0 || zsq < dsq || !dsq.is_finite() {
                valid = false;
                break;
            }

            let mut sr = ar[SA_ORDER - 1];
            let mut si = ai[SA_ORDER - 1];
            for k in (0..SA_ORDER - 1).rev() {
                let tr = sr * *ux - si * *uy + ar[k];
                let ti = sr * *uy + si * *ux + ai[k];
                sr = tr;
                si = ti;
            }
            let sa_dr = sr * *ux - si * *uy;
            let sa_di = sr * *uy + si * *ux;
            let err_sq = (sa_dr - ndr).powi(2) + (sa_di - ndi).powi(2);
            if err_sq > dsq * 1e-10 {
                valid = false;
                break;
            }
        }
        if !valid {
            break;
        }
        skip_iter = (m + 1) as u32;
        best_ar = ar;
        best_ai = ai;
    }

    if skip_iter > 0 {
        let (inv_hi, inv_lo) = split_f64_to_2_f32(1.0 / max_dc);
        out[0] = skip_iter as f32;
        out[1] = inv_hi;
        out[2] = inv_lo;
        for k in 0..SA_ORDER {
            let (r_hi, r_lo) = split_f64_to_2_f32(best_ar[k]);
            let (i_hi, i_lo) = split_f64_to_2_f32(best_ai[k]);
            let off = 4 + k * 4;
            out[off] = r_hi;
            out[off + 1] = r_lo;
            out[off + 2] = i_hi;
            out[off + 3] = i_lo;
        }
    }
    out
}

/// Reference iteration count: at least the requested base, extended past the anchor's
/// own escape (or well past the search limit for bounded anchors) and capped.
fn upgraded_iter(base_iter: u32, anchor_iter: u32, search_limit: u32) -> u32 {
    let base = u64::from(base_iter);
    let anchor = u64::from(anchor_iter);
    let limit = u64::from(search_limit);
    let mut calc = base.max(anchor);
    if anchor >= limit {
        calc = limit * 3 / 2;
    } else if calc > base {
        calc = calc * 5 / 4;
    }
    calc.min(MAX_REFERENCE_ITER) as u32
}

/// A reference orbit ready for the GPU, plus the anchor it was computed at.
#[wasm_bindgen]
pub struct Reference {
    #[wasm_bindgen(getter_with_clone)]
    pub x: String,
    #[wasm_bindgen(getter_with_clone)]
    pub y: String,
    pub iter: u32,
    orbit: Vec<f32>,
    sa: Vec<f32>,
}

#[wasm_bindgen]
impl Reference {
    /// Moves the quad-f32 orbit out (8 floats per point, ending at the escape point if
    /// the anchor escapes) without copying it through a getter.
    pub fn take_orbit(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.orbit)
    }

    /// Moves the Series Approximation uniform block (36 floats) out without copying.
    pub fn take_sa(&mut self) -> Vec<f32> {
        std::mem::take(&mut self.sa)
    }
}

/// Finds the best anchor near the view centre and returns its reference orbit. The
/// anchor's orbit from the search is reused and extended where possible, so the winning
/// point is not iterated twice in arbitrary precision.
#[wasm_bindgen]
pub fn compute_reference(
    cx_str: String,
    cy_str: String,
    scale: f64,
    aspect: f64,
    base_iter: u32,
    prec: u32,
    abort_flag: Option<js_sys::Int32Array>,
) -> Reference {
    let prec = prec as usize;
    let search_limit = base_iter.saturating_mul(3).max(5000);
    let anchor = search_anchor(
        &cx_str,
        &cy_str,
        scale,
        aspect,
        search_limit,
        prec,
        &abort_flag,
    );
    let calc_iter = upgraded_iter(base_iter, anchor.score, search_limit);

    let ctx = IterCtx::new(&anchor.x, &anchor.y, prec, &abort_flag);
    let mut orbit = anchor
        .orbit
        .unwrap_or_else(|| Orbit::new(prec, true, false));
    orbit.advance(&ctx, calc_iter, None);

    let orbit_qs = orbit.qs.unwrap_or_default();
    let max_dc = (anchor.ox.hypot(anchor.oy) + scale * aspect.hypot(1.0)) * 1.25;
    let sa = if is_aborted(&abort_flag) {
        vec![0.0; SA_FLOATS]
    } else {
        compute_sa(&orbit_qs, max_dc)
    };

    Reference {
        x: anchor.x.to_string(),
        y: anchor.y.to_string(),
        iter: calc_iter,
        orbit: orbit_qs,
        sa,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::*;

    /// Fresh single-pass reference orbit, for comparing against the staged/reused path.
    fn reference_orbit(c_re: &str, c_im: &str, max_iter: u32, prec: usize) -> Vec<f32> {
        let cx = DBig::from_str(c_re).unwrap_or(DBig::ZERO);
        let cy = DBig::from_str(c_im).unwrap_or(DBig::ZERO);
        let ctx = IterCtx::new(&cx, &cy, prec, &None);
        let mut orbit = Orbit::new(prec, true, false);
        assert!(orbit.advance(&ctx, max_iter, None));
        orbit.qs.unwrap()
    }

    #[wasm_bindgen_test]
    fn test_split_fbig() {
        let d = DBig::from_str("-0.743643887037158704752191506114774").unwrap();
        let f = d.to_binary().value().with_precision(256).value();
        let (p0, p1, p2, p3) = split_f64_to_4_f32(f.to_f64().value());
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
    fn test_orbit_origin() {
        // max_iter = 2 -> points z_0..z_2 -> (2 + 1) * 8 = 24 floats
        assert_eq!(reference_orbit("0.0", "0.0", 2, 53), vec![0.0; 24]);
    }

    #[wasm_bindgen_test]
    fn test_orbit_diverge() {
        // Iter 0: z=0,0 -> stored. New z = 3,0
        // Iter 1: z=3,0 -> stored. (3^2 + 0^2 > 4) -> escapes
        // The orbit ends at the escape point (2 points = 16 floats)
        let mut expected = vec![0.0; 16];
        expected[8] = 3.0; // zx0 at iter 1
        assert_eq!(reference_orbit("3.0", "0.0", 2, 53), expected);
    }

    #[wasm_bindgen_test]
    fn test_orbit_oscillate() {
        // c = (-1, 0): z alternates 0, -1, 0, -1
        // Vec structure for each iteration: [zx0..zx3, zy0..zy3]
        let mut expected = vec![0.0; 32];
        expected[8] = -1.0; // Iter 1: z=(-1, 0) -> zx0 = -1.0
        expected[24] = -1.0; // Iter 3: z=(-1, 0) -> zx0 = -1.0
        assert_eq!(reference_orbit("-1.0", "0.0", 3, 53), expected);
    }

    #[wasm_bindgen_test]
    fn test_orbit_invalid_input_falls_back_to_zero() {
        assert_eq!(reference_orbit("invalid", "invalid", 2, 53), vec![0.0; 24]);
    }

    #[wasm_bindgen_test]
    fn test_staged_advance_matches_single_pass() {
        // Stop at a cycle, then resume: must be bit-identical to one uninterrupted pass.
        let cx = DBig::from_str("-0.1").unwrap();
        let cy = DBig::from_str("0.1").unwrap();
        let ctx = IterCtx::new(&cx, &cy, 128, &None);
        let mut staged = Orbit::new(128, true, false);
        let mut cycles = CycleDetector::new(128);
        assert!(staged.advance(&ctx, 5000, Some(&mut cycles)));
        assert!(!staged.escaped && staged.n < 5000, "expected a cycle stop");
        assert!(staged.advance(&ctx, 6000, None));

        assert_eq!(
            staged.qs.unwrap(),
            reference_orbit("-0.1", "0.1", 6000, 128)
        );
    }

    #[wasm_bindgen_test]
    fn test_search_anchor_center() {
        let result = search_anchor("0", "0", 1.0, 1.0, 100, 53, &None);
        assert_eq!(result.score, 100);
        assert_eq!(result.x.to_string(), "0");
        assert_eq!(result.y.to_string(), "0");
        assert!(result.orbit.is_some(), "centre orbit should be reused");
    }

    #[wasm_bindgen_test]
    fn test_search_anchor_off_center() {
        // Center is out of bounds, but large step ensures an offset points to the origin
        // Step size is scale * 0.22 = 10.0 * 0.22 = 2.2, so offset (-1, 0) gives x = 0
        let result = search_anchor("2.2", "0", 10.0, 1.0, 100, 53, &None);
        assert_eq!(result.score, 100);
        assert_eq!(result.x.to_string(), "0");
        assert_eq!(result.y.to_string(), "0");
    }

    #[wasm_bindgen_test]
    fn test_upgraded_iter() {
        assert_eq!(upgraded_iter(1000, 5000, 5000), 7500); // bounded anchor
        assert_eq!(upgraded_iter(1000, 2000, 5000), 2500); // escaped past base
        assert_eq!(upgraded_iter(1000, 500, 5000), 1000); // escaped before base
        assert_eq!(upgraded_iter(2_000_000, 6_000_000, 6_000_000), 2_500_000); // capped
    }

    #[wasm_bindgen_test]
    fn test_compute_reference_reuses_centre_orbit() {
        // Centre is interior, so its search orbit is extended rather than recomputed.
        let mut r = compute_reference("-0.1".into(), "0.1".into(), 1e-3, 1.0, 100, 128, None);
        assert_eq!(r.x, "-0.1");
        assert_eq!(r.iter, 7500);
        assert_eq!(r.take_orbit(), reference_orbit("-0.1", "0.1", 7500, 128));
    }

    #[wasm_bindgen_test]
    fn test_compute_reference_recomputes_non_centre_anchor() {
        let mut r = compute_reference("2.2".into(), "0".into(), 10.0, 1.0, 100, 53, None);
        assert_eq!(r.x, "0");
        assert_eq!(r.take_orbit(), reference_orbit("0", "0", r.iter, 53));
    }

    #[wasm_bindgen_test]
    fn test_compute_sa() {
        let mut r = compute_reference("-0.75".into(), "0.01".into(), 1e-10, 1.0, 500, 128, None);
        let sa = r.take_sa();
        assert_eq!(sa.len(), SA_FLOATS);
        assert!(sa[0] > 50.0, "expected SA to skip initial iterations");
        assert!(sa[1] > 0.0, "expected positive inv_max_dc");
    }
}
