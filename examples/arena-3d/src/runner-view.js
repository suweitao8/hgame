import { transferRunnerClips } from './runner-transfer.js';

const ROLES = ['idle', 'run', 'jump', 'spin', 'hit'];

export function validateRunnerClips(animations, bindings) {
  const available = animations.map(clip => clip.name).join(', ');
  const result = {};
  for (const role of ROLES) {
    const name = bindings?.[role];
    const matches = animations.filter(clip => clip.name === name);
    if (matches.length !== 1 || !(matches[0].duration > 0)) {
      const reason = matches.length > 1 ? 'ambiguous' : 'missing or empty';
      throw new Error(`Runner clip for ${role} ("${name ?? ''}") is ${reason}. Available: ${available}`);
    }
    result[role] = name;
  }
  return result;
}

export async function loadRunnerView({ provider, scene, Entity, record, getTick, signal, manifest = 'src/assets/runner.json' }) {
  let path = manifest;
  let actor = null;
  try {
    const response = await fetch(path, { signal });
    if (!response.ok) throw new Error(`Runner manifest HTTP ${response.status}`);
    const spec = await response.json();
    if (signal?.aborted) return null;
    path = spec.path ?? path;
    const [asset, source] = await Promise.all([
      provider.load(path),
      spec.transfer ? provider.load(spec.transfer.source).catch(error => {
        throw new Error('Animation source ' + spec.transfer.source + ' failed: ' + (error?.message ?? error), { cause: error });
      }) : null,
    ]);
    if (signal?.aborted) return null;
    if (provider.inspect(asset).meshCount === 0) throw new Error('Runner asset has no renderable meshes');
    const animations = source ? transferRunnerClips(provider.THREE, source, asset.scene, spec.transfer) : asset.animations;
    const clips = validateRunnerClips(animations, spec.clips);
    actor = scene.add(new Entity({ name: 'runner-model' }));
    let role = 'idle';
    const model = provider.createComponent({
      asset,
      animations,
      clip: clips.idle,
      targetHeight: spec.targetHeight,
      alignGround: true,
      castShadow: true,
      crossFadeSeconds: 0.1,
      notifies: { [clips.spin]: [{ name: 'spin.arc', normalizedTime: 0.5 }] },
      onNotify(event) {
        if (role !== 'spin') return;
        record?.({
          tick: getTick(), type: 'animation.notify', subject: 'runner',
          details: { clip: event.clipName, name: event.name },
        });
      },
    });
    actor.addComponent(model);
    record?.({ tick: getTick(), type: 'asset.ready', subject: path, details: { clips: animations.length, transferred: Boolean(source) } });

    return {
      get role() { return role; },
      sync(player, state, invulnerabilitySeconds) {
        actor.x = player.x;
        actor.y = player.y;
        actor.z = player.z;
        actor.rotationY = player.yaw;
        model.updateTransform();
        let next = 'idle';
        if (player.invuln > invulnerabilitySeconds - 0.18) next = 'hit';
        else if (!state.over) {
          if (player.spinT > 0) next = 'spin';
          else if (!player.grounded) next = 'jump';
          else if (Math.hypot(player.vx, player.vz) > 0.6) next = 'run';
        }
        if (next === role) return;
        const options = { loop: next === 'idle' || next === 'run' };
        if (!model.play(clips[next], options)) return;
        role = next;
        record?.({
          tick: state.tick, type: 'animation.changed', subject: 'runner', details: { role, clip: clips[role] },
        });
      },
    };
  } catch (error) {
    if (signal?.aborted) return null;
    let reason = String(error?.message ?? error);
    try { actor?.destroy(); } catch (cleanupError) { reason += ` (cleanup failed: ${cleanupError?.message ?? cleanupError})`; }
    record?.({
      tick: getTick(), type: 'asset.failed', subject: path, details: { reason },
    });
    return null;
  }
}
