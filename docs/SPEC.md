# Quantum Football: mechanics

Two players, one wave-function ball, a 100 x 50 m pitch with reflecting walls. KISS: one match, one server, no lobby.

## Match
- One server. The first two browsers to connect are player 0 (blue, attacks the right goal) and player 1 (red, attacks the left goal).
  Later connections are spectators (they see everything, change nothing). If a player leaves, the match resets and the first spectator takes the slot.
- Flow: waiting for 2 players -> 3 s countdown -> play (match duration) -> full time (10 s, wave keeps moving) -> new match, score 0-0.
- Goal: when the probability of the ball inside a goal rectangle (6 m deep, goal-height tall, centred on the end wall) exceeds the
  threshold, the *opposing* player scores. 2.5 s pause, then the ball is reset as a still Gaussian packet at the centre and the players go back to their halves.

## The ball
- Complex wave function psi on a 100 x 50 grid, hbar = 1: `i dpsi/dt = (-(1/2m) laplacian + V) psi`, Dirichlet (reflecting) boundaries.
  Waves reflect off the walls and interfere with themselves: stationary patterns (standing waves) and slowly evolving ones.
- Displayed: probability density |psi|^2 (sqrt-scaled, relative to its peak). Total probability is renormalised to 1 every tick.
- Time speed slider multiplies the wave's clock only, so the ball can be slow relative to the players.
- Attenuation smooths the wave each tick (damps short wavelengths), which also keeps it tame.

## Players
- Each side commands **four players** (team 0 blue: players 1-4, attacks right; team 1 red: attacks left). You cannot command the other side's players.
- **Orders are velocity vectors, given by drag and drop.** Press on one of your players, drag, release: the drag vector is the player's velocity
  (1 m of drag = 1 m/s, capped at the max-speed slider). The player keeps that velocity until a wall stops it or you give a new order.
  A click without drag (or a drag under 0.5 m) stops it. Orientation = direction of the last order; it stays when the player stops.
- Selecting: the player you pressed on is selected (also Q/W/E/R for players 1-4).
- "Having the ball" is not binary: it is the amplitude of psi near the player (shown as a % label). Every action below acts on psi locally,
  so it works exactly as much as the ball is there. Several players act at once and their effects add up.
- Stance per player (keys 1/2/3 or buttons, applies to the selected player):
  - **Attack**: a moving attractive potential well around the player carries part of the wave along as they run, plus a gentle forward momentum push.
  - **Defense**: a repulsive potential wall in front of the player, perpendicular to their heading. It reflects and blocks the wave; running with it pushes the wave.
  - **Pass**: a strong forward momentum kick (phase ramp `exp(i k d.r)`) over a wide window just ahead of the player. No stamina: it works as long as the ball is in the window
    (the kick moves away with the player, so a running passer only gives a short push; stand still to kick hard).

## Characteristic length of the ball
`L = 1 / sum(rho_x^2)` (metres): the participation length of the ball's density summed over the pitch height, along the 100 m axis. A uniform ball gives 100 m,
the lowest standing mode 66.7 m, a Gaussian packet of density std s gives 3.54 s, a ball squeezed into a goal a few metres. Shown in the HUD (`ball length`).
The defaults are tuned so that **L is about half the pitch (50 m)**: the kick-off packet (width 14) has L = 49.6 m, and over bot matches L averages about 46 m
(35-65 m for 65 % of the time, goals about 5 per 3-minute match, measured with `tune` runs of 6 bot pairings; noisy). Left alone, the ball "breathes" between 50 and 80 m.
What it takes to keep L near 50 m while the ball is still playable: the players' reach (8 m) must be a fair fraction of L, kicks must be strong (2), wells shallow (0.5, deep wells
squeeze L down), and the mass light (0.7, heavier balls spread more slowly and let wells win). See `docs/PLOT-ENGINE.md` for what L can do for the game.

## Parameters (sliders, shared by both players, clamped on the server)
Wave time speed, ball mass (weight), attenuation, kick-off packet width, goal height, goal threshold, match duration,
player max speed, player reach, attack well depth, defense wall height, kick strength. Ranges and defaults: `PARAMS` in `sim.js`.

## Architecture
- `sim.js`: pure simulation (no I/O), unit-tested. `server.js`: static files + dependency-free WebSocket, 30 Hz tick, server-authoritative.
- `public/`: canvas client. Sends orders (`{t:'order',p,vx,vy}`), stances (`{t:'stance',p,s}`, p = 0-3 within your team) and slider changes. Receives the density as 5000 bytes (base64) + all 8 players + score each tick.
- No npm dependencies. Node 22.

## Known rough edges / ideas
- Defaults are tuned with bots only, not by playtesting (see the characteristic-length section). Bot matches are not symmetric between the two sides (e.g. `shadow` as blue scores far more than as red); not investigated.
- No measurement/collapse; no eigenmode view; no rematch button; no auth, anyone who reaches the port can play.
