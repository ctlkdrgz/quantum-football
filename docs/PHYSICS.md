# Quantum Football: the physics

**Status:** maintained alongside `sim.js` (the single source of truth). Last checked against the code: 2026-11-01 (catch/kick model).
**Maintenance rule:** any change to `sim.js` that alters the equation, the discretisation, a force, a rule or a `PARAMS` default must update this file in the same commit. Line pointers below name functions, not line numbers, so they survive edits.

**TL/DR**
- The ball is a complex field psi(x, y) on a 100 x 50 grid (1 cell = 1 m), evolving under the free Schroedinger equation with hbar = 1 and mass `mass`. Nothing else is simulated: no ball position, no ball velocity.
- Players never touch the ball; they edit psi locally: a potential V (attractive catch wells) and phase ramps (momentum kicks). A goal is a probability threshold, not an event.
- Numerics: Visscher leapfrog (norm-preserving to second order), a per-tick diffusion filter ("attenuation") and a per-tick renormalisation. The last two are not Hamiltonian physics; they are game-design stabilisers.
- Two wall modes: Dirichlet (coherent, interference) or a mirrored torus with summed densities (additive, no cancellation).

Companion docs: mechanics and controls in [SPEC.md](SPEC.md), the "ball length" metric in [PLOT-ENGINE.md](PLOT-ENGINE.md), preset comparison in [VARIANTS.md](VARIANTS.md), mirror-fairness in [ASYMMETRY.md](ASYMMETRY.md), the source novel in [RESEARCH.md](RESEARCH.md).

## 1. The state

1.1 **Field.** `R` and `I` (`Float64Array`) are the real and imaginary parts of psi on a `W x H = 100 x 50` grid, row-major (`i = y*W + x`). Cell centres sit at `(x + 0.5, y + 0.5)` metres.

1.2 **Density.** rho = R^2 + I^2 is the probability of finding the ball in a cell. It is the only thing players see and the only thing goals read. Total probability is held at 1 (see 4.4).

1.3 **Units.** hbar = 1, lengths in metres, "game time" in game-seconds. Real time reaches the wave through `gdt = dt * timeScale` (default 5, range 0.5 to 12). The players' motion and the countdowns run on real time; only psi runs on game time. So `timeScale` is the ratio of ball speed to player speed.

1.4 **Initial condition (`kickoff`).** A real Gaussian packet centred on the pitch, psi proportional to `exp(-r^2 / (4 s^2))` with `s = packetWidth` (default 4, slider 1-20; changing it while the game is waiting or counting down re-does the kick-off), so the density |psi|^2 is proportional to `exp(-r^2 / (2 s^2))`: standard deviation `s` in each axis. Phases are all zero, so the mean momentum is zero: the ball starts "still" and spreads. Then normalised.

## 2. The free dynamics

2.1 **Equation.** `i dpsi/dt = (-(1/2m) laplacian + V) psi`, with `m = mass` (default 0.7, range 0.5 to 4). A heavier ball spreads and moves more slowly and is harder to push, since the same momentum kick gives velocity `k/m`.

2.2 **Lattice Laplacian.** `applyH` uses the 5-point stencil with spacing 1 m: `H psi = -(1/2m)(sum of 4 neighbours - 4 psi) + V psi`. Consequence: the lattice dispersion is `omega(k) = (1/m)(2 - cos kx - cos ky) + V`, which equals the continuum `k^2/(2m)` only for wavelengths well above a few cells. Waves with `k` near pi (2-cell wavelength) have zero group velocity. Kicks and wells are tuned to stay far below that.

2.3 **Group velocity, and the one quantum scale.** A packet with wavenumber `k` (rad/m) moves at `k/m` m per game-second, i.e. `v = k * timeScale / m` m per real second. Free motion depends only on `hbar/m = timeScale / mass` (m^2 per real second; default 12 / 0.5 = 24). Every speed slider (kick, catch) is in m/s and converted with `k = v * mass / timeScale`, so they mean the same at any `hbar/m`; what `hbar/m` changes is the size of the quantum effects:
- fringe spacing between two parts of the ball whose speeds differ by `dv`: `lambda = 2 pi (hbar/m) / dv` (de Broglie). At 24: 30 m at 5 m/s, 15 m at 10, 7.5 m at 20, 5 m at 30. The default was chosen so that most speed changes in play (3 to 25 m/s) give fringes between 6 m (wider than a catch zone) and 50 m (half the pitch).
- speed spread of a ball of width `s`: `dv = (hbar/m) / (2 s)` (uncertainty). At 24 a 2.5 m ball carries 4.8 m/s of spread. Long fringes and compact balls exclude each other.

2.4 **Spreading.** A free packet of initial width `s` widens as `s sqrt(1 + ((hbar/m) t / (2 s^2))^2)`, `t` in real seconds. At the default `hbar/m = 24` a 2.5 m ball is 5.4 m wide after 1 s and 9.9 m after 2 s; a 4 m ball 5.0 and 7.2 m. Catching and the Dribble well re-compress it.

2.5 **Walls, coherent mode (`additive = 0`).** Out-of-range neighbours are 0 (`neighbours()`), i.e. psi = 0 one cell beyond each edge: Dirichlet, hard reflecting walls. The incident and reflected waves interfere in the amplitude: standing-wave nodes, and the lowest pitch mode has half a wave across the length (`wavesAcrossWidth() = 0.5`). Eigenmodes are `sin(n pi x / W) sin(m pi y / H)` (up to the half-cell offset).

2.6 **Walls, additive mode (`additive = 1`, applied at next kick-off).** The grid becomes the unfolded `2W x 2H = 200 x 100` torus (`setGrid`; storage is allocated for it up front). psi evolves freely and periodically there; the pitch is the top-left quadrant and the density shown is the **sum of the four mirror images** (`density()`: cells `(x, y)`, `(gw-1-x, y)`, `(x, gh-1-y)`, `(gw-1-x, gh-1-y)`). A rebound therefore adds probability and can never cancel it: no nodes, no destructive interference. Every player-made potential and kick is also applied at its three mirror images (`eachImage`, with the heading mirrored), so the torus stays mirror-symmetric and the sum stays a faithful picture of one ball.
Note that this is a variant physics, not a different integration of the same physics: the additive ball is not a solution of the Dirichlet problem.

## 3. How players act on the ball

Every frame, `evolve` first rebuilds the potential (`buildPotential`: only Dribble wells), then applies every player's catch (`catchAll`), then integrates. "Having the ball" is never a flag: it is how much amplitude lies in a player's catch zone (the `presence` % in the HUD is `sum rho * taper` over the zone, in `snapshot()`).

3.1 **Catch zone.** A disc of radius `rz = r * reach` whose centre is `off * reach` ahead of the player along the heading; `r = off`, so the player stands on the zone's edge. Pass, Shot, Dribble: `r = 1`; Defense: `r = 1.5` (wider, farther). The zone is weighted by `taper`: 1 over the inner half of the radius, then `cos^4` down to 0 at the edge; its square root (the amplitude a catch moves) has no kink, since a kink at the edge scattered part of the ball backwards. Windows cover exactly the cells whose centre is within the radius (`forBox`), which keeps left/right mirrors identical (ASYMMETRY.md, cause 1).

3.2 **Only the slow part can be caught (`catchPlan`).** psi is seen from the player, `phi = psi exp(-i k_p . r)` with `k_p` the player's own momentum (its velocity as a wavenumber), and blurred by a Gaussian of std `1 / k_c`, `k_c = catchSpeed * mass / timeScale` (separable blur over the zone's box, capped at 12 m radius). A Gaussian blur passes momentum `k` with amplitude `exp(-k^2 / (2 k_c^2))`, so probability `exp(-(v / catchSpeed)^2)`, `v` the speed relative to the player: the catch's energy selectivity, component by component. Consequences: two fast balls meeting head-on in a zone are both filtered out though their mean momentum is 0; a ball just kicked away is filtered out and not kicked again; a ball running alongside the player is slow in its frame and easy to catch.

3.3 **Catch rate.** From the slow part `phi_s`: its RMS speed `v` relative to the player; the catch fraction at the zone centre this frame is `a = 1 - exp(-CATCH_GAIN (v + CATCH_V0) / (2 rz) * dt)` (`CATCH_GAIN = 3`, `CATCH_V0 = 6` m/s). The `(v + V0) / diameter` factor cancels the time a ball spends crossing the zone, so the chance per crossing is set by the selectivity of 3.2 alone (speed is not counted twice); `V0` keeps a still ball catchable. `dt` is one frame (4.1).

3.4 **What a catch does (the components).** The caught part loses a share `beta` of its mean momentum relative to the player, then gets the kick: momentum change `k_c = -beta p_s + kick * d_j` per aim direction `d_j` (weight `w_j`, see 3.6). `beta` is Gaussian (mean `absorbMean`, std `absorbSpread`), sampled at 3 Gauss-Hermite points (weights 1/6, 2/3, 1/6) and clamped to [0, 1]; components with equal momentum are merged (two equal components would interfere instead of adding). `kick = gain * kickSpeed * mass / timeScale`, gain by stance: Shot 1, Defense 0.7, Pass 0.55, Dribble 0. So `absorbMean = 1` means "a caught ball leaves at the kick speed", 0 means "the kick only adds" (a chain of kickers makes it faster), and the spread scatters caught balls. `beta` acts on the slow part's mean momentum only: the spread of momenta inside the slow part is not removed (that would need cooling, which a norm-preserving local operation cannot do).

3.5 **Applying it (`applyCatch`, `catchAll`).** Only the slow part changes: `psi += (M - 1) psi_s` with, per cell, `M = s + i sum_c sqrt(w_c) exp(i k_c . r)`, `s^2 = 1 - a t` (stays), `w_c = a t q_c` (caught, component `c` with share `q_c`), `t` the taper and `r` the offset from the zone centre. As in any split, the components are orthogonal once they separate, so the caught share ends up with its momentum change. The caught part is a quarter turn (`i`) ahead of what stays: with one component `|M|^2 = 1` where `k_c . r = 0` and on average over a fringe. The offset is constant: offsets that alternated from frame to frame made consecutive kicks cancel, and an offset that varied with the taper (to make `M` exactly 1 at the centre) acted as a lens on the part that stays and scattered as much of it, half backwards, as the kick moved. All players' changes are computed on the same psi and summed (they commute, so mirrored teams stay mirror images); then the probability inside the zones is restored, `psi *= 1 + lambda T` with `T` the summed tapers, so the correction fades out at the zone edges and nothing outside a zone changes.

3.6 **Aims (`aims`).** The kick directions of a player as `{dx, dy, tx, ty, w}` (unit direction, target, weight; weights sum to 1). Dribble: none. Defense: the heading. Shot: the opposing goal centre. Pass: every ally at its predicted position (travel time = distance / pass speed `0.55 * kickSpeed`, clamped to 4 s, extrapolated along its velocity), weight `1 + |x_ally - x_ownGoal|`; allies within 2 m are skipped, with none left the pass goes to the goal. With `autoAim = 0`, Pass and Shot go along the heading. A Pass to several allies is simply several components (3.4): each frame's caught share is split between them, so there are no pulses any more.

3.7 **Dribble's holding well.** Dribble alone adds `V -= wellDepth * exp(-r^2 / (2 sigma^2))`, `sigma = rz / 2`, at its zone centre. Catching matches the ball's speed to the player's but cannot hold its position or stop it spreading (3.4); the well does both. The kick stances have no well: its depth (0.5) exceeds the kinetic energy of a 12 m/s ball, so it would trap their own passes.

3.8 **What a kick looks like.** Each frame a share of the slow ball leaves at the kick speed, so a held kick stance emits a ray from the zone while the hotspot drains. The ray fans out: a zone about 2.5 m wide gives `(hbar/m) / (2 * 2.5) = 4.8` m/s of sideways spread (2.3), a cone of about +-22 degrees for a 12 m/s pass and +-12 degrees for a 22 m/s shot. A kick only separates from the ball if `zone width * dk >~ 1`: small speed changes (dribbling corrections) nudge the whole ball instead of splitting it (share that separates `1 - exp(-(sigma dk)^2)`, sigma ~ zone radius / 2: at radius 4.5 m, 86 % for a 10 m fringe, 59 % for 15 m, 8 % for 50 m).

3.9 **Players themselves** are classical points. A move order (`moveTo`) gives a path of up to 20 waypoints; `movePlayers` walks it at `runSpeed` (default 12 m/s), landing exactly on each waypoint within the frame, turning the heading toward the next one and stopping at the last. `vx, vy` are then set to the current travel velocity (used by the Pass prediction and by the catch, which works in the player's frame). Bots may instead give a raw velocity order (`setOrder`, which clears the path): capped at `runSpeed`, clamped to the pitch (a wall zeroes that velocity component), integrated with `x += v dt`. No collisions between players, and no effect of the ball on the players.

## 4. The integrator

4.1 **Per frame (`evolve(dt)`).** The server steps exactly `FRAME_DT = 1/30` s per tick whatever the wall clock did: a loaded server shows fewer frames per second (the game runs slower), never a different game; a "second" in the game is 30 frames. `gdt = dt * timeScale`.

4.2 **Leapfrog (Visscher).** The substep count is `n = ceil(gdt / 0.08)` and `h = gdt / n`, so `h <= 0.08`. Each substep does `R += h H I` then `I -= h H R`. It is symplectic and norm-preserving to second order; the potential `V` is frozen over the frame.
Stability needs roughly `h * omega_max < 2`, with `omega_max ~ 4/m + max V`. At mass 0.2 this is `h * 20 = 1.6`, close to the limit. If you extend a range, check this first.

4.3 **Attenuation (`smooth`).** After the substeps, R and I are each replaced by `psi + eps * (sum of neighbours - 4 psi)` with `eps = min(0.24, attenuation * 0.5 * gdt)`. This is one explicit diffusion step: it damps short wavelengths by `1 - eps * (4 - 2 cos kx - 2 cos ky)` per frame, i.e. like `k^2`: **fast balls are damped more than slow ones** (at timeScale 12, the share of a ball left after 2 s at attenuation 0.05: 90 % at 10 m/s, 67 % at 20, 44 % at 30; at 1, 12 % at 10 m/s and nothing at 20). That is a numerical smoother, not a game rule anyone asked for; keep it light (default 0.02: 98 / 92 / 85 %). The cap 0.24 keeps it stable (the explicit limit is 0.25).
Wall caveat: the smoothing treats out-of-range neighbours the same as the Hamiltonian does (0 in coherent mode, wrap in additive).

4.4 **Renormalisation (`normalize`).** Only when the total `sum |psi|^2` has drifted from 1 by more than `NORM_DRIFT = 0.005`: the smoothing loses probability every frame (with heavy attenuation the rescale runs every frame), the leapfrog and the catches drift it slightly (R and I live half a substep apart). `density()` divides by the total, so goals, bots and metrics always read a probability. The consequence is a game rule: probability never runs out, the ball always exists somewhere with total weight 1. Renormalising after absorbing diffusion makes the effective dynamics nonlinear (a mild global gain), and so does the catch (it reads psi to decide what to do to it): psi is not a linear-quantum object.

4.5 **Phases outside play.** In `goal` the wave keeps evolving (`evolve` is still called) while players are frozen in place; their catches and wells keep acting from the frozen stances. In `waiting` and `countdown` psi is frozen.

## 5. Goals and measurements

5.1 **Goal probability (`goalProbabilities`).** For each end, the sum of rho over cells with centre inside `H/2 +- goalHeight/2` and within `GOAL_DEPTH = 6` cells of the end wall. Computed from `density()`, hence includes the mirror sum in additive mode.

5.2 **Scoring (`checkGoals`).** Each tick, if `max(left, right) > threshold` (default 0.1; sliders 0.05 to 0.9) a goal is scored by the team **opposite** the goal that filled: the ball in the right goal scores for team 0 (which attacks right). There is no collapse and no randomness: the threshold is a deterministic criterion on the density. After the 2.5 s pause the wave is discarded and replaced by a fresh still packet (`kickoff`). If both goals cross on the same tick the point goes to the team behind (team 0 on equal scores), see ASYMMETRY.md cause 4.

5.3 **Why the numbers matter.** The goal rectangle is `6 x 20 = 120 m^2` of 5000 m^2 (2.4 %), so a uniform ball puts 2.4 % in each goal and a threshold of 0.1 needs the density concentrated about 4 times above uniform there. This is why wells, passes and walls that herd the wave matter.

5.4 **Diagnostic scalars (HUD, not game rules).**
- `characteristicLength()`: participation length `1 / sum(rho_x^2)` along x (uniform: 100 m; lowest mode: 66.7 m; Gaussian of std s: 3.54 s).
- `wavesAcrossWidth()`: `W * k_rms / (2 pi)` from finite differences of psi along x. Lowest mode 0.5, plane wave with 3 wavelengths 3.

## 6. Where the model is not really physics (critical notes)

6.1 **Player influence is a design choice, not a force law.** A catch is a non-unitary, nonlinear local operation (it reads psi), followed by a local renormalisation; only Dribble's well is a potential. Players add energy (kicks) and remove it (absorption) at will, as a player would with a real ball. Energy reasoning about the free wave (2.3, 2.4) holds between catches.

6.2 **Smoothing is a numerical stabiliser that damps fast balls more (4.3).** At the default (0.02) it is light; at the old `waves` level (1) it wipes out any kick within a second.

6.3 **Additive mode is not unitary quantum mechanics.** Summing densities of mirror images is a classical-looking probability sum over image sources. It is mirror-consistent and fair, but the ball in this mode has no interference with its own rebound.

6.4 **The tuning is done on bots.** Numbers like "L about 50 m" or "goals about 5 per match" come from scripted bot matches (SPEC.md), not from human playtests.

6.5 **Stability margin is only checked by the defaults.** See 4.2.

## 7. Parameter-to-effect cheat sheet

| Parameter | Default | Acts on | Physical meaning |
|---|---|---|---|
| `timeScale` | 12 | `gdt = dt * timeScale` | wave clock vs. player clock; with `mass`, `hbar/m = timeScale / mass` sets fringe spacing and spreading (2.3) |
| `mass` | 0.5 | kinetic coefficient `1/(2m)` | inertia against `timeScale`; speeds in m/s do not depend on it |
| `attenuation` | 0.02 | `smooth` | diffusion coefficient `attenuation / 2` per game-s; damps fast balls more (4.3) |
| `packetWidth` | 4 | `kickoff` | initial std of the density (m) |
| `goalHeight`, `threshold` | 20, 0.1 | `goalProbabilities`, `checkGoals` | size of the goal window; probability needed to score |
| `runSpeed` | 12 | `setOrder`, `movePlayers` | player speed (m/s, real time) |
| `reach` | 4.5 | catch zone | zone radius (Defense 1.5 x), the player on its edge |
| `catchSpeed` | 15 | `catchPlan` blur | speed relative to the player above which a ball is hard to catch: chance per crossing `exp(-(v / catchSpeed)^2)` |
| `absorbMean`, `absorbSpread` | 0.6, 0.25 | catch components | share of relative momentum removed on a catch (Gaussian) |
| `kickSpeed` | 22 | catch components | speed given to the caught share, times the gain: Shot 1, Defense 0.7, Pass 0.55, Dribble 0 |
| `wellDepth` | 0.5 | Dribble well | holding depth (energy units, hbar = 1) |
| `autoAim` | 1 | `aims` | 0 = along heading |
| `additive` | 0 | `setGrid`, `density` | 0 Dirichlet, 1 mirrored torus (next kick-off) |

## 8. How to verify the physics

- Unit tests: `node --test 'test/sim.test.js'` (total probability stays 1 within the renormalisation tolerance, wall reflection, eigenmode stays stationary, additive-wall conservation, goal rules, aim, mirror symmetry, stances and pass split, fast and head-on balls hard to catch, move orders).
- Mirror error of the dynamics: `node tools/symmetry.js` (should stay at about 1e-14).
- Preset statistics (L, waves, goals): `node tools/variants.js`.
