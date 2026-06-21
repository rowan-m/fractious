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
  let re_term1 = qs_mul(a.re, a.re);
  let re_term2 = qs_mul(a.im, a.im);
  let im_term = qs_mul(a.re, a.im);
  let two_im = qs_add(im_term, im_term);
  return qs_complex(qs_sub(re_term1, re_term2), two_im);
}

struct Uniforms {
  center0: vec2<f32>,
  center1: vec2<f32>,
  center2: vec2<f32>,
  center3: vec2<f32>,
  zoom: f32,
  aspect_ratio: f32,
  iter: u32,
  hue: f32,
  huestep: f32,
  rotation: f32,
  padding: vec2<f32>,
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
  output.position = vec4<f32>(pos[vertex_index], 0.0, 1.0);
  output.uv = pos[vertex_index]; // [-1, 1]
  return output;
}

@fragment
fn fs_main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  // Correction for aspect ratio
  var c_delta = uv;
  c_delta.x = c_delta.x * uniforms.aspect_ratio;
  
  // Rotation
  let cos_r = cos(uniforms.rotation);
  let sin_r = sin(uniforms.rotation);
  let rotated = vec2<f32>(
      c_delta.x * cos_r - c_delta.y * sin_r,
      c_delta.x * sin_r + c_delta.y * cos_r
  );

  let center_x_qs = vec4<f32>(uniforms.center0.x, uniforms.center1.x, uniforms.center2.x, uniforms.center3.x);
  let center_y_qs = vec4<f32>(uniforms.center0.y, uniforms.center1.y, uniforms.center2.y, uniforms.center3.y);
  
  let dx_qs = vec4<f32>(rotated.x * uniforms.zoom, 0.0, 0.0, 0.0);
  let dy_qs = vec4<f32>(rotated.y * uniforms.zoom, 0.0, 0.0, 0.0);

  let c_delta_re = qs_add(center_x_qs, dx_qs);
  let c_delta_im = qs_add(center_y_qs, dy_qs);
  
  let c_delta_qs = qs_complex(c_delta_re, c_delta_im);
  
  var delta = qs_complex(vec4<f32>(0.0), vec4<f32>(0.0));
  
  var i: u32 = 0u;
  var zn_sq: f32 = 0.0;
  var zn_sp = vec2<f32>(0.0, 0.0);

  loop {
    if (i >= uniforms.iter) { break; }
    
    // Load Xn (Reference)
    let raw_xn = reference_orbit[i]; 
    let xn = qs_complex(raw_xn.re, raw_xn.im);
    
    // delta_{n+1} = 2 X_n delta_n + delta_n^2 + delta_0
    let xn_delta = qc_mul(xn, delta);
    let two_xn_delta = qs_complex(xn_delta.re * 2.0, xn_delta.im * 2.0);
    
    let delta_sq = qc_sq(delta);
    
    delta = qc_add(qc_add(two_xn_delta, delta_sq), c_delta_qs);
    
    let next_i = i + 1u;
    let raw_xn_next = reference_orbit[next_i];
    
    // Compute zn in single precision for escape check & coloring
    let zn_re = raw_xn_next.re.x + delta.re.x;
    let zn_im = raw_xn_next.im.x + delta.im.x;
    zn_sq = zn_re * zn_re + zn_im * zn_im;
    
    if (zn_sq > 4.0) {
        zn_sp = vec2<f32>(zn_re, zn_im);
        i = next_i; 
        break;
    }
    
    i = next_i;
  }
  
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
