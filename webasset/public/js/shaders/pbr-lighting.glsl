// Shared Track A / B Unified World 2-Map PBR Lighting Reference (hgame v4.1)
struct SurfaceData {
  vec3 albedo;
  vec3 normalWS;
  float ao;
  float roughness;
  float metallic;
  vec3 emissive;
  float alpha;
};

// Core 2-Map Unpacking (Color sRGB + Normal_RM Linear RGBA)
// vec4 albedoSample = sampleAlbedo(uv, layer);
// vec4 nrmSample    = sampleNormalRm(uv, layer);
// vec2 nXY = nrmSample.rg * 2.0 - 1.0;
// float nZ = sqrt(max(0.0, 1.0 - dot(nXY, nXY)));
// vec3 normalWS = perturbNormalCotangent(vNormalWS, vWorldPos, uv, vec3(nXY, nZ));
// float roughness = clamp(nrmSample.b, 0.04, 1.0);
// float metallic  = nrmSample.a;
// float microAO   = mix(1.0, 0.88, roughness * roughness);

vec3 evalWorldLighting(
  SurfaceData s,
  vec3 worldPos,
  vec3 viewDir,
  int torchCount,
  vec4 torchPosRadius[8],
  vec4 torchColor[8]
) {
  vec3 accum = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= torchCount) break;
    vec4 tp = torchPosRadius[i];
    vec4 tc = torchColor[i];
    vec3 toLight = tp.xyz - worldPos;
    float d = length(toLight);
    if (d < tp.w) {
      float att = pow(clamp(1.0 - d / tp.w, 0.0, 1.0), 2.0);
      vec3 lDir = toLight / max(d, 0.001);
      float ndl = max(dot(s.normalWS, lDir), 0.12);
      accum += s.albedo * tc.rgb * (tc.a * att * ndl / 3.14159);
    }
  }
  return accum * s.ao + s.emissive;
}
