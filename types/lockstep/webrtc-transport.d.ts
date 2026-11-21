/**
 * Dual-channel WebRTC DataChannel transport adapter providing both:
 *  - `'unreliable'`: `{ ordered: false, maxRetransmits: 0 }` (zero TCP head-of-line blocking for snapshots/inputs)
 *  - `'reliable'`: `{ ordered: true }` (control events, RPCs, match lifecycle)
 * Automatically and transparently falls back to `fallbackSend` (e.g. WebSocket) whenever
 * `RTCPeerConnection` is unavailable, ICE fails/times out, or the DataChannel is not open.
 */
/**
 * @typedef {object} WebRtcSignalMessage
 * @property {'offer' | 'answer' | 'ice-candidate'} type
 * @property {any} [sdp]
 * @property {any} [candidate]
 */
/**
 * @typedef {object} WebRtcTransportOptions
 * @property {any[]} [iceServers]
 * @property {number} [maxRetransmits=0]
 * @property {string} [reliableLabel='hgame-reliable']
 * @property {string} [unreliableLabel='hgame-unreliable']
 * @property {any} [PeerConnectionCtor]
 * @property {((msg: WebRtcSignalMessage) => void) | null} [sendSignal=null]
 * @property {((payload: any, meta: { channel: 'reliable' | 'unreliable' }) => void) | null} [fallbackSend=null]
 * @property {number} [connectTimeoutMs=5000]
 */
/**
 * @typedef {object} WebRtcTransportStats
 * @property {'idle' | 'connecting' | 'webrtc' | 'fallback' | 'closed'} mode
 * @property {string | null} fallbackReason
 * @property {boolean} reliableOpen
 * @property {boolean} unreliableOpen
 * @property {{ ordered: boolean, maxRetransmits: number }} unreliableConfig
 * @property {{ ordered: boolean }} reliableConfig
 * @property {number} packetsSent
 * @property {number} packetsReceived
 * @property {number} unreliableSent
 * @property {number} reliableSent
 * @property {number} fallbackSent
 */
/**
 * Create a dual-channel WebRTC DataChannel transport with automatic WebSocket/fallback degradation.
 * @param {WebRtcTransportOptions} [options]
 */
export function createWebRtcDataChannelTransport({ iceServers, maxRetransmits, reliableLabel, unreliableLabel, PeerConnectionCtor, sendSignal, fallbackSend, connectTimeoutMs, }?: WebRtcTransportOptions | undefined): Readonly<{
    createOffer: () => Promise<any>;
    handleSignal: (msg: WebRtcSignalMessage) => Promise<any>;
    send: (payload: any, { channel }?: {
        channel?: "unreliable" | "reliable";
    } | undefined) => "webrtc" | "fallback" | "dropped" | "closed";
    onMessage: (handler: (payload: any, meta: {
        channel: "reliable" | "unreliable" | "fallback";
    }) => void) => () => void;
    injectFallbackMessage: (payload: any) => void;
    getStats: () => WebRtcTransportStats;
    close: () => boolean;
}>;
export type WebRtcSignalMessage = {
    type: "offer" | "answer" | "ice-candidate";
    sdp?: any;
    candidate?: any;
};
export type WebRtcTransportOptions = {
    iceServers?: any[] | undefined;
    maxRetransmits?: number | undefined;
    reliableLabel?: string | undefined;
    unreliableLabel?: string | undefined;
    PeerConnectionCtor?: any;
    sendSignal?: ((msg: WebRtcSignalMessage) => void) | null | undefined;
    fallbackSend?: ((payload: any, meta: {
        channel: "reliable" | "unreliable";
    }) => void) | null | undefined;
    connectTimeoutMs?: number | undefined;
};
export type WebRtcTransportStats = {
    mode: "idle" | "connecting" | "webrtc" | "fallback" | "closed";
    fallbackReason: string | null;
    reliableOpen: boolean;
    unreliableOpen: boolean;
    unreliableConfig: {
        ordered: boolean;
        maxRetransmits: number;
    };
    reliableConfig: {
        ordered: boolean;
    };
    packetsSent: number;
    packetsReceived: number;
    unreliableSent: number;
    reliableSent: number;
    fallbackSent: number;
};
