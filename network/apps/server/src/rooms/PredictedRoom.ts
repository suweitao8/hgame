import { Room, type Client } from '@colyseus/core';
import { schema, t } from '@colyseus/schema';
import { applyLinearMotionInput } from '@hgame/network-simulation';
import { allocateSlot, createMatchTag, handleRoomDrop, validateMaxClients, validateReconnectSeconds } from './shared.js';

const MoveInput = schema({
  moveX: t.int8().default(0),
  moveY: t.int8().default(0),
});

const PredictedPlayer = schema({
  slot: t.uint8().default(0),
  connected: t.boolean().default(true),
  x: t.float32().default(0),
  y: t.float32().default(0),
});

export const PredictedRoomState = schema({
  gameId: t.string().default(''),
  matchTag: t.uint32().default(0),
  serverTick: t.uint32().default(0),
  players: t.map(PredictedPlayer),
});

/** Development-only shared-step example for Colyseus 0.18 native prediction. */
export class PredictedRoom extends Room {
  state = new PredictedRoomState();
  private reconnectSeconds = 45;
  private readonly inputChannels = this.defineInput(MoveInput, {
    bufferMaxSize: 64,
    sanitize: { moveX: [-1, 1], moveY: [-1, 1] },
    idle: () => ({ moveX: 0, moveY: 0 }),
  });

  onCreate(options: Record<string, unknown> = {}): void {
    this.maxClients = validateMaxClients(options.maxClients, 8);
    this.reconnectSeconds = validateReconnectSeconds(options.reconnectSeconds);
    this.state.gameId = typeof options.gameId === 'string' ? options.gameId : 'network-lab';
    this.state.matchTag = createMatchTag();
    this.patchRate = 50;

    const tickRate = Number(options.tickRate ?? 30);
    if (!Number.isInteger(tickRate) || tickRate < 10 || tickRate > 60) {
      throw new RangeError('Prediction tickRate must be an integer from 10 to 60');
    }
    this.setFixedTimestep((ctx) => {
      this.state.serverTick = ctx.tick;
      for (const [sessionId, player] of this.state.players) {
        const command = this.inputChannels.get(sessionId).next();
        if (command) applyLinearMotionInput(player, command, ctx.dt);
      }
    }, tickRate);
  }

  onJoin(client: Client): void {
    const player = new PredictedPlayer();
    player.slot = allocateSlot(this.state.players.values(), this.maxClients);
    player.connected = true;
    this.state.players.set(client.sessionId, player);
  }

  onDrop(client: Client): void {
    handleRoomDrop(this, client, this.state.players.get(client.sessionId), this.reconnectSeconds);
  }

  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
  }
}
