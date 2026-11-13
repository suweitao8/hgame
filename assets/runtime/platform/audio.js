export function createAudioManager({
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  volume = 1,
} = {}) {
  let context = null;
  let master = null;
  let muted = false;
  let currentVolume = Math.min(1, Math.max(0, Number(volume) || 0));
  const activeSources = new Set();

  function ensureContext() {
    if (context) return context;
    if (typeof AudioContextClass !== 'function') throw new Error('Web Audio is not supported in this browser');
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = muted ? 0 : currentVolume;
    master.connect(context.destination);
    return context;
  }

  async function unlock() {
    const audioContext = ensureContext();
    if (audioContext.state === 'suspended') await audioContext.resume();
    return audioContext;
  }

  function setVolume(value) {
    currentVolume = Math.min(1, Math.max(0, Number(value) || 0));
    if (master) master.gain.setTargetAtTime(muted ? 0 : currentVolume, context.currentTime, 0.01);
    return currentVolume;
  }

  function setMuted(value) {
    muted = Boolean(value);
    if (master) master.gain.setTargetAtTime(muted ? 0 : currentVolume, context.currentTime, 0.01);
    return muted;
  }

  async function decode(arrayBuffer) {
    const audioContext = await unlock();
    return audioContext.decodeAudioData(arrayBuffer.slice(0));
  }

  async function play(buffer, { volume: soundVolume = 1, loop = false, playbackRate = 1 } = {}) {
    if (muted) return null;
    const audioContext = await unlock();
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    source.loop = Boolean(loop);
    source.playbackRate.value = Math.max(0.01, Number(playbackRate) || 1);
    gain.gain.value = Math.min(1, Math.max(0, Number(soundVolume) || 0));
    source.connect(gain);
    gain.connect(master);
    const handle = {
      stop() {
        try { source.stop(); } catch { /* Already stopped. */ }
        activeSources.delete(handle);
      },
    };
    source.addEventListener?.('ended', () => activeSources.delete(handle), { once: true });
    activeSources.add(handle);
    source.start();
    return handle;
  }

  function dispose() {
    for (const source of [...activeSources]) source.stop();
    activeSources.clear();
    const closing = context?.close?.();
    context = null;
    master = null;
    return closing;
  }

  return Object.freeze({
    get volume() { return currentVolume; },
    get muted() { return muted; },
    get available() { return typeof AudioContextClass === 'function'; },
    unlock,
    decode,
    play,
    setVolume,
    setMuted,
    dispose,
  });
}
