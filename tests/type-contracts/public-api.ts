import { Component, Entity, Scene, HGame, createGameApplication, createStateMachine, createVersionedStore,
  action, condition, createBehaviorTree, sequence, parallel, wait, BT_STATUS, createVfxSystem,
  createStatelessParticlePool, createTrailsSystem, createTelegraphSystem, createFloatingTextPool,
  createScreenFeedbackPass, createPanelStack } from '../../types/index.js';
import type { GameApplication } from '../../types/core/application.js';
import { createStateMachine as createMachineByPath } from '../../types/ai/fsm.js';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type ExpectFalse<T extends false> = T;
type ExpectTrue<T extends true> = T;

const machine = createStateMachine({
  initial: 'idle', context: { hp: 100 },
  states: { idle: { onUpdate(ctx, dt) {
    ctx.hp -= dt;
    // @ts-expect-error callback context has the supplied shape
    ctx.missing = 1;
  } } },
});
const state: string = machine.update(0.016);
const hp: number = machine.getContext().hp;
machine.send('hit', { damage: 5 });
machine.transitionTo('idle');
machine.reset();
type StateDtTyped = ExpectFalse<IsAny<Parameters<typeof machine.update>[0]>>;
type StateReturnTyped = ExpectFalse<IsAny<ReturnType<typeof machine.update>>>;
type StatePayloadTyped = ExpectFalse<IsAny<Parameters<typeof machine.send>[1]>>;
// @ts-expect-error dt must be a number
machine.update('16');
// @ts-expect-error event names must be strings
machine.send(5);
// @ts-expect-error state identifiers must be strings
machine.isIn(7);
const subpath = createMachineByPath({ initial: 'idle', states: { idle: {} } });
const subpathState: string = subpath.getState();

type Blackboard = { attacks: number };
type AiContext = { damage: number };
const strike = action((bb: Blackboard, context: AiContext, dt: number) => {
  bb.attacks += context.damage * dt;
  return BT_STATUS.SUCCESS;
});
const tree = createBehaviorTree(sequence(condition((bb: Blackboard) => bb.attacks < 10), wait(0.1), strike), {
  blackboard: { attacks: 0 }, context: { damage: 3 },
});
const status: 'success' | 'failure' | 'running' = tree.tick(0.016);
const attacks: number = tree.blackboard.attacks;
parallel(strike, wait(0.1));
parallel('any', strike, wait(0.1));
type TreeReturnTyped = ExpectFalse<IsAny<ReturnType<typeof tree.tick>>>;
type TreeBlackboardTyped = ExpectFalse<IsAny<typeof tree.blackboard.attacks>>;
// @ts-expect-error invalid children cannot become runnable nodes
sequence(12);
// @ts-expect-error action leaves return a status, boolean or void
action(() => 123);
// @ts-expect-error predicates return booleans
condition(() => 'yes');
// @ts-expect-error tick accepts seconds as a number
tree.tick('0.1');

const saves = createVersionedStore<{ hp: number }>({ gameId: 'typed-game' });
saves.save('slot', { hp: 90 });
saves.set('slot', { hp: 80 });
const loaded = saves.load('slot', null);
if (loaded.ok) {
  const savedHp: number = loaded.value.hp;
  const version: number = loaded.version;
} else {
  const fallback: null = loaded.value;
  const reason: string = loaded.reason;
}
const optional = saves.load('slot');
if (!optional.ok) { const missing: undefined = optional.value; }
type SaveKeyTyped = ExpectFalse<IsAny<Parameters<typeof saves.save>[0]>>;
type SaveValueTyped = ExpectFalse<IsAny<Parameters<typeof saves.save>[1]>>;
type LoadValueTyped = ExpectFalse<IsAny<typeof loaded.value>>;
// @ts-expect-error slot names must be strings
saves.save(1, { hp: 20 });
// @ts-expect-error saved state follows the declared schema
saves.save('slot', { hp: 'full' });

class Driver extends Component {
  override fixedUpdate(dt: number, _app: GameApplication) {
    if (this.entity) this.entity.x += dt;
  }
}
const scene = new Scene('main');
const entity = scene.add(new Entity({ name: 'hero' }));
const component = entity.addComponent(new Driver());
type DetachedSceneIsNullable = ExpectTrue<null extends typeof component.scene ? true : false>;
type DetachedOwnerIsNullable = ExpectTrue<null extends typeof component.gameObject ? true : false>;
const app = createGameApplication({ renderer: { render() {} } });
app.scenes.add(scene);
app.scenes.start('main');
app.step(0.016);
app.dispose();
HGame.createApplication({ renderer: { render() {} } });
type FacadeApplicationTyped = ExpectFalse<IsAny<ReturnType<typeof HGame.createApplication>>>;
// @ts-expect-error lifecycle step accepts seconds as a number
app.step('0.016');
// @ts-expect-error invalid time-scale values are rejected by the contract
app.setTimeScale('fast');
// @ts-expect-error component callbacks use the application lifecycle signature
component.fixedUpdate('0.016', app);

const effects = createVfxSystem({ mode: 'headless', maxParticles: 200, maxFloatingGlyphs: 100 });
effects.emitHitImpact({ damage: 3, hitstopSec: 0.04, shakeIntensity: 0.5 });
createStatelessParticlePool({ mode: 'headless', THREE: {}, scene: {} });
createTrailsSystem({ mode: 'headless', THREE: {}, scene: {} });
createTelegraphSystem({ mode: 'headless', THREE: {}, scene: {} });
createFloatingTextPool({ mode: 'headless', THREE: {}, scene: {} });
createScreenFeedbackPass({ mode: 'headless', THREE: {}, scene: {} });
const panels = createPanelStack();
panels.push('shop', { coins: 10 }, { modal: true });
panels.replace('pause', { paused: true });
panels.toggle('inventory', ['sword']);
