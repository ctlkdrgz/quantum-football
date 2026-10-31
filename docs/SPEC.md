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
- Mouse = target. The player runs toward the cursor at the run-speed parameter and stops on arrival. Orientation = last running direction.
- "Having the ball" is not binary: it is the amplitude of psi near the player (shown as `ball N%`). Every action below acts on psi locally,
  so it works exactly as much as the ball is there.
- Stances (keys 1/2/3 or buttons):
  - **Attack**: a moving attractive potential well around the player carries part of the wave along as they run, plus a gentle forward momentum push.
  - **Defense**: a repulsive potential wall in front of the player, perpendicular to their heading. It reflects and blocks the wave; running with it pushes the wave.
  - **Pass**: a strong forward momentum kick (phase ramp `exp(i k d.r)`) over a wide window just ahead of the player. Burns stamina (1.7 s full, regenerates 4 s while not passing). Only moves the ball if the ball is in the window.

## Parameters (sliders, shared by both players, clamped on the server)
Wave time speed, ball mass (weight), attenuation, kick-off packet width, goal height, goal threshold, match duration,
player run speed, player reach, attack well depth, defense wall height, kick strength. Ranges and defaults: `PARAMS` in `sim.js`.

## Architecture
- `sim.js`: pure simulation (no I/O), unit-tested. `server.js`: static files + dependency-free WebSocket, 30 Hz tick, server-authoritative.
- `public/`: canvas client. Sends cursor position (30 Hz), stance, slider changes. Receives the density as 5000 bytes (base64) + players + score each tick.
- No npm dependencies. Node 22.

## Known rough edges / ideas
- Defaults are tuned by a scripted player only, not by playtesting; goals need real focus of the wave (threshold 0.15).
- No measurement/collapse; no eigenmode view; no rematch button; no auth, anyone who reaches the port can play.
