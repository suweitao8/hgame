import * as THREE from 'three';

export type LightingPresetName = 'OVERCAST_WET' | 'GOLDEN_HOUR' | 'NOON_CLEAR';

export interface ProceduralSkyPreset {
  name: LightingPresetName;
  zenithColor: string;
  horizonColor: string;
  groundColor: string;
  sunColor: string;
  sunDirection: [number, number, number];
  sunIntensity: number;
  hemiIntensity: number;
  fogColor: string;
  fogDensity: number;
  mieG: number;
  mieStrength: number;
  cloudDensity: number;
  exposure: number;
}

export const PROCEDURAL_LIGHTING_PRESETS: Readonly<Record<LightingPresetName, ProceduralSkyPreset>> = {
  OVERCAST_WET: {
    name: 'OVERCAST_WET',
    zenithColor: '#4c5b6c',
    horizonColor: '#98a6b5',
    groundColor: '#222624',
    sunColor: '#e8eff5',
    sunDirection: [-0.72, 0.52, 0.46],
    sunIntensity: 2.15,
    hemiIntensity: 0.68,
    fogColor: '#84919e',
    fogDensity: 0.01,
    mieG: 0.72,
    mieStrength: 0.18,
    cloudDensity: 0.72,
    exposure: 1.0,
  },
  GOLDEN_HOUR: {
    name: 'GOLDEN_HOUR',
    zenithColor: '#2c4870',
    horizonColor: '#db8c54',
    groundColor: '#2a221c',
    sunColor: '#ffbe7d',
    sunDirection: [-0.82, 0.24, 0.52],
    sunIntensity: 3.1,
    hemiIntensity: 0.52,
    fogColor: '#b58463',
    fogDensity: 0.01,
    mieG: 0.84,
    mieStrength: 0.42,
    cloudDensity: 0.35,
    exposure: 1.0,
  },
  NOON_CLEAR: {
    name: 'NOON_CLEAR',
    zenithColor: '#2a62b5',
    horizonColor: '#9bc4e8',
    groundColor: '#2b2d26',
    sunColor: '#fff8ec',
    sunDirection: [0.35, 0.88, 0.32],
    sunIntensity: 3.6,
    hemiIntensity: 0.58,
    fogColor: '#9ab7cf',
    fogDensity: 0.0065,
    mieG: 0.78,
    mieStrength: 0.22,
    cloudDensity: 0.2,
    exposure: 1.0,
  },
};

export interface ProceduralIBLHandle {
  skyMesh: THREE.Mesh;
  environmentTexture: THREE.Texture | null;
  getPreset(): ProceduralSkyPreset;
  setPreset(name: LightingPresetName, renderer: THREE.WebGLRenderer, targetScene: THREE.Scene): void;
  update(timeSec: number, cameraPos?: THREE.Vector3): void;
  dispose(): void;
}

const SKY_VERT = `
varying vec3 vWorldDir;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vWorldDir = normalize( position );
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const SKY_FRAG = `
uniform vec3 uZenithColor;
uniform vec3 uHorizonColor;
uniform vec3 uGroundColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uMieG;
uniform float uMieStrength;
uniform float uCloudDensity;
uniform float uTime;

varying vec3 vWorldDir;

float hash21( vec2 p ) {
  p = fract( p * vec2( 127.1, 311.7 ) );
  p += dot( p, p + 34.23 );
  return fract( p.x * p.y );
}

float vnoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( hash21( i ), hash21( i + vec2( 1.0, 0.0 ) ), u.x ),
    mix( hash21( i + vec2( 0.0, 1.0 ) ), hash21( i + vec2( 1.0, 1.0 ) ), u.x ),
    u.y
  );
}

float fbmClouds( vec2 p ) {
  float v = 0.0;
  float a = 0.5;
  for ( int i = 0; i < 4; i++ ) {
    v += a * vnoise( p );
    p *= 2.07;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 dir = normalize( vWorldDir );
  vec3 sunDir = normalize( uSunDir );

  // Rayleigh gradient + dark ground hemisphere bounce
  float up = clamp( dir.y, 0.0, 1.0 );
  float down = clamp( -dir.y, 0.0, 1.0 );
  vec3 skyCol = mix( uHorizonColor, uZenithColor, pow( up, 0.55 ) );
  skyCol = mix( skyCol, uGroundColor, pow( down, 0.45 ) );

  // Mie forward scattering + solar disc
  float cosTheta = max( 0.0, dot( dir, sunDir ) );
  float g2 = uMieG * uMieG;
  float mie = ( 1.0 - g2 ) / ( 4.0 * 3.14159 * pow( max( 0.01, 1.0 + g2 - 2.0 * uMieG * cosTheta ), 1.5 ) );
  float sunDisc = smoothstep( 0.9988, 0.9997, cosTheta ) * ( 1.0 - uCloudDensity * 0.75 );
  skyCol += uSunColor * ( mie * uMieStrength + sunDisc * 4.5 ) * smoothstep( -0.05, 0.15, dir.y );

  // Procedural cloud deck above horizon
  if ( dir.y > 0.02 && uCloudDensity > 0.01 ) {
    vec2 cloudUv = dir.xz / ( dir.y + 0.25 ) * 1.4 + vec2( uTime * 0.008, uTime * 0.004 );
    float c = fbmClouds( cloudUv );
    float cMask = smoothstep( 0.42 - uCloudDensity * 0.2, 0.78, c ) * smoothstep( 0.02, 0.22, dir.y );
    vec3 cloudShade = mix( uHorizonColor * 0.75, uZenithColor * 1.1 + uSunColor * 0.18, 0.6 );
    skyCol = mix( skyCol, cloudShade, cMask * uCloudDensity );
  }

  gl_FragColor = vec4( max( skyCol, vec3( 0.0 ) ), 1.0 );
}`;

function normalizeDir(v: readonly [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(v[0], v[1], v[2]).normalize();
}

export function createProceduralIBL(
  initialPreset: LightingPresetName = 'OVERCAST_WET'
): ProceduralIBLHandle {
  let currentPreset = PROCEDURAL_LIGHTING_PRESETS[initialPreset];

  const uniforms = {
    uZenithColor: { value: new THREE.Color(currentPreset.zenithColor) },
    uHorizonColor: { value: new THREE.Color(currentPreset.horizonColor) },
    uGroundColor: { value: new THREE.Color(currentPreset.groundColor) },
    uSunColor: { value: new THREE.Color(currentPreset.sunColor) },
    uSunDir: { value: normalizeDir(currentPreset.sunDirection) },
    uMieG: { value: currentPreset.mieG },
    uMieStrength: { value: currentPreset.mieStrength },
    uCloudDensity: { value: currentPreset.cloudDensity },
    uTime: { value: 0 },
  };

  const skyGeo = new THREE.SphereGeometry(240, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    toneMapped: false,
  });

  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.name = 'ProceduralSkyDome';
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -10;

  let pmremGen: THREE.PMREMGenerator | null = null;
  let envRenderTarget: THREE.RenderTarget | null = null;
  let iblScene: THREE.Scene | null = null;
  let iblSkyMesh: THREE.Mesh | null = null;

  function bakeEnvironment(renderer: THREE.WebGLRenderer, targetScene: THREE.Scene): void {
    if (!pmremGen) {
      pmremGen = new THREE.PMREMGenerator(renderer);
    }
    if (!iblScene) {
      iblScene = new THREE.Scene();
      iblSkyMesh = new THREE.Mesh(skyGeo, skyMat);
      iblScene.add(iblSkyMesh);
    }
    if (envRenderTarget) {
      envRenderTarget.dispose();
      envRenderTarget = null;
    }
    envRenderTarget = pmremGen.fromScene(iblScene, 0.04, 0.5, 500);
    targetScene.environment = envRenderTarget.texture;
  }

  return {
    skyMesh,
    get environmentTexture(): THREE.Texture | null {
      return envRenderTarget?.texture ?? null;
    },
    getPreset(): ProceduralSkyPreset {
      return currentPreset;
    },
    setPreset(
      name: LightingPresetName,
      renderer: THREE.WebGLRenderer,
      targetScene: THREE.Scene
    ): void {
      currentPreset = PROCEDURAL_LIGHTING_PRESETS[name];
      uniforms.uZenithColor.value.set(currentPreset.zenithColor);
      uniforms.uHorizonColor.value.set(currentPreset.horizonColor);
      uniforms.uGroundColor.value.set(currentPreset.groundColor);
      uniforms.uSunColor.value.set(currentPreset.sunColor);
      uniforms.uSunDir.value.copy(normalizeDir(currentPreset.sunDirection));
      uniforms.uMieG.value = currentPreset.mieG;
      uniforms.uMieStrength.value = currentPreset.mieStrength;
      uniforms.uCloudDensity.value = currentPreset.cloudDensity;
      bakeEnvironment(renderer, targetScene);
    },
    update(timeSec: number, cameraPos?: THREE.Vector3): void {
      uniforms.uTime.value = timeSec;
      if (cameraPos) {
        skyMesh.position.copy(cameraPos);
      }
    },
    dispose(): void {
      if (envRenderTarget) {
        envRenderTarget.dispose();
        envRenderTarget = null;
      }
      if (pmremGen) {
        pmremGen.dispose();
        pmremGen = null;
      }
      skyGeo.dispose();
      skyMat.dispose();
      iblScene = null;
      iblSkyMesh = null;
    },
  };
}
