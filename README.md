# Quantum Football

Two-player web game inspired by Greg Egan's *Quantum Soccer* (*Border Guards*). The ball is a wave function: it spreads, reflects off the
walls, interferes with itself, and you score by concentrating enough of it in the other goal.
A prototype in a side directory of this repo; it is unrelated to imbridge and meant to move to its own repo.

## Run
```
cd quantum-football
node server.js            # http://localhost:8080  (PORT=1234 to change)
node --test 'test/*.test.js'
```
Open the page in two browsers: the first two connections play (blue/red), the next ones spectate.

## Play
You command four players. Drag from one of your players: the drag is its velocity vector (a click stops it). Keys **1** Attack (well carries the ball),
**2** Defense (wall repels it), **3** Pass (strong forward kick) set the selected player's stance; **Q/W/E/R** select players 1-4.
Sliders on the right change the physics for both players.

Docs: [docs/SPEC.md](docs/SPEC.md) (mechanics), [docs/RESEARCH.md](docs/RESEARCH.md) (Egan's original and what is borrowed).

## Demo with dummy AIs
`DEMO=1 node server.js` runs two scripted teams of four (they take turns kicking while the other team defends); every browser only watches.
Demo mode sets easier parameters (time speed 8, threshold 0.1, weak walls, strong kicks) so goals happen. See `bots.js`.
