import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { createAudioManager } from '../assets/runtime/index.js';
import {
  parseBgmFilenameMeta,
  inferMusicCategory,
  shouldApplyVoiceSpaceEq,
  parseTailSilenceSec,
  evaluateMusicGate,
} from '../scripts/process-audio.mjs';

const execFileAsync = promisify(execFile);

/**
 * Writes a 16-bit stereo PCM WAV with optional leading silence, mid-track silence gap,
 * and trailing silence to test bidirectional head/tail silence trimming without over-trimming.
 */
async function writeSegmentedTestWav(filePath, {
  leadSilenceSec = 0,
  midGapAtSec = null,
  midGapDurSec = 0,
  tailSilenceSec = 0,
  totalDurationSec,
  sampleRate = 44100,
  channels = 2,
  amplitude = 0.28,
  bpm = 120,
} = {}) {
  const totalSamples = Math.round(totalDurationSec * sampleRate);
  const dataBytes = totalSamples * channels * 2;
  const buf = Buffer.alloc(44 + dataBytes);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  const beatSec = 60 / bpm;
  const activeEndSec = totalDurationSec - tailSilenceSec;
  let offset = 44;

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    const inLead = t < leadSilenceSec;
    const inTail = t >= activeEndSec;
    const inMidGap = midGapAtSec !== null && t >= midGapAtSec && t < (midGapAtSec + midGapDurSec);

    let sL = 0;
    let sR = 0;
    if (!inLead && !inTail && !inMidGap) {
      const beatPhase = (t % beatSec) / beatSec;
      const beatEnv = 0.4 + 0.6 * Math.exp(-beatPhase * 5);
      const toneL = (0.65 * Math.sin(2 * Math.PI * 220 * t) + 0.35 * Math.sin(2 * Math.PI * 440 * t)) * beatEnv * amplitude;
      const toneR = (0.65 * Math.sin(2 * Math.PI * 220 * t + 0.12) + 0.35 * Math.sin(2 * Math.PI * 330 * t)) * beatEnv * amplitude;
      sL = Math.max(-32767, Math.min(32767, Math.round(toneL * 32767)));
      sR = Math.max(-32767, Math.min(32767, Math.round(toneR * 32767)));
    }
    buf.writeInt16LE(sL, offset);
    offset += 2;
    if (channels > 1) {
      buf.writeInt16LE(sR, offset);
      offset += 2;
    }
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buf);
}

function createBgmMockAudioContextClass() {
  const created = {
    contexts: [],
    sources: [],
    gains: [],
  };

  class FakeParam {
    constructor(v = 1) {
      this.value = v;
      this.events = [];
    }
    cancelScheduledValues(t) { this.events.push(['cancel', t]); }
    setValueAtTime(v, t) { this.value = v; this.events.push(['set', v, t]); }
    linearRampToValueAtTime(v, t) { this.value = v; this.events.push(['ramp', v, t]); }
    setTargetAtTime(v, t, tc) { this.value = v; this.events.push(['target', v, t, tc]); }
  }

  class FakeAudioContext {
    constructor() {
      this.state = 'running';
      this.currentTime = 1.0;
      this.sampleRate = 44100;
      this.destination = { kind: 'destination' };
      this.listener = {};
      this.suspendCount = 0;
      this.resumeCount = 0;
      created.contexts.push(this);
    }
    async resume() { this.state = 'running'; this.resumeCount++; }
    async suspend() { this.state = 'suspended'; this.suspendCount++; }
    async close() { this.state = 'closed'; }
    async decodeAudioData(ab) {
      const view = new Float64Array(ab.slice(0, 8));
      const dur = Number.isFinite(view[0]) && view[0] > 0 ? view[0] : 48.0;
      return { duration: dur, sampleRate: 44100, length: Math.round(dur * 44100), numberOfChannels: 2 };
    }
    createGain() {
      const node = {
        gain: new FakeParam(1),
        connections: [],
        disconnected: false,
        connect(dest) { this.connections.push(dest); return dest; },
        disconnect() { this.disconnected = true; },
      };
      created.gains.push(node);
      return node;
    }
    createBiquadFilter() {
      return {
        type: 'lowpass',
        frequency: new FakeParam(22000),
        Q: new FakeParam(0.707),
        gain: new FakeParam(0),
        connect(dest) { return dest; },
        disconnect() {},
      };
    }
    createDynamicsCompressor() {
      return {
        threshold: { value: 0 },
        knee: { value: 0 },
        ratio: { value: 1 },
        attack: { value: 0 },
        release: { value: 0 },
        connect(dest) { return dest; },
      };
    }
    createBufferSource() {
      const listeners = [];
      const src = {
        buffer: null,
        loop: false,
        loopStart: 0,
        loopEnd: 0,
        playbackRate: { value: 1 },
        startCalls: [],
        stopCalls: [],
        disconnected: false,
        connect(dest) { return dest; },
        disconnect() { this.disconnected = true; },
        addEventListener(_ev, fn) { listeners.push(fn); },
        start(...args) { this.startCalls.push(args); },
        stop(...args) {
          this.stopCalls.push(args);
          for (const fn of listeners) fn();
        },
      };
      created.sources.push(src);
      return src;
    }
  }

  return { FakeAudioContext, created };
}

test('parseBgmFilenameMeta, inferMusicCategory, parseTailSilenceSec, and evaluateMusicGate enforce universal/game routing & QA rules', () => {
  const uBgm = parseBgmFilenameMeta('bgm_battle_fast_140bpm.wav', { kind: 'bgm', scope: 'universal' });
  assert.equal(uBgm.cueId, 'bgm.universal.battle_fast');
  assert.equal(uBgm.scope, 'universal');
  assert.equal(uBgm.kind, 'bgm');
  assert.equal(uBgm.category, 'battle');
  assert.equal(uBgm.bpm, 140);

  const gBgm = parseBgmFilenameMeta('bgm_boss_climax_150bpm.wav', { kind: 'bgm', scope: 'game:ninja_king' });
  assert.equal(gBgm.cueId, 'bgm.ninja_king.boss_climax');
  assert.equal(gBgm.scope, 'game:ninja_king');
  assert.equal(gBgm.category, 'boss');
  assert.equal(gBgm.bpm, 150);

  const uStinger = parseBgmFilenameMeta('stinger_victory.wav', { kind: 'stinger', scope: 'universal' });
  assert.equal(uStinger.cueId, 'stinger.universal.victory');
  assert.equal(uStinger.category, 'stinger');
  assert.equal(uStinger.bpm, null);

  assert.equal(inferMusicCategory('survival_cold', 'bgm'), 'survival');
  assert.equal(inferMusicCategory('main_lobby_theme', 'bgm'), 'lobby');
  assert.equal(inferMusicCategory('card_shop', 'bgm'), 'card');
  assert.equal(inferMusicCategory('emo_ambiguous', 'bgm'), 'romance');
  assert.equal(inferMusicCategory('emo_daily', 'bgm'), 'emotion');
  assert.equal(inferMusicCategory('emo_suspense', 'bgm'), 'suspense');
  assert.equal(inferMusicCategory('cmb_puzzle', 'bgm'), 'puzzle');
  assert.equal(inferMusicCategory('wld_explore', 'bgm'), 'explore');
  assert.equal(inferMusicCategory('cmb_urgent', 'bgm'), 'urgent');
  assert.equal(inferMusicCategory('cmb_final_zone', 'bgm'), 'urgent');
  assert.equal(inferMusicCategory('scifi_cyber_city', 'bgm'), 'scifi');
  assert.equal(inferMusicCategory('ink_bamboo_combat', 'bgm'), 'ink');
  assert.equal(inferMusicCategory('arcade_retro_rush', 'bgm'), 'arcade');
  assert.equal(inferMusicCategory('sys_result_victory', 'bgm'), 'result');
  assert.equal(inferMusicCategory('dark_delirium', 'bgm'), 'dungeon');

  assert.equal(shouldApplyVoiceSpaceEq(parseBgmFilenameMeta('bgm_emo_daily_100bpm.wav', { kind: 'bgm', scope: 'universal' })), true);
  assert.equal(shouldApplyVoiceSpaceEq(parseBgmFilenameMeta('bgm_cmb_battle_140bpm.wav', { kind: 'bgm', scope: 'universal' })), false);
  assert.equal(shouldApplyVoiceSpaceEq(parseBgmFilenameMeta('bgm_emo_daily_100bpm.wav', { kind: 'bgm', scope: 'universal' }), { voiceSpaceEq: false }), false);
  assert.equal(shouldApplyVoiceSpaceEq(parseBgmFilenameMeta('stinger_sys_victory.wav', { kind: 'stinger', scope: 'universal' })), false);

  assert.equal(parseTailSilenceSec('[silencedetect] silence_start: 10.0\n[silencedetect] silence_end: 11.5 | silence_duration: 1.5\n', 50.0), 0);
  assert.equal(parseTailSilenceSec('[silencedetect] silence_start: 48.8\n[silencedetect] silence_end: 50.0 | silence_duration: 1.2\n', 50.0), 1.2);
  assert.equal(parseTailSilenceSec('[silencedetect] silence_start: 49.0\n', 50.0), 1.0);

  const okAlerts = evaluateMusicGate(
    [{ cueName: 'bgm.universal.ok', kind: 'bgm', peakDb: -1.4, tailSilenceSec: 0 }],
    [{ cueName: 'stinger.universal.ok', kind: 'stinger', peakDb: -1.3, tailSilenceSec: 0 }],
  );
  assert.equal(okAlerts.length, 0);

  const badAlerts = evaluateMusicGate(
    [{ cueName: 'bgm.universal.hot', kind: 'bgm', peakDb: -0.2, tailSilenceSec: 0.6 }],
    [{ cueName: 'stinger.universal.clip', kind: 'stinger', peakDb: -0.4, tailSilenceSec: 0 }],
  );
  assert.equal(badAlerts.length, 3);
});

test('process-audio.mjs --only-music trims ONLY head/tail silence without mid-pause truncation, preserves full >6s Stinger, and caches cleanly', async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hgame-music-v2-'));
  const staging = path.join(tmpRoot, 'audio_ai_staging');
  const outDir = path.join(tmpRoot, 'built_audio');

  try {
    await fs.mkdir(outDir, { recursive: true });
    const sfxSentinel = JSON.stringify({ version: '1.0.0', cues: [{ cueName: 'sfx_sentinel', preload: 'buffer', variants: [{ id: 's1' }] }] }, null, 2);
    await fs.writeFile(path.join(outDir, 'cue_table.json'), sfxSentinel);

    // Test Audio A: 60s BGM WAV with 2.0s lead silence + 1.5s mid-track pause at 6.0s + 8.0s trailing silence -> must yield ~50.0s!
    await writeSegmentedTestWav(path.join(staging, 'universal', 'bgm', 'bgm_pause_battle_120bpm.wav'), {
      totalDurationSec: 60.0,
      leadSilenceSec: 2.0,
      midGapAtSec: 6.0,
      midGapDurSec: 1.5,
      tailSilenceSec: 8.0,
      bpm: 120,
      amplitude: 0.28,
    });

    // Test Audio B: 12s Stinger WAV with 3.0s trailing silence -> must yield ~9.0s (NOT chopped to 6.0s!)
    await writeSegmentedTestWav(path.join(staging, 'universal', 'stinger', 'stinger_long_fanfare.wav'), {
      totalDurationSec: 12.0,
      leadSilenceSec: 0,
      tailSilenceSec: 3.0,
      bpm: 120,
      amplitude: 0.35,
    });

    // Game-scoped track
    await writeSegmentedTestWav(path.join(staging, 'games', 'ninja_king', 'bgm', 'bgm_lobby_100bpm.wav'), {
      totalDurationSec: 8.0,
      leadSilenceSec: 0.5,
      tailSilenceSec: 0.5,
      bpm: 100,
      amplitude: 0.25,
    });

    const cliScript = path.resolve('scripts/process-audio.mjs');
    const { stdout: run1Out } = await execFileAsync(process.execPath, [
      cliScript, '--only-music', '--music-staging', staging, '--out-dir', outDir,
    ]);
    const run1 = JSON.parse(run1Out);
    assert.equal(run1.bgmCount, 2);
    assert.equal(run1.stingerCount, 1);
    assert.equal(run1.cacheMisses, 3);
    assert.equal(run1.cacheHits, 0);

    // SFX cue_table.json must stay 100% untouched (music belongs exclusively in music_table.json)
    assert.equal(await fs.readFile(path.join(outDir, 'cue_table.json'), 'utf8'), sfxSentinel);

    const musicTable = JSON.parse(await fs.readFile(path.join(outDir, 'music_table.json'), 'utf8'));
    const aiIndex = JSON.parse(await fs.readFile(path.join(outDir, 'music-ai-index.json'), 'utf8'));
    const report = JSON.parse(await fs.readFile(path.join(outDir, 'music_report.json'), 'utf8'));

    assert.equal(report.passed, true);
    assert.equal(report.alertCount, 0);
    assert.equal(musicTable.totalCount, 3);
    assert.equal(musicTable.bgmCount, 2);
    assert.equal(musicTable.stingerCount, 1);

    const bgmA = musicTable.bgm.find((c) => c.cueName === 'bgm.universal.pause_battle');
    assert.ok(bgmA, 'bgm.universal.pause_battle missing in music_table.json');
    assert.equal(bgmA.scope, 'universal');
    assert.equal(bgmA.kind, 'bgm');
    assert.equal(bgmA.category, 'battle');
    assert.equal(bgmA.preload, 'stream');
    assert.equal(bgmA.loop, true);
    assert.equal(bgmA.bus, 'bgm');
    assert.equal(bgmA.ducking, false);
    assert.equal(bgmA.bpm, 120);
    assert.ok(Math.abs(bgmA.originalDurationSec - 60.0) < 0.1);
    assert.ok(Math.abs(bgmA.durationSec - 50.0) <= 0.5, `Expected ~50.0s (no mid-pause cut!), got ${bgmA.durationSec}`);
    assert.ok(bgmA.trimmedLeadSec >= 1.8 && bgmA.trimmedLeadSec <= 2.2, `trimmedLeadSec=${bgmA.trimmedLeadSec}`);
    assert.ok(bgmA.trimmedTailSec >= 7.8 && bgmA.trimmedTailSec <= 8.2, `trimmedTailSec=${bgmA.trimmedTailSec}`);
    assert.ok(bgmA.tailSilenceSec <= 0.3, `tailSilenceSec=${bgmA.tailSilenceSec}`);
    assert.ok(bgmA.measuredLufs >= -20.0 && bgmA.measuredLufs <= -18.0, `LUFS=${bgmA.measuredLufs}`);
    assert.ok(bgmA.peakDb <= -1.0, `peakDb=${bgmA.peakDb}`);
    assert.ok(bgmA.trimStartSec > 0 && bgmA.trimEndSec > bgmA.trimStartSec && bgmA.sizeKb > 0);

    const stingerB = musicTable.stingers.find((c) => c.cueName === 'stinger.universal.long_fanfare');
    assert.ok(stingerB, 'stinger.universal.long_fanfare missing');
    assert.equal(stingerB.bus, 'ui_voice');
    assert.equal(stingerB.ducking, true);
    assert.equal(stingerB.loop, false);
    assert.ok(Math.abs(stingerB.durationSec - 9.0) <= 0.5, `Expected ~9.0s full stinger (not chopped to 6s!), got ${stingerB.durationSec}`);
    assert.ok(stingerB.tailSilenceSec <= 0.3);

    const gameLobby = aiIndex.items.find((x) => x.id === 'bgm.ninja_king.lobby');
    assert.ok(gameLobby);
    assert.equal(gameLobby.scope, 'game:ninja_king');
    assert.equal(gameLobby.category, 'lobby');
    assert.equal(gameLobby.bpm, 100);
    assert.ok(gameLobby.url.includes('/streams/bgm/ninja_king/bgm_lobby.mp3'));

    // Second run: must hit .music_cache.json with 0 re-encodes
    const { stdout: run2Out } = await execFileAsync(process.execPath, [
      cliScript, '--only-music', '--music-staging', staging, '--out-dir', outDir,
    ]);
    const run2 = JSON.parse(run2Out);
    assert.equal(run2.cacheHits, 3);
    assert.equal(run2.cacheMisses, 0);

    // Forced run: bypasses cache
    const { stdout: run3Out } = await execFileAsync(process.execPath, [
      cliScript, '--only-music', '--force', '--music-staging', staging, '--out-dir', outDir,
    ]);
    const run3 = JSON.parse(run3Out);
    assert.equal(run3.cacheMisses, 3);
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('runtime AudioManager playBgm enforces re-entry guard, crossfades & frees old buffers, trims MP3 loops, ducks -6 dB, and handles lifecycle/onHide/onShow', async () => {
  const { FakeAudioContext, created } = createBgmMockAudioContextClass();
  const audio = createAudioManager({ AudioContextClass: FakeAudioContext });

  let fetchCount = 0;
  const fakeFetch = async (url) => {
    fetchCount++;
    const dur = url.includes('boss') ? 40.0 : 50.0;
    const ab = new Float64Array([dur]).buffer;
    return { ok: true, status: 200, arrayBuffer: async () => ab };
  };

  await audio.loadMusicTable({
    bgm: [
      {
        cueName: 'bgm.universal.field',
        kind: 'bgm',
        url: '/assets/cn/audio/streams/bgm/universal/bgm_field.mp3',
        bus: 'bgm',
        preload: 'stream',
        loop: true,
        trimStartSec: 0.025,
        trimEndSec: 49.975,
      },
      {
        cueName: 'bgm.ninja_king.boss',
        kind: 'bgm',
        url: '/assets/cn/audio/streams/bgm/ninja_king/bgm_boss.mp3',
        bus: 'bgm',
        preload: 'stream',
        loop: true,
      },
    ],
    stingers: [],
  });

  const first = await audio.playBgm('bgm.universal.field', { fadeMs: 30, fetchImpl: fakeFetch });
  assert.equal(first.ignored, false);
  assert.equal(fetchCount, 1);
  assert.equal(created.sources[0].loop, true);
  assert.equal(created.sources[0].loopStart, 0.025);
  assert.equal(created.sources[0].loopEnd, 49.975);

  const dup = await audio.playBgm('bgm.universal.field', { fadeMs: 30, fetchImpl: fakeFetch });
  assert.equal(dup.ignored, true);
  assert.equal(fetchCount, 1);

  const second = await audio.playBgm('bgm.ninja_king.boss', { fadeMs: 40, fetchImpl: fakeFetch });
  assert.equal(second.ignored, false);
  assert.equal(fetchCount, 2);
  assert.equal(created.sources[1].loopStart, 0.026);
  assert.ok(Math.abs(created.sources[1].loopEnd - (40.0 - 0.026)) < 1e-6);
  assert.ok(audio.getBgmState().activeBufferCount <= 2);

  await new Promise((r) => setTimeout(r, 90));
  assert.equal(audio.getBgmState().activeBufferCount, 1);

  created.contexts[0].currentTime = 5.5;
  assert.equal(audio.pauseBgm(), true);
  assert.equal(audio.getBgmState().state, 'paused');
  assert.equal(await audio.resumeBgm(), true);
  assert.equal(audio.getBgmState().state, 'playing');

  // Seek inside playing BGM jumps cleanly without refetching
  const seekedTo = await audio.seekBgm(24.5);
  assert.equal(seekedTo, 24.5);
  assert.ok(Math.abs(audio.getBgmState().currentTimeSec - 24.5) < 0.1);
  assert.equal(fetchCount, 2);

  assert.equal(audio.setBgmVolume(1.4), 1);
  assert.equal(audio.setBgmVolume(0.5), 0.5);

  const stingerBuf = {
    sampleRate: 44100,
    length: 44100,
    duration: 1.0,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array(44100).fill(0.2),
  };
  audio.registerCue('stinger.universal.victory', [stingerBuf], { bus: 'ui_voice' });
  await audio.playCue('stinger.universal.victory');
  const duck = audio.getDspState().ducking.bgm;
  assert.ok(duck);
  assert.ok(Math.abs(duck.targetGain - Math.pow(10, -6 / 20)) < 1e-4);

  // Direct mini-game onHide / onShow hooks + visibilitychange
  audio.onHide();
  assert.equal(audio.getBgmState().state, 'paused');
  audio.onShow();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(audio.getBgmState().state, 'playing');

  const listeners = new Map();
  const fakeDoc = {
    hidden: false,
    addEventListener(ev, fn) { listeners.set(ev, fn); },
    removeEventListener(ev) { listeners.delete(ev); },
  };
  audio.bindLifecycle({ doc: fakeDoc, win: null });
  fakeDoc.hidden = true;
  listeners.get('visibilitychange')?.();
  assert.equal(audio.getBgmState().state, 'paused');
  fakeDoc.hidden = false;
  listeners.get('visibilitychange')?.();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(audio.getBgmState().state, 'playing');

  assert.equal(audio.stopBgm({ fadeMs: 25 }), true);
  await new Promise((r) => setTimeout(r, 75));
  assert.equal(audio.getBgmState().state, 'idle');
  assert.equal(audio.getBgmState().activeBufferCount, 0);

  await audio.dispose();
});
