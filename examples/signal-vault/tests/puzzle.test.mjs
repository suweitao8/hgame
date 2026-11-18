import test from 'node:test';
import assert from 'node:assert/strict';
import { TileMap } from '../../../assets/runtime/world/tilemap.js';
import { createPuzzle } from '../src/puzzle.js';
import { solutions } from '../routes.mjs';
import rooms from '../src/rooms.json' with { type: 'json' };

const simpleRoom = {
  tiles: ['#######', '#S.aA.#', '#.....#', '#....G#', '#######'],
};

test('signal vault blocks walls and closed exits, then wins with a matched socket', () => {
  const puzzle = createPuzzle(TileMap, simpleRoom);
  assert.equal(puzzle.step('up'), false);
  assert.equal(puzzle.state.moves, 0);
  assert.equal(puzzle.map.isSolid(-1, 2), true);
  assert.equal(puzzle.step('right'), true);
  assert.equal(puzzle.step('right'), true);
  assert.equal(puzzle.state.open, true);
  assert.deepEqual(puzzle.state.cells, [{ x: 4, y: 1, color: 'a' }]);
  assert.equal(puzzle.step('right'), true);
  assert.equal(puzzle.state.open, false);
  assert.equal(puzzle.step('right'), false);
  assert.equal(puzzle.undo(), true);
  assert.equal(puzzle.state.open, true);
  assert.equal(puzzle.step('left'), true);
  assert.equal(puzzle.step('down'), true);
  assert.equal(puzzle.step('down'), true);
  for (let i = 0; i < 3; i++) assert.equal(puzzle.step('right'), true);
  assert.equal(puzzle.state.won, true);
});

test('all authored rooms can be solved by a sequence of legal moves', () => {
  assert.equal(rooms.length, solutions.length);
  for (const [index, room] of rooms.entries()) {
    const puzzle = createPuzzle(TileMap, room);
    assert.equal(puzzle.state.open, false);
    for (const step of solutions[index]) assert.equal(puzzle.step(step), true, 'blocked ' + step + ' in room ' + (index + 1));
    assert.equal(puzzle.state.won, true);
    assert.equal(puzzle.state.moves, solutions[index].length);
  }
});

test('undo reverses a push and its move count, and only matched cells open the gate', () => {
  const room = { tiles: ['########', '#SaB..G#', '#.bA...#', '#......#', '########'] };
  const puzzle = createPuzzle(TileMap, room);
  assert.equal(puzzle.step('right'), true);
  assert.equal(puzzle.state.open, false);
  assert.deepEqual(puzzle.state.player, { x: 2, y: 1 });
  assert.equal(puzzle.undo(), true);
  assert.deepEqual(puzzle.state.player, { x: 1, y: 1 });
  assert.deepEqual(puzzle.state.cells[0], { x: 2, y: 1, color: 'a' });
  assert.equal(puzzle.state.moves, 0);
});
