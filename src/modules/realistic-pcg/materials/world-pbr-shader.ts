import * as THREE from 'three';
import type { TextureArraySet } from './texture-array-baker.js';

export type BiomeOverlayMode = 'wet_moss' | 'desert_dust' | 'clean_indoor';

export interface WorldPbrMaterialOptions {
  textureArray: TextureArraySet;
  useTriplanar?: boolean;
  globalWetness?: number;
  groundHeight?: number;
  normalStrength?: number;
  macroStrength?: number;
  envMapIntensity?: number;
  biomeMode?: BiomeOverlayMode;
  biomeStrength?: number;
}

export interface WorldPbrMaterialHandle {
  material: THREE.MeshStandardMaterial;
  setWetness(wetness: number): void;
  setGroundHeight(height: number): void;
  setNormalStrength(strength: number): void;
  setBiomeMode(mode: BiomeOverlayMode): void;
  setBiomeStrength(strength: number): void;
  setTime(timeSec: number): void;
  syncTextureArray(texArray: TextureArraySet): void;
  dispose(): void;
}

const MAX_MATERIAL_SLOTS = 16;

function biomeModeToInt(mode: BiomeOverlayMode): number {
  if (mode === 'desert_dust') return 1;
  if (mode === 'clean_indoor') return 2;
  return 0;
}

function buildTileMetersArray(texArray: TextureArraySet): number[] {
  const arr = new Array<number>(MAX_MATERIAL_SLOTS).fill(1.0);
  const src = texArray.tileMetersById;
  const n = Math.min(MAX_MATERIAL_SLOTS, src.length);
  for (let i = 0; i < n; i++) {
    arr[i] = src[i]! > 0.01 ? src[i]! : 1.0;
  }
  return arr;
}

export function createWorldPbrMaterial(
  options: WorldPbrMaterialOptions
): WorldPbrMaterialHandle {
  const useTriplanar = Boolean(options.useTriplanar);
  const tileMeters = buildTileMetersArray(options.textureArray);

  const uniforms = {
    uAlbedoArray: { value: options.textureArray.albedoArray },
    uNormalArray: { value: options.textureArray.normalArray },
    uOrmArray: { value: options.textureArray.ormArray },
    uTileMeters: { value: tileMeters },
    uGlobalWetness: { value: options.globalWetness ?? 0.45 },
    uGroundHeight: { value: options.groundHeight ?? 0.0 },
    uNormalStrength: { value: options.normalStrength ?? 1.0 },
    uMacroStrength: { value: options.macroStrength ?? 0.14 },
    uBiomeMode: { value: biomeModeToInt(options.biomeMode ?? 'wet_moss') },
    uBiomeStrength: { value: options.biomeStrength ?? 1.0 },
    uTime: { value: 0.0 },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1.0,
    metalness: 1.0,
    vertexColors: true,
    envMapIntensity: options.envMapIntensity ?? 1.0,
  });

  material.customProgramCacheKey = () =>
    useTriplanar ? 'hgame-world-pbr-triplanar-v2' : 'hgame-world-pbr-metric-v2';

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (useTriplanar) {
      shader.fragmentShader = '#define HG_USE_TRIPLANAR 1\n' + shader.fragmentShader;
    }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aMaterialId;
varying float vPcgMatId;
varying vec2 vPcgUv;
varying vec3 vPcgWorldPos;
varying vec3 vPcgWorldNormal;
#ifdef USE_INSTANCING
  attribute vec4 aInstanceMeta;
  varying vec4 vPcgInstanceMeta;
#endif`
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
vPcgUv = uv;
vPcgMatId = aMaterialId;
#ifdef USE_INSTANCING
  vPcgInstanceMeta = aInstanceMeta;
#endif`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
vec4 pcgWorld = vec4( transformed, 1.0 );
vec3 pcgWNormal = objectNormal;
#ifdef USE_INSTANCING
  pcgWorld = instanceMatrix * pcgWorld;
  pcgWNormal = mat3( instanceMatrix ) * pcgWNormal;
#endif
pcgWorld = modelMatrix * pcgWorld;
vPcgWorldPos = pcgWorld.xyz;
vPcgWorldNormal = normalize( mat3( modelMatrix ) * pcgWNormal );`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform highp sampler2DArray uAlbedoArray;
uniform highp sampler2DArray uNormalArray;
uniform highp sampler2DArray uOrmArray;
uniform float uTileMeters[${MAX_MATERIAL_SLOTS}];
uniform float uGlobalWetness;
uniform float uGroundHeight;
uniform float uNormalStrength;
uniform float uMacroStrength;
uniform int uBiomeMode;
uniform float uBiomeStrength;
uniform float uTime;

varying float vPcgMatId;
varying vec2 vPcgUv;
varying vec3 vPcgWorldPos;
varying vec3 vPcgWorldNormal;
#ifdef USE_INSTANCING
  varying vec4 vPcgInstanceMeta;
#endif

float pcgHash21( vec2 p ) {
  p = fract( p * vec2( 123.34, 456.21 ) );
  p += dot( p, p + 45.32 );
  return fract( p.x * p.y );
}

float pcgNoise2( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  float a = pcgHash21( i );
  float b = pcgHash21( i + vec2( 1.0, 0.0 ) );
  float c = pcgHash21( i + vec2( 0.0, 1.0 ) );
  float d = pcgHash21( i + vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y );
}

// Raindrop concentric ripples on standing puddles (inspired by saltline ground shader)
vec2 pcgRainRipple( vec2 xz, float t ) {
  vec2 cell = floor( xz * 1.35 );
  vec2 f = fract( xz * 1.35 ) - 0.5;
  float rnd = pcgHash21( cell );
  float phase = fract( t * 0.65 + rnd );
  vec2 center = vec2( pcgHash21( cell + 3.1 ), pcgHash21( cell + 7.9 ) ) - 0.5;
  vec2 d = f - center * 0.45;
  float dist = length( d );
  float ring = sin( ( dist - phase * 0.48 ) * 46.0 ) * exp( -dist * 9.0 ) * ( 1.0 - phase );
  float env = smoothstep( 0.48, 0.05, dist );
  return normalize( d + 1e-4 ) * ring * env * 0.045;
}

mat3 pcgTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
  vec3 q0 = dFdx( eye_pos.xyz );
  vec3 q1 = dFdy( eye_pos.xyz );
  vec2 st0 = dFdx( uv.st );
  vec2 st1 = dFdy( uv.st );
  vec3 N = surf_norm;
  vec3 q1perp = cross( q1, N );
  vec3 q0perp = cross( N, q0 );
  vec3 T = q1perp * st0.x + q0perp * st1.x;
  vec3 B = q1perp * st0.y + q0perp * st1.y;
  float det = max( dot( T, T ), dot( B, B ) );
  float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
  return mat3( T * scale, B * scale, N );
}`
      )
      .replace(
        '#include <color_fragment>',
        `// Vertex color carries packed PBR metadata: R=GeomAO, G=EdgeWear, B=LocalWetness
int pcgLayerIdx = clamp( int( floor( vPcgMatId + 0.5 ) ), 0, ${MAX_MATERIAL_SLOTS - 1} );
float pcgLayerF = float( pcgLayerIdx );
float pcgTile = max( 0.01, uTileMeters[ pcgLayerIdx ] );
vec2 pcgSampleUv = vPcgUv / pcgTile;

#ifdef HG_USE_TRIPLANAR
  vec3 pcgBlendW = pow( abs( normalize( vPcgWorldNormal ) ), vec3( 6.0 ) );
  pcgBlendW /= max( 1e-4, pcgBlendW.x + pcgBlendW.y + pcgBlendW.z );
  vec2 pcgUvX = vPcgWorldPos.zy / pcgTile;
  vec2 pcgUvY = vPcgWorldPos.xz / pcgTile;
  vec2 pcgUvZ = vPcgWorldPos.xy / pcgTile;
  vec4 pcgAlb = texture( uAlbedoArray, vec3( pcgUvX, pcgLayerF ) ) * pcgBlendW.x
              + texture( uAlbedoArray, vec3( pcgUvY, pcgLayerF ) ) * pcgBlendW.y
              + texture( uAlbedoArray, vec3( pcgUvZ, pcgLayerF ) ) * pcgBlendW.z;
  vec3 pcgNrmX = texture( uNormalArray, vec3( pcgUvX, pcgLayerF ) ).xyz;
  vec3 pcgNrmY = texture( uNormalArray, vec3( pcgUvY, pcgLayerF ) ).xyz;
  vec3 pcgNrmZ = texture( uNormalArray, vec3( pcgUvZ, pcgLayerF ) ).xyz;
  vec3 pcgNrm = pcgNrmX * pcgBlendW.x + pcgNrmY * pcgBlendW.y + pcgNrmZ * pcgBlendW.z;
  vec4 pcgOrm = texture( uOrmArray, vec3( pcgUvX, pcgLayerF ) ) * pcgBlendW.x
              + texture( uOrmArray, vec3( pcgUvY, pcgLayerF ) ) * pcgBlendW.y
              + texture( uOrmArray, vec3( pcgUvZ, pcgLayerF ) ) * pcgBlendW.z;
#else
  vec4 pcgAlb = texture( uAlbedoArray, vec3( pcgSampleUv, pcgLayerF ) );
  vec3 pcgNrm = texture( uNormalArray, vec3( pcgSampleUv, pcgLayerF ) ).xyz;
  vec4 pcgOrm = texture( uOrmArray, vec3( pcgSampleUv, pcgLayerF ) );
#endif

vec3 pcgAlbedo = pcgAlb.rgb;
float pcgHeight = pcgAlb.a;
float pcgTexAO = pcgOrm.r;
float pcgRoughness = pcgOrm.g;
float pcgMetalness = pcgOrm.b;
float pcgPorosity = pcgOrm.a;

float pcgGeomAO = 1.0;
float pcgEdgeWear = 0.0;
float pcgLocalWet = 0.0;
#ifdef USE_COLOR
  pcgGeomAO = clamp( vColor.r, 0.2, 1.0 );
  pcgEdgeWear = clamp( vColor.g, 0.0, 1.0 );
  pcgLocalWet = clamp( vColor.b, 0.0, 1.0 );
#endif

float pcgInstSeed = 0.0;
#ifdef USE_INSTANCING
  pcgAlbedo *= ( 1.0 + clamp( vPcgInstanceMeta.x, -0.35, 0.35 ) );
  pcgEdgeWear = clamp( pcgEdgeWear + vPcgInstanceMeta.y * 0.4, 0.0, 1.0 );
  pcgLocalWet = clamp( pcgLocalWet + vPcgInstanceMeta.z, 0.0, 1.0 );
  pcgInstSeed = vPcgInstanceMeta.w;
#endif

// 1. Macro world-space variation (8m + 24m)
vec2 pcgMacroSeedOff = vec2( pcgInstSeed * 17.3, pcgInstSeed * 9.7 );
float pcgMacro8 = pcgNoise2( vPcgWorldPos.xz * 0.125 + pcgMacroSeedOff );
float pcgMacro24 = pcgNoise2( vPcgWorldPos.xz * 0.0416667 + vec2( 7.3, 19.1 ) + pcgMacroSeedOff );
float pcgMacroVar = ( pcgMacro8 * 0.65 + pcgMacro24 * 0.35 ) * 2.0 - 1.0;
pcgAlbedo *= ( 1.0 + pcgMacroVar * uMacroStrength );

vec3 pcgWorldN = normalize( vPcgWorldNormal );
float pcgPuddleMask = 0.0;

if ( uBiomeMode == 0 ) {
  // ---- BIOME 0: wet_moss (rain dampness, standing puddles, moss & ground mud) ----
  float pcgWetness = clamp( ( uGlobalWetness * 0.85 + pcgLocalWet * 0.85 ) * uBiomeStrength, 0.0, 1.0 );
  pcgAlbedo *= mix( 1.0, 1.0 - pcgPorosity * 0.42, pcgWetness );
  pcgRoughness = mix( pcgRoughness, max( 0.16, pcgRoughness * ( 1.0 - pcgPorosity * 0.48 ) ), pcgWetness );

  float pcgPuddleNoise = pcgNoise2( vPcgWorldPos.xz * 0.32 + vec2( 3.1, 5.7 ) );
  float pcgUpFlat = smoothstep( 0.85, 0.96, pcgWorldN.y );
  float pcgPuddleDriver = clamp( uGlobalWetness * 0.55 + pcgLocalWet * 0.95, 0.0, 1.3 );
  pcgPuddleMask = smoothstep( 0.42, 0.64, pcgPuddleNoise * 0.35 + pcgLocalWet * 0.85 )
                * pcgUpFlat
                * smoothstep( 0.30, 0.68, pcgPuddleDriver )
                * uBiomeStrength;
  pcgAlbedo = mix( pcgAlbedo, pcgAlbedo * 0.40, pcgPuddleMask * 0.88 );
  pcgRoughness = mix( pcgRoughness, 0.04, pcgPuddleMask );

  float pcgMossNoise = pcgNoise2( vPcgWorldPos.xz * 0.45 + vec2( 11.4, 2.8 ) );
  float pcgUpMask = smoothstep( 0.60, 0.88, pcgWorldN.y );
  float pcgMossMask = pcgUpMask * smoothstep( 0.52, 0.82, pcgMossNoise * 0.7 + ( 1.0 - pcgHeight ) * 0.35 ) * ( 1.0 - pcgPuddleMask ) * ( 1.0 - pcgMetalness ) * uBiomeStrength;
  vec3 pcgMossCol = vec3( 0.055, 0.085, 0.035 );
  pcgAlbedo = mix( pcgAlbedo, pcgMossCol, pcgMossMask * 0.40 );
  pcgRoughness = mix( pcgRoughness, 0.92, pcgMossMask * 0.35 );

  float pcgGroundProx = 1.0 - smoothstep( uGroundHeight, uGroundHeight + 0.6, vPcgWorldPos.y );
  float pcgGrimeMask = pcgGroundProx * ( 0.55 + 0.45 * pcgMacro8 ) * uBiomeStrength;
  pcgAlbedo = mix( pcgAlbedo, pcgAlbedo * 0.68, pcgGrimeMask * 0.65 );
  pcgRoughness = mix( pcgRoughness, 0.86, pcgGrimeMask * 0.25 );
} else if ( uBiomeMode == 1 ) {
  // ---- BIOME 1: desert_dust (inspired by worm-rider shared sand/dust PBR overlay) ----
  float pcgDustNoise = pcgNoise2( vPcgWorldPos.xz * 0.22 + vec2( 5.1, 8.7 ) );
  float pcgStreak = pcgNoise2( vec2( ( abs( pcgWorldN.x ) > abs( pcgWorldN.z ) ? vPcgWorldPos.z : vPcgWorldPos.x ) * 0.9, vPcgWorldPos.y * 0.35 ) );
  float pcgDustStreak = mix( 1.0, 0.6 + 0.8 * pcgStreak, 1.0 - abs( pcgWorldN.y ) );
  float pcgUpDust = smoothstep( 0.45, 0.96, pcgWorldN.y ) * 0.72;
  float pcgLowDust = ( 1.0 - smoothstep( uGroundHeight, uGroundHeight + 1.4, vPcgWorldPos.y ) ) * 0.65;
  float pcgDustMask = clamp( ( max( pcgUpDust, pcgLowDust ) + 0.08 ) * ( 0.22 + 1.9 * pcgDustNoise * pcgDustNoise ) * pcgDustStreak * uBiomeStrength, 0.0, 0.92 );
  vec3 pcgDustCol = vec3( 0.43, 0.23, 0.11 ) * ( 0.82 + 0.36 * pcgMacro8 );
  pcgAlbedo = mix( pcgAlbedo, pcgDustCol, pcgDustMask );
  pcgRoughness = mix( pcgRoughness, 0.95, pcgDustMask );
  pcgMetalness *= ( 1.0 - pcgDustMask );
} else {
  // ---- BIOME 2: clean_indoor (architectural dry interior, minimal contact shadow grime) ----
  float pcgGroundProx = 1.0 - smoothstep( uGroundHeight, uGroundHeight + 0.25, vPcgWorldPos.y );
  pcgAlbedo *= ( 1.0 - pcgGroundProx * 0.08 * uBiomeStrength );
}

// 3. Edge wear highlight
pcgAlbedo *= ( 1.0 + pcgEdgeWear * 0.13 );
pcgRoughness = clamp( pcgRoughness - pcgEdgeWear * 0.14, 0.04, 0.98 );

diffuseColor.rgb = clamp( pcgAlbedo, 0.01, 0.96 );`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = clamp( pcgRoughness, 0.04, 0.98 );`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `float metalnessFactor = clamp( pcgMetalness, 0.0, 1.0 );`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#ifdef HG_USE_TRIPLANAR
  vec2 pcgTriDX = ( pcgNrmX.xy * 2.0 - 1.0 ) * uNormalStrength;
  vec2 pcgTriDY = ( pcgNrmY.xy * 2.0 - 1.0 ) * uNormalStrength;
  vec2 pcgTriDZ = ( pcgNrmZ.xy * 2.0 - 1.0 ) * uNormalStrength;
  vec3 pcgTriWorldDelta = vec3( 0.0, pcgTriDX.y, pcgTriDX.x ) * pcgBlendW.x
                        + vec3( pcgTriDY.x, 0.0, pcgTriDY.y ) * pcgBlendW.y
                        + vec3( pcgTriDZ.x, pcgTriDZ.y, 0.0 ) * pcgBlendW.z;
  vec3 pcgPerturbedWorldN = normalize( pcgWorldN + pcgTriWorldDelta );
  normal = normalize( ( viewMatrix * vec4( pcgPerturbedWorldN, 0.0 ) ).xyz );
#else
  vec3 pcgMapN = pcgNrm * 2.0 - 1.0;
  pcgMapN.xy *= uNormalStrength;
  mat3 pcgTbn = pcgTangentFrame( -vViewPosition, normal, pcgSampleUv );
  normal = normalize( pcgTbn * pcgMapN );
#endif
if ( pcgPuddleMask > 0.001 ) {
  vec2 pcgRip = pcgRainRipple( vPcgWorldPos.xz, uTime ) * smoothstep( 0.2, 0.9, uGlobalWetness );
  vec3 pcgRipWorld = normalize( vec3( pcgRip.x, 1.0, pcgRip.y ) );
  vec3 pcgViewUp = normalize( ( viewMatrix * vec4( pcgRipWorld, 0.0 ) ).xyz );
  normal = normalize( mix( normal, pcgViewUp, pcgPuddleMask * 0.94 ) );
}`
      )
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
float pcgTotalAO = clamp( pcgTexAO * pcgGeomAO, 0.15, 1.0 );
reflectedLight.indirectDiffuse *= pcgTotalAO;
#if defined( USE_ENVMAP ) && defined( STANDARD )
  float pcgDotNV = saturate( dot( geometryNormal, geometryViewDir ) );
  reflectedLight.indirectSpecular *= computeSpecularOcclusion( pcgDotNV, pcgTotalAO, material.roughness );
#endif`
      );
  };

  return {
    material,
    setWetness(wetness: number): void {
      uniforms.uGlobalWetness.value = Math.max(0, Math.min(1, wetness));
    },
    setGroundHeight(height: number): void {
      uniforms.uGroundHeight.value = height;
    },
    setNormalStrength(strength: number): void {
      uniforms.uNormalStrength.value = Math.max(0, strength);
    },
    setBiomeMode(mode: BiomeOverlayMode): void {
      uniforms.uBiomeMode.value = biomeModeToInt(mode);
    },
    setBiomeStrength(strength: number): void {
      uniforms.uBiomeStrength.value = Math.max(0, Math.min(1, strength));
    },
    setTime(timeSec: number): void {
      uniforms.uTime.value = timeSec;
    },
    syncTextureArray(texArray: TextureArraySet): void {
      uniforms.uAlbedoArray.value = texArray.albedoArray;
      uniforms.uNormalArray.value = texArray.normalArray;
      uniforms.uOrmArray.value = texArray.ormArray;
      const updated = buildTileMetersArray(texArray);
      for (let i = 0; i < MAX_MATERIAL_SLOTS; i++) {
        uniforms.uTileMeters.value[i] = updated[i]!;
      }
    },
    dispose(): void {
      material.dispose();
    },
  };
}
