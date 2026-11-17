# Ability timelines

Set `timeline` on an ability to author animation, impact and recovery in one place. `commitAt` is the point at which the ability rechecks its requirements, pays its costs and calls `execute`. `duration` includes the time after commitment during which the actor remains busy. Both use seconds measured by the existing fixed-step scheduler.

```js
import { GameplayComponent } from '../vendor/hgame/gameplay/index.js';

// The abilities object can come from the same JSON that defines the actor.
const abilities = {
  strike: {
    costs: { energy: 10 },
    cooldown: 0.7,
    blockedTags: ['State.Stunned'],
    timeline: {
      clip: 'strike',
      commitAt: 0.22,
      duration: 0.48,
      cues: [
        { at: 0.05, id: 'windup', data: { sound: 'swing' } },
        { at: 0.22, id: 'impact' },
      ],
    },
  },
};

let playingActivation = null;
const gameplay = hero.addComponent(new GameplayComponent({
  attributes: { energy: { base: 40, min: 0, max: 40 } },
  abilities,
  execute({ id, phase, target }) {
    if (id === 'strike' && phase === 'activate') resolveStrike(hero, target);
  },
  onTimeline(event) {
    if (event.type === 'start') {
      playingActivation = event.activation;
      if (event.clip) clips.play(event.clip, { restart: true });
    } else if (event.type === 'cue') {
      if (event.cue === 'windup' && typeof event.data?.sound === 'string') audio?.playCue(event.data.sound);
      if (event.cue === 'impact') vfx.emitHitImpact({ x: hero.x, y: hero.y });
    } else if (event.activation === playingActivation) {
      playingActivation = null;
      clips.play('idle');
    }
  },
}));

gameplay.actor.abilities.tryActivate('strike', { target: selectedTarget });
```

In the 2D example, `clips` is a configured `AnimationPlayer` whose frame index drives the sprite. In 3D, start the named model clip with `model.play(event.clip, { loop: false })` and use `model.play('idle', { loop: true })` when the activation ends or is cancelled. Set the authored animation duration to the desired skill duration with the sprite clip's FPS or the model playback options. Keep project-specific hit detection in `execute`.

| Field or event | Behavior |
|---|---|
| `timeline.commitAt` and `timeline.duration` | Replace `castTime` and `channelTime` for this ability. An optional `channelInterval` still ticks during the time after commit. |
| `start` | Begin presentation for this activation. `activation` identifies the run within its ability system. |
| `cue` | Deliver each marker once, in timestamp order. A cue at `commitAt` follows successful commitment. Cues before that point may render anticipation. |
| `end` / `cancel` | Complete recovery or stop the activation. When a cast fails admission at commit, later cues are discarded and a cancellation reason is sent. |
| `abilities.getState(id).timeline` | Active elapsed time, duration, commit point and optional clip name for UI or game code. |

The fixed step delivers cues when it crosses their timestamps and preserves insertion order for cues sharing a timestamp. A step that crosses the commit point also advances recovery against the original start. A visual renderer can skip drawing a frame without losing a simulation cue. Ability saves retain cooldown and charge state; active timelines, presentation callbacks and target references are transient.
