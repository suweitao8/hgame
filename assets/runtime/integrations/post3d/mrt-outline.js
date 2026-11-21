/**
 * Lightweight WebGL2 MRT screen-space Sobel contour outline pass (`Color + Normal/ID`
 * render target with zero extra geometry draw calls) and GLSL3 shader source.
 */

export const MRT_OUTLINE_FRAGMENT_GLSL3 = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tNormalId;
uniform vec2 uTexelSize;
uniform vec3 uOutlineColor;
uniform float uOutlineThickness;
uniform float uOutlineThreshold;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

void main() {
  vec4 base = texture(tColor, vUv);
  vec2 stepUv = uTexelSize * max(0.5, uOutlineThickness);

  vec4 nTL = texture(tNormalId, vUv + vec2(-stepUv.x,  stepUv.y));
  vec4 nTR = texture(tNormalId, vUv + vec2( stepUv.x,  stepUv.y));
  vec4 nBL = texture(tNormalId, vUv + vec2(-stepUv.x, -stepUv.y));
  vec4 nBR = texture(tNormalId, vUv + vec2( stepUv.x, -stepUv.y));

  vec3 gx = (nTR.rgb + nBR.rgb) - (nTL.rgb + nBL.rgb);
  vec3 gy = (nTL.rgb + nTR.rgb) - (nBL.rgb + nBR.rgb);
  float normalEdge = length(gx) + length(gy);
  float idEdge = abs(nTR.a - nBL.a) + abs(nTL.a - nBR.a);
  float edge = clamp(smoothstep(uOutlineThreshold, uOutlineThreshold + 0.35, normalEdge + idEdge * 4.0), 0.0, 1.0);

  fragColor = vec4(mix(base.rgb, uOutlineColor, edge * 0.88), base.a);
}
`;

function hexOrRgbToTuple(c) {
  if (typeof c === 'number') {
    return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  }
  if (Array.isArray(c) && c.length >= 3) {
    return [Number(c[0]) || 0, Number(c[1]) || 0, Number(c[2]) || 0];
  }
  return [0.06, 0.09, 0.16];
}

/**
 * Create a 2-attachment (`Color + Normal/ID`) WebGL2 MRT render target & fullscreen Sobel
 * outline composite shader pass.
 * @param {any} [THREE=null]
 * @param {{ width?: number, height?: number, outlineColor?: number | number[], thickness?: number, threshold?: number }} [options]
 */
export function createMrtOutlinePass3D(THREE = null, {
  width = 390,
  height = 844,
  outlineColor = 0x0f172a,
  thickness = 1.25,
  threshold = 0.22,
} = {}) {
  let w = Math.max(1, Math.floor(Number(width) || 390));
  let h = Math.max(1, Math.floor(Number(height) || 844));
  const [cr, cg, cb] = hexOrRgbToTuple(outlineColor);

  const mrtTarget = THREE?.WebGLRenderTarget
    ? new THREE.WebGLRenderTarget(w, h, {
        count: 2,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
      })
    : null;

  const uniforms = {
    tColor: { value: mrtTarget?.textures?.[0] ?? null },
    tNormalId: { value: mrtTarget?.textures?.[1] ?? null },
    uTexelSize: { value: THREE?.Vector2 ? new THREE.Vector2(1 / w, 1 / h) : { x: 1 / w, y: 1 / h } },
    uOutlineColor: { value: THREE?.Vector3 ? new THREE.Vector3(cr, cg, cb) : { x: cr, y: cg, z: cb } },
    uOutlineThickness: { value: Number(thickness) || 1.25 },
    uOutlineThreshold: { value: Number(threshold) || 0.22 },
  };

  const MatCtor = THREE?.RawShaderMaterial || THREE?.ShaderMaterial;
  const fragSrc = THREE?.RawShaderMaterial
    ? `precision highp float;\n${MRT_OUTLINE_FRAGMENT_GLSL3}`
    : MRT_OUTLINE_FRAGMENT_GLSL3;
  const vertSrc = THREE?.RawShaderMaterial
    ? 'precision highp float;\nin vec3 position;\nin vec2 uv;\nout vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = vec4(position.xy, 0.0, 1.0);\n}\n'
    : 'out vec2 vUv;\nvoid main() {\n  vUv = uv;\n  gl_Position = vec4(position.xy, 0.0, 1.0);\n}\n';
  const material = MatCtor
    ? new MatCtor({
        glslVersion: THREE.GLSL3,
        vertexShader: vertSrc,
        fragmentShader: fragSrc,
        uniforms,
        depthTest: false,
        depthWrite: false,
      })
    : null;

  /**
   * Update outline shader parameters dynamically.
   * @param {{ color?: number | number[], thickness?: number, threshold?: number }} [params]
   */
  function setOutline({ color, thickness: nextThick, threshold: nextThresh } = {}) {
    if (color !== undefined) {
      const [r, g, b] = hexOrRgbToTuple(color);
      if (uniforms.uOutlineColor.value?.set) uniforms.uOutlineColor.value.set(r, g, b);
      else uniforms.uOutlineColor.value = { x: r, y: g, z: b };
    }
    if (Number.isFinite(nextThick)) uniforms.uOutlineThickness.value = Math.max(0.25, nextThick);
    if (Number.isFinite(nextThresh)) uniforms.uOutlineThreshold.value = Math.max(0.01, nextThresh);
  }

  function resize(nextW, nextH) {
    w = Math.max(1, Math.floor(Number(nextW) || w));
    h = Math.max(1, Math.floor(Number(nextH) || h));
    mrtTarget?.setSize?.(w, h);
    if (uniforms.uTexelSize.value?.set) uniforms.uTexelSize.value.set(1 / w, 1 / h);
    else { uniforms.uTexelSize.value.x = 1 / w; uniforms.uTexelSize.value.y = 1 / h; }
  }

  let renderCount = 0;
  const quadScene = THREE?.Scene && THREE?.Mesh && THREE?.PlaneGeometry && material
    ? (() => {
        const s = new THREE.Scene();
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
        mesh.frustumCulled = false;
        s.add(mesh);
        return { scene: s, mesh };
      })()
    : null;
  const quadCam = THREE?.OrthographicCamera ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) : null;
  const gbufferMaterial = THREE?.ShaderMaterial
    ? new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: [
          'out vec3 vViewNormal;',
          'void main() {',
          '  vec3 n = normal;',
          '  vec4 mvPos = vec4(position, 1.0);',
          '  #ifdef USE_INSTANCING',
          '    mvPos = instanceMatrix * mvPos;',
          '    n = mat3(instanceMatrix) * n;',
          '  #endif',
          '  vViewNormal = normalize(normalMatrix * n);',
          '  gl_Position = projectionMatrix * modelViewMatrix * mvPos;',
          '}',
        ].join('\n'),
        fragmentShader: [
          'layout(location = 0) out vec4 gColor;',
          'layout(location = 1) out vec4 gNormalId;',
          'in vec3 vViewNormal;',
          'void main() {',
          '  vec3 encN = normalize(vViewNormal) * 0.5 + 0.5;',
          '  gColor = vec4(encN, 1.0);',
          '  gNormalId = vec4(encN, 1.0);',
          '}',
        ].join('\n'),
      })
    : null;

  /**
   * Render scene into the 2-attachment MRT target and composite Sobel edges to `outputTarget`.
   * @param {any} renderer
   * @param {any} scene
   * @param {any} camera
   * @param {any} [outputTarget=null]
   */
  function renderOutline(renderer, scene, camera, outputTarget = null) {
    if (!renderer || !scene || !camera || !mrtTarget || !quadScene || !quadCam) return false;
    const prevTarget = typeof renderer.getRenderTarget === 'function' ? renderer.getRenderTarget() : null;
    const hasOverrideProp = 'overrideMaterial' in scene;
    const prevOverride = scene.overrideMaterial ?? null;
    try {
      if (gbufferMaterial) scene.overrideMaterial = gbufferMaterial;
      renderer.setRenderTarget?.(mrtTarget);
      renderer.clear?.(true, true, false);
      renderer.render?.(scene, camera);

      if (hasOverrideProp) scene.overrideMaterial = prevOverride;
      else scene.overrideMaterial = null;

      uniforms.tColor.value = mrtTarget.textures?.[0] ?? mrtTarget.texture ?? null;
      uniforms.tNormalId.value = mrtTarget.textures?.[1] ?? mrtTarget.textures?.[0] ?? mrtTarget.texture ?? null;
      renderer.setRenderTarget?.(outputTarget ?? null);
      renderer.render?.(quadScene.scene, quadCam);
      renderCount++;
      return true;
    } finally {
      if (hasOverrideProp) scene.overrideMaterial = prevOverride;
      else scene.overrideMaterial = null;
      renderer.setRenderTarget?.(prevTarget ?? null);
    }
  }

  function getStats() {
    return Object.freeze({
      width: w,
      height: h,
      attachments: mrtTarget ? (mrtTarget.textures?.length ?? 2) : 2,
      thickness: uniforms.uOutlineThickness.value,
      threshold: uniforms.uOutlineThreshold.value,
      hasShaderMaterial: Boolean(material),
      renderCount,
    });
  }

  function dispose() {
    quadScene?.mesh?.geometry?.dispose?.();
    mrtTarget?.dispose?.();
    material?.dispose?.();
    gbufferMaterial?.dispose?.();
  }

  return Object.freeze({
    mrtTarget,
    material,
    uniforms,
    setOutline,
    resize,
    renderOutline,
    getStats,
    dispose,
  });
}
