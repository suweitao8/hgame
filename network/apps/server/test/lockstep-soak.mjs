import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeSync } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { CloseCode } from '@colyseus/sdk';
import { HGameLockstepChannel, HGameNetworkClient } from '@hgame/network-client';
import { encodeConfirmedFrame } from '@hgame/network-protocol';

const gameId = 'hgame-lockstep-soak';
const roomName = 'lab_lockstep';
const netHz = 20;
const minimumBlocks = seconds => Math.max(1, Math.floor(seconds * 0.85));

function integer(value, name, min, max) {
  const number = Number(value);
  assert.ok(Number.isInteger(number) && number >= min && number <= max, `${name} must be an integer from ${min} to ${max}`);
  return number;
}

function frameReport(session, firstTick) {
  const blocks = [];
  const gaps = [];
  let nextTick = firstTick;
  let previousFrameAt;
  let digest;
  let inputs;
  return {
    blocks,
    receive(frame) {
      assert.equal(frame.netTick, nextTick++, 'Confirmed frames must arrive in order');
      const now = performance.now();
      if (previousFrameAt !== undefined) gaps.push(now - previousFrameAt);
      previousFrameAt = now;
      const offset = (frame.netTick - 1) % netHz;
      if (offset === 0) {
        digest = createHash('sha256');
        inputs = [0, 0];
      }
      if (!digest) return;
      digest.update(encodeConfirmedFrame(frame));
      for (const input of frame.inputs) if (input.slot < inputs.length && input.payload.length) inputs[input.slot]++;
      if (offset === netHz - 1) {
        blocks.push({ firstTick: frame.netTick - offset, hash: digest.digest('hex'), inputs });
        digest = undefined;
      }
    },
    metrics() {
      gaps.sort((a, b) => a - b);
      return {
        roomId: session.roomId,
        matchTag: session.room.state.matchTag,
        frames: nextTick - firstTick,
        arrivalGapP95Ms: Math.round(gaps[Math.floor((gaps.length - 1) * 0.95)] ?? 0),
        maxArrivalGapMs: Math.round(gaps.at(-1) ?? 0),
      };
    },
  };
}

async function run({ endpoint, role, room, seconds, dropAfter, connectTimeout }) {
  const client = new HGameNetworkClient({ endpoint, storage: null });
  const options = { gameId, roomName, resume: false };
  let session;
  let channel;
  let timer;
  let runError;
  function deadline(stage, timeoutMs) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const message = runError ? runError.message + '\n' : '';
      writeSync(2, message + 'Timed out while ' + stage + '\n');
      process.exit(1);
    }, timeoutMs);
  }
  try {
    deadline('connecting to the lockstep room', connectTimeout * 1_000);
    session = role === 'host'
      ? await client.create({ ...options, roomOptions: {
        gameId, maxClients: 2, netHz, maxFramesPerTick: 1, frameDeadlineTicks: 1,
        maxHistoryFrames: 600, reconnectSeconds: 15,
      } })
      : await client.joinById({ ...options, roomId: room });
    const originalSessionId = session.sessionId;
    session.onMessage('lockstep:frame', () => {});
    console.log(JSON.stringify({ event: 'room', role, roomId: session.roomId }));
    deadline('waiting for both players', 120_000);
    while (session.room.state.players?.size !== 2 || !session.room.state.matchTag) {
      await delay(20);
    }
    const slot = session.room.state.players.get(session.sessionId)?.slot;
    assert.ok(slot === 0 || slot === 1, 'Missing assigned lockstep slot');
    Object.assign(session.room.reconnection, { minUptime: 0, minDelay: 250, maxDelay: 500, maxRetries: 32 });

    const firstTick = session.room.state.netTick + 1;
    const report = frameReport(session, firstTick);
    const reconnects = [];
    let failure;
    let outage;
    let injected = false;
    let lastSentTick = 0;
    const fail = error => { failure ??= error; };
    channel = new HGameLockstepChannel(session, session.room.state.matchTag, firstTick);
    const finishReplay = () => {
      if (!outage?.finalPage || channel.expectedNetTick <= outage.replayedUntil + 1) return;
      reconnects.push({
        injected: outage.injected,
        reconnectedMs: Math.round(outage.reconnectedAt - outage.at),
        recoveredMs: Math.round(performance.now() - outage.at),
        replayedFrames: outage.frames,
      });
      outage = undefined;
    };
    channel.onFrame(frame => {
      try {
        report.receive(frame);
        finishReplay();
      } catch (error) { fail(error); }
    });
    channel.onSyncStatus(status => {
      if (!outage?.reconnectedAt || !Number.isInteger(status.fromNetTick) || status.fromNetTick < outage.firstMissing) return;
      if (status.reason === 'history_evicted' &&
          (!Number.isInteger(status.oldestAvailableTick) || channel.expectedNetTick < status.oldestAvailableTick)) {
        fail(new Error('Confirmed frame history expired during reconnect'));
      }
      if (!status.ok || !Number.isInteger(status.toNetTick) || status.toNetTick < status.fromNetTick - 1) return;
      outage.replayedUntil = Math.max(outage.replayedUntil ?? outage.firstMissing - 1, status.toNetTick);
      outage.frames += status.sentFrames ?? 0;
      outage.finalPage = status.hasMore === false;
      finishReplay();
    });
    session.onMessage('lockstep:rejected', data => fail(new Error('Lockstep input rejected: ' + data.reason)));
    session.onMessage('lockstep:peer-desync', () => fail(new Error('Server reported a peer desync')));
    session.onDrop(() => {
      outage ??= { at: performance.now(), frames: 0, injected: false };
      outage.firstMissing = channel.expectedNetTick;
      outage.reconnectedAt = undefined;
      outage.replayedUntil = undefined;
      outage.finalPage = false;
    });
    session.onReconnect(() => {
      if (session.sessionId !== originalSessionId) fail(new Error('Reconnect changed the session ID'));
      if (outage) outage.reconnectedAt = performance.now();
    });
    session.onLeave(() => fail(new Error('Room closed during the soak')));
    channel.requestSync(firstTick);

    deadline('observing confirmed frames', seconds * 1_000 + 5_000);
    const started = performance.now();
    while (performance.now() - started < seconds * 1_000) {
      if (failure) throw failure;
      if (dropAfter !== undefined && !injected && !outage && performance.now() - started >= dropAfter * 1_000) {
        injected = true;
        outage = { at: performance.now(), frames: 0, injected: true };
        session.room.connection.close(CloseCode.MAY_TRY_RECONNECT);
      }
      if (!outage) {
        const tick = session.room.state.netTick;
        // A Schema patch can advance more than one tick. Fill all eligible
        // targets while keeping a lead for round-trip and patch delay.
        for (let target = Math.max(lastSentTick + 1, tick + 8); target <= tick + 12; target++) {
          channel.sendInput(target, Uint8Array.of(slot + 1, target % 251));
          lastSentTick = target;
        }
      }
      await delay(20);
    }
    if (failure) throw failure;
    assert.ok(!outage, 'Reconnect and confirmed-frame replay did not finish before the deadline');
    if (dropAfter !== undefined) assert.ok(reconnects.some(reconnect => reconnect.injected), 'Injected disconnect did not recover');
    assert.ok(report.blocks.length >= minimumBlocks(seconds), 'Too few complete frame blocks for the requested duration');
    return { version: 1, role, seconds, netHz, ...report.metrics(), reconnects, blocks: report.blocks };
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    try {
      channel?.dispose();
      if (session) {
        deadline('leaving the lockstep room', 5_000);
        await session.leave();
      }
    } catch (error) {
      if (!runError) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function validateBlocks(report) {
  assert.ok(Array.isArray(report.blocks), 'Missing confirmed frame blocks');
  let previous;
  for (const block of report.blocks) {
    assert.ok(Number.isInteger(block.firstTick) && block.firstTick > 0 && (block.firstTick - 1) % netHz === 0 &&
      (previous === undefined || previous + netHz === block.firstTick), 'Invalid confirmed frame range');
    assert.match(block.hash, /^[a-f0-9]{64}$/);
    assert.ok(Array.isArray(block.inputs) && block.inputs.length === 2 &&
      block.inputs.every(value => Number.isInteger(value) && value >= 0 && value <= netHz), 'Invalid input counts');
    previous = block.firstTick;
  }
  return new Map(report.blocks.map(block => [block.firstTick, block]));
}

function compare(a, b) {
  assert.ok(a.version === 1 && b.version === 1 && a.netHz === netHz && b.netHz === netHz && a.role !== b.role &&
    [a.role, b.role].every(role => role === 'host' || role === 'peer'), 'Expected one host and one peer report');
  assert.ok(typeof a.roomId === 'string' && a.roomId.length && a.roomId === b.roomId &&
    Number.isInteger(a.matchTag) && a.matchTag > 0 && a.matchTag === b.matchTag && a.seconds === b.seconds,
    'Reports must be from the same room, match and duration');
  const seconds = integer(a.seconds, 'report seconds', 5, 1800);
  const aBlocks = validateBlocks(a);
  const bBlocks = validateBlocks(b);
  const common = [];
  const inputFrames = [0, 0];
  for (const [tick, block] of aBlocks) {
    const other = bBlocks.get(tick);
    if (!other) continue;
    assert.equal(block.hash, other.hash, 'Confirmed frames differ at tick ' + tick);
    assert.deepEqual(block.inputs, other.inputs, 'Input totals differ at tick ' + tick);
    common.push(tick);
    for (const [slot, count] of block.inputs.entries()) inputFrames[slot] += count;
  }
  assert.ok(common.length >= minimumBlocks(seconds), 'Too few overlapping confirmed frames');
  const commonFrames = common.length * netHz;
  assert.ok(inputFrames.every(count => count >= commonFrames * 0.8), 'Player input coverage is below 80% of the shared frames');
  return { ok: true, roomId: a.roomId, firstTick: common[0], commonFrames, inputFrames };
}

async function main() {
  const { values } = parseArgs({ options: {
    endpoint: { type: 'string' }, role: { type: 'string' }, room: { type: 'string' },
    seconds: { type: 'string', default: '60' }, 'drop-after': { type: 'string' }, out: { type: 'string' },
    'connect-timeout': { type: 'string', default: '15' },
    compare: { type: 'string' }, with: { type: 'string' },
  } });
  if (values.compare || values.with) {
    assert.ok(values.compare && values.with, 'Provide --compare <host.json> --with <peer.json>');
    const reports = await Promise.all([values.compare, values.with].map(async file => JSON.parse(await readFile(file, 'utf8'))));
    console.log(JSON.stringify(compare(...reports)));
    return;
  }
  assert.ok(values.endpoint && (values.role === 'host' || values.role === 'peer'), 'Provide --endpoint <url> --role host|peer');
  assert.ok(values.role !== 'peer' || values.room, 'A peer requires --room <room-id>');
  const seconds = integer(values.seconds, '--seconds', 5, 1800);
  const dropAfter = values['drop-after'] === undefined ? undefined : integer(values['drop-after'], '--drop-after', 2, seconds - 3);
  const connectTimeout = integer(values['connect-timeout'], '--connect-timeout', 1, 120);
  const output = values.out ? await open(values.out, 'wx') : undefined;
  try {
    const report = await run({ ...values, seconds, dropAfter, connectTimeout });
    await output?.writeFile(JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ event: 'report', ...report }));
  } finally {
    await output?.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
