import * as RAPIER from '../vendor/rapier2d/rapier2d.mjs';
import { createRapierPhysicsWorldClass } from './rapier-world.js';

export const RapierPhysicsWorld2D = createRapierPhysicsWorldClass(RAPIER, 2);
export const RAPIER2D_VERSION = RAPIER.version();
