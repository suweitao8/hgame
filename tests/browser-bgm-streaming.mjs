#!/usr/bin/env node
// Real-browser check for streaming BGM: plays a music-table cue through the runtime on the
// WebAsset origin, verifies loop points, mute, lifecycle and crossfade on a real media element,
// and compares renderer memory against the decoded path.
//
//   node tests/browser-bgm-streaming.mjs [--soak-ms 60000] [--origin http://127.0.0.1:4174] [--chrome <path>]
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium, resolvePlaywright } from '../scripts/lib/playwright-resolve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const executablePath = arg('--chrome', '');
const soakMs = Math.max(0, Number(arg('--soak-ms', '60000')) || 0);
const ORIGIN = arg('--origin', 'http://127.0.0.1:4174');
const MUSIC_TABLE = path.join(root, 'webasset', 'hgame-assets-cn', 'built', 'audio', 'music_table.json');
const CUE_NAME = 'bgm.universal.arcade_chiptune';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Private (committed) memory of an OS process in MB. */
function privateMemoryMb(pid) {
  if (process.platform === 'win32') {
    const out = spawnSync('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid}).PrivateMemorySize64`],
      { encoding: 'utf8' });
    return Number(out.stdout.trim()) / 1048576;
  }
  const out = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' });
  return (Number(out.stdout.trim()) * 1024) / 1048576;
}

/** @param {import('playwright-core').CDPSession} browserCdp Browser-level session; renderer IDs are OS PIDs. */
async function rendererPids(browserCdp) {
  const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo');
  return processInfo.filter((process) => process.type === 'renderer').map((process) => process.id);
}

async function sampleMemory(pid, times = 3, gapMs = 400) {
  const samples = [];
  for (let i = 0; i < times; i++) {
    samples.push(privateMemoryMb(pid));
    if (i < times - 1) await sleep(gapMs);
  }
  return median(samples);
}

async function ensureOrigin() {
  try {
    const response = await fetch(`${ORIGIN}/runtime/hgame/VERSION`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    const audio = await fetch(`${ORIGIN}/assets/cn/audio/streams/bgm/universal/bgm_arcade_chiptune.mp3`, { method: 'HEAD' });
    if (!audio.ok) throw new Error(`audio status ${audio.status}`);
  } catch (error) {
    throw new Error(`WebAsset is not serving the runtime and audio library at ${ORIGIN} (${error.message}). Start WebAsset and retry.`);
  }
}

/** Runs one page through the given steps and reports its renderer memory alongside. */
async function runScenario(browser, browserCdp, label, { cue, stinger, prepare, steps, soak, limitBandwidth = false }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const audioRanges = [];
  page.on('response', response => {
    const contentRange = response.headers()['content-range'];
    if (response.status() === 206 && contentRange && response.url() === new URL(cue.url, ORIGIN).href) {
      audioRanges.push(contentRange);
    }
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  try {
    if (limitBandwidth) {
      const network = await context.newCDPSession(page);
      await network.send('Network.enable');
      await network.send('Network.emulateNetworkConditions', {
        offline: false, latency: 35, downloadThroughput: 48 * 1024, uploadThroughput: 48 * 1024,
      });
    }
    // A small source file makes a light page on the right origin without loading the lobby app.
    await page.goto(`${ORIGIN}/runtime/hgame/platform/audio/helpers.js`);
    const pids = await rendererPids(browserCdp);
    assert.equal(pids.length, 1, `expected a single renderer process, saw ${pids.length}`);
    const pid = pids[0];

    await page.evaluate(async (scenario) => {
      const gains = [];
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const createGain = AudioContextClass.prototype.createGain;
      AudioContextClass.prototype.createGain = function () {
        const node = createGain.call(this);
        gains.push(node);
        return node;
      };
      const AudioElement = window.Audio;
      let media;
      window.Audio = class extends AudioElement {
        constructor(...args) {
          super(...args);
          media = this;
        }
      };
      const { createAudioManager } = await import('/runtime/hgame/platform/audio.js');
      const audio = createAudioManager();
      await audio.unlock();
      audio.registerBgmCue(scenario.cue.cueName, scenario.cue);
      async function seek(target) {
        const element = media;
        const before = element.currentTime;
        const bufferedEnd = element.buffered.length ? element.buffered.end(element.buffered.length - 1) : 0;
        let seeked = false;
        const onSeeked = () => { seeked = true; };
        element.addEventListener('seeked', onSeeked, { once: true });
        try {
          await audio.seekBgm(target);
          const deadline = performance.now() + 5000;
          while ((!seeked || element.currentTime < target + 0.15) && performance.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          return { before, bufferedEnd, target, position: element.currentTime, seeked };
        } finally {
          element.removeEventListener('seeked', onSeeked);
        }
      }
      window.__bgm = { audio, gains, seek, cue: scenario.cue, stinger: scenario.stinger };
    }, { cue: await prepare?.(cue) ?? cue, stinger });
    await sleep(1500);
    const baselineMb = await sampleMemory(pid);

    const started = await page.evaluate(async (options) => {
      const { audio, cue } = window.__bgm;
      const result = await audio.playBgm(cue.cueName, { fadeMs: options.fadeMs });
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return { result, state: audio.getBgmState() };
    }, { fadeMs: 0 });
    const playingMb = await sampleMemory(pid);

    let soakSamples = [];
    let soakStartMb = playingMb;
    if (soak > 0) {
      for (let elapsed = 0; elapsed < soak; elapsed += 5000) {
        await sleep(Math.min(5000, soak - elapsed));
        soakSamples.push({
          mb: await sampleMemory(pid, 1),
          state: await page.evaluate(() => {
            const state = window.__bgm.audio.getBgmState();
            return { streaming: state.streaming, activeBufferCount: state.activeBufferCount, currentTimeSec: state.currentTimeSec };
          }),
        });
      }
      soakStartMb = soakSamples[0]?.mb ?? playingMb;
    }

    const checks = steps ? await page.evaluate(steps) : null;
    return {
      label,
      started,
      memoryMb: {
        baseline: +baselineMb.toFixed(1),
        playing: +playingMb.toFixed(1),
        deltaWhilePlaying: +(playingMb - baselineMb).toFixed(1),
        soak: soakSamples.map((sample) => +sample.mb.toFixed(1)),
        soakSpread: soakSamples.length ? +(Math.max(...soakSamples.map((s) => s.mb)) - Math.min(...soakSamples.map((s) => s.mb))).toFixed(1) : 0,
        soakGrowth: soakSamples.length ? +(soakSamples.at(-1).mb - soakStartMb).toFixed(1) : 0,
      },
      soakStates: soakSamples.map((sample) => sample.state),
      checks,
      audioRanges,
      errors,
    };
  } finally {
    await context.close();
    // The next scenario identifies its renderer as the only one alive.
    for (let i = 0; i < 50 && (await rendererPids(browserCdp)).length > 0; i++) await sleep(100);
  }
}

/** Steps executed in the streaming page: loop points, mute, lifecycle, crossfade and stop. */
async function streamingSteps() {
  const { audio, gains, seek, cue } = window.__bgm;
  const out = {};
  const state = () => audio.getBgmState();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const t0 = state().currentTimeSec;
  await wait(500);
  out.advancing = state().currentTimeSec > t0 + 0.2;
  out.loopWindow = { loopStart: state().loopStart, loopEnd: state().loopEnd, duration: state().duration };

  const { currentTimeSec, duration } = state();
  out.seek = await seek(duration * (currentTimeSec < duration / 2 ? 0.7 : 0.25));

  // Mute acts on the engine graph; the element itself keeps running.
  const gainsBefore = gains.map((node) => node.gain.value);
  audio.setMuted(true);
  await wait(150);
  const gainsMuted = gains.map((node) => node.gain.value);
  const mutedAt = state().currentTimeSec;
  await wait(400);
  out.mute = {
    silentGain: gainsMuted.some((value, index) => value < 1e-3 && gainsBefore[index] >= 1e-3),
    stillPlaying: state().currentTimeSec > mutedAt + 0.1,
  };
  audio.setMuted(false);
  await wait(150);
  out.mute.restored = gainsMuted.some((value, index) => Math.abs(gains[index].gain.value - value) > 1e-3);

  // Lifecycle: hiding the page pauses, showing it again resumes.
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  await wait(250);
  const hiddenState = state().state;
  const pausedAt = state().currentTimeSec;
  await wait(400);
  out.lifecycle = {
    hiddenState,
    stayedPaused: hiddenState === 'paused' && Math.abs(state().currentTimeSec - pausedAt) < 0.05,
  };
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  await wait(600);
  out.lifecycle.shownState = state().state;
  const resumedAt = state().currentTimeSec;
  await wait(400);
  out.lifecycle.advancingAgain = state().currentTimeSec > resumedAt + 0.1;

  // Crossfade to the same cue restarted, then a faded stop.
  await audio.playBgm({ ...cue, cueName: 'bgm.crossfade' }, { fadeMs: 600 });
  out.crossfade = { streaming: state().streaming, cueId: state().cueId, fading: state().fadingCount };
  await wait(1000);
  out.crossfade.settled = state().fadingCount;
  audio.stopBgm({ fadeMs: 600 });
  await wait(1000);
  out.stopped = { state: state().state, activeBufferCount: state().activeBufferCount };

  // The loop seam is watched on a short stinger, which wraps every second or so without seeking.
  const seam = await audio.playBgm({ ...window.__bgm.stinger, cueName: 'bgm.seam', stream: true, loop: true }, { fadeMs: 0 });
  await wait(300);
  const seamDuration = state().loopEnd;
  let previous = state().currentTimeSec;
  let highWater = previous;
  const wraps = [];
  for (let i = 0; i < 600 && wraps.length < 3; i++) {
    await wait(10);
    const time = state().currentTimeSec;
    if (time < previous - seamDuration * 0.5) {
      wraps.push({ before: previous, after: time, highWater });
      highWater = time;
    } else {
      highWater = Math.max(highWater, time);
    }
    previous = time;
  }
  audio.stopBgm({ fadeMs: 0 });
  out.loopSeam = { streaming: seam.streaming, duration: seamDuration, wraps };
  return out;
}

async function main() {
  await ensureOrigin();
  const table = JSON.parse(await readFile(MUSIC_TABLE, 'utf8'));
  const cue = (table.bgm ?? table.tracks).find((entry) => entry.cueName === CUE_NAME);
  assert.ok(cue, `${CUE_NAME} is missing from the built music table`);
  const stinger = [...(table.stingers ?? [])].sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0))[0];
  assert.ok(stinger?.url && stinger.durationSec >= 0.4, 'a stinger is needed to watch the loop seam');

  const { chromium } = resolvePlaywright(import.meta.url, { cwd: root });
  const browser = await launchChromium(chromium, { executablePath, args: ['--autoplay-policy=no-user-gesture-required'] });
  let decoded;
  let streamed;
  let limited;
  try {
    const browserCdp = await browser.newBrowserCDPSession();
    decoded = await runScenario(browser, browserCdp, 'decoded', {
      cue,
      prepare: (entry) => ({ ...entry, preload: undefined, stream: false }),
    });
    streamed = await runScenario(browser, browserCdp, 'streaming', { cue, stinger, steps: streamingSteps, soak: soakMs });
    limited = await runScenario(browser, browserCdp, 'limited-network', {
      cue,
      limitBandwidth: true,
      steps: async () => {
        const { audio, seek } = window.__bgm;
        const jump = await seek(audio.getBgmState().duration * 0.7);
        return { ...jump, activeBufferCount: audio.getBgmState().activeBufferCount };
      },
    });
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({ origin: ORIGIN, cue: cue.cueName, durationSec: cue.durationSec, soakMs,
    decoded, streamed, limited: { checks: limited.checks, audioRanges: limited.audioRanges, errors: limited.errors } }, null, 2));

  assert.deepEqual(decoded.errors, [], 'decoded page logged no errors');
  assert.equal(decoded.started.result.streaming, false, 'the opt-out cue decodes');
  assert.equal(decoded.started.state.activeBufferCount, 1);
  assert.ok(decoded.started.state.bufferDuration > 1, 'the decoded path holds the whole track in a buffer');

  assert.deepEqual(streamed.errors, [], 'streaming page logged no errors');
  const state = streamed.started.state;
  assert.equal(streamed.started.result.streaming, true, 'the music-table cue streams');
  assert.equal(state.streaming, true);
  assert.equal(state.activeBufferCount, 0, 'no AudioBuffer is held for a streaming cue');
  assert.equal(state.bufferDuration, 0);

  const checks = streamed.checks;
  assert.equal(checks.advancing, true, 'playback advances');
  assert.ok(streamed.audioRanges.length > 0, 'WebAsset serves ranged BGM bytes to the browser');
  assert.ok(Math.abs(checks.seek.before - checks.seek.target) > 10, 'the seek test moves well beyond the current playhead');
  for (const seek of [checks.seek, limited.checks]) {
    assert.equal(seek.seeked, true, 'the native element completed the seek');
    assert.ok(seek.position >= seek.target + 0.15 && seek.position <= seek.target + 1,
      `media did not continue playing at the requested position: ${JSON.stringify(seek)}`);
  }
  assert.deepEqual(limited.errors, []);
  assert.ok(limited.checks.bufferedEnd + 5 < limited.checks.target, 'the limited network keeps the seek destination outside the buffer');
  assert.ok(limited.audioRanges.some(range => /^bytes [1-9]/.test(range)), 'the browser requests bytes beyond the initial range');
  assert.equal(limited.checks.activeBufferCount, 0);
  assert.equal(checks.loopWindow.loopStart, 0, 'a media element loops the whole file');

  // A whole-file loop wraps at the end and restarts at the beginning.
  assert.equal(checks.loopSeam.streaming, true);
  assert.ok(checks.loopSeam.wraps.length >= 2, `expected the stinger to loop at least twice: ${JSON.stringify(checks.loopSeam)}`);
  for (const wrap of checks.loopSeam.wraps) {
    assert.ok(wrap.before <= checks.loopSeam.duration + 0.1, `loop ran past the end: ${wrap.before}`);
    assert.ok(wrap.after >= -1e-3 && wrap.after < 0.25, `loop did not restart at the start: ${wrap.after}`);
  }

  assert.equal(checks.mute.silentGain, true, 'muting silences the engine graph');
  assert.equal(checks.mute.stillPlaying, true, 'the element keeps its position while muted');
  assert.equal(checks.mute.restored, true, 'unmuting restores the gain');
  assert.deepEqual(
    [checks.lifecycle.hiddenState, checks.lifecycle.stayedPaused, checks.lifecycle.shownState, checks.lifecycle.advancingAgain],
    ['paused', true, 'playing', true],
    'hiding and showing the page pauses and resumes the stream',
  );
  assert.deepEqual([checks.crossfade.streaming, checks.crossfade.cueId, checks.crossfade.settled], [true, 'bgm.crossfade', 0]);
  assert.deepEqual(checks.stopped, { state: 'idle', activeBufferCount: 0 });

  for (const sample of streamed.soakStates) {
    assert.equal(sample.activeBufferCount, 0, 'nothing is decoded during the soak');
    assert.equal(sample.streaming, true);
  }
  assert.ok(
    streamed.memoryMb.deltaWhilePlaying < decoded.memoryMb.deltaWhilePlaying,
    `streaming (${streamed.memoryMb.deltaWhilePlaying} MB) should hold less than decoding (${decoded.memoryMb.deltaWhilePlaying} MB)`,
  );
  console.log('browser-bgm-streaming: OK');
}

main().catch((error) => {
  console.error('browser-bgm-streaming FAILED:', error.message);
  process.exitCode = 1;
});
