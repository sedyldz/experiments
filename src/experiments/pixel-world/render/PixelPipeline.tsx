import { useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { renderConfig } from "./config";
import {
  MAX_PALETTE,
  MAX_RAMPS,
  blitFragment,
  compositeFragment,
  fullscreenVertex,
  cutoutNormalFragment,
  cutoutNormalVertex,
  normalFragment,
  normalVertex,
} from "./shaders";
import { base, rampTable } from "../palette";
import { useViewStore } from "../ui/viewStore";

/**
 * Per-object flags the pipeline reads from `object.userData.pixel`. The
 * palette ramp comes from `material.userData.rampId` (see world/materials.ts).
 * - `dither`: this surface gets the Bayer dither (walls, floor).
 * - `skipNormal`: leave it out of the normal pass (glows, overlays). It then
 *   draws no outline or crease.
 */
export interface PixelUserData {
  dither?: boolean;
  skipNormal?: boolean;
}

// One pixel of margin on every side, so the sub-pixel blit offset never
// uncovers the edge of the canvas.
const BORDER = 1;

function hexToSrgb(hex: string): THREE.Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(
    ((n >> 16) & 255) / 255,
    ((n >> 8) & 255) / 255,
    (n & 255) / 255,
  );
}

function srgbToOklab(c: THREE.Vector3): THREE.Vector3 {
  const lin = (v: number) =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const r = lin(c.x);
  const g = lin(c.y);
  const b = lin(c.z);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return new THREE.Vector3(
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  );
}

function makeTarget(opts: THREE.RenderTargetOptions) {
  return new THREE.WebGLRenderTarget(1, 1, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    ...opts,
  });
}

/** Normal-pass materials, one per (ramp, dither) tag. */
class NormalMaterials {
  private byTag = new Map<number, THREE.ShaderMaterial>();

  get(rampId: number, dither: boolean): THREE.ShaderMaterial {
    const tag = rampId * 2 + (dither ? 1 : 0);
    let m = this.byTag.get(tag);
    if (!m) {
      m = new THREE.ShaderMaterial({
        vertexShader: normalVertex,
        fragmentShader: normalFragment,
        uniforms: { tag: { value: tag / 255 } },
        side: THREE.DoubleSide,
      });
      this.byTag.set(tag, m);
    }
    return m;
  }

  private byMap = new Map<string, THREE.ShaderMaterial>();

  /** A cutout variant that keeps the source material's alpha-tested silhouette. */
  cutout(rampId: number, source: THREE.Material & { map: THREE.Texture }): THREE.ShaderMaterial {
    const map = source.map;
    let m = this.byMap.get(map.uuid);
    if (!m) {
      m = new THREE.ShaderMaterial({
        vertexShader: cutoutNormalVertex,
        fragmentShader: cutoutNormalFragment,
        uniforms: {
          tag: { value: (rampId * 2) / 255 },
          map: { value: map },
          alphaTest: { value: source.alphaTest },
          uvTransform: { value: new THREE.Matrix3() },
        },
        side: THREE.DoubleSide,
      });
      this.byMap.set(map.uuid, m);
    }
    map.updateMatrix();
    m.uniforms.uvTransform.value.copy(map.matrix);
    return m;
  }

  dispose() {
    for (const m of this.byTag.values()) m.dispose();
    for (const m of this.byMap.values()) m.dispose();
    this.byTag.clear();
    this.byMap.clear();
  }
}

/**
 * Takes over R3F's render loop:
 *   color pass -> normal pass -> composite (outline, dither, quantize) -> blit.
 * All the passes except the blit run at low res. The blit is an exact
 * integer upscale.
 */
export function PixelPipeline() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const viewCamera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const size = useThree((s) => s.size);
  const pixelScale = useViewStore((s) => s.pixelScale);

  const res = useMemo(() => {
    const colorRT = makeTarget({ type: THREE.HalfFloatType });
    colorRT.depthTexture = new THREE.DepthTexture(1, 1);
    colorRT.depthTexture.type = THREE.UnsignedIntType;
    colorRT.depthTexture.minFilter = THREE.NearestFilter;
    colorRT.depthTexture.magFilter = THREE.NearestFilter;

    const normalRT = makeTarget({ type: THREE.UnsignedByteType });
    const finalRT = makeTarget({
      type: THREE.UnsignedByteType,
      depthBuffer: false,
    });

    const { colors, ramps } = rampTable();
    if (colors.length > MAX_PALETTE || ramps.length > MAX_RAMPS) {
      console.warn(
        `palette.ts has ${colors.length} colors in ${ramps.length} ramps; ` +
          `the pipeline supports ${MAX_PALETTE} colors / ${MAX_RAMPS} ramps`,
      );
    }
    const rampStart = new Int32Array(MAX_RAMPS);
    const rampLength = new Int32Array(MAX_RAMPS);
    ramps.slice(0, MAX_RAMPS).forEach((r, i) => {
      rampStart[i] = r.start;
      rampLength[i] = Math.min(r.length, 16);
    });
    const paletteRgb = Array.from({ length: MAX_PALETTE }, (_, i) =>
      hexToSrgb(colors[Math.min(i, colors.length - 1)]),
    );
    const paletteLab = paletteRgb.map(srgbToOklab);

    const compositeMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: compositeFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: colorRT.texture },
        tDepth: { value: colorRT.depthTexture },
        tNormal: { value: normalRT.texture },
        resolution: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: renderConfig.near },
        cameraFar: { value: renderConfig.far },
        outlineOn: { value: true },
        ditherOn: { value: true },
        quantizeOn: { value: true },
        depthThreshold: { value: renderConfig.outline.depthThreshold },
        normalThreshold: { value: renderConfig.outline.normalThreshold },
        silhouetteStrength: { value: renderConfig.outline.silhouetteStrength },
        creaseDarken: { value: renderConfig.outline.creaseDarken },
        ditherStrength: { value: renderConfig.dither.strength },
        halftoneDarken: { value: renderConfig.dither.halftoneDarken },
        inkColor: { value: hexToSrgb(base("ink")) },
        paletteLab: { value: paletteLab },
        paletteRgb: { value: paletteRgb },
        paletteSize: { value: Math.min(colors.length, MAX_PALETTE) },
        rampStart: { value: rampStart },
        rampLength: { value: rampLength },
      },
    });
    const blitMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: blitFragment,
      depthTest: false,
      depthWrite: false,
      uniforms: { tFinal: { value: finalRT.texture } },
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMat);
    quad.frustumCulled = false;
    const quadScene = new THREE.Scene();
    quadScene.add(quad);
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const renderCamera = new THREE.OrthographicCamera();

    return {
      colorRT,
      normalRT,
      finalRT,
      compositeMat,
      blitMat,
      quad,
      quadScene,
      quadCamera,
      renderCamera,
      normalMaterials: new NormalMaterials(),
      background: new THREE.Color(base("background")),
      lowW: 1,
      lowH: 1,
      swapped: [] as [THREE.Mesh, THREE.Material | THREE.Material[]][],
      hidden: [] as THREE.Object3D[],
    };
  }, []);

  useEffect(
    () => () => {
      res.colorRT.depthTexture?.dispose();
      res.colorRT.dispose();
      res.normalRT.dispose();
      res.finalRT.dispose();
      res.compositeMat.dispose();
      res.blitMat.dispose();
      res.normalMaterials.dispose();
      res.quad.geometry.dispose();
    },
    [res],
  );

  // The low-res buffer covers the canvas at the current integer scale, plus
  // the border.
  useEffect(() => {
    if (pixelScale === null) return;
    const w = Math.ceil(size.width / pixelScale) + 2 * BORDER;
    const h = Math.ceil(size.height / pixelScale) + 2 * BORDER;
    res.lowW = w;
    res.lowH = h;
    res.colorRT.setSize(w, h);
    res.normalRT.setSize(w, h);
    res.finalRT.setSize(w, h);
    res.compositeMat.uniforms.resolution.value.set(w, h);
  }, [res, size.width, size.height, pixelScale]);

  const right = useMemo(() => new THREE.Vector3(), []);
  const up = useMemo(() => new THREE.Vector3(), []);
  const fwd = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const view = useViewStore.getState();
    const s = view.pixelScale;
    if (s === null) return;
    const ppm = renderConfig.pixelsPerMeter;
    const { lowW, lowH, renderCamera: cam } = res;

    // Pixel-snap the render camera: move it in its own image plane so that
    // world space lands on the same low-res pixel grid every frame. Static
    // geometry then rasterizes identically while panning, so nothing
    // shimmers.
    viewCamera.matrixWorld.extractBasis(right, up, fwd);
    const pos = viewCamera.position;
    const u = pos.dot(right);
    const v = pos.dot(up);
    const w = pos.dot(fwd);
    const su = Math.round(u * ppm) / ppm;
    const sv = Math.round(v * ppm) / ppm;
    cam.position
      .copy(right)
      .multiplyScalar(su)
      .addScaledVector(up, sv)
      .addScaledVector(fwd, w);
    cam.quaternion.copy(viewCamera.quaternion);
    cam.left = -lowW / 2 / ppm;
    cam.right = lowW / 2 / ppm;
    cam.top = lowH / 2 / ppm;
    cam.bottom = -lowH / 2 / ppm;
    cam.near = renderConfig.near;
    cam.far = renderConfig.far;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    const prevAutoClear = gl.autoClear;
    gl.autoClear = true;

    // 1. Color + depth.
    gl.setRenderTarget(res.colorRT);
    gl.setClearColor(res.background, 1);
    gl.render(scene, cam);

    // 2. Normals + surface tag (ramp id, dither bit). Shadow maps from pass 1 are reused.
    const { swapped, hidden } = res;
    scene.traverseVisible((obj) => {
      const flags = obj.userData.pixel as PixelUserData | undefined;
      // Lines, points and sprites can't take the normal material, so they
      // sit out the normal pass along with anything flagged skipNormal.
      const other = obj as THREE.Line & THREE.Points & THREE.Sprite;
      if (flags?.skipNormal || other.isLine || other.isPoints || other.isSprite) {
        hidden.push(obj);
        return;
      }
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        swapped.push([mesh, mesh.material]);
        const mat = mesh.material as THREE.Material & { map?: THREE.Texture | null };
        const rampId = (mat.userData?.rampId as number | undefined) ?? 0;
        mesh.material =
          mat.map && mat.alphaTest > 0
            ? res.normalMaterials.cutout(rampId, mat as THREE.Material & { map: THREE.Texture })
            : res.normalMaterials.get(rampId, !!flags?.dither);
      }
    });
    for (const obj of hidden) obj.visible = false;
    const prevShadowAuto = gl.shadowMap.autoUpdate;
    gl.shadowMap.autoUpdate = false;
    gl.setRenderTarget(res.normalRT);
    gl.setClearColor(0x8080ff, 0);
    gl.render(scene, cam);
    gl.shadowMap.autoUpdate = prevShadowAuto;
    for (const [mesh, mat] of swapped) mesh.material = mat;
    for (const obj of hidden) obj.visible = true;
    swapped.length = 0;
    hidden.length = 0;

    // 3. Composite at low res.
    const u2 = res.compositeMat.uniforms;
    u2.outlineOn.value = view.outline;
    u2.ditherOn.value = view.dither;
    u2.quantizeOn.value = view.quantize;
    res.quad.material = res.compositeMat;
    gl.setRenderTarget(res.finalRT);
    gl.render(res.quadScene, res.quadCamera);

    // 4. Integer blit. The snapped camera sits (su - u, sv - v) meters away
    // from the true one, so the image shifts by that many screen pixels,
    // rounded to whole device pixels. This keeps panning smooth while every
    // low-res pixel stays a crisp s x s block.
    const x0 = Math.round(
      size.width / 2 + (su - u) * ppm * s - (lowW * s) / 2,
    );
    const y0 = Math.round(
      size.height / 2 + (sv - v) * ppm * s - (lowH * s) / 2,
    );
    res.quad.material = res.blitMat;
    gl.setRenderTarget(null);
    gl.setViewport(x0, y0, lowW * s, lowH * s);
    gl.render(res.quadScene, res.quadCamera);
    gl.setViewport(0, 0, size.width, size.height);

    gl.autoClear = prevAutoClear;
  }, 1);

  return null;
}
