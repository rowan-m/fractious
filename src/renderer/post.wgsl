@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    var pos = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
        vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0)
    );
    return vec4<f32>(pos[vertex_index], 0.0, 1.0);
}

@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

@fragment
fn fs_main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let dim = vec2<f32>(textureDimensions(tex));
    let uv = pos.xy / dim;
    let dx = 1.0 / dim.x;
    let dy = 1.0 / dim.y;

    let c = textureSample(tex, samp, uv).rgb;
    let t = textureSample(tex, samp, uv + vec2<f32>(0.0, dy)).rgb;
    let b = textureSample(tex, samp, uv + vec2<f32>(0.0, -dy)).rgb;
    let l = textureSample(tex, samp, uv + vec2<f32>(-dx, 0.0)).rgb;
    let r = textureSample(tex, samp, uv + vec2<f32>(dx, 0.0)).rgb;

    let avg = (t + b + l + r) * 0.25;
    let diff = length(c - avg);

    // Smooth out isolated subpixel details (spikes/grit) - tuned to be less aggressive
    let smoothed = mix(c, avg, smoothstep(0.1, 0.9, diff) * 0.8);
    return vec4<f32>(smoothed, 1.0);
}
