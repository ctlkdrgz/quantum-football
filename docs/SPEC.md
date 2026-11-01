# Quantum Football: mechanics

Two players, one wave-function ball, a 100 x 50 m pitch with reflecting walls. KISS: one match, one server, no lobby.
The equations and numerics behind this are in [PHYSICS.md](PHYSICS.md).

## Match
- One server. The first two browsers to connect are player 0 (blue, attacks the right goal) and player 1 (red, attacks the left goal).
  Later connections are spectators (they see everything, change nothing). A player who leaves (and does not come back within the 15 s reload grace) gives the slot to the first spectator; the other player keeps theirs.
- Flow: waiting for 2 players -> 3 s countdown -> play. A match never ends: the HUD clock counts the time played; the score goes back to 0-0 only when a player leaves or the admin reloads.
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
- **Orders are destinations, given by drag and drop.** Press on one of your players, drag, release: the player runs to the drop point at the max-speed slider's speed and stops exactly there.
  **Shift**-drop queues the point after the current path (up to 20 waypoints; while shift is held the preview line starts at the end of the path, whose last waypoint is highlighted). A click without drag (or a drop within 0.5 m of the start) stops the player.
  The client draws each of your players' remaining path as a thin dotted line through its waypoints. Orientation = direction of travel; it stays when the player stops.
  Bots can still give raw velocity orders (`setOrder`), which cancel any path.
- Selecting: the player you pressed on is selected (also Q/W/E/R for players 1-4).
- "Having the ball" is not binary: it is the amplitude of psi near the player (shown as a % label). Every action below acts on psi locally,
  so it works exactly as much as the ball is there. Several players act at once and their effects add up.
- Stance per player (keys 1/2/3/4 or buttons, applies to the selected player). Every stance has a **catch zone**: a disc just ahead of the player (the player on its edge, radius = reach). The **slow** part of the ball in it, slow relative to the player, is caught at a steady rate: a fast ball is hard to catch (`catchSpeed`), and a ball running alongside the player is easy. A caught share loses part of its momentum (`absorbMean`, `absorbSpread`) and, except in Dribble, is kicked at once; it leaves as a ray from the zone while the rest of the ball stays (PHYSICS.md section 3).
  - **Defense** (1): a 1.5 x wider zone, kicks straight along the heading (0.7 x kick speed).
  - **Pass** (2): kicks at 0.55 x kick speed to **all** the allies at once: the caught share is split into one momentum component per ally, each with probability proportional to `1 + (its distance from our own goal line)`, so the allies closer to the opposing goal are more likely receivers. Targets are the allies' *predicted* positions (position plus velocity times the ball's travel time); allies within 2 m are skipped; with nobody left the pass goes to the goal.
  - **Shot** (3): kicks at the full kick speed to the opposing goal centre.
  - **Dribble** (4): catches without kicking, matching the ball's speed to the player's, and holds it with an attractive well in the zone (the only stance with a well): it keeps the ball just ahead of the player. When the player stops, the caught part stops; the uncaught part carries on.
  - Pass and Shot are **auto-aimed** (`autoAim` param, on by default; off = along the heading). The client draws each aim as a dotted line and a small circle, fainter the less likely the receiver.
  - No stamina, no hold: whatever is caught is kicked in the same frame, so holding a kick stance on the ball drains it into a ray.

## Characteristic length of the ball
`L = 1 / sum(rho_x^2)` (metres): the participation length of the ball's density summed over the pitch height, along the 100 m axis. A uniform ball gives 100 m,
the lowest standing mode 66.7 m, a Gaussian packet of density std s gives 3.54 s, a ball squeezed into a goal a few metres. Shown in the HUD (`ball length`).
The defaults are tuned so that **L is about half the pitch (50 m)**: a kick-off packet of width 14 (no longer the default, which is 4) has L = 49.6 m, and over bot matches L averages about 46 m
(35-65 m for 65 % of the time, goals about 5 per 3-minute match, measured with `tune` runs of 6 bot pairings; noisy). Left alone, the ball "breathes" between 50 and 80 m.
These numbers were measured with the force-kick model (before 2026-11-01: reach 8 m, a kick that pushed while the ball was in the window); they have not been re-measured
with the catch/kick model. See `docs/PLOT-ENGINE.md` for what L can do for the game.

## Wall modes and presets
`additive` (0/1, applied at the next kick-off): 0 = Dirichlet walls, the rebound interferes with the incident wave. 1 = the pitch is unfolded into a 2W x 2H torus and the
displayed density is the sum over the four mirror images: rebounds add probability and never cancel it. `wavesAcrossWidth()` (HUD "waves") = W k_rms / 2 pi.
Presets (`PRESETS` in `sim.js`): `default`, `additive`. The `waves` family belonged to the force-kick model and was removed on 2026-11-01 (its history is in `docs/VARIANTS.md`).

## Parameters (sliders, shared by both players, clamped on the server)
Wave time speed, ball mass (weight), attenuation, kick-off packet width, goal width, goal threshold, player max speed, player reach (catch zone radius),
catch speed limit, momentum absorbed on a catch (mean, spread), kick speed, Dribble well depth. Speeds are in m/s of the players' clock. Ranges and defaults: `PARAMS` in `sim.js`.
The game runs in frames of exactly 1/30 s (`FRAME_DT`): a loaded server shows fewer frames per second, never a different game. A list of the rules that surprise: `docs/RULES.md`.

## Architecture
- `sim.js`: pure simulation (no I/O), unit-tested. `server.js`: static files + dependency-free WebSocket, 30 Hz tick, server-authoritative.
- `public/`: canvas client. Sends moves (`{t:'move',p,x,y,queue}`; `queue` appends to the path) and, for compatibility, velocity orders (`{t:'order',p,vx,vy}`), stances (`{t:'stance',p,s}`, p = 0-3 within your team) and slider changes. Receives the density as 5000 bytes (base64) + all 8 players + score each tick.
- No npm dependencies. Node 22.

## Known rough edges / ideas
- Defaults are tuned with bots only, not by playtesting (see the characteristic-length section). Bot matches are not symmetric between the two sides (e.g. `shadow` as blue scores far more than as red); not investigated.
- No measurement/collapse; no eigenmode view; no rematch button; no auth, anyone who reaches the port can play.
