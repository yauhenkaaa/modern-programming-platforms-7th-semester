// Правила Го: захват, ко, запрет самозахвата и китайский подсчёт площади.
export const BLACK = 1;
export const WHITE = 2;
export const KOMI = 7.5;

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function opposite(color) {
  return color === BLACK ? WHITE : BLACK;
}

export function emptyBoard(size) {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

function inside(size, x, y) {
  return x >= 0 && y >= 0 && x < size && y < size;
}

function clone(board) {
  return board.map((row) => row.slice());
}

export function boardHash(board) {
  let hash = '';
  for (const row of board) {
    for (const cell of row) hash += cell;
  }
  return hash;
}

function collectGroup(board, x, y) {
  const color = board[y][x];
  const size = board.length;
  const stones = [];
  const liberties = new Set();
  const stack = [[x, y]];
  const seen = new Set([`${x},${y}`]);
  while (stack.length) {
    const [cx, cy] = stack.pop();
    stones.push({ x: cx, y: cy });
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inside(size, nx, ny)) continue;
      const value = board[ny][nx];
      if (value === 0) liberties.add(`${nx},${ny}`);
      else if (value === color && !seen.has(`${nx},${ny}`)) {
        seen.add(`${nx},${ny}`);
        stack.push([nx, ny]);
      }
    }
  }
  return { stones, liberties };
}

export function groupOf(board, x, y) {
  if (!inside(board.length, x, y) || board[y][x] === 0) return [];
  return collectGroup(board, x, y).stones;
}

export function applyMove(board, x, y, color, forbiddenHash) {
  const size = board.length;
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inside(size, x, y)) {
    return { ok: false, error: 'Ход вне поля' };
  }
  if (color !== BLACK && color !== WHITE) return { ok: false, error: 'Некорректный цвет' };
  if (board[y][x] !== 0) return { ok: false, error: 'Пункт занят' };

  const next = clone(board);
  next[y][x] = color;
  let captured = 0;
  const removed = new Set();
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inside(size, nx, ny) || next[ny][nx] !== opposite(color) || removed.has(`${nx},${ny}`)) continue;
    const group = collectGroup(next, nx, ny);
    if (group.liberties.size > 0) continue;
    for (const stone of group.stones) {
      next[stone.y][stone.x] = 0;
      removed.add(`${stone.x},${stone.y}`);
      captured += 1;
    }
  }

  if (collectGroup(next, x, y).liberties.size === 0) {
    return { ok: false, error: 'Самоубийственный ход запрещён' };
  }
  if (forbiddenHash && boardHash(next) === forbiddenHash) {
    return { ok: false, error: 'Ко: повторять позицию сразу нельзя' };
  }
  return { ok: true, board: next, forbiddenHash: boardHash(board), captured };
}

function pointKey(point) {
  return `${point.x},${point.y}`;
}

export function normalizeDead(board, points) {
  if (!Array.isArray(points) || !Array.isArray(board)) return [];
  const seen = new Set();
  const result = [];
  for (const point of points) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!inside(board.length, x, y) || board[y][x] === 0) continue;
    for (const stone of collectGroup(board, x, y).stones) {
      const key = pointKey(stone);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(stone);
    }
  }
  return result;
}

export function samePoints(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const keys = new Set(a.map(pointKey));
  return b.every((point) => keys.has(pointKey(point)));
}

export function scoring(board, deadPoints, komi) {
  const size = board.length;
  const field = clone(board);
  for (const point of deadPoints || []) {
    if (inside(size, point.x, point.y)) field[point.y][point.x] = 0;
  }

  let black = 0;
  let white = 0;
  for (const row of field) {
    for (const cell of row) {
      if (cell === BLACK) black += 1;
      else if (cell === WHITE) white += 1;
    }
  }

  const seen = Array.from({ length: size }, () => Array(size).fill(false));
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (field[y][x] !== 0 || seen[y][x]) continue;
      const stack = [[x, y]];
      seen[y][x] = true;
      let area = 0;
      let touchBlack = false;
      let touchWhite = false;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        area += 1;
        for (const [dx, dy] of DIRS) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (!inside(size, nx, ny)) continue;
          const value = field[ny][nx];
          if (value === BLACK) touchBlack = true;
          else if (value === WHITE) touchWhite = true;
          else if (!seen[ny][nx]) {
            seen[ny][nx] = true;
            stack.push([nx, ny]);
          }
        }
      }
      if (touchBlack && !touchWhite) black += area;
      else if (touchWhite && !touchBlack) white += area;
    }
  }

  white += Number(komi) || 0;
  return { black, white, winner: black > white ? 'black' : 'white' };
}
