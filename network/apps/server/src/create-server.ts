import { Server, type Room } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { StateSyncRoom } from './rooms/StateSyncRoom.js';
import { PredictedRoom } from './rooms/PredictedRoom.js';
import { LockstepRoom } from './rooms/LockstepRoom.js';
import { AuthorityArenaRoom } from './rooms/AuthorityArenaRoom.js';

export { StateSyncRoom, PredictedRoom, LockstepRoom, AuthorityArenaRoom };

export interface HGameNetworkServerOptions {
  maxPayloadBytes?: number;
  pingIntervalMs?: number;
  pingMaxRetries?: number;
  enableLabRooms?: boolean;
  gameRooms?: Record<string, new (...args: any[]) => Room>;
}

/** Creates the shared Colyseus transport and registers the three network conformance rooms. */
export function createHGameNetworkServer(options: HGameNetworkServerOptions = {}): Server {
  const server = new Server({
    transport: new WebSocketTransport({
      pingInterval: options.pingIntervalMs ?? 5000,
      pingMaxRetries: options.pingMaxRetries ?? 3,
      maxPayload: options.maxPayloadBytes ?? 64 * 1024,
      perMessageDeflate: false,
    }),
  });

  if (options.enableLabRooms !== false) {
    server.define('lab_state_sync', StateSyncRoom);
    server.define('lab_predicted', PredictedRoom);
    server.define('lab_lockstep', LockstepRoom);
    server.define('lab_arena', AuthorityArenaRoom);
  }
  for (const [roomName, roomClass] of Object.entries(options.gameRooms ?? {})) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(roomName) || roomName.startsWith('lab_')) {
      throw new RangeError(`Invalid or reserved HGame room name: ${roomName}`);
    }
    server.define(roomName, roomClass);
  }
  return server;
}
