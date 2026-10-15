/* マルバツ国盗り — ルールエンジン（UI 非依存） */
(function (global) {
  'use strict';

  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  // 各マスを通る列（勝利判定の高速化用）
  const LINES_BY_CELL = Array.from({ length: 9 }, (_, i) => LINES.filter((l) => l.includes(i)));
  const PIECES_PER_SIZE = 2;
  const SIZES = [1, 2, 3]; // 小・中・大
  const SIZE_NAMES = ['', '小', '中', '大'];
  const MARKS = ['〇', '×'];
  const CELL_NAMES = ['左上', '上', '右上', '左', '中央', '右', '左下', '下', '右下'];

  const pieceCode = (owner, size) => (size << 1) | owner;
  const ownerOf = (code) => code & 1;
  const sizeOf = (code) => code >> 1;

  function topSize(board, cell) {
    const s = board[cell];
    return s.length ? sizeOf(s[s.length - 1]) : 0;
  }

  function topOwner(board, cell) {
    const s = board[cell];
    return s.length ? ownerOf(s[s.length - 1]) : -1;
  }

  function createGame() {
    return {
      board: Array.from({ length: 9 }, () => []),
      hands: [[0, PIECES_PER_SIZE, PIECES_PER_SIZE, PIECES_PER_SIZE], [0, PIECES_PER_SIZE, PIECES_PER_SIZE, PIECES_PER_SIZE]],
      turn: 0,
      winner: null,
      winLine: null,
      draw: false,
      passed: false,
      lastMove: null,
      moveNo: 0,
    };
  }

  function cloneGame(g) {
    return {
      ...g,
      board: g.board.map((s) => s.slice()),
      hands: g.hands.map((h) => h.slice()),
      winLine: g.winLine && g.winLine.slice(),
      lastMove: g.lastMove && { ...g.lastMove },
    };
  }

  function isOver(g) {
    return g.winner !== null || g.draw;
  }

  function canPlace(g, player, size, cell) {
    return g.hands[player][size] > 0 && topSize(g.board, cell) < size;
  }

  function legalMoves(g, player) {
    const moves = [];
    for (const size of SIZES) {
      if (g.hands[player][size] <= 0) continue;
      for (let cell = 0; cell < 9; cell++) {
        if (topSize(g.board, cell) < size) moves.push({ size, cell });
      }
    }
    return moves;
  }

  function findWinLine(board, player) {
    for (const line of LINES) {
      if (line.every((c) => topOwner(board, c) === player)) return line.slice();
    }
    return null;
  }

  function applyMove(g, move) {
    const p = g.turn;
    if (isOver(g) || !canPlace(g, p, move.size, move.cell)) {
      throw new Error('Illegal move');
    }
    const n = cloneGame(g);
    const prev = topOwner(g.board, move.cell);
    n.board[move.cell].push(pieceCode(p, move.size));
    n.hands[p][move.size]--;
    n.moveNo = g.moveNo + 1;
    n.lastMove = {
      player: p,
      size: move.size,
      cell: move.cell,
      captured: prev === -1 ? null : { owner: prev, size: topSize(g.board, move.cell) },
    };
    n.passed = false;

    // 置いたマスの駒は必ず手番側のものになるので、勝てるのは手番側だけ
    const line = findWinLine(n.board, p);
    if (line) {
      n.winner = p;
      n.winLine = line;
      return n;
    }

    const next = 1 - p;
    if (legalMoves(n, next).length) {
      n.turn = next;
    } else if (legalMoves(n, p).length) {
      n.turn = p; // 相手は置けないのでパス
      n.passed = true;
    } else {
      n.draw = true;
    }
    return n;
  }

  global.Game = {
    LINES, LINES_BY_CELL, SIZES, SIZE_NAMES, MARKS, CELL_NAMES, PIECES_PER_SIZE,
    pieceCode, ownerOf, sizeOf, topSize, topOwner,
    createGame, cloneGame, isOver, canPlace, legalMoves, findWinLine, applyMove,
  };
})(typeof window !== 'undefined' ? window : globalThis);
