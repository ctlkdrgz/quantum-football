# Quantum Football: the physics

**Status:** maintained alongside `sim.js` (the single source of truth). Last checked against the code: 2026-11-01.
**Maintenance rule:** any change to `sim.js` that alters the equation, the discretisation, a force, a rule or a `PARAMS` default must update this file in the same commit. Line pointers below name functions, not line numbers, so they survive edits.

**TL/DR**
- The ball is a complex field psi(x, y) on a 100 x 50 grid (1 cell = 1 m), evolving under the free Schroedinger equation with hbar = 1 and mass `mass`. Nothing else is simulated: no ball position, no ball velocity.
- Players never touch the ball; they edit psi locally: a potential V (wells attract, walls repel) and phase ramps (momentum kicks). A goal is a probability threshold, not an event.
- Numerics: Visscher leapfrog (norm-preserving to second order), a per-tick diffusion filter ("attenuation") and a per-tick renormalisation. The last two are not Hamiltonian physics; they are game-design stabilisers.
- Two wall modes: Dirichlet (coherent, interference) or a mirrored torus with summed densities (additive, no cancellation).

Companion docs: mechanics and controls in [SPEC.md](SPEC.md), the "ball length" metric in [PLOT-ENGINE.md](PLOT-ENGINE.md), preset comparison in [VARIANTS.md](VARIANTS.md), mirror-fairness in [ASYMMETRY.md](ASYMMETRY.md), the source novel in [RESEARCH.md](RESEARCH.md).

## 1. The state

1.1 **Field.** `R` and `I` (`Float64Array`) are the real and imaginary parts of psi on a `W x H = 100 x 50` grid, row-major (`i = y*W + x`). Cell centres sit at `(x + 0.5, y + 0.5)` metres.

1.2 **Density.** rho = R^2 + I^2 is the probability of finding the ball in a cell. It is the only thing players see and the only thing goals read. Total probability is held at 1 (see 4.4).

1.3 **Units.** hbar = 1, lengths in metres, "game time" in game-seconds. Real time reaches the wave through `gdt = dt * timeScale` (default 5, range 0.5 to 12). The players' motion and the countdowns run on real time; only psi runs on game time. So `timeScale` is the ratio of ball speed to player speed.

1.4 **Initial condition (`kickoff`).** A real Gaussian packet centred on the pitch, psi proportional to `exp(-r^2 / (4 s^2))` with `s = packetWidth` (default 14), so the density |psi|^2 is proportional to `exp(-r^2 / (2 s^2))`: standard deviation `s` in each axis. Phases are all zero, so the mean momentum is zero: the ball starts "still" and spreads. Then normalised.

## 2. The free dynamics

2.1 **Equation.** `i dpsi/dt = (-(1/2m) laplacian + V) psi`, with `m = mass` (default 0.7, range 0.5 to 4). A heavier ball spreads and moves more slowly and is harder to push, since the same momentum kick gives velocity `k/m`.

2.2 **Lattice Laplacian.** `applyH` uses the 5-point stencil with spacing 1 m: `H psi = -(1/2m)(sum of 4 neighbours - 4 psi) + V psi`. Consequence: the lattice dispersion is `omega(k) = (1/m)(2 - cos kx - cos ky) + V`, which equals the continuum `k^2/(2m)` only for wavelengths well above a few cells. Waves with `k` near pi (2-cell wavelength) have zero group velocity. Kicks and wells are tuned to stay far below that.

2.3 **Group velocity.** A packet with wavenumber `k` (rad/m) moves at `k/m` m per game-second, i.e. `k * timeScale / m` m per real second. This is the formula `aim()` uses to predict pass travel time (with `k = 0.7 * kick`, clamped to 2 to 30 m/s).

2.4 **Spreading.** A free packet of initial width `s` widens as `sqrt(s^2 + (t/(2 m s))^2)` in game time. With the defaults (s = 14, m = 0.7) the ball is far wider than a player's reach within a few real seconds, which is why the kick-off packet width and `L` (PLOT-ENGINE) are tuned together.

2.5 **Walls, coherent mode (`additive = 0`).** Out-of-range neighbours are 0 (`neighbours()`), i.e. psi = 0 one cell beyond each edge: Dirichlet, hard reflecting walls. The incident and reflected waves interfere in the amplitude: standing-wave nodes, and the lowest pitch mode has half a wave across the length (`wavesAcrossWidth() = 0.5`). Eigenmodes are `sin(n pi x / W) sin(m pi y / H)` (up to the half-cell offset).

2.6 **Walls, additive mode (`additive = 1`, applied at next kick-off).** The grid becomes the unfolded `2W x 2H = 200 x 100` torus (`setGrid`; storage is allocated for it up front). psi evolves freely and periodically there; the pitch is the top-left quadrant and the density shown is the **sum of the four mirror images** (`density()`: cells `(x, y)`, `(gw-1-x, y)`, `(x, gh-1-y)`, `(gw-1-x, gh-1-y)`). A rebound therefore adds probability and can never cancel it: no nodes, no destructive interference. Every player-made potential and kick is also applied at its three mirror images (`eachImage`, with the heading mirrored), so the torus stays mirror-symmetric and the sum stays a faithful picture of one ball.
Note that this is a variant physics, not a different integration of the same physics: the additive ball is not a solution of the Dirichlet problem.

## 3. How players act on the ball

All effects are rebuilt every tick in `buildPotential(dtReal)`: `V` is zeroed, then each player contributes by stance. Phase kicks are applied directly to psi at that moment; potentials persist for the tick's evolution. Contributions of several players add. "Having the ball" is therefore never a flag: it is how much amplitude lies where the player's effect acts (the `presence` % in the HUD is `sum rho * Gaussian(reach)` around the player in `snapshot()`).

3.1 **Common geometry.** `sigma = 0.6 * reach` (reach default 8 m, so sigma = 4.8 m). Windows are truncated at 4 sigma and cover exactly the cells whose centre is within the radius (`forBox`); this exactness is what keeps left/right mirrors identical (ASYMMETRY.md, cause 1).

3.2 **Phase kick (`kickPhase`).** psi is multiplied by `exp(i kappa g(r) d.r)` with `g = exp(-|r|^2 / (2 sigma_k^2))` and `d` the unit aim direction. Near the window centre this adds momentum `kappa * d` to the wave, weighted by the existing amplitude: where there is no ball, nothing happens. Because `g` is not constant, the edge of the window also gets a small radial momentum change; the kick is a local, smooth impulse rather than an exact boost. `kappa = c * kick * dtReal`, so the impulse is **per real second** and independent of the tick rate; `c` is the stance's kick gain (3.4).

3.3 **Aims (`aims`).** Returns the kick directions of a player as a list of `{dx, dy, tx, ty, w}` (unit direction, target point, probability weight, weights sum to 1). Dribble: none. Defense: the heading. Shot: the opposing goal centre. Pass: every ally, at its predicted position (travel time = distance / (0.4 * kick * timeScale / mass), clamped to 4 s, extrapolated along its velocity order), with weight proportional to `1 + |x_ally - x_ownGoal|`, so allies nearer the opposing goal are likelier; allies within 2 m are skipped, and with none left the pass goes to the goal. With `autoAim = 0`, Pass and Shot are one direction along the heading.

3.4 **Catch and kick (all stances).** Each tick a player contributes (a) a catch well `V -= depth * exp(-r^2 / (2 sigma^2))` centred `off` ahead of the player along the heading, and (b) a phase kick over the same window with `kappa = gain * kick * dtReal` along the aims. Because the well moves with the player, it drags probability along (adiabatic-ish transport, imperfect: the wave can leak and spreads); deep wells compress the ball (see PLOT-ENGINE), shallow ones leak.

| Stance | Well centre `off` | Well and kick `sigma` | Depth | Kick gain | Direction |
|---|---|---|---|---|---|
| Defense | `reach` | `reach` (wide) | `wallHeight` (default 1) | 0.7 | heading |
| Pass | `0.6 reach` | `0.6 reach` | `wellDepth` (0.5) | 0.4 (medium) | all allies, weighted |
| Shot | `0.6 reach` | `0.6 reach` | `wellDepth` | 1.0 (high) | opposing goal |
| Dribble | `0.6 reach` | `0.6 reach` | `wellDepth` | 0 | none |

3.5 **Several directions (`kickPhase`).** For a Pass the window factor is `(1 - g) + g * sum_j a_j exp(i kappa g d_j.r)` with `a_j = sqrt(w_j)`: each ally's direction gets a momentum component with probability `w_j` (the `(1 - g)` term keeps the window edge continuous; psi is renormalised after the tick anyway). With one direction it reduces to the plain phase kick of 3.2. In additive mode every mirror image of the player kicks along the mirrored directions.

3.6 **No walls any more.** The old repulsive Defense barrier and the Attack stance are gone: Defense is now a wide catch plus a straight clearance, and Dribble replaces Attack's carrying well without the push.

3.7 **Players themselves** are classical points: velocity orders capped at `runSpeed` (default 12 m/s), clamped to the pitch (a wall zeroes that velocity component), integrated with `x += v dt` (`movePlayers`). No collisions between players, and no effect of the ball on the players.

## 4. The integrator

4.1 **Per tick (`evolve(dt)`).** `dt` is real elapsed time, capped at 0.1 s by the server loop (30 Hz tick, `TICK_MS = 33`). `gdt = dt * timeScale`.

4.2 **Leapfrog (Visscher).** The substep count is `n = ceil(gdt / 0.08)` and `h = gdt / n`, so `h <= 0.08`. Each substep does `R += h H I` then `I -= h H R`. It is symplectic and norm-preserving to second order; the potential `V` is frozen over the tick.
Stability needs roughly `h * omega_max < 2`, with `omega_max ~ 4/m + max V`. At the slider extremes (mass 0.5, stacked walls and wells) this approaches the limit; the defaults and presets are far from it. If you extend a range, check this first.

4.3 **Attenuation (`smooth`).** After the substeps, R and I are each replaced by `psi + eps * (sum of neighbours - 4 psi)` with `eps = min(0.24, attenuation * 0.5 * gdt)`. This is one explicit diffusion step: it damps short wavelengths by `1 - eps * (4 - 2 cos kx - 2 cos ky)` per tick, and the cap 0.24 keeps it stable (the explicit limit is 0.25). As physics it means "the wave diffuses with coefficient `attenuation / 2` per game-second"; combined with the dispersive term the effective evolution is a complex-diffusion equation. It is not unitary; it removes energy from high-k components. It explains why high attenuation (the `waves` presets use 1) keeps the pitch at 2 to 3 waves rather than the 15 or so that the defaults would produce. In the clamped regime (`attenuation * 0.5 * gdt > 0.24`) damping stops growing with `timeScale`.
Wall caveat: the smoothing treats out-of-range neighbours the same as the Hamiltonian does (0 in coherent mode, wrap in additive).

4.4 **Renormalisation (`normalize`).** Every tick psi is rescaled so `sum |psi|^2 = 1`. This is how the diffusion's loss, and the leapfrog's small norm drift, are hidden. The consequence is a game rule: probability never runs out, the ball always exists somewhere with total weight 1. Note that renormalising after absorbing diffusion makes the effective dynamics nonlinear (a mild global gain), which is fine for a game but means psi is not a linear-quantum object.

4.5 **Phases outside play.** In `goal` and `over` the wave keeps evolving (`evolve` is still called) while players are frozen in place; `buildPotential` still runs, so their wells, walls and kicks keep acting from the frozen stances. In `waiting` and `countdown` psi is frozen.

## 5. Goals and measurements

5.1 **Goal probability (`goalProbabilities`).** For each end, the sum of rho over cells with centre inside `H/2 +- goalHeight/2` and within `GOAL_DEPTH = 6` cells of the end wall. Computed from `density()`, hence includes the mirror sum in additive mode.

5.2 **Scoring (`checkGoals`).** Each tick, if `max(left, right) > threshold` (default 0.1; sliders 0.05 to 0.9) a goal is scored by the team **opposite** the goal that filled: the ball in the right goal scores for team 0 (which attacks right). There is no collapse and no randomness: the threshold is a deterministic criterion on the density. After the 2.5 s pause the wave is discarded and replaced by a fresh still packet (`kickoff`). If both goals cross on the same tick the point goes to the team behind (team 0 on equal scores), see ASYMMETRY.md cause 4.

5.3 **Why the numbers matter.** The goal rectangle is `6 x 20 = 120 m^2` of 5000 m^2 (2.4 %), so a uniform ball puts 2.4 % in each goal and a threshold of 0.1 needs the density concentrated about 4 times above uniform there. This is why wells, passes and walls that herd the wave matter.

5.4 **Diagnostic scalars (HUD, not game rules).**
- `characteristicLength()`: participation length `1 / sum(rho_x^2)` along x (uniform: 100 m; lowest mode: 66.7 m; Gaussian of std s: 3.54 s).
- `wavesAcrossWidth()`: `W * k_rms / (2 pi)` from finite differences of psi along x. Lowest mode 0.5, plane wave with 3 wavelengths 3.

## 6. Where the model is not really physics (critical notes)

6.1 **Player influence is a design choice, not a force law.** Wells and walls are potentials, kicks are phase multiplications; nothing conserves energy. A kick adds energy at will, and the attenuation removes it. That is intentional but means energy-based reasoning (tunnelling thresholds, bound states) only holds over short windows.

6.2 **Smoothing and renormalisation dominate at the playing parameters.** The attenuation and the 5-point lattice change the effective dispersion noticeably for short waves, and the `waves` presets are essentially a diffusive regime with residual wave character. Anything derived from textbook free-particle formulas (2.3, 2.4) is an order-of-magnitude guide.

6.3 **Additive mode is not unitary quantum mechanics.** Summing densities of mirror images is a classical-looking probability sum over image sources. It is mirror-consistent and fair, but the ball in this mode has no interference with its own rebound.

6.4 **The tuning is done on bots.** Numbers like "L about 50 m" or "goals about 5 per match" come from scripted bot matches (SPEC.md), not from human playtests.

6.5 **Stability margin is only checked by the defaults.** See 4.2.

## 7. Parameter-to-effect cheat sheet

| Parameter | Default | Acts on | Physical meaning |
|---|---|---|---|
| `timeScale` | 5 | `gdt = dt * timeScale` | wave clock vs. player clock; ball speed in m/s real = `k * timeScale / m` |
| `mass` | 0.7 | kinetic coefficient `1/(2m)` | inertia: heavier = slower spreading, slower after a kick |
| `attenuation` | 0.05 | `smooth` | diffusion coefficient `attenuation / 2` per game-s; kills short waves |
| `packetWidth` | 14 | `kickoff` | initial std of the density (m) |
| `goalHeight`, `threshold` | 20, 0.1 | `goalProbabilities`, `checkGoals` | size of the goal window; probability needed to score |
| `runSpeed` | 12 | `setOrder`, `movePlayers` | player speed (m/s, real time) |
| `reach` | 8 | well offset and size | spatial scale of every player effect |
| `wellDepth` | 0.5 | Pass/Shot/Dribble catch well | trap depth (energy units, hbar = 1) |
| `wallHeight` | 1 | Defense catch well | depth of the wide well (name kept from the old barrier) |
| `kick` | 2 | all phase kicks | impulse per real second times the stance gain: Defense `0.7`, Pass `0.4`, Shot `1.0`, Dribble `0` |
| `autoAim` | 1 | `aims` | 0 = along heading |
| `additive` | 0 | `setGrid`, `density` | 0 Dirichlet, 1 mirrored torus (next kick-off) |
| `matchSeconds` | 180 | match clock | not physics |

## 8. How to verify the physics

- Unit tests: `node --test 'test/sim.test.js'` (total probability stays 1, wall reflection, eigenmode stays stationary, additive-wall conservation, goal rules, aim, mirror symmetry).
- Mirror error of the dynamics: `node tools/symmetry.js` (should stay at about 1e-14).
- Preset statistics (L, waves, goals): `node tools/variants.js`.
