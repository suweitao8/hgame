/** Grid sampling shared by the particle fragment shaders. Local UVs use a top-left origin. */
export const VFX_FLIPBOOK_GLSL = /* glsl */ `
vec2 vfxFlipbookGrid(vec2 tiles) {
  return max(vec2(1.0), floor(tiles + 0.5));
}

float vfxFlipbookFramePosition(float lifeRatio, vec2 grid, float cycles) {
  float total = grid.x * grid.y;
  cycles = max(0.01, cycles);
  float phase = lifeRatio * cycles;
  if (phase >= 1.0 && cycles <= 1.001) return total - 0.001;
  return min(fract(phase), 0.9999) * total;
}

vec2 vfxFlipbookFrameUv(float frameIndex, vec2 localUv, vec2 grid) {
  vec2 cell = vec2(mod(frameIndex, grid.x), floor(frameIndex / grid.x));
  return (cell + localUv) / grid;
}
`;
