#version 300 es
precision highp float;

uniform float aspect;
uniform vec2 center;
uniform vec2 centerD;
uniform int iterations;
uniform float zoom;
uniform float hue;
uniform float huestep;

in vec2 texCoord;
out vec4 fragmentColor;

float times_frc(float a, float b) {
  return mix(0.0, a * b, b != 0.0 ? 1.0 : 0.0);
}

float plus_frc(float a, float b) {
  return mix(a, a + b, b != 0.0 ? 1.0 : 0.0);
}

float minus_frc(float a, float b) {
  return mix(a, a - b, b != 0.0 ? 1.0 : 0.0);
}

// Double emulation based on GLSL Mandelbrot Shader by Henry Thasler (www.thasler.org/blog)
//
// Emulation based on Fortran-90 double-single package. See http://crd.lbl.gov/~dhbailey/mpdist/
// Substract: res = ds_add(a, b) => res = a + b
vec2 add(vec2 dsa, vec2 dsb) {
  vec2 dsc;
  float t1, t2, e;

  t1 = plus_frc(dsa.x, dsb.x);
  e = minus_frc(t1, dsa.x);
  t2 = plus_frc(plus_frc(plus_frc(minus_frc(dsb.x, e), minus_frc(dsa.x, minus_frc(t1, e))), dsa.y), dsb.y);
  dsc.x = plus_frc(t1, t2);
  dsc.y = minus_frc(t2, minus_frc(dsc.x, t1));
  return dsc;
}

// Substract: res = ds_sub(a, b) => res = a - b
vec2 sub(vec2 dsa, vec2 dsb) {
  vec2 dsc;
  float e, t1, t2;

  t1 = minus_frc(dsa.x, dsb.x);
  e = minus_frc(t1, dsa.x);
  t2 = minus_frc(plus_frc(plus_frc(minus_frc(minus_frc(0.0, dsb.x), e), minus_frc(dsa.x, minus_frc(t1, e))), dsa.y), dsb.y);

  dsc.x = plus_frc(t1, t2);
  dsc.y = minus_frc(t2, minus_frc(dsc.x, t1));
  return dsc;
}

// Compare: res = -1 if a < b
//              = 0 if a == b
//              = 1 if a > b
float cmp(vec2 dsa, vec2 dsb) {
  if (dsa.x < dsb.x) {
    return -1.;
  }
  if (dsa.x > dsb.x) {
    return 1.;
  }
  if (dsa.y < dsb.y) {
    return -1.;
  }
  if (dsa.y > dsb.y) {
    return 1.;
  }

  return 0.;
}

// Multiply: res = ds_mul(a, b) => res = a * b
vec2 mul(vec2 dsa, vec2 dsb) {
  vec2 dsc;
  float c11, c21, c2, e, t1, t2;
  float a1, a2, b1, b2, cona, conb, split = 8193.;

  cona = times_frc(dsa.x, split);
  conb = times_frc(dsb.x, split);
  a1 = minus_frc(cona, minus_frc(cona, dsa.x));
  b1 = minus_frc(conb, minus_frc(conb, dsb.x));
  a2 = minus_frc(dsa.x, a1);
  b2 = minus_frc(dsb.x, b1);

  c11 = times_frc(dsa.x, dsb.x);
  c21 = plus_frc(times_frc(a2, b2), plus_frc(times_frc(a2, b1), plus_frc(times_frc(a1, b2), minus_frc(times_frc(a1, b1), c11))));

  c2 = plus_frc(times_frc(dsa.x, dsb.y), times_frc(dsa.y, dsb.x));

  t1 = plus_frc(c11, c2);
  e = minus_frc(t1, c11);
  t2 = plus_frc(plus_frc(times_frc(dsa.y, dsb.y), plus_frc(minus_frc(c2, e), minus_frc(c11, minus_frc(t1, e)))), c21);

  dsc.x = plus_frc(t1, t2);
  dsc.y = minus_frc(t2, minus_frc(dsc.x, t1));

  return dsc;
}

// create double-single number from float
vec2 set(float a) {
  return vec2(a, 0.0);
}

float rand(vec2 co) {
  // implementation found at: lumina.sourceforge.net/Tutorials/Noise.html
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

vec2 complexMul(vec2 a, vec2 b) {
  return vec2(a.x * b.x -  a.y * b.y, a.x * b.y + a.y * b.x);
}

// double complex multiplication
vec4 dcMul(vec4 a, vec4 b) {
  return vec4(
    sub(mul(a.xy, b.xy), mul(a.zw, b.zw)),
    add(mul(a.xy, b.zw), mul(a.zw, b.xy))
  );
}

vec4 dcAdd(vec4 a, vec4 b) {
  return vec4(add(a.xy, b.xy), add(a.zw, b.zw));
}

// Length of double complex
vec2 dcLength(vec4 a) {
  return add(mul(a.xy, a.xy), mul(a.zw, a.zw));
}

vec4 dcSet(vec2 a) {
  return vec4(a.x, 0.0, a.y, 0.0);
}

vec4 dcSet(vec2 a, vec2 ad) {
  return vec4(a.x, ad.x, a.y, ad.y);
}

// Multiply double-complex with double
vec4 dcMul(vec4 a, vec2 b) {
  return vec4(mul(a.xy,b),mul(a.wz,b));
}

vec3 inigoColor(vec2 coord, int iterations, int j, vec4 dZ) {
  if (j < iterations) {
    float dotZZ = dZ.x*dZ.x+dZ.z*dZ.z; // extract high part
    // float falloff = exp(-dot(coord,coord)/(1.0+0.2*rand(coord)));
    float falloff = .996 + 0.06 * rand(coord + dZ.zx);
    float R = (sin(6.2831*hue) + 1.0)/2.0;
    float G = (sin(6.2831*(hue+1.5708)) + 1.0)/2.0;
    float B = (cos(6.2831*hue) + 1.0)/2.0;
    // The color scheme here is based on one
    // from the Mandelbrot in Inigo Quilez's Shader Toy:
    float co = float(j) + 1.0 - log2(.5*log2(dotZZ));
    co = sqrt(max(0.,co)/256.0);
    // return falloff*vec3(.5+.5*cos(6.2831*co+R),.5+.5*cos(6.2831*co + G),.5+.5*cos(6.2831*co +B));
    return vec3(.5+.5*cos(6.2831*co+R),.5+.5*cos(6.2831*co + G),.5+.5*cos(6.2831*co +B));
  }  else {
    // Inside
    return vec3(0.05,0.01,0.02);
  }
}

vec3 varyRGB(vec2 coord, int iterations, int j, vec4 dZ) {
  float falloff = .996 + 0.06 * rand(coord + dZ.zx);
  
  if (j < iterations) {
    float dotZZ = dZ.x*dZ.x+dZ.z*dZ.z;
    float co = float(j) + 1.0 - log2(.5 * log2(dotZZ));
    co = sqrt(max(0.0, co) / 256.0) * huestep;
    return falloff*vec3(
      (sin(6.2832*co + hue         ) + 1.0)/2.0,
      (sin(6.2832*co*1.1 + hue + 1.5708) + 1.0)/2.0,
      (sin(6.2832*co*1.2 + hue + 4.7124) + 1.0)/2.0
    );
  } else {
    return falloff*vec3(0.05, 0.1, 0.25);
  }
}

vec3 varyHue(vec2 coord, int iterations, int j, vec4 dZ) {
  float falloff = .996 + 0.06 * rand(coord + dZ.zx);
  vec3 hsv = vec3(hue, 0.25, 0.1);

  if (j < iterations) {
    float dotZZ = dZ.x*dZ.x+dZ.z*dZ.z;
    float co = float(j) + 1.0 - log2(.5 * log2(dotZZ));
    co = sqrt(max(0.0, co) / 256.0) * huestep;

    hsv = vec3(
      // mod(hue + 1.0 + sin(6.2831*co)/2.0, 1.0),
      mod(hue + 1.0 + sin(6.2831*co)/2.0, 1.0),
      // .25 + .6*(sin(6.2831*co*1.1) + 1.0)/2.0,
      .25 + .6*(sin(6.2831*co) + 1.0)/2.0,
      .1 + .85*(sin(6.2831*co*1.2) + 1.0)/2.0
      // .1 + .85*cos(3.142*co)
    );
  }

  // Magical HSV â RGB conversion
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(hsv.xxx + K.xyz) * 6.0 - K.www);
    return falloff*(hsv.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), hsv.y));
}

vec3 mandelbrotIterateToColor(vec2 coord) {
  coord.y *= aspect;

  vec4 c = dcAdd(
    dcMul(dcSet(coord), vec2(zoom, 0.0)),
    dcSet(center, centerD)
  );

  vec4 dZ = dcSet(vec2(0.0, 0.0));
  vec4 add = c;
  int j = iterations;

  for (int i = 0; i <= iterations; i++) {
    if (cmp(dcLength(dZ), set(4.0)) > 0.0) {
      break;
    }

    dZ = dcAdd(dcMul(dZ, dZ), add);
    j = i;
  }

  return varyHue(coord, iterations, j, dZ);
  // return varyRGB(coord, iterations, j, dZ);
  // return pow((inigoColor(coord, iterations, j, dZ)).bgr, vec3(1./2.2));
}

vec3 ducksIterateToColor(vec2 coord) {
  coord.y *= aspect;
  vec2 c = center + coord * zoom;
  vec2 z = vec2(0.0, 0.0);
  
  for (int i = 0; i <= iterations; i++) {
    if (z.y > 0.0) {
      z.y = -z.y;
    }
    
    z.x = z.x + c.x;
    z.y = z.y + c.y;
    z = log(z);
  }
  
  float co = length(z);
  co = co / .5;
  // vec3 hsv = vec3(0.0, 0.0, co);
  vec3 hsv = vec3(
    mod(hue + 1.0 + sin(6.2831*co)/2.0, 1.0),
    .25 + .6*(sin(6.2831*co) + 1.0)/2.0,
    .1 + .85*(sin(6.2831*co*1.2) + 1.0)/2.0
  );

  // Magical HSV â RGB conversion
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(hsv.xxx + K.xyz) * 6.0 - K.www);
  float falloff = .996 + 0.06 * rand(coord.yx);
  return falloff*(hsv.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), hsv.y));  
}

vec3 juliaIterateToColor(vec2 coord) {
  vec4 dZ = dcMul(dcSet(coord), vec2(zoom, 0.0));

  vec4 c = dcSet(vec2(center.x, center.y*aspect), vec2(centerD.x, centerD.y*aspect));
  vec4 add = c;
  int j = iterations;

  for (int i = 0; i <= iterations; i++) {
    if (cmp(dcLength(dZ), set(4.0)) > 0.0) {
      break;
    }

    dZ = dcAdd(dcMul(dZ, dZ), add);
    j = i;
  }

  return varyHue(coord, iterations, j, dZ);
  // return varyRGB(coord, iterations, j, dZ);
  // return pow((inigoColor(coord, iterations, j, dZ)).bgr, vec3(1./2.2));
}

void main(void) {
  // if (texCoord.y < -0.48 || texCoord.y > 0.48) {
    // fragmentColor = vec4(0.0, 0.0, 0.0, 1.0);
  // } else {
    fragmentColor = vec4(mandelbrotIterateToColor(texCoord), 1.0);
  // }
}