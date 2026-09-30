/*
 * Connect Four engine: board model, threat analysis and an alpha-beta solver.
 *
 * The same source runs in the page, inside a Web Worker (the app rebuilds the
 * worker from `C4.factory.toString()`), and under Node for the puzzle checks.
 *
 * Conventions
 *   columns 0..6  shown as a..g      rows 0..5  shown as 1..6 (bottom = 1)
 *   player 1 moves first, player 2 second
 *   move strings are 1-based column digits, e.g. "4453" = d, d, e, c
 *   scores are from the side to move: > 0 good, WIN - discs for a forced win
 */
(function (root, factory) {
  var api = factory();
  api.factory = factory;
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.C4 = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLS = 7, ROWS = 6, SIZE = 42;
  var WIN = 10000;
  var MATE_MIN = WIN - 100;
  var INF = 30000;
  var FILES = 'abcdefg';
  var CENTER_ORDER = [3, 2, 4, 1, 5, 0, 6];

  var POW2 = [];
  for (var i = 0; i <= 7; i++) POW2.push(Math.pow(2, i));
  var POW128 = [];
  for (i = 0; i < 7; i++) POW128.push(Math.pow(128, i));
  var START_KEY = 0;
  for (i = 0; i < 7; i++) START_KEY += POW128[i];

  // Every line of four on the board, and the lines through each cell.
  var WINDOWS = [];
  var CELL_WINDOWS = [];
  for (i = 0; i < SIZE; i++) CELL_WINDOWS.push([]);
  (function () {
    var dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (var c = 0; c < COLS; c++) {
      for (var r = 0; r < ROWS; r++) {
        for (var d = 0; d < 4; d++) {
          var dc = dirs[d][0], dr = dirs[d][1];
          var ec = c + 3 * dc, er = r + 3 * dr;
          if (ec < 0 || ec >= COLS || er < 0 || er >= ROWS) continue;
          var w = [];
          for (var k = 0; k < 4; k++) w.push((c + k * dc) * ROWS + (r + k * dr));
          var id = WINDOWS.length;
          WINDOWS.push(w);
          for (k = 0; k < 4; k++) CELL_WINDOWS[w[k]].push(id);
        }
      }
    }
  })();

  // How many lines of four pass through each cell (the classic centre map).
  var CELL_WEIGHT = CELL_WINDOWS.map(function (l) { return l.length; });

  function sqName(c, r) { return FILES[c] + (r + 1); }
  function parseSq(s) {
    var c = FILES.indexOf(s[0]);
    var r = parseInt(s.slice(1), 10) - 1;
    return { c: c, r: r };
  }

  /* ---------------------------------------------------------------- board */

  function Board() {
    this.cells = new Int8Array(SIZE);
    this.h = new Int8Array(COLS);
    this.n = 0;
    this.hist = new Int8Array(SIZE);
    this.key = START_KEY;
    this.mkey = START_KEY;
    this.base = 0;
  }

  Board.fromMoves = function (moves) {
    var b = new Board();
    var s = String(moves || '');
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i) - 49;
      if (c < 0 || c >= COLS || !b.canPlay(c)) throw new Error('Illegal move ' + s[i] + ' at ' + i + ' in ' + s);
      if (b.winner()) throw new Error('Move after game end at ' + i + ' in ' + s);
      b.play(c);
    }
    return b;
  };

  // Build a position from a picture: six strings, top row first, using
  // X (first player), O (second player) and . (empty). Used for lesson
  // diagrams where the move order does not matter.
  Board.fromGrid = function (rows) {
    if (rows.length !== ROWS) throw new Error('Grid needs ' + ROWS + ' rows');
    var b = new Board();
    var x = 0, o = 0;
    for (var c = 0; c < COLS; c++) {
      var gap = false;
      for (var r = 0; r < ROWS; r++) {
        var ch = rows[ROWS - 1 - r][c];
        if (ch === '.') { gap = true; continue; }
        if (gap) throw new Error('Floating disc at ' + sqName(c, r));
        var p = ch === 'X' ? 1 : ch === 'O' ? 2 : 0;
        if (!p) throw new Error('Bad cell "' + ch + '" at ' + sqName(c, r));
        if (p === 1) x++; else o++;
        b.cells[c * ROWS + r] = p;
        b.key += (p === 1 ? POW2[r + 1] : POW2[r]) * POW128[c];
        b.mkey += (p === 1 ? POW2[r + 1] : POW2[r]) * POW128[6 - c];
        b.hist[b.n++] = c;
        b.h[c] = r + 1;
      }
    }
    if (x !== o && x !== o + 1) throw new Error('Disc counts do not fit alternating turns (' + x + ' X, ' + o + ' O)');
    if (b.winner()) throw new Error('Grid already contains four in a row');
    b.base = b.n;
    return b;
  };

  Board.prototype.clone = function () {
    var b = new Board();
    b.cells.set(this.cells);
    b.h.set(this.h);
    b.hist.set(this.hist);
    b.n = this.n;
    b.key = this.key;
    b.mkey = this.mkey;
    b.base = this.base;
    return b;
  };

  Board.prototype.toMove = function () { return (this.n & 1) ? 2 : 1; };
  Board.prototype.canPlay = function (c) { return this.h[c] < ROWS; };
  Board.prototype.get = function (c, r) { return this.cells[c * ROWS + r]; };
  // Moves played since the start (or since the grid a position was built from).
  Board.prototype.moves = function () {
    var s = '';
    for (var i = this.base; i < this.n; i++) s += String(this.hist[i] + 1);
    return s;
  };

  Board.prototype.toGrid = function () {
    var rows = [];
    for (var r = ROWS - 1; r >= 0; r--) {
      var line = '';
      for (var c = 0; c < COLS; c++) line += '.XO'[this.cells[c * ROWS + r]];
      rows.push(line);
    }
    return rows;
  };

  Board.prototype.play = function (c) {
    var r = this.h[c];
    var p = (this.n & 1) ? 2 : 1;
    this.cells[c * ROWS + r] = p;
    var d = p === 1 ? POW2[r + 1] : POW2[r];
    this.key += d * POW128[c];
    this.mkey += d * POW128[6 - c];
    this.h[c] = r + 1;
    this.hist[this.n] = c;
    this.n++;
    return r;
  };

  Board.prototype.undo = function () {
    this.n--;
    var c = this.hist[this.n];
    var r = this.h[c] - 1;
    var p = this.cells[c * ROWS + r];
    var d = p === 1 ? POW2[r + 1] : POW2[r];
    this.key -= d * POW128[c];
    this.mkey -= d * POW128[6 - c];
    this.cells[c * ROWS + r] = 0;
    this.h[c] = r;
    return c;
  };

  // Would a disc of player p on (c, r) complete four? Ignores whether (c, r)
  // is currently reachable, so it also finds threats higher up the board.
  function completes(cells, c, r, p) {
    var base = c * ROWS;
    if (r >= 3 && cells[base + r - 1] === p && cells[base + r - 2] === p && cells[base + r - 3] === p) return true;
    var n, cc, rr;
    // horizontal
    n = 0;
    for (cc = c - 1; cc >= 0 && cells[cc * ROWS + r] === p; cc--) n++;
    for (cc = c + 1; cc < COLS && cells[cc * ROWS + r] === p; cc++) n++;
    if (n >= 3) return true;
    // diagonal /
    n = 0;
    for (cc = c - 1, rr = r - 1; cc >= 0 && rr >= 0 && cells[cc * ROWS + rr] === p; cc--, rr--) n++;
    for (cc = c + 1, rr = r + 1; cc < COLS && rr < ROWS && cells[cc * ROWS + rr] === p; cc++, rr++) n++;
    if (n >= 3) return true;
    // diagonal \
    n = 0;
    for (cc = c - 1, rr = r + 1; cc >= 0 && rr < ROWS && cells[cc * ROWS + rr] === p; cc--, rr++) n++;
    for (cc = c + 1, rr = r - 1; cc < COLS && rr >= 0 && cells[cc * ROWS + rr] === p; cc++, rr--) n++;
    return n >= 3;
  }

  Board.prototype.completes = function (c, r, p) { return completes(this.cells, c, r, p); };
  Board.prototype.isWinningMove = function (c, p) {
    return this.h[c] < ROWS && completes(this.cells, c, this.h[c], p || this.toMove());
  };

  // Returns {player, cells:[idx...]} when someone has four, else null.
  Board.prototype.winner = function () {
    for (var w = 0; w < WINDOWS.length; w++) {
      var win = WINDOWS[w];
      var p = this.cells[win[0]];
      if (p && this.cells[win[1]] === p && this.cells[win[2]] === p && this.cells[win[3]] === p) {
        return { player: p, cells: win.slice() };
      }
    }
    return null;
  };

  Board.prototype.isFull = function () { return this.n >= SIZE; };

  /* -------------------------------------------------------- threat reading */

  // A threat is an empty square that would complete four for its owner.
  // Row parity is 1-based: rows 1, 3, 5 are odd; 2, 4, 6 are even.
  // The first player wants odd threats, the second player even threats.
  function threats(board) {
    var out = [];
    for (var c = 0; c < COLS; c++) {
      for (var r = board.h[c]; r < ROWS; r++) {
        for (var p = 1; p <= 2; p++) {
          if (completes(board.cells, c, r, p)) {
            var odd = (r % 2) === 0;
            out.push({
              c: c, r: r, player: p, sq: sqName(c, r),
              odd: odd,
              good: p === 1 ? odd : !odd,
              playable: board.h[c] === r
            });
          }
        }
      }
    }
    return out;
  }

  // Squares the side to move must not fill: the next free square in a column
  // sits directly under an opponent threat.
  function poisoned(board) {
    var me = board.toMove(), opp = 3 - me, out = [];
    for (var c = 0; c < COLS; c++) {
      var r = board.h[c];
      if (r < ROWS - 1 && completes(board.cells, c, r + 1, opp) && !completes(board.cells, c, r, me)) {
        out.push({ c: c, r: r, sq: sqName(c, r), threat: sqName(c, r + 1) });
      }
    }
    return out;
  }

  /* ------------------------------------------------------------ evaluation */

  var LINE_SCORE = [0, 1, 5, 0, 0];
  var T1 = new Uint8Array(SIZE), T2 = new Uint8Array(SIZE);

  // Static score for the side to move. Rewards open lines, and threats on the
  // row parity that suits their owner, echoing the zugzwang rules.
  function evaluate(board) {
    var cells = board.cells;
    var s = 0;
    var t1 = T1, t2 = T2;
    t1.fill(0);
    t2.fill(0);
    for (var w = 0; w < WINDOWS.length; w++) {
      var win = WINDOWS[w];
      var a = 0, b = 0, empty = -1;
      for (var k = 0; k < 4; k++) {
        var v = cells[win[k]];
        if (v === 1) a++;
        else if (v === 2) b++;
        else empty = win[k];
      }
      if (a && !b) { if (a === 3) t1[empty] = 1; else s += LINE_SCORE[a]; }
      else if (b && !a) { if (b === 3) t2[empty] = 1; else s -= LINE_SCORE[b]; }
    }
    var p1Odd = false, p2Even = false;
    for (var c = 0; c < COLS; c++) {
      var base = c * ROWS;
      var seen1 = false, seen2 = false;
      for (var r = board.h[c]; r < ROWS; r++) {
        var i1 = t1[base + r], i2 = t2[base + r];
        var odd = (r % 2) === 0;
        if (i1) {
          s += (odd ? 40 : 14) * (seen2 ? 0.4 : 1);
          if (r + 1 < ROWS && t1[base + r + 1]) s += 60;
          if (odd && !seen2) p1Odd = true;
          seen1 = true;
        }
        if (i2) {
          s -= (odd ? 16 : 40) * (seen1 ? 0.4 : 1);
          if (r + 1 < ROWS && t2[base + r + 1]) s -= 60;
          if (!odd && !seen1) p2Even = true;
          seen2 = true;
        }
      }
    }
    if (p1Odd) s += 70;
    else if (p2Even) s -= 70;
    s = Math.round(s);
    return board.n & 1 ? -s : s;
  }

  /* ---------------------------------------------------------------- search */

  var EXACT = 1, LOWER = 2, UPPER = 3;
  var ABORT = { aborted: true };

  function Searcher(ttBits) {
    this.bits = ttBits || 20;
    this.size = Math.pow(2, this.bits);
    this.tKey = new Float64Array(this.size);
    this.tVal = new Int16Array(this.size);
    this.tDepth = new Int8Array(this.size);
    this.tFlag = new Int8Array(this.size);
    this.tMove = new Int8Array(this.size);
    this.nodes = 0;
    this.deadline = Infinity;
    this.nodeLimit = Infinity;
    this.orderBuf = [];
    for (var i = 0; i < 64; i++) this.orderBuf.push({ m: new Int8Array(7), s: new Int16Array(7) });
  }

  Searcher.prototype.clear = function () {
    this.tKey.fill(0);
    this.tFlag.fill(0);
  };

  // Count lines that become one-short-of-four for p when p drops in column c.
  function newThreats(cells, h, c, p) {
    var r = h[c];
    var cell = c * ROWS + r;
    var list = CELL_WINDOWS[cell];
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      var win = WINDOWS[list[i]];
      var mine = 0, empty = -1, blocked = false;
      for (var k = 0; k < 4; k++) {
        var x = win[k];
        if (x === cell) { mine++; continue; }
        var v = cells[x];
        if (v === p) mine++;
        else if (v === 0) empty = x;
        else { blocked = true; break; }
      }
      if (!blocked && mine === 3 && empty >= 0) n++;
    }
    return n;
  }

  Searcher.prototype.negamax = function (b, depth, alpha, beta, ply) {
    this.nodes++;
    if ((this.nodes & 4095) === 0) {
      if (Date.now() > this.deadline || this.nodes > this.nodeLimit) throw ABORT;
    }
    var n = b.n;
    if (n >= SIZE) return 0;
    var cells = b.cells, h = b.h;
    var me = (n & 1) ? 2 : 1, opp = 3 - me;
    var c, i;

    for (c = 0; c < COLS; c++) {
      if (h[c] < ROWS && completes(cells, c, h[c], me)) return WIN - (n + 1);
    }
    if (n === SIZE - 1) return 0;

    var forced = -1, oppWins = 0;
    for (c = 0; c < COLS; c++) {
      if (h[c] < ROWS && completes(cells, c, h[c], opp)) { oppWins++; forced = c; }
    }
    if (oppWins > 1) return -(WIN - (n + 2));

    // Moves that do not hand the opponent a square directly above.
    var buf = this.orderBuf[ply];
    var moves = buf.m, scores = buf.s, count = 0;
    if (forced >= 0) {
      if (h[forced] + 1 < ROWS && completes(cells, forced, h[forced] + 1, opp)) return -(WIN - (n + 3));
      moves[0] = forced; count = 1;
    } else {
      for (i = 0; i < COLS; i++) {
        c = CENTER_ORDER[i];
        if (h[c] >= ROWS) continue;
        if (h[c] + 1 < ROWS && completes(cells, c, h[c] + 1, opp)) continue;
        moves[count++] = c;
      }
      if (count === 0) return -(WIN - (n + 2));
    }

    // We cannot win before our next-but-one disc, nor lose before theirs.
    var max = WIN - (n + 3);
    if (beta > max) { beta = max; if (alpha >= beta) return beta; }
    var min = -(WIN - (n + 4));
    if (alpha < min) { alpha = min; if (alpha >= beta) return alpha; }

    if (depth <= 0) {
      var e = evaluate(b);
      return e < alpha ? alpha : (e > beta ? beta : e);
    }

    var useMirror = b.mkey < b.key;
    var key = useMirror ? b.mkey : b.key;
    var slot = key % this.size;
    var ttMove = -1;
    if (this.tKey[slot] === key && this.tFlag[slot]) {
      // Depth-limited values are reused only at equal or shallower depth, but
      // a proven win or loss bound holds at any depth.
      var tv = this.tVal[slot], tf = this.tFlag[slot], deep = this.tDepth[slot] >= depth;
      if (tf === EXACT && deep) return tv;
      var lowerOk = tf !== UPPER && (deep || tv >= MATE_MIN);
      var upperOk = tf !== LOWER && (deep || tv <= -MATE_MIN);
      if (lowerOk) { if (tv >= beta) return tv; if (tv > alpha) alpha = tv; }
      if (upperOk) { if (tv <= alpha) return tv; if (tv < beta) beta = tv; }
      ttMove = this.tMove[slot] - 1;
      if (ttMove >= 0 && useMirror) ttMove = 6 - ttMove;
    }

    // Order: table move, then moves that create threats, then centre first.
    if (count > 1) {
      for (i = 0; i < count; i++) {
        c = moves[i];
        var sc = newThreats(cells, h, c, me) * 16 + (7 - i);
        if (c === ttMove) sc += 1000;
        scores[i] = sc;
      }
      for (i = 1; i < count; i++) {
        var mv = moves[i], sv = scores[i], j = i - 1;
        while (j >= 0 && scores[j] < sv) { moves[j + 1] = moves[j]; scores[j + 1] = scores[j]; j--; }
        moves[j + 1] = mv; scores[j + 1] = sv;
      }
    }

    var alpha0 = alpha;
    var best = -INF, bestMove = moves[0];
    var nextDepth = count === 1 ? depth : depth - 1;
    for (i = 0; i < count; i++) {
      c = moves[i];
      b.play(c);
      var v;
      try {
        v = -this.negamax(b, nextDepth, -beta, -alpha, ply + 1);
      } finally {
        b.undo();
      }
      if (v > best) { best = v; bestMove = c; }
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }

    this.tKey[slot] = key;
    this.tVal[slot] = best;
    this.tDepth[slot] = depth > 127 ? 127 : depth;
    this.tFlag[slot] = best <= alpha0 ? UPPER : (best >= beta ? LOWER : EXACT);
    this.tMove[slot] = (useMirror ? 6 - bestMove : bestMove) + 1;
    return best;
  };

  // Score one root move (from the mover's side) at the given depth.
  Searcher.prototype.scoreMove = function (b, c, depth, alpha, beta) {
    var me = b.toMove();
    if (completes(b.cells, c, b.h[c], me)) return WIN - (b.n + 1);
    b.play(c);
    try {
      return -this.negamax(b, depth, -beta, -alpha, 1);
    } finally {
      b.undo();
    }
  };

  function isMate(v) { return v >= MATE_MIN || v <= -MATE_MIN; }

  /*
   * analyze(board, {timeMs, maxDepth, nodeLimit})
   * Scores every legal move with iterative deepening and a full window, so the
   * coach can compare the move you chose against the best one.
   * Returns {scores:[7], best, bestScore, depth, proven, nodes}.
   */
  Searcher.prototype.analyze = function (b, opts) {
    opts = opts || {};
    var maxDepth = opts.maxDepth || 42;
    var start = Date.now();
    this.deadline = opts.timeMs ? start + opts.timeMs : Infinity;
    this.nodeLimit = opts.nodeLimit || Infinity;
    this.nodes = 0;
    var legal = [];
    for (var i = 0; i < COLS; i++) if (b.canPlay(CENTER_ORDER[i])) legal.push(CENTER_ORDER[i]);
    var result = { scores: [null, null, null, null, null, null, null], best: legal[0], bestScore: -INF, depth: 0, proven: false, nodes: 0 };
    if (!legal.length || b.winner()) return result;
    var work = b.clone();
    for (var d = 1; d <= maxDepth; d++) {
      var scores = [null, null, null, null, null, null, null];
      var best = legal[0], bestScore = -INF, proven = true;
      try {
        for (i = 0; i < legal.length; i++) {
          var c = legal[i];
          var v = this.scoreMove(work, c, d - 1, -INF, INF);
          scores[c] = v;
          if (!isMate(v)) proven = false;
          if (v > bestScore) { bestScore = v; best = c; }
        }
      } catch (err) {
        if (err !== ABORT) throw err;
        break;
      }
      result.scores = scores;
      result.best = best;
      result.bestScore = bestScore;
      result.depth = d;
      result.proven = proven || work.n + d >= SIZE;
      if (result.proven) break;
      // Once the best move is a proven win, the remaining ones only get cheaper to tell apart.
      if (bestScore >= MATE_MIN && d >= 12) break;
    }
    result.nodes = this.nodes;
    result.ms = Date.now() - start;
    return result;
  };

  /*
   * bestMove(board, {timeMs, maxDepth}) - fast root search for the opponent.
   * Returns {move, score, depth, scores} where scores holds the last depth's
   * root values (fail-hard, so only the best one is exact).
   */
  Searcher.prototype.bestMove = function (b, opts) {
    opts = opts || {};
    var maxDepth = opts.maxDepth || 42;
    var start = Date.now();
    this.deadline = opts.timeMs ? start + opts.timeMs : Infinity;
    this.nodeLimit = opts.nodeLimit || Infinity;
    this.nodes = 0;
    var work = b.clone();
    var legal = [];
    for (var i = 0; i < COLS; i++) if (work.canPlay(CENTER_ORDER[i])) legal.push(CENTER_ORDER[i]);
    var out = { move: legal[0], score: 0, depth: 0 };
    for (var d = 1; d <= maxDepth; d++) {
      var alpha = -INF, best = legal[0];
      try {
        for (i = 0; i < legal.length; i++) {
          var v = this.scoreMove(work, legal[i], d - 1, alpha, INF);
          if (v > alpha) { alpha = v; best = legal[i]; }
        }
      } catch (err) {
        if (err !== ABORT) throw err;
        break;
      }
      out.move = best; out.score = alpha; out.depth = d;
      // Search the previous best first next time.
      legal.splice(legal.indexOf(best), 1);
      legal.unshift(best);
      if (isMate(alpha) || work.n + d >= SIZE) break;
    }
    out.nodes = this.nodes;
    out.ms = Date.now() - start;
    return out;
  };

  // Exact outcome for each legal move: 1 win, 0 draw, -1 loss (for the mover).
  Searcher.prototype.solve = function (b, opts) {
    opts = opts || {};
    this.deadline = opts.timeMs ? Date.now() + opts.timeMs : Infinity;
    this.nodeLimit = opts.nodeLimit || Infinity;
    this.nodes = 0;
    var work = b.clone();
    var out = [null, null, null, null, null, null, null];
    for (var c = 0; c < COLS; c++) {
      if (!work.canPlay(c)) continue;
      var v = this.scoreMove(work, c, 64, -1, 1);
      out[c] = v > 0 ? 1 : (v < 0 ? -1 : 0);
    }
    return out;
  };

  // Plies until the game ends for a mate score, seen from the side to move.
  function mateIn(score, n) {
    if (score >= MATE_MIN) return Math.ceil(((WIN - score) - n) / 2);
    if (score <= -MATE_MIN) return Math.ceil(((WIN + score) - n) / 2);
    return null;
  }

  return {
    COLS: COLS, ROWS: ROWS, SIZE: SIZE, WIN: WIN, MATE_MIN: MATE_MIN, FILES: FILES,
    WINDOWS: WINDOWS, CELL_WEIGHT: CELL_WEIGHT,
    Board: Board, Searcher: Searcher,
    completes: completes, threats: threats, poisoned: poisoned, evaluate: evaluate,
    newThreats: newThreats, isMate: isMate, mateIn: mateIn,
    sqName: sqName, parseSq: parseSq
  };
});
