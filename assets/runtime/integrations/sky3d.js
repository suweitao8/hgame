/**
 * Clean-room procedural atmospheric sky dome, PMREM environment IBL baker,
 * tight directional shadow frustum fitter, and pooled transient point lights.
 *
 * The Three.js namespace is injected by callers so non-3D projects load nothing.
 */

export const SKY3D_PRESETS = Object.freeze({
  day: Object.freeze({
    zenithColor: '#2c68b8',
    horizonColor: '#b7d4e8',
    groundColor: '#4c545a',
    sunColor: '#fff2d6',
    sunDirection: Object.freeze([0.46, 0.72, 0.52]),
    sunIntensity: 1.0,
    cloudCoverage: 0.42,
    cloudDensity: 0.55,
    cloudSpeed: 0.014,
    mieG: 0.78,
    mieStrength: 0.28,
    exposure: 1.05,
  }),
  goldenHour: Object.freeze({
    zenithColor: '#284574',
    horizonColor: '#ebb17f',
    groundColor: '#4c4138',
    sunColor: '#ffbe7a',
    sunDirection: Object.freeze([0.62, 0.24, 0.75]),
    sunIntensity: 1.15,
    cloudCoverage: 0.48,
    cloudDensity: 0.62,
    cloudSpeed: 0.012,
    mieG: 0.84,
    mieStrength: 0.45,
    exposure: 1.08,
  }),
  overcast: Object.freeze({
    zenithColor: '#697987',
    horizonColor: '#aeb9c2',
    groundColor: '#4b5156',
    sunColor: '#dfe5ea',
    sunDirection: Object.freeze([0.35, 0.82, 0.45]),
    sunIntensity: 0.45,
    cloudCoverage: 0.78,
    cloudDensity: 0.85,
    cloudSpeed: 0.018,
    mieG: 0.55,
    mieStrength: 0.12,
    exposure: 0.98,
  }),
  dusk: Object.freeze({
    zenithColor: '#172546',
    horizonColor: '#8d5d73',
    groundColor: '#262430',
    sunColor: '#ff8a63',
    sunDirection: Object.freeze([-0.55, 0.11, 0.83]),
    sunIntensity: 0.85,
    cloudCoverage: 0.36,
    cloudDensity: 0.5,
    cloudSpeed: 0.01,
    mieG: 0.86,
    mieStrength: 0.38,
    exposure: 0.95,
  }),
  night: Object.freeze({
    zenithColor: '#091020',
    horizonColor: '#1b2940',
    groundColor: '#12161e',
    sunColor: '#c9daf8',
    sunDirection: Object.freeze([-0.38, 0.58, -0.72]),
    sunIntensity: 0.32,
    cloudCoverage: 0.32,
    cloudDensity: 0.45,
    cloudSpeed: 0.008,
    mieG: 0.74,
    mieStrength: 0.16,
    exposure: 0.88,
  }),
});

const SKY_VERTEX_SHADER = `
varying vec3 vWorldDir;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldDir = position;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const SKY_FRAGMENT_SHADER = `
uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform vec3 uGroundColor;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform float uSunIntensity;
uniform float uCloudCoverage;
uniform float uCloudDensity;
uniform float uCloudSpeed;
uniform float uMieG;
uniform float uMieStrength;
uniform float uTime;
uniform float uExposure;
uniform float uEnvCapture;
uniform float uLinearOutput;

varying vec3 vWorldDir;

float skyHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float skyNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = skyHash(i);
  float b = skyHash(i + vec2(1.0, 0.0));
  float c = skyHash(i + vec2(0.0, 1.0));
  float d = skyHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float cloudFbm(vec2 p) {
  float value = 0.0;
  float amp = 0.52;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    value += amp * skyNoise(p);
    p = rot * p * 2.04 + vec2(13.7, 7.3);
    amp *= 0.5;
  }
  return value;
}

float henyeyGreenstein(float cosTheta, float g) {
  float g2 = g * g;
  float denom = max(0.001, 1.0 + g2 - 2.0 * g * cosTheta);
  return (1.0 - g2) / (4.0 * 3.14159265 * pow(denom, 1.5));
}

void main() {
  vec3 dir = normalize(vWorldDir);
  vec3 sunDir = normalize(uSunDirection);
  float elev = clamp(dir.y, -1.0, 1.0);
  float skyFactor = pow(clamp(elev, 0.0, 1.0), 0.58);
  vec3 skyCol = mix(uHorizonColor, uZenithColor, skyFactor);

  float horizonGlow = exp(-abs(elev) * 6.5);
  float sunAlign = dot(dir, sunDir);
  float warmTint = max(0.0, sunAlign * 0.5 + 0.5);
  skyCol += uSunColor * (horizonGlow * 0.14 * warmTint * uSunIntensity);

  float mie = henyeyGreenstein(sunAlign, clamp(uMieG, 0.1, 0.94));
  skyCol += uSunColor * (mie * uMieStrength * uSunIntensity * smoothstep(-0.15, 0.15, elev));

  float discEdge = smoothstep(0.9985, 0.9996, sunAlign);
  float discBoost = mix(5.5, 1.4, uEnvCapture) * uSunIntensity * smoothstep(-0.08, 0.06, elev);
  skyCol += uSunColor * (discEdge * discBoost);

  if (elev > 0.015 && uCloudCoverage > 0.001 && uCloudDensity > 0.001) {
    vec2 cloudUv = dir.xz / max(0.14, dir.y + 0.09);
    vec2 wind = vec2(uTime * uCloudSpeed, uTime * uCloudSpeed * 0.42);
    float n = cloudFbm(cloudUv * 0.65 + wind);
    float threshold = 1.0 - clamp(uCloudCoverage, 0.0, 0.98);
    float mask = smoothstep(threshold - 0.18, threshold + 0.24, n) * smoothstep(0.015, 0.18, elev);
    float forwardLit = pow(max(0.0, sunAlign), 4.0) * 0.45 + 0.55;
    vec3 cloudShade = mix(uHorizonColor * 0.65 + uZenithColor * 0.2, uSunColor * 1.15 + vec3(0.28), forwardLit);
    skyCol = mix(skyCol, cloudShade, mask * clamp(uCloudDensity, 0.0, 1.0));
  }

  float groundMask = smoothstep(0.03, -0.22, elev);
  vec3 lowerHemi = mix(uHorizonColor * 0.72, uGroundColor, clamp(-elev * 2.2, 0.0, 1.0));
  skyCol = mix(skyCol, lowerHemi, groundMask);

  float skyExp = uEnvCapture > 0.5 ? uExposure : (uLinearOutput > 0.5 ? 1.0 : uExposure);
  skyCol *= skyExp;
  if (uEnvCapture > 0.5) {
    skyCol = min(skyCol, vec3(3.2));
  }
  gl_FragColor = vec4(skyCol, 1.0);
  if (uLinearOutput < 0.5 && uEnvCapture < 0.5) {
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
}
`;

function resolveColor(THREE, value, fallback) {
  if (value && typeof value.isColor === 'boolean' && value.isColor) return value.clone();
  return THREE.Color ? new THREE.Color(value ?? fallback) : value;
}

function normalizeVec3(input, fallback) {
  const arr = Array.isArray(input) ? input : (input ? [input.x, input.y, input.z] : fallback);
  const x = Number.isFinite(arr[0]) ? arr[0] : fallback[0];
  const y = Number.isFinite(arr[1]) ? arr[1] : fallback[1];
  const z = Number.isFinite(arr[2]) ? arr[2] : fallback[2];
  const len = Math.hypot(x, y, z);
  return len > 1e-8 ? [x / len, y / len, z / len] : [...fallback];
}

/** Creates an atmospheric procedural sky dome + matching PMREM environment baker. */
export function createProceduralSky3D(THREE, options = {}) {
  if (!THREE?.SphereGeometry || !THREE?.ShaderMaterial || !THREE?.Mesh || !THREE?.Vector3) {
    throw new TypeError('createProceduralSky3D requires SphereGeometry, ShaderMaterial, Mesh and Vector3');
  }
  const initialPreset = options.preset ? SKY3D_PRESETS[options.preset] : SKY3D_PRESETS.day;
  if (!initialPreset) throw new Error('Unknown sky3d preset: ' + options.preset);
  const config = { ...initialPreset, ...options };
  const radius = Number.isFinite(config.radius) && config.radius > 10 ? config.radius : 450;
  const sunDir = normalizeVec3(config.sunDirection, initialPreset.sunDirection);

  const uniforms = {
    uZenithColor: { value: resolveColor(THREE, config.zenithColor, initialPreset.zenithColor) },
    uHorizonColor: { value: resolveColor(THREE, config.horizonColor, initialPreset.horizonColor) },
    uGroundColor: { value: resolveColor(THREE, config.groundColor, initialPreset.groundColor) },
    uSunColor: { value: resolveColor(THREE, config.sunColor, initialPreset.sunColor) },
    uSunDirection: { value: new THREE.Vector3(sunDir[0], sunDir[1], sunDir[2]) },
    uSunIntensity: { value: Number.isFinite(config.sunIntensity) ? config.sunIntensity : 1.0 },
    uCloudCoverage: { value: Number.isFinite(config.cloudCoverage) ? config.cloudCoverage : 0.42 },
    uCloudDensity: { value: Number.isFinite(config.cloudDensity) ? config.cloudDensity : 0.55 },
    uCloudSpeed: { value: Number.isFinite(config.cloudSpeed) ? config.cloudSpeed : 0.014 },
    uMieG: { value: Number.isFinite(config.mieG) ? config.mieG : 0.78 },
    uMieStrength: { value: Number.isFinite(config.mieStrength) ? config.mieStrength : 0.28 },
    uTime: { value: Number.isFinite(config.time) ? config.time : 0 },
    uExposure: { value: Number.isFinite(config.exposure) ? config.exposure : 1.0 },
    uEnvCapture: { value: 0 },
    uLinearOutput: { value: config.linearOutput ? 1 : 0 },
  };

  const geometry = new THREE.SphereGeometry(radius, 32, 20);
  const material = new THREE.ShaderMaterial({
    name: 'HGameProceduralSky',
    uniforms,
    vertexShader: SKY_VERTEX_SHADER,
    fragmentShader: SKY_FRAGMENT_SHADER,
    side: THREE.BackSide ?? 1,
    depthWrite: false,
    depthTest: true,
    toneMapped: !config.linearOutput,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'HGameSkyDome';
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  let envRenderTarget = null;
  let disposed = false;

  function setOptions(patch = {}) {
    if (disposed || !patch || typeof patch !== 'object') return;
    if (patch.zenithColor !== undefined && uniforms.uZenithColor.value?.set) {
      uniforms.uZenithColor.value.set(patch.zenithColor);
    }
    if (patch.horizonColor !== undefined && uniforms.uHorizonColor.value?.set) {
      uniforms.uHorizonColor.value.set(patch.horizonColor);
    }
    if (patch.groundColor !== undefined && uniforms.uGroundColor.value?.set) {
      uniforms.uGroundColor.value.set(patch.groundColor);
    }
    if (patch.sunColor !== undefined && uniforms.uSunColor.value?.set) {
      uniforms.uSunColor.value.set(patch.sunColor);
    }
    if (patch.sunDirection !== undefined) {
      const nextDir = normalizeVec3(patch.sunDirection, [0.46, 0.72, 0.52]);
      uniforms.uSunDirection.value.set(nextDir[0], nextDir[1], nextDir[2]);
    }
    if (patch.sunIntensity !== undefined) uniforms.uSunIntensity.value = patch.sunIntensity;
    if (patch.cloudCoverage !== undefined) uniforms.uCloudCoverage.value = patch.cloudCoverage;
    if (patch.cloudDensity !== undefined) uniforms.uCloudDensity.value = patch.cloudDensity;
    if (patch.cloudSpeed !== undefined) uniforms.uCloudSpeed.value = patch.cloudSpeed;
    if (patch.mieG !== undefined) uniforms.uMieG.value = patch.mieG;
    if (patch.mieStrength !== undefined) uniforms.uMieStrength.value = patch.mieStrength;
    if (patch.exposure !== undefined) uniforms.uExposure.value = patch.exposure;
    if (patch.time !== undefined) uniforms.uTime.value = patch.time;
    if (patch.linearOutput !== undefined) {
      uniforms.uLinearOutput.value = patch.linearOutput ? 1 : 0;
      material.toneMapped = !patch.linearOutput;
    }
  }

  function setLinearOutput(enabled) {
    if (disposed) return;
    const flag = Boolean(enabled);
    uniforms.uLinearOutput.value = flag ? 1 : 0;
    material.toneMapped = !flag;
  }

  function setPreset(name, overrides = {}) {
    const preset = SKY3D_PRESETS[name];
    if (!preset) throw new Error('Unknown sky3d preset: ' + name);
    setOptions({ ...preset, ...overrides });
  }

  function update(dt = 0, cameraPosition = null) {
    if (disposed) return;
    if (Number.isFinite(dt) && dt > 0) uniforms.uTime.value += dt;
    if (cameraPosition && mesh.position?.set) {
      mesh.position.set(cameraPosition.x ?? 0, cameraPosition.y ?? 0, cameraPosition.z ?? 0);
    }
  }

  function bakeEnvironment(renderer, { targetScene = null, near = 0.5, far = 1000 } = {}) {
    if (disposed || !THREE.PMREMGenerator || !renderer?.getContext?.()) return null;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const prevCapture = uniforms.uEnvCapture.value;
    uniforms.uEnvCapture.value = 1;
    const envScene = new THREE.Scene();
    const envMesh = new THREE.Mesh(geometry, material);
    envScene.add(envMesh);
    try {
      const nextTarget = pmrem.fromScene(envScene, 0, near, far);
      envRenderTarget?.dispose?.();
      envRenderTarget = nextTarget;
      if (targetScene) targetScene.environment = nextTarget.texture;
      return nextTarget.texture;
    } finally {
      uniforms.uEnvCapture.value = prevCapture;
      pmrem.dispose();
    }
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    mesh.parent?.remove?.(mesh);
    envRenderTarget?.dispose?.();
    envRenderTarget = null;
    geometry.dispose?.();
    material.dispose?.();
    return true;
  }

  return {
    mesh,
    material,
    uniforms,
    get sunDirection() {
      const v = uniforms.uSunDirection.value;
      return [v.x, v.y, v.z];
    },
    get environmentTexture() { return envRenderTarget?.texture ?? null; },
    get linearOutput() { return uniforms.uLinearOutput.value > 0.5; },
    setOptions,
    setLinearOutput,
    setPreset,
    update,
    bakeEnvironment,
    dispose,
  };
}

/**
 * Fits a DirectionalLight's orthographic shadow frustum tightly around scene
 * or receiver bounds and optionally snaps to shadow-map texels to avoid shimmer.
 */
export function fitDirectionalShadowFrustum(THREE, light, bounds, {
  sunDirection = null,
  distance = 40,
  padding = 2,
  snapToTexels = true,
  bias = -0.0003,
  normalBias = 0.02,
} = {}) {
  if (!THREE?.Vector3 || !light?.shadow?.camera) {
    throw new TypeError('fitDirectionalShadowFrustum requires THREE.Vector3 and a DirectionalLight with shadow.camera');
  }
  if (!bounds || typeof bounds !== 'object') throw new TypeError('bounds object is required');

  let minX, minY, minZ, maxX, maxY, maxZ;
  if (Array.isArray(bounds.min) && Array.isArray(bounds.max)) {
    [minX, minY, minZ] = bounds.min;
    [maxX, maxY, maxZ] = bounds.max;
  } else if (Array.isArray(bounds.center) && Number.isFinite(bounds.radius)) {
    const r = Math.abs(bounds.radius);
    [minX, minY, minZ] = [bounds.center[0] - r, bounds.center[1] - r, bounds.center[2] - r];
    [maxX, maxY, maxZ] = [bounds.center[0] + r, bounds.center[1] + r, bounds.center[2] + r];
  } else {
    throw new TypeError('bounds must specify { min, max } or { center, radius }');
  }

  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const cz = (minZ + maxZ) * 0.5;
  const dirArr = normalizeVec3(
    sunDirection ?? (light.position && light.target
      ? [light.position.x - light.target.position.x, light.position.y - light.target.position.y, light.position.z - light.target.position.z]
      : [0.46, 0.72, 0.52]),
    [0.46, 0.72, 0.52],
  );

  // Light looks from target + dirArr * distance toward target (cx, cy, cz).
  const dir = new THREE.Vector3(dirArr[0], dirArr[1], dirArr[2]);
  const forward = dir.clone().negate().normalize(); // view look direction (-Z of light camera)
  const worldUp = Math.abs(forward.y) > 0.99
    ? new THREE.Vector3(0, 0, 1)
    : new THREE.Vector3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();

  const lx = cx + dir.x * distance;
  const ly = cy + dir.y * distance;
  const lz = cz + dir.z * distance;
  light.position?.set?.(lx, ly, lz);
  light.target?.position?.set?.(cx, cy, cz);
  light.target?.updateMatrixWorld?.(true);

  let left = Infinity, rightBound = -Infinity;
  let bottom = Infinity, top = -Infinity;
  let nearDist = Infinity, farDist = -Infinity;

  for (let ix = 0; ix < 2; ix++) {
    const px = (ix === 0 ? minX : maxX) - lx;
    for (let iy = 0; iy < 2; iy++) {
      const py = (iy === 0 ? minY : maxY) - ly;
      for (let iz = 0; iz < 2; iz++) {
        const pz = (iz === 0 ? minZ : maxZ) - lz;
        const u = px * right.x + py * right.y + pz * right.z;
        const v = px * up.x + py * up.y + pz * up.z;
        const d = px * forward.x + py * forward.y + pz * forward.z;
        if (u < left) left = u;
        if (u > rightBound) rightBound = u;
        if (v < bottom) bottom = v;
        if (v > top) top = v;
        if (d < nearDist) nearDist = d;
        if (d > farDist) farDist = d;
      }
    }
  }

  left -= padding;
  rightBound += padding;
  bottom -= padding;
  top += padding;
  nearDist = Math.max(0.1, nearDist - padding);
  farDist = Math.max(nearDist + 1, farDist + padding);

  const mapW = light.shadow.mapSize?.x ?? 0;
  const mapH = light.shadow.mapSize?.y ?? 0;
  if (snapToTexels && mapW > 0 && mapH > 0) {
    const texelX = (rightBound - left) / mapW;
    const texelY = (top - bottom) / mapH;
    if (texelX > 0) {
      left = Math.floor(left / texelX) * texelX;
      rightBound = Math.ceil(rightBound / texelX) * texelX;
    }
    if (texelY > 0) {
      bottom = Math.floor(bottom / texelY) * texelY;
      top = Math.ceil(top / texelY) * texelY;
    }
  }

  const cam = light.shadow.camera;
  cam.left = left;
  cam.right = rightBound;
  cam.bottom = bottom;
  cam.top = top;
  cam.near = nearDist;
  cam.far = farDist;
  cam.updateProjectionMatrix?.();

  if (bias !== null && bias !== undefined) light.shadow.bias = bias;
  if (normalBias !== null && normalBias !== undefined && 'normalBias' in light.shadow) {
    light.shadow.normalBias = normalBias;
  }
  return { left, right: rightBound, bottom, top, near: nearDist, far: farDist };
}

/**
 * Fixed pool of transient PointLights kept mounted at zero intensity to avoid
 * runtime Three.js shader recompilations when explosions or muzzle flashes fire.
 */
export function createLightPool3D(THREE, parent, { size = 6, defaultDecay = 2 } = {}) {
  if (!THREE?.PointLight || !parent?.add) {
    throw new TypeError('createLightPool3D requires THREE.PointLight and a Scene/Group parent');
  }
  if (!Number.isInteger(size) || size < 1 || size > 32) {
    throw new RangeError('Light pool size must be an integer in 1..32');
  }
  const slots = [];
  for (let i = 0; i < size; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 8, defaultDecay);
    light.castShadow = false;
    light.visible = true;
    parent.add(light);
    slots.push({ light, baseIntensity: 0, remaining: 0, duration: 0 });
  }
  let disposed = false;

  function flash({
    x = 0, y = 0, z = 0,
    color = 0xffb35c,
    intensity = 5,
    distance = 8,
    duration = 0.08,
  } = {}) {
    if (disposed) return null;
    if (!(duration > 0) || !(intensity > 0)) return null;
    let chosen = null;
    let lowestFraction = Infinity;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.remaining <= 0) {
        chosen = slot;
        break;
      }
      const fraction = slot.duration > 0 ? slot.remaining / slot.duration : 0;
      if (fraction < lowestFraction) {
        lowestFraction = fraction;
        chosen = slot;
      }
    }
    chosen.baseIntensity = intensity;
    chosen.duration = duration;
    chosen.remaining = duration;
    chosen.light.position?.set?.(x, y, z);
    chosen.light.color?.set?.(color);
    chosen.light.distance = distance;
    chosen.light.intensity = intensity;
    return chosen.light;
  }

  function update(dt) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return 0;
    let activeCount = 0;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (slot.remaining <= 0) continue;
      slot.remaining = Math.max(0, slot.remaining - dt);
      if (slot.remaining <= 0) {
        slot.light.intensity = 0;
      } else {
        const life = slot.remaining / slot.duration;
        slot.light.intensity = slot.baseIntensity * life * life;
        activeCount++;
      }
    }
    return activeCount;
  }

  function clear() {
    for (const slot of slots) {
      slot.remaining = 0;
      slot.duration = 0;
      slot.baseIntensity = 0;
      slot.light.intensity = 0;
    }
  }

  function dispose() {
    if (disposed) return false;
    disposed = true;
    for (const slot of slots) {
      slot.light.intensity = 0;
      parent.remove?.(slot.light);
      slot.light.dispose?.();
    }
    slots.length = 0;
    return true;
  }

  return {
    get size() { return slots.length; },
    get activeCount() {
      let count = 0;
      for (let i = 0; i < slots.length; i++) if (slots[i].remaining > 0) count++;
      return count;
    },
    flash,
    update,
    clear,
    dispose,
  };
}
