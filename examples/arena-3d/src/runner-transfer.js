function indexBones(root) {
  const bones = new Map();
  root.traverse(node => {
    if (!node.isBone) return;
    bones.set(node.name, bones.has(node.name) ? null : node);
  });
  return bones;
}

function findBone(bones, name, clip) {
  if (!bones.has(name)) throw new Error(clip + ' bone ' + name + ' is missing');
  const bone = bones.get(name);
  if (!bone) throw new Error(clip + ' bone ' + name + ' is ambiguous');
  return bone;
}

// Transfer local pose deltas between the authored runner rigs. The two rigs
// have equivalent articulation, with different rest rotations and proportions.
export function transferRunnerClips(THREE, source, target, { bones, root, motionScale = 1 }) {
  if (!Number.isFinite(motionScale) || motionScale <= 0) throw new RangeError('Runner motionScale must be positive and finite');
  const sourceBones = indexBones(source.scene);
  const targetBones = indexBones(target);
  const sanitize = THREE.PropertyBinding.sanitizeNodeName;
  const mapped = new Map();
  const usedTargets = new Set();
  for (const [sourceName, targetName] of Object.entries(bones)) {
    const from = sanitize(sourceName);
    const to = sanitize(targetName);
    if (mapped.has(from) || usedTargets.has(to)) throw new Error('Duplicate runner bone mapping: ' + from + ' to ' + to);
    mapped.set(from, to);
    usedTargets.add(to);
  }
  const motionBone = root ? sanitize(root) : null;
  const pose = new THREE.Quaternion();
  const delta = new THREE.Vector3();
  return source.animations.map(clip => {
    const tracks = [];
    for (const track of clip.tracks) {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
      if (propertyName !== 'quaternion' && !(propertyName === 'position' && nodeName === motionBone)) continue;
      if (track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline) {
        throw new Error(clip.name + ' track ' + nodeName + ' must use linear or stepped interpolation');
      }
      const destination = mapped.get(nodeName);
      if (!destination) throw new Error(clip.name + ' track ' + nodeName + ' has no target mapping');
      const from = findBone(sourceBones, nodeName, clip.name);
      const to = findBone(targetBones, destination, clip.name);
      const next = track.clone();
      next.name = to.name + '.' + propertyName;
      const values = next.values;
      if (propertyName === 'quaternion') {
        const restCorrection = to.quaternion.clone().multiply(from.quaternion.clone().invert());
        for (let i = 0; i < values.length; i += 4) {
          pose.fromArray(values, i).premultiply(restCorrection).normalize().toArray(values, i);
        }
      } else {
        for (let i = 0; i < values.length; i += 3) {
          delta.fromArray(values, i).sub(from.position).multiplyScalar(motionScale).add(to.position).toArray(values, i);
        }
      }
      tracks.push(next);
    }
    if (!tracks.length) throw new Error(clip.name + ' has no transferable runner tracks');
    return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
  });
}
