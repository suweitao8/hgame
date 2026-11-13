import { Room, type Client } from '@colyseus/core';
import { schema, t } from '@colyseus/schema';
import {
  LOCKSTEP_MAX_PLAYERS,
  decodeLockstepInput,
  encodeConfirmedFrame,
  type ConfirmedPlayerInput,
} from '@hgame/network-protocol';
import { allocateSlot, createMatchTag, handleRoomDrop, validateMaxClients, validateReconnectSeconds } from './shared.js';

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

/**
 * Strict confirmed-input relay. It never invents missing inputs or advances
 * a frame until every active slot has supplied that exact target frame.
 */
export class LockstepRoom extends Room {
  state = new LockstepRoomState();
  private reconnectSeconds = 0;
  private maxFutureFrames = 32;
  private maxFramesPerTick = 4;
  private readonly pending = new Map<number, Map<number, ConfirmedPlayerInput>>();
  private readonly lastSequence = new Map<string, number>();
  private readonly hashReports = new Map<number, Map<number, number>>();

  onCreate(options: Record<string, unknown> = {}): void {
    this.maxClients = validateMaxClients(options.maxClients, LOCKSTEP_MAX_PLAYERS);
    if (this.maxClients > LOCKSTEP_MAX_PLAYERS) throw new RangeError(`Lockstep supports at most ${LOCKSTEP_MAX_PLAYERS} players`);
    this.reconnectSeconds = validateReconnectSeconds(options.reconnectSeconds, 0);
    this.maxFutureFrames = Number(options.maxFutureFrames ?? 32);
    this.maxFramesPerTick = Number(options.maxFramesPerTick ?? 4);
    if (!Number.isInteger(this.maxFutureFrames) || this.maxFutureFrames < 2 || this.maxFutureFrames > 512) {
      throw new RangeError('maxFutureFrames must be an integer from 2 to 512');
    }
    if (!Number.isInteger(this.maxFramesPerTick) || this.maxFramesPerTick < 1 || this.maxFramesPerTick > 32) {
      throw new RangeError('maxFramesPerTick must be an integer from 1 to 32');
    }

    this.state.gameId = typeof options.gameId === 'string' ? options.gameId : 'network-lab';
    this.state.matchTag = createMatchTag();
    this.patchRate = 50;
    const netHz = Number(options.netHz ?? 20);
    if (!Number.isInteger(netHz) || netHz < 1 || netHz > 60) throw new RangeError('netHz must be an integer from 1 to 60');

    this.onMessageBytes('lockstep:input', (client, bytes: unknown) => this.receiveInput(client, bytes));
    this.onMessage('lockstep:hash', (client, payload: unknown) => this.receiveHash(client, payload));
    this.setFixedTimestep(() => this.sealAvailableFrames(), netHz);
  }

  onJoin(client: Client): void {
    const player = new LockstepPlayer();
    player.slot = allocateSlot(this.state.players.values(), this.maxClients);
    player.connected = true;
    this.state.players.set(client.sessionId, player);
  }

  onDrop(client: Client): void {
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
    for (let count = 0; count < this.maxFramesPerTick; count++) {
      const nextTick = this.state.netTick + 1;
      const activePlayers = Array.from(this.state.players.values())
        .filter((player) => this.reconnectSeconds > 0 || player.connected)
        .sort((a, b) => a.slot - b.slot);
      if (activePlayers.length === 0) return;

      const frameInputs = this.pending.get(nextTick);
      if (!frameInputs || activePlayers.some((player) => !frameInputs.has(player.slot))) return;

      const inputs = activePlayers.map((player) => frameInputs.get(player.slot)!);
      const bytes = encodeConfirmedFrame({ matchTag: this.state.matchTag, netTick: nextTick, inputs });
      for (const client of this.clients) client.sendBytes('lockstep:frame', bytes);
      this.pending.delete(nextTick);
      this.state.netTick = nextTick;

      for (const tick of this.pending.keys()) {
        if (tick <= this.state.netTick) this.pending.delete(tick);
      }
    }
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
    for (const [tick, inputs] of this.pending) {
      inputs.delete(slot);
      if (inputs.size === 0) this.pending.delete(tick);
    }
  }
}
