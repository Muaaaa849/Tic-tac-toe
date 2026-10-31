// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, DIRS, lineKind } from '../src/game.js';

const R = 0, G = 1, B = 2;

test('13 unique directions', () => {
  assert.equal(DIRS.length, 13);
  const keys = new Set();
  for (const d of DIRS) {
    const neg = d.map((v) => -v).join();
    assert.ok(!keys.has(neg), 'no opposite duplicates');
    keys.add(d.join());
  }
  assert.equal(keys.size, 13);
});

test('pieces stack and turns alternate', () => {
  const g = new Game({ size: 4, height: 4 });
  assert.equal(g.turn, 0);
  const m = g.place(1, 1, R);
  assert.deepEqual([m.x, m.y, m.z, m.player], [1, 1, 0, 0]);
  assert.equal(g.turn, 1);
  const m2 = g.place(1, 1, B);
  assert.equal(m2.z, 1);
  assert.equal(g.heightAt(1, 1), 2);
  assert.equal(g.colorAt(1, 1, 0), R);
  assert.equal(g.colorAt(1, 1, 1), B);
});

test('full column rejects', () => {
  const g = new Game({ size: 4, height: 2 });
  g.place(0, 0, R); g.place(0, 0, G);
  assert.equal(g.place(0, 0, B), null);
  assert.equal(g.isColumnFull(0, 0), true);
});

test('horizontal win — whoever places the 4th wins', () => {
  const g = new Game({ size: 5, height: 5 });
  g.place(0, 0, R); // p0
  g.place(1, 0, R); // p1
  g.place(2, 0, R); // p0
  assert.equal(g.result, null);
  g.place(3, 0, R); // p1 completes
  assert.equal(g.result.type, 'win');
  assert.equal(g.result.player, 1);
  assert.equal(g.result.lines[0].kind, 'straight');
  assert.equal(g.result.lines[0].cells.length, 4);
});

test('mixed colors do not win', () => {
  const g = new Game({ size: 5, height: 5 });
  g.place(0, 0, R); g.place(1, 0, G); g.place(2, 0, R); g.place(3, 0, R);
  assert.equal(g.result, null);
});

test('tower win', () => {
  const g = new Game({ size: 4, height: 6 });
  g.place(2, 2, G); g.place(2, 2, G); g.place(2, 2, G);
  assert.equal(g.result, null);
  g.place(2, 2, G);
  assert.equal(g.result.lines[0].kind, 'tower');
});

test('staircase win hidden under other pieces', () => {
  const g = new Game({ size: 5, height: 5 });
  // Build columns so that blue sits at (0,2,0) (1,2,1) (2,2,2) (3,2,3).
  g.place(0, 2, B);
  g.place(1, 2, R); g.place(1, 2, B);
  g.place(2, 2, G); g.place(2, 2, R); g.place(2, 2, B);
  // cover the lower ones so they are invisible from above
  g.place(0, 2, G);
  g.place(1, 2, G);
  g.place(3, 2, R); g.place(3, 2, G); g.place(3, 2, R);
  assert.equal(g.result, null);
  const who = g.turn;
  g.place(3, 2, B);
  assert.equal(g.result?.type, 'win');
  assert.equal(g.result.player, who);
  assert.equal(g.result.lines[0].kind, 'stairs');
  assert.deepEqual(g.result.lines[0].cells, [[0, 2, 0], [1, 2, 1], [2, 2, 2], [3, 2, 3]]);
});

test('space diagonal win and filling the middle', () => {
  const g = new Game({ size: 4, height: 4 });
  const fill = (x, y, n) => { for (let i = 0; i < n; i++) g.place(x, y, G); };
  // Red on (0,0,0) (1,1,1) (2,2,2) (3,3,3), placing (1,1,1) last.
  g.place(0, 0, R);
  fill(2, 2, 2); g.place(2, 2, R);
  fill(3, 3, 3); g.place(3, 3, R);
  fill(1, 1, 1);
  assert.equal(g.result, null);
  g.place(1, 1, R);
  assert.equal(g.result.lines.some((l) => l.kind === 'space'), true);
  const line = g.result.lines.find((l) => l.kind === 'space');
  assert.deepEqual(line.cells, [[0, 0, 0], [1, 1, 1], [2, 2, 2], [3, 3, 3]]);
});

test('5 in a row counts and lists every cell', () => {
  const g = new Game({ size: 6, height: 2 });
  g.place(0, 3, B); g.place(1, 3, B); g.place(3, 3, B); g.place(4, 3, B);
  g.place(2, 3, B);
  assert.equal(g.result.lines[0].cells.length, 5);
});

test('draw when the board fills up', () => {
  const g = new Game({ size: 4, height: 1 });
  // 4x4 single layer, colors arranged so no line of 4 exists.
  const pattern = [
    [R, G, B, R],
    [G, B, R, G],
    [R, G, B, R],
    [G, B, R, G],
  ];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) g.place(x, y, pattern[y][x]);
  assert.equal(g.result?.type, 'draw');
});

test('undo restores turn and result', () => {
  const g = new Game({ size: 4, height: 4 });
  g.place(0, 0, R); g.place(1, 0, R); g.place(2, 0, R); g.place(3, 0, R);
  assert.equal(g.result.type, 'win');
  const m = g.undo();
  assert.equal(m.x, 3);
  assert.equal(g.result, null);
  assert.equal(g.turn, 1);
  assert.equal(g.heightAt(3, 0), 0);
});

test('serialize round trip', () => {
  const g = new Game({ size: 5, height: 4, first: 1 });
  g.place(0, 0, R); g.place(0, 0, G); g.place(4, 4, B);
  const g2 = Game.fromJSON(JSON.parse(JSON.stringify(g)));
  assert.equal(g2.turn, g.turn);
  assert.equal(g2.moves.length, 3);
  assert.equal(g2.colorAt(0, 0, 1), G);
  assert.equal(g2.first, 1);
});

test('lineKind names', () => {
  assert.equal(lineKind([1, 0, 0]), 'straight');
  assert.equal(lineKind([1, -1, 0]), 'diagonal');
  assert.equal(lineKind([0, 0, 1]), 'tower');
  assert.equal(lineKind([0, 1, -1]), 'stairs');
  assert.equal(lineKind([1, -1, 1]), 'space');
});
