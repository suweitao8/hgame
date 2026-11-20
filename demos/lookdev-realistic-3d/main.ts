import type { QualityTier } from '../../src/modules/realistic-pcg/core/quality-presets.js';
import type { LightingPresetName } from '../../src/modules/realistic-pcg/lighting/procedural-ibl.js';
import type { BakeMode } from '../../src/modules/realistic-pcg/materials/texture-array-baker.js';
import type { BiomeOverlayMode } from '../../src/modules/realistic-pcg/materials/world-pbr-shader.js';
import {
  createLookDevScene,
  type CameraPresetName,
  type LookDevMetrics,
} from '../../src/modules/realistic-pcg/lookdev/lookdev-scene.js';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const metricsEl = document.querySelector<HTMLElement>('#metrics')!;
const auditEl = document.querySelector<HTMLElement>('#audit-log')!;
const dropOverlay = document.querySelector<HTMLElement>('#drop-overlay')!;
const qualitySel = document.querySelector<HTMLSelectElement>('#ctrl-quality')!;
const lightingSel = document.querySelector<HTMLSelectElement>('#ctrl-lighting')!;
const biomeSel = document.querySelector<HTMLSelectElement>('#ctrl-biome')!;
const bakeModeSel = document.querySelector<HTMLSelectElement>('#ctrl-bakemode')!;
const wetnessSlider = document.querySelector<HTMLInputElement>('#ctrl-wetness')!;
const wetnessValEl = document.querySelector<HTMLElement>('#wetness-val')!;
const tripoToggle = document.querySelector<HTMLInputElement>('#ctrl-tripo')!;

const params = new URLSearchParams(location.search);
const initialQuality = (params.get('quality') === 'LOW' ? 'LOW' : 'HIGH') as QualityTier;
const manifestParam = params.get('manifest');
const manifestUrl =
  manifestParam !== null ? manifestParam : 'http://127.0.0.1:4174/files/procedural/manifest.json';
const initialBakeMode = (params.get('bakeMode') as BakeMode | null) ?? 'auto';
const initialBiome = (params.get('biome') as BiomeOverlayMode | null) ?? 'wet_moss';
qualitySel.value = initialQuality;
biomeSel.value = initialBiome;
bakeModeSel.value = initialBakeMode;

function formatMetrics(m: LookDevMetrics): string {
  return [
    `FPS: ${m.fps} | DrawCalls: ${m.drawCalls} (Static: ${m.staticDrawCalls})`,
    `Tris: ${m.triangles} | TexMem: ${m.estimatedTextureMB} MB`,
    `Bake: ${m.bakeTimeMs} ms [${m.bakeBackend.toUpperCase()}] (maxSlice ${m.maxBakeSliceMs} ms)`,
    `Mats: ${m.materialCount} | MeshCache: ${m.cachedMeshCount}`,
  ].join('\n');
}

const controller = await createLookDevScene({
  canvas,
  manifestUrl,
  initialQuality,
  initialLighting: 'OVERCAST_WET',
  initialBiome,
  initialBakeMode,
  onMetricsUpdate: (m) => {
    metricsEl.textContent = formatMetrics(m);
  },
  onAuditMessage: (msg) => {
    auditEl.textContent = msg;
  },
});

canvas.dataset.engineReady = 'true';
controller.start();

window.addEventListener('resize', () => {
  controller.resize(window.innerWidth, window.innerHeight);
});

qualitySel.addEventListener('change', async () => {
  await controller.api.setQuality(qualitySel.value as QualityTier);
});

lightingSel.addEventListener('change', () => {
  controller.api.setLightingPreset(lightingSel.value as LightingPresetName);
});

biomeSel.addEventListener('change', () => {
  controller.api.setBiomeMode(biomeSel.value as BiomeOverlayMode);
});

bakeModeSel.addEventListener('change', async () => {
  await controller.api.setBakeMode(bakeModeSel.value as BakeMode);
});

wetnessSlider.addEventListener('input', () => {
  const v = Number(wetnessSlider.value);
  wetnessValEl.textContent = v.toFixed(2);
  controller.api.setWetness(v);
});

tripoToggle.addEventListener('change', () => {
  controller.api.setTripoNormalizationEnabled(tripoToggle.checked);
});

document.querySelectorAll<HTMLButtonElement>('[data-cam]').forEach((btn) => {
  btn.addEventListener('click', () => {
    controller.api.setCameraPreset(btn.dataset.cam as CameraPresetName);
  });
});

// Drag & Drop Hot-Reload (.glb / .hmat.json / .hmesh.json)
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropOverlay.hidden = false;
});
window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) dropOverlay.hidden = true;
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropOverlay.hidden = true;
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith('.glb')) {
      const buf = await file.arrayBuffer();
      await controller.api.loadCharacterGlb(buf);
    } else if (name.endsWith('.hmat.json')) {
      const recipe = JSON.parse(await file.text());
      await controller.api.hotReloadMaterial(recipe);
      auditEl.textContent = `Hot-reloaded material: ${recipe.id}`;
    } else if (name.endsWith('.hmesh.json')) {
      const recipe = JSON.parse(await file.text());
      controller.api.hotReloadMesh(recipe);
      auditEl.textContent = `Hot-reloaded mesh: ${recipe.id}`;
    } else {
      auditEl.textContent = `Unsupported file: ${file.name}`;
    }
  } catch (err) {
    auditEl.textContent = `Hot-reload error: ${err instanceof Error ? err.message : String(err)}`;
  }
});
