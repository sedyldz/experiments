// GLSL for the pixel pipeline. See PixelPipeline.tsx for how the passes chain.

export const MAX_PALETTE = 96;
export const MAX_RAMPS = 32;

export const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Normal pass. It writes the view-space normal to rgb and a surface tag to
// alpha: (rampId * 2 + ditherBit) / 255. It uses the stock chunks, so instanced meshes work too.
export const normalVertex = /* glsl */ `
  #include <common>
  varying vec3 vViewNormal;
  void main() {
    #include <beginnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <project_vertex>
    vViewNormal = normalize(transformedNormal);
  }
`;

export const normalFragment = /* glsl */ `
  uniform float tag;
  varying vec3 vViewNormal;
  void main() {
    vec3 n = normalize(vViewNormal);
    if (!gl_FrontFacing) n = -n;
    gl_FragColor = vec4(n * 0.5 + 0.5, tag);
  }
`;

// Composite pass. It runs at low res and outputs the final sRGB pixel values.
export const compositeFragment = /* glsl */ `
  #define MAX_PALETTE ${MAX_PALETTE}
  #define MAX_RAMPS ${MAX_RAMPS}

  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform vec2 resolution;
  uniform float cameraNear;
  uniform float cameraFar;

  uniform bool outlineOn;
  uniform bool ditherOn;
  uniform bool quantizeOn;

  uniform float depthThreshold;
  uniform float normalThreshold;
  uniform float silhouetteStrength;
  uniform float creaseDarken;
  uniform float ditherStrength;
  uniform float halftoneDarken;
  uniform vec3 inkColor;

  uniform vec3 paletteLab[MAX_PALETTE];
  uniform vec3 paletteRgb[MAX_PALETTE];
  uniform int paletteSize;
  uniform int rampStart[MAX_RAMPS];
  uniform int rampLength[MAX_RAMPS];

  varying vec2 vUv;

  // Orthographic depth is linear, so this is the view distance in meters.
  float depthAt(vec2 px) {
    float d = texture2D(tDepth, px / resolution).x;
    return cameraNear + d * (cameraFar - cameraNear);
  }

  vec3 normalAt(vec2 px) {
    return texture2D(tNormal, px / resolution).xyz * 2.0 - 1.0;
  }

  vec3 linearToSrgb(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  vec3 linearToOklab(vec3 c) {
    float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
    l = pow(max(l, 0.0), 1.0 / 3.0);
    m = pow(max(m, 0.0), 1.0 / 3.0);
    s = pow(max(s, 0.0), 1.0 / 3.0);
    return vec3(
      0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    );
  }

  float bayer2(vec2 a) {
    a = floor(a);
    return fract(a.x / 2.0 + a.y * a.y * 0.75);
  }
  float bayer4(vec2 a) {
    return bayer2(0.5 * a) * 0.25 + bayer2(a);
  }

  // Nearest color in the whole palette (OKLab distance).
  vec3 quantizeGlobal(vec3 lab) {
    float best = 1e9;
    vec3 outColor = vec3(0.0);
    for (int i = 0; i < MAX_PALETTE; i++) {
      if (i >= paletteSize) break;
      vec3 d = lab - paletteLab[i];
      float dist = dot(d, d);
      if (dist < best) {
        best = dist;
        outColor = paletteRgb[i];
      }
    }
    return outColor;
  }

  // Nearest shade within one ramp, by lightness. Light tint can't push a
  // surface into a neighboring color family. Lighting only picks the step.
  vec3 quantizeRamp(vec3 lab, int ramp) {
    int start = rampStart[ramp];
    int len = rampLength[ramp];
    float best = 1e9;
    vec3 outColor = vec3(0.0);
    for (int i = 0; i < 16; i++) {
      if (i >= len) break;
      float dist = abs(lab.x - paletteLab[start + i].x);
      if (dist < best) {
        best = dist;
        outColor = paletteRgb[start + i];
      }
    }
    return outColor;
  }

  // rampId 0 means "no ramp": snap to the global palette.
  vec3 quantize(vec3 srgb, int rampId) {
    vec3 lab = linearToOklab(srgbToLinear(clamp(srgb, 0.0, 1.0)));
    return rampId > 0 ? quantizeRamp(lab, rampId - 1) : quantizeGlobal(lab);
  }

  // A crease edge against one neighbor. It only fires on one side of the
  // crease (the bias dot product), which keeps the line exactly 1px thick.
  float creaseAgainst(vec3 n, float d, vec2 px) {
    vec3 nn = normalAt(px);
    float nd = depthAt(px);
    float notInFront = step(-0.05, nd - d);
    float side = step(0.0, dot(n - nn, vec3(1.0, 1.0, 1.0)));
    return (1.0 - dot(n, nn)) * notInFront * side;
  }

  void main() {
    vec2 px = gl_FragCoord.xy;
    vec4 normalSample = texture2D(tNormal, px / resolution);
    vec3 color = linearToSrgb(texture2D(tColor, px / resolution).rgb);
    float d = depthAt(px);
    bool isBackground = d >= cameraFar - 0.001;
    int tag = int(normalSample.a * 255.0 + 0.5);
    int rampId = tag / 2;
    bool ditherMe = tag - rampId * 2 == 1;

    if (ditherOn && ditherMe) {
      // Ordered dither smooths any lighting gradient into shade steps, and a
      // sparse halftone dot lattice (1 pixel in 16, one shade darker) gives
      // flat walls and floor a printed texture.
      float b = bayer4(px);
      color += (b - 0.5) * ditherStrength;
      if (b < 0.0625) color *= halftoneDarken;
    }

    if (outlineOn && !isBackground) {
      // Silhouette: a neighbor lies well behind this pixel, so this pixel is
      // the object's outermost pixel. The outline sits on the object side.
      float dl = depthAt(px + vec2(-1.0, 0.0));
      float dr = depthAt(px + vec2(1.0, 0.0));
      float dd = depthAt(px + vec2(0.0, -1.0));
      float du = depthAt(px + vec2(0.0, 1.0));
      float maxBehind = max(max(dl - d, dr - d), max(dd - d, du - d));

      if (maxBehind > depthThreshold) {
        color = mix(color, inkColor, silhouetteStrength);
        rampId = 0;
      } else {
        vec3 n = normalSample.xyz * 2.0 - 1.0;
        float crease = max(
          max(creaseAgainst(n, d, px + vec2(-1.0, 0.0)), creaseAgainst(n, d, px + vec2(1.0, 0.0))),
          max(creaseAgainst(n, d, px + vec2(0.0, -1.0)), creaseAgainst(n, d, px + vec2(0.0, 1.0)))
        );
        if (crease > normalThreshold) color *= creaseDarken;
      }
    }

    if (quantizeOn) color = quantize(color, rampId);
    gl_FragColor = vec4(color, 1.0);
  }
`;

// Blit. It copies the low-res result as-is. The texture uses NearestFilter
// and the viewport is an exact integer multiple, so every pixel lands whole.
export const blitFragment = /* glsl */ `
  uniform sampler2D tFinal;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tFinal, vUv);
  }
`;
