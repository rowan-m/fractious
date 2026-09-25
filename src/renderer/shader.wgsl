struct qs_complex {
  re: vec4<f32>,
  im: vec4<f32>,
};

fn quick_two_sum(a: f32, b: f32) -> vec2<f32> {
  let s = a + b;
  let err = b - (s - a);
  return vec2<f32>(s, err);
}

fn two_sum(a: f32, b: f32) -> vec2<f32> {
  let s = a + b;
  let v = s - a;
  let err = (a - (s - v)) + (b - v);
  return vec2<f32>(s, err);
}

fn two_prod(a: f32, b: f32) -> vec2<f32> {
  let p = a * b;
  let err = fma(a, b, -p);
  return vec2<f32>(p, err);
}

fn three_sum(a: f32, b: f32, c: f32) -> vec3<f32> {
  let r1 = two_sum(a, b);
  let t1 = r1.x;
  let t2 = r1.y;

  let r2 = two_sum(c, t1);
  let a_out = r2.x;
  let t3 = r2.y;

  let r3 = two_sum(t2, t3);
  let b_out = r3.x;
  let c_out = r3.y;

  return vec3<f32>(a_out, b_out, c_out);
}

fn three_sum2(a: f32, b: f32, c: f32) -> vec2<f32> {
  let r1 = two_sum(a, b);
  let t1 = r1.x;
  let t2 = r1.y;

  let r2 = two_sum(c, t1);
  let a_out = r2.x;
  let t3 = r2.y;

  let b_out = t2 + t3;

  return vec2<f32>(a_out, b_out);
}

fn renorm5(c0_in: f32, c1_in: f32, c2_in: f32, c3_in: f32, c4_in: f32) -> vec4<f32> {
  var c0 = c0_in;
  var c1 = c1_in;
  var c2 = c2_in;
  var c3 = c3_in;
  var c4 = c4_in;

  var t0: f32; var t1: f32; var t2: f32; var t3: f32;
  var s: f32;
  var r: vec2<f32>;

  r = quick_two_sum(c3, c4);
  s = r.x;
  t3 = r.y;

  r = quick_two_sum(c2, s);
  s = r.x;
  t2 = r.y;

  r = quick_two_sum(c1, s);
  s = r.x;
  t1 = r.y;

  r = quick_two_sum(c0, s);
  c0 = r.x;
  t0 = r.y;

  r = quick_two_sum(t2, t3);
  s = r.x;
  t2 = r.y;

  r = quick_two_sum(t1, s);
  s = r.x;
  t1 = r.y;

  r = quick_two_sum(t0, s);
  c1 = r.x;
  t0 = r.y;

  r = quick_two_sum(t1, t2);
  s = r.x;
  t1 = r.y;

  r = quick_two_sum(t0, s);
  c2 = r.x;
  t0 = r.y;
  
  c3 = t0 + t1;
  return vec4<f32>(c0, c1, c2, c3);
}

fn qs_add(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let s = a + b;
  let v = s - a;
  let w = a - (s - v);
  let t = w + (b - v);

  var s1 = s.y;
  var s2 = s.z;
  var s3 = s.w;

  var t0 = t.x;
  var t1 = t.y;
  var t2 = t.z;
  var t3 = t.w;

  let r1 = two_sum(s1, t0);
  s1 = r1.x;
  t0 = r1.y;

  let r2 = three_sum(s2, t0, t1);
  s2 = r2.x;
  t0 = r2.y;
  t1 = r2.z;

  let r3 = three_sum2(s3, t0, t2);
  s3 = r3.x;
  t0 = r3.y;

  let final_t0 = t0 + t1 + t3;

  return renorm5(s.x, s1, s2, s3, final_t0);
}

fn qs_sub(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return qs_add(a, -b);
}

fn qs_mul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  let r0 = two_prod(a.x, b.x);
  let p0 = r0.x;
  var q0 = r0.y;

  let r1 = two_prod(a.x, b.y);
  var p1 = r1.x;
  var q1 = r1.y;

  let r2 = two_prod(a.y, b.x);
  var p2 = r2.x;
  var q2 = r2.y;

  let r3 = two_prod(a.x, b.z);
  var p3 = r3.x;
  var q3 = r3.y;

  let r4 = two_prod(a.y, b.y);
  var p4 = r4.x;
  var q4 = r4.y;

  let r5 = two_prod(a.z, b.x);
  var p5 = r5.x;
  var q5 = r5.y;

  let acc1 = three_sum(p1, p2, q0);
  p1 = acc1.x;
  p2 = acc1.y;
  q0 = acc1.z;

  let acc2 = three_sum(p2, q1, q2);
  p2 = acc2.x;
  q1 = acc2.y;
  q2 = acc2.z;

  let acc3 = three_sum(p3, p4, p5);
  p3 = acc3.x;
  p4 = acc3.y;
  p5 = acc3.z;

  let r_s0 = two_sum(p2, p3);
  let s0 = r_s0.x;
  var t0 = r_s0.y;

  let r_s1 = two_sum(q1, p4);
  var s1 = r_s1.x;
  var t1 = r_s1.y;

  var s2 = q2 + p5;

  let r_s1_t0 = two_sum(s1, t0);
  s1 = r_s1_t0.x;
  t0 = r_s1_t0.y;

  s2 = s2 + (t0 + t1);

  let eps3_terms = a.x * b.w + a.y * b.z + a.z * b.y + a.w * b.x + q0 + q3 + q4 + q5;
  s1 = s1 + eps3_terms;

  return renorm5(p0, p1, s0, s1, s2);
}

fn qs_sqr(a: vec4<f32>) -> vec4<f32> {
  let r0 = two_prod(a.x, a.x);
  let p0 = r0.x;
  let q0 = r0.y;

  let r1 = two_prod(a.x, a.y) * 2.0;
  let r2 = two_prod(a.x, a.z) * 2.0;
  let r3 = two_prod(a.y, a.y);

  let acc1 = two_sum(r1.x, q0);
  let p1 = acc1.x;
  let q0_rem = acc1.y;

  let acc2 = three_sum(r2.x, r3.x, r1.y);
  let r_s0 = two_sum(acc2.x, q0_rem);
  let s0 = r_s0.x;

  let s1 = 2.0 * (a.x * a.w + a.y * a.z) + acc2.y + r_s0.y + acc2.z + r2.y + r3.y;

  return renorm5(p0, p1, s0, s1, 0.0);
}

fn qc_add(a: qs_complex, b: qs_complex) -> qs_complex {
  return qs_complex(qs_add(a.re, b.re), qs_add(a.im, b.im));
}

fn qc_mul(a: qs_complex, b: qs_complex) -> qs_complex {
  let re_term1 = qs_mul(a.re, b.re);
  let re_term2 = qs_mul(a.im, b.im);
  let im_term1 = qs_mul(a.re, b.im);
  let im_term2 = qs_mul(a.im, b.re);
  return qs_complex(qs_sub(re_term1, re_term2), qs_add(im_term1, im_term2));
}

fn qc_sq(a: qs_complex) -> qs_complex {
  let re_term1 = qs_sqr(a.re);
  let re_term2 = qs_sqr(a.im);
  let im_term = qs_mul(a.re, a.im);
  return qs_complex(qs_sub(re_term1, re_term2), im_term * 2.0);
}

struct Uniforms {
  center0: vec2<f32>,
  center1: vec2<f32>,
  center2: vec2<f32>,
  center3: vec2<f32>,
  zoom: vec4<f32>,
  aspect_ratio: f32,
  iter: u32,
  hue: f32,
  huestep: f32,
  rotation: f32,
  slice_scale: f32,
  slice_offset: f32,
  ref_iter: u32,
};

struct OrbitPoint {
  re: vec4<f32>,
  im: vec4<f32>,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> reference_orbit: array<OrbitPoint>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

fn rand(co: vec2<f32>) -> f32 {
  return fract(sin(dot(co, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

fn hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let K = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}

struct ds_complex {
  re: vec2<f32>,
  im: vec2<f32>,
};

fn ds_add(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let s = a.x + b.x;
  let v = s - a.x;
  let e = (a.x - (s - v)) + (b.x - v) + a.y + b.y;
  let hi = s + e;
  let lo = e - (hi - s);
  return vec2<f32>(hi, lo);
}

fn ds_sub(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  return ds_add(a, -b);
}

fn ds_mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let p = a.x * b.x;
  let e1 = fma(a.x, b.x, -p);
  let e2 = a.y * b.x + a.x * b.y;
  let hi = p + e2;
  let lo = e1 + e2 - (hi - p);
  return vec2<f32>(hi, lo);
}

fn ds_sqr(a: vec2<f32>) -> vec2<f32> {
  let p = a.x * a.x;
  let e1 = fma(a.x, a.x, -p);
  let e2 = 2.0 * (a.x * a.y);
  let hi = p + e2;
  let lo = e1 + e2 - (hi - p);
  return vec2<f32>(hi, lo);
}

fn dc_add(a: ds_complex, b: ds_complex) -> ds_complex {
  return ds_complex(ds_add(a.re, b.re), ds_add(a.im, b.im));
}

fn dc_mul(a: ds_complex, b: ds_complex) -> ds_complex {
  let re_term1 = ds_mul(a.re, b.re);
  let re_term2 = ds_mul(a.im, b.im);
  let im_term1 = ds_mul(a.re, b.im);
  let im_term2 = ds_mul(a.im, b.re);
  return ds_complex(ds_sub(re_term1, re_term2), ds_add(im_term1, im_term2));
}

fn dc_sq(a: ds_complex) -> ds_complex {
  let re_term1 = ds_sqr(a.re);
  let re_term2 = ds_sqr(a.im);
  let im_term = ds_mul(a.re, a.im);
  return ds_complex(ds_sub(re_term1, re_term2), im_term * 2.0);
}

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
  var pos = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0)
  );
  
  var output: VertexOutput;
  let original_pos = pos[vertex_index];
  
  // Geometry-slice: Scale and offset the Y coordinate of the vertex pos to restrict rasterization to the slice.
  // This physically limits fragment shader invocations to ONLY the current rendering slice.
  let slice_y = original_pos.y * uniforms.slice_scale + uniforms.slice_offset;
  
  output.position = vec4<f32>(original_pos.x, slice_y, 0.0, 1.0);
  output.uv = vec2<f32>(original_pos.x, slice_y); // Map UV to the actual geometry position to avoid vertical squishing!
  return output;
}

fn compute_rotated_uv(uv: vec2<f32>) -> vec2<f32> {
  var c_delta = uv;
  c_delta.x = c_delta.x * uniforms.aspect_ratio;

  let cos_r = cos(uniforms.rotation);
  let sin_r = sin(uniforms.rotation);
  return vec2<f32>(
      c_delta.x * cos_r - c_delta.y * sin_r,
      c_delta.x * sin_r + c_delta.y * cos_r
  );
}

// Interior shortcuts are only safe where f32 resolves c and z below a pixel.
const INTERIOR_CHECK_MIN_ZOOM: f32 = 1.0e-4;

// Closed-form membership of the main cardioid and the period-2 bulb, which hold most
// of the interior (and therefore most of the iterations) in low-zoom views.
fn in_main_bulbs(c: vec2<f32>) -> bool {
  let x = c.x - 0.25;
  let y2 = c.y * c.y;
  let q = x * x + y2;
  let xp = c.x + 1.0;
  return q * (q + x) <= 0.25 * y2 || xp * xp + y2 <= 0.0625;
}

fn compute_color(i: u32, zn_sq: f32, zn_sp: vec2<f32>, uv: vec2<f32>) -> vec4<f32> {
  if (i >= uniforms.iter) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }

  let raw_co = f32(i) + 1.0 - log2(max(1.0, log2(zn_sq)));
  let co = sqrt(max(0.0, raw_co) / 256.0) * uniforms.huestep;

  var hsv: vec3<f32>;
  hsv.x = fract(uniforms.hue + 1.0 + sin(6.2831 * co) * 0.5);
  hsv.y = 0.25 + 0.6 * (sin(6.2831 * co) + 1.0) * 0.5;
  hsv.z = 0.1 + 0.85 * (sin(6.2831 * co * 1.2) + 1.0) * 0.5;

  let col = hsv2rgb(hsv);

  let falloff = 0.996 + 0.06 * rand(uv + vec2<f32>(zn_sp.y, zn_sp.x));

  return vec4<f32>(col * falloff, 1.0);
}

@fragment
fn fs_main_f32(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let rotated = compute_rotated_uv(uv);

  let center_x = uniforms.center0.x;
  let center_y = uniforms.center0.y;
  
  // Compute pixel offsets in native single-precision
  let dx = rotated.x * uniforms.zoom.x;
  let dy = rotated.y * uniforms.zoom.x;

  let c_delta_re = center_x + dx;
  let c_delta_im = center_y + dy;

  // X_1 = c_ref, so this is the pixel's absolute c.
  let check_interior = uniforms.zoom.x > INTERIOR_CHECK_MIN_ZOOM;
  let c_ref = reference_orbit[1];
  if (check_interior &&
      in_main_bulbs(vec2<f32>(c_ref.re.x + c_delta_re, c_ref.im.x + c_delta_im))) {
    return compute_color(uniforms.iter, 0.0, vec2<f32>(0.0), uv);
  }
  // Brent-style periodicity check: an orbit that returns (within a small fraction of
  // a pixel, floored above f32 rounding noise) to a saved point is periodic, so the
  // pixel is interior. Cap the checkpoint window so slowly converging boundary orbits
  // refresh their saved point regularly.
  let period_tol = clamp(uniforms.zoom.x * 2.0e-4, 2.5e-7, 5.0e-5);
  let period_tol_sq = period_tol * period_tol;
  var period_z = vec2<f32>(0.0, 0.0);
  var period_len: u32 = 8u;
  var period_step: u32 = 0u;
  
  var delta_re = 0.0;
  var delta_im = 0.0;
  
  var i: u32 = 0u;
  var m: u32 = 0u;
  var zn_sq: f32 = 0.0;
  var zn_sp = vec2<f32>(0.0, 0.0);
  // X_m, carried over from the previous iteration's X_{m+1} (X_0 = 0).
  var raw_xm = OrbitPoint(vec4<f32>(0.0), vec4<f32>(0.0));

  loop {
    if (i >= uniforms.iter) { break; }
    
    let x_re = raw_xm.re.x;
    let x_im = raw_xm.im.x;
    
    // delta_{n+1} = 2 * X_m * delta_n + delta_n^2 + delta_0
    let two_xm_delta_re = 2.0 * (x_re * delta_re - x_im * delta_im);
    let two_xm_delta_im = 2.0 * (x_re * delta_im + x_im * delta_re);
    
    let delta_sq_re = delta_re * delta_re - delta_im * delta_im;
    let delta_sq_im = 2.0 * delta_re * delta_im;
    
    delta_re = two_xm_delta_re + delta_sq_re + c_delta_re;
    delta_im = two_xm_delta_im + delta_sq_im + c_delta_im;
    
    let next_m = m + 1u;
    let raw_xm_next = reference_orbit[next_m];
    
    // Compute zn in single precision
    let zn_re = raw_xm_next.re.x + delta_re;
    let zn_im = raw_xm_next.im.x + delta_im;
    zn_sq = zn_re * zn_re + zn_im * zn_im;
    
    i = i + 1u;

    if (zn_sq > 4.0) {
        zn_sp = vec2<f32>(zn_re, zn_im);
        break;
    }

    if (check_interior) {
      let dz = vec2<f32>(zn_re, zn_im) - period_z;
      if (dot(dz, dz) < period_tol_sq) {
        i = uniforms.iter;
        break;
      }
      period_step = period_step + 1u;
      if (period_step == period_len) {
        period_step = 0u;
        period_len = min(period_len * 2u, 128u);
        period_z = vec2<f32>(zn_re, zn_im);
      }
    }
    
    let delta_norm_sq = delta_re * delta_re + delta_im * delta_im;
    if (zn_sq < delta_norm_sq || next_m >= uniforms.ref_iter) {
        delta_re = zn_re;
        delta_im = zn_im;
        m = 0u;
        raw_xm = OrbitPoint(vec4<f32>(0.0), vec4<f32>(0.0));
    } else {
        m = next_m;
        raw_xm = raw_xm_next;
    }
  }
  
  return compute_color(i, zn_sq, zn_sp, uv);
}

@fragment
fn fs_main_ds(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let rotated = compute_rotated_uv(uv);

  let center_x_ds = vec2<f32>(uniforms.center0.x, uniforms.center1.x);
  let center_y_ds = vec2<f32>(uniforms.center0.y, uniforms.center1.y);
  let zoom_ds = vec2<f32>(uniforms.zoom.x, uniforms.zoom.y);
  
  // Compute pixel offsets in emulated Double-Single precision
  let dx_ds = ds_mul(zoom_ds, vec2<f32>(rotated.x, 0.0));
  let dy_ds = ds_mul(zoom_ds, vec2<f32>(rotated.y, 0.0));

  let c_delta_re = ds_add(center_x_ds, dx_ds);
  let c_delta_im = ds_add(center_y_ds, dy_ds);
  
  let c_delta_ds = ds_complex(c_delta_re, c_delta_im);
  
  var delta = ds_complex(vec2<f32>(0.0), vec2<f32>(0.0));
  
  var i: u32 = 0u;
  var m: u32 = 0u;
  var zn_sq: f32 = 0.0;
  var zn_sp = vec2<f32>(0.0, 0.0);
  // X_m, carried over from the previous iteration's X_{m+1} (X_0 = 0).
  var raw_xm = OrbitPoint(vec4<f32>(0.0), vec4<f32>(0.0));

  loop {
    if (i >= uniforms.iter) { break; }
    
    let x_re = vec2<f32>(raw_xm.re.x, raw_xm.re.y);
    let x_im = vec2<f32>(raw_xm.im.x, raw_xm.im.y);
    let xm = ds_complex(x_re, x_im);
    
    // delta_{n+1} = 2 * X_m * delta_n + delta_n^2 + delta_0
    let xm_delta = dc_mul(xm, delta);
    let two_xm_delta = ds_complex(xm_delta.re * 2.0, xm_delta.im * 2.0);
    
    let delta_sq = dc_sq(delta);
    
    delta = dc_add(dc_add(two_xm_delta, delta_sq), c_delta_ds);
    
    let next_m = m + 1u;
    let raw_xm_next = reference_orbit[next_m];
    
    // Compute zn in single precision
    let zn_re = raw_xm_next.re.x + delta.re.x;
    let zn_im = raw_xm_next.im.x + delta.im.x;
    zn_sq = zn_re * zn_re + zn_im * zn_im;
    
    i = i + 1u;

    if (zn_sq > 4.0) {
        zn_sp = vec2<f32>(zn_re, zn_im);
        break;
    }
    
    let delta_norm_sq = delta.re.x * delta.re.x + delta.im.x * delta.im.x;
    if (zn_sq < delta_norm_sq || next_m >= uniforms.ref_iter) {
        let xm_next = ds_complex(
            vec2<f32>(raw_xm_next.re.x, raw_xm_next.re.y),
            vec2<f32>(raw_xm_next.im.x, raw_xm_next.im.y)
        );
        delta = dc_add(xm_next, delta);
        m = 0u;
        raw_xm = OrbitPoint(vec4<f32>(0.0), vec4<f32>(0.0));
    } else {
        m = next_m;
        raw_xm = raw_xm_next;
    }
  }
  
  return compute_color(i, zn_sq, zn_sp, uv);
}

@fragment
fn fs_main_qs(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let rotated = compute_rotated_uv(uv);

  let center_x_qs = vec4<f32>(uniforms.center0.x, uniforms.center1.x, uniforms.center2.x, uniforms.center3.x);
  let center_y_qs = vec4<f32>(uniforms.center0.y, uniforms.center1.y, uniforms.center2.y, uniforms.center3.y);
  
  // Compute pixel offsets in full Quad-Single precision using qs_mul
  let dx_qs = qs_mul(uniforms.zoom, vec4<f32>(rotated.x, 0.0, 0.0, 0.0));
  let dy_qs = qs_mul(uniforms.zoom, vec4<f32>(rotated.y, 0.0, 0.0, 0.0));

  let c_delta_re = qs_add(center_x_qs, dx_qs);
  let c_delta_im = qs_add(center_y_qs, dy_qs);
  
  let c_delta_qs = qs_complex(c_delta_re, c_delta_im);
  
  var delta = qs_complex(vec4<f32>(0.0), vec4<f32>(0.0));
  
  var i: u32 = 0u;
  var m: u32 = 0u;
  var zn_sq: f32 = 0.0;
  var zn_sp = vec2<f32>(0.0, 0.0);
  // X_m, carried over from the previous iteration's X_{m+1} (X_0 = 0).
  var raw_xm = OrbitPoint(vec4<f32>(0.0), vec4<f32>(0.0));

  loop {
    if (i >= uniforms.iter) { break; }
    
    let xm = qs_complex(raw_xm.re, raw_xm.im);
    
    // delta_{n+1} = 2 * X_m * delta_n + delta_n^2 + delta_0
    let xm_delta = qc_mul(xm, delta);
    let two_xm_delta = qs_complex(xm_delta.re * 2.0, xm_delta.im * 2.0);
    
    let delta_sq = qc_sq(delta);
    
    delta = qc_add(qc_add(two_xm_delta, delta_sq), c_delta_qs);
    
    let next_m = m + 1u;
    let raw_xm_next = reference_orbit[next_m];
    
    // Compute zn in single precision for escape check & coloring
    let zn_re = raw_xm_next.re.x + delta.re.x;
    let zn_im = raw_xm_next.im.x + delta.im.x;
    zn_sq = zn_re * zn_re + zn_im * zn_im;
    
    i = i + 1u;

    if (zn_sq > 4.0) {
        zn_sp = vec2<f32>(zn_re, zn_im);
        break;
    }
    
    let delta_norm_sq = delta.re.x * delta.re.x + delta.im.x * delta.im.x;
    if (zn_sq < delta_norm_sq || next_m >= uniforms.ref_iter) {
        let xm_next = qs_complex(raw_xm_next.re, raw_xm_next.im);
        delta = qc_add(xm_next, delta);
        m = 0u;
        raw_xm = OrbitPoint(vec4<f32>(0.0), vec4<f32>(0.0));
    } else {
        m = next_m;
        raw_xm = raw_xm_next;
    }
  }
  
  return compute_color(i, zn_sq, zn_sp, uv);
}
