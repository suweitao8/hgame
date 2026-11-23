import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebRtcDataChannelTransport } from '../dist/index.js';

test('client package exports createWebRtcDataChannelTransport with dual-channel config and fallback', async () => {
  const fallbackPackets = [];
  const received = [];
  const transport = createWebRtcDataChannelTransport({
    PeerConnectionCtor: null,
    fallbackSend: (payload, meta) => fallbackPackets.push({ payload, meta }),
  });
  transport.onMessage((payload, meta) => received.push({ payload, meta }));

  assert.equal(transport.getStats().mode, 'fallback');
  assert.deepEqual(transport.getStats().unreliableConfig, { ordered: false, maxRetransmits: 0 });
  assert.deepEqual(transport.getStats().reliableConfig, { ordered: true });
  assert.equal(transport.send('tick', { channel: 'unreliable' }), 'fallback');
  assert.equal(fallbackPackets.length, 1);
  transport.injectFallbackMessage('server-msg');
  assert.equal(received[0].payload, 'server-msg');
  assert.equal(received[0].meta.channel, 'fallback');
  assert.equal(transport.close(), true);
});
