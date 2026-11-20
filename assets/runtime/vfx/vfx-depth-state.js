// The order matches UnityEngine.Rendering.CompareFunction for material imports.
export const VFX_DEPTH_TESTS = Object.freeze([
  'disabled', 'never', 'less', 'equal', 'less-equal', 'greater', 'not-equal', 'greater-equal', 'always',
]);
export const DEFAULT_VFX_DEPTH_TEST = 4;

const THREE_DEPTH_FUNCTIONS = [
  'LessEqualDepth', 'NeverDepth', 'LessDepth', 'EqualDepth', 'LessEqualDepth',
  'GreaterDepth', 'NotEqualDepth', 'GreaterEqualDepth', 'AlwaysDepth',
];

export function getVfxDepthTestIndex(value) {
  const index = VFX_DEPTH_TESTS.indexOf(value);
  return index < 0 ? DEFAULT_VFX_DEPTH_TEST : index;
}

export function applyVfxDepthState(material, THREE, testIndex, write) {
  material.depthTest = testIndex !== 0;
  material.depthWrite = material.depthTest && write;
  const depthFunc = THREE?.[THREE_DEPTH_FUNCTIONS[testIndex]];
  if (depthFunc !== undefined) material.depthFunc = depthFunc;
}
