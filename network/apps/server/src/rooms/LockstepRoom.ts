import { Room, type Client } from '@colyseus/core';
import { schema, t } from '@colyseus/schema';
import {
  LOCKSTEP_FRAME_ENTRY_HEADER_BYTES,
  LOCKSTEP_FRAME_HEADER_BYTES,
  LOCKSTEP_MAX_INPUT_BYTES,
  LOCKSTEP_MAX_PLAYERS,
  LockstepInputFlags,
  decodeLockstepInput,
  encodeConfirmedFrame,
  type ConfirmedPlayerInput,
} from '@hgame/network-protocol';
import {
  TokenBucketRateLimiter,
  allocateSlot,
  createMatchTag,
  handleRoomDrop,
  validateMaxClients,
  validateRateLimit,
  validateReconnectSeconds,
} from './shared.js';

const LockstepPlayer = schema({
  slot: t.uint8().default(0),
  connected: t.boolean().default(true),
  lastInputSequence: t.uint32().default(0),
});

export const LockstepRoomState = schema({
  gameId: t.string().default(''),
  matchTag: t.uint32().default(0),
  netTick: t.uint32().default(0),
  players: t.map(LockstepPlayer),
});

const MAX_SYNC_BATCH_FRAMES = 240;
const MAX_SYNC_BATCH_BYTES = 128 * 1024;
const MAX_SYNC_BUFFERED_BYTES = 512 * 1024;
const MAX_LIVE_BUFFERED_BYTES = 1024 * 1024;

function bufferedBytes(ref: Client['ref']): number {
  // HGame's WebSocket transport exposes its write backlog on the client ref.
  return 'bufferedAmount' in ref && typeof ref.bufferedAmount === 'number' ? ref.bufferedAmount : 0;
}

type DeferredSync = {
  fromNetTick: number;
  timer: ReturnType<Room['clock']['setTimeout']>;
};

/**
 * Confirmed-input relay with optional anti-stall deadline synthesis and
 * bounded frame history replay for reconnect recovery.
 */
export class LockstepRoom extends Room {
  state = new LockstepRoomState();
  private reconnectSeconds = 0;
  private maxFutureFrames = 32;
  private maxFramesPerTick = 4;
  private frameDeadlineTicks = 0;
  private waitingTicksOnCurrentFrame = 0;
  private maxHistoryFrames = 600;
  private inputLimiter = new TokenBucketRateLimiter(64, 120);
  private syncLimiter = new TokenBucketRateLimiter(4, 8);
  private readonly deferredSyncs = new Map<string, DeferredSync>();
  private readonly pending = new Map<number, Map<number, ConfirmedPlayerInput>>();
  private readonly lastSequence = new Map<string, number>();
  private readonly hashReports = new Map<number, Map<number, number>>();
  private readonly frameHistory = new Map<number, Uint8Array>();

  onCreate(options: Record<string, unknown> = {}): void {
    this.maxClients = validateMaxClients(options.maxClients, LOCKSTEP_MAX_PLAYERS);
    if (this.maxClients > LOCKSTEP_MAX_PLAYERS) throw new RangeError(`Lockstep supports at most ${LOCKSTEP_MAX_PLAYERS} players`);
    this.reconnectSeconds = validateReconnectSeconds(options.reconnectSeconds, 0);
    this.maxFutureFrames = Number(options.maxFutureFrames ?? 32);
    this.maxFramesPerTick = Number(options.maxFramesPerTick ?? 4);
    this.frameDeadlineTicks = Number(options.frameDeadlineTicks ?? 0);
    this.maxHistoryFrames = Number(options.maxHistoryFrames ?? 600);
    if (!Number.isInteger(this.maxFutureFrames) || this.maxFutureFrames < 2 || this.maxFutureFrames > 512) {
      throw new RangeError('maxFutureFrames must be an integer from 2 to 512');
    }
    if (!Number.isInteger(this.maxFramesPerTick) || this.maxFramesPerTick < 1 || this.maxFramesPerTick > 32) {
      throw new RangeError('maxFramesPerTick must be an integer from 1 to 32');
    }
    if (!Number.isInteger(this.frameDeadlineTicks) || this.frameDeadlineTicks < 0 || this.frameDeadlineTicks > 600) {
      throw new RangeError('frameDeadlineTicks must be an integer from 0 to 600');
    }
    if (!Number.isInteger(this.maxHistoryFrames) || this.maxHistoryFrames < 16 || this.maxHistoryFrames > 3600) {
      throw new RangeError('maxHistoryFrames must be an integer from 16 to 3600');
    }

    this.state.gameId = typeof options.gameId === 'string' ? options.gameId : 'network-lab';
    this.state.matchTag = createMatchTag();
    this.patchRate = 50;
    const netHz = Number(options.netHz ?? 20);
    if (!Number.isInteger(netHz) || netHz < 1 || netHz > 60) throw new RangeError('netHz must be an integer from 1 to 60');

    const maxInputsPerSecond = validateRateLimit(
      options.maxInputsPerSecond,
      Math.max(60, netHz * 4),
      10,
      600,
      'maxInputsPerSecond',
    );
    this.inputLimiter = new TokenBucketRateLimiter(Math.max(32, maxInputsPerSecond), maxInputsPerSecond);
    const maxLiveFramesPerSecond = Math.min(netHz * this.maxFramesPerTick,
      maxInputsPerSecond + (this.frameDeadlineTicks ? netHz : 0));
    const maxFrameBytes = LOCKSTEP_FRAME_HEADER_BYTES + this.maxClients * (LOCKSTEP_FRAME_ENTRY_HEADER_BYTES + LOCKSTEP_MAX_INPUT_BYTES);
    const framesPerPage = Math.min(MAX_SYNC_BATCH_FRAMES, Math.floor(MAX_SYNC_BATCH_BYTES / maxFrameBytes));
    this.syncLimiter = new TokenBucketRateLimiter(4, Math.max(8, Math.ceil(2 * maxLiveFramesPerSecond / framesPerPage)));

    this.onMessageBytes('lockstep:input', (client, bytes: unknown) => this.receiveInput(client, bytes));
    this.onMessage('lockstep:hash', (client, payload: unknown) => this.receiveHash(client, payload));
    this.onMessage('lockstep:sync', (client, payload: unknown) => this.handleSyncRequest(client, payload));
    this.setFixedTimestep(() => this.sealAvailableFrames(), netHz);
  }

  onJoin(client: Client): void {
    const player = new LockstepPlayer();
    player.slot = allocateSlot(this.state.players.values(), this.maxClients);
    player.connected = true;
    this.state.players.set(client.sessionId, player);
  }

  onDrop(client: Client): void {
    this.clearDeferredSync(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (this.reconnectSeconds === 0) {
      if (player) this.removeSlot(client.sessionId, player.slot);
      return;
    }
    handleRoomDrop(this, client, player, this.reconnectSeconds);
  }

  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
  }

  onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) this.removeSlot(client.sessionId, player.slot);
  }

  private receiveInput(client: Client, raw: unknown): void {
    if (!(raw instanceof Uint8Array)) {
      client.send('lockstep:rejected', { reason: 'binary input packet required' });
      return;
    }
    const player = this.state.players.get(client.sessionId);
    if (!player || !player.connected) return;
    if (!this.inputLimiter.consume(client.sessionId)) {
      client.send('lockstep:rejected', { reason: 'rate limit exceeded' });
      return;
    }

    let packet;
    try {
      packet = decodeLockstepInput(raw);
    } catch (error) {
      client.send('lockstep:rejected', { reason: error instanceof Error ? error.message : 'invalid packet' });
      return;
    }
    if (packet.matchTag !== this.state.matchTag) {
      client.send('lockstep:rejected', { reason: 'match tag mismatch' });
      return;
    }
    const last = this.lastSequence.get(client.sessionId) ?? 0;
    if (packet.sequence <= last) {
      client.send('lockstep:rejected', { reason: 'duplicate or stale input sequence', sequence: packet.sequence });
      return;
    }
    if (packet.targetNetTick <= this.state.netTick || packet.targetNetTick > this.state.netTick + this.maxFutureFrames) {
      client.send('lockstep:rejected', { reason: 'target frame outside accepted window', targetNetTick: packet.targetNetTick });
      return;
    }

    let frame = this.pending.get(packet.targetNetTick);
    if (!frame) {
      frame = new Map();
      this.pending.set(packet.targetNetTick, frame);
    }
    if (frame.has(player.slot)) {
      client.send('lockstep:rejected', { reason: 'slot already submitted input for target frame', targetNetTick: packet.targetNetTick });
      return;
    }

    frame.set(player.slot, {
      slot: player.slot,
      sequence: packet.sequence,
      flags: packet.flags ?? 0,
      payload: packet.payload,
    });
    this.lastSequence.set(client.sessionId, packet.sequence);
    player.lastInputSequence = packet.sequence;
  }

  private sealAvailableFrames(): void {
    const activePlayers = Array.from(this.state.players.values())
      .filter(player => this.reconnectSeconds > 0 || player.connected)
      .sort((a, b) => a.slot - b.slot);
    if (activePlayers.length === 0) {
      this.waitingTicksOnCurrentFrame = 0;
      return;
    }

    for (let count = 0; count < this.maxFramesPerTick; count++) {
      const nextTick = this.state.netTick + 1;

      let frameInputs = this.pending.get(nextTick);
      const missingPlayers = activePlayers.filter((player) => !frameInputs?.has(player.slot));
      if (missingPlayers.length > 0) {
        if (count === 0) {
          this.waitingTicksOnCurrentFrame++;
          if (this.frameDeadlineTicks > 0 && this.waitingTicksOnCurrentFrame >= this.frameDeadlineTicks) {
            if (!frameInputs) {
              frameInputs = new Map();
              this.pending.set(nextTick, frameInputs);
            }
            for (const missing of missingPlayers) {
              frameInputs.set(missing.slot, {
                slot: missing.slot,
                sequence: 0,
                flags: LockstepInputFlags.NO_OP,
                payload: new Uint8Array(0),
              });
            }
          } else {
            return;
          }
        } else {
          return;
        }
      }

      this.waitingTicksOnCurrentFrame = 0;
      const inputs = activePlayers.map((player) => frameInputs!.get(player.slot)!);
      const bytes = encodeConfirmedFrame({ matchTag: this.state.matchTag, netTick: nextTick, inputs });
      this.frameHistory.set(nextTick, bytes);
      while (this.frameHistory.size > this.maxHistoryFrames) {
        const oldest = this.frameHistory.keys().next().value;
        if (oldest === undefined) break;
        this.frameHistory.delete(oldest);
      }

      this.pending.delete(nextTick);
      this.state.netTick = nextTick;

      for (const client of this.clients) {
        const player = this.state.players.get(client.sessionId);
        if (!player?.connected) continue;
        const ref = client.ref;
        if (bufferedBytes(ref) + bytes.byteLength > MAX_LIVE_BUFFERED_BYTES &&
          'terminate' in ref && typeof ref.terminate === 'function') {
          // A graceful close would wait behind the queued writes. End the socket
          // so the client can use the normal reconnect and history replay path.
          player.connected = false;
          ref.terminate();
          continue;
        }
        client.sendBytes('lockstep:frame', bytes);
      }
    }
  }

  private handleSyncRequest(client: Client, payload: unknown): void {
    if (!this.state.players.get(client.sessionId)?.connected) return;
    const fromNetTick = typeof payload === 'object' && payload !== null && 'fromNetTick' in payload
      ? Number((payload as { fromNetTick: unknown }).fromNetTick)
      : 1;
    if (!Number.isInteger(fromNetTick) || fromNetTick < 1 || fromNetTick > 0xffff_ffff) {
      client.send('lockstep:sync-status', { ok: false, reason: 'invalid fromNetTick' });
      return;
    }
    const retryAfterMs = Math.ceil(1000 / this.syncLimiter.refillPerSecond);
    const deferred = this.deferredSyncs.get(client.sessionId);
    if (deferred) {
      if (deferred.fromNetTick !== fromNetTick) {
        client.send('lockstep:sync-status', { ok: false, fromNetTick, reason: 'retry_later', retryAfterMs });
      }
      return;
    }
    if (fromNetTick > this.state.netTick) {
      client.send('lockstep:sync-status', {
        ok: true,
        fromNetTick,
        toNetTick: this.state.netTick,
        sentFrames: 0,
        sentBytes: 0,
        hasMore: false,
      });
      return;
    }
    if (!this.frameHistory.has(fromNetTick)) {
      const oldestAvailableTick = this.frameHistory.keys().next().value ?? null;
      client.send('lockstep:sync-status', {
        ok: false,
        fromNetTick,
        reason: 'history_evicted',
        oldestAvailableTick,
        currentNetTick: this.state.netTick,
      });
      return;
    }

    if (bufferedBytes(client.ref) >= MAX_SYNC_BUFFERED_BYTES || !this.syncLimiter.consume(client.sessionId)) {
      // Defer one request per session without changing the replay protocol
      // for installed clients. Other players can keep receiving live frames.
      const timer = this.clock.setTimeout(() => {
        this.deferredSyncs.delete(client.sessionId);
        this.handleSyncRequest(client, { fromNetTick });
      }, retryAfterMs);
      this.deferredSyncs.set(client.sessionId, { fromNetTick, timer });
      return;
    }

    let sentFrames = 0;
    let sentBytes = 0;
    let lastSent = fromNetTick - 1;
    for (let tick = fromNetTick; tick <= this.state.netTick && sentFrames < MAX_SYNC_BATCH_FRAMES; tick++) {
      const bytes = this.frameHistory.get(tick);
      if (!bytes || sentBytes + bytes.byteLength > MAX_SYNC_BATCH_BYTES) break;
      client.sendBytes('lockstep:frame', bytes);
      sentBytes += bytes.byteLength;
      lastSent = tick;
      sentFrames++;
    }
    client.send('lockstep:sync-status', {
      ok: true,
      fromNetTick,
      toNetTick: lastSent,
      sentFrames,
      sentBytes,
      hasMore: lastSent < this.state.netTick,
    });
  }

  private clearDeferredSync(sessionId: string): void {
    this.deferredSyncs.get(sessionId)?.timer.clear();
    this.deferredSyncs.delete(sessionId);
  }

  private receiveHash(client: Client, payload: unknown): void {
    const player = this.state.players.get(client.sessionId);
    if (!player || !payload || typeof payload !== 'object') return;
    const candidate = payload as { netTick?: unknown; hash?: unknown };
    if (!Number.isInteger(candidate.netTick) || !Number.isInteger(candidate.hash) ||
        (candidate.netTick as number) < 1 || (candidate.netTick as number) > this.state.netTick ||
        (candidate.hash as number) < 0 || (candidate.hash as number) > 0xffff_ffff) return;

    const netTick = candidate.netTick as number;
    let reports = this.hashReports.get(netTick);
    if (!reports) {
      reports = new Map();
      this.hashReports.set(netTick, reports);
    }
    reports.set(player.slot, candidate.hash as number);
    if (reports.size > 1 && new Set(reports.values()).size > 1) {
      this.broadcast('lockstep:peer-desync', {
        netTick,
        reports: Array.from(reports.entries()).sort((a, b) => a[0] - b[0]).map(([slot, hash]) => ({ slot, hash })),
        authoritative: false,
      });
    }
    while (this.hashReports.size > 120) {
      const oldest = this.hashReports.keys().next().value;
      if (oldest === undefined) break;
      this.hashReports.delete(oldest);
    }
  }

  private removeSlot(sessionId: string, slot: number): void {
    this.state.players.delete(sessionId);
    this.lastSequence.delete(sessionId);
    this.inputLimiter.remove(sessionId);
    this.syncLimiter.remove(sessionId);
    this.clearDeferredSync(sessionId);
    for (const [tick, inputs] of this.pending) {
      inputs.delete(slot);
      if (inputs.size === 0) this.pending.delete(tick);
    }
  }
}
