/** Multiply TRS matrices whose bottom row is [0, 0, 0, 1]. @param {Float64Array} out @param {Float64Array} a @param {Float64Array} b @returns {Float64Array} */
export function multiplyAffineInto(out: Float64Array, a: Float64Array, b: Float64Array): Float64Array;
/** @param {import('../core/entity.js').Entity} node @param {Float64Array} out @param {number} alpha @returns {Float64Array} */
export function writeEntityLocalMatrix(node: import("../core/entity.js").Entity, out: Float64Array, alpha: number): Float64Array;
