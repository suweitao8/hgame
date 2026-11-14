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

export function validateRateLimit(value: unknown, fallback: number, min = 1, max = 600, name = 'rateLimit'): number {
  const rate = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(rate) || rate < min || rate > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return rate;
}

interface TokenBucketState {
  tokens: number;
  lastMs: number;
}

/**
 * Per-key token bucket rate limiter to guard authoritative rooms against message floods.
 */
export class TokenBucketRateLimiter {
  private readonly buckets = new Map<string, TokenBucketState>();

  constructor(
    readonly capacity: number,
    readonly refillPerSecond: number,
  ) {
    if (!Number.isFinite(capacity) || capacity < 1) {
      throw new RangeError('capacity must be >= 1');
    }
    if (!Number.isFinite(refillPerSecond) || refillPerSecond <= 0) {
      throw new RangeError('refillPerSecond must be > 0');
    }
  }

  consume(key: string, cost = 1, nowMs = Date.now()): boolean {
    if (!Number.isFinite(cost) || cost <= 0) {
      throw new RangeError('cost must be > 0');
    }
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastMs: nowMs };
      this.buckets.set(key, bucket);
    } else if (nowMs > bucket.lastMs) {
      const elapsedSeconds = (nowMs - bucket.lastMs) / 1000;
      bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);
      bucket.lastMs = nowMs;
    }
    if (bucket.tokens + 1e-9 < cost) return false;
    bucket.tokens = Math.max(0, bucket.tokens - cost);
    return true;
  }

  remove(key: string): void {
    this.buckets.delete(key);
  }

  clear(): void {
    this.buckets.clear();
  }
}
