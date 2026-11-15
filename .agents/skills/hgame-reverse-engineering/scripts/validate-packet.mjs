import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

// Mechanical readiness only. Content correctness and user approval require review.
const errors = [];
const need = (condition, message) => { if (!condition) errors.push(message); };
const text = v => typeof v === 'string' && v.trim().length > 0;
const inside = (root, file) => { const r = path.relative(root, file); return r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r); };
try {
  if (!process.argv[2]) throw new Error('Usage: node validate-packet.mjs <packet.json>');
  const file = await realpath(path.resolve(process.argv[2]));
  const root = path.dirname(file);
  const p = JSON.parse(await readFile(file, 'utf8'));
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('packet must be an object');
  async function ref(value, label) {
    if (!text(value)) { errors.push(`${label}: missing path`); return; }
    const local = value.split('#')[0];
    const target = path.resolve(root, local);
    if (!local || path.isAbsolute(local) || !inside(root, target)) { errors.push(`${label}: outside packet or absolute path`); return; }
    try {
      const resolved = await realpath(target);
      if (!inside(root, resolved)) { errors.push(`${label}: outside packet via symlink`); return; }
      const s = await stat(resolved);
      need(s.isFile() && s.size > 0, `${label}: empty or not a file`);
    } catch { errors.push(`${label}: missing file ${local}`); }
  }
  need([1, 2].includes(p.schemaVersion), 'schemaVersion must be 1 or 2');
  need(text(p.title), 'title is required');
  need(p.status === 'ready', 'status must be ready; draft is not handoff-ready');
  need(['pending','approved'].includes(p.approval), 'approval must be pending or approved');
  for (const key of ['project','profile','slice','fullScope']) need(text(p.target?.[key]), `target.${key} is required`);
  need(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.target?.project ?? ''), 'target.project must be kebab-case');
  need(['dom-svg','canvas-2d','pixi-2d','three-3d'].includes(p.target?.profile), 'target.profile is unsupported');
  for (const key of ['spec','evidence','assets','acceptance','prompt']) await ref(p.documents?.[key], `documents.${key}`);
  const ids = p.schemaVersion === 1
    ? ['gameplay','levels','balance','ui','audio','vfx','art','narrative','engineering']
    : ['gameplay','levels','balance','ui','audio','vfx','asset-slots','narrative','engineering'];
  need(Array.isArray(p.domains), 'domains must be an array');
  const domains = Array.isArray(p.domains) ? p.domains : [];
  const seen = new Set();
  for (const d of domains) {
    need(ids.includes(d?.id), `unknown domain ${d?.id}`);
    need(!seen.has(d?.id), `duplicate domain ${d?.id}`); seen.add(d?.id);
    need(['covered','not-applicable'].includes(d?.status), `${d?.id}: unresolved domain`);
    if (d?.status === 'not-applicable') need(text(d.reason), `${d.id}: N/A reason required`);
    if (d?.status === 'covered') await ref(d.ref, `domains.${d.id}.ref`);
  }
  for (const id of ids) need(seen.has(id), `missing domain ${id}`);
  need(Array.isArray(p.dataFiles), 'dataFiles must be an array');
  if (Array.isArray(p.dataFiles)) for (const f of p.dataFiles) await ref(f, 'dataFiles');
  need(Array.isArray(p.blockers) && p.blockers.length === 0, 'blockers must be an empty array');
  need(p.coldRead?.status === 'passed', 'coldRead must be passed');
  await ref(p.coldRead?.report, 'coldRead.report');
  if (errors.length) { process.stderr.write(`NOT READY:\n${errors.map(e => `- ${e}`).join('\n')}\n`); process.exitCode = 1; }
  else process.stdout.write(`PASS: packet references and declared readiness; approval=${p.approval}. Content, assets and gameplay still require review.\n`);
} catch (e) { process.stderr.write(`INVALID PACKET: ${e.message}\n`); process.exitCode = 1; }
