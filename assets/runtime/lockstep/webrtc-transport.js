/**
 * Dual-channel WebRTC DataChannel transport adapter providing both:
 *  - `'unreliable'`: `{ ordered: false, maxRetransmits: 0 }` (zero TCP head-of-line blocking for snapshots/inputs)
 *  - `'reliable'`: `{ ordered: true }` (control events, RPCs, match lifecycle)
 * Automatically and transparently falls back to `fallbackSend` (e.g. WebSocket) whenever
 * `RTCPeerConnection` is unavailable, ICE fails/times out, or the DataChannel is not open.
 */

/**
 * @typedef {object} WebRtcSignalMessage
 * @property {'offer' | 'answer' | 'ice-candidate'} type
 * @property {any} [sdp]
 * @property {any} [candidate]
 */

/**
 * @typedef {object} WebRtcTransportOptions
 * @property {any[]} [iceServers]
 * @property {number} [maxRetransmits=0]
 * @property {string} [reliableLabel='hgame-reliable']
 * @property {string} [unreliableLabel='hgame-unreliable']
 * @property {any} [PeerConnectionCtor]
 * @property {((msg: WebRtcSignalMessage) => void) | null} [sendSignal=null]
 * @property {((payload: any, meta: { channel: 'reliable' | 'unreliable' }) => void) | null} [fallbackSend=null]
 * @property {number} [connectTimeoutMs=5000]
 */

/**
 * @typedef {object} WebRtcTransportStats
 * @property {'idle' | 'connecting' | 'webrtc' | 'fallback' | 'closed'} mode
 * @property {string | null} fallbackReason
 * @property {boolean} reliableOpen
 * @property {boolean} unreliableOpen
 * @property {{ ordered: boolean, maxRetransmits: number }} unreliableConfig
 * @property {{ ordered: boolean }} reliableConfig
 * @property {number} packetsSent
 * @property {number} packetsReceived
 * @property {number} unreliableSent
 * @property {number} reliableSent
 * @property {number} fallbackSent
 */

/**
 * Create a dual-channel WebRTC DataChannel transport with automatic WebSocket/fallback degradation.
 * @param {WebRtcTransportOptions} [options]
 */
export function createWebRtcDataChannelTransport({
  iceServers = [{ urls: 'stun:stun.l.google.com:19302' }],
  maxRetransmits = 0,
  reliableLabel = 'hgame-reliable',
  unreliableLabel = 'hgame-unreliable',
  PeerConnectionCtor = typeof globalThis.RTCPeerConnection === 'function' ? globalThis.RTCPeerConnection : null,
  sendSignal = null,
  fallbackSend = null,
  connectTimeoutMs = 5000,
} = {}) {
  const maxRetransmitsVal = Math.max(0, Math.floor(Number(maxRetransmits) || 0));
  const unreliableConfig = Object.freeze({ ordered: false, maxRetransmits: maxRetransmitsVal });
  const reliableConfig = Object.freeze({ ordered: true });
  const listeners = new Set();

  let peer = null;
  let reliableCh = null;
  let unreliableCh = null;
  let mode = PeerConnectionCtor ? 'idle' : 'fallback';
  let fallbackReason = PeerConnectionCtor ? null : 'RTCPeerConnection unavailable';
  let disposed = false;
  let connectTimer = null;

  let packetsSent = 0;
  let packetsReceived = 0;
  let unreliableSent = 0;
  let reliableSent = 0;
  let fallbackSent = 0;

  function clearConnectTimer() {
    if (connectTimer !== null) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  }

  function updateMode() {
    if (disposed) {
      mode = 'closed';
      return;
    }
    const relOpen = reliableCh?.readyState === 'open';
    const unrelOpen = unreliableCh?.readyState === 'open';
    if (relOpen || unrelOpen) {
      mode = 'webrtc';
      fallbackReason = null;
      clearConnectTimer();
    } else if (fallbackReason) {
      mode = 'fallback';
    }
  }

  function dispatchMessage(payload, channel) {
    if (disposed) return;
    packetsReceived++;
    for (const fn of listeners) {
      fn(payload, { channel });
    }
  }

  function attachChannel(ch) {
    if (!ch || disposed) return;
    const isReliable = ch.label === reliableLabel || ch.ordered === true;
    const kind = isReliable ? 'reliable' : 'unreliable';
    if (isReliable) reliableCh = ch;
    else unreliableCh = ch;

    try { ch.binaryType = 'arraybuffer'; } catch {}
    ch.onopen = () => updateMode();
    ch.onclose = () => {
      if (isReliable && reliableCh === ch) reliableCh = null;
      if (!isReliable && unreliableCh === ch) unreliableCh = null;
      if (!disposed && !reliableCh && !unreliableCh && mode === 'webrtc') {
        fallbackReason = 'channels-closed';
        mode = 'fallback';
      }
    };
    ch.onerror = () => {
      if (!disposed) {
        fallbackReason = 'channel-error';
        updateMode();
      }
    };
    ch.onmessage = (ev) => {
      dispatchMessage(ev?.data !== undefined ? ev.data : ev, kind);
    };
    updateMode();
  }

  function armConnectTimer() {
    clearConnectTimer();
    const timeout = Math.max(0, Number(connectTimeoutMs) || 0);
    if (timeout <= 0) return;
    connectTimer = setTimeout(() => {
      connectTimer = null;
      if (!disposed && mode !== 'webrtc') {
        fallbackReason = 'connect-timeout';
        mode = 'fallback';
      }
    }, timeout);
  }

  function ensurePeer() {
    if (disposed) return null;
    if (peer) return peer;
    if (typeof PeerConnectionCtor !== 'function') {
      mode = 'fallback';
      fallbackReason = 'RTCPeerConnection unavailable';
      return null;
    }
    mode = 'connecting';
    peer = new PeerConnectionCtor({ iceServers });
    peer.onicecandidate = (ev) => {
      if (ev?.candidate && !disposed) {
        sendSignal?.({ type: 'ice-candidate', candidate: ev.candidate });
      }
    };
    const handleConnChange = () => {
      if (disposed || !peer) return;
      const st = peer.connectionState ?? peer.iceConnectionState;
      if (st === 'failed' || st === 'disconnected' || st === 'closed') {
        fallbackReason = `ice-${st}`;
        mode = 'fallback';
        clearConnectTimer();
      }
    };
    peer.onconnectionstatechange = handleConnChange;
    peer.oniceconnectionstatechange = handleConnChange;
    peer.ondatachannel = (ev) => attachChannel(ev?.channel);
    return peer;
  }

  /** @returns {Promise<any>} */
  async function createOffer() {
    const pc = ensurePeer();
    if (!pc) return null;
    if (!reliableCh && typeof pc.createDataChannel === 'function') {
      attachChannel(pc.createDataChannel(reliableLabel, reliableConfig));
    }
    if (!unreliableCh && typeof pc.createDataChannel === 'function') {
      attachChannel(pc.createDataChannel(unreliableLabel, unreliableConfig));
    }
    armConnectTimer();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendSignal?.({ type: 'offer', sdp: offer });
    return offer;
  }

  /** @param {WebRtcSignalMessage} msg @returns {Promise<any>} */
  async function handleSignal(msg) {
    if (!msg || typeof msg !== 'object' || disposed) return null;
    if (msg.type === 'offer') {
      const pc = ensurePeer();
      if (!pc) return null;
      armConnectTimer();
      await pc.setRemoteDescription(msg.sdp ?? msg);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal?.({ type: 'answer', sdp: answer });
      return answer;
    }
    if (msg.type === 'answer') {
      const pc = ensurePeer();
      if (!pc) return false;
      await pc.setRemoteDescription(msg.sdp ?? msg);
      return true;
    }
    if (msg.type === 'ice-candidate') {
      if (msg.candidate && peer && typeof peer.addIceCandidate === 'function') {
        await peer.addIceCandidate(msg.candidate);
        return true;
      }
      return false;
    }
    return false;
  }

  /**
   * Send payload over `'unreliable'` (default) or `'reliable'` WebRTC DataChannel,
   * seamlessly falling back to `fallbackSend` when WebRTC is unavailable or not yet open.
   * @param {any} payload
   * @param {{ channel?: 'unreliable' | 'reliable' }} [options]
   * @returns {'webrtc' | 'fallback' | 'dropped' | 'closed'}
   */
  function send(payload, { channel = 'unreliable' } = {}) {
    if (disposed) return 'closed';
    const slot = channel === 'reliable' ? 'reliable' : 'unreliable';
    const ch = slot === 'reliable' ? reliableCh : unreliableCh;
    const canWebRtc = mode !== 'fallback' && ch && ch.readyState === 'open' && typeof ch.send === 'function';
    if (canWebRtc) {
      const wire = (typeof payload === 'string' || payload instanceof ArrayBuffer || ArrayBuffer.isView(payload))
        ? payload
        : JSON.stringify(payload);
      ch.send(wire);
      packetsSent++;
      if (slot === 'reliable') reliableSent++;
      else unreliableSent++;
      return 'webrtc';
    }
    if (typeof fallbackSend === 'function') {
      fallbackSend(payload, { channel: slot });
      packetsSent++;
      fallbackSent++;
      return 'fallback';
    }
    return 'dropped';
  }

  /** @param {(payload: any, meta: { channel: 'reliable' | 'unreliable' | 'fallback' }) => void} handler */
  function onMessage(handler) {
    if (typeof handler !== 'function') throw new TypeError('onMessage handler must be a function');
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }

  function injectFallbackMessage(payload) {
    dispatchMessage(payload, 'fallback');
  }

  /** @returns {WebRtcTransportStats} */
  function getStats() {
    return Object.freeze({
      mode,
      fallbackReason,
      reliableOpen: reliableCh?.readyState === 'open',
      unreliableOpen: unreliableCh?.readyState === 'open',
      unreliableConfig,
      reliableConfig,
      packetsSent,
      packetsReceived,
      unreliableSent,
      reliableSent,
      fallbackSent,
    });
  }

  function close() {
    if (disposed) return false;
    disposed = true;
    mode = 'closed';
    clearConnectTimer();
    try { reliableCh?.close?.(); } catch {}
    try { unreliableCh?.close?.(); } catch {}
    try { peer?.close?.(); } catch {}
    reliableCh = null;
    unreliableCh = null;
    peer = null;
    listeners.clear();
    return true;
  }

  return Object.freeze({
    createOffer,
    handleSignal,
    send,
    onMessage,
    injectFallbackMessage,
    getStats,
    close,
  });
}
