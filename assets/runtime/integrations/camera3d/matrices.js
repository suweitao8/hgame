const WEBGPU_COORDINATE_SYSTEM = 2001;

export function usesZeroToOneDepth(camera) {
  return camera?.reversedDepth === true || camera?.coordinateSystem === WEBGPU_COORDINATE_SYSTEM;
}

export function syncCameraWorldMatrices(camera) {
  if (typeof camera.updateWorldMatrix === 'function') {
    camera.updateWorldMatrix(true, false);
    // Native Camera updates the view matrix, including Three's camera scale policy.
    if (camera.isCamera === true) return;
  } else {
    camera.updateMatrixWorld?.(true);
  }
  if (camera.matrixWorld && typeof camera.matrixWorldInverse?.copy === 'function') {
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert?.();
  }
}
