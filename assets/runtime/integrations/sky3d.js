/**
 * Clean-room procedural atmospheric sky dome, PMREM environment IBL baker,
 * tight directional shadow frustum fitter, and pooled transient point lights.
 *
 * The Three.js namespace is injected by callers so non-3D projects load nothing.
 */

import {
  fitDirectionalShadowFrustum,
  normalizeShadowVec3,
  computeCascadeSplits,
  createCascadedShadowMap3D,
} from './shadow3d.js';

export { fitDirectionalShadowFrustum, computeCascadeSplits, createCascadedShadowMap3D };

/** @typedef {[number, number, number]} SkyVec3Tuple Direction/point [x, y, z]. */
/** @typedef {SkyVec3Tuple|{ x: number, y: number, z: number }} SkyVec3Input */
/** @typedef {string|number|{ readonly isColor: boolean }} SkyColorInput CSS color string, 0xRRGGBB number, or a THREE.Color. */
/** @typedef {'day'|'goldenHour'|'overcast'|'dusk'|'night'} Sky3DPresetName */
/**
 * @typedef {object} Sky3DPreset
 * @property {string} zenithColor
 * @property {string} horizonColor
 * @property {string} groundColor
 * @property {string} sunColor
 * @property {readonly number[]} sunDirection Normalised on use.
 * @property {number} sunIntensity
 * @property {number} cloudCoverage 0..1.
 * @property {number} cloudDensity 0..1.
 * @property {number} cloudSpeed Cloud drift in shader units per second.
 * @property {number} mieG Mie asymmetry, -1..1.
 * @property {number} mieStrength
 * @property {number} exposure
 */
/**
 * @typedef {object} Sky3DOptions
 * @property {Sky3DPresetName} [preset='day'] Base preset; explicit fields override it.
 * @property {SkyColorInput} [zenithColor]
 * @property {SkyColorInput} [horizonColor]
 * @property {SkyColorInput} [groundColor]
 * @property {SkyColorInput} [sunColor]
 * @property {SkyVec3Input} [sunDirection] Direction towards the sun; normalised.
 * @property {number} [sunIntensity=1]
 * @property {number} [cloudCoverage=0.42]
 * @property {number} [cloudDensity=0.55]
 * @property {number} [cloudSpeed=0.014]
 * @property {number} [mieG=0.78]
 * @property {number} [mieStrength=0.28]
 * @property {number} [exposure=1]
 * @property {number} [time=0] Initial shader time in seconds.
 * @property {number} [radius=450] Dome radius in world units (>10).
 * @property {boolean} [linearOutput=false] Output linear colour and disable tone mapping.
 */
/** @typedef {Partial<Sky3DPreset>&Partial<Sky3DOptions>} Sky3DPatch Runtime-updatable subset of {@link Sky3DOptions}. */
/**
 * @typedef {object} SkyMeshLike
 * @property {string} name
 * @property {boolean} frustumCulled
 * @property {number} renderOrder
 * @property {{ x: number, y: number, z: number, set(x: number, y: number, z: number): unknown }} position
 * @property {{ remove(object: object): unknown }|null} parent
 */
/**
 * @typedef {object} SkyMaterialLike
 * @property {string} name
 * @property {boolean} toneMapped
 * @property {() => void} dispose
 */
/**
 * @typedef {object} SkyThree The subset of the THREE namespace used by the sky dome.
 * @property {new (radius: number, widthSegments: number, heightSegments: number) => { dispose(): void }} SphereGeometry
 * @property {new (parameters: object) => SkyMaterialLike} ShaderMaterial
 * @property {new (geometry: object, material: object) => SkyMeshLike} Mesh
 * @property {new (x?: number, y?: number, z?: number) => { x: number, y: number, z: number, set(x: number, y: number, z: number): unknown }} Vector3
 * @property {number} [BackSide]
 * @property {new (value?: unknown) => object} [Color]
 * @property {new (renderer: object) => { fromScene(scene: object, sigma: number, near: number, far: number): { texture: object, dispose(): void }, dispose(): void }} [PMREMGenerator]
 * @property {new () => { add(object: object): unknown }} [Scene]
 */
/**
 * @typedef {object} Sky3DBakeOptions
 * @property {{ environment: unknown }|null} [targetScene=null] Receives `environment` when given.
 * @property {number} [near=0.5]
 * @property {number} [far=1000]
 */
/**
 * @typedef {object} Sky3D
 * @property {SkyMeshLike} mesh Sky dome; add it to the scene.
 * @property {SkyMaterialLike} material
 * @property {Record<string, { value: unknown }>} uniforms Shader uniforms.
 * @property {SkyVec3Tuple} sunDirection Normalised sun direction (getter).
 * @property {object|null} environmentTexture Last baked PMREM texture (getter).
 * @property {boolean} linearOutput (getter).
 * @property {(patch?: Sky3DPatch) => void} setOptions
 * @property {(enabled: boolean) => void} setLinearOutput
 * @property {(name: Sky3DPresetName, overrides?: Sky3DPatch) => void} setPreset Throws on unknown preset.
 * @property {(dt?: number, cameraPosition?: { x?: number, y?: number, z?: number }|null) => void} update dt in seconds; follows the camera when given.
 * @property {(renderer: { getContext?(): object|null }, options?: Sky3DBakeOptions) => (object|null)} bakeEnvironment
 * @property {() => boolean} dispose
 */
/**
 * @typedef {object} DirectionalLightLike
 * @property {{ x: number, y: number, z: number, set?(x: number, y: number, z: number): unknown }} [position]
 * @property {{ position: { x: number, y: number, z: number, set?(x: number, y: number, z: number): unknown }, updateMatrixWorld?(force?: boolean): void }} [target]
 * @property {{ camera: { left: number, right: number, top: number, bottom: number, near: number, far: number, updateProjectionMatrix?(): void }, mapSize?: { x: number, y: number }, bias: number, normalBias?: number }} shadow
 */
/**
 * @typedef {object} ShadowFitBounds Either {min,max} or {center,radius}.
 * @property {SkyVec3Tuple} [min]
 * @property {SkyVec3Tuple} [max]
 * @property {SkyVec3Tuple} [center]
 * @property {number} [radius]
 */
/**
 * @typedef {object} ShadowFitOptions
 * @property {SkyVec3Input|null} [sunDirection=null] Defaults to light.position - light.target.position.
 * @property {number} [distance=40] Light distance from bounds centre, world units.
 * @property {number} [padding=2] World units added on each side.
 * @property {boolean} [snapToTexels=true] Snap to shadow-map texels to avoid shimmer.
 * @property {number|null} [bias=-0.0003]
 * @property {number|null} [normalBias=0.02]
 */
/**
 * @typedef {object} ShadowFrustum
 * @property {number} left
 * @property {number} right
 * @property {number} bottom
 * @property {number} top
 * @property {number} near
 * @property {number} far
 */
/**
 * @typedef {object} PooledLightLike
 * @property {{ set?(x: number, y: number, z: number): unknown }} [position]
 * @property {{ set?(color: unknown): unknown }} [color]
 * @property {number} distance
 * @property {number} intensity
 * @property {boolean} castShadow
 * @property {boolean} visible
 * @property {() => void} [dispose]
 */
/**
 * @typedef {object} LightPoolThree
 * @property {new (color: number, intensity: number, distance: number, decay: number) => PooledLightLike} PointLight
 */
/**
 * @typedef {object} LightPoolOptions
 * @property {number} [size=6] Pool size, integer 1..32.
 * @property {number} [defaultDecay=2] PointLight decay.
 */
/**
 * @typedef {object} LightFlashOptions
 * @property {number} [x=0] World units.
 * @property {number} [y=0]
 * @property {number} [z=0]
 * @property {SkyColorInput} [color=0xffb35c]
 * @property {number} [intensity=5] Must be > 0.
 * @property {number} [distance=8] World units.
 * @property {number} [duration=0.08] Seconds; must be > 0.
 */
/**
 * @typedef {object} LightPool3D
 * @property {number} size (getter)
 * @property {number} activeCount Lights currently flashing (getter).
 * @property {(options?: LightFlashOptions) => (PooledLightLike|null)} flash Steals the most-faded slot when full; null if disposed/invalid.
 * @property {(dt: number) => number} update dt in seconds; returns active count.
 * @property {() => void} clear
 * @property {() => boolean} dispose
 */

/** @type {Readonly<Record<Sky3DPresetName, Readonly<Sky3DPreset>>>} */
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
  // Draw the dome at the far plane even when the camera uses a shorter
  // quality-tier draw distance than the dome's physical radius.
  gl_Position.z = gl_Position.w * 0.999999;
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

/**
 * Creates an atmospheric procedural sky dome + matching PMREM environment baker.
 * @param {SkyThree} THREE
 * @param {Sky3DOptions} [options]
 * @returns {Sky3D}
 */
export function createProceduralSky3D(THREE, options = {}) {
  if (!THREE?.SphereGeometry || !THREE?.ShaderMaterial || !THREE?.Mesh || !THREE?.Vector3) {
    throw new TypeError('createProceduralSky3D requires SphereGeometry, ShaderMaterial, Mesh and Vector3');
  }
  const initialPreset = options.preset ? SKY3D_PRESETS[options.preset] : SKY3D_PRESETS.day;
  if (!initialPreset) throw new Error('Unknown sky3d preset: ' + options.preset);
  const config = { ...initialPreset, ...options };
  const radius = Number.isFinite(config.radius) && config.radius > 10 ? config.radius : 450;
  const sunDir = normalizeShadowVec3(config.sunDirection, initialPreset.sunDirection);

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
      const nextDir = normalizeShadowVec3(patch.sunDirection, [0.46, 0.72, 0.52]);
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
 * Fixed pool of transient PointLights kept mounted at zero intensity to avoid
 * runtime Three.js shader recompilations when explosions or muzzle flashes fire.
 * @param {LightPoolThree} THREE
 * @param {{ add(object: object): unknown, remove?(object: object): unknown }} parent Scene or Group.
 * @param {LightPoolOptions} [options]
 * @returns {LightPool3D}
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
