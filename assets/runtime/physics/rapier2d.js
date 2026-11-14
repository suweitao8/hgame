import * as RAPIER from '../vendor/rapier2d/rapier2d.mjs';
import { createRapierPhysicsWorldClass } from './rapier-world.js';

/** 2D deterministic Rapier world class. @type {import('./rapier-world.js').RapierPhysicsWorldConstructor} */
export const RapierPhysicsWorld2D = createRapierPhysicsWorldClass(RAPIER, 2);
/** Pinned Rapier 2D engine version. @type {string} */
export const RAPIER2D_VERSION = RAPIER.version();
