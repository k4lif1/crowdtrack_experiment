/*
 * Four in a Row Coach: the interface.
 * Needs engine.js (window.C4) and strategy.js (window.C4_STRATEGY).
 */
(function () {
  'use strict';

  var C4 = window.C4;
  var CUR = window.C4_STRATEGY;
  var FILES = 'abcdefg';
  var SVGNS = 'http://www.w3.org/2000/svg';
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ------------------------------------------------------------ helpers */

  function el(tag, attrs) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(n, arguments[i]);
    return n;
  }
  function append(n, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(n, k); }); return; }
    n.appendChild(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  function sv(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

  var store = {
    get: function (k, d) {
      try { var v = window.localStorage.getItem('c4coach.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) {
      try { window.localStorage.setItem('c4coach.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ }
    }
  };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]; });
  }

  // **bold**, {d3} square chips, [P1]/[P2] player chips (capitalised at a sentence start).
  function rich(text) {
    var s = esc(text);
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\{([a-g][1-6])\}/g, '<span class="sq" tabindex="0" data-sq="$1">$1</span>');
    s = s.replace(/\[P([12])\]/g, function (m, p, offset, whole) {
      var before = whole.slice(0, offset).replace(/<[^>]+>/g, '').replace(/\s+$/, '');
      var cap = before === '' || /[.!?:]$/.test(before);
      var name = (p === '1' ? 'first' : 'second') + ' player';
      if (cap) name = name.charAt(0).toUpperCase() + name.slice(1);
      return '<span class="who who-' + p + '">' + name + '</span>';
    });
    return s;
  }
  function p(text, cls) { return el('p', { class: cls || null, html: rich(text) }); }

  function sqName(c, r) { return FILES[c] + (r + 1); }
  function role(player) { return player === 1 ? 'first player' : 'second player'; }
  function Role(player) { return player === 1 ? 'First player' : 'Second player'; }
  function boardFrom(pos) {
    return pos && pos.indexOf('/') >= 0 ? C4.Board.fromGrid(pos.split('/')) : C4.Board.fromMoves(pos || '');
  }
  function wait(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function immediateWins(b, player) {
    var out = [];
    for (var c = 0; c < 7; c++) if (b.canPlay(c) && b.completes(c, b.h[c], player)) out.push(c);
    return out;
  }
  function listSquares(sqs) {
    if (sqs.length <= 1) return sqs.join('');
    return sqs.slice(0, -1).join(', ') + ' and ' + sqs[sqs.length - 1];
  }
  function chips(sqs) { return listSquares(sqs.map(function (s) { return '{' + s + '}'; })); }

  /* ------------------------------------------------------ engine client */

  // Search runs in a worker built from the engine's own source so the page
  // never freezes; if workers are unavailable it falls back to the page.
  function workerMain() {
    var searcher = new C4.Searcher(20);
    self.onmessage = function (e) {
      var d = e.data;
      try {
        var b = C4.Board.fromGrid(d.grid);
        var r;
        if (d.cmd === 'analyze') r = searcher.analyze(b, d.opts);
        else if (d.cmd === 'best') r = searcher.bestMove(b, d.opts);
        else r = searcher.solve(b, d.opts);
        self.postMessage({ id: d.id, result: r });
      } catch (err) {
        self.postMessage({ id: d.id, error: String((err && err.message) || err) });
      }
    };
  }

  function Engine() {
    this.seq = 0;
    this.pending = {};
    this.local = null;
    this.start();
  }
  Engine.prototype.start = function () {
    var self = this;
    this.worker = null;
    try {
      if (!this.url) {
        var src = 'var C4 = (' + C4.factory.toString() + ')();\n(' + workerMain.toString() + ')();';
        this.url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      }
      var w = new Worker(this.url);
      w.onmessage = function (e) {
        var job = self.pending[e.data.id];
        if (!job) return;
        delete self.pending[e.data.id];
        if (e.data.error) job.reject(new Error(e.data.error));
        else job.resolve(e.data.result);
      };
      w.onerror = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        self.worker = null;
        var jobs = self.pending;
        self.pending = {};
        Object.keys(jobs).forEach(function (id) {
          var j = jobs[id];
          self.runLocal(j.cmd, j.grid, j.opts).then(j.resolve, j.reject);
        });
      };
      this.worker = w;
    } catch (err) {
      this.worker = null;
    }
  };
  Engine.prototype.runLocal = function (cmd, grid, opts) {
    var self = this;
    return wait(16).then(function () {
      if (!self.local) self.local = new C4.Searcher(18);
      var b = C4.Board.fromGrid(grid);
      var o = Object.assign({}, opts);
      if (o.timeMs) o.timeMs = Math.min(o.timeMs, 500);
      if (cmd === 'analyze') return self.local.analyze(b, o);
      if (cmd === 'best') return self.local.bestMove(b, o);
      return self.local.solve(b, o);
    });
  };
  Engine.prototype.call = function (cmd, board, opts) {
    var grid = board.toGrid();
    if (!this.worker) return this.runLocal(cmd, grid, opts || {});
    var id = ++this.seq, self = this;
    return new Promise(function (resolve, reject) {
      self.pending[id] = { resolve: resolve, reject: reject, cmd: cmd, grid: grid, opts: opts || {} };
      self.worker.postMessage({ id: id, cmd: cmd, grid: grid, opts: opts || {} });
    });
  };
  // Drop everything in flight (new game, undo, leaving a view).
  Engine.prototype.cancel = function () {
    var jobs = this.pending;
    if (!Object.keys(jobs).length) return;
    this.pending = {};
    if (this.worker) { this.worker.terminate(); this.start(); }
    Object.keys(jobs).forEach(function (id) { jobs[id].reject(new Error('cancelled')); });
  };
  var engine = new Engine();
  function ignoreCancel(err) { if (!err || err.message !== 'cancelled') console.error(err); }

  /* ------------------------------------------------------------- coach */

  var Coach = {};

  // Threats that still count: a threat sitting above a good enemy threat in
  // the same column will never be reached in time.
  Coach.effective = function (b) {
    var t = C4.threats(b);
    return t.filter(function (x) {
      return !t.some(function (y) { return y.c === x.c && y.player !== x.player && y.r < x.r && y.good; });
    });
  };

  // Rule-of-thumb reading of the threat picture, with the solver-checked
  // percentages from the showdown lesson.
  Coach.reading = function (b) {
    var eff = Coach.effective(b);
    function pick(player, good) { return eff.filter(function (x) { return x.player === player && x.good === good; }); }
    function stacked(player) {
      for (var i = 0; i < eff.length; i++) {
        var x = eff[i];
        if (x.player !== player) continue;
        for (var j = 0; j < eff.length; j++) {
          var y = eff[j];
          if (y.player === player && y.c === x.c && y.r === x.r + 1) return [x.sq, y.sq];
        }
      }
      return null;
    }
    var odd1 = pick(1, true), even2 = pick(2, true), odd2 = pick(2, false);
    var s1 = stacked(1), s2 = stacked(2);
    var sqs = function (l) { return chips(l.map(function (x) { return x.sq; })); };
    if (s1 && !s2) return { lean: 1, text: 'The [P1] has stacked threats on ' + chips(s1) + '. Those win outright once the column gets there.' };
    if (s2 && !s1) return { lean: 2, text: 'The [P2] has stacked threats on ' + chips(s2) + '. Those win outright once the column gets there.' };
    if (odd1.length && !even2.length && !odd2.length) {
      return { lean: 1, text: 'The [P1] owns an odd threat on ' + sqs(odd1) + ' and the [P2] has nothing to answer it. In solved positions like this the first player wins 93% of the time.' };
    }
    if (odd1.length && even2.length) {
      return { lean: 1, text: 'Odd threat on ' + sqs(odd1) + ' against even threat on ' + sqs(even2) + '. The odd threat usually wins (90% in solved positions).' };
    }
    if (odd1.length && odd2.length) {
      return { lean: 1, text: 'The [P1]’s odd threat on ' + sqs(odd1) + ' faces only odd threats from the [P2]. Still good for the first player (79% in solved positions).' };
    }
    if (even2.length) {
      return { lean: 2, text: 'The [P2] owns an even threat on ' + sqs(even2) + ' and the [P1] has no odd threat. Follow-up should cash it in (86% in solved positions).' };
    }
    return { lean: 0, text: 'No good threats yet. The [P1] wants a threat on an odd row, the [P2] one on an even row.' };
  };

  // Plain-language notes about dropping in column c, for the side to move.
  Coach.notes = function (b, c) {
    var me = b.toMove(), opp = 3 - me, r = b.h[c], sq = sqName(c, r);
    var notes = [];
    if (b.completes(c, r, me)) return [{ tone: 'good', text: '{' + sq + '} completes four.' }];
    var myWins = immediateWins(b, me), oppWins = immediateWins(b, opp);
    if (myWins.length) notes.push({ tone: 'bad', text: 'You had a win on ' + chips(myWins.map(function (x) { return sqName(x, b.h[x]); })) + '. Check your own four first.' });
    if (oppWins.length > 1) notes.push({ tone: 'bad', text: 'Your opponent already had two threats you could not both block.' });
    else if (oppWins.length && oppWins[0] !== c) notes.push({ tone: 'bad', text: 'Your opponent threatened {' + sqName(oppWins[0], b.h[oppWins[0]]) + '}, and it had to be blocked.' });
    else if (oppWins.length) notes.push({ tone: 'good', text: 'Blocked {' + sq + '}.' });

    if (r + 1 < 6) {
      var above = sqName(c, r + 1);
      if (b.completes(c, r + 1, opp)) notes.push({ tone: 'bad', text: '{' + sq + '} is poison: it sits under your opponent’s threat on {' + above + '}.' });
      else if (b.completes(c, r + 1, me) && oppWins.indexOf(c) < 0) notes.push({ tone: 'warn', text: 'You filled the square under your own threat on {' + above + '}, so your opponent can block it now.' });
    }

    var a = b.clone();
    a.play(c);
    var before = {};
    C4.threats(b).forEach(function (t) { if (t.player === me) before[t.sq] = true; });
    var after = C4.threats(a).filter(function (t) { return t.player === me; });
    var fresh = after.filter(function (t) { return !before[t.sq]; });
    var nextWins = immediateWins(a, me);
    var stackedPair = null;
    after.forEach(function (t) {
      after.forEach(function (u) {
        if (!stackedPair && u.c === t.c && u.r === t.r + 1 && (fresh.indexOf(t) >= 0 || fresh.indexOf(u) >= 0)) stackedPair = [t.sq, u.sq];
      });
    });
    if (nextWins.length >= 2) {
      notes.push({ tone: 'good', text: 'Double threat on ' + chips(nextWins.map(function (x) { return sqName(x, a.h[x]); })) + '. Only one can be blocked.' });
    } else if (stackedPair) {
      notes.push({ tone: 'good', text: 'Stacked threats on ' + chips(stackedPair) + ', one on top of the other.' });
    } else if (nextWins.length === 1 && oppWins.length === 0) {
      notes.push({ tone: 'info', text: 'Threatens {' + sqName(nextWins[0], a.h[nextWins[0]]) + '} right away, so your opponent has to answer it.' });
    }
    var good = fresh.filter(function (t) { return t.good && !t.playable; });
    var off = fresh.filter(function (t) { return !t.good && !t.playable; });
    if (good.length) {
      notes.push({ tone: 'good', text: 'New ' + (me === 1 ? 'odd' : 'even') + ' threat on ' + chips(good.map(function (t) { return t.sq; })) + ', the kind the ' + role(me) + ' wants.' });
    } else if (off.length) {
      notes.push({ tone: 'info', text: 'New threat on ' + chips(off.map(function (t) { return t.sq; })) + ', but on ' + (me === 1 ? 'an even' : 'an odd') + ' row. That is the wrong parity for the ' + role(me) + '.' });
    }
    if (me === 2 && b.n > b.base && b.hist[b.n - 1] === c && !notes.some(function (n) { return n.tone === 'bad'; })) {
      var even = true;
      for (var k = 0; k < 7; k++) if ((6 - a.h[k]) % 2) even = false;
      notes.push({ tone: 'good', text: even ? 'Follow-up: you answered on top, and every column now has an even number of empty squares.' : 'Follow-up: you answered on top of your opponent’s disc.' });
    }
    if (b.n < 6 && (c <= 1 || c >= 5) && !notes.length) {
      notes.push({ tone: 'warn', kind: 'edge', text: 'An early edge move. The centre columns take part in far more lines.' });
    }
    return notes;
  };

  function scoreClass(v) { return v >= C4.MATE_MIN ? 'win' : v <= -C4.MATE_MIN ? 'loss' : 'open'; }

  // Grade a move against the coach's analysis of the position before it.
  Coach.grade = function (b, analysis, c) {
    var v = analysis.scores[c], best = analysis.bestScore, bc = analysis.best;
    var bestSq = '{' + sqName(bc, b.h[bc]) + '}';
    var cv = scoreClass(v), cb = scoreClass(best);
    var n = b.n;
    if (cv === 'win') {
      if (cb === 'win' && C4.mateIn(best, n) < C4.mateIn(v, n)) return { grade: 'good', label: 'Wins', text: 'Still a forced win, though ' + bestSq + ' was faster.' };
      var k = C4.mateIn(v, n);
      return { grade: 'best', label: 'Winning', text: k <= 1 ? 'Four in a row.' : 'Forced win in ' + k + ' moves.' };
    }
    if (cb === 'win') return { grade: 'blunder', label: 'Missed win', text: bestSq + ' was a forced win in ' + C4.mateIn(best, n) + '.' };
    if (cv === 'loss') {
      if (cb !== 'loss') return { grade: 'blunder', label: 'Blunder', text: 'This loses by force. ' + bestSq + ' held.' };
      return { grade: 'neutral', label: 'Lost anyway', text: 'Every move loses here. The coach saw no defence.' };
    }
    var diff = best - v;
    if (c === bc || diff <= 6) return { grade: 'best', label: 'Best', text: 'The coach’s choice too.' };
    if (diff <= 30) return { grade: 'good', label: 'Good', text: 'Close to the coach’s choice, ' + bestSq + '.' };
    if (diff <= 90) return { grade: 'inaccuracy', label: 'Inaccuracy', text: 'The coach preferred ' + bestSq + '.' };
    return { grade: 'mistake', label: 'Mistake', text: 'The coach preferred ' + bestSq + ' by a wide margin.' };
  };

  // Balance for the first player, from an analysis of a position.
  Coach.balance = function (b, analysis) {
    var v = analysis.bestScore;
    var mover = b.toMove();
    var forFirst = mover === 1 ? v : -v;
    var cls = scoreClass(forFirst);
    if (cls === 'win') return { pct: 100, text: 'The first player has a forced win (' + C4.mateIn(Math.abs(v), b.n) + ' moves).' };
    if (cls === 'loss') return { pct: 0, text: 'The second player has a forced win (' + C4.mateIn(Math.abs(v), b.n) + ' moves).' };
    var pct = 50 + Math.max(-45, Math.min(45, forFirst / 4));
    var text = Math.abs(forFirst) < 20 ? 'Roughly level.' : forFirst > 0 ? (forFirst > 120 ? 'The first player is clearly better.' : 'The first player is a little better.') : (forFirst < -120 ? 'The second player is clearly better.' : 'The second player is a little better.');
    return { pct: pct, text: text };
  };

  /* --------------------------------------------------------- board view */

  var boardSeq = 0;
  var GEO = {
    full: { CELL: 80, PAD: 14, L: 44, T: 64, B: 40, R: 14 },
    compact: { CELL: 80, PAD: 14, L: 10, T: 10, B: 14, R: 10 }
  };

  function BoardView(opts) {
    this.opts = Object.assign({ compact: false, label: 'Board', onMove: null }, opts || {});
    this.g = this.opts.compact ? GEO.compact : GEO.full;
    this.id = 'bv' + (++boardSeq);
    this.board = new C4.Board();
    this.overlay = {};
    this.marks = [];
    this.interactive = false;
    this.hover = -1;
    this.cursor = 3;
    this.hintCol = -1;
    this.focusSq = null;
    this.discs = {};
    this.animateKey = null;
    this.build();
  }

  BoardView.prototype.cx = function (c) { var g = this.g; return g.L + g.PAD + c * g.CELL + g.CELL / 2; };
  BoardView.prototype.cy = function (r) { var g = this.g; return g.T + g.PAD + (5 - r) * g.CELL + g.CELL / 2; };

  BoardView.prototype.build = function () {
    var g = this.g, self = this;
    var bw = 7 * g.CELL + 2 * g.PAD, bh = 6 * g.CELL + 2 * g.PAD;
    var W = g.L + bw + g.R, H = g.T + bh + g.B;
    this.W = W; this.H = H;
    var svg = sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'board-svg', role: 'img', 'aria-label': this.opts.label });
    var defs = sv('defs');
    var mask = sv('mask', { id: this.id + '-holes' });
    mask.appendChild(sv('rect', { x: g.L, y: g.T, width: bw, height: bh, fill: '#fff' }));
    for (var c = 0; c < 7; c++) for (var r = 0; r < 6; r++) mask.appendChild(sv('circle', { cx: this.cx(c), cy: this.cy(r), r: 34, fill: '#000' }));
    defs.appendChild(mask);
    var clip = sv('clipPath', { id: this.id + '-clip' });
    clip.appendChild(sv('rect', { x: g.L, y: 0, width: bw, height: g.T + bh }));
    defs.appendChild(clip);
    svg.appendChild(defs);

    svg.appendChild(sv('rect', { x: g.L + 6, y: g.T + 6, width: bw - 12, height: bh - 12, class: 'b-back' }));
    this.gHl = sv('g');
    this.colHl = [];
    for (var hc = 0; hc < 7; hc++) {
      var hl = sv('rect', { x: g.L + g.PAD + hc * g.CELL + 3, y: g.T + g.PAD - 4, width: g.CELL - 6, height: 6 * g.CELL + 8, rx: 16, class: 'col-hl' });
      this.colHl.push(hl);
      this.gHl.appendChild(hl);
    }
    svg.appendChild(this.gHl);
    this.gFill = sv('g');
    svg.appendChild(this.gFill);
    this.gDiscs = sv('g', { 'clip-path': 'url(#' + this.id + '-clip)' });
    svg.appendChild(this.gDiscs);
    svg.appendChild(sv('rect', { x: g.L, y: g.T, width: bw, height: bh, rx: 20, class: 'b-plate', mask: 'url(#' + this.id + '-holes)' }));
    svg.appendChild(sv('rect', { x: g.L + 1.5, y: g.T + 1.5, width: bw - 3, height: bh - 3, rx: 19, class: 'b-plate-edge' }));
    var rims = sv('g');
    for (c = 0; c < 7; c++) for (r = 0; r < 6; r++) rims.appendChild(sv('circle', { cx: this.cx(c), cy: this.cy(r), r: 34, class: 'b-rim' }));
    svg.appendChild(rims);
    this.gMarks = sv('g');
    svg.appendChild(this.gMarks);
    this.gWin = sv('g');
    svg.appendChild(this.gWin);

    if (!this.opts.compact) {
      var labels = sv('g');
      for (r = 0; r < 6; r++) {
        var odd = r % 2 === 0;
        labels.appendChild(sv('rect', { x: g.L - 9, y: this.cy(r) - 18, width: 5, height: 36, rx: 2.5, class: 'tick ' + (odd ? 'odd' : 'even') }));
        var t = sv('text', { x: g.L - 25, y: this.cy(r) + 7, class: 'b-label row' });
        t.textContent = String(r + 1);
        labels.appendChild(t);
      }
      for (c = 0; c < 7; c++) {
        var ct = sv('text', { x: this.cx(c), y: g.T + bh + 29, class: 'b-label col' });
        ct.textContent = FILES[c];
        labels.appendChild(ct);
      }
      svg.appendChild(labels);
      this.cursorDisc = this.makeDisc(1);
      this.cursorDisc.setAttribute('class', 'cursor-disc');
      this.cursorDisc.style.opacity = '0';
      svg.appendChild(this.cursorDisc);
    }

    this.gHit = sv('g', { class: 'b-hit' });
    for (c = 0; c < 7; c++) {
      (function (col) {
        var hit = sv('rect', { x: g.L + g.PAD + col * g.CELL, y: 0, width: g.CELL, height: H, fill: 'transparent' });
        hit.addEventListener('pointerenter', function () { self.setHover(col); });
        hit.addEventListener('pointerdown', function (e) { if (e.pointerType !== 'mouse') self.setHover(col); });
        hit.addEventListener('click', function () { self.tryMove(col); });
        self.gHit.appendChild(hit);
      })(c);
    }
    svg.appendChild(this.gHit);
    svg.addEventListener('pointerleave', function () { self.setHover(-1); });
    svg.addEventListener('keydown', function (e) { self.onKey(e); });
    svg.addEventListener('focus', function () { if (self.interactive) self.setHover(self.cursor); });
    svg.addEventListener('blur', function () { self.setHover(-1); });
    this.svg = svg;
  };

  BoardView.prototype.makeDisc = function (player, ghost) {
    var outer = sv('g');
    var inner = sv('g');
    if (ghost) {
      inner.appendChild(sv('circle', { r: 31, class: 'disc-ghost p' + player }));
    } else {
      inner.appendChild(sv('circle', { r: 31, class: 'disc-body p' + player }));
      inner.appendChild(sv('circle', { r: 21, class: 'disc-ring p' + player }));
    }
    outer.appendChild(inner);
    outer.inner = inner;
    return outer;
  };

  BoardView.prototype.onKey = function (e) {
    if (!this.interactive) return;
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      var d = k === 'ArrowLeft' ? -1 : 1;
      this.cursor = (this.cursor + d + 7) % 7;
      this.setHover(this.cursor);
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      this.tryMove(this.hover >= 0 ? this.hover : this.cursor);
    } else if (/^[1-7]$/.test(k)) {
      e.preventDefault();
      this.tryMove(+k - 1);
    } else if (/^[a-g]$/.test(k)) {
      e.preventDefault();
      this.tryMove(FILES.indexOf(k));
    }
  };

  BoardView.prototype.tryMove = function (c) {
    if (!this.interactive || !this.board.canPlay(c) || this.board.winner()) return;
    if (this.opts.onMove) this.opts.onMove(c);
  };

  BoardView.prototype.setHover = function (c) {
    if (!this.interactive) c = -1;
    this.hover = c;
    if (c >= 0) this.cursor = c;
    for (var i = 0; i < 7; i++) this.colHl[i].classList.toggle('on', i === c || (c < 0 && i === this.hintCol));
    this.drawLanding();
    if (this.cursorDisc) {
      if (c >= 0 && this.board.canPlay(c)) {
        var player = this.board.toMove();
        this.cursorDisc.inner.firstChild.setAttribute('class', 'disc-body p' + player);
        this.cursorDisc.inner.lastChild.setAttribute('class', 'disc-ring p' + player);
        this.cursorDisc.setAttribute('transform', 'translate(' + this.cx(c) + ' ' + (this.g.T / 2 - 2) + ') scale(0.82)');
        this.cursorDisc.style.opacity = '1';
      } else {
        this.cursorDisc.style.opacity = '0';
      }
    }
  };

  BoardView.prototype.drawLanding = function () {
    if (this.landing) { this.landing.remove(); this.landing = null; }
    var c = this.hover;
    if (c < 0 || !this.board.canPlay(c)) return;
    var d = this.makeDisc(this.board.toMove());
    d.setAttribute('class', 'land-ghost');
    d.setAttribute('transform', 'translate(' + this.cx(c) + ' ' + this.cy(this.board.h[c]) + ')');
    this.gDiscs.appendChild(d);
    this.landing = d;
  };

  BoardView.prototype.setInteractive = function (on) {
    this.interactive = !!on;
    this.svg.classList.toggle('live', this.interactive);
    if (this.interactive) {
      this.svg.setAttribute('tabindex', '0');
      this.svg.setAttribute('role', 'application');
      this.svg.setAttribute('aria-roledescription', 'game board');
    } else {
      this.svg.removeAttribute('tabindex');
      this.svg.setAttribute('role', 'img');
    }
    this.updateLabel();
    this.setHover(this.interactive && document.activeElement === this.svg ? this.cursor : -1);
  };

  BoardView.prototype.updateLabel = function () {
    var b = this.board, w = b.winner();
    var state = w ? Role(w.player) + ' has won.' : b.isFull() ? 'Draw.' : Role(b.toMove()) + ' to move.';
    var extra = this.interactive ? ' Use the arrow keys and Enter, or keys 1 to 7, to drop a disc.' : '';
    this.svg.setAttribute('aria-label', this.opts.label + ': ' + b.n + ' discs. ' + state + extra);
  };

  // Show a position. `animate` drops the most recent disc into place.
  BoardView.prototype.show = function (board, opts) {
    opts = opts || {};
    this.board = board;
    if (opts.overlay !== undefined) this.overlay = opts.overlay || {};
    if (opts.marks !== undefined) this.marks = opts.marks || [];
    if (opts.hint !== undefined) this.hintCol = opts.hint;
    this.renderDiscs(!!opts.animate);
    this.renderMarks();
    this.renderWin();
    this.updateLabel();
    this.setHover(this.hover);
  };

  BoardView.prototype.renderDiscs = function (animate) {
    var b = this.board, seen = {}, self = this;
    var last = b.n > b.base ? b.hist[b.n - 1] : -1;
    var lastR = last >= 0 ? b.h[last] - 1 : -1;
    for (var c = 0; c < 7; c++) {
      for (var r = 0; r < b.h[c]; r++) {
        var pl = b.get(c, r);
        var key = c + ':' + r + ':' + pl;
        seen[key] = true;
        if (this.discs[key]) continue;
        var d = this.makeDisc(pl);
        d.setAttribute('transform', 'translate(' + this.cx(c) + ' ' + this.cy(r) + ')');
        this.gDiscs.appendChild(d);
        this.discs[key] = d;
        if (animate && c === last && r === lastR && !reduceMotion && d.inner.animate) {
          var dy = this.cy(r) - (this.g.T / 2 - 2);
          var dur = 170 + 38 * (5 - r);
          d.inner.animate([
            { transform: 'translateY(' + (-dy) + 'px)', easing: 'cubic-bezier(.55,0,1,.45)' },
            { transform: 'translateY(0px)', offset: 0.78, easing: 'ease-out' },
            { transform: 'translateY(-9px)', offset: 0.9, easing: 'ease-in' },
            { transform: 'translateY(0px)' }
          ], { duration: dur });
        }
      }
    }
    Object.keys(this.discs).forEach(function (k) {
      if (!seen[k]) { self.discs[k].remove(); delete self.discs[k]; }
    });
    if (this.lastDot) { this.lastDot.remove(); this.lastDot = null; }
    if (last >= 0 && !this.opts.compact) {
      this.lastDot = sv('circle', { cx: this.cx(last), cy: this.cy(lastR), r: 6, class: 'last-dot' });
      this.gDiscs.appendChild(this.lastDot);
    }
    // Follow-up fill: odd rows to the first player, even rows to the second.
    clear(this.gFill);
    if (this.overlay.fill) {
      for (c = 0; c < 7; c++) {
        for (r = b.h[c]; r < 6; r++) {
          var gd = this.makeDisc(r % 2 === 0 ? 1 : 2, true);
          gd.setAttribute('transform', 'translate(' + this.cx(c) + ' ' + this.cy(r) + ')');
          this.gFill.appendChild(gd);
        }
      }
    }
  };

  BoardView.prototype.renderMarks = function () {
    var b = this.board, g = this.gMarks, self = this, ov = this.overlay;
    clear(g);
    var done = !!b.winner();
    if (ov.weights) {
      for (var c = 0; c < 7; c++) {
        for (var r = 0; r < 6; r++) {
          if (b.get(c, r)) continue;
          var w = C4.CELL_WEIGHT[c * 6 + r];
          g.appendChild(sv('circle', { cx: this.cx(c), cy: this.cy(r), r: 12 + w * 1.4, class: 'mk-weight-bg', opacity: (0.08 + w / 13 * 0.3).toFixed(2) }));
          var t = sv('text', { x: this.cx(c), y: this.cy(r) + 8, class: 'mk-weight' });
          t.textContent = String(w);
          g.appendChild(t);
        }
      }
    }
    if (ov.threats && !done) {
      var bySq = {};
      C4.threats(b).forEach(function (t) { (bySq[t.sq] = bySq[t.sq] || []).push(t); });
      Object.keys(bySq).forEach(function (k) {
        bySq[k].forEach(function (t, i) {
          var ring = sv('circle', { cx: self.cx(t.c), cy: self.cy(t.r), r: i ? 23 : 14, class: 'mk-threat p' + t.player + (t.good ? '' : ' off') });
          var title = sv('title');
          title.textContent = 'Threat for the ' + role(t.player) + ' on ' + t.sq + ' (' + (t.odd ? 'odd' : 'even') + ' row' + (t.good ? ', right parity' : ', wrong parity') + ')';
          ring.appendChild(title);
          g.appendChild(ring);
        });
      });
    }
    if (ov.poison && !done) {
      C4.poisoned(b).forEach(function (pz) {
        var x = self.cx(pz.c), y = self.cy(pz.r), s = 12;
        g.appendChild(sv('line', { x1: x - s, y1: y - s, x2: x + s, y2: y + s, class: 'mk-poison' }));
        g.appendChild(sv('line', { x1: x - s, y1: y + s, x2: x + s, y2: y - s, class: 'mk-poison' }));
      });
    }
    this.marks.forEach(function (m) {
      var pos = C4.parseSq(m.sq);
      if (m.kind === 'ring') g.appendChild(sv('circle', { cx: self.cx(pos.c), cy: self.cy(pos.r), r: 26, class: 'mk-ring' }));
    });
    if (this.hintCol >= 0 && b.canPlay(this.hintCol)) {
      g.appendChild(sv('circle', { cx: this.cx(this.hintCol), cy: this.cy(b.h[this.hintCol]), r: 27, class: 'mk-hint' }));
    }
    if (this.focusSq) {
      var f = C4.parseSq(this.focusSq);
      g.appendChild(sv('circle', { cx: this.cx(f.c), cy: this.cy(f.r), r: 30, class: 'mk-focus' }));
    }
    for (var i = 0; i < 7; i++) this.colHl[i].classList.toggle('on', i === this.hover || (this.hover < 0 && i === this.hintCol));
  };

  BoardView.prototype.setFocusSquare = function (sq) {
    this.focusSq = sq;
    this.renderMarks();
  };

  BoardView.prototype.renderWin = function () {
    clear(this.gWin);
    var w = this.board.winner();
    if (!w) return;
    var self = this;
    var pts = w.cells.map(function (i) { return { x: self.cx(Math.floor(i / 6)), y: self.cy(i % 6) }; });
    this.gWin.appendChild(sv('line', { x1: pts[0].x, y1: pts[0].y, x2: pts[3].x, y2: pts[3].y, class: 'win-line' }));
    pts.forEach(function (pt) { self.gWin.appendChild(sv('circle', { cx: pt.x, cy: pt.y, r: 33, class: 'win-ring' })); });
  };

  // Square chips in text light up the square on this board.
  function linkSquares(container, view) {
    container.addEventListener('mouseover', function (e) {
      var t = e.target.closest && e.target.closest('.sq');
      if (t) view.setFocusSquare(t.getAttribute('data-sq'));
    });
    container.addEventListener('mouseout', function (e) {
      var t = e.target.closest && e.target.closest('.sq');
      if (t) view.setFocusSquare(null);
    });
    container.addEventListener('focusin', function (e) {
      if (e.target.classList && e.target.classList.contains('sq')) view.setFocusSquare(e.target.getAttribute('data-sq'));
    });
    container.addEventListener('focusout', function (e) {
      if (e.target.classList && e.target.classList.contains('sq')) view.setFocusSquare(null);
    });
  }

  function legend(overlay) {
    var items = [];
    function icon(inner) {
      var s = sv('svg', { viewBox: '-10 -10 20 20', 'aria-hidden': 'true' });
      inner.forEach(function (n) { s.appendChild(n); });
      return s;
    }
    if (overlay.threats) {
      items.push(el('span', null, icon([sv('circle', { r: 6, class: 'mk-threat p1', 'stroke-width': 3 })]), 'Threat, right parity'));
      items.push(el('span', null, icon([sv('circle', { r: 6, class: 'mk-threat p1 off', 'stroke-width': 3, 'stroke-dasharray': '3 3' })]), 'Threat, wrong parity'));
    }
    if (overlay.poison) {
      items.push(el('span', null, icon([sv('line', { x1: -5, y1: -5, x2: 5, y2: 5, class: 'mk-poison', 'stroke-width': 3 }), sv('line', { x1: -5, y1: 5, x2: 5, y2: -5, class: 'mk-poison', 'stroke-width': 3 })]), 'Poisoned for the side to move'));
    }
    if (overlay.fill) {
      items.push(el('span', null, icon([sv('circle', { r: 7, class: 'disc-ghost p1' })]), 'Faded: where follow-up puts each disc'));
    }
    if (overlay.weights) {
      items.push(el('span', null, 'Numbers: lines of four through each square'));
    }
    return items.length ? el('div', { class: 'legend' }, items) : null;
  }

  function toMoveLine(b) {
    var w = b.winner();
    if (w) return el('span', { html: rich('**' + Role(w.player) + ' wins.**') });
    if (b.isFull()) return el('span', null, el('strong', null, 'Draw.'), ' The board is full.');
    return el('span', { html: rich('[P' + b.toMove() + '] to move') });
  }

  /* ---------------------------------------------------------- progress */

  var progress = {
    solved: store.get('solved', {}),
    seen: store.get('seen', {}),
    markSolved: function (id) { this.solved[id] = true; store.set('solved', this.solved); },
    markSeen: function (lessonId, i) {
      var s = this.seen[lessonId] || [];
      if (s.indexOf(i) < 0) { s.push(i); this.seen[lessonId] = s; store.set('seen', this.seen); }
    },
    lessonDone: function (lesson) {
      var s = this.seen[lesson.id] || [];
      var self = this;
      return lesson.steps.every(function (st, i) {
        return s.indexOf(i) >= 0 && (st.kind !== 'puzzle' || self.solved[st.id]);
      });
    }
  };

  /* --------------------------------------------------------------- stage */

  // One board + one text panel that can present any step of any kind.
  function Stage(host, ctx) {
    this.ctx = ctx;
    this.view = new BoardView({ label: 'Lesson board', onMove: this.onMove.bind(this) });
    this.status = el('div', { class: 'board-status' });
    this.legendBox = el('div');
    this.fig = el('figure', { class: 'board-fig' }, this.view.svg, this.status, this.legendBox);
    this.title = el('h3');
    this.eyebrow = el('p', { class: 'eyebrow' });
    this.prose = el('div', { class: 'prose' });
    this.interact = el('div', { class: 'interact', 'aria-live': 'polite' });
    this.nav = el('div', { class: 'step-nav' });
    this.text = el('div', { class: 'stage-text' }, el('div', null, this.eyebrow, this.title), this.prose, this.interact, this.nav);
    this.root = el('div', { class: 'stage' }, this.fig, this.text);
    linkSquares(this.text, this.view);
    host.appendChild(this.root);
    this.token = 0;
  }

  Stage.prototype.setStatus = function (b, extra) {
    clear(this.status);
    this.status.appendChild(toMoveLine(b));
    if (extra) this.status.appendChild(el('span', { html: rich(extra) }));
  };

  Stage.prototype.present = function (step, meta) {
    engine.cancel();
    this.token++;
    this.step = step;
    this.meta = meta;
    this.handler = null;
    this.view.focusSq = null;
    this.view.hover = -1;
    this.eyebrow.textContent = meta.eyebrow || '';
    this.title.textContent = step.title;
    clear(this.prose);
    clear(this.interact);
    clear(this.legendBox);
    (step.text || []).forEach(function (t) { this.prose.appendChild(p(t)); }, this);
    var kinds = { diagram: this.diagram, line: this.line, puzzle: this.puzzle, demo: this.demo, quiz: this.quiz };
    kinds[step.kind].call(this, step);
    var lg = legend(this.view.overlay);
    if (lg) this.legendBox.appendChild(lg);
    this.renderNav();
  };

  Stage.prototype.renderNav = function () {
    var m = this.meta;
    clear(this.nav);
    this.nav.appendChild(el('button', { class: 'btn quiet', disabled: !m.onPrev, onclick: m.onPrev }, '← ' + (m.prevLabel || 'Back')));
    this.nav.appendChild(el('button', { class: 'btn primary', disabled: !m.onNext, onclick: m.onNext }, (m.nextLabel || 'Next') + ' →'));
  };

  Stage.prototype.onMove = function (c) { if (this.handler) this.handler(c); };

  Stage.prototype.diagram = function (step) {
    var b = boardFrom(step.pos);
    this.view.setInteractive(false);
    this.view.show(b, { overlay: step.overlay || {}, marks: step.marks || [], hint: -1 });
    this.setStatus(b);
    if (step.table) {
      var t = step.table;
      var table = el('table', { class: 'evidence' },
        el('caption', null, t.caption),
        el('thead', null, el('tr', null, t.head.map(function (h) { return el('th', { scope: 'col' }, h); }))),
        el('tbody', null, t.rows.map(function (row) {
          var max = Math.max(parseInt(row[2], 10), parseInt(row[3], 10), parseInt(row[4], 10));
          return el('tr', null, row.map(function (cell, i) {
            return i === 0 ? el('th', { scope: 'row' }, cell) : el('td', { class: i >= 2 && parseInt(cell, 10) === max ? 'hi' : null }, cell);
          }));
        })));
      this.interact.appendChild(el('div', { class: 'table-wrap' }, table));
    }
  };

  Stage.prototype.line = function (step) {
    var self = this, k = 0;
    var start = boardFrom(step.pos);
    this.view.setInteractive(false);
    var list = el('ol', { class: 'line-notes' }, step.notes.map(function (n) { return el('li', { hidden: true, html: rich(n) }); }));
    var back = el('button', { class: 'btn', onclick: function () { go(k - 1, false); } }, 'Back one');
    var next = el('button', { class: 'btn primary', onclick: function () { go(k + 1, true); } }, 'Play next move');
    var reset = el('button', { class: 'btn quiet', onclick: function () { go(0, false); } }, 'Start over');
    function go(to, animate) {
      k = Math.max(0, Math.min(step.line.length, to));
      var b = start.clone();
      for (var i = 0; i < k; i++) b.play(+step.line[i] - 1);
      self.view.show(b, { overlay: { threats: true }, marks: [], hint: -1, animate: animate });
      self.setStatus(b);
      Array.prototype.forEach.call(list.children, function (li, i) {
        li.hidden = i >= k;
        li.classList.toggle('cur', i === k - 1);
      });
      back.disabled = k === 0;
      next.disabled = k === step.line.length;
    }
    this.interact.appendChild(el('div', { class: 'row' }, next, back, reset));
    this.interact.appendChild(list);
    go(0, false);
  };

  Stage.prototype.puzzle = function (step) {
    var self = this, token = this.token;
    var start = boardFrom(step.pos);
    var state = 'idle';
    var analysisP = null;
    function analysis() {
      if (!analysisP) analysisP = engine.call('analyze', start, { timeMs: 1500 });
      return analysisP;
    }
    this.prose.appendChild(p(step.prompt, 'prompt'));
    var hintBox = el('div');
    var feedback = el('div');
    var hintBtn = el('button', { class: 'btn quiet', onclick: function () {
      clear(hintBox);
      hintBox.appendChild(el('p', { class: 'note info', html: rich(step.hint || 'Run the three checks: win, block, what lands on top.') }));
      hintBtn.disabled = true;
    } }, 'Hint');
    var showBtn = el('button', { class: 'btn quiet', onclick: function () { reveal(); } }, 'Show answer');
    this.interact.appendChild(el('div', { class: 'row' }, hintBtn, showBtn));
    this.interact.appendChild(hintBox);
    this.interact.appendChild(feedback);

    function setBoard(b, animate, hint) {
      self.view.show(b, { overlay: {}, marks: [], hint: hint === undefined ? -1 : hint, animate: animate });
      self.setStatus(b);
    }
    function reset() {
      state = 'idle';
      self.handler = onPick;
      clear(feedback);
      setBoard(start, false);
      self.view.setInteractive(true);
    }
    function success(c) {
      state = 'solved';
      progress.markSolved(step.id);
      clear(feedback);
      var box = el('div', { class: 'feedback ok' },
        el('h4', null, 'Correct'),
        p(step.explain));
      if (step.goal !== 'theory') {
        box.appendChild(el('div', { class: 'row' }, el('button', { class: 'btn', onclick: function () { playOut(c); } }, 'Play it out'),
          el('button', { class: 'btn quiet', onclick: reset }, 'Reset')));
      }
      feedback.appendChild(box);
      if (self.ctx.onProgress) self.ctx.onProgress();
    }
    function reveal() {
      state = 'revealed';
      self.view.setInteractive(false);
      var c = FILES.indexOf(step.solutions[0]);
      setBoard(start, false, c);
      clear(feedback);
      feedback.appendChild(el('div', { class: 'feedback' },
        el('h4', { html: rich('Answer: ' + step.solutions.map(function (s) { return '{' + sqName(FILES.indexOf(s), start.h[FILES.indexOf(s)]) + '}'; }).join(' or ')) }),
        p(step.explain),
        el('div', { class: 'row' }, el('button', { class: 'btn', onclick: reset }, 'Try it yourself'))));
    }
    function wrong(c) {
      state = 'wrong';
      var r = start.h[c];
      var sq = sqName(c, r);
      clear(feedback);
      var explainP = el('div', { class: 'notes' });
      var box = el('div', { class: 'feedback no' }, el('h4', { html: rich('Not {' + sq + '}') }), explainP,
        el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: reset }, 'Try again')));
      feedback.appendChild(box);
      if (step.wrong && step.wrong[FILES[c]]) {
        explainP.appendChild(p(step.wrong[FILES[c]]));
      } else {
        var notes = Coach.notes(start, c).filter(function (n) { return n.tone === 'bad'; });
        if (notes.length) notes.forEach(function (n) { explainP.appendChild(p(n.text)); });
        else if (step.goal === 'theory') explainP.appendChild(p('Not this one.'));
        else {
          var line = el('p', null, 'Checking what this allows…');
          explainP.appendChild(line);
          analysis().then(function (a) {
            if (token !== self.token) return;
            var v = a.scores[c];
            var msg;
            if (step.goal === 'mate') msg = 'This does not force a win within ' + step.within + (step.within === 1 ? ' move.' : ' moves.');
            else if (v <= -C4.MATE_MIN) msg = 'This loses by force.';
            else if (step.goal === 'save') msg = 'This does not hold. Look for the square your opponent needs.';
            else msg = 'This does not win. The solver finds only one winning idea here.';
            line.innerHTML = rich(msg);
          }).catch(ignoreCancel);
        }
      }
      // Show the opponent's reply.
      var after = start.clone();
      after.play(c);
      if (step.goal === 'theory' || after.winner()) return;
      engine.call('best', after, { timeMs: 450 }).then(function (res) {
        if (token !== self.token || state !== 'wrong') return;
        return wait(350).then(function () {
          if (token !== self.token || state !== 'wrong') return;
          var reply = after.clone();
          var rr = reply.h[res.move];
          reply.play(res.move);
          setBoard(reply, true);
          explainP.appendChild(p('Your opponent answers {' + sqName(res.move, rr) + '}' + (reply.winner() ? ' and wins.' : '.')));
        });
      }).catch(ignoreCancel);
    }
    function playOut(firstMove) {
      var me = start.toMove();
      var b = start.clone();
      b.play(firstMove);
      clear(feedback);
      var msg = el('p', { html: rich('You are the [P' + me + ']. The coach defends at full strength.') });
      feedback.appendChild(el('div', { class: 'feedback' }, el('h4', null, 'Play it out'), msg,
        el('div', { class: 'row' }, el('button', { class: 'btn quiet', onclick: reset }, 'Back to the puzzle'))));
      state = 'playout';
      function opponent() {
        self.view.setInteractive(false);
        if (b.winner() || b.isFull()) return finish();
        engine.call('best', b, { timeMs: 700 }).then(function (res) {
          if (token !== self.token || state !== 'playout') return;
          return wait(250).then(function () {
            if (token !== self.token || state !== 'playout') return;
            b.play(res.move);
            self.view.show(b, { animate: true });
            self.setStatus(b);
            if (b.winner() || b.isFull()) return finish();
            self.view.setInteractive(true);
          });
        }).catch(ignoreCancel);
      }
      function finish() {
        var w = b.winner();
        self.view.setInteractive(false);
        msg.innerHTML = rich(w ? (w.player === me ? 'You converted it. Well played.' : 'The coach got away this time. Reset and try the line again.') : 'A draw. The winning idea is still there; try again.');
      }
      self.handler = function (c) {
        if (state !== 'playout' || b.toMove() !== me) return;
        b.play(c);
        self.view.show(b, { animate: true });
        self.setStatus(b);
        opponent();
      };
      self.view.show(b, { animate: true, overlay: { threats: true } });
      self.setStatus(b);
      opponent();
    }

    function onPick(c) {
      if (state !== 'idle') return;
      self.view.setInteractive(false);
      var b = start.clone();
      b.play(c);
      setBoard(b, true);
      if (step.solutions.indexOf(FILES[c]) >= 0) success(c);
      else wrong(c);
    }
    reset();
    if (progress.solved[step.id]) {
      this.interact.insertBefore(el('p', { class: 'note good' }, 'You have solved this one before.'), this.interact.firstChild);
    }
    // Warm the analysis up while the reader thinks.
    if (step.goal !== 'theory') analysis().catch(ignoreCancel);
  };

  Stage.prototype.demo = function (step) {
    var self = this, token = this.token;
    var start = boardFrom(step.pos), b;
    var me = step.you;
    var msg = el('p');
    this.interact.appendChild(el('div', { class: 'feedback' }, msg,
      el('div', { class: 'row' }, el('button', { class: 'btn', onclick: function () { begin(); } }, 'Restart'))));
    function begin() {
      self.token++;
      token = self.token;
      b = start.clone();
      msg.innerHTML = rich('Your move. Drop anywhere.');
      self.view.show(b, { overlay: step.overlay || {}, marks: [], hint: -1 });
      self.setStatus(b);
      self.view.setInteractive(true);
    }
    function finish() {
      var w = b.winner();
      var o = step.outcomes || {};
      var key = w ? (w.player === me ? 'win' : 'loss') : 'draw';
      msg.innerHTML = rich(o[key] || '');
      self.view.setInteractive(false);
    }
    function botMove(lastCol) {
      var bot = 3 - me;
      var w = immediateWins(b, bot);
      if (w.length) return w[0];
      var threat = immediateWins(b, me);
      if (threat.length) return threat[0];
      if (step.bot === 'followup' && b.canPlay(lastCol)) return lastCol;
      for (var i = 0; i < 7; i++) if (b.canPlay([3, 2, 4, 1, 5, 0, 6][i])) return [3, 2, 4, 1, 5, 0, 6][i];
      return -1;
    }
    this.handler = function (c) {
      if (b.toMove() !== me || b.winner()) return;
      self.view.setInteractive(false);
      b.play(c);
      self.view.show(b, { animate: true });
      self.setStatus(b);
      if (b.winner() || b.isFull()) return finish();
      msg.innerHTML = rich('The [P' + (3 - me) + '] answers…');
      wait(reduceMotion ? 150 : 480).then(function () {
        if (token !== self.token) return;
        var m = botMove(c);
        var r = b.h[m];
        b.play(m);
        self.view.show(b, { animate: true });
        self.setStatus(b);
        if (b.winner() || b.isFull()) return finish();
        msg.innerHTML = rich((m === c ? 'Answered on top: {' + sqName(m, r) + '}.' : 'Played {' + sqName(m, r) + '}.') + ' Your move.');
        self.view.setInteractive(true);
      });
    };
    begin();
  };

  Stage.prototype.quiz = function (step) {
    var self = this;
    var b = boardFrom(step.pos);
    this.view.setInteractive(false);
    this.view.show(b, { overlay: step.overlay || {}, marks: [], hint: -1 });
    this.setStatus(b);
    this.prose.appendChild(p(step.question, 'prompt'));
    var out = el('div');
    var buttons = step.options.map(function (o, oi) {
      return el('button', { class: 'btn', onclick: function () {
        buttons.forEach(function (bt, i) {
          bt.disabled = true;
          if (step.options[i].id === step.answer) bt.classList.add('right');
          else if (i === oi) bt.classList.add('wrong');
        });
        var ok = o.id === step.answer;
        clear(out);
        out.appendChild(el('div', { class: 'feedback ' + (ok ? 'ok' : 'no') }, el('h4', null, ok ? 'Right' : 'Not quite'), p(step.explain)));
      } }, o.label);
    });
    this.interact.appendChild(el('div', { class: 'options' }, buttons));
    this.interact.appendChild(out);
  };

  /* -------------------------------------------------------------- learn */

  function LearnView(host) {
    var self = this;
    this.list = el('ol');
    this.head = el('div', { class: 'lesson-head' });
    this.stageHost = el('div');
    this.root = el('div', { class: 'learn' },
      el('nav', { class: 'lesson-list', 'aria-label': 'Lessons' }, this.list),
      el('section', { class: 'lesson' }, this.head, this.stageHost));
    host.appendChild(this.root);
    this.stage = new Stage(this.stageHost, { onProgress: function () { self.renderList(); } });
    var saved = store.get('where', { lesson: 0, step: 0 });
    this.li = Math.min(saved.lesson || 0, CUR.lessons.length - 1);
    this.si = Math.min(saved.step || 0, CUR.lessons[this.li].steps.length - 1);
  }

  LearnView.prototype.renderList = function () {
    var self = this;
    clear(this.list);
    CUR.lessons.forEach(function (lesson, i) {
      var done = progress.lessonDone(lesson);
      self.list.appendChild(el('li', null, el('button', {
        class: 'lesson-link',
        'aria-current': i === self.li ? 'true' : null,
        onclick: function () { self.open(i, 0); }
      },
      el('span', { class: 'lesson-num' }, String(i + 1)),
      el('span', { class: 't' }, lesson.title),
      el('span', { class: 's' }, done ? el('span', { class: 'done' }, 'Done · ') : null, lesson.short))));
    });
  };

  LearnView.prototype.open = function (li, si) {
    var self = this;
    this.li = li;
    this.si = si;
    store.set('where', { lesson: li, step: si });
    var lesson = CUR.lessons[li];
    var step = lesson.steps[si];
    progress.markSeen(lesson.id, si);
    clear(this.head);
    var seen = progress.seen[lesson.id] || [];
    this.head.appendChild(el('div', null,
      el('p', { class: 'eyebrow' }, 'Lesson ' + (li + 1) + ' of ' + CUR.lessons.length),
      el('h2', { class: 'display' }, lesson.title)));
    this.head.appendChild(el('div', { class: 'dots', role: 'group', 'aria-label': 'Steps' }, lesson.steps.map(function (st, i) {
      return el('button', {
        class: 'dot' + (seen.indexOf(i) >= 0 ? ' seen' : ''),
        'aria-current': i === si ? 'step' : null,
        'aria-label': 'Step ' + (i + 1) + ': ' + st.title,
        title: st.title,
        onclick: function () { self.open(li, i); }
      });
    })));
    var last = si === lesson.steps.length - 1;
    var nextLesson = CUR.lessons[li + 1];
    this.stage.present(step, {
      lesson: lesson,
      index: si,
      eyebrow: 'Step ' + (si + 1) + ' of ' + lesson.steps.length + (step.kind === 'puzzle' ? ' · Puzzle' : step.kind === 'demo' ? ' · Try it' : step.kind === 'quiz' ? ' · Quiz' : ''),
      onPrev: si > 0 ? function () { self.open(li, si - 1); } : li > 0 ? function () { self.open(li - 1, CUR.lessons[li - 1].steps.length - 1); } : null,
      prevLabel: si > 0 ? 'Back' : 'Previous lesson',
      onNext: !last ? function () { self.open(li, si + 1); } : nextLesson ? function () { self.open(li + 1, 0); } : function () { router.go('play'); },
      nextLabel: !last ? 'Next' : nextLesson ? 'Next lesson: ' + nextLesson.title : 'Play the coach'
    });
    this.renderList();
  };

  LearnView.prototype.enter = function () { this.open(this.li, this.si); };

  /* ------------------------------------------------------------ puzzles */

  function allPuzzles() {
    var out = [];
    CUR.lessons.forEach(function (lesson, li) {
      lesson.steps.forEach(function (st) {
        if (st.kind === 'puzzle') out.push({ step: st, source: 'lesson', tag: 'Lesson ' + (li + 1) + ': ' + lesson.title });
      });
    });
    CUR.practice.forEach(function (st) { out.push({ step: st, source: 'practice', tag: st.tag }); });
    return out;
  }

  function PuzzlesView(host) {
    var self = this;
    this.items = allPuzzles();
    this.filter = store.get('pfilter', 'all');
    this.grid = el('div', { class: 'puzzle-grid' });
    this.filters = el('div', { class: 'filters', role: 'group', 'aria-label': 'Filter puzzles' });
    this.count = el('p', { class: 'eyebrow' });
    this.listRoot = el('div', null,
      el('div', { class: 'puzzles-head' },
        el('div', null, this.count, el('h2', { class: 'display' }, 'Puzzles')),
        this.filters),
      this.grid);
    this.stageHead = el('div', { class: 'lesson-head' });
    this.stageHost = el('div');
    this.detailRoot = el('div', { class: 'lesson', hidden: true }, this.stageHead, this.stageHost);
    host.appendChild(this.listRoot);
    host.appendChild(this.detailRoot);
    this.stage = new Stage(this.stageHost, { onProgress: function () { self.renderGrid(); } });
    this.thumbs = this.items.map(function (it) {
      var v = new BoardView({ compact: true, label: it.step.title });
      v.show(boardFrom(it.step.pos), { overlay: {}, marks: [], hint: -1 });
      return v;
    });
  }

  PuzzlesView.prototype.renderGrid = function () {
    var self = this;
    var solved = this.items.filter(function (it) { return progress.solved[it.step.id]; }).length;
    this.count.textContent = solved + ' of ' + this.items.length + ' solved';
    clear(this.filters);
    [['all', 'All'], ['lesson', 'From lessons'], ['practice', 'Practice set'], ['open', 'Unsolved']].forEach(function (f) {
      self.filters.appendChild(el('button', { class: 'chip', 'aria-pressed': self.filter === f[0] ? 'true' : 'false', onclick: function () { self.filter = f[0]; store.set('pfilter', f[0]); self.renderGrid(); } }, f[1]));
    });
    clear(this.grid);
    this.items.forEach(function (it, i) {
      if (self.filter === 'lesson' && it.source !== 'lesson') return;
      if (self.filter === 'practice' && it.source !== 'practice') return;
      if (self.filter === 'open' && progress.solved[it.step.id]) return;
      var b = boardFrom(it.step.pos);
      self.grid.appendChild(el('button', { class: 'pcard', onclick: function () { self.open(i); } },
        self.thumbs[i].svg,
        el('span', { class: 't' }, it.step.title),
        el('span', { class: 'meta' },
          el('span', { html: rich('[P' + b.toMove() + '] to move') }),
          progress.solved[it.step.id] ? el('span', { class: 'solved' }, 'Solved') : el('span', null, it.tag))));
    });
    if (!this.grid.children.length) this.grid.appendChild(el('p', { class: 'empty-note' }, 'All solved. Pick another filter to replay them.'));
  };

  PuzzlesView.prototype.open = function (i) {
    var self = this, it = this.items[i];
    this.listRoot.hidden = true;
    this.detailRoot.hidden = false;
    clear(this.stageHead);
    this.stageHead.appendChild(el('div', null,
      el('p', { class: 'eyebrow' }, 'Puzzle ' + (i + 1) + ' of ' + this.items.length + ' · ' + it.tag),
      el('h2', { class: 'display' }, it.step.title)));
    this.stageHead.appendChild(el('button', { class: 'btn', onclick: function () { self.close(); } }, 'All puzzles'));
    this.stage.present(it.step, {
      eyebrow: 'Puzzle',
      onPrev: i > 0 ? function () { self.open(i - 1); } : null,
      prevLabel: 'Previous puzzle',
      onNext: i < this.items.length - 1 ? function () { self.open(i + 1); } : function () { self.close(); },
      nextLabel: i < this.items.length - 1 ? 'Next puzzle' : 'All puzzles'
    });
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  PuzzlesView.prototype.close = function () {
    engine.cancel();
    this.detailRoot.hidden = true;
    this.listRoot.hidden = false;
    this.renderGrid();
  };

  PuzzlesView.prototype.enter = function () { this.close(); };

  /* --------------------------------------------------------------- play */

  var LEVELS = {
    casual: { label: 'Casual', think: 350 },
    club: { label: 'Club', think: 600 },
    strong: { label: 'Strong', think: 900 }
  };

  function PlayView(host) {
    var self = this;
    this.you = store.get('you', 1);
    this.level = store.get('level', 'club');
    this.showThreats = store.get('showThreats', true);
    this.showPoison = store.get('showPoison', true);
    this.view = new BoardView({ label: 'Game board', onMove: function (c) { self.onUserMove(c); } });
    this.status = el('div', { class: 'board-status' });
    this.meterFill = el('div', { class: 'meter-fill', style: 'width:50%' });
    this.meterText = el('p', { class: 'meter-text' }, 'The coach is looking…');
    this.review = el('div', { class: 'notes', 'aria-live': 'polite' });
    this.reading = el('p');
    this.moves = el('div', { class: 'moves' });
    this.hintBox = el('div', { class: 'notes' });

    function seg(options, current, onPick) {
      var box = el('div', { class: 'seg', role: 'group' });
      options.forEach(function (o) {
        box.appendChild(el('button', { 'aria-pressed': o[0] === current() ? 'true' : 'false', onclick: function () {
          onPick(o[0]);
          Array.prototype.forEach.call(box.children, function (bt, i) { bt.setAttribute('aria-pressed', options[i][0] === current() ? 'true' : 'false'); });
        } }, o[1]));
      });
      return box;
    }
    var sideSeg = seg([[1, 'First'], [2, 'Second']], function () { return self.you; }, function (v) { self.you = v; store.set('you', v); self.newGame(); });
    var levelSeg = seg(Object.keys(LEVELS).map(function (k) { return [k, LEVELS[k].label]; }), function () { return self.level; }, function (v) { self.level = v; store.set('level', v); });
    var threatsBox = el('input', { type: 'checkbox', id: 'play-threats', checked: this.showThreats ? true : null, onchange: function (e) { self.showThreats = e.target.checked; store.set('showThreats', self.showThreats); self.refresh(); } });
    var poisonBox = el('input', { type: 'checkbox', id: 'play-poison', checked: this.showPoison ? true : null, onchange: function (e) { self.showPoison = e.target.checked; store.set('showPoison', self.showPoison); self.refresh(); } });
    this.undoBtn = el('button', { class: 'btn', onclick: function () { self.undo(); } }, 'Undo');
    this.hintBtn = el('button', { class: 'btn', onclick: function () { self.hint(); } }, 'Hint');

    var coach = el('aside', { class: 'coach', 'aria-label': 'Coach' },
      el('div', { class: 'card' },
        el('div', { class: 'row' },
          el('div', { class: 'setting' }, el('span', null, 'You play'), sideSeg),
          el('div', { class: 'setting' }, el('span', null, 'Coach strength'), levelSeg)),
        el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: function () { self.newGame(); } }, 'New game'), this.undoBtn, this.hintBtn),
        el('div', { class: 'toggles' },
          el('label', { for: 'play-threats' }, threatsBox, 'Show threats'),
          el('label', { for: 'play-poison' }, poisonBox, 'Show poisoned squares'))),
      el('div', { class: 'card' }, el('h3', null, 'Your last move'), this.review, this.hintBox),
      el('div', { class: 'card' }, el('h3', null, 'Threat reading'), this.reading,
        el('div', { class: 'meter' },
          el('div', { class: 'meter-bar', role: 'img', 'aria-label': 'Balance between the players' }, this.meterFill, el('div', { class: 'meter-mid' })),
          this.meterText)),
      el('div', { class: 'card' }, el('h3', null, 'Moves'), this.moves));
    this.legendBox = el('div');
    var boardCol = el('figure', { class: 'board-fig' }, this.view.svg, this.status, this.legendBox);
    this.root = el('div', { class: 'play' }, boardCol, coach);
    linkSquares(coach, this.view);
    host.appendChild(this.root);
    this.newGame();
  }

  PlayView.prototype.overlay = function () { return { threats: this.showThreats, poison: this.showPoison }; };

  PlayView.prototype.refresh = function (animate) {
    var b = this.b;
    this.view.show(b, { overlay: this.overlay(), marks: [], hint: this.hintCol, animate: !!animate });
    clear(this.legendBox);
    var lg = legend(this.overlay());
    if (lg) this.legendBox.appendChild(lg);
    clear(this.status);
    this.status.appendChild(toMoveLine(b));
    var w = b.winner();
    if (!w && !b.isFull()) this.status.appendChild(el('span', null, b.toMove() === this.you ? 'Your move' : this.thinking ? 'Coach is thinking…' : ''));
    var r = Coach.reading(b);
    this.reading.innerHTML = rich(w ? Role(w.player) + ' made four in a row.' : b.isFull() ? 'The board is full.' : r.text);
    this.renderMoves();
    var you = this.you;
    this.undoBtn.disabled = this.busy || !this.history.some(function (m) { return m.player === you; });
    this.hintBtn.disabled = b.toMove() !== this.you || !!w || b.isFull() || this.busy;
  };

  PlayView.prototype.renderMoves = function () {
    clear(this.moves);
    var h = this.history;
    if (!h.length) {
      this.moves.style.display = 'block';
      this.moves.appendChild(el('p', { class: 'empty-note' }, 'No moves yet.'));
      return;
    }
    this.moves.style.display = '';
    for (var i = 0; i < h.length; i += 2) {
      this.moves.appendChild(el('span', { class: 'n' }, String(i / 2 + 1) + '.'));
      [h[i], h[i + 1]].forEach(function (m) {
        if (!m) { this.moves.appendChild(el('span')); return; }
        this.moves.appendChild(el('span', { class: 'mv' }, m.sq, m.grade ? el('span', { class: 'pill ' + m.grade.grade }, m.grade.label) : null));
      }, this);
    }
    this.moves.scrollTop = this.moves.scrollHeight;
  };

  PlayView.prototype.newGame = function () {
    engine.cancel();
    this.gen = (this.gen || 0) + 1;
    this.b = new C4.Board();
    this.history = [];
    this.hintCol = -1;
    this.analysis = null;
    this.busy = false;
    this.thinking = false;
    clear(this.review);
    clear(this.hintBox);
    this.review.appendChild(el('p', { class: 'empty-note', html: rich('You are the [P' + this.you + ']. After each of your moves the coach grades it and explains what it did.') }));
    this.meterFill.style.width = '50%';
    this.meterText.textContent = 'Roughly level.';
    this.refresh();
    if (router.current === 'play') this.next();
  };

  PlayView.prototype.next = function () {
    var b = this.b, self = this, gen = this.gen;
    if (b.winner() || b.isFull()) return this.gameOver();
    if (b.toMove() === this.you) {
      this.view.setInteractive(true);
      this.analysis = engine.call('analyze', b.clone(), { timeMs: LEVELS[this.level].think });
      this.analysis.then(function (a) {
        if (gen !== self.gen) return;
        var bal = Coach.balance(b, a);
        self.meterFill.style.width = bal.pct + '%';
        self.meterText.innerHTML = rich(bal.text);
      }).catch(ignoreCancel);
      this.refresh();
    } else {
      this.view.setInteractive(false);
      this.coachMove();
    }
  };

  PlayView.prototype.pickCoachMove = function () {
    var b = this.b.clone(), level = this.level;
    if (level === 'strong' && b.n === 0) return Promise.resolve(3);
    if (level === 'strong' && b.n === 1 && b.hist[0] === 3) return Promise.resolve(3);
    if (level === 'casual') {
      return engine.call('analyze', b, { maxDepth: 3 }).then(function (a) {
        var ok = [];
        for (var c = 0; c < 7; c++) {
          var v = a.scores[c];
          if (v === null) continue;
          if (v >= C4.MATE_MIN) return c;
          if (v > -C4.MATE_MIN && v >= a.bestScore - 45) ok.push(c);
        }
        if (!ok.length) return a.best;
        return ok[Math.floor(Math.random() * ok.length)];
      });
    }
    var opts = level === 'club' ? { maxDepth: 7, timeMs: 500 } : { timeMs: 1200 };
    return engine.call('best', b, opts).then(function (r) { return r.move; });
  };

  PlayView.prototype.coachMove = function () {
    var self = this, gen = this.gen;
    this.thinking = true;
    this.busy = true;
    this.refresh();
    var started = Date.now();
    this.pickCoachMove().then(function (c) {
      if (gen !== self.gen) return;
      return wait(Math.max(0, 420 - (Date.now() - started))).then(function () {
        if (gen !== self.gen) return;
        self.thinking = false;
        self.busy = false;
        self.playMove(c, null);
        self.next();
      });
    }).catch(ignoreCancel);
  };

  PlayView.prototype.playMove = function (c, grade) {
    var r = this.b.h[c];
    this.b.play(c);
    this.history.push({ c: c, sq: sqName(c, r), player: this.b.get(c, r), grade: grade });
    this.hintCol = -1;
    clear(this.hintBox);
    this.refresh(true);
  };

  PlayView.prototype.onUserMove = function (c) {
    var self = this, gen = this.gen;
    if (this.busy || this.b.toMove() !== this.you) return;
    this.busy = true;
    this.view.setInteractive(false);
    var before = this.b.clone();
    var notes = Coach.notes(before, c);
    var analysis = this.analysis || engine.call('analyze', before, { timeMs: 500 });
    this.playMove(c, null);
    var entry = this.history[this.history.length - 1];
    clear(this.review);
    this.review.appendChild(el('p', { class: 'empty-note' }, 'Checking your move…'));
    analysis.then(function (a) {
      if (gen !== self.gen) return;
      var g = Coach.grade(before, a, c);
      entry.grade = g;
      self.renderReview(entry, g, notes);
      self.busy = false;
      self.refresh();
      self.next();
    }).catch(function (err) {
      ignoreCancel(err);
      if (gen !== self.gen) return;
      self.busy = false;
      self.next();
    });
  };

  PlayView.prototype.renderReview = function (entry, g, notes) {
    clear(this.review);
    this.review.appendChild(el('div', { class: 'row' }, el('strong', { html: rich('{' + entry.sq + '}') }), el('span', { class: 'pill ' + g.grade }, g.label)));
    this.review.appendChild(p(g.text));
    var fine = g.grade === 'best' || g.grade === 'good';
    notes.forEach(function (n) {
      if (n.kind === 'edge' && fine) return;
      this.review.appendChild(el('p', { class: 'note ' + n.tone, html: rich(n.text) }));
    }, this);
  };

  PlayView.prototype.hint = function () {
    var self = this, gen = this.gen;
    if (!this.analysis) return;
    clear(this.hintBox);
    this.hintBox.appendChild(el('p', { class: 'empty-note' }, 'Asking the coach…'));
    this.analysis.then(function (a) {
      if (gen !== self.gen) return;
      var c = a.best, b = self.b;
      self.hintCol = c;
      self.refresh();
      clear(self.hintBox);
      self.hintBox.appendChild(p('**Coach suggests {' + sqName(c, b.h[c]) + '}.**'));
      Coach.notes(b, c).filter(function (n) { return n.tone !== 'bad'; }).forEach(function (n) {
        self.hintBox.appendChild(el('p', { class: 'note ' + n.tone, html: rich(n.text) }));
      });
    }).catch(ignoreCancel);
  };

  PlayView.prototype.undo = function () {
    if (this.busy || !this.history.length) return;
    engine.cancel();
    this.gen++;
    // Take back to the last position where it was your move.
    do {
      this.b.undo();
      this.history.pop();
    } while (this.history.length && this.b.toMove() !== this.you);
    this.hintCol = -1;
    clear(this.hintBox);
    clear(this.review);
    this.review.appendChild(el('p', { class: 'empty-note' }, 'Move taken back.'));
    this.refresh();
    this.next();
  };

  PlayView.prototype.gameOver = function () {
    var w = this.b.winner();
    this.view.setInteractive(false);
    var mine = this.history.filter(function (m, i) { return m.grade; });
    var counts = {};
    mine.forEach(function (m) { counts[m.grade.label] = (counts[m.grade.label] || 0) + 1; });
    var summary = Object.keys(counts).map(function (k) { return k + ' ' + counts[k]; }).join(' · ');
    var head = w ? (w.player === this.you ? 'You won.' : 'The coach won.') : 'Draw.';
    this.review.appendChild(el('div', { class: 'feedback ' + (w && w.player === this.you ? 'ok' : '') },
      el('h4', null, head),
      summary ? el('p', null, 'Your moves: ' + summary) : null,
      el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: this.newGame.bind(this) }, 'Play again'))));
    this.meterText.textContent = head;
    this.meterFill.style.width = w ? (w.player === 1 ? '100%' : '0%') : '50%';
    this.refresh();
  };

  // Leaving the view cancels engine work, so pick the game up again on return.
  PlayView.prototype.enter = function () {
    this.gen++;
    this.busy = false;
    this.thinking = false;
    this.analysis = null;
    this.refresh();
    this.next();
  };

  /* -------------------------------------------------------------- rules */

  function RulesView(host) {
    var cards = CUR.rules.map(function (r) {
      return el('section', { class: 'card' }, el('h3', null, r.title), el('ol', null, r.items.map(function (it) { return el('li', { html: rich(it) }); })));
    });
    var table = null;
    CUR.lessons.forEach(function (l) {
      l.steps.forEach(function (st) { if (st.table) table = st.table; });
    });
    var extra = [];
    var parity = new BoardView({ label: 'Row parity' });
    parity.show(new C4.Board(), { overlay: { fill: true }, marks: [], hint: -1 });
    extra.push(el('section', { class: 'card' }, el('h3', null, 'Who gets which rows'), parity.svg,
      p('With follow-up play the [P1] ends up on odd rows and the [P2] on even rows. Build your threats where your discs will land.')));
    if (table) {
      extra.push(el('section', { class: 'card' }, el('h3', null, 'What the solver says'),
        el('div', { class: 'table-wrap' }, el('table', { class: 'evidence' },
          el('caption', null, table.caption),
          el('thead', null, el('tr', null, table.head.map(function (h) { return el('th', { scope: 'col' }, h); }))),
          el('tbody', null, table.rows.map(function (row) {
            return el('tr', null, row.map(function (cell, i) { return i === 0 ? el('th', { scope: 'row' }, cell) : el('td', null, cell); }));
          }))))));
    }
    host.appendChild(el('div', null,
      el('p', { class: 'eyebrow' }, 'One page'),
      el('h2', { class: 'display' }, 'The rules card'),
      el('p', { class: 'rules-intro', html: rich('Everything the lessons teach, in the order you use it. Every puzzle answer in this app is proven by the built-in solver.') }),
      el('div', { class: 'rules-grid' }, cards),
      el('div', { class: 'rules-extra' }, extra)));
  }

  /* ------------------------------------------------------------- router */

  var views = {};
  var router = {
    current: null,
    go: function (name) {
      if (!views[name]) name = 'learn';
      if (location.hash !== '#' + name) {
        try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ }
      }
      this.show(name);
    },
    show: function (name) {
      if (this.current === name) return;
      engine.cancel();
      this.current = name;
      Object.keys(views).forEach(function (k) { views[k].host.hidden = k !== name; });
      document.querySelectorAll('.tab').forEach(function (t) {
        if (t.getAttribute('data-view') === name) t.setAttribute('aria-current', 'page');
        else t.removeAttribute('aria-current');
      });
      if (views[name].view.enter) views[name].view.enter();
      store.set('view', name);
    }
  };

  function boot() {
    var main = document.getElementById('main');
    [['learn', LearnView], ['puzzles', PuzzlesView], ['play', PlayView], ['rules', RulesView]].forEach(function (v) {
      var host = el('section', { id: 'view-' + v[0], hidden: true, 'aria-label': v[0] });
      main.appendChild(host);
      views[v[0]] = { host: host, view: new v[1](host) };
    });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.addEventListener('click', function (e) {
        e.preventDefault();
        router.go(t.getAttribute('data-view'));
      });
    });
    window.addEventListener('hashchange', function () { router.show(location.hash.slice(1) || 'learn'); });
    var start = location.hash.slice(1);
    router.go(views[start] ? start : store.get('view', 'learn'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
