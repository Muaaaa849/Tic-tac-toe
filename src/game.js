// STRATA — pure game logic (no DOM / three.js).
//
// Board: size × size columns, each column stacks up to `height` pieces.
// Coordinates: x = column (left→right), y = row (far→near from player 1),
// z = level (0 = on the board).
// Colors (0 = red, 1 = green, 2 = blue) are shared by both players.
// Whoever completes 4+ of one color in a straight line (any of the
// 13 directions in 3D, including "staircase" diagonals) wins.

export const COLOR_COUNT = 3;

// 13 unique directions in a 3D grid (one of each ± pair).
export const DIRS = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1],
  [1, 1, 0], [1, -1, 0],
  [1, 0, 1], [1, 0, -1],
  [0, 1, 1], [0, 1, -1],
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
];

/** Human-readable kind of a winning line, given its direction. */
export function lineKind([dx, dy, dz]) {
  const flat = (dx !== 0) + (dy !== 0);
  if (dz === 0) return flat === 1 ? 'straight' : 'diagonal';
  if (flat === 0) return 'tower';
  if (flat === 1) return 'stairs';
  return 'space';
}

export class Game {
  constructor({ size = 5, height = 5, first = 0 } = {}) {
    this.size = size;
    this.height = height;
    this.first = first;
    this.cols = Array.from({ length: size * size }, () => []);
    this.moves = [];
    this.turn = first;
    this.result = null;
  }

  idx(x, y) { return y * this.size + x; }

  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.size && y < this.size; }

  heightAt(x, y) { return this.cols[this.idx(x, y)].length; }

  colorAt(x, y, z) {
    if (!this.inBounds(x, y) || z < 0) return -1;
    const col = this.cols[this.idx(x, y)];
    return z < col.length ? col[z] : -1;
  }

  isColumnFull(x, y) { return this.heightAt(x, y) >= this.height; }

  canPlace(x, y) {
    return !this.result && this.inBounds(x, y) && !this.isColumnFull(x, y);
  }

  get capacity() { return this.size * this.size * this.height; }

  get lastMove() { return this.moves[this.moves.length - 1] || null; }

  place(x, y, color) {
    if (!this.canPlace(x, y)) return null;
    if (!(color >= 0 && color < COLOR_COUNT)) return null;
    const col = this.cols[this.idx(x, y)];
    const z = col.length;
    col.push(color);
    const move = { x, y, z, color, player: this.turn, n: this.moves.length + 1 };
    this.moves.push(move);

    const lines = this.findLines(x, y, z, color);
    if (lines.length) {
      this.result = { type: 'win', player: this.turn, color, lines };
    } else if (this.moves.length >= this.capacity) {
      this.result = { type: 'draw' };
    } else {
      this.turn = 1 - this.turn;
    }
    return move;
  }

  /** All lines of ≥4 same-colored pieces passing through (x, y, z). */
  findLines(x, y, z, color) {
    const lines = [];
    for (const dir of DIRS) {
      const [dx, dy, dz] = dir;
      const cells = [[x, y, z]];
      for (let s = 1; this.colorAt(x + dx * s, y + dy * s, z + dz * s) === color; s++) {
        cells.push([x + dx * s, y + dy * s, z + dz * s]);
      }
      for (let s = 1; this.colorAt(x - dx * s, y - dy * s, z - dz * s) === color; s++) {
        cells.unshift([x - dx * s, y - dy * s, z - dz * s]);
      }
      if (cells.length >= 4) lines.push({ dir, kind: lineKind(dir), cells });
    }
    return lines;
  }

  undo() {
    const move = this.moves.pop();
    if (!move) return null;
    this.cols[this.idx(move.x, move.y)].pop();
    this.result = null;
    this.turn = move.player;
    return move;
  }

  toJSON() {
    return {
      size: this.size,
      height: this.height,
      first: this.first,
      moves: this.moves.map((m) => [m.x, m.y, m.color]),
    };
  }

  static fromJSON(data) {
    const game = new Game(data);
    for (const [x, y, c] of data.moves || []) {
      if (!game.place(x, y, c)) break;
    }
    return game;
  }
}
