/**
 * Model3D public entry. Implementation lives in ./model3d/*.js.
 */

export { cloneObject3DWithSkins, inspectModel3D, prepareAnimationClips } from './model3d/helpers.js';
export { createModel3DProvider } from './model3d/provider.js';
export { createModelLod3D, injectDitherLodMaterial3D } from './model3d/lod.js';
export { createAnimationBudgetAllocator, createRepresentationBudget3D } from './model3d/budget.js';
export { createInstancedCrowd3D } from './model3d/crowd.js';
export {
  float32ToFloat16,
  float16ToFloat32,
  bakeBoneVatData,
  encodeBoneVatBinary,
  decodeBoneVatBinary,
  buildSimplifiedLodGeometry,
  createBoneVatCrowd3D,
} from './model3d/bone-vat.js';
export {
  createAvatarMask,
  createBlendTree1D,
  createBlendTree2D,
  createAnimator3D,
  solveTwoBoneIK,
  solveLookAtIK,
} from '../animation/animator3d.js';
