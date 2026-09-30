// Proves every claim the curriculum makes with the solver.
// Run with: node connect4-coach/tests/strategy.test.js
'use strict';
const assert = require('assert');
const C4 = require('../engine.js');
const S = require('../strategy.js');

const searcher = new C4.Searcher(22);
const FILES = 'abcdefg';
let checks = 0;

function board(pos) {
  return pos.includes('/') ? C4.Board.fromGrid(pos.split('/')) : C4.Board.fromMoves(pos);
}
function sorted(a) { return a.slice().sort(); }
function outcomeName(b, v) {
  // v is the result for the side to move: 1 win, 0 draw, -1 loss
  if (v === 0) return 'draw';
  const mover = b.toMove() === 1 ? 'first' : 'second';
  const other = mover === 'first' ? 'second' : 'first';
  return v > 0 ? mover : other;
}
function exact(b) {
  const res = searcher.solve(b, { timeMs: 120000 });
  return { res, best: Math.max(...res.filter(v => v !== null)) };
}
function squaresIn(text) {
  return (String(text).match(/\{([^}]+)\}/g) || []).map(t => t.slice(1, -1));
}
function checkText(where, ...texts) {
  for (const t of texts.flat()) {
    for (const sq of squaresIn(t)) {
      assert.ok(/^[a-g][1-6]$/.test(sq), where + ': bad square token {' + sq + '}');
    }
  }
}
function youAre(prompt) {
  if (/You are the \[P1\]/.test(prompt)) return 1;
  if (/You are the \[P2\]/.test(prompt)) return 2;
  return 0;
}

function checkPuzzle(p, where) {
  const b = board(p.pos);
  assert.strictEqual(b.winner(), null, where + ': position already decided');
  const who = youAre(p.prompt);
  if (who) assert.strictEqual(b.toMove(), who, where + ': prompt says player ' + who + ' but player ' + b.toMove() + ' is to move');
  const sol = p.solutions.map(ch => FILES.indexOf(ch));
  sol.forEach(c => assert.ok(c >= 0 && b.canPlay(c), where + ': solution ' + FILES[c] + ' is not playable'));
  Object.keys(p.wrong || {}).forEach(ch => {
    const c = FILES.indexOf(ch);
    assert.ok(c >= 0 && b.canPlay(c), where + ': wrong-answer note for unplayable column ' + ch);
    assert.ok(!p.solutions.includes(ch), where + ': column ' + ch + ' is both right and wrong');
  });
  checkText(where, p.prompt, p.explain, p.hint || '', Object.values(p.wrong || {}));

  let found;
  if (p.goal === 'win') {
    const { res } = exact(b);
    found = res.map((v, c) => (v === 1 ? FILES[c] : null)).filter(Boolean);
  } else if (p.goal === 'save') {
    const { res } = exact(b);
    found = res.map((v, c) => (v !== null && v >= 0 ? FILES[c] : null)).filter(Boolean);
  } else if (p.goal === 'mate') {
    assert.ok(p.within >= 1, where + ': mate puzzle needs `within`');
    const a = searcher.analyze(b, { maxDepth: 2 * p.within + 2 });
    found = a.scores.map((v, c) => (v !== null && v >= C4.MATE_MIN && C4.mateIn(v, b.n) <= p.within ? FILES[c] : null)).filter(Boolean);
  } else if (p.goal === 'theory') {
    assert.ok(p.source, where + ': theory puzzle needs a source');
    found = p.solutions;
  } else {
    assert.fail(where + ': unknown goal ' + p.goal);
  }
  assert.deepStrictEqual(sorted(found), sorted(p.solutions), where + ': solutions do not match the solver');
  checks++;
}

function checkDiagram(step, where) {
  const b = board(step.pos);
  assert.strictEqual(b.winner(), null, where + ': position already decided');
  checkText(where, step.text || [], step.table ? step.table.caption : '');
  (step.marks || []).forEach(m => assert.ok(/^[a-g][1-6]$/.test(m.sq), where + ': bad mark ' + m.sq));
  if (step.expect) {
    const { best } = exact(b);
    assert.strictEqual(outcomeName(b, best), step.expect, where + ': expected ' + step.expect);
  }
  checks++;
}

function checkLine(step, where) {
  const b = board(step.pos);
  assert.strictEqual(step.notes.length, step.line.length, where + ': one note per move');
  for (const ch of step.line) {
    assert.strictEqual(b.winner(), null, where + ': move after the game ended');
    const c = +ch - 1;
    assert.ok(b.canPlay(c), where + ': illegal move ' + ch);
    b.play(c);
  }
  checkText(where, step.text || [], step.notes);
  checks++;
}

function checkQuiz(step, where) {
  const b = board(step.pos);
  const { best } = exact(b);
  assert.strictEqual(outcomeName(b, best), step.answer, where + ': quiz answer disagrees with the solver');
  assert.ok(step.options.some(o => o.id === step.answer), where + ': answer is not an option');
  checkText(where, step.question, step.explain);
  checks++;
}

// Follow-up demo: with every column even and the first player to move, the
// second player answering on top gets every even square. Show that this fill
// gives the second player four and the first player none, then play it out.
function checkFollowupDemo(step, where) {
  const b = board(step.pos);
  assert.strictEqual(b.toMove(), step.you, where + ': demo expects the reader to move first');
  assert.strictEqual(step.you, 1, where + ': follow-up demo is for the first player');
  for (let c = 0; c < 7; c++) assert.strictEqual((6 - b.h[c]) % 2, 0, where + ': column ' + FILES[c] + ' has an odd number of empty squares');
  const f = b.clone();
  for (let c = 0; c < 7; c++) for (let r = f.h[c]; r < 6; r++) f.cells[c * 6 + r] = r % 2 === 0 ? 1 : 2;
  let x = false, o = false;
  for (const w of C4.WINDOWS) {
    const p = f.cells[w[0]];
    if (p && w.every(i => f.cells[i] === p)) { if (p === 1) x = true; else o = true; }
  }
  assert.ok(!x, where + ': follow-up fill gives the first player four');
  assert.ok(o, where + ': follow-up fill gives the second player no four');
  let seed = 99;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let g = 0; g < 500; g++) {
    const t = b.clone();
    let result = null;
    while (!result) {
      const legal = [];
      for (let c = 0; c < 7; c++) if (t.canPlay(c)) legal.push(c);
      const c = legal[Math.floor(rand() * legal.length)];
      t.play(c);
      if (t.winner()) { result = 'first'; break; }
      t.play(c); // follow-up: same column
      if (t.winner()) result = 'second';
      else if (t.isFull()) result = 'draw';
    }
    assert.strictEqual(result, 'second', where + ': follow-up failed in a random game');
  }
  checkText(where, step.text || [], Object.values(step.outcomes || {}));
  checks++;
}

function checkStep(step, where) {
  if (step.kind === 'puzzle') checkPuzzle(step, where);
  else if (step.kind === 'diagram') checkDiagram(step, where);
  else if (step.kind === 'line') checkLine(step, where);
  else if (step.kind === 'quiz') checkQuiz(step, where);
  else if (step.kind === 'demo') checkFollowupDemo(step, where);
  else assert.fail(where + ': unknown step kind ' + step.kind);
}

const ids = new Set();
S.lessons.forEach((lesson, i) => {
  assert.ok(!ids.has(lesson.id), 'duplicate lesson id ' + lesson.id);
  ids.add(lesson.id);
  lesson.steps.forEach((step, j) => {
    const where = 'lesson ' + (i + 1) + ' (' + lesson.id + ') step ' + (j + 1) + ' "' + step.title + '"';
    if (step.id) { assert.ok(!ids.has(step.id), 'duplicate id ' + step.id); ids.add(step.id); }
    checkStep(step, where);
    console.log('ok  ' + where);
  });
});
S.practice.forEach(p => {
  assert.ok(!ids.has(p.id), 'duplicate id ' + p.id);
  ids.add(p.id);
  const where = 'practice "' + p.title + '"';
  checkPuzzle(p, where);
  console.log('ok  ' + where);
});
S.rules.forEach(r => checkText('rules ' + r.title, r.items));

// Numbers quoted in the centre lesson.
assert.strictEqual(C4.CELL_WEIGHT[0], 3, 'corner square line count');
assert.strictEqual(C4.CELL_WEIGHT[3 * 6 + 2], 13, 'd3 line count');
assert.strictEqual(C4.CELL_WEIGHT[3 * 6 + 3], 13, 'd4 line count');
// Square count quoted in the zugzwang lesson.
{
  const b = board('34537514');
  let free = 0;
  for (let c = 0; c < 7; c++) if (c !== 1 && c !== 5) free += 6 - b.h[c];
  assert.strictEqual(free, 22, 'free squares outside b and f');
}
checks += 2;
console.log(checks + ' curriculum checks passed');
