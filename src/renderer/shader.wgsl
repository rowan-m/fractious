struct ds_complex {
  re: vec2<f32>, // high, low
  im: vec2<f32>, // high, low
};

fn ds_add(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
    let s = a.x + b.x;
    let v = s - a.x;
    let e = (a.x - (s - v)) + (b.x - v) + a.y + b.y;
    let high = s + e;
    let low = e - (high - s);
    return vec2<f32>(high, low);
}

fn ds_sub(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
    let s = a.x - b.x;
    let v = s - a.x;
    let e = (a.x - (s - v)) - (b.x + v) + a.y - b.y;
    let high = s + e;
    let low = e - (high - s);
    return vec2<f32>(high, low);
}

fn ds_mul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
    let p = a.x * b.x;
    let err = fma(a.x, b.x, -p);
    let low = err + (a.x * b.y + a.y * b.x);
    let high = p + low;
    let low2 = low - (high - p);
    return vec2<f32>(high, low2);
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
    let re_term1 = ds_mul(a.re, a.re);
    let re_term2 = ds_mul(a.im, a.im);
    let im_term = ds_mul(a.re, a.im);
    return ds_complex(ds_sub(re_term1, re_term2), im_term * 2.0);
}

struct Uniforms {
  center_high: vec2<f32>,
  center_low: vec2<f32>,
  zoom: f32,
  aspect_ratio: f32,
  iter: u32,
  hue: f32,
  huestep: f32,
  rotation: f32,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var<storage, read> reference_orbit: array<vec4<f32>>; // Passed as interleaved f32 (Real High, Real Low, Imag High, Imag Low)

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

  let center_x_ds = vec2<f32>(uniforms.center_high.x, uniforms.center_low.x);
  let center_y_ds = vec2<f32>(uniforms.center_high.y, uniforms.center_low.y);
  
  let c_delta_re = ds_add(center_x_ds, vec2<f32>(rotated.x * uniforms.zoom, 0.0));
  let c_delta_im = ds_add(center_y_ds, vec2<f32>(rotated.y * uniforms.zoom, 0.0));
  
  let c_delta_ds = ds_complex(c_delta_re, c_delta_im);
  
  var delta = ds_complex(vec2<f32>(0.0, 0.0), vec2<f32>(0.0, 0.0));
  
  var i: u32 = 0u;
  var zn_sq: f32 = 0.0;
  var zn_sp = vec2<f32>(0.0, 0.0);

  loop {
    if (i >= uniforms.iter) { break; }
    
    // Load Xn (Reference)
    let raw_xn = reference_orbit[i]; 
    let xn = ds_complex(
      vec2<f32>(raw_xn.x, raw_xn.y),
      vec2<f32>(raw_xn.z, raw_xn.w)
    );
    
    // delta_{n+1} = 2 X_n delta_n + delta_n^2 + delta_0
    let xn_delta = dc_mul(xn, delta);
    let two_xn_delta = ds_complex(xn_delta.re * 2.0, xn_delta.im * 2.0);
    
    let delta_sq = dc_sq(delta);
    
    delta = dc_add(dc_add(two_xn_delta, delta_sq), c_delta_ds);
    
    let next_i = i + 1u;
    let raw_xn_next = reference_orbit[next_i];
    
    // Compute zn in single precision for escape check & coloring
    let zn_re = raw_xn_next.x + delta.re.x;
    let zn_im = raw_xn_next.z + delta.im.x;
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
