// Engine checks: rules, threat reading, and the solver against brute force.
// Run with: node connect4-coach/tests/engine.test.js
'use strict';
const assert = require('assert');
const C4 = require('../engine.js');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok  ' + name);
}

// Plain minimax with no pruning or table: the reference result.
function bruteForce(b) {
  const me = b.toMove();
  let best = -2;
  let any = false;
  for (let c = 0; c < 7; c++) {
    if (!b.canPlay(c)) continue;
    any = true;
    if (b.isWinningMove(c, me)) return 1;
  }
  if (!any) return 0;
  for (let c = 0; c < 7; c++) {
    if (!b.canPlay(c)) continue;
    b.play(c);
    const v = b.isFull() ? 0 : (0 - bruteForce(b)) || 0;
    b.undo();
    if (v > best) best = v;
    if (best === 1) break;
  }
  return best;
}

// Deterministic pseudo-random numbers so failures reproduce.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomPosition(rand, discs) {
  for (;;) {
    const b = new C4.Board();
    let ok = true;
    while (b.n < discs) {
      const legal = [];
      for (let c = 0; c < 7; c++) if (b.canPlay(c) && !b.isWinningMove(c)) legal.push(c);
      if (!legal.length) { ok = false; break; }
      b.play(legal[Math.floor(rand() * legal.length)]);
      if (b.winner()) { ok = false; break; }
    }
    if (ok) return b;
  }
}

test('fromMoves builds the expected stacks', () => {
  const b = C4.Board.fromMoves('4453');
  assert.strictEqual(b.get(3, 0), 1);
  assert.strictEqual(b.get(3, 1), 2);
  assert.strictEqual(b.get(4, 0), 1);
  assert.strictEqual(b.get(2, 0), 2);
  assert.strictEqual(b.toMove(), 1);
  assert.strictEqual(b.moves(), '4453');
});

test('illegal move strings are rejected', () => {
  assert.throws(() => C4.Board.fromMoves('1111111'));
  assert.throws(() => C4.Board.fromMoves('12121212'));
});

test('winner finds horizontal, vertical and diagonal fours', () => {
  assert.strictEqual(C4.Board.fromMoves('1122334').winner().player, 1);
  assert.strictEqual(C4.Board.fromMoves('1212121').winner().player, 1);
  assert.strictEqual(C4.Board.fromMoves('121212').winner(), null);
  // Diagonal a1 b2 c3 d4 for the first player.
  const d = C4.Board.fromMoves('12233434474');
  assert.strictEqual(d.winner().player, 1);
});

test('undo restores keys exactly', () => {
  const b = C4.Board.fromMoves('4453');
  const k = b.key, m = b.mkey;
  b.play(6); b.play(0); b.undo(); b.undo();
  assert.strictEqual(b.key, k);
  assert.strictEqual(b.mkey, m);
});

test('mirror key of a position equals key of its mirror image', () => {
  const b = C4.Board.fromMoves('4453612');
  const mirror = C4.Board.fromMoves('4435276');
  assert.strictEqual(b.mkey, mirror.key);
});

test('threats report parity from the owner\'s point of view', () => {
  // First player: b1 c1 d1, second player stacked on top.
  const b = C4.Board.fromMoves('223344');
  const t = C4.threats(b).filter(x => x.player === 1);
  const squares = t.map(x => x.sq).sort();
  assert.deepStrictEqual(squares, ['a1', 'e1']);
  assert.ok(t.every(x => x.odd && x.good && x.playable));
});

test('poisoned squares sit directly under an opponent threat', () => {
  // Second player holds c2 d2 e2; b1 and f1 are still empty.
  const b = C4.Board.fromMoves('34537514');
  const opp = C4.threats(b).filter(x => x.player === 2).map(x => x.sq).sort();
  assert.deepStrictEqual(opp, ['b2', 'f2']);
  assert.deepStrictEqual(C4.poisoned(b).map(x => x.sq).sort(), ['b1', 'f1']);
});

test('solver matches brute force on random endgames', () => {
  const rand = rng(12345);
  const s = new C4.Searcher(18);
  for (let i = 0; i < 60; i++) {
    const b = randomPosition(rand, 28 + Math.floor(rand() * 6));
    const res = s.solve(b);
    for (let c = 0; c < 7; c++) {
      if (!b.canPlay(c)) continue;
      let expect;
      if (b.isWinningMove(c)) expect = 1;
      else {
        b.play(c);
        expect = b.isFull() ? 0 : (0 - bruteForce(b)) || 0;
        b.undo();
      }
      assert.strictEqual(res[c], expect, 'position ' + b.moves() + ' move ' + (c + 1));
    }
  }
});

test('analyze scores agree in sign with the exact solver when proven', () => {
  const rand = rng(777);
  const s = new C4.Searcher(18);
  for (let i = 0; i < 25; i++) {
    const b = randomPosition(rand, 30);
    const a = s.analyze(b, { maxDepth: 42 });
    const exact = s.solve(b);
    for (let c = 0; c < 7; c++) {
      if (exact[c] === null) continue;
      const v = a.scores[c];
      const sign = v >= C4.MATE_MIN ? 1 : v <= -C4.MATE_MIN ? -1 : 0;
      assert.strictEqual(sign, exact[c], 'position ' + b.moves() + ' move ' + (c + 1));
    }
  }
});

test('bestMove takes an immediate win and blocks a forced loss', () => {
  const s = new C4.Searcher(16);
  assert.strictEqual(s.bestMove(C4.Board.fromMoves('112233'), { maxDepth: 6 }).move, 3);
  assert.strictEqual(s.bestMove(C4.Board.fromMoves('1122335'), { maxDepth: 6 }).move, 3);
});

console.log(passed + ' engine checks passed');
