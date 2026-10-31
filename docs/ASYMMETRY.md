# Left/right asymmetry: investigation and fixes

**Symptom.** Bot matches were not fair between the sides. A bot playing *itself* (a mirror match, where the result should be level) gave `shadow` 14-0 in one round robin, `relay` 6-0 and `shadow` 4-0 in another, and `shadow` as blue beat other bots that it lost to as red.
The game is built to be mirror-symmetric (pitch, packet, goals, kick-off positions), so any systematic difference is a bug.

**Method** (`node tools/symmetry.js`, regression tests named `symmetry [asymmetry fix]`):
1. *Physics alone.* Give both teams mirror-image orders (`vx -> -vx`, same `vy`) and stances, and measure the largest `|rho(x,y) - rho(W-1-x,y)|` over 60 s. If the physics is symmetric this stays at rounding level (1e-14).
2. *Each bot against its own mirror.* Same measure, with the bots choosing the orders. The tick of the first difference above 1e-9 points at the cause.
3. *Side bias.* Round robin of the seven bots, 49 matches of 90 s: (blue goals - red goals) / all goals.

## What was found

| # | Cause | Where | Evidence | Fix |
|---|---|---|---|---|
| 1 | **Truncated windows were not mirror images.** `forBox` took cells `floor(c - r) .. ceil(c + r)`: one extra cell on the + side of every well, wall, and kick window. Mirrored players therefore saw slightly different Gaussians (tails of about 1e-4 of the peak). | `sim.js` `forBox` | Mirror error 1 % of the peak (default) and 20 % (additive). Static Defense and Pass at integer positions were exact (7e-14), static Attack was not (1.3e-3): bisected to the well and kick windows. | Take exactly the cells whose centre is within the radius (`ceil(c-r-0.5) .. floor(c+r-0.5)`). Mirror error is now 5e-14 in all presets and stances. |
| 2 | **The second passer's sideways offset was not mirrored.** `passers()` offset the two kickers by `+-2 m` along the *perpendicular* of the attack direction; for team 1 that perpendicular points the other way in y. | `bots.js` `passers` | `receiver` and `shadow` (and `turns`) diverged at tick 0. | Multiply the offset by the attack direction, so team 1's offset is the mirror image of team 0's. |
| 3 | **Float noise decided a tie.** `shadow` picks the two most advanced opponents with a bare `sort`. Two opponents exactly level in x differed by about 1e-14 on one side only, so the two teams marked different players from tick 4 on. | `bots.js` `shadow` | The first-difference tick (0.13 s) and a print of the marks per tick: team 0 marked 6,7 and team 1 marked 3,2 instead of 2,3. | Treat distances within 1 micrometre as equal and fall back to the player number. |
| 4 | **Ties always went to team 0.** If both goals crossed the threshold on the same tick (which only happens in symmetric play) `r >= l` gave the point to team 0. | `sim.js` `checkGoals` | Reading the code; a unit test with both goals equal. | An exact tie goes to the team behind on goals (team 0 on equal scores). |

## Result

- Physics, mirrored actors: mirror error **1e-14** in default, waves and additive (before: 7e-4 absolute / 1 % relative, and 2e-3 / 20 % for additive).
- Bots against their own mirror: `receiver, fortress, shadow, lanes, relay, plow` never leave 1e-9 (largest 9e-13). Mirror matches are now level (`shadow` 0-0 instead of 4-0 or 14-0; `relay` 3-3 instead of 6-0).
- Round robin side bias: **-0.01** after (blue 84, red 85 goals). It was already small *in total* before (+0.03: blue 92, red 86) because the errors cancelled across matchups; the problem was inside particular matchups, where a bot won or lost depending on its colour.

## What is left, on purpose

- **`turns` is asymmetric by design:** one team has to attack first (team 1 does, for the first 12 s, then they alternate). It is the one bot that fails the mirror test. If that matters, alternate the first mover per kick-off.
- **Chaos amplifies tiny differences.** Where a bot's decision is a hard threshold on a noisy quantity (the next candidate for the next tie), a 1e-14 difference can again split the two sides. The fixes above remove the ties known today; `tools/symmetry.js` and the tests are the net for new bots. Rule for new strategies: no bare `sort` or `<` on values that can be exactly equal, and offsets along a *perpendicular* must be multiplied by the attack direction.
- **Human play** is symmetric in the same way (kick-off positions are mirrored). Blue is on the left and red on the right, so a human may still prefer a side for reasons of the screen, not of the game.
