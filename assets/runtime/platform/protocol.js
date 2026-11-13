export const GAME_ENGINE_PROTOCOL = 'webasset-html-game/v1';
export const GAME_ENGINE_PROTOCOL_VERSION = 1;

export const GAME_MESSAGE_TYPES = Object.freeze([
  'game:hello',
  'game:ready',
  'game:error',
  'game:metrics',
  'game:state',
]);

export const HOST_MESSAGE_TYPES = Object.freeze([
  'host:hello',
  'host:focus',
  'host:resize',
  'host:visibility',
]);
