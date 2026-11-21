/**
 * Clean-room WebGL2 HDR post-processing pipeline (public entry).
 * Implementation lives in ./post3d/*.js; this file re-exports the public API.
 */

export { inspectWebGLCapabilities, refineQualityWithContext } from './post3d/capabilities.js';
export { computeWhiteBalanceRGB, evaluateFilmicCurveChannel, evaluateFilmicCurveRGB, stepEyeAdaptation } from './post3d/color.js';
export { createPostProcessVolumeStack } from './post3d/volumes.js';
export { createPostPipeline3D } from './post3d/pipeline.js';
export { createFullscreenShaderPass } from './post3d/fullscreen-shader.js';
export { compileRenderGraph, executeRenderGraph } from './post3d/render-graph.js';
