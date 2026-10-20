import assert from 'node:assert/strict';
import {
  BLACK,
  WHITE,
  applyMove,
  emptyBoard,
  groupOf,
  normalizeDead,
  samePoints,
  scoring
} from './rules.js';

function fill(board, color, skip) {
  for (let y = 0; y < board.length; y += 1) {
    for (let x = 0; x < board.length; x += 1) {
      if (!skip || !skip(x, y)) board[y][x] = color;
    }
  }
}

const suicide = emptyBoard(3);
fill(suicide, BLACK, (x, y) => x === 1 && y === 1);
assert.equal(applyMove(suicide, 1, 1, BLACK, null).ok, false);
assert.equal(suicide[1][1], 0);

const capture = [
  [BLACK, BLACK, BLACK],
  [BLACK, WHITE, 0],
  [BLACK, BLACK, BLACK]
];
const taken = applyMove(capture, 2, 1, BLACK, null);
assert.equal(taken.ok, true);
assert.equal(taken.captured, 1);
assert.equal(taken.board[1][1], 0);
assert.equal(capture[1][1], WHITE);

const sweep = emptyBoard(3);
fill(sweep, BLACK, (x, y) => x === 1 && y === 1);
const swept = applyMove(sweep, 1, 1, WHITE, null);
assert.equal(swept.ok, true);
assert.equal(swept.captured, 8);

const ko = emptyBoard(4);
ko[0][1] = BLACK;
ko[0][2] = WHITE;
ko[1][0] = BLACK;
ko[1][1] = WHITE;
ko[1][3] = WHITE;
ko[2][1] = BLACK;
ko[2][2] = WHITE;
const koTake = applyMove(ko, 2, 1, BLACK, null);
assert.equal(koTake.ok, true);
assert.equal(koTake.captured, 1);
assert.equal(applyMove(koTake.board, 1, 1, WHITE, koTake.forbiddenHash).ok, false);
assert.equal(applyMove(koTake.board, 1, 1, WHITE, null).captured, 1);

const split = emptyBoard(5);
for (let y = 0; y < 5; y += 1) {
  split[y][0] = BLACK;
  split[y][4] = WHITE;
}
const splitScore = scoring(split, [], 7.5);
assert.equal(splitScore.black, 5);
assert.equal(splitScore.white, 12.5);
assert.equal(splitScore.winner, 'white');

const eye = emptyBoard(5);
for (let x = 1; x <= 3; x += 1) {
  eye[1][x] = BLACK;
  eye[3][x] = BLACK;
}
eye[2][1] = BLACK;
eye[2][3] = BLACK;
eye[2][2] = WHITE;
const alive = scoring(eye, [], 7.5);
const dead = scoring(eye, [{ x: 2, y: 2 }], 7.5);
assert.equal(alive.white, 8.5);
assert.equal(dead.white, 7.5);
assert.equal(dead.black, alive.black + 1);

const pair = emptyBoard(4);
pair[0][0] = BLACK;
pair[0][1] = BLACK;
pair[1][0] = WHITE;
const marks = normalizeDead(pair, [{ x: 1, y: 0 }]);
assert.equal(marks.length, 2);
assert.equal(samePoints(marks, [{ x: 0, y: 0 }, { x: 1, y: 0 }]), true);
assert.equal(groupOf(pair, 3, 3).length, 0);
assert.equal(applyMove(pair, 0, 0, WHITE, null).ok, false);

console.log('rules ok');
