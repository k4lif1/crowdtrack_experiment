# Four in a Row Coach

A browser app that teaches competitive four-in-a-row (Connect Four) strategy:
ten step-by-step lessons, 20 puzzles, a coach you can play against that grades
each of your moves, and a one-page rules card.

No build step and no dependencies. Open `index.html` through any static server
(for example `npx http-server connect4-coach`), or visit `/connect4-coach/` on
the repo's GitHub Pages site.

## What it teaches

1. **Check before you drop**: win, block, and what lands on top of your disc.
2. **Own the centre**: why the first move is d1 (the game is solved; d wins).
3. **Double threats**: two playable threats cannot both be blocked.
4. **Poisoned squares**: never fill the square under an enemy threat, or your own.
5. **Stacked threats and the 7**: threats on top of each other win outright.
6. **Odd and even rows**: zugzwang, and why the first player wants odd threats
   and the second player even ones.
7. **Follow-up (claimeven)**: the second player answers on top and keeps the even squares.
8. **The odd threat**: the first player's plan against follow-up.
9. **Threat showdowns**: odd against even, and the lower threat in one column.
10. **Game plans**: the whole strategy for each side.

## Files

| File | What it holds |
| --- | --- |
| `strategy.js` | The curriculum: every lesson, position, puzzle and rules-card line. Edit this to change what the app teaches. The format is documented at the top of the file. |
| `engine.js` | Board model, threat reading and an alpha-beta solver with a transposition table. Runs in the page, in a Web Worker, and under Node. |
| `app.js` | The interface: board renderer, lessons, puzzles, the coach, and the rules card. |
| `styles.css` | Light and dark themes. |
| `build.js` | Inlines everything into one HTML file: `node connect4-coach/build.js out.html` |

## Checking the curriculum

Every puzzle answer, quiz answer and "who wins here" claim is proven with the
solver, so edits to `strategy.js` cannot quietly teach something wrong:

```sh
node connect4-coach/tests/engine.test.js     # rules, threats, solver vs brute force
node connect4-coach/tests/strategy.test.js   # every lesson and puzzle claim
```

Puzzle goals: `win` (the listed moves are exactly the winning ones), `mate`
(exactly the moves that win within `within` moves), `save` (exactly the moves
that do not lose) and `theory` (known opening results the solver cannot reach
from an empty board, with a `source`).

The win-rate table in lesson 9 comes from 2,148 positions (14 or more discs)
taken from the engine's own noisy self-play and solved exactly.
