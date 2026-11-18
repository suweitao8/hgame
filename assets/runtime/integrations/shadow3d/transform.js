export function readWorldPosition(node, out) {
  if (typeof node?.getWorldPosition === 'function') {
    node.getWorldPosition(out);
  } else {
    const position = node?.position;
    out.set(position?.x ?? 0, position?.y ?? 0, position?.z ?? 0);
  }
  return out;
}

export function writeWorldPosition(node, x, y, z, scratch) {
  if (!node?.position?.set) return;
  scratch.set(x, y, z);
  node.parent?.worldToLocal?.(scratch);
  node.position.set(scratch.x, scratch.y, scratch.z);
  node.updateMatrixWorld?.(true);
}
