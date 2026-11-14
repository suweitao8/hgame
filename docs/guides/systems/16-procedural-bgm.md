# 4.16 0-KB Procedural SFX (`synth.js`) & Adaptive BGM (`bgm-synth.js`)

> Zero external `.mp3` dependencies: instant WebAudio sound effects + intensity-reactive multi-track chiptune/synth BGM.

- **Files**: `platform/audio.js`, `platform/audio/synth.js`, `platform/audio/bgm-synth.js`
- **When**: Prototyping or shipping lean games without external audio packs, or dynamic combat/boss intensity BGM.

```js
// Integrated via app.services.audio (requires 'audio' feature in engine.config.json)
const audio = app.services.audio;

// 10 built-in SFX presets: hit | slash | shoot | explosion | pickup | powerup | click | hurt | laser | jump
audio.playSynth('hit', { volume: 0.75, pitchJitter: 0.08 });

// 6 built-in BGM moods: dungeon | cyber | boss | chill | adventure | victory
const bgm = audio.createBgm({ mood: 'dungeon', intensity: 0.35, volume: 0.5 });
bgm.start();
// Escalate combat tension seamlessly (0.0 calm -> 1.0 full drums + arps):
bgm.setIntensity(0.95);
bgm.setMood('boss');
```

## Pitfalls
- WebAudio unlocks on first user pointer/key gesture; trigger `bgm.start()` inside input or let `createAudioManager` resume once unlocked.
- For deterministic headless tests without browser `AudioContext`, call `bgm.update(dt)` / `generateBgmStep(...)` directly.
