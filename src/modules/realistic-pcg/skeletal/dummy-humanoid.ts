import * as THREE from 'three';

export interface DummyHumanoidResult {
  root: THREE.Group;
  animations: THREE.AnimationClip[];
}

interface SkinnedPartSpec {
  geom: THREE.BufferGeometry;
  boneIndex: number;
  offset: [number, number, number];
  colorHex: number;
}

function mergeSkinnedParts(
  parts: SkinnedPartSpec[],
  bones: THREE.Bone[]
): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[] = [];

  // Ensure bone world matrices are computed in bind pose (root at origin)
  bones[0]!.updateMatrixWorld(true);
  const tmpColor = new THREE.Color();
  const tmpVec = new THREE.Vector3();

  for (const part of parts) {
    const bone = bones[part.boneIndex]!;
    const boneWorldPos = new THREE.Vector3();
    boneWorldPos.setFromMatrixPosition(bone.matrixWorld);
    tmpColor.setHex(part.colorHex);

    const g = part.geom;
    const posAttr = g.getAttribute('position')!;
    const nrmAttr = g.getAttribute('normal')!;
    const uvAttr = g.getAttribute('uv');
    const idxAttr = g.getIndex();
    const baseVert = positions.length / 3;

    for (let i = 0; i < posAttr.count; i++) {
      tmpVec.set(
        posAttr.getX(i) + part.offset[0] + boneWorldPos.x,
        posAttr.getY(i) + part.offset[1] + boneWorldPos.y,
        posAttr.getZ(i) + part.offset[2] + boneWorldPos.z
      );
      positions.push(tmpVec.x, tmpVec.y, tmpVec.z);
      normals.push(nrmAttr.getX(i), nrmAttr.getY(i), nrmAttr.getZ(i));
      uvs.push(uvAttr ? uvAttr.getX(i) : 0, uvAttr ? uvAttr.getY(i) : 0);
      colors.push(tmpColor.r, tmpColor.g, tmpColor.b);
      skinIndices.push(part.boneIndex, 0, 0, 0);
      skinWeights.push(1, 0, 0, 0);
    }

    if (idxAttr) {
      for (let i = 0; i < idxAttr.count; i++) {
        indices.push(idxAttr.array[i]! + baseVert);
      }
    } else {
      for (let i = 0; i < posAttr.count; i++) {
        indices.push(baseVert + i);
      }
    }
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(positions), 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(normals), 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(uvs), 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(colors), 3));
  out.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(skinIndices), 4));
  out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Float32Array(skinWeights), 4));
  out.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(indices), 1));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * Generates an articulated 1.75m procedural humanoid using 2 GPU-skinned DrawCalls
 * (cloth/leather/skin + metallic armor) and hierarchical Idle + Walk AnimationClips.
 */
export function createDummyHumanoid(): DummyHumanoidResult {
  const root = new THREE.Group();
  root.name = 'DummyHumanoid';

  const hips = new THREE.Bone(); hips.name = 'Hips'; hips.position.set(0, 0.92, 0);
  const spine = new THREE.Bone(); spine.name = 'Spine'; spine.position.set(0, 0.14, 0); hips.add(spine);
  const chest = new THREE.Bone(); chest.name = 'Chest'; chest.position.set(0, 0.24, 0); spine.add(chest);
  const head = new THREE.Bone(); head.name = 'Head'; head.position.set(0, 0.24, 0); chest.add(head);
  const leftArm = new THREE.Bone(); leftArm.name = 'LeftArm'; leftArm.position.set(-0.23, 0.16, 0); chest.add(leftArm);
  const leftForearm = new THREE.Bone(); leftForearm.name = 'LeftForearm'; leftForearm.position.set(0, -0.27, 0); leftArm.add(leftForearm);
  const rightArm = new THREE.Bone(); rightArm.name = 'RightArm'; rightArm.position.set(0.23, 0.16, 0); chest.add(rightArm);
  const rightForearm = new THREE.Bone(); rightForearm.name = 'RightForearm'; rightForearm.position.set(0, -0.27, 0); rightArm.add(rightForearm);
  const leftThigh = new THREE.Bone(); leftThigh.name = 'LeftThigh'; leftThigh.position.set(-0.1, -0.04, 0); hips.add(leftThigh);
  const leftShin = new THREE.Bone(); leftShin.name = 'LeftShin'; leftShin.position.set(0, -0.44, 0); leftThigh.add(leftShin);
  const rightThigh = new THREE.Bone(); rightThigh.name = 'RightThigh'; rightThigh.position.set(0.1, -0.04, 0); hips.add(rightThigh);
  const rightShin = new THREE.Bone(); rightShin.name = 'RightShin'; rightShin.position.set(0, -0.44, 0); rightThigh.add(rightShin);

  const bones = [
    hips, spine, chest, head,
    leftArm, leftForearm, rightArm, rightForearm,
    leftThigh, leftShin, rightThigh, rightShin,
  ];
  root.add(hips);

  const bodyParts: SkinnedPartSpec[] = [
    { geom: new THREE.BoxGeometry(0.28, 0.14, 0.18), boneIndex: 0, offset: [0, 0.02, 0], colorHex: 0x5c3c28 },
    { geom: new THREE.BoxGeometry(0.26, 0.24, 0.17), boneIndex: 1, offset: [0, 0.1, 0], colorHex: 0x3b5842 },
    { geom: new THREE.BoxGeometry(0.34, 0.25, 0.2), boneIndex: 2, offset: [0, 0.06, 0], colorHex: 0x3b5842 },
    { geom: new THREE.SphereGeometry(0.11, 14, 12), boneIndex: 3, offset: [0, 0.11, 0], colorHex: 0xc29375 },
    { geom: new THREE.CylinderGeometry(0.055, 0.048, 0.27, 10), boneIndex: 4, offset: [0, -0.135, 0], colorHex: 0x3b5842 },
    { geom: new THREE.CylinderGeometry(0.045, 0.038, 0.25, 10), boneIndex: 5, offset: [0, -0.125, 0], colorHex: 0x5c3c28 },
    { geom: new THREE.CylinderGeometry(0.055, 0.048, 0.27, 10), boneIndex: 6, offset: [0, -0.135, 0], colorHex: 0x3b5842 },
    { geom: new THREE.CylinderGeometry(0.045, 0.038, 0.25, 10), boneIndex: 7, offset: [0, -0.125, 0], colorHex: 0x5c3c28 },
    { geom: new THREE.CylinderGeometry(0.075, 0.062, 0.42, 10), boneIndex: 8, offset: [0, -0.21, 0], colorHex: 0x3b5842 },
    { geom: new THREE.CylinderGeometry(0.058, 0.05, 0.38, 10), boneIndex: 9, offset: [0, -0.19, 0], colorHex: 0x5c3c28 },
    { geom: new THREE.BoxGeometry(0.1, 0.08, 0.22), boneIndex: 9, offset: [0, -0.4, 0.04], colorHex: 0x452d1e },
    { geom: new THREE.CylinderGeometry(0.075, 0.062, 0.42, 10), boneIndex: 10, offset: [0, -0.21, 0], colorHex: 0x3b5842 },
    { geom: new THREE.CylinderGeometry(0.058, 0.05, 0.38, 10), boneIndex: 11, offset: [0, -0.19, 0], colorHex: 0x5c3c28 },
    { geom: new THREE.BoxGeometry(0.1, 0.08, 0.22), boneIndex: 11, offset: [0, -0.4, 0.04], colorHex: 0x452d1e },
  ];

  const armorParts: SkinnedPartSpec[] = [
    { geom: new THREE.BoxGeometry(0.08, 0.06, 0.2), boneIndex: 0, offset: [0, 0.06, 0.01], colorHex: 0x8b9097 },
    { geom: new THREE.BoxGeometry(0.18, 0.14, 0.22), boneIndex: 2, offset: [0, 0.09, 0], colorHex: 0x8b9097 },
    { geom: new THREE.CylinderGeometry(0.125, 0.13, 0.11, 14), boneIndex: 3, offset: [0, 0.16, 0], colorHex: 0x8b9097 },
  ];

  // Intentional mild plastic gloss (roughness=0.28) on body before Tripo normalization clamps it
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.28,
    metalness: 0.06,
  });
  const armorMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.24,
    metalness: 0.88,
  });

  const bodyGeo = mergeSkinnedParts(bodyParts, bones);
  const armorGeo = mergeSkinnedParts(armorParts, bones);

  const skeleton = new THREE.Skeleton(bones);

  const bodyMesh = new THREE.SkinnedMesh(bodyGeo, bodyMat);
  bodyMesh.name = 'DummyBody';
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  bodyMesh.bind(skeleton);

  const armorMesh = new THREE.SkinnedMesh(armorGeo, armorMat);
  armorMesh.name = 'DummyArmor';
  armorMesh.castShadow = true;
  armorMesh.receiveShadow = true;
  armorMesh.bind(skeleton);

  root.add(bodyMesh);
  root.add(armorMesh);

  const qIdentity = [0, 0, 0, 1];
  const qChestUp = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.04, 0, 0));
  const qArmIdleL = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06, 0, 0.08));
  const qArmIdleR = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.04, 0, -0.08));

  const idleClip = new THREE.AnimationClip('Idle', 2.4, [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 1.2, 2.4], [0, 0.92, 0, 0, 0.938, 0, 0, 0.92, 0]),
    new THREE.QuaternionKeyframeTrack('Chest.quaternion', [0, 1.2, 2.4], [
      ...qIdentity,
      qChestUp.x, qChestUp.y, qChestUp.z, qChestUp.w,
      ...qIdentity,
    ]),
    new THREE.QuaternionKeyframeTrack('LeftArm.quaternion', [0, 1.2, 2.4], [
      qArmIdleL.x, qArmIdleL.y, qArmIdleL.z, qArmIdleL.w,
      0, 0, 0.06, 1,
      qArmIdleL.x, qArmIdleL.y, qArmIdleL.z, qArmIdleL.w,
    ]),
    new THREE.QuaternionKeyframeTrack('RightArm.quaternion', [0, 1.2, 2.4], [
      qArmIdleR.x, qArmIdleR.y, qArmIdleR.z, qArmIdleR.w,
      0, 0, -0.06, 1,
      qArmIdleR.x, qArmIdleR.y, qArmIdleR.z, qArmIdleR.w,
    ]),
  ]);

  const qFwd = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0, 0));
  const qBwd = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0, 0));
  const qKnee = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.45, 0, 0));
  const walkClip = new THREE.AnimationClip('Walk', 1.2, [
    new THREE.VectorKeyframeTrack('Hips.position', [0, 0.3, 0.6, 0.9, 1.2], [
      0, 0.91, 0, 0, 0.94, 0, 0, 0.91, 0, 0, 0.94, 0, 0, 0.91, 0,
    ]),
    new THREE.QuaternionKeyframeTrack('LeftThigh.quaternion', [0, 0.6, 1.2], [
      qFwd.x, qFwd.y, qFwd.z, qFwd.w,
      qBwd.x, qBwd.y, qBwd.z, qBwd.w,
      qFwd.x, qFwd.y, qFwd.z, qFwd.w,
    ]),
    new THREE.QuaternionKeyframeTrack('RightThigh.quaternion', [0, 0.6, 1.2], [
      qBwd.x, qBwd.y, qBwd.z, qBwd.w,
      qFwd.x, qFwd.y, qFwd.z, qFwd.w,
      qBwd.x, qBwd.y, qBwd.z, qBwd.w,
    ]),
    new THREE.QuaternionKeyframeTrack('LeftShin.quaternion', [0, 0.3, 0.6, 1.2], [
      ...qIdentity,
      qKnee.x, qKnee.y, qKnee.z, qKnee.w,
      ...qIdentity,
      ...qIdentity,
    ]),
    new THREE.QuaternionKeyframeTrack('LeftArm.quaternion', [0, 0.6, 1.2], [
      qBwd.x, qBwd.y, qBwd.z, qBwd.w,
      qFwd.x, qFwd.y, qFwd.z, qFwd.w,
      qBwd.x, qBwd.y, qBwd.z, qBwd.w,
    ]),
    new THREE.QuaternionKeyframeTrack('RightArm.quaternion', [0, 0.6, 1.2], [
      qFwd.x, qFwd.y, qFwd.z, qFwd.w,
      qBwd.x, qBwd.y, qBwd.z, qBwd.w,
      qFwd.x, qFwd.y, qFwd.z, qFwd.w,
    ]),
  ]);

  return { root, animations: [idleClip, walkClip] };
}
