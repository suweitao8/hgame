import test from 'node:test';
import assert from 'node:assert/strict';
import { createBgmController } from '../assets/runtime/platform/audio/bgm-player.js';

/** Minimal media element: records calls, lets a test deliver metadata and control play(). */
class FakeAudio {
  static instances = [];
  /** When set, every play() returns this promise instead of resolving. */
  static pendingPlay = null;

  constructor() {
    this.src = '';
    this.loop = false;
    this.preload = '';
    this.currentTime = 0;
    this.paused = true;
    this.metadataDuration = NaN;
    this.calls = { play: 0, pause: 0, load: 0 };
    this.listeners = new Map();
    FakeAudio.instances.push(this);
  }

  get duration() {
    return this.metadataDuration;
  }

  removeAttribute(name) {
    this[name] = '';
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }

  emit(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type });
  }

  /** Deliver `loadedmetadata`, which is when a media element exposes its duration. */
  loadMetadata(duration) {
    this.metadataDuration = duration;
    this.emit('loadedmetadata');
  }

  play() {
    this.calls.play += 1;
    this.paused = false;
    return FakeAudio.pendingPlay ?? Promise.resolve();
  }

  pause() {
    this.calls.pause += 1;
    this.paused = true;
  }

  load() {
    this.calls.load += 1;
  }
}

/** Audio graph double: records connections, decodes and gain automation. */
function createHarness() {
  const log = { decoded: 0, fetches: [], mediaSources: [] };

  class Param {
    constructor(value = 1) {
      this.value = value;
      this.events = [];
    }
    setValueAtTime(value, time) {
      this.events.push(['set', value, time]);
      this.value = value;
    }
    linearRampToValueAtTime(value, time) {
      this.events.push(['ramp', value, time]);
    }
    cancelScheduledValues(time) {
      this.events.push(['cancel', time]);
    }
  }

  class Node {
    constructor(kind) {
      this.kind = kind;
      this.gain = kind === 'gain' ? new Param(1) : undefined;
      this.connections = [];
      this.disconnections = 0;
    }
    connect(target) {
      this.connections.push(target);
    }
    disconnect() {
      this.disconnections += 1;
    }
  }

  const busNodes = new Map();
  const audioCtx = {
    currentTime: 0,
    createGain: () => new Node('gain'),
    createBufferSource() {
      const node = new Node('buffer-source');
      node.stops = [];
      node.start = () => {};
      node.stop = (time) => node.stops.push(time);
      return node;
    },
    createMediaElementSource(element) {
      const node = new Node('media-source');
      node.element = element;
      log.mediaSources.push(node);
      return node;
    },
    decodeAudioData: async (arrayBuffer) => {
      log.decoded += 1;
      return { duration: arrayBuffer.byteLength / 1000, getChannelData: () => null };
    },
  };
  const ctx = {
    context: audioCtx,
    unlock: async () => audioCtx,
    getCachedAnalysis: () => ({ analyzable: false }),
    getBusNode: (name) => {
      if (!busNodes.has(name)) busNodes.set(name, new Node(`bus:${name}`));
      return busNodes.get(name);
    },
    master: new Node('master'),
  };
  const buses = { setBusVolume: () => true, getBusVolume: () => 1 };
  const fetchImpl = async (url) => {
    log.fetches.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(3000) };
  };

  return { log, audioCtx, busNodes, player: createBgmController(ctx, buses), fetchImpl };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {(helpers: { fake: () => FakeAudio, log: object, player: object, fetchImpl: Function, busNodes: Map, audioCtx: object }) => Promise<void>} run */
async function withStreaming(run) {
  const previous = globalThis.Audio;
  globalThis.Audio = FakeAudio;
  try {
    const harness = createHarness();
    await run({ ...harness, fake: () => FakeAudio.instances.at(-1) });
  } finally {
    globalThis.Audio = previous;
    FakeAudio.instances = [];
  }
}

test('a URL cue of unknown length streams through a media element and never decodes', async () => {
  await withStreaming(async ({ player, log, fake, busNodes, fetchImpl }) => {
    player.registerBgmCue('bgm.field', { url: '/audio/bgm/field.mp3', gainDb: -20 });

    const result = await player.playBgm('bgm.field', { fadeMs: 100, volume: 0.5, fetchImpl });
    assert.equal(result.streaming, true);
    assert.equal(result.state, 'playing');
    assert.equal(log.decoded, 0, 'nothing is decoded into an AudioBuffer');
    assert.deepEqual(log.fetches, [], 'the controller does not download the file itself');

    const element = fake();
    assert.equal(element.src, '/audio/bgm/field.mp3');
    assert.equal(element.loop, true);
    assert.equal(element.preload, 'auto');
    assert.equal(element.calls.play, 1);

    // The element feeds the engine's bgm bus behind the same gain automation as decoded cues.
    const [source] = log.mediaSources;
    assert.equal(source.element, element);
    assert.equal(source.connections[0].kind, 'gain');
    const gainNode = source.connections[0];
    assert.equal(gainNode.connections[0], busNodes.get('bgm'));
    // -20 dB cue gain at half volume, faded in over 100 ms.
    const [fadeIn, ramp] = gainNode.gain.events;
    assert.deepEqual([fadeIn[0], fadeIn[2]], ['set', 0]);
    assert.ok(Math.abs(fadeIn[1] - 0.0001) < 1e-9);
    assert.deepEqual([ramp[0], ramp[2]], ['ramp', 0.1]);
    assert.ok(Math.abs(ramp[1] - 0.05) < 1e-9);

    const state = player.getBgmState();
    assert.equal(state.streaming, true);
    assert.equal(state.state, 'playing');
    assert.equal(state.activeBufferCount, 0);
    assert.equal(state.bufferDuration, 0);

    element.loadMetadata(95);
    assert.equal(player.getBgmState().duration, 95);
    assert.equal(player.getBgmState().loopEnd, 95);

    // Re-entry guard behaves as for decoded cues.
    const again = await player.playBgm('bgm.field', { fetchImpl });
    assert.deepEqual([again.ignored, again.state], [true, 'playing']);
    assert.equal(FakeAudio.instances.length, 1);
  });
});

test('short, buffered and opt-out cues keep the decoded path', async () => {
  await withStreaming(async ({ player, log, fetchImpl }) => {
    player.registerBgmCue('bgm.short', { url: '/audio/bgm/short.mp3', durationSec: 4 });
    player.registerBgmCue('bgm.optout', { url: '/audio/bgm/long.mp3', stream: false });
    player.registerBgmCue('bgm.tablestream', { url: '/audio/bgm/table.mp3', durationSec: 3, preload: 'stream' });

    for (const cueId of ['bgm.short', 'bgm.optout']) {
      const result = await player.playBgm(cueId, { fetchImpl });
      assert.equal(result.streaming, false, cueId);
      assert.equal(player.getBgmState().streaming, false, cueId);
      assert.equal(player.getBgmState().activeBufferCount, 1, cueId);
      player.stopBgm({ fadeMs: 0 });
    }
    assert.equal(FakeAudio.instances.length, 0, 'none of these cues touched a media element');
    assert.equal(log.decoded, 2);

    // A preloaded buffer always plays from memory, whatever its length or stream flag say.
    const buffer = { duration: 120, getChannelData: () => null };
    const fromBuffer = await player.playBgm({ cueName: 'bgm.memory', url: '/audio/bgm/ignored.mp3', buffer, durationSec: 120 }, { fetchImpl });
    assert.equal(fromBuffer.streaming, false);
    assert.equal(log.decoded, 2, 'a cue that carries a buffer is not decoded again');
    player.stopBgm({ fadeMs: 0 });

    // `preload: "stream"` and an explicit `stream: true` both opt a short cue back in.
    const fromTable = await player.playBgm('bgm.tablestream', { fetchImpl });
    assert.equal(fromTable.streaming, true);
    player.stopBgm({ fadeMs: 0 });
    const forced = await player.playBgm({ cueName: 'bgm.short', url: '/audio/bgm/x.mp3', durationSec: 3, stream: true }, { fetchImpl });
    assert.equal(forced.streaming, true);
    player.stopBgm({ fadeMs: 0 });
  });
});

test('trim points at the file bounds stream; a window inside the file decodes', async () => {
  // Shaped like every entry of the built music table: the points skip MP3 encoder padding.
  const tableCue = { url: '/audio/bgm/loop.mp3', durationSec: 74.7309, trimStartSec: 0.025057, trimEndSec: 74.755957, preload: 'stream' };
  // The media timeline excludes that padding, so the element is about 50 ms shorter.
  const mediaDuration = 74.6807;

  await withStreaming(async ({ player, log, fake, fetchImpl }) => {
    player.registerBgmCue('bgm.loop', tableCue);
    const result = await player.playBgm('bgm.loop', { fetchImpl });
    assert.equal(result.streaming, true);
    assert.equal(log.decoded, 0);

    const element = fake();
    assert.equal(element.currentTime, 0, 'media playback starts at the first audible sample');
    element.loadMetadata(mediaDuration);
    const state = player.getBgmState();
    assert.deepEqual([state.loopStart, state.loopEnd, state.duration], [0, mediaDuration, mediaDuration]);
    await player.seekBgm(999);
    assert.ok(Math.abs(element.currentTime - (mediaDuration - 0.02)) < 1e-9, 'a seek stays inside the track');
  });

  // A window inside the file needs buffer-level loop points, which media elements lack.
  await withStreaming(async ({ player, log, fetchImpl }) => {
    player.registerBgmCue('bgm.window', { ...tableCue, url: '/audio/bgm/window.mp3', trimStartSec: 12 });
    const result = await player.playBgm('bgm.window', { fetchImpl });
    assert.equal(result.streaming, false);
    assert.equal(FakeAudio.instances.length, 0, 'the window is recognised before any element is created');
    assert.equal(log.decoded, 1);
    // The 3 s test buffer cannot hold a window starting at 12 s, so it is clamped to its end.
    assert.ok(Math.abs(result.loopStart - 2.95) < 1e-9, 'the decoded path applies the window start');
  });

  // Without a declared length the decision waits for the element's metadata.
  await withStreaming(async ({ player, log, fake, fetchImpl }) => {
    const { durationSec, ...unknownLength } = tableCue;
    player.registerBgmCue('bgm.unknown', { ...unknownLength, url: '/audio/bgm/unknown.mp3' });
    let created = FakeAudio.instances.length;
    const starting = player.playBgm('bgm.unknown', { fetchImpl });
    await deliverMetadata(created, mediaDuration);
    const result = await starting;
    assert.equal(result.streaming, true, 'points at the bounds of a file of unknown length still stream');
    assert.equal(log.decoded, 0);

    player.stopBgm({ fadeMs: 0 });
    player.registerBgmCue('bgm.unknownWindow', { ...unknownLength, url: '/audio/bgm/unknown_window.mp3', trimEndSec: 10 });
    created = FakeAudio.instances.length;
    const windowStart = player.playBgm('bgm.unknownWindow', { fetchImpl });
    await deliverMetadata(created, mediaDuration);
    const decoded = await windowStart;
    assert.equal(decoded.streaming, false, 'a window found at metadata time hands over to the decoded path');
    assert.equal(log.decoded, 1);
    assert.equal(fake().calls.load, 1, 'the probing element is released');
  });
});

test('environments without media elements, or without the audio hook, decode as before', async () => {
  const previous = globalThis.Audio;
  try {
    delete globalThis.Audio;
    const bare = createHarness();
    bare.player.registerBgmCue('bgm.field', { url: '/audio/bgm/field.mp3' });
    const result = await bare.player.playBgm('bgm.field', { fetchImpl: bare.fetchImpl });
    assert.equal(result.streaming, false);
    assert.equal(bare.log.decoded, 1);

    // An AudioContext that cannot route a media element into the graph also falls back.
    globalThis.Audio = FakeAudio;
    const noHook = createHarness();
    delete noHook.audioCtx.createMediaElementSource;
    noHook.player.registerBgmCue('bgm.field', { url: '/audio/bgm/field.mp3' });
    const fallback = await noHook.player.playBgm('bgm.field', { fetchImpl: noHook.fetchImpl });
    assert.equal(fallback.streaming, false);
    assert.equal(noHook.log.decoded, 1);
  } finally {
    globalThis.Audio = previous;
    FakeAudio.instances = [];
    FakeAudio.pendingPlay = null;
  }
})

const tick = async (times = 10) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

/** Let a start-up create its element and listen for metadata, then deliver a length to that element. */
async function deliverMetadata(instanceCount, duration) {
  const ready = () => FakeAudio.instances.length > instanceCount
    && Boolean(FakeAudio.instances.at(-1).listeners.get('loadedmetadata')?.length);
  for (let i = 0; i < 200 && !ready(); i++) await Promise.resolve();
  assert.ok(ready(), 'the element is listening for its metadata');
  FakeAudio.instances.at(-1).loadMetadata(duration);
};

test('pause, lifecycle resume and seek act on the element and keep its single source node', async () => {
  await withStreaming(async ({ player, log, fake, fetchImpl }) => {
    player.registerBgmCue('bgm.field', { url: '/audio/bgm/field.mp3' });
    await player.playBgm('bgm.field', { fetchImpl });
    const element = fake();
    element.loadMetadata(80);
    element.currentTime = 12.5;

    assert.equal(player.pauseBgm({ fromLifecycle: true }), true);
    assert.equal(element.calls.pause, 1);
    assert.equal(player.getBgmState().state, 'paused');
    assert.equal(player.getBgmState().pausedPositionSec, 12.5);
    // A media element can only be routed once, so pausing must not tear the graph down.
    assert.equal(log.mediaSources[0].disconnections, 0);

    assert.equal(await player.resumeBgm(), true, 'an explicit resume also clears a lifecycle pause');
    assert.equal(element.calls.play, 2);
    assert.equal(player.getBgmState().state, 'playing');
    assert.equal(log.mediaSources.length, 1);

    // A lifecycle resume only answers a lifecycle pause.
    assert.equal(await player.resumeBgm({ fromLifecycle: true }), false);
    assert.equal(element.calls.play, 2);

    element.currentTime = 40;
    assert.equal(player.getBgmState().currentTimeSec, 40, 'position comes from the element itself');

    assert.ok(Math.abs((await player.seekBgm(100)) - 79.98) < 1e-9);
    assert.ok(Math.abs(element.currentTime - 79.98) < 1e-9);
    await player.seekBgm(-5);
    assert.equal(element.currentTime, 0);
  });
});

test('stopping releases the element, and a failed or superseded start leaves no track behind', async () => {
  await withStreaming(async ({ player, fake, fetchImpl }) => {
    player.registerBgmCue('bgm.field', { url: '/audio/bgm/field.mp3' });

    await player.playBgm('bgm.field', { fetchImpl });
    const first = fake();
    assert.equal(player.stopBgm({ fadeMs: 0 }), true);
    assert.equal(first.calls.pause, 1);
    assert.equal(first.calls.load, 1);
    assert.equal(first.src, '', 'the media resource is detached so its decoder can be reclaimed');
    assert.equal(player.getBgmState().state, 'idle');

    // A faded stop keeps the element under its ramp, then releases it.
    await player.playBgm('bgm.field', { forceRestart: true, fetchImpl });
    const fading = fake();
    player.stopBgm({ fadeMs: 20 });
    assert.equal(fading.calls.load, 0);
    assert.equal(player.getBgmState().fadingCount, 1);
    await sleep(120);
    assert.equal(fading.calls.load, 1);
    assert.equal(player.getBgmState().fadingCount, 0);

    // The browser refusing playback surfaces to the caller and resets the controller.
    FakeAudio.pendingPlay = Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }));
    await assert.rejects(player.playBgm('bgm.field', { fetchImpl }), /not allowed/);
    assert.equal(fake().calls.load, 1);
    assert.equal(player.getBgmState().state, 'idle');

    // Stopping while play() is still pending aborts it; that is not an error.
    let abortPlay;
    FakeAudio.pendingPlay = new Promise((_, reject) => {
      abortPlay = () => reject(Object.assign(new Error('interrupted'), { name: 'AbortError' }));
    });
    const starting = player.playBgm('bgm.field', { fetchImpl });
    await tick();
    const pending = fake();
    assert.equal(pending.calls.play, 1);
    player.stopBgm({ fadeMs: 0 });
    FakeAudio.pendingPlay = null;
    abortPlay();
    assert.equal(await starting, null);
    assert.equal(player.getBgmState().state, 'idle');

    // A media error during playback clears the track instead of reporting dead audio as playing.
    await player.playBgm('bgm.field', { fetchImpl });
    const broken = fake();
    broken.emit('error');
    assert.equal(player.getBgmState().state, 'idle');
    assert.equal(broken.calls.load, 1);
  });
});

test('a stream and a decoded cue crossfade into each other', async () => {
  await withStreaming(async ({ player, log, fake, fetchImpl }) => {
    player.registerBgmCue('bgm.short', { url: '/audio/bgm/short.mp3', durationSec: 4 });
    player.registerBgmCue('bgm.long', { url: '/audio/bgm/long.mp3' });

    const decoded = await player.playBgm('bgm.short', { fadeMs: 0, fetchImpl });
    assert.equal(decoded.streaming, false);

    const streamed = await player.playBgm('bgm.long', { fadeMs: 20, fetchImpl });
    assert.equal(streamed.streaming, true);
    assert.equal(player.getBgmState().fadingCount, 1);
    assert.equal(player.getBgmState().activeBufferCount, 1, 'the decoded cue is still audible under its fade');
    await sleep(120);
    assert.equal(player.getBgmState().activeBufferCount, 0, 'the decoded buffer is released once its fade ends');
    assert.equal(player.getBgmState().fadingCount, 0);

    const back = await player.playBgm('bgm.short', { fadeMs: 20, fetchImpl });
    assert.equal(back.streaming, false);
    assert.equal(player.getBgmState().fadingCount, 1);
    const retired = fake();
    await sleep(120);
    assert.equal(retired.calls.load, 1, 'the streaming element is released after its fade');
    assert.equal(player.getBgmState().fadingCount, 0);
  });
});
