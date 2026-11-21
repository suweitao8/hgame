import * as THREE from 'three';

async function loadLinearWebpTexture(url, { wrapRepeat = true } = {}) {
  const blob = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} loading ${url}`);
    return r.blob();
  });
  const bmp = await createImageBitmap(blob);
  const tex = new THREE.Texture(bmp);
  tex.wrapS = wrapRepeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = wrapRepeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

async function loadSrgbWebpTexture(url) {
  const blob = await fetch(url).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} loading ${url}`);
    return r.blob();
  });
  const bmp = await createImageBitmap(blob);
  const tex = new THREE.Texture(bmp);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export async function createWaterSurface({
  width = 8,
  depth = 6,
  position = [0, 1.85, 0],
  waterNormalUrl = '/assets/vfx/water_normal.webp',
  sunDir = new THREE.Vector3(0.55, 0.72, 0.42).normalize(),
} = {}) {
  const normalTex = await loadLinearWebpTexture(waterNormalUrl, { wrapRepeat: true });
  const timeUniform = { value: 0 };
  const sunUniform = { value: sunDir.clone() };

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uWaterNormal: { value: normalTex },
      uTime: timeUniform,
      uSunDir: sunUniform,
      uDeepColor: { value: new THREE.Color(0x093b47) },
      uShallowColor: { value: new THREE.Color(0x1f6d78) },
      uSkyTop: { value: new THREE.Color(0x4b7fc2) },
      uSkyHorizon: { value: new THREE.Color(0xbfd9ec) },
    },
    vertexShader: `
varying vec3 vWorldPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`,
    fragmentShader: `
uniform sampler2D uWaterNormal;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
varying vec3 vWorldPos;

void main() {
  vec2 uv1 = vWorldPos.xz * 0.18 + uTime * vec2(0.03, 0.02);
  vec2 uv2 = vWorldPos.xz * 0.27 - uTime * vec2(0.02, 0.035);
  vec3 n1 = texture2D(uWaterNormal, uv1).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uWaterNormal, uv2).xyz * 2.0 - 1.0;
  // Whiteout normal blending in Y-up world space (normal map XY -> XZ perturbation)
  vec3 wn = normalize(vec3((n1.x + n2.x) * 0.55, 1.0, (n1.y + n2.y) * 0.55));
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndv = clamp(dot(wn, V), 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

  vec3 R = reflect(-V, wn);
  float skyT = clamp(R.y * 0.8 + 0.2, 0.0, 1.0);
  vec3 envCol = mix(uSkyHorizon, uSkyTop, skyT);

  vec3 H = normalize(normalize(uSunDir) + V);
  float spec = pow(max(dot(wn, H), 0.0), 160.0) * 1.45;
  float diff = clamp(dot(wn, normalize(uSunDir)) * 0.35 + 0.65, 0.35, 1.0);

  vec3 bodyCol = mix(uShallowColor, uDeepColor, clamp(ndv, 0.0, 1.0)) * diff;
  vec3 col = mix(bodyCol, envCol, clamp(fresnel * 0.9, 0.06, 0.88)) + vec3(1.0, 0.96, 0.86) * spec;
  float alpha = clamp(0.46 + fresnel * 0.45 + min(0.3, spec * 0.2), 0.46, 0.92);
  gl_FragColor = vec4(col, alpha);
}`,
  });

  const geo = new THREE.PlaneGeometry(width, depth, 1, 1);
  geo.rotateX(-Math.PI * 0.5);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(position[0], position[1], position[2]);
  mesh.name = 'water_surface';
  mesh.renderOrder = 2;

  return {
    mesh,
    update(elapsedSec) {
      timeUniform.value = elapsedSec;
    },
    setSunDir(dir) {
      sunUniform.value.copy(dir).normalize();
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      normalTex.dispose();
    },
  };
}

export async function createBreakDecalOverlay({ breakStagesUrl = '/assets/vfx/break_stages.webp' } = {}) {
  const tex = await loadSrgbWebpTexture(breakStagesUrl);
  tex.repeat.set(1 / 8, 1);
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const geo = new THREE.BoxGeometry(1.008, 1.008, 1.008);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'block_break_decal';
  mesh.renderOrder = 3;

  return {
    mesh,
    setStage(stageIndex) {
      const clamped = Math.max(0, Math.min(7, Math.floor(stageIndex)));
      tex.offset.x = clamped / 8;
    },
    setBlockPos(x, y, z) {
      mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}

export async function createVfxBillboardPool({
  flipbookUrl = '/assets/vfx/vfx_flipbook.webp',
  maxParticles = 96,
} = {}) {
  const tex = await loadSrgbWebpTexture(flipbookUrl);
  const quad = new THREE.PlaneGeometry(1, 1);
  const uvOffsetAttr = new THREE.InstancedBufferAttribute(new Float32Array(maxParticles * 2), 2);
  const colorAlphaAttr = new THREE.InstancedBufferAttribute(new Float32Array(maxParticles * 4), 4);
  quad.setAttribute('aVfxUvOffset', uvOffsetAttr);
  quad.setAttribute('aVfxColorAlpha', colorAlphaAttr);

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uFlipbook: { value: tex },
    },
    vertexShader: `
attribute vec2 aVfxUvOffset;
attribute vec4 aVfxColorAlpha;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vUv = uv * 0.25 + aVfxUvOffset;
  vCol = aVfxColorAlpha;
  // Extract billboard world center + uniform scale from instanceMatrix
  vec4 wp = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float scale = length(vec3(instanceMatrix[0][0], instanceMatrix[1][0], instanceMatrix[2][0]));
  vec4 mvPos = viewMatrix * wp;
  mvPos.xy += position.xy * scale;
  gl_Position = projectionMatrix * mvPos;
}`,
    fragmentShader: `
uniform sampler2D uFlipbook;
varying vec2 vUv;
varying vec4 vCol;
void main() {
  vec4 t = texture2D(uFlipbook, vUv);
  float a = t.a * vCol.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(t.rgb * vCol.rgb, a);
}`,
  });

  const inst = new THREE.InstancedMesh(quad, mat, maxParticles);
  inst.name = 'vfx_billboard_pool';
  inst.frustumCulled = false;
  inst.renderOrder = 4;
  inst.count = 0;

  const dummy = new THREE.Object3D();
  const particles = [];

  return {
    mesh: inst,
    setEmitters(emitters) {
      particles.length = 0;
      for (const e of emitters) particles.push(e);
    },
    update(elapsedSec) {
      let n = 0;
      for (const p of particles) {
        if (n >= maxParticles) break;
        const life = ((elapsedSec * (p.speed ?? 1.0) + (p.phase ?? 0)) % 1 + 1) % 1;
        const px = p.pos[0] + Math.sin(elapsedSec * 2.1 + (p.phase ?? 0) * 6.2) * (p.drift ?? 0.06) * life;
        const py = p.pos[1] + life * (p.rise ?? 0.85);
        const pz = p.pos[2] + Math.cos(elapsedSec * 1.9 + (p.phase ?? 0) * 5.3) * (p.drift ?? 0.06) * life;
        const sc = (p.size ?? 0.35) * (p.grow ? (0.7 + life * 0.9) : (1.0 - life * 0.45));
        dummy.position.set(px, py, pz);
        dummy.scale.set(sc, sc, sc);
        dummy.updateMatrix();
        inst.setMatrixAt(n, dummy.matrix);

        const col = Math.floor(life * 4) % 4;
        const row = p.row ?? 0; // 0=fire, 1=smoke, 2=spark, 3=glow
        uvOffsetAttr.setXY(n, col * 0.25, (3 - row) * 0.25);
        const fade = Math.sin(life * Math.PI);
        const rgb = p.color ?? [1, 1, 1];
        colorAlphaAttr.setXYZW(n, rgb[0], rgb[1], rgb[2], fade * (p.alpha ?? 0.9));
        n++;
      }
      inst.count = n;
      inst.instanceMatrix.needsUpdate = true;
      uvOffsetAttr.needsUpdate = true;
      colorAlphaAttr.needsUpdate = true;
    },
    dispose() {
      quad.dispose();
      mat.dispose();
      tex.dispose();
    },
  };
}
