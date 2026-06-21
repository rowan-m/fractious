struct Uniforms {
  center: vec2<f32>,
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

  c_delta = rotated * uniforms.zoom + uniforms.center; // This is delta_0
  
  var delta = vec2<f32>(0.0, 0.0);
  
  var i: u32 = 0u;
  var zn_sq: f32 = 0.0;
  var zn = vec2<f32>(0.0, 0.0);

  loop {
    if (i >= uniforms.iter) { break; }
    
    // Load Xn (Reference)
    let raw_xn = reference_orbit[i]; 
    let xn = vec2<f32>(raw_xn.x, raw_xn.z);
    
    // delta_{n+1} = 2 X_n delta_n + delta_n^2 + delta_0
    let two_xn_delta = 2.0 * vec2<f32>(
      xn.x * delta.x - xn.y * delta.y,
      xn.x * delta.y + xn.y * delta.x
    );
    
    let delta_sq = vec2<f32>(
        delta.x * delta.x - delta.y * delta.y,
        2.0 * delta.x * delta.y
    );
    
    delta = two_xn_delta + delta_sq + c_delta;
    
    let next_i = i + 1u;
    let raw_xn_next = reference_orbit[next_i];
    let xn_next = vec2<f32>(raw_xn_next.x, raw_xn_next.z);
    zn = xn_next + delta;
    zn_sq = dot(zn, zn);
    if (zn_sq > 4.0) {
        i = next_i; 
        break;
    }
    
    i = next_i;
  }
  
  if (i >= uniforms.iter) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);
  }
  
  // Replicating reference logic:
  // co = sqrt(max(0.0, co) / 256.0) * huestep;
  let raw_co = f32(i) + 1.0 - log2(max(1.0, log2(zn_sq)));
  let co = sqrt(max(0.0, raw_co) / 256.0) * uniforms.huestep;
  
  var hsv: vec3<f32>;
  // hue + 1.0 + sin(6.2831*co)/2.0
  hsv.x = fract(uniforms.hue + 1.0 + sin(6.2831 * co) * 0.5);
  // .25 + .6*(sin(6.2831*co) + 1.0)/2.0
  hsv.y = 0.25 + 0.6 * (sin(6.2831 * co) + 1.0) * 0.5;
  // .1 + .85*(sin(6.2831*co*1.2) + 1.0)/2.0
  hsv.z = 0.1 + 0.85 * (sin(6.2831 * co * 1.2) + 1.0) * 0.5;
  
  let col = hsv2rgb(hsv);
  
  let falloff = 0.996 + 0.06 * rand(uv + vec2<f32>(zn.y, zn.x));

  return vec4<f32>(col * falloff, 1.0);
}
