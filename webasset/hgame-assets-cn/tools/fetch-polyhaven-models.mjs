import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MODELS_MANIFEST_PATH = path.join(ROOT, 'manifests', 'models.manifest.json');
const RAW_PH_MODELS = path.join(ROOT, 'raw', 'models_polyhaven');
const UA = { 'User-Agent': 'HGameAssetsCN/4.1' };

async function fetchPolyHavenModel(polyhavenId) {
  const dir = path.join(RAW_PH_MODELS, polyhavenId);
  const gltfPath = path.join(dir, `${polyhavenId}_1k.gltf`);
  const metaPath = path.join(dir, 'meta.json');
  if (existsSync(gltfPath) && existsSync(metaPath)) return { cached: true };

  await mkdir(dir, { recursive: true });
  const filesRes = await fetch(`https://api.polyhaven.com/files/${encodeURIComponent(polyhavenId)}`, { headers: UA });
  if (!filesRes.ok) throw new Error(`Poly Haven model ${polyhavenId} HTTP ${filesRes.status}`);
  const filesJson = await filesRes.json();
  const gltfSpec = filesJson?.gltf?.['1k']?.gltf;
  if (!gltfSpec?.url) throw new Error(`Poly Haven model ${polyhavenId} missing 1k gltf`);

  const gltfBuf = Buffer.from(await (await fetch(gltfSpec.url, { headers: UA })).arrayBuffer());
  await writeFile(gltfPath, gltfBuf);
  for (const [rel, info] of Object.entries(gltfSpec.include || {})) {
    const dest = path.join(dir, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    const bin = Buffer.from(await (await fetch(info.url, { headers: UA })).arrayBuffer());
    await writeFile(dest, bin);
  }
  await writeFile(metaPath, JSON.stringify({
    assetId: polyhavenId,
    source: 'polyhaven',
    license: 'CC0',
    sourceUrl: `https://polyhaven.com/a/${polyhavenId}`,
    fetchedAt: new Date().toISOString(),
  }, null, 2));
  return { cached: false };
}

async function main() {
  const manifest = JSON.parse(await readFile(MODELS_MANIFEST_PATH, 'utf8'));
  const phItems = (manifest.items || []).filter((i) => i.source === 'polyhaven' && i.polyhavenId);
  let fetched = 0;
  let cached = 0;
  for (const item of phItems) {
    const r = await fetchPolyHavenModel(item.polyhavenId);
    if (r.cached) cached++;
    else fetched++;
  }
  console.log(`[ph:fetch-models] Poly Haven models ready: ${fetched} downloaded, ${cached} cached`);
}

main().catch((err) => {
  console.error('[ph:fetch-models] FAILED:', err);
  process.exit(1);
});
