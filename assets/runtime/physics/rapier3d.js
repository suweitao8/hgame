import * as RAPIER from '../vendor/rapier3d/rapier3d.mjs';
import { createRapierPhysicsWorldClass } from './rapier-world.js';

export const RapierPhysicsWorld3D = createRapierPhysicsWorldClass(RAPIER, 3);
export const RAPIER3D_VERSION = RAPIER.version();
