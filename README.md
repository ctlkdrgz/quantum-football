# Quantum Football

Two-player web game inspired by Greg Egan's *Quantum Soccer* (*Border Guards*). The ball is a wave function: it spreads, reflects off the
walls, interferes with itself, and you score by concentrating enough of it in the other goal.
A prototype.

## Run
```
node server.js            # http://localhost:8080  (PORT=1234 to change)
node --test 'test/*.test.js'
```
Open the page in several browsers: the first connection is the **admin**, the second is the **human**, the others spectate. The match starts **paused**; the admin presses Play. Teams set to `human` go to the admin, then the human. Static files are served with `no-store`, so a refresh loads the latest app.

## Play
You command four players. Drag from one of your players and drop: it runs there at full speed and stops (thin dotted line = its path). **Shift**-drop adds the destination after the current path, and with Shift the drag can start anywhere (away from your players it moves the selected one; a Shift-click queues the clicked spot); a click on a player stops it. Keys **1** Defense (wide catch, kicks straight ahead),
**2** Pass (catches just ahead, medium kick split among the allies, the more advanced the likelier), **3** Shot (catches just ahead, hard kick at the opposing goal),
**4** Dribble (catches just ahead and keeps the ball there) set the selected player's stance; **Q/W/E/R** select players 1-4.
Marks on the pitch: dot + arrowhead = a player and its heading. The shaded disc and circle ahead of each player = its catch zone, where the catch well pulls the ball and kicks act (circle = the well's width, 1 sigma, scaled by reach); solid circle = Defense (wide, farther ahead), dashed = Pass/Shot/Dribble, thick = your selected player. Thin team-colour dotted lines ending in a ring = kick aims (one per ally for Pass, fainter = less likely). White dotted line with dots = your player's planned path. The same legend is under the pitch.
Sliders on the right change the physics live (admin and human only; hover a slider for an explanation); the ball size slider ("packet width", default 4 m) resizes the ball before kick-off.

Docs: [docs/PHYSICS.md](docs/PHYSICS.md) (the physics: equation, discretisation, player forces, goals; kept in sync with `sim.js`), [docs/SPEC.md](docs/SPEC.md) (mechanics), [docs/ASYMMETRY.md](docs/ASYMMETRY.md) (left/right fairness: what was wrong and how it is checked), [docs/RESEARCH.md](docs/RESEARCH.md) (Egan's original and what is borrowed), [docs/PLOT-ENGINE.md](docs/PLOT-ENGINE.md) (the ball's characteristic length as a story and pacing device).

## Variants
`PRESET=default|waves|additive|waves-kick|waves-well|waves-wall|waves-mass|hybrid node server.js` (and `PARAMS='{...}'` for single overrides). `waves`: about 2-3 waves across the pitch. `additive`: wall rebounds add instead of
interfering. Comparison, with videos' numbers and a recommendation: [docs/VARIANTS.md](docs/VARIANTS.md). Reproduce the table: `node tools/variants.js`.

## Bots
`BOTS=<team 0>,<team 1> node server.js` sets the starting controller of each team; `-` leaves a team to a human. Default: `random,random`.
Clients are named by join order (Client 1, Client 2, ...). The first is the admin: a band at the top of the page lets it change, live, who controls each team (`human` or any script below).
`human` teams go to the admin, then the second client ("human" role) if it has none; later clients only spectate. A client keeps its team until it leaves or the admin turns that team into a script.
Each tab keeps an id across reloads (sessionStorage): a client that reloads gets its name and role back (the server holds them 15 s); if the admin reloads, the game starts afresh (the starting controllers and sliders, score 0, full clock, paused) and all other clients are told to refresh too. The tab title starts with the client's role (admin, human, spectator) and team.
A client gone for more than 15 s is forgotten: the next in line inherits its team, or the admin role.
Tests (`test/*.test.js`) start their own servers on a random loopback port, so they never touch a game you have running.
`random` (new): every player picks a random velocity and stance every 0.5-2 s.
`DEMO=1` is the same as `BOTS=turns,turns`. Strategies (`bots.js`):

| Name | Strategy |
|---|---|
| `turns` | The teams take turns (12 s): the attacker puts two passers behind the ball, the other team defends in a wall line |
| `receiver` | Player 1 waits next to the opposing goal as a target man; players 2-3 stand behind the ball and pass to him; player 4 guards our goal |
| `fortress` | All four in defense stance around our own goal, facing the ball, to deflect everything |
| `shadow` | Players 1-2 each stand between one of the two most advanced opponents and our goal (defense stance); players 3-4 attack with passes |
| `lanes` | All four run sideways, each in its own quarter of the pitch length; the two nearest our goal defend, the other two attack |
| `relay` | A bucket brigade: player 1 passes from behind the ball; players 2-4 stand as dribble-stance stepping stones every 12 m toward the goal |
| `plow` | All four form a line of defenders across the pitch and advance abreast, 12 m behind the ball, clearing the wave toward the goal |
| `chase` | Each player runs to one of the hot spots of the wave (at least half as hot as the hottest, none inside the opposing goal) in Shot stance, then dribbles it toward the opposing goal at 3 m/s |
| `idle` | No action: all four stand still where they are, keeping their stance (a target for testing, or a team left alone) |

Example: `BOTS=shadow,- node server.js` and play red against the shadow bot.
