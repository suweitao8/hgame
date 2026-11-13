import { Client, Predict, type Room } from '@colyseus/sdk';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface HGameNetworkClientOptions {
  endpoint: string;
  storage?: StorageLike | null;
  storagePrefix?: string;
}

export interface HGameJoinOptions {
  gameId: string;
  roomName: string;
  roomOptions?: Record<string, unknown>;
  resume?: boolean;
}

export type MessageHandler<T = unknown> = (message: T) => void;
export type StateHandler<T = unknown> = (state: T) => void;
export type LifecycleHandler = (...args: unknown[]) => void;

function defaultStorage(): StorageLike | null {
  try {
    return typeof globalThis.sessionStorage === 'undefined' ? null : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function reconnectKey(prefix: string, gameId: string, roomName: string): string {
  return `${prefix}:${encodeURIComponent(gameId)}:${encodeURIComponent(roomName)}`;
}

export class HGameNetworkClient {
  private readonly client: Client;
  private readonly storage: StorageLike | null;
  private readonly storagePrefix: string;

  constructor(options: HGameNetworkClientOptions) {
    if (!options.endpoint || !/^https?:\/\//i.test(options.endpoint)) {
      throw new TypeError('HGame network endpoint must be an http(s) URL; Colyseus upgrades it to WebSocket');
    }
    this.client = new Client(options.endpoint);
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.storagePrefix = options.storagePrefix ?? 'hgame.network.v1';
  }

  async joinOrCreate(options: HGameJoinOptions): Promise<HGameRoomConnection> {
    this.validateJoinOptions(options);
    const key = reconnectKey(this.storagePrefix, options.gameId, options.roomName);
    const token = options.resume === false ? null : this.storage?.getItem(key) ?? null;
    if (token) {
      try {
        const room = await this.client.reconnect(token);
        return new HGameRoomConnection(this.client, room, this.storage, key);
      } catch {
        this.storage?.removeItem(key);
      }
    }
    const room = await this.client.joinOrCreate(options.roomName, options.roomOptions ?? {});
    return new HGameRoomConnection(this.client, room, this.storage, key);
  }

  async create(options: HGameJoinOptions): Promise<HGameRoomConnection> {
    this.validateJoinOptions(options);
    const room = await this.client.create(options.roomName, options.roomOptions ?? {});
    const key = reconnectKey(this.storagePrefix, options.gameId, options.roomName);
    return new HGameRoomConnection(this.client, room, this.storage, key);
  }

  async joinById(options: HGameJoinOptions & { roomId: string }): Promise<HGameRoomConnection> {
    this.validateJoinOptions(options);
    if (!options.roomId) throw new TypeError('roomId is required');
    const room = await this.client.joinById(options.roomId, options.roomOptions ?? {});
    const key = reconnectKey(this.storagePrefix, options.gameId, options.roomName);
    return new HGameRoomConnection(this.client, room, this.storage, key);
  }

  private validateJoinOptions(options: HGameJoinOptions): void {
    if (!options.gameId?.trim() || !options.roomName?.trim()) {
      throw new TypeError('gameId and roomName are required');
    }
  }
}

export class HGameRoomConnection {
  private currentRoom: Room;
  private readonly messageHandlers = new Map<string, Set<MessageHandler>>();
  private readonly stateHandlers = new Set<StateHandler>();
  private readonly messageUnsubs = new Map<string, Map<MessageHandler, () => void>>();
  private readonly stateUnsubs = new Map<StateHandler, () => void>();
  private readonly dropHandlers = new Set<LifecycleHandler>();
  private readonly reconnectHandlers = new Set<LifecycleHandler>();
  private readonly leaveHandlers = new Set<LifecycleHandler>();
  private readonly replaceHandlers = new Set<LifecycleHandler>();

  constructor(
    private readonly client: Client,
    room: Room,
    private readonly storage: StorageLike | null,
    private readonly storageKey: string,
  ) {
    this.currentRoom = room;
    this.attach(room);
  }

  get room(): Room { return this.currentRoom; }
  get roomId(): string { return this.currentRoom.roomId; }
  get sessionId(): string { return this.currentRoom.sessionId; }
  get reconnectionToken(): string { return this.currentRoom.reconnectionToken; }

  send(type: string | number, message?: unknown): void {
    this.currentRoom.send(type, message);
  }

  sendBytes(type: string | number, bytes: Uint8Array): void {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('Binary messages must be Uint8Array');
    this.currentRoom.sendBytes(type, bytes);
  }

  input(): ReturnType<Room['input']> { return this.currentRoom.input(); }

  prediction(options: Parameters<typeof Predict.get>[1] = {}): ReturnType<typeof Predict.get> {
    return Predict.get(this.currentRoom, options);
  }

  onMessage<T = unknown>(type: string, handler: MessageHandler<T>): () => void {
    const handlers = this.messageHandlers.get(type) ?? new Set<MessageHandler>();
    handlers.add(handler as MessageHandler);
    this.messageHandlers.set(type, handlers);
    const unsubscribers = this.messageUnsubs.get(type) ?? new Map<MessageHandler, () => void>();
    unsubscribers.set(handler as MessageHandler, this.currentRoom.onMessage(type, handler as (message: any) => void));
    this.messageUnsubs.set(type, unsubscribers);
    return () => {
      handlers.delete(handler as MessageHandler);
      const currentUnsubs = this.messageUnsubs.get(type);
      currentUnsubs?.get(handler as MessageHandler)?.();
      currentUnsubs?.delete(handler as MessageHandler);
      if (handlers.size === 0) this.messageHandlers.delete(type);
      if (currentUnsubs?.size === 0) this.messageUnsubs.delete(type);
    };
  }

  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    const wrapped = handler as (state: any) => void;
    this.currentRoom.onStateChange(wrapped);
    this.stateUnsubs.set(handler, () => this.currentRoom.onStateChange.remove(wrapped));
    return () => {
      this.stateUnsubs.get(handler)?.();
      this.stateUnsubs.delete(handler);
      this.stateHandlers.delete(handler);
    };
  }

  onDrop(handler: LifecycleHandler): () => void {
    this.dropHandlers.add(handler);
    return () => this.dropHandlers.delete(handler);
  }

  onReconnect(handler: LifecycleHandler): () => void {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  onLeave(handler: LifecycleHandler): () => void {
    this.leaveHandlers.add(handler);
    return () => this.leaveHandlers.delete(handler);
  }

  onRoomReplaced(handler: LifecycleHandler): () => void {
    this.replaceHandlers.add(handler);
    return () => this.replaceHandlers.delete(handler);
  }

  async reconnect(): Promise<void> {
    const token = this.storage?.getItem(this.storageKey) ?? this.currentRoom.reconnectionToken;
    if (!token) throw new Error('No reconnection token is available');
    const room = await this.client.reconnect(token);
    this.currentRoom = room;
    this.attach(room);
    for (const handler of this.replaceHandlers) handler(room);
  }

  async leave(consented = true): Promise<void> {
    await this.currentRoom.leave(consented);
    if (consented) this.storage?.removeItem(this.storageKey);
  }

  private attach(room: Room): void {
    this.storage?.setItem(this.storageKey, room.reconnectionToken);
    this.messageUnsubs.clear();
    for (const [type, handlers] of this.messageHandlers) {
      const unsubscribers = new Map<MessageHandler, () => void>();
      for (const handler of handlers) {
        unsubscribers.set(handler, room.onMessage(type, handler as (message: any) => void));
      }
      this.messageUnsubs.set(type, unsubscribers);
    }
    this.stateUnsubs.clear();
    for (const handler of this.stateHandlers) {
      const wrapped = handler as (state: any) => void;
      room.onStateChange(wrapped);
      this.stateUnsubs.set(handler, () => room.onStateChange.remove(wrapped));
    }
    room.onDrop((code, reason) => {
      for (const handler of this.dropHandlers) handler(code, reason);
    });
    room.onReconnect(() => {
      this.storage?.setItem(this.storageKey, room.reconnectionToken);
      for (const handler of this.reconnectHandlers) handler();
    });
    room.onLeave((code, reason) => {
      this.storage?.removeItem(this.storageKey);
      for (const handler of this.leaveHandlers) handler(code, reason);
    });
  }
}
