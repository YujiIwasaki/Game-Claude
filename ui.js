/* マルバツ国盗り — 画面描画と対局進行 */
(function () {
  'use strict';

  const G = window.Game;
  const AI = window.AI;
  const { MARKS, SIZE_NAMES, CELL_NAMES, SIZES } = G;
  const LEVEL_NAMES = { easy: 'やさしい', normal: 'ふつう', strong: 'つよい' };
  const SCORE_KEY = 'marubatsu-kunitori-score';
  const CPU_DELAY_MS = 450;

  const $ = (id) => document.getElementById(id);
  const els = {
    setup: $('setup'), game: $('game'), status: $('status'), board: $('board'),
    hands: [$('hand0'), $('hand1')], log: $('log'), score: $('score'),
    start: $('startBtn'), undo: $('undoBtn'), again: $('againBtn'), swap: $('swapBtn'),
    back: $('backBtn'), resetScore: $('resetScoreBtn'), rules: $('rulesBtn'), rulesDialog: $('rulesDialog'),
  };

  let settings = { types: ['human', 'cpu'], levels: ['strong', 'strong'] };
  let history = [];
  let selected = null;     // 選択中の手駒の大きさ
  let thinking = false;
  let matchToken = 0;      // 古い CPU 思考を無効化するための対局 ID
  let scored = false;
  let score = loadScore();

  const state = () => history[history.length - 1];
  const isCpu = (p) => settings.types[p] === 'cpu';
  const playerLabel = (p) => `${MARKS[p]}軍（${isCpu(p) ? `CPU・${LEVEL_NAMES[settings.levels[p]]}` : '人間'}）`;

  // ---------- 戦績 ----------
  function loadScore() {
    try {
      const s = JSON.parse(localStorage.getItem(SCORE_KEY));
      if (s && typeof s.o === 'number') return s;
    } catch (e) { /* 保存できない環境では無視 */ }
    return { o: 0, x: 0, draw: 0 };
  }
  function saveScore() {
    try { localStorage.setItem(SCORE_KEY, JSON.stringify(score)); } catch (e) { /* 無視 */ }
  }

  // ---------- 設定 ----------
  function readSettings() {
    const form = els.setup;
    return {
      types: [0, 1].map((p) => form.querySelector(`input[name="type${p}"]:checked`).value),
      levels: [0, 1].map((p) => form.querySelector(`select[name="level${p}"]`).value),
    };
  }
  function writeSettings(s) {
    [0, 1].forEach((p) => {
      els.setup.querySelector(`input[name="type${p}"][value="${s.types[p]}"]`).checked = true;
      els.setup.querySelector(`select[name="level${p}"]`).value = s.levels[p];
    });
    syncLevelFields();
  }
  function syncLevelFields() {
    [0, 1].forEach((p) => {
      const cpu = els.setup.querySelector(`input[name="type${p}"]:checked`).value === 'cpu';
      const field = els.setup.querySelector(`select[name="level${p}"]`).closest('.level-field');
      field.classList.toggle('is-disabled', !cpu);
      field.querySelector('select').disabled = !cpu;
    });
  }

  // ---------- 対局進行 ----------
  function startMatch() {
    matchToken++;
    history = [G.createGame()];
    selected = null;
    thinking = false;
    scored = false;
    els.setup.hidden = true;
    els.game.hidden = false;
    render();
  }

  function commit(move) {
    history.push(G.applyMove(state(), move));
    selected = null;
    render();
  }

  function undo() {
    if (thinking || G.isOver(state())) return;
    // 一つ前以前で、人間の手番だった局面まで戻る
    let i = history.length - 2;
    while (i >= 0 && isCpu(history[i].turn)) i--;
    if (i < 0) return;
    history = history.slice(0, i + 1);
    selected = null;
    render();
  }

  function scheduleCpu() {
    const token = matchToken;
    const g = state();
    thinking = true;
    // 「考えています…」を描画してから探索する
    setTimeout(() => {
      if (token !== matchToken || state() !== g) return;
      const move = AI.chooseMove(g, settings.levels[g.turn]);
      thinking = false;
      if (token !== matchToken) return;
      commit({ size: move.size, cell: move.cell });
    }, CPU_DELAY_MS);
  }

  // ---------- 描画 ----------
  function render() {
    const g = state();
    const over = G.isOver(g);
    const cpuTurn = !over && isCpu(g.turn);

    if (over && !scored) {
      scored = true;
      if (g.draw) score.draw++; else score[g.winner === 0 ? 'o' : 'x']++;
      saveScore();
    }

    renderStatus(g, cpuTurn);
    renderBoard(g, over || cpuTurn);
    renderHands(g, over, cpuTurn);
    renderLog();
    renderScore();

    const canUndo = !over && !cpuTurn && history.slice(0, -1).some((s) => !isCpu(s.turn));
    els.undo.disabled = !canUndo;
    els.again.classList.toggle('btn-primary', over);
    els.game.classList.toggle('is-over', over);

    if (cpuTurn && !thinking) scheduleCpu();
  }

  function renderStatus(g, cpuTurn) {
    const s = els.status;
    s.className = 'status';
    if (g.winner !== null) {
      s.classList.add('is-result', g.winner === 0 ? 'side-o' : 'side-x');
      s.innerHTML = `<strong>${MARKS[g.winner]}軍の勝ち！</strong> <span>${playerLabel(g.winner)} が三つの陣地を制しました。</span>`;
      return;
    }
    if (g.draw) {
      s.classList.add('is-result');
      s.innerHTML = '<strong>引き分け</strong> <span>両軍とも置ける場所がなくなりました。</span>';
      return;
    }
    s.classList.add(g.turn === 0 ? 'side-o' : 'side-x');
    const pass = g.passed ? `<span class="pass">${MARKS[1 - g.turn]}軍は置ける場所がないためパス。</span> ` : '';
    if (cpuTurn) {
      s.innerHTML = `${pass}<strong>${MARKS[g.turn]}軍</strong>が考えています<span class="dots" aria-hidden="true"></span>`;
    } else {
      const hint = selected ? `${SIZE_NAMES[selected]}の駒を置くマスを選んでください。` : '手駒を選んでください。';
      s.innerHTML = `${pass}<strong>${playerLabel(g.turn)}</strong>の番です。<span class="hint">${hint}</span>`;
    }
  }

  function pieceEl(owner, size, tag = 'span') {
    const el = document.createElement(tag);
    el.className = `piece ${owner === 0 ? 'piece-o' : 'piece-x'} size-${size}`;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  function renderBoard(g, locked) {
    const board = els.board;
    board.textContent = '';
    for (let cell = 0; cell < 9; cell++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cell';
      btn.dataset.cell = cell;
      btn.setAttribute('role', 'gridcell');
      const stack = g.board[cell];
      const legal = !locked && selected && G.canPlace(g, g.turn, selected, cell);

      if (legal) btn.classList.add('is-legal', g.turn === 0 ? 'legal-o' : 'legal-x');
      if (g.lastMove && g.lastMove.cell === cell) {
        btn.classList.add('is-last');
        if (g.lastMove.captured) btn.classList.add('is-captured');
      }
      if (g.winLine && g.winLine.includes(cell)) btn.classList.add('is-win');
      btn.disabled = !legal;

      let label = CELL_NAMES[cell];
      if (stack.length) {
        const top = stack[stack.length - 1];
        const owner = G.ownerOf(top), size = G.sizeOf(top);
        btn.appendChild(pieceEl(owner, size));
        label += `：${MARKS[owner]}の${SIZE_NAMES[size]}`;
        if (stack.length > 1) {
          const depth = document.createElement('span');
          depth.className = 'depth';
          depth.title = `下に ${stack.length - 1} 枚`;
          depth.textContent = '●'.repeat(stack.length - 1);
          btn.appendChild(depth);
          label += `（下に${stack.length - 1}枚）`;
        }
      } else {
        label += '：空き';
      }
      if (legal) {
        const ghost = pieceEl(g.turn, selected);
        ghost.classList.add('ghost');
        btn.appendChild(ghost);
      }
      btn.setAttribute('aria-label', label);
      board.appendChild(btn);
    }
  }

  function renderHands(g, over, cpuTurn) {
    [0, 1].forEach((p) => {
      const hand = els.hands[p];
      const active = !over && g.turn === p;
      hand.className = `hand ${p === 0 ? 'side-o' : 'side-x'}${active ? ' is-active' : ''}`;
      hand.textContent = '';

      const head = document.createElement('div');
      head.className = 'hand-head';
      head.innerHTML = `<span class="mark ${p === 0 ? 'mark-o' : 'mark-x'}" aria-hidden="true"></span>
        <span class="hand-name">${MARKS[p]}軍 <small>${p === 0 ? '先攻' : '後攻'}</small></span>
        <span class="hand-who">${isCpu(p) ? `CPU・${LEVEL_NAMES[settings.levels[p]]}` : '人間'}</span>`;
      hand.appendChild(head);

      const list = document.createElement('div');
      list.className = 'hand-pieces';
      for (const size of [...SIZES].reverse()) {
        const count = g.hands[p][size];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hand-piece';
        btn.dataset.size = size;
        const selectable = active && !cpuTurn && count > 0 && G.legalMoves(g, p).some((m) => m.size === size);
        btn.disabled = !selectable;
        if (active && selected === size) btn.classList.add('is-selected');
        btn.setAttribute('aria-pressed', String(active && selected === size));
        btn.setAttribute('aria-label', `${SIZE_NAMES[size]}の駒 残り${count}個`);

        const slot = document.createElement('span');
        slot.className = 'hand-slot';
        slot.appendChild(pieceEl(p, size));
        btn.appendChild(slot);
        const text = document.createElement('span');
        text.className = 'hand-text';
        text.innerHTML = `<b>${SIZE_NAMES[size]}</b><span class="count">×${count}</span>`;
        btn.appendChild(text);
        if (!count) btn.classList.add('is-empty');
        list.appendChild(btn);
      }
      hand.appendChild(list);
    });
  }

  function renderLog() {
    els.log.textContent = '';
    history.slice(1).forEach((g, i) => {
      const m = g.lastMove;
      const li = document.createElement('li');
      li.className = m.player === 0 ? 'side-o' : 'side-x';
      let text = `${MARKS[m.player]} ${SIZE_NAMES[m.size]} → ${CELL_NAMES[m.cell]}`;
      if (m.captured) text += `（${MARKS[m.captured.owner]}${SIZE_NAMES[m.captured.size]}を乗っ取り）`;
      if (g.winner !== null) text += ' ── 勝利';
      li.textContent = text;
      if (g.passed) {
        const pass = document.createElement('span');
        pass.className = 'log-pass';
        pass.textContent = ` ${MARKS[1 - g.turn]}パス`;
        li.appendChild(pass);
      }
      li.value = i + 1;
      els.log.appendChild(li);
    });
    els.log.scrollTop = els.log.scrollHeight;
  }

  function renderScore() {
    els.score.innerHTML = `
      <div class="side-o"><dt>〇軍の勝ち</dt><dd>${score.o}</dd></div>
      <div class="side-x"><dt>×軍の勝ち</dt><dd>${score.x}</dd></div>
      <div><dt>引き分け</dt><dd>${score.draw}</dd></div>`;
  }

  // ---------- 入力 ----------
  function selectSize(size) {
    const g = state();
    if (G.isOver(g) || isCpu(g.turn) || !G.legalMoves(g, g.turn).some((m) => m.size === size)) return;
    selected = selected === size ? null : size;
    render();
  }

  els.hands.forEach((hand) => {
    hand.addEventListener('click', (e) => {
      const btn = e.target.closest('.hand-piece');
      if (btn && !btn.disabled) selectSize(Number(btn.dataset.size));
    });
  });

  els.board.addEventListener('click', (e) => {
    const btn = e.target.closest('.cell');
    if (!btn || btn.disabled || !selected) return;
    const g = state();
    const cell = Number(btn.dataset.cell);
    if (!G.isOver(g) && !isCpu(g.turn) && G.canPlace(g, g.turn, selected, cell)) {
      commit({ size: selected, cell });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (els.game.hidden || els.rulesDialog.open || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '1' || e.key === '2' || e.key === '3') selectSize(Number(e.key));
    else if (e.key === 'Escape' && selected) { selected = null; render(); }
  });

  els.setup.addEventListener('change', syncLevelFields);
  els.start.addEventListener('click', () => { settings = readSettings(); startMatch(); });
  els.undo.addEventListener('click', undo);
  els.again.addEventListener('click', startMatch);
  els.swap.addEventListener('click', () => {
    settings = { types: settings.types.slice().reverse(), levels: settings.levels.slice().reverse() };
    writeSettings(settings);
    startMatch();
  });
  els.back.addEventListener('click', () => {
    matchToken++;
    thinking = false;
    writeSettings(settings);
    els.game.hidden = true;
    els.setup.hidden = false;
  });
  els.resetScore.addEventListener('click', () => {
    score = { o: 0, x: 0, draw: 0 };
    saveScore();
    renderScore();
  });
  els.rules.addEventListener('click', () => els.rulesDialog.showModal());

  writeSettings(settings);
})();
