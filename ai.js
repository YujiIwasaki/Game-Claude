/* マルバツ国盗り — コンピューターの思考
 * ネガマックス + αβ枝刈り + 反復深化 + 置換表 */
(function (global) {
  'use strict';

  const G = global.Game;
  const { LINES, LINES_BY_CELL } = G;
  const WIN = 100000;
  const MATE_BOUND = WIN - 100;
  const TIMEOUT = {};
  const CELL_ORDER = [4, 0, 2, 6, 8, 1, 3, 5, 7]; // 中央 → 角 → 辺

  const LEVELS = {
    easy: { randomRate: 0.6, maxDepth: 2, timeMs: 150 },
    normal: { randomRate: 0, maxDepth: 3, timeMs: 400 },
    strong: { randomRate: 0, maxDepth: 12, timeMs: 1500 },
  };

  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  class Searcher {
    constructor(game, timeMs) {
      this.board = game.board.map((s) => s.slice());
      this.hands = game.hands.map((h) => h.slice());
      this.tt = new Map();
      this.nodes = 0;
      this.deadline = now() + timeMs;
    }

    top(cell) {
      const s = this.board[cell];
      return s.length ? s[s.length - 1] : -1;
    }

    topSize(cell) {
      const s = this.board[cell];
      return s.length ? s[s.length - 1] >> 1 : 0;
    }

    topOwner(cell) {
      const s = this.board[cell];
      return s.length ? s[s.length - 1] & 1 : -1;
    }

    key(p) {
      let k = p ? 'x' : 'o';
      for (let i = 0; i < 9; i++) k += this.board[i].join('') + '/';
      return k;
    }

    maxHand(p) {
      const h = this.hands[p];
      return h[3] ? 3 : h[2] ? 2 : h[1] ? 1 : 0;
    }

    // 手は size * 9 + cell の整数で表す
    genMoves(p) {
      const moves = [];
      const h = this.hands[p];
      for (let size = 3; size >= 1; size--) {
        if (!h[size]) continue;
        for (const cell of CELL_ORDER) {
          if (this.topSize(cell) < size) moves.push(size * 9 + cell);
        }
      }
      return moves;
    }

    // cell に p の駒を置いたら 3 つ揃うか
    completesLine(p, cell) {
      for (const line of LINES_BY_CELL[cell]) {
        let ok = true;
        for (const c of line) {
          if (c !== cell && this.topOwner(c) !== p) { ok = false; break; }
        }
        if (ok) return true;
      }
      return false;
    }

    // p が次の手で完成させられる「リーチ」のマス集合
    threatCells(p) {
      const maxSize = this.maxHand(p);
      const cells = new Set();
      if (!maxSize) return cells;
      for (const line of LINES) {
        let own = 0;
        let gap = -1;
        for (const c of line) {
          if (this.topOwner(c) === p) own++;
          else gap = c;
        }
        if (own === 2 && this.topSize(gap) < maxSize) cells.add(gap);
      }
      return cells;
    }

    evaluate(p) {
      const o = 1 - p;
      let score = 0;
      for (const line of LINES) {
        let mine = 0, theirs = 0, mineBig = 0, theirsBig = 0;
        for (const c of line) {
          const t = this.top(c);
          if (t < 0) continue;
          if ((t & 1) === p) { mine++; if ((t >> 1) === 3) mineBig++; }
          else { theirs++; if ((t >> 1) === 3) theirsBig++; }
        }
        if (!theirs) score += (mine === 2 ? 5 : mine) + mineBig;
        if (!mine) score -= (theirs === 2 ? 5 : theirs) + theirsBig;
      }
      // 相手のリーチが 2 か所以上あると、手番側でも防ぎきれないことが多い
      if (this.threatCells(o).size >= 2) score -= 40;
      score += (this.hands[p][3] - this.hands[o][3]) * 2;
      score += (this.hands[p][2] - this.hands[o][2]);
      return score;
    }

    make(p, m) {
      const size = (m / 9) | 0;
      this.board[m % 9].push((size << 1) | p);
      this.hands[p][size]--;
    }

    unmake(p, m) {
      this.board[m % 9].pop();
      this.hands[p][(m / 9) | 0]++;
    }

    negamax(p, depth, alpha, beta, ply) {
      if ((++this.nodes & 1023) === 0 && now() > this.deadline) throw TIMEOUT;

      const moves = this.genMoves(p);
      if (!moves.length) {
        if (!this.genMoves(1 - p).length) return 0; // 両者置けない → 引き分け
        return -this.negamax(1 - p, depth, -beta, -alpha, ply + 1); // パス
      }
      for (const m of moves) {
        if (this.completesLine(p, m % 9)) return WIN - ply;
      }
      if (depth <= 0) return this.evaluate(p);

      const key = this.key(p);
      const entry = this.tt.get(key);
      let ttMove = -1;
      if (entry) {
        ttMove = entry.move;
        if (entry.depth >= depth) {
          const v = fromTT(entry.value, ply);
          if (entry.flag === 0) return v;
          if (entry.flag === 1 && v >= beta) return v;
          if (entry.flag === -1 && v <= alpha) return v;
        }
      }

      this.order(p, moves, ttMove);
      const alphaOrig = alpha;
      let best = -Infinity;
      let bestMove = moves[0];
      for (const m of moves) {
        this.make(p, m);
        const v = -this.negamax(1 - p, depth - 1, -beta, -alpha, ply + 1);
        this.unmake(p, m);
        if (v > best) { best = v; bestMove = m; }
        if (v > alpha) alpha = v;
        if (alpha >= beta) break;
      }
      const flag = best <= alphaOrig ? -1 : best >= beta ? 1 : 0;
      this.tt.set(key, { depth, value: toTT(best, ply), flag, move: bestMove });
      return best;
    }

    // 置換表の手 → 相手のリーチを防ぐ手 → 乗っ取り → その他（安定ソート）
    order(p, moves, ttMove) {
      const block = this.threatCells(1 - p);
      const score = (m) => {
        const cell = m % 9;
        if (m === ttMove) return 1000;
        let s = 0;
        if (block.has(cell)) s += 100;
        if (this.topOwner(cell) === 1 - p) s += 10;
        return s;
      };
      const scored = moves.map((m, i) => [score(m), i, m]);
      scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
      for (let i = 0; i < moves.length; i++) moves[i] = scored[i][2];
    }

    searchRoot(p, maxDepth) {
      const rootMoves = shuffle(this.genMoves(p));
      for (const m of rootMoves) {
        if (this.completesLine(p, m % 9)) return { move: m, score: WIN, depth: 1 };
      }
      let best = { move: rootMoves[0], score: 0, depth: 0 };
      for (let depth = 1; depth <= maxDepth; depth++) {
        try {
          let alpha = -Infinity;
          let bestMove = rootMoves[0];
          for (const m of rootMoves) {
            this.make(p, m);
            const v = -this.negamax(1 - p, depth - 1, -Infinity, -alpha, 1);
            this.unmake(p, m);
            if (v > alpha) { alpha = v; bestMove = m; }
          }
          best = { move: bestMove, score: alpha, depth };
          // 次の反復では最善手から調べる
          rootMoves.splice(rootMoves.indexOf(bestMove), 1);
          rootMoves.unshift(bestMove);
          if (Math.abs(alpha) >= MATE_BOUND) break; // 勝敗が読み切れた
        } catch (e) {
          if (e !== TIMEOUT) throw e;
          // 時間切れ: 途中の結果は捨て、直前に読み終えた深さの結果を使う
          // （内部盤面は崩れているが、この Searcher は以後使わない）
          break;
        }
      }
      return best;
    }
  }

  // 勝ち負けの値を「その局面からの手数」に直して保存する
  function toTT(v, ply) {
    if (v >= MATE_BOUND) return v + ply;
    if (v <= -MATE_BOUND) return v - ply;
    return v;
  }
  function fromTT(v, ply) {
    if (v >= MATE_BOUND) return v - ply;
    if (v <= -MATE_BOUND) return v + ply;
    return v;
  }

  function chooseMove(game, levelName = 'strong') {
    const level = LEVELS[levelName] || LEVELS.strong;
    const p = game.turn;
    const moves = G.legalMoves(game, p);
    if (!moves.length) return null;

    const winning = moves.find((m) => G.findWinLine(G.applyMove(game, m).board, p));
    if (winning) return winning;
    if (Math.random() < level.randomRate) {
      return moves[Math.floor(Math.random() * moves.length)];
    }

    const remaining = game.hands[0].concat(game.hands[1]).reduce((a, b) => a + b, 0);
    const searcher = new Searcher(game, level.timeMs);
    const result = searcher.searchRoot(p, Math.min(level.maxDepth, remaining));
    return { size: (result.move / 9) | 0, cell: result.move % 9, score: result.score, depth: result.depth };
  }

  global.AI = { chooseMove, LEVELS };
})(typeof window !== 'undefined' ? window : globalThis);
