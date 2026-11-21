export type WebRtcChannelKind = 'unreliable' | 'reliable';
export type WebRtcMessageSource = WebRtcChannelKind | 'fallback';

export interface WebRtcSignalMessage {
  type: 'offer' | 'answer' | 'ice-candidate';
  sdp?: RTCSessionDescriptionInit | undefined;
  candidate?: RTCIceCandidateInit | RTCIceCandidate | undefined;
}

export interface WebRtcTransportOptions {
  iceServers?: RTCIceServer[] | undefined;
  maxRetransmits?: number | undefined;
  reliableLabel?: string | undefined;
  unreliableLabel?: string | undefined;
  PeerConnectionCtor?: (new (config?: RTCConfiguration) => RTCPeerConnection) | null | undefined;
  sendSignal?: ((msg: WebRtcSignalMessage) => void) | null | undefined;
  fallbackSend?: ((payload: unknown, meta: { channel: WebRtcChannelKind }) => void) | null | undefined;
  connectTimeoutMs?: number | undefined;
}

export interface WebRtcTransportStats {
  readonly mode: 'idle' | 'connecting' | 'webrtc' | 'fallback' | 'closed';
  readonly fallbackReason: string | null;
  readonly reliableOpen: boolean;
  readonly unreliableOpen: boolean;
  readonly unreliableConfig: Readonly<{ ordered: boolean; maxRetransmits: number }>;
  readonly reliableConfig: Readonly<{ ordered: boolean }>;
  readonly packetsSent: number;
  readonly packetsReceived: number;
  readonly unreliableSent: number;
  readonly reliableSent: number;
  readonly fallbackSent: number;
}

export interface WebRtcTransport {
  createOffer(): Promise<RTCSessionDescriptionInit | null>;
  handleSignal(msg: WebRtcSignalMessage): Promise<RTCSessionDescriptionInit | boolean | null>;
  send(payload: unknown, options?: { channel?: WebRtcChannelKind }): 'webrtc' | 'fallback' | 'dropped' | 'closed';
  onMessage(handler: (payload: unknown, meta: { channel: WebRtcMessageSource }) => void): () => void;
  injectFallbackMessage(payload: unknown): void;
  getStats(): WebRtcTransportStats;
  close(): boolean;
}

export function createWebRtcDataChannelTransport(options: WebRtcTransportOptions = {}): WebRtcTransport {
  const iceServers = options.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }];
  const maxRetransmitsVal = Math.max(0, Math.floor(Number(options.maxRetransmits ?? 0) || 0));
  const reliableLabel = options.reliableLabel ?? 'hgame-reliable';
  const unreliableLabel = options.unreliableLabel ?? 'hgame-unreliable';
  const PeerConnectionCtor = options.PeerConnectionCtor !== undefined
    ? options.PeerConnectionCtor
    : (typeof globalThis.RTCPeerConnection === 'function' ? globalThis.RTCPeerConnection : null);
  const sendSignal = options.sendSignal ?? null;
  const fallbackSend = options.fallbackSend ?? null;
  const connectTimeoutMs = options.connectTimeoutMs ?? 5000;

  const unreliableConfig = Object.freeze({ ordered: false, maxRetransmits: maxRetransmitsVal });
  const reliableConfig = Object.freeze({ ordered: true });
  const listeners = new Set<(payload: unknown, meta: { channel: WebRtcMessageSource }) => void>();

  let peer: RTCPeerConnection | null = null;
  let reliableCh: RTCDataChannel | null = null;
  let unreliableCh: RTCDataChannel | null = null;
  let mode: WebRtcTransportStats['mode'] = PeerConnectionCtor ? 'idle' : 'fallback';
  let fallbackReason: string | null = PeerConnectionCtor ? null : 'RTCPeerConnection unavailable';
  let disposed = false;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;

  let packetsSent = 0;
  let packetsReceived = 0;
  let unreliableSent = 0;
  let reliableSent = 0;
  let fallbackSent = 0;

  function clearConnectTimer(): void {
    if (connectTimer !== null) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
  }

  function updateMode(): void {
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

  function dispatchMessage(payload: unknown, channel: WebRtcMessageSource): void {
    if (disposed) return;
    packetsReceived++;
    for (const fn of listeners) {
      fn(payload, { channel });
    }
  }

  function attachChannel(ch: RTCDataChannel | null | undefined): void {
    if (!ch || disposed) return;
    const isReliable = ch.label === reliableLabel || ch.ordered === true;
    const kind: WebRtcChannelKind = isReliable ? 'reliable' : 'unreliable';
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
    ch.onmessage = (ev: MessageEvent<unknown>) => {
      dispatchMessage(ev?.data !== undefined ? ev.data : ev, kind);
    };
    updateMode();
  }

  function armConnectTimer(): void {
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

  function ensurePeer(): RTCPeerConnection | null {
    if (disposed) return null;
    if (peer) return peer;
    if (typeof PeerConnectionCtor !== 'function') {
      mode = 'fallback';
      fallbackReason = 'RTCPeerConnection unavailable';
      return null;
    }
    mode = 'connecting';
    const pc = new PeerConnectionCtor({ iceServers });
    peer = pc;
    pc.onicecandidate = (ev) => {
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
    pc.onconnectionstatechange = handleConnChange;
    pc.oniceconnectionstatechange = handleConnChange;
    pc.ondatachannel = (ev) => attachChannel(ev?.channel);
    return pc;
  }

  async function createOffer(): Promise<RTCSessionDescriptionInit | null> {
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

  async function handleSignal(msg: WebRtcSignalMessage): Promise<RTCSessionDescriptionInit | boolean | null> {
    if (!msg || typeof msg !== 'object' || disposed) return null;
    if (msg.type === 'offer') {
      const pc = ensurePeer();
      if (!pc) return null;
      armConnectTimer();
      const sdp = msg.sdp ?? (msg as unknown as RTCSessionDescriptionInit);
      await pc.setRemoteDescription(sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal?.({ type: 'answer', sdp: answer });
      return answer;
    }
    if (msg.type === 'answer') {
      const pc = ensurePeer();
      if (!pc || !msg.sdp) return false;
      await pc.setRemoteDescription(msg.sdp);
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

  function send(payload: unknown, opts: { channel?: WebRtcChannelKind } = {}): 'webrtc' | 'fallback' | 'dropped' | 'closed' {
    if (disposed) return 'closed';
    const slot: WebRtcChannelKind = opts.channel === 'reliable' ? 'reliable' : 'unreliable';
    const ch = slot === 'reliable' ? reliableCh : unreliableCh;
    const canWebRtc = mode !== 'fallback' && ch !== null && ch.readyState === 'open' && typeof ch.send === 'function';
    if (canWebRtc) {
      const wire: string | ArrayBuffer | ArrayBufferView =
        (typeof payload === 'string' || payload instanceof ArrayBuffer || ArrayBuffer.isView(payload))
          ? payload
          : JSON.stringify(payload);
      ch.send(wire as string);
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

  function onMessage(handler: (payload: unknown, meta: { channel: WebRtcMessageSource }) => void): () => void {
    if (typeof handler !== 'function') throw new TypeError('onMessage handler must be a function');
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }

  function injectFallbackMessage(payload: unknown): void {
    dispatchMessage(payload, 'fallback');
  }

  function getStats(): WebRtcTransportStats {
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

  function close(): boolean {
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
