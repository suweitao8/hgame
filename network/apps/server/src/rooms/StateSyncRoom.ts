import { Room, type Client } from '@colyseus/core';
import { schema, t } from '@colyseus/schema';
import { allocateSlot, createMatchTag, handleRoomDrop, validateMaxClients, validateReconnectSeconds } from './shared.js';

const StateSyncPlayer = schema({
  slot: t.uint8().default(0),
  connected: t.boolean().default(true),
});

export const StateSyncRoomState = schema({
  gameId: t.string().default(''),
  matchTag: t.uint32().default(0),
  phase: t.string().default('waiting'),
  revision: t.uint32().default(0),
  counter: t.int32().default(0),
  players: t.map(StateSyncPlayer),
});

/**
 * Development conformance room. It proves server-owned schema state and
 * client command validation; production games provide their own typed Schema.
 */
export class StateSyncRoom extends Room {
  state = new StateSyncRoomState();
  private reconnectSeconds = 45;

  onCreate(options: Record<string, unknown> = {}): void {
    this.maxClients = validateMaxClients(options.maxClients);
    this.reconnectSeconds = validateReconnectSeconds(options.reconnectSeconds);
    this.state.gameId = typeof options.gameId === 'string' ? options.gameId : 'network-lab';
    this.state.matchTag = createMatchTag();
    this.state.phase = 'waiting';
    this.patchRate = 50;

    this.onMessage('state:increment', (client, payload: unknown) => {
      if (!this.state.players.has(client.sessionId)) return;
      const amount = typeof payload === 'object' && payload !== null && 'amount' in payload
        ? Number((payload as { amount: unknown }).amount)
        : 1;
      if (!Number.isInteger(amount) || amount < 1 || amount > 10) {
        client.send('state:rejected', { reason: 'amount must be an integer from 1 to 10' });
        return;
      }
      this.state.counter += amount;
      this.state.revision++;
      this.broadcast('state:accepted', { revision: this.state.revision, counter: this.state.counter });
    });
  }

  onJoin(client: Client): void {
    const player = new StateSyncPlayer();
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
