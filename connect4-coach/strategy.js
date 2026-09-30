/*
 * The strategy curriculum. Edit this file to change what the app teaches.
 *
 * Positions (`pos`) are either a move string of 1-based columns ("4453" is
 * d, d, e, c) or a picture: six rows, top row first, joined by "/", with
 * X = first player, O = second player, . = empty.
 *
 * Text supports **bold**, {d3} square chips (hover to light the square on the
 * board), [P1] / [P2] player chips, and blank-line-free paragraphs as arrays.
 *
 * Step kinds
 *   diagram  a board with optional marks and overlays, plus text
 *   line     a sequence of moves the reader steps through, one note per move
 *   puzzle   find the move; goals are checked by tests/strategy.test.js:
 *              win    solutions = every move that wins with perfect play
 *              mate   solutions = every move that wins within `within` moves
 *              save   solutions = every move that does not lose
 *              theory known result, not re-solved here (see `source`)
 *   demo     play it out against a scripted opponent
 *   quiz     pick who wins; `answer` is checked against the solver
 *
 * Overlays: threats, poison (squares the side to move must avoid),
 * weights (lines through each square), fill (follow-up ownership: odd rows to
 * the first player, even rows to the second).
 */
(function (root) {
  var STRATEGY = {
    lessons: [
      {
        id: 'check',
        title: 'Check before you drop',
        short: 'Three questions before every move.',
        steps: [
          {
            kind: 'diagram',
            title: 'How to read the board',
            pos: '34537514',
            overlay: { threats: true, poison: true },
            text: [
              'Columns are lettered **a–g**, rows numbered **1–6** from the bottom, so {d1} is the centre of the bottom row. The strip on the left marks odd rows in the [P1] colour and even rows in the [P2] colour. That matters later.',
              'A ring marks a **threat**: an empty square that would complete four. Its colour tells you whose it is. Here the [P2] has threats on {b2} and {f2}.',
              'A cross marks a **poisoned square** for the player to move. {b1} and {f1} sit right under the opponent’s threats. Drop there and the opponent lands on top and wins.'
            ]
          },
          {
            kind: 'diagram',
            title: 'The three checks',
            pos: '......./......./......./.O..XO./.O.XOX./XOXOXOX',
            text: [
              'Strong players run the same checks before every move, in this order:',
              '**1. Can I win right now?** Look for a square that completes four for you. Diagonals are the ones people miss.',
              '**2. Must I block?** Look for a square that completes four for your opponent and is playable now.',
              '**3. What lands on top?** Your disc raises the column by one. If the square above yours is your opponent’s winning square, you have just handed it over.',
              'Try the first check on this position before you move on.'
            ]
          },
          {
            kind: 'puzzle',
            id: 'win-before-block',
            title: 'Win before you block',
            pos: '......./......./......./.O..XO./.O.XOX./XOXOXOX',
            prompt: 'You are the [P1]. Your opponent threatens {b4}. What do you play?',
            goal: 'mate', within: 1,
            solutions: ['f'],
            hint: 'Check your own lines first, including the diagonals.',
            explain: '{f4} completes the diagonal {c1}–{d2}–{e3}–{f4}. A win on the board beats any block, so check your own four first.',
            wrong: {
              b: 'Blocking {b4} is natural, and you would still stand well, but {f4} wins on the spot. Always look for your own four before you block.'
            }
          },
          {
            kind: 'puzzle',
            id: 'find-the-block',
            title: 'Find the block',
            pos: '......./......./......./...OX../..OXX../OOXXO..',
            prompt: 'No win for you this time. Something needs blocking. Find it.',
            goal: 'save',
            solutions: ['e'],
            hint: 'Follow the [P2] discs diagonally up and to the right.',
            explain: 'The diagonal {b1}–{c2}–{d3} points at {e4}, and {e4} is playable right now. It is the only move that does not lose.'
          }
        ]
      },

      {
        id: 'centre',
        title: 'Own the centre',
        short: 'Why every strong game starts in column d.',
        steps: [
          {
            kind: 'diagram',
            title: 'Count the lines',
            pos: '',
            overlay: { weights: true },
            text: [
              'Each number is how many lines of four pass through that square. A corner square is part of only **3** lines. {d3} and {d4} are part of **13**.',
              'More lines means more ways to build threats and more ways to spoil your opponent’s. Discs in the centre column also split the board, so every horizontal line of four has to pass through column d.'
            ]
          },
          {
            kind: 'puzzle',
            id: 'first-move',
            title: 'The first move',
            pos: '',
            prompt: 'You are the [P1] on an empty board. Where do you start?',
            goal: 'theory',
            source: 'Connect Four was solved in 1988 (James D. Allen; Victor Allis): the first player wins by starting in the centre column.',
            solutions: ['d'],
            explain: '{d1}. The game has been solved: with perfect play the [P1] wins by starting in the centre. Starting in c or e only draws, and starting in a, b, f or g loses.',
            wrong: {
              c: 'With perfect play from both sides, starting in c leads to a draw. Only d wins.',
              e: 'With perfect play from both sides, starting in e leads to a draw. Only d wins.',
              a: 'Starting in a loses against perfect play. Edge discs join very few lines.',
              b: 'Starting in b loses against perfect play.',
              f: 'Starting in f loses against perfect play.',
              g: 'Starting in g loses against perfect play. Edge discs join very few lines.'
            }
          },
          {
            kind: 'diagram',
            title: 'Answering in the centre',
            pos: '44',
            text: [
              'As the [P2], do not give up the centre. The usual reply to {d1} is {d2}, stacking straight on top.',
              'For both players the opening rule is the same: build in the middle three columns, and treat an edge disc as something you need a concrete reason for.'
            ]
          }
        ]
      },

      {
        id: 'double',
        title: 'Double threats',
        short: 'Two threats at once cannot both be blocked.',
        steps: [
          {
            kind: 'line',
            title: 'The open three',
            pos: '4433',
            line: '215',
            text: [
              'One threat can be blocked. Two playable threats at once cannot. Step through the moves to see the most basic version.'
            ],
            notes: [
              'The [P1] plays {b1}: now {b1}–{c1}–{d1} is open at both ends, so {a1} and {e1} both win.',
              'The [P2] blocks {a1}.',
              '{e1} completes four. The block on one side left the other side open.'
            ]
          },
          {
            kind: 'puzzle',
            id: 'vertical-and-diagonal',
            title: 'Vertical plus diagonal',
            pos: '45452553',
            prompt: 'You are the [P1]. One move creates two threats at once. Find it.',
            goal: 'mate', within: 2,
            solutions: ['d'],
            hint: 'Your column d stack is two high. What else passes through {d3}?',
            explain: '{d3} makes three in a column, so {d4} wins, and it also completes {b1}–?–{d3}–{e4}, so {c2} wins. Both squares are playable. Your opponent can block only one.'
          }
        ]
      },

      {
        id: 'poison',
        title: 'Poisoned squares',
        short: 'Never fill the square under a threat.',
        steps: [
          {
            kind: 'diagram',
            title: 'The square underneath',
            pos: '34537514',
            overlay: { threats: true, poison: true },
            text: [
              'Discs fall, so a threat high up the board only matters once the column reaches it. The square directly beneath a threat is the dangerous one: whoever fills it lets the other player drop onto the threat.',
              'Here the [P2] has threats on {b2} and {f2}. For the [P1], {b1} and {f1} are poison.',
              'The same trap works in reverse: do not fill the square under **your own** threat either. That lets your opponent block it.'
            ]
          },
          {
            kind: 'puzzle',
            id: 'tempting-three',
            title: 'The tempting three',
            pos: '46337674',
            prompt: 'You are the [P1]. {e1} would give you three in a row. Find the fastest win instead.',
            goal: 'mate', within: 2,
            solutions: ['b'],
            hint: 'Look at the square above {e1} before you play it.',
            explain: '{b1} makes {b1}–{c1}–{d1} with {a1} and {e1} both open: a double threat. {e1} itself would have been poison, because the [P2] drops onto {e2} and completes {c2}–{d2}–{e2}–{f2}.',
            wrong: {
              e: 'Poison. {e1} sits right under the [P2]’s threat on {e2}. They drop onto it and win.',
              g: '{g3} wins as well, but it takes a move longer. {b1} wins in two.'
            }
          }
        ]
      },

      {
        id: 'seven',
        title: 'Stacked threats and the 7',
        short: 'Two threats on top of each other win outright.',
        steps: [
          {
            kind: 'diagram',
            title: 'The 7',
            pos: '......./......./......./XXX..../OXO..../XOOXOXO',
            overlay: { threats: true },
            marks: [
              { sq: 'a3', kind: 'ring' }, { sq: 'b3', kind: 'ring' }, { sq: 'c3', kind: 'ring' },
              { sq: 'b2', kind: 'ring' }, { sq: 'a1', kind: 'ring' }
            ],
            expect: 'first',
            text: [
              'Two threats directly on top of each other in one column win almost regardless of parity. Once the column reaches them, the opponent has to block the lower one and you take the upper one.',
              'The classic way to build them is **the 7**: a bar of three ({a3}–{b3}–{c3}) with a diagonal stem from its end ({c3}–{b2}–{a1}). The bar points at {d3}, the stem at {d4}.',
              'The [P2] is to move and is already lost. Step through the next page to see why.'
            ]
          },
          {
            kind: 'line',
            title: 'Cashing in the 7',
            pos: '......./......./......./XXX..../OXO..../XOOXOXO',
            line: '5444',
            text: ['Watch column d.'],
            notes: [
              'The [P2] plays elsewhere. {d2} would hand over {d3} at once.',
              'The [P1] plays {d2} and threatens {d3}.',
              'The [P2] has to block {d3}...',
              '...and {d4} completes the stem {a1}–{b2}–{c3}–{d4}.'
            ]
          },
          {
            kind: 'puzzle',
            id: 'build-the-stack',
            title: 'Build the stack',
            pos: '4434443533',
            prompt: 'You are the [P1]. Find the move that makes two threats in the same column.',
            goal: 'mate', within: 2,
            solutions: ['a'],
            hint: 'An edge move can be right when it finishes two lines at once.',
            explain: '{a1} threatens {b1} along the bottom row and {b2} along the diagonal {a1}–{b2}–{c3}–{d4}. They are stacked in column b: your opponent must block {b1}, and that lifts you onto {b2}.'
          },
          {
            kind: 'puzzle',
            id: 'second-player-stack',
            title: 'The same trick as second player',
            pos: '41344475254',
            prompt: 'You are the [P2]. Win in two moves.',
            goal: 'mate', within: 2,
            solutions: ['b'],
            hint: 'Look for a square that joins your row-2 pair and your long diagonal.',
            explain: '{b2} threatens {c2} along row 2 and {c3} along {a1}–{b2}–{c3}–{d4}. Your opponent blocks {c2}, and you drop onto {c3}.'
          }
        ]
      },

      {
        id: 'parity',
        title: 'Odd and even rows',
        short: 'Zugzwang decides most expert games.',
        steps: [
          {
            kind: 'diagram',
            title: 'Zugzwang: you cannot pass',
            pos: '34537514',
            overlay: { threats: true, poison: true },
            expect: 'second',
            text: [
              'There is no passing in Connect Four. Late in a game the safe squares run out, and someone has to play under an enemy threat. That is **zugzwang**, and most expert games are decided by it.',
              'The [P2] owns {b2} and {f2}, so the [P1] can never touch {b1} or {f1}. The other 22 empty squares get used up two at a time, and the [P1] moves first, so they are the one left to step on a poisoned square.',
              'The solver agrees: eight discs in, this is already lost for the [P1].'
            ]
          },
          {
            kind: 'diagram',
            title: 'Who gets which rows',
            pos: '',
            overlay: { fill: true },
            text: [
              'When the board fills up and neither side can safely break the pattern, the [P1] tends to end up with the **odd** rows (1, 3, 5) and the [P2] with the **even** rows (2, 4, 6). The next two lessons show exactly why.',
              'That gives each side a target. **[P1]: threats on odd rows.** **[P2]: threats on even rows.** A threat on the wrong parity usually never gets filled in your favour.',
              'Look back at the last position: {b2} and {f2} are both on row 2. Even, which is exactly what the [P2] wanted.'
            ]
          },
          {
            kind: 'puzzle',
            id: 'make-it-odd',
            title: 'Make it odd',
            pos: '5452431532234344',
            prompt: 'You are the [P1]. Your only threat, {f2}, is on an even row. One move wins; three others only draw.',
            goal: 'win',
            solutions: ['e'],
            hint: 'Look for a diagonal that ends on row 5.',
            explain: '{e4} completes {c2}–{d3}–{e4} and points at {f5}, on row 5. That is an odd threat, the first player’s kind, and the [P2] has no even threat anywhere to answer it. Now zugzwang works for you.',
            wrong: {
              b: 'This keeps the balance but does not create an odd threat. The solver rates it a draw.',
              c: 'A draw with best play. You need a threat on an odd row.',
              d: 'A draw with best play. You need a threat on an odd row.'
            }
          }
        ]
      },

      {
        id: 'followup',
        title: 'Follow-up: the second player’s weapon',
        short: 'Answer in the same column and the even squares are yours.',
        steps: [
          {
            kind: 'diagram',
            title: 'Answer on top',
            pos: '...O.../...O.../...XXO./...OOX./XOXXOOX/XXOOXOX',
            overlay: { threats: true, fill: true },
            expect: 'second',
            text: [
              'It is the [P1]’s move, and every column has an **even** number of empty squares. So the next free square in each column is on an odd row.',
              'The [P2] now has a simple plan called **follow-up** (also known as claimeven): whenever the [P1] drops a disc, answer on top of it in the same column. The [P1] gets every odd square, and the [P2] gets every even square.',
              'The faded discs show where that ends. The [P2]’s threat on {c4} is even, so it will be theirs. The [P1] never assembles four, because odd squares alone rarely line up.'
            ]
          },
          {
            kind: 'demo',
            title: 'Try to escape',
            pos: '...O.../...O.../...XXO./...OOX./XOXXOOX/XXOOXOX',
            you: 1,
            bot: 'followup',
            overlay: { threats: true },
            text: [
              'You are the [P1]. Your opponent will answer every move in the same column you just played. Try to keep them off {c4}.'
            ],
            outcomes: {
              loss: 'Follow-up wins. Every even square went to the [P2], including {c4}, and you ran out of safe moves.',
              draw: 'A draw. Follow-up should have won here; please report the line you played.',
              win: 'You won. Follow-up should not allow that here; please report the line you played.'
            }
          },
          {
            kind: 'puzzle',
            id: 'keep-following',
            title: 'Keep following',
            pos: '5473733452121224437747311',
            prompt: 'You are the [P2] and own an even threat on {e4}. The [P1] has just played {a4}. Find the only move that keeps the win.',
            goal: 'win',
            solutions: ['a'],
            hint: 'Where did your opponent just play?',
            explain: '{a5}: answer on top. It keeps the parity count in your favour, so the [P1] will eventually have to play {e3} and give you {e4}. The solver finds that every other move loses.'
          },
          {
            kind: 'diagram',
            title: 'Where follow-up breaks',
            pos: '.O...../.O...../OXO..../XXO..../OOXOXXX/OXOOXXX',
            overlay: { threats: true, fill: true },
            expect: 'first',
            text: [
              'Follow-up hands the [P1] every odd square. That is its weak spot.',
              'Every column here has an even number of empty squares, and the [P2] even owns an even threat on {d4}. But the fill shows the problem: following up would give the [P1] {d3}, {e3}, {f3} and {g3}, four in a row on row 3. The [P1] starts with {e3}, {f3} or {g3} and wins.',
              'A [P1] threat on an odd row breaks follow-up the same way: follow-up would hand over that square too. The [P2] has to deviate, and that costs them the parity. That is the first player’s whole plan, in the next lesson.'
            ]
          }
        ]
      },

      {
        id: 'oddthreat',
        title: 'The odd threat: the first player’s plan',
        short: 'One good odd threat is usually enough.',
        steps: [
          {
            kind: 'diagram',
            title: 'Why one odd threat is enough',
            pos: '444243213353342276772774326',
            overlay: { threats: true, poison: true },
            expect: 'first',
            text: [
              'The [P1] has just created a threat on {e3}. Row 3 is odd, and the [P2] has no even threat below it.',
              'Now the counting runs the other way. The [P2] can never play {e2}, and when the other squares run out it is the [P2] who has to move. Every reply here loses.',
              'The [P1]’s plan in one line: **make one odd threat, keep the opponent from getting an even threat underneath it, then play safe moves and let zugzwang finish the job.**'
            ]
          },
          {
            kind: 'puzzle',
            id: 'the-only-winner',
            title: 'The only winner',
            pos: '46424472262577227445',
            prompt: 'You are the [P1]. There are no threats on the board. Every move but one leads to a draw. Find the one that wins.',
            goal: 'win',
            solutions: ['e'],
            hint: 'Row 3 already holds two of your discs with a gap between them.',
            explain: '{e3} joins {b3} and {d3} and leaves {c3} as your winning square. Column c is still empty, so nobody can reach {c3} soon, and row 3 is odd. The [P2] has no even threat to fight with, so the zugzwang is yours.'
          },
          {
            kind: 'puzzle',
            id: 'dont-fill-under',
            title: 'Keep the tempo',
            pos: '.XOXXO./.OXOXO./.OXOOO./.XXXOX./.OOXOX./XXOOXOX',
            prompt: 'You are the [P1]. Only columns a and g have room. You own the odd threat on {a3}; your opponent owns the even threat on {g4}. Which move keeps control?',
            goal: 'win',
            solutions: ['g'],
            hint: 'Filling the square under your own threat lets them block it.',
            explain: '{g2}. Now nine squares remain and the [P2] must move: {a2} hands you {a3}, and {g3} lets you block {g4}, after which they are the one forced to play {a2}.',
            wrong: {
              a: '{a2} fills the square under your own threat. Your opponent blocks {a3}, and their {g4} threat takes over.'
            }
          }
        ]
      },

      {
        id: 'showdown',
        title: 'Threat showdowns',
        short: 'When both sides have threats, who wins?',
        steps: [
          {
            kind: 'quiz',
            title: 'Odd against even',
            pos: '.OOXXO./.OXOXX./.OXOOO./.XXXOX./.XOXOXX/OXOOXXO',
            overlay: { threats: true },
            question: 'The [P1] owns an odd threat on {a3}. The [P2] owns an even threat on {g4}, in a different column. The [P2] is to move. Who wins with best play?',
            options: [
              { id: 'first', label: 'First player' },
              { id: 'second', label: 'Second player' },
              { id: 'draw', label: 'Draw' }
            ],
            answer: 'first',
            explain: 'The first player’s odd threat wins. The [P2] has to play {a2} (handing over {a3}) or {g3} (after which the [P1] blocks {g4} and the [P2] is the one left to play {a2}). With good threats in different columns, the odd threat usually wins.'
          },
          {
            kind: 'diagram',
            title: 'Same column: the lower threat',
            pos: '.OXXOOO/.XXOOOX/.OOXXXO/.XXXOXX/.OOOXOX/.XXOOXO',
            overlay: { threats: true },
            expect: 'second',
            text: [
              'When both players have a good threat in the same column, the lower one usually decides, because the column reaches it first.',
              'Here the [P2]’s even threat on {a2} sits under the [P1]’s odd threat on {a3}. The [P1] has to play {a1}, and the [P2] takes {a2}.',
              'A threat on the wrong parity does not count for this. A low even threat for the [P1] does not stop a [P2] even threat above it.'
            ]
          },
          {
            kind: 'diagram',
            title: 'What the solver says',
            pos: '.OOXXO./.OXOXX./.OXOOO./.XXXOX./.XOXOXX/OXOOXXO',
            overlay: { threats: true },
            table: {
              caption: 'Results with perfect play in 2,148 positions from the coach’s own practice games, 14 or more discs in, each solved exactly. "Good" means odd for the first player, even for the second, and not sitting above a good enemy threat in the same column.',
              head: ['Threat picture', 'Solved', 'First wins', 'Draw', 'Second wins'],
              rows: [
                ['Odd threat vs nothing good', '337', '93%', '3%', '5%'],
                ['Odd threat vs even threat', '193', '90%', '0%', '10%'],
                ['Odd threat vs odd threats', '288', '79%', '1%', '20%'],
                ['Even threat vs nothing good', '737', '14%', '0%', '86%'],
                ['No good threats', '593', '36%', '26%', '38%']
              ]
            },
            text: [
              'The rules of thumb hold up well. A first-player odd threat wins about nine times in ten. A second-player even threat, with no odd threat against it, wins about as often.',
              'When nobody has a good threat yet, the game is still open, which is why the middlegame is a race to create one.'
            ]
          },
          {
            kind: 'puzzle',
            id: 'even-answer',
            title: 'The even answer',
            pos: '461744127464426611172',
            prompt: 'You are the [P2]. The [P1]’s only threat, {e2}, is on an even row. Find the move that gives you a winning threat.',
            goal: 'win',
            solutions: ['b'],
            hint: 'Row 4 already holds two of your discs.',
            explain: '{b4} lines up {a4}–{b4}–?–{d4}, so {c4} is yours. It is even, and column c is empty beneath it. The [P1]’s even threat on {e2} is the wrong parity for them.'
          }
        ]
      },

      {
        id: 'plans',
        title: 'Game plans',
        short: 'The whole strategy on one page per side.',
        steps: [
          {
            kind: 'diagram',
            title: 'Playing first',
            pos: '4',
            overlay: { fill: true },
            text: [
              '**Open in the centre**: {d1}.',
              '**Build in columns c, d and e**, and aim for a threat on an **odd** row. Row 3 is the classic target.',
              '**Protect it.** Keep the [P2] from building an even threat below it in the same column, and never fill the square under it yourself.',
              '**Then be patient.** Play safe moves, avoid poisoned squares, and let the [P2] run out of room.',
              'Always run the three checks first: win, block, what lands on top.'
            ]
          },
          {
            kind: 'diagram',
            title: 'Playing second',
            pos: '44',
            overlay: { fill: true },
            text: [
              '**Reply in the centre**: {d2}.',
              '**Follow up.** When every column has an even number of empty squares, answering on top of the [P1] keeps the even squares for you.',
              '**Aim for even threats**, rows 2 and 4 especially. One good even threat with no odd threat against it wins most games.',
              '**Stop odd threats early**, above all on row 3, and watch for four odd squares lining up on row 3 or row 5.',
              'When you are done here, play the coach and it will point these ideas out as they come up.'
            ]
          }
        ]
      }
    ],

    practice: [
      {
        kind: 'puzzle', id: 'p-stack-b1', title: 'Stack on the left', tag: 'Stacked threats',
        pos: '4545441554',
        prompt: 'You are the [P1]. Win in two moves.',
        goal: 'mate', within: 2, solutions: ['b'],
        hint: 'The winning squares end up in column c.',
        explain: '{b1} threatens {c1} along the bottom row and {c2} along {b1}–{c2}–{d3}–{e4}. Your opponent blocks {c1} and you drop onto {c2}.'
      },
      {
        kind: 'puzzle', id: 'p-odd-f2', title: 'Quiet odd threat', tag: 'Odd threats',
        pos: '44424321335334227677277432',
        prompt: 'You are the [P1]. Find the only winning move.',
        goal: 'win', solutions: ['f'],
        hint: 'Look for a line that ends on row 3.',
        explain: '{f2} lines up with {d4} and {c5} on the diagonal, leaving {e3} as your winning square. Row 3 is odd and the [P2] has no even threat to match it, so zugzwang goes your way.'
      },
      {
        kind: 'puzzle', id: 'p-two-odd', title: 'Two on row 5', tag: 'Odd threats',
        pos: '4423532536643442335465',
        prompt: 'You are the [P1]. Find the only winning move.',
        goal: 'win', solutions: ['e'],
        hint: 'Row 5 already has two of your discs side by side.',
        explain: '{e5} makes {c5}–{d5}–{e5}, open on both sides: threats on {b5} and {f5}, both odd. {b4} and {f4} are now poison for the [P2].'
      },
      {
        kind: 'puzzle', id: 'p-shared-e3', title: 'Shared square', tag: 'Odd threats',
        pos: '6364662174442432',
        prompt: 'You are the [P1]. {e3} is already your opponent’s threat. Find the only winning move.',
        goal: 'win', solutions: ['c'],
        hint: 'Row 3 again.',
        explain: '{c3} makes {e3} your threat too. Now both players need {e3}, and whoever fills {e2} hands it to the other. Because row 3 is odd, that zugzwang goes to the [P1].'
      },
      {
        kind: 'puzzle', id: 'p-even-d5', title: 'Even over odd', tag: 'Even threats',
        pos: '467366463663377211447',
        prompt: 'You are the [P2]. Find the only winning move.',
        goal: 'win', solutions: ['d'],
        hint: 'The [P1]’s {e2} threat is even. Build your own threat higher up column e.',
        explain: '{d5} gives you a threat on {e4}, an even square. The [P1]’s threat on {e2} is on an even row too, which is the wrong parity for them, so it only delays things.'
      },
      {
        kind: 'puzzle', id: 'p-even-f3', title: 'Row four', tag: 'Even threats',
        pos: '34471314343442335525566',
        prompt: 'You are the [P2]. Find the only winning move.',
        goal: 'win', solutions: ['f'],
        hint: 'Think about column g.',
        explain: '{f3} gives you threats on {g3} and {g4}. {g4} is even, and with {g3} under it the [P1] can never safely play {g2}.'
      },
      {
        kind: 'puzzle', id: 'p-follow-b', title: 'Follow up again', tag: 'Follow-up',
        pos: '46441334174764117166761622552',
        prompt: 'You are the [P2]. The [P1] has just played {b3}. Find the only winning move.',
        goal: 'win', solutions: ['b'],
        hint: 'Answer where they played.',
        explain: '{b4}, straight on top. {c4} is a threat for both of you, and it is even, so the parity fight is what matters. Following up keeps it yours.'
      },
      {
        kind: 'puzzle', id: 'p-fork-bottom', title: 'Bottom-row fork', tag: 'Double threats',
        pos: '4433',
        prompt: 'You are the [P1]. Win in two moves. There are two ways.',
        goal: 'mate', within: 2, solutions: ['b', 'e'],
        hint: 'Make three in a row with both ends open.',
        explain: 'Either {b1} or {e1} makes three in a row with both ends open on the bottom row. Your opponent can block only one end.'
      }
    ],

    rules: [
      {
        title: 'Every move',
        items: [
          'Can I win now? Check diagonals too.',
          'Must I block a playable threat?',
          'What lands on top of my disc?',
          'Never fill the square under an enemy threat, or under your own.'
        ]
      },
      {
        title: 'First player',
        items: [
          'Open with {d1}; build in c, d and e.',
          'Aim for a threat on an odd row: 1, 3 or 5. Row 3 is the classic.',
          'Keep the opponent from getting an even threat under it in the same column.',
          'Then play safe moves and let zugzwang work.'
        ]
      },
      {
        title: 'Second player',
        items: [
          'Reply {d2}. Stay central.',
          'Follow up: answer on top when every column has an even number of empty squares.',
          'Aim for a threat on an even row: 2, 4 or 6.',
          'Kill odd threats early, and watch rows 3 and 5 for four odd squares in a line.'
        ]
      },
      {
        title: 'Showdowns',
        items: [
          'Stacked threats (one on top of another) win outright.',
          'First player’s odd threat vs second player’s even threat in another column: the odd threat usually wins.',
          'Good threats in the same column: the lower one usually wins.',
          'Wrong-parity threats rarely decide anything on their own.'
        ]
      }
    ]
  };

  if (typeof module === 'object' && module.exports) module.exports = STRATEGY;
  else root.C4_STRATEGY = STRATEGY;
})(typeof self !== 'undefined' ? self : this);
