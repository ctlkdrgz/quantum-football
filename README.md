# Quantum Football

Two-player web game inspired by Greg Egan's *Quantum Soccer* (*Border Guards*). The ball is a wave function: it spreads, reflects off the
walls, interferes with itself, and you score by concentrating enough of it in the other goal.
A prototype.

## Run
```
node server.js            # http://localhost:8080  (PORT=1234 to change)
node --test 'test/*.test.js'
```
Open the page in two browsers: the first two connections play (blue/red), the next ones spectate.

## Play
You command four players. Drag from one of your players: the drag is its velocity vector (a click stops it). Keys **1** Attack (well carries the ball),
**2** Defense (wall repels it), **3** Pass (strong forward kick) set the selected player's stance; **Q/W/E/R** select players 1-4.
Sliders on the right change the physics for both players.

Docs: [docs/SPEC.md](docs/SPEC.md) (mechanics), [docs/ASYMMETRY.md](docs/ASYMMETRY.md) (left/right fairness: what was wrong and how it is checked), [docs/RESEARCH.md](docs/RESEARCH.md) (Egan's original and what is borrowed), [docs/PLOT-ENGINE.md](docs/PLOT-ENGINE.md) (the ball's characteristic length as a story and pacing device).

## Variants
`PRESET=default|waves|additive|waves-kick|waves-well|waves-wall|waves-mass|hybrid node server.js` (and `PARAMS='{...}'` for single overrides). `waves`: about 2-3 waves across the pitch. `additive`: wall rebounds add instead of
interfering. Comparison, with videos' numbers and a recommendation: [docs/VARIANTS.md](docs/VARIANTS.md). Reproduce the table: `node tools/variants.js`.

## Bots
`BOTS=<team 0>,<team 1> node server.js` fills a team with a scripted strategy; `-` or nothing leaves it to a human. The human takes the free team.
Both teams bots: everybody only watches.
`DEMO=1` is the same as `BOTS=turns,turns`. Strategies (`bots.js`):

| Name | Strategy |
|---|---|
| `turns` | The teams take turns (12 s): the attacker puts two passers behind the ball, the other team defends in a wall line |
| `receiver` | Player 1 waits next to the opposing goal as a target man; players 2-3 stand behind the ball and pass to him; player 4 guards our goal |
| `fortress` | All four in defense stance around our own goal, facing the ball, to deflect everything |
| `shadow` | Players 1-2 each stand between one of the two most advanced opponents and our goal (wall on); players 3-4 attack with passes |
| `lanes` | All four run sideways, each in its own quarter of the pitch length; the two nearest our goal defend, the other two attack |
| `relay` | A bucket brigade: player 1 passes from behind the ball; players 2-4 stand as attack-stance stepping stones every 12 m toward the goal |
| `plow` | All four form a wall line across the pitch and advance abreast, 12 m behind the ball, pushing the wave toward the goal like a piston |

Example: `BOTS=shadow,- node server.js` and play red against the shadow bot.
