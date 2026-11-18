export const MOVES = Object.freeze({
  up: Object.freeze([0, -1]),
  left: Object.freeze([-1, 0]),
  down: Object.freeze([0, 1]),
  right: Object.freeze([1, 0]),
});

const sameCell = (a, b) => a.x === b.x && a.y === b.y;

export function createPuzzle(TileMap, room) {
  const boxes = [];
  const sockets = [];
  let spawn;
  let exit;
  const map = new TileMap({ tileWidth: 64, tileHeight: 64, solid: ['#'],
    tiles: room.tiles.map((row, y) => [...row].map((value, x) => {
      const cell = { x, y };
      if (value === 'S') {
        if (spawn) throw new Error('Room has multiple spawns');
        spawn = cell;
      } else if (value === 'G') {
        if (exit) throw new Error('Room has multiple exits');
        exit = cell;
      } else if (value === 'a' || value === 'b') {
        boxes.push({ ...cell, color: value });
      } else if (value === 'A' || value === 'B') {
        sockets.push({ ...cell, color: value.toLowerCase() });
      } else if (value !== '#' && value !== '.') {
        throw new Error('Unknown room tile: ' + value);
      }
      return value === '#' ? '#' : '.';
    })),
  });
  if (!spawn || !exit || !boxes.length ||
      ['a', 'b'].some(color => boxes.filter(box => box.color === color).length !== sockets.filter(socket => socket.color === color).length)) {
    throw new Error('Room needs a spawn, an exit, and one socket for each cell of the same color');
  }
  const state = { player: spawn, cells: boxes, moves: 0, open: false, won: false };
  const history = [];
  const isMatching = (box, socket) => box.color === socket.color && sameCell(box, socket);

  return {
    map, exit, sockets, state,
    step(direction) {
      if (state.won || !Object.hasOwn(MOVES, direction)) return false;
      const [dx, dy] = MOVES[direction];
      const position = { x: state.player.x + dx, y: state.player.y + dy };
      if (map.isSolid(position.x, position.y) || (!state.open && sameCell(position, exit))) return false;
      const index = boxes.findIndex(box => sameCell(box, position));
      const box = boxes[index];
      let pushed;
      if (box) {
        pushed = { x: box.x + dx, y: box.y + dy, color: box.color };
        if (map.isSolid(pushed.x, pushed.y) || sameCell(pushed, exit) ||
            boxes.some(other => sameCell(other, pushed))) return false;
      }
      history.push({ player: state.player, index, box, open: state.open });
      state.player = position;
      if (pushed) {
        boxes[index] = pushed;
        state.open = sockets.every(socket => boxes.some(cell => isMatching(cell, socket)));
      }
      state.moves++;
      state.won = state.open && sameCell(position, exit);
      return true;
    },
    undo() {
      const previous = history.pop();
      if (!previous) return false;
      state.player = previous.player;
      if (previous.box) boxes[previous.index] = previous.box;
      state.moves--;
      state.open = previous.open;
      state.won = false;
      return true;
    },
  };
}
