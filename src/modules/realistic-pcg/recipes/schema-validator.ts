import { extractExprParamRefs, type ParamMap } from '../core/safe-expr.js';
import type {
  MaterialNodeOp,
  MaterialNodeSpec,
  MaterialRecipe,
  MeshPartOp,
  MeshRecipe,
  ProceduralManifest,
} from './schema-types.js';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  recipeId: string;
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

const VALID_MAT_OPS = new Set<MaterialNodeOp>([
  'fbm',
  'worley',
  'brick_pattern',
  'wood_grain',
  'plank_pattern',
  'stripes',
  'speckle',
  'corrugated_wave',
  'edge_wear_mask',
  'vertical_streak',
  'rivet_grid',
  'sand_ripples',
  'fabric_weave',
  'remap',
  'clamp',
  'invert',
  'power',
  'domain_warp',
  'blur',
  'height_to_normal',
  'blend',
  'mix_scalar',
  'mix_color',
  'color_ramp',
]);

const VALID_MESH_OPS = new Set<MeshPartOp>([
  'beveled_box',
  'beveled_wall_opening',
  'cylinder',
  'stairs',
  'displaced_rock',
  'extrude_profile',
  'corrugated_panel',
  'pipe_segment',
  'ref',
]);

const HEX_COLOR_RE = /^#([0-9a-fA-F]{6})$/;

export function parseHexColor(hex: string): [number, number, number] | null {
  const m = HEX_COLOR_RE.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function srgbChannelToLinear(c8: number): number {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function hexLinearLuminance(hex: string): number | null {
  const rgb = parseHexColor(hex);
  if (!rgb) return null;
  const r = srgbChannelToLinear(rgb[0]);
  const g = srgbChannelToLinear(rgb[1]);
  const b = srgbChannelToLinear(rgb[2]);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function collectParamAndExprIssues(
  value: unknown,
  params: ParamMap,
  recipeId: string,
  fieldPath: string,
  issues: ValidationIssue[]
): void {
  if (typeof value === 'string') {
    const trimmed = value.startsWith('!') ? value.slice(1).trim() : value;
    if (trimmed.startsWith('expr:')) {
      try {
        const refs = extractExprParamRefs(trimmed);
        for (const r of refs) {
          if (!(r in params)) {
            issues.push({
              severity: 'error',
              recipeId,
              path: fieldPath,
              message: `Unknown parameter "$${r}" in expression "${value}"`,
            });
          }
        }
      } catch (err) {
        issues.push({
          severity: 'error',
          recipeId,
          path: fieldPath,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } else if (trimmed.startsWith('$')) {
      const name = trimmed.slice(1);
      if (!(name in params)) {
        issues.push({
          severity: 'error',
          recipeId,
          path: fieldPath,
          message: `Unknown parameter reference "${value}"`,
        });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, idx) =>
      collectParamAndExprIssues(v, params, recipeId, `${fieldPath}[${idx}]`, issues)
    );
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      collectParamAndExprIssues(v, params, recipeId, `${fieldPath}.${k}`, issues);
    }
  }
}

function isNodeRefString(s: string): boolean {
  return !s.startsWith('#') && !s.startsWith('$') && !s.startsWith('expr:');
}

function collectNodeDeps(
  args: Record<string, unknown>,
  nodeIds: Set<string>,
  recipeId: string,
  fieldPath: string,
  issues: ValidationIssue[]
): string[] {
  const deps: string[] = [];
  const checkRef = (val: unknown, subPath: string) => {
    if (typeof val !== 'string' || !isNodeRefString(val)) return;
    const baseId = val.split('.')[0]!;
    if (!nodeIds.has(baseId)) {
      issues.push({
        severity: 'error',
        recipeId,
        path: subPath,
        message: `Unknown node reference "${val}"`,
      });
    } else {
      deps.push(baseId);
    }
  };
  for (const key of ['input', 'a', 'b', 'mask', 'warpX', 'warpY']) {
    if (key in args) checkRef(args[key], `${fieldPath}.${key}`);
  }
  return deps;
}

export function validateMaterialRecipe(raw: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!raw || typeof raw !== 'object') {
    issues.push({ severity: 'error', recipeId: '<unknown>', path: '$', message: 'Recipe must be an object' });
    return issues;
  }
  const r = raw as Partial<MaterialRecipe>;
  const id = typeof r.id === 'string' && r.id ? r.id : '<unknown>';
  if (r.format !== 'hgame.material' || r.version !== 1) {
    issues.push({
      severity: 'error',
      recipeId: id,
      path: 'format',
      message: 'Expected format="hgame.material" and version=1',
    });
  }
  if (!r.meta || typeof r.meta.tileMeters !== 'number' || r.meta.tileMeters <= 0) {
    issues.push({
      severity: 'error',
      recipeId: id,
      path: 'meta.tileMeters',
      message: 'meta.tileMeters must be a positive number',
    });
  }
  if (!r.meta || typeof r.meta.seed !== 'number' || !Number.isFinite(r.meta.seed)) {
    issues.push({
      severity: 'error',
      recipeId: id,
      path: 'meta.seed',
      message: 'meta.seed must be a finite number',
    });
  }
  if (!Array.isArray(r.nodes) || r.nodes.length === 0) {
    issues.push({ severity: 'error', recipeId: id, path: 'nodes', message: 'nodes must be a non-empty array' });
    return issues;
  }
  if (!r.outputs || typeof r.outputs !== 'object') {
    issues.push({ severity: 'error', recipeId: id, path: 'outputs', message: 'outputs object is required' });
    return issues;
  }

  const params: ParamMap = r.params ?? {};
  const nodeIds = new Set<string>();
  const nodeMap = new Map<string, MaterialNodeSpec>();

  for (let i = 0; i < r.nodes.length; i++) {
    const node = r.nodes[i]!;
    if (!node || typeof node.id !== 'string' || !node.id) {
      issues.push({ severity: 'error', recipeId: id, path: `nodes[${i}].id`, message: 'Node id is required' });
      continue;
    }
    if (nodeIds.has(node.id)) {
      issues.push({
        severity: 'error',
        recipeId: id,
        path: `nodes[${i}].id`,
        message: `Duplicate node id "${node.id}"`,
      });
    }
    nodeIds.add(node.id);
    nodeMap.set(node.id, node);
    if (!VALID_MAT_OPS.has(node.op)) {
      issues.push({
        severity: 'error',
        recipeId: id,
        path: `nodes[${i}].op`,
        message: `Unsupported material op "${String(node.op)}"`,
      });
    }
    collectParamAndExprIssues(node.args ?? {}, params, id, `nodes[${i}].args`, issues);
  }

  // Build adjacency and detect cycles
  const adj = new Map<string, string[]>();
  for (const [nid, node] of nodeMap.entries()) {
    const deps = collectNodeDeps(node.args ?? {}, nodeIds, id, `nodes.${nid}.args`, issues);
    adj.set(nid, deps);
  }
  const color = new Map<string, number>(); // 0=unvisited, 1=visiting, 2=done
  const dfsCycle = (u: string): boolean => {
    const c = color.get(u) ?? 0;
    if (c === 1) return true;
    if (c === 2) return false;
    color.set(u, 1);
    for (const dep of adj.get(u) ?? []) {
      if (dfsCycle(dep)) return true;
    }
    color.set(u, 2);
    return false;
  };
  for (const nid of nodeMap.keys()) {
    if (dfsCycle(nid)) {
      issues.push({
        severity: 'error',
        recipeId: id,
        path: `nodes.${nid}`,
        message: `Cycle detected in material node DAG involving "${nid}"`,
      });
      break;
    }
  }

  // Validate outputs & inline output ops
  const reqOutputs: Array<keyof MaterialRecipe['outputs']> = [
    'albedo',
    'height',
    'normal',
    'ao',
    'roughness',
    'metalness',
    'porosity',
  ];
  for (const outKey of reqOutputs) {
    const val = r.outputs[outKey];
    if (val === undefined) {
      issues.push({
        severity: 'error',
        recipeId: id,
        path: `outputs.${outKey}`,
        message: `Missing required output "${outKey}"`,
      });
      continue;
    }
    collectParamAndExprIssues(val, params, id, `outputs.${outKey}`, issues);
    if (typeof val === 'string' && isNodeRefString(val)) {
      const baseId = val.split('.')[0]!;
      if (!nodeIds.has(baseId)) {
        issues.push({
          severity: 'error',
          recipeId: id,
          path: `outputs.${outKey}`,
          message: `Output "${outKey}" references unknown node "${val}"`,
        });
      }
    } else if (val && typeof val === 'object') {
      if (!VALID_MAT_OPS.has(val.op)) {
        issues.push({
          severity: 'error',
          recipeId: id,
          path: `outputs.${outKey}.op`,
          message: `Unsupported inline output op "${String(val.op)}"`,
        });
      }
      const inlineArgs = (val.args ?? val) as Record<string, unknown>;
      collectNodeDeps(inlineArgs, nodeIds, id, `outputs.${outKey}`, issues);
    }
  }

  // Physical PBR guardrails
  if (r.outputs.roughness === 0 || r.outputs.roughness === 0.0) {
    issues.push({
      severity: 'error',
      recipeId: id,
      path: 'outputs.roughness',
      message: 'Roughness cannot be constant 0.0',
    });
  }
  const isPureNonMetal =
    typeof r.outputs.metalness === 'number' && r.outputs.metalness < 0.5;
  if (isPureNonMetal) {
    const checkHexList = (val: unknown, loc: string) => {
      if (typeof val === 'string' && val.startsWith('#')) {
        const luma = hexLinearLuminance(val);
        if (luma === null) {
          issues.push({ severity: 'error', recipeId: id, path: loc, message: `Invalid hex color "${val}"` });
        } else if (luma < 0.04 || luma > 0.85) {
          issues.push({
            severity: 'error',
            recipeId: id,
            path: loc,
            message: `Non-metal linear albedo luminance (${luma.toFixed(4)}) for "${val}" must be within [0.04, 0.85]`,
          });
        }
      } else if (Array.isArray(val)) {
        val.forEach((v, idx) => checkHexList(v, `${loc}[${idx}]`));
      } else if (val && typeof val === 'object') {
        for (const [k, v] of Object.entries(val)) checkHexList(v, `${loc}.${k}`);
      }
    };
    checkHexList(r.nodes, 'nodes');
    checkHexList(r.outputs.albedo, 'outputs.albedo');
  }

  return issues;
}

export function validateMeshRecipe(
  raw: unknown,
  knownMaterialIds?: Set<string>,
  knownMeshIds?: Set<string>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!raw || typeof raw !== 'object') {
    issues.push({ severity: 'error', recipeId: '<unknown>', path: '$', message: 'Mesh recipe must be an object' });
    return issues;
  }
  const r = raw as Partial<MeshRecipe>;
  const id = typeof r.id === 'string' && r.id ? r.id : '<unknown>';
  if (r.format !== 'hgame.mesh' || r.version !== 1) {
    issues.push({
      severity: 'error',
      recipeId: id,
      path: 'format',
      message: 'Expected format="hgame.mesh" and version=1',
    });
  }
  if (!r.meta || r.meta.unit !== 'meter') {
    issues.push({ severity: 'error', recipeId: id, path: 'meta.unit', message: 'meta.unit must be "meter"' });
  }
  if (!r.materialSlots || typeof r.materialSlots !== 'object') {
    issues.push({
      severity: 'error',
      recipeId: id,
      path: 'materialSlots',
      message: 'materialSlots map is required',
    });
    return issues;
  }
  for (const [slotName, matId] of Object.entries(r.materialSlots)) {
    if (knownMaterialIds && !knownMaterialIds.has(matId)) {
      issues.push({
        severity: 'error',
        recipeId: id,
        path: `materialSlots.${slotName}`,
        message: `Material slot "${slotName}" references unknown material "${matId}"`,
      });
    }
  }
  if (!Array.isArray(r.parts) || r.parts.length === 0) {
    issues.push({ severity: 'error', recipeId: id, path: 'parts', message: 'parts must be a non-empty array' });
    return issues;
  }

  const params: ParamMap = r.params ?? {};
  const slotNames = new Set(Object.keys(r.materialSlots));

  for (let i = 0; i < r.parts.length; i++) {
    const part = r.parts[i]!;
    if (!part || typeof part.id !== 'string' || !part.id) {
      issues.push({ severity: 'error', recipeId: id, path: `parts[${i}].id`, message: 'Part id is required' });
      continue;
    }
    if (!VALID_MESH_OPS.has(part.op)) {
      issues.push({
        severity: 'error',
        recipeId: id,
        path: `parts[${i}].op`,
        message: `Unsupported mesh op "${String(part.op)}"`,
      });
    }
    collectParamAndExprIssues(part.when, params, id, `parts[${i}].when`, issues);
    collectParamAndExprIssues(part.args, params, id, `parts[${i}].args`, issues);
    collectParamAndExprIssues(part.transform, params, id, `parts[${i}].transform`, issues);
    collectParamAndExprIssues(part.repeat, params, id, `parts[${i}].repeat`, issues);
    collectParamAndExprIssues(part.params, params, id, `parts[${i}].params`, issues);
    collectParamAndExprIssues(part.vertexMeta, params, id, `parts[${i}].vertexMeta`, issues);

    if (part.op === 'ref') {
      if (!part.ref || typeof part.ref !== 'string') {
        issues.push({
          severity: 'error',
          recipeId: id,
          path: `parts[${i}].ref`,
          message: 'ref part must specify target mesh id',
        });
      } else if (knownMeshIds && !knownMeshIds.has(part.ref)) {
        issues.push({
          severity: 'error',
          recipeId: id,
          path: `parts[${i}].ref`,
          message: `ref targets unknown mesh "${part.ref}"`,
        });
      }
      if (part.materialOverrides) {
        for (const [k, v] of Object.entries(part.materialOverrides)) {
          if (typeof v === 'string' && v.startsWith('$')) {
            const slot = v.slice(1);
            if (!slotNames.has(slot)) {
              issues.push({
                severity: 'error',
                recipeId: id,
                path: `parts[${i}].materialOverrides.${k}`,
                message: `Unknown material slot "${v}"`,
              });
            }
          } else if (knownMaterialIds && !knownMaterialIds.has(v)) {
            issues.push({
              severity: 'error',
              recipeId: id,
              path: `parts[${i}].materialOverrides.${k}`,
              message: `Override references unknown material "${v}"`,
            });
          }
        }
      }
    } else {
      if (!part.material) {
        issues.push({
          severity: 'error',
          recipeId: id,
          path: `parts[${i}].material`,
          message: 'Non-ref part must specify a material or $slot',
        });
      } else if (part.material.startsWith('$')) {
        const slot = part.material.slice(1);
        if (!slotNames.has(slot)) {
          issues.push({
            severity: 'error',
            recipeId: id,
            path: `parts[${i}].material`,
            message: `Unknown material slot "${part.material}"`,
          });
        }
      } else if (knownMaterialIds && !knownMaterialIds.has(part.material)) {
        issues.push({
          severity: 'error',
          recipeId: id,
          path: `parts[${i}].material`,
          message: `Unknown material "${part.material}"`,
        });
      }
    }
  }

  return issues;
}

export function validateProceduralSet(
  manifest: ProceduralManifest,
  materials: Map<string, MaterialRecipe>,
  meshes: Map<string, MeshRecipe>
): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (manifest.format !== 'hgame.manifest' || manifest.version !== 1) {
    issues.push({
      severity: 'error',
      recipeId: 'manifest',
      path: 'format',
      message: 'Expected format="hgame.manifest" and version=1',
    });
  }

  const matIds = new Set(materials.keys());
  const meshIds = new Set(meshes.keys());

  for (const entry of manifest.materials ?? []) {
    if (!matIds.has(entry.id)) {
      issues.push({
        severity: 'error',
        recipeId: 'manifest',
        path: `materials.${entry.id}`,
        message: `Manifest material "${entry.id}" missing from loaded materials`,
      });
    }
  }
  for (const entry of manifest.meshes ?? []) {
    if (!meshIds.has(entry.id)) {
      issues.push({
        severity: 'error',
        recipeId: 'manifest',
        path: `meshes.${entry.id}`,
        message: `Manifest mesh "${entry.id}" missing from loaded meshes`,
      });
    }
  }

  for (const mat of materials.values()) {
    issues.push(...validateMaterialRecipe(mat));
  }
  for (const mesh of meshes.values()) {
    issues.push(...validateMeshRecipe(mesh, matIds, meshIds));
  }

  // Detect ref cycles across meshes
  const color = new Map<string, number>();
  const hasRefCycle = (id: string): boolean => {
    const c = color.get(id) ?? 0;
    if (c === 1) return true;
    if (c === 2) return false;
    color.set(id, 1);
    const mesh = meshes.get(id);
    if (mesh) {
      for (const p of mesh.parts) {
        if (p.op === 'ref' && p.ref && hasRefCycle(p.ref)) return true;
      }
    }
    color.set(id, 2);
    return false;
  };
  for (const id of meshes.keys()) {
    if (hasRefCycle(id)) {
      issues.push({
        severity: 'error',
        recipeId: id,
        path: 'parts.ref',
        message: `Cyclic ref detected involving mesh "${id}"`,
      });
      break;
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { valid: errors.length === 0, errors, warnings };
}

const EVAL_FORBIDDEN_RE = /\beval\s*\(|\bnew\s+Function\s*\(/;

export function auditSourcesNoEval(
  files: ReadonlyArray<{ path: string; content: string }>
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const file of files) {
    // Strip single-line and block comments so documentation notes don't false-positive.
    const stripped = file.content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    if (EVAL_FORBIDDEN_RE.test(stripped)) {
      issues.push({
        severity: 'error',
        recipeId: 'security-audit',
        path: file.path,
        message: 'Forbidden dynamic execution (eval or new Function) detected',
      });
    }
  }
  return issues;
}
