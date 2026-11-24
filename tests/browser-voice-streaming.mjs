import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { launchChromium } from '../scripts/lib/playwright-resolve.mjs';
import { createGamePreviewServer } from '../webasset/server.mjs';

const tempRoot = path.resolve(os.tmpdir());
const temporary = await mkdtemp(path.join(tempRoot, 'hgame-voice-streaming-'));
const slug = 'voice-streaming-probe';
const game = path.join(temporary, slug);
const durationSec = 24;

function makeDialogueProbe() {
  const sampleRate = 16000;
  const samples = sampleRate * durationSec;
  const dataSize = samples * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples; i++) {
    wav.writeInt16LE(Math.round(5000 * Math.sin(2 * Math.PI * 440 * i / sampleRate)), 44 + i * 2);
  }
  return wav;
}

let server;
let browser;
try {
  await mkdir(path.join(game, 'audio'), { recursive: true });
  await writeFile(path.join(game, 'index.html'), '<!doctype html><button type="button">Play</button>');
  await writeFile(path.join(game, 'game.config.json'), JSON.stringify({
    schemaVersion: 1, id: slug, name: 'Voice Streaming Probe', version: '1.0.0',
    entry: 'index.html', renderer: 'canvas2d', runtime: 'webasset-v1', standalone: true,
  }));
  await writeFile(path.join(game, 'audio', 'dialogue.wav'), makeDialogueProbe());

  server = createGamePreviewServer({ htmlGamesRoot: temporary, localGame: slug });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  browser = await launchChromium(chromium, {});
  const page = await browser.newPage();
  const network = await page.context().newCDPSession(page);
  await network.send('Network.enable');
  await network.send('Network.emulateNetworkConditions', {
    offline: false, latency: 35, downloadThroughput: 64 * 1024, uploadThroughput: 64 * 1024,
  });
  const errors = [];
  const responses = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => {
    if (response.url().endsWith('/audio/dialogue.wav')) {
      responses.push({ status: response.status(), range: response.headers()['content-range'] });
    }
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/local-games/${slug}/index.html`);
  await page.evaluate(async duration => {
    const { createAudioManager } = await import('/runtime/hgame/platform/audio.js');
    const NativeAudio = window.Audio;
    let element;
    window.Audio = class extends NativeAudio {
      constructor(...args) { super(...args); element = this; }
    };
    const counts = { decoded: 0, buffered: 0, streamed: 0 };
    let context;
    class MeteredAudioContext extends AudioContext {
      constructor() {
        super();
        context = this;
        this.meter = this.createAnalyser();
      }
      decodeAudioData(...args) { counts.decoded++; return super.decodeAudioData(...args); }
      createBufferSource() { counts.buffered++; return super.createBufferSource(); }
      createMediaElementSource(media) { counts.streamed++; return super.createMediaElementSource(media); }
    }
    const nativeConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (destination, ...args) {
      const result = nativeConnect.call(this, destination, ...args);
      if (destination === context?.destination) nativeConnect.call(this, context.meter);
      return result;
    };
    const audio = createAudioManager({ AudioContextClass: MeteredAudioContext, compressor: false });
    audio.registerCue('voice.intro', {
      variants: [{ url: './audio/dialogue.wav', durationSec: duration }],
      bus: 'ui_voice', gainJitterDb: 0, cooldownMs: 0,
    });
    window.__voiceProbe = { audio, counts, get element() { return element; } };
    function rms() {
      const samples = new Float32Array(context.meter.fftSize);
      context.meter.getFloatTimeDomainData(samples);
      return Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
    }
    window.__voiceProbe.rms = rms;
    document.querySelector('button').addEventListener('click', () => {
      window.__voiceProbe.started = audio.playCue('voice.intro');
    });
  }, durationSec);
  assert.equal(responses.length, 0, 'registering a URL cue does not preload it');
  await page.getByRole('button', { name: 'Play' }).click();
  const result = await page.evaluate(async () => {
    const probe = window.__voiceProbe;
    const { audio, counts, rms } = probe;
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const voice = await probe.started;
    const element = probe.element;
    await pause(250);
    const duration = element.duration;
    const bufferedEnd = element.buffered.length ? element.buffered.end(element.buffered.length - 1) : 0;
    const playingRms = rms();
    audio.setBusVolume('ui_voice', 0);
    await pause(300);
    const quietRms = rms();
    audio.setBusVolume('ui_voice', 1);
    const slowRate = voice.setPlaybackRate(0.05).playbackRate;
    voice.setPlaybackRate(1);

    audio.onHide();
    const hiddenPosition = element.currentTime;
    await pause(250);
    const hidden = { paused: element.paused, delta: element.currentTime - hiddenPosition };
    audio.onShow();
    await pause(300);
    const resumed = { paused: element.paused, delta: element.currentTime - hiddenPosition };
    const activeBeforeStop = audio.activeCount;
    voice.stop();
    const stopped = { activeCount: audio.activeCount, src: element.getAttribute('src'), paused: element.paused };
    await audio.dispose();
    return { counts, duration, bufferedEnd, slowRate, bus: voice.bus, playingRms, quietRms, hidden, resumed, activeBeforeStop, stopped };
  });
  console.log(JSON.stringify({ result, responses, errors }));
  assert.deepEqual(errors, []);
  assert.deepEqual(result.counts, { decoded: 0, buffered: 0, streamed: 1 });
  assert.equal(result.duration, durationSec);
  assert.ok(result.bufferedEnd > 0 && result.bufferedEnd < durationSec / 2, 'playback starts before half of the voice file arrives');
  assert.ok(result.slowRate >= 0.0625 && result.slowRate <= 1);
  assert.equal(result.bus, 'ui_voice');
  assert.ok(result.playingRms > 0.02, 'the dialogue reaches the actual mix output');
  assert.ok(result.quietRms < result.playingRms / 10, 'bus volume controls the real stream signal');
  assert.deepEqual(result.hidden, { paused: true, delta: 0 });
  assert.equal(result.resumed.paused, false);
  assert.ok(result.resumed.delta > 0.1);
  assert.equal(result.activeBeforeStop, 1);
  assert.deepEqual(result.stopped, { activeCount: 0, src: null, paused: true });
  assert.ok(responses.some(response => response.status === 206 && response.range?.startsWith('bytes ')));
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  if (path.dirname(temporary) === tempRoot) await rm(temporary, { recursive: true, force: true, maxRetries: 3 });
}
