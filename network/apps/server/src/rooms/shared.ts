import { randomBytes } from 'node:crypto';
import type { Client, Room } from '@colyseus/core';

export interface PlayerSlot {
  slot: number;
  connected: boolean;
}

export function createMatchTag(): number {
  let tag = randomBytes(4).readUInt32LE(0);
  if (tag === 0) tag = 1;
  return tag;
}

export function allocateSlot(players: Iterable<PlayerSlot>, maxPlayers = 32): number {
  const used = new Set<number>();
  for (const player of players) used.add(player.slot);
  for (let slot = 0; slot < maxPlayers; slot++) if (!used.has(slot)) return slot;
  throw new Error('No free player slots remain in this room');
}

export function handleRoomDrop<TPlayer extends PlayerSlot>(
  room: Room,
  client: Client,
  player: TPlayer | undefined,
  reconnectSeconds: number,
): void {
  if (player) player.connected = false;
  if (reconnectSeconds > 0) {
    const reconnect = room.allowReconnection(client, reconnectSeconds);
    void reconnect.catch(() => undefined);
  }
}

export function validateReconnectSeconds(value: unknown, fallback = 45): number {
  const seconds = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > 300) {
    throw new RangeError('reconnectSeconds must be an integer from 0 to 300');
  }
  return seconds;
}

export function validateMaxClients(value: unknown, fallback = 16): number {
  const count = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 32) {
    throw new RangeError('maxClients must be an integer from 1 to 32');
  }
  return count;
}
