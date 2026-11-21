import * as THREE from 'three';

export const MAX_DYNAMIC_TORCH_LIGHTS = 8;

export function createUnifiedLightingRig() {
  const torchPosRadius = Array.from({ length: MAX_DYNAMIC_TORCH_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 1));
  const torchColor = Array.from({ length: MAX_DYNAMIC_TORCH_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0));
  const torchCountUniform = { value: 0 };

  return {
    torchPosRadius,
    torchColor,
    torchCountUniform,
    setPointLights(lights = []) {
      const n = Math.min(MAX_DYNAMIC_TORCH_LIGHTS, lights.length);
      torchCountUniform.value = n;
      for (let i = 0; i < n; i++) {
        const l = lights[i];
        const pos = l.position || [0, 0, 0];
        const col = l.color || [1.0, 0.62, 0.25];
        torchPosRadius[i].set(pos[0], pos[1], pos[2], Math.max(0.5, l.radius ?? 8.5));
        torchColor[i].set(col[0], col[1], col[2], Math.max(0, l.intensity ?? 2.2));
      }
      for (let i = n; i < MAX_DYNAMIC_TORCH_LIGHTS; i++) {
        torchColor[i].set(0, 0, 0, 0);
      }
    },
  };
}

export function applyUnifiedWorldLighting(material, lightingRig, { foliageDoubleSide = false } = {}) {
  if (!material || !lightingRig) return material;
  if (material.userData?.__uwlApplied) return material;
  material.userData = material.userData || {};
  material.userData.__uwlApplied = true;
  const prevCompile = material.onBeforeCompile;
  const prevKey = typeof material.customProgramCacheKey === 'function'
    ? material.customProgramCacheKey.bind(material)
    : () => '';

  material.customProgramCacheKey = () => `${prevKey()}:uwl-v1${foliageDoubleSide ? ':dbl' : ''}`;
  material.onBeforeCompile = (shader, renderer) => {
    if (typeof prevCompile === 'function') prevCompile.call(material, shader, renderer);
    shader.uniforms.uTorchCount = lightingRig.torchCountUniform;
    shader.uniforms.uTorchPosRadius = { value: lightingRig.torchPosRadius };
    shader.uniforms.uTorchColor = { value: lightingRig.torchColor };

    if (!shader.vertexShader.includes('vUwlWorldPos')) {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vUwlWorldPos;
varying vec3 vUwlWorldN;`,
        )
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
vec4 uwlWp = vec4(transformed, 1.0);
vec3 uwlWn = objectNormal;
#ifdef USE_INSTANCING
  uwlWp = instanceMatrix * uwlWp;
  uwlWn = mat3(instanceMatrix) * uwlWn;
#endif
uwlWp = modelMatrix * uwlWp;
vUwlWorldPos = uwlWp.xyz;
vUwlWorldN = normalize(mat3(modelMatrix) * uwlWn);`,
        );
    }

    if (!shader.fragmentShader.includes('uTorchCount')) {
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform int uTorchCount;
uniform vec4 uTorchPosRadius[8];
uniform vec4 uTorchColor[8];
varying vec3 vUwlWorldPos;
varying vec3 vUwlWorldN;`,
        )
        .replace(
          '#include <aomap_fragment>',
          `#include <aomap_fragment>
vec3 uwlN = normalize(vUwlWorldN);
${foliageDoubleSide ? 'uwlN = normalize(mix(vec3(0.0, 1.0, 0.0), gl_FrontFacing ? uwlN : -uwlN, 0.4));' : ''}
for (int tlIdx = 0; tlIdx < 8; tlIdx++) {
  if (tlIdx >= uTorchCount) break;
  vec4 tp = uTorchPosRadius[tlIdx];
  vec4 tc = uTorchColor[tlIdx];
  vec3 toLight = tp.xyz - vUwlWorldPos;
  float d = length(toLight);
  if (d < tp.w) {
    float att = pow(clamp(1.0 - d / tp.w, 0.0, 1.0), 2.0);
    vec3 lDirW = toLight / max(d, 0.001);
    float ndl = max(dot(uwlN, lDirW), 0.14);
    reflectedLight.directDiffuse += diffuseColor.rgb * tc.rgb * (tc.a * att * ndl / 3.14159);
  }
}`,
        );
    }
  };
  material.needsUpdate = true;
  return material;
}
