import * as RAPIER from '../vendor/rapier3d/rapier3d.mjs';
import { createRapierPhysicsWorldClass } from './rapier-world.js';

/** 3D deterministic Rapier world class. @type {import('./rapier-world.js').RapierPhysicsWorldConstructor} */
export const RapierPhysicsWorld3D = createRapierPhysicsWorldClass(RAPIER, 3);
/** Pinned Rapier 3D engine version. @type {string} */
export const RAPIER3D_VERSION = RAPIER.version();
