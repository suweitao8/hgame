import { Document, NodeIO } from '@gltf-transform/core';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class GeomAccumulator {
  positions = [];
  normals = [];
  uvs = [];
  indices = [];

  addBox(cx, cy, cz, sx, sy, sz, { worldUv = true, tile = 1.0 } = {}) {
    const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
    const faces = [
      { n: [0, 1, 0], pts: [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]], uv: (x, y, z) => [x, z] },
      { n: [0, -1, 0], pts: [[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]], uv: (x, y, z) => [x, z] },
      { n: [1, 0, 0], pts: [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], uv: (x, y, z) => [z, y] },
      { n: [-1, 0, 0], pts: [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], uv: (x, y, z) => [z, y] },
      { n: [0, 0, 1], pts: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], uv: (x, y, z) => [x, y] },
      { n: [0, 0, -1], pts: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], uv: (x, y, z) => [x, y] },
    ];
    for (const f of faces) {
      const base = this.positions.length / 3;
      const worldPts = [];
      for (let i = 0; i < 4; i++) {
        const px = cx + f.pts[i][0];
        const py = cy + f.pts[i][1];
        const pz = cz + f.pts[i][2];
        worldPts.push([px, py, pz]);
        this.positions.push(px, py, pz);
        this.normals.push(f.n[0], f.n[1], f.n[2]);
        if (worldUv) {
          const [u, v] = f.uv(px, py, pz);
          this.uvs.push(u / tile, v / tile);
        } else {
          this.uvs.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
        }
      }
      const ax = worldPts[1][0] - worldPts[0][0], ay = worldPts[1][1] - worldPts[0][1], az = worldPts[1][2] - worldPts[0][2];
      const bx = worldPts[2][0] - worldPts[0][0], by = worldPts[2][1] - worldPts[0][1], bz = worldPts[2][2] - worldPts[0][2];
      const dot = (ay * bz - az * by) * f.n[0] + (az * bx - ax * bz) * f.n[1] + (ax * by - ay * bx) * f.n[2];
      if (dot >= 0) {
        this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      } else {
        this.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
  }

  addCylinder(cx, cy, cz, rBot, rTop, h, radialSeg = 10, { tiltX = 0, tiltZ = 0, uScale = 1 } = {}) {
    const base = this.positions.length / 3;
    const hy = h * 0.5;
    for (let ring = 0; ring <= 1; ring++) {
      const yLocal = ring === 0 ? -hy : hy;
      const r = ring === 0 ? rBot : rTop;
      const offX = ring === 1 ? tiltX : 0;
      const offZ = ring === 1 ? tiltZ : 0;
      for (let s = 0; s <= radialSeg; s++) {
        const u = s / radialSeg;
        const a = u * Math.PI * 2;
        const nx = Math.cos(a), nz = Math.sin(a);
        this.positions.push(cx + offX + nx * r, cy + yLocal, cz + offZ + nz * r);
        this.normals.push(nx, 0.15, nz);
        this.uvs.push(u * uScale, (yLocal + hy) / Math.max(0.25, h));
      }
    }
    const stride = radialSeg + 1;
    for (let s = 0; s < radialSeg; s++) {
      const i0 = base + s;
      const i1 = base + s + 1;
      const i2 = base + stride + s + 1;
      const i3 = base + stride + s;
      // Outward CCW winding around +Y cylinder
      this.indices.push(i0, i3, i2, i0, i2, i1);
    }
  }

  addCrossLeafCluster(cx, cy, cz, rx, ry, rz, yaw = 0) {
    const planes = [yaw, yaw + Math.PI * 0.33, yaw + Math.PI * 0.67];
    for (const ang of planes) {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const base = this.positions.length / 3;
      const pts = [
        [-rx, -ry, 0], [rx, -ry, 0], [rx, ry, 0], [-rx, ry, 0],
      ];
      for (let i = 0; i < 4; i++) {
        const lx = pts[i][0], ly = pts[i][1], lz = pts[i][2];
        const px = cx + lx * ca - lz * sa;
        const pz = cz + lx * sa + lz * ca;
        this.positions.push(px, cy + ly, pz);
        this.normals.push(-sa * 0.4, 0.9, ca * 0.4);
        this.uvs.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
      }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  addDisplacedRock(cx, cy, cz, rx, ry, rz, seed = 77) {
    const rng = mulberry32(seed);
    const lat = 10, lon = 14;
    const base = this.positions.length / 3;
    const phases = Array.from({ length: 6 }, () => rng() * Math.PI * 2);
    const pts = [];
    for (let i = 0; i <= lat; i++) {
      const v = i / lat;
      const phi = v * Math.PI;
      for (let j = 0; j <= lon; j++) {
        const u = j / lon;
        const th = u * Math.PI * 2;
        const dirX = Math.sin(phi) * Math.cos(th);
        const dirY = Math.cos(phi);
        const dirZ = Math.sin(phi) * Math.sin(th);
        const disp = 1.0
          + 0.16 * Math.sin(dirX * 3.1 + phases[0]) * Math.cos(dirZ * 2.7 + phases[1])
          + 0.10 * Math.cos(dirY * 4.3 + phases[2]) * Math.sin(dirX * 3.9 + phases[3])
          + 0.06 * Math.sin((dirX + dirY + dirZ) * 6.0 + phases[4]);
        const py = Math.max(-ry * 0.85, dirY * ry * disp);
        const px = dirX * rx * disp;
        const pz = dirZ * rz * disp;
        pts.push([cx + px, cy + py, cz + pz, u * 2, v * 2]);
      }
    }
    const stride = lon + 1;
    const getIdx = (i, j) => i * stride + j;
    // Build flat-shaded boulders so faceted stone normals look crisp
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const a = pts[getIdx(i, j)];
        const b = pts[getIdx(i + 1, j)];
        const c = pts[getIdx(i + 1, j + 1)];
        const d = pts[getIdx(i, j + 1)];
        const pushTri = (p1, p2, p3) => {
          const ux = p2[0] - p1[0], uy = p2[1] - p1[1], uz = p2[2] - p1[2];
          const vx = p3[0] - p1[0], vy = p3[1] - p1[1], vz = p3[2] - p1[2];
          let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len; ny /= len; nz /= len;
          const idx = this.positions.length / 3;
          for (const p of [p1, p2, p3]) {
            this.positions.push(p[0], p[1], p[2]);
            this.normals.push(nx, ny, nz);
            this.uvs.push(p[3], p[4]);
          }
          this.indices.push(idx, idx + 1, idx + 2);
        };
        if (i !== 0) pushTri(a, b, d);
        if (i !== lat - 1) pushTri(d, b, c);
      }
    }
    void base;
  }
}

function makePrimitive(doc, buffer, acc, matName, { doubleSide = false, alphaMode = 'OPAQUE', baseColor = [1, 1, 1, 1], roughness = 0.78, metallic = 0.0, emissive = [0, 0, 0] } = {}) {
  const mat = doc.createMaterial(matName)
    .setBaseColorFactor(baseColor)
    .setRoughnessFactor(roughness)
    .setMetallicFactor(metallic)
    .setEmissiveFactor(emissive)
    .setDoubleSided(doubleSide)
    .setAlphaMode(alphaMode);

  const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(acc.positions)).setBuffer(buffer);
  const nrm = doc.createAccessor().setType('VEC3').setArray(new Float32Array(acc.normals)).setBuffer(buffer);
  const uv = doc.createAccessor().setType('VEC2').setArray(new Float32Array(acc.uvs)).setBuffer(buffer);
  const idx = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(acc.indices)).setBuffer(buffer);

  return doc.createPrimitive()
    .setAttribute('POSITION', pos)
    .setAttribute('NORMAL', nrm)
    .setAttribute('TEXCOORD_0', uv)
    .setIndices(idx)
    .setMaterial(mat);
}

function buildTreeOakDoc() {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const rng = mulberry32(101);
  const barkAcc = new GeomAccumulator();
  barkAcc.addCylinder(0, 1.35, 0, 0.34, 0.21, 2.7, 10, { tiltX: 0.08, tiltZ: -0.05 });
  barkAcc.addCylinder(0.42, 2.7, 0.18, 0.16, 0.09, 1.1, 8, { tiltX: 0.55, tiltZ: 0.25 });
  barkAcc.addCylinder(-0.38, 2.6, -0.22, 0.15, 0.08, 1.0, 8, { tiltX: -0.5, tiltZ: -0.3 });

  const leafAcc = new GeomAccumulator();
  const canopyCenters = [
    [0, 3.25, 0, 1.25], [0.95, 2.95, 0.45, 0.95], [-0.9, 2.9, -0.4, 0.95],
    [0.3, 3.0, -0.85, 0.88], [-0.35, 3.1, 0.85, 0.88], [0, 3.85, 0, 0.95],
  ];
  for (const [cx, cy, cz, rad] of canopyCenters) {
    for (let k = 0; k < 5; k++) {
      leafAcc.addCrossLeafCluster(
        cx + (rng() - 0.5) * rad * 0.7,
        cy + (rng() - 0.5) * rad * 0.55,
        cz + (rng() - 0.5) * rad * 0.7,
        rad * 0.65, rad * 0.58, rad * 0.65, rng() * Math.PI
      );
    }
  }
  const node = doc.createNode('oak_tree').setMesh(
    doc.createMesh('oak_tree_mesh')
      .addPrimitive(makePrimitive(doc, buf, barkAcc, 'bark', { roughness: 0.88 }))
      .addPrimitive(makePrimitive(doc, buf, leafAcc, 'leaves', { doubleSide: true, alphaMode: 'MASK', roughness: 0.72 }))
  );
  scene.addChild(node);
  return doc;
}

function buildTreePineDoc() {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const rng = mulberry32(202);
  const barkAcc = new GeomAccumulator();
  barkAcc.addCylinder(0, 2.2, 0, 0.26, 0.07, 4.4, 9);

  const leafAcc = new GeomAccumulator();
  for (let tier = 0; tier < 5; tier++) {
    const y = 1.65 + tier * 0.74;
    const rad = 1.45 - tier * 0.24;
    const count = 6 - Math.floor(tier / 2);
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + tier * 0.5;
      leafAcc.addCrossLeafCluster(
        Math.cos(a) * rad * 0.45,
        y,
        Math.sin(a) * rad * 0.45,
        rad * 0.58, 0.46, rad * 0.58, a + rng() * 0.5
      );
    }
  }
  leafAcc.addCrossLeafCluster(0, 4.95, 0, 0.42, 0.52, 0.42, 0.3);

  const node = doc.createNode('pine_tree').setMesh(
    doc.createMesh('pine_tree_mesh')
      .addPrimitive(makePrimitive(doc, buf, barkAcc, 'bark', { roughness: 0.88 }))
      .addPrimitive(makePrimitive(doc, buf, leafAcc, 'leaves', { doubleSide: true, alphaMode: 'MASK', roughness: 0.74 }))
  );
  scene.addChild(node);
  return doc;
}

function buildBoulderDoc() {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene('Scene');
  const rockAcc = new GeomAccumulator();
  rockAcc.addDisplacedRock(0, 0.65, 0, 0.92, 0.68, 0.84, 515);
  scene.addChild(doc.createNode('boulder').setMesh(
    doc.createMesh('boulder_mesh').addPrimitive(makePrimitive(doc, buf, rockAcc, 'stone', { roughness: 0.86 }))
  ));
  return doc;
}

function buildChestDoc() {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene('Scene');

  const baseWood = new GeomAccumulator();
  baseWood.addBox(0, 0.27, 0, 0.84, 0.54, 0.84);
  const baseMetal = new GeomAccumulator();
  baseMetal.addBox(0, 0.51, 0, 0.86, 0.06, 0.86);
  baseMetal.addBox(0, 0.14, 0, 0.86, 0.05, 0.86);

  // Hinge pivot strictly at back upper rim (0, 0.54, -0.42) so rotating chest_lid around X opens lid!
  const lidWood = new GeomAccumulator();
  lidWood.addBox(0, 0.13, 0.42, 0.84, 0.26, 0.84);
  const lidMetal = new GeomAccumulator();
  lidMetal.addBox(0, 0.04, 0.855, 0.14, 0.18, 0.06); // brass/iron front latch

  const baseNode = doc.createNode('chest_base').setMesh(
    doc.createMesh('chest_base_mesh')
      .addPrimitive(makePrimitive(doc, buf, baseWood, 'wood', { roughness: 0.72 }))
      .addPrimitive(makePrimitive(doc, buf, baseMetal, 'metal', { roughness: 0.36, metallic: 0.88 }))
  );
  const lidNode = doc.createNode('chest_lid')
    .setTranslation([0, 0.54, -0.42])
    .setMesh(
      doc.createMesh('chest_lid_mesh')
        .addPrimitive(makePrimitive(doc, buf, lidWood, 'wood', { roughness: 0.72 }))
        .addPrimitive(makePrimitive(doc, buf, lidMetal, 'metal', { roughness: 0.34, metallic: 0.90 }))
    );

  const root = doc.createNode('chest_root').addChild(baseNode).addChild(lidNode);
  scene.addChild(root);
  return doc;
}

function buildDoorOakDoc() {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene('Scene');

  const frameAcc = new GeomAccumulator();
  frameAcc.addBox(-0.46, 1.0, 0, 0.08, 2.0, 0.16);
  frameAcc.addBox(0.46, 1.0, 0, 0.08, 2.0, 0.16);
  frameAcc.addBox(0, 1.96, 0, 0.84, 0.08, 0.16);

  // Leaf pivot at left inner jamb (-0.42, 0, 0) for Y-axis rotation 0 -> 90 deg
  const leafWood = new GeomAccumulator();
  leafWood.addBox(0.42, 0.96, 0, 0.84, 1.92, 0.09);
  const leafMetal = new GeomAccumulator();
  leafMetal.addBox(0.74, 0.96, 0.06, 0.07, 0.18, 0.04);
  leafMetal.addBox(0.74, 0.96, -0.06, 0.07, 0.18, 0.04);

  const frameNode = doc.createNode('door_frame').setMesh(
    doc.createMesh('door_frame_mesh').addPrimitive(makePrimitive(doc, buf, frameAcc, 'frame', { roughness: 0.76 }))
  );
  const leafNode = doc.createNode('door_leaf')
    .setTranslation([-0.42, 0, 0])
    .setMesh(
      doc.createMesh('door_leaf_mesh')
        .addPrimitive(makePrimitive(doc, buf, leafWood, 'wood', { roughness: 0.72 }))
        .addPrimitive(makePrimitive(doc, buf, leafMetal, 'metal', { roughness: 0.32, metallic: 0.9 }))
    );

  scene.addChild(doc.createNode('door_root').addChild(frameNode).addChild(leafNode));
  return doc;
}

function buildFurnaceDoc() {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene('Scene');

  const bodyAcc = new GeomAccumulator();
  bodyAcc.addBox(0, 0.14, 0, 0.98, 0.28, 0.98);
  bodyAcc.addBox(0, 0.82, 0, 0.98, 0.36, 0.98);
  bodyAcc.addBox(-0.34, 0.46, 0, 0.30, 0.36, 0.98);
  bodyAcc.addBox(0.34, 0.46, 0, 0.30, 0.36, 0.98);
  bodyAcc.addBox(0, 0.46, -0.22, 0.38, 0.36, 0.54);

  const darkAcc = new GeomAccumulator();
  darkAcc.addBox(0, 1.0, 0, 0.72, 0.04, 0.72);

  const coreAcc = new GeomAccumulator();
  coreAcc.addBox(0, 0.42, 0.24, 0.36, 0.30, 0.36);

  const bodyNode = doc.createNode('furnace_body').setMesh(
    doc.createMesh('furnace_body_mesh')
      .addPrimitive(makePrimitive(doc, buf, bodyAcc, 'body', { roughness: 0.85 }))
      .addPrimitive(makePrimitive(doc, buf, darkAcc, 'dark', { roughness: 0.88 }))
  );
  const coreNode = doc.createNode('furnace_core').setMesh(
    doc.createMesh('furnace_core_mesh')
      .addPrimitive(makePrimitive(doc, buf, coreAcc, 'core', { roughness: 0.45, emissive: [1.0, 0.32, 0.05] }))
  );

  scene.addChild(doc.createNode('furnace_root').addChild(bodyNode).addChild(coreNode));
  return doc;
}

function buildWorkbenchDoc() {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene('Scene');

  const topAcc = new GeomAccumulator();
  topAcc.addBox(0, 0.92, 0, 0.98, 0.16, 0.98);
  const sideAcc = new GeomAccumulator();
  for (const [lx, lz] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) {
    sideAcc.addBox(lx, 0.42, lz, 0.16, 0.84, 0.16);
  }
  sideAcc.addBox(0, 0.32, 0, 0.72, 0.08, 0.72);
  const trimAcc = new GeomAccumulator();
  trimAcc.addBox(-0.46, 0.92, 0.18, 0.06, 0.18, 0.24);

  scene.addChild(doc.createNode('workbench_root').setMesh(
    doc.createMesh('workbench_mesh')
      .addPrimitive(makePrimitive(doc, buf, topAcc, 'top', { roughness: 0.68 }))
      .addPrimitive(makePrimitive(doc, buf, sideAcc, 'side', { roughness: 0.74 }))
      .addPrimitive(makePrimitive(doc, buf, trimAcc, 'trim', { roughness: 0.35, metallic: 0.9 }))
  ));
  return doc;
}

function buildTorchDoc() {
  const doc = new Document();
  const buf = doc.createBuffer();
  const scene = doc.createScene('Scene');

  const handleAcc = new GeomAccumulator();
  handleAcc.addBox(0, 0.28, 0, 0.11, 0.56, 0.11);
  const headAcc = new GeomAccumulator();
  headAcc.addBox(0, 0.63, 0, 0.14, 0.16, 0.14);

  scene.addChild(
    doc.createNode('torch_root')
      .addChild(doc.createNode('torch_handle').setMesh(
        doc.createMesh('torch_handle_mesh').addPrimitive(makePrimitive(doc, buf, handleAcc, 'handle', { roughness: 0.85 }))
      ))
      .addChild(doc.createNode('torch_head').setMesh(
        doc.createMesh('torch_head_mesh').addPrimitive(makePrimitive(doc, buf, headAcc, 'head', { roughness: 0.4, emissive: [1.0, 0.45, 0.08] }))
      ))
  );
  return doc;
}

export async function generateRawPropGlb(generatorName, outPath) {
  const builders = {
    tree_oak: buildTreeOakDoc,
    tree_pine: buildTreePineDoc,
    boulder: buildBoulderDoc,
    chest: buildChestDoc,
    door_oak: buildDoorOakDoc,
    furnace: buildFurnaceDoc,
    workbench: buildWorkbenchDoc,
    torch: buildTorchDoc,
  };
  const builder = builders[generatorName];
  if (!builder) throw new Error(`Unknown prop generator "${generatorName}"`);
  const doc = builder();
  const io = new NodeIO();
  await io.write(outPath, doc);
}
