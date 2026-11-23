import test from 'node:test';
import assert from 'node:assert/strict';
import { HGame, createWebRtcDataChannelTransport } from '../assets/runtime/index.js';

function createMockRtcPair({ dropNextUnreliable = false } = {}) {
  const createdConfigs = [];
  let dropFlag = dropNextUnreliable;

  class MockPeerConnection {
    static peers = [];
    constructor(cfg) {
      this.cfg = cfg;
      this.localDescription = null;
      this.remoteDescription = null;
      this.connectionState = 'new';
      this.iceConnectionState = 'new';
      this.onicecandidate = null;
      this.onconnectionstatechange = null;
      this.oniceconnectionstatechange = null;
      this.ondatachannel = null;
      this.channels = [];
      MockPeerConnection.peers.push(this);
    }
    createDataChannel(label, options) {
      createdConfigs.push({ label, options });
      const ch = {
        label,
        ordered: Boolean(options?.ordered),
        maxRetransmits: options?.maxRetransmits,
        readyState: 'connecting',
        binaryType: 'blob',
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
        _remote: null,
        send(data) {
          if (ch.label === 'hgame-unreliable' && dropFlag) {
            dropFlag = false;
            return; // Simulate dropped unreliable UDP datagram without delaying subsequent packets
          }
          if (ch._remote?.onmessage) {
            ch._remote.onmessage({ data });
          }
        },
        close() { ch.readyState = 'closed'; },
      };
      this.channels.push(ch);
      return ch;
    }
    async createOffer() { return { type: 'offer', sdp: 'mock-offer-sdp' }; }
    async createAnswer() { return { type: 'answer', sdp: 'mock-answer-sdp' }; }
    async setLocalDescription(desc) { this.localDescription = desc; }
    async setRemoteDescription(desc) { this.remoteDescription = desc; }
    async addIceCandidate() {}
    close() { this.connectionState = 'closed'; }
  }

  return {
    MockPeerConnection,
    createdConfigs,
    connectPeers(a, b) {
      for (const chA of a.channels) {
        const chB = {
          label: chA.label,
          ordered: chA.ordered,
          maxRetransmits: chA.maxRetransmits,
          readyState: 'open',
          binaryType: 'arraybuffer',
          onopen: null,
          onclose: null,
          onerror: null,
          onmessage: null,
          _remote: chA,
          send(data) {
            if (chB._remote?.onmessage) chB._remote.onmessage({ data });
          },
          close() { chB.readyState = 'closed'; },
        };
        chA._remote = chB;
        b.ondatachannel?.({ channel: chB });
        chA.readyState = 'open';
        chA.onopen?.();
        chB.onopen?.();
      }
      a.connectionState = 'connected';
      b.connectionState = 'connected';
      a.onicecandidate?.({ candidate: { candidate: 'candidate:1 1 udp 2122260223 127.0.0.1 9000 typ host' } });
    },
  };
}

test('N1 createWebRtcDataChannelTransport opens dual reliable/unreliable channels without head-of-line blocking', async () => {
  assert.equal(typeof HGame.createWebRtcDataChannelTransport, 'function');
  const { MockPeerConnection, createdConfigs, connectPeers } = createMockRtcPair({ dropNextUnreliable: true });
  const aSignals = [];
  const bSignals = [];
  const aFallbacks = [];
  const bReceived = [];

  const a = createWebRtcDataChannelTransport({
    PeerConnectionCtor: MockPeerConnection,
    sendSignal: m => aSignals.push(m),
    fallbackSend: (p, meta) => aFallbacks.push({ p, meta }),
  });
  const b = createWebRtcDataChannelTransport({
    PeerConnectionCtor: MockPeerConnection,
    sendSignal: m => bSignals.push(m),
  });
  b.onMessage((payload, meta) => bReceived.push({ payload, meta }));

  await a.createOffer();
  assert.equal(aSignals[0].type, 'offer');
  await b.handleSignal(aSignals[0]);
  assert.equal(bSignals[0].type, 'answer');
  await a.handleSignal(bSignals[0]);

  const [pcA, pcB] = MockPeerConnection.peers;
  connectPeers(pcA, pcB);
  await b.handleSignal(aSignals.find(s => s.type === 'ice-candidate'));

  assert.equal(a.getStats().mode, 'webrtc');
  assert.equal(b.getStats().mode, 'webrtc');
  assert.deepEqual(createdConfigs.find(c => c.label === 'hgame-reliable')?.options, { ordered: true });
  assert.deepEqual(createdConfigs.find(c => c.label === 'hgame-unreliable')?.options, { ordered: false, maxRetransmits: 0 });

  // Packet 1 on unreliable is dropped, Packet 2 arrives immediately with zero HoL stall
  assert.equal(a.send({ seq: 1, kind: 'snap' }, { channel: 'unreliable' }), 'webrtc');
  assert.equal(a.send({ seq: 2, kind: 'snap' }, { channel: 'unreliable' }), 'webrtc');
  assert.equal(a.send('READY', { channel: 'reliable' }), 'webrtc');

  assert.equal(aFallbacks.length, 0);
  assert.equal(bReceived.length, 2);
  assert.deepEqual(JSON.parse(bReceived[0].payload), { seq: 2, kind: 'snap' });
  assert.equal(bReceived[0].meta.channel, 'unreliable');
  assert.equal(bReceived[1].payload, 'READY');
  assert.equal(bReceived[1].meta.channel, 'reliable');
  assert.equal(a.getStats().unreliableSent, 2);
  assert.equal(a.getStats().reliableSent, 1);

  a.close();
  b.close();
});

test('N1 createWebRtcDataChannelTransport falls back transparently when RTCPeerConnection is missing or ICE fails', async () => {
  const sentFallback = [];
  const received = [];
  const tNoRtc = createWebRtcDataChannelTransport({
    PeerConnectionCtor: null,
    fallbackSend: (payload, meta) => sentFallback.push({ payload, meta }),
  });
  tNoRtc.onMessage((payload, meta) => received.push({ payload, meta }));

  assert.equal(tNoRtc.getStats().mode, 'fallback');
  assert.equal(tNoRtc.send(new Uint8Array([1, 2, 3])), 'fallback');
  tNoRtc.injectFallbackMessage('ws-echo');
  assert.equal(sentFallback.length, 1);
  assert.equal(sentFallback[0].meta.channel, 'unreliable');
  assert.equal(received[0].payload, 'ws-echo');
  assert.equal(received[0].meta.channel, 'fallback');
  tNoRtc.close();

  // Verify ICE failure triggers fallback mode
  const iceSent = [];
  class FailingPeer {
    constructor() { this.connectionState = 'new'; this.iceConnectionState = 'new'; }
    createDataChannel(label, opts) { return { label, ordered: Boolean(opts?.ordered), readyState: 'connecting', send() {}, close() {} }; }
    async createOffer() { return { type: 'offer', sdp: 'x' }; }
    async setLocalDescription() {}
    close() {}
  }
  let createdPeer = null;
  const Wrapper = function (cfg) { createdPeer = new FailingPeer(cfg); return createdPeer; };
  const tFail = createWebRtcDataChannelTransport({
    PeerConnectionCtor: Wrapper,
    fallbackSend: (p, meta) => iceSent.push({ p, meta }),
  });
  await tFail.createOffer();
  createdPeer.connectionState = 'failed';
  createdPeer.onconnectionstatechange?.();
  assert.equal(tFail.getStats().mode, 'fallback');
  assert.equal(tFail.send({ ping: 1 }, { channel: 'reliable' }), 'fallback');
  assert.equal(iceSent.length, 1);
  assert.equal(iceSent[0].meta.channel, 'reliable');
  tFail.close();
});
