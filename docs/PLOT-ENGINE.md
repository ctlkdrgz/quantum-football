# The ball's characteristic length as a plot engine

**L = 1 / sum(rho_x^2)**, in metres: how much of the 100 m pitch length the ball occupies right now (definition and tuning in `SPEC.md`).
It is one number that every player can see and that physics, not a script, keeps moving. That makes it a good candidate for the thing a game's story hangs on.
All numbers below come from this sim (default settings, scripted bots, few runs: indicative, not statistics).

## 1. What L says

| L | The ball is... | Feels like | Notes |
|---|---|---|---|
| under ~10 m | a point-like blob, about one player reach | billiards: aim, kick, it goes | lives briefly: a free packet with L = 10 m doubles in about 4 s (t = 2 sqrt(3) m s^2 / hbar, s = L/3.54, game time / time speed) |
| 10-30 m | a few reaches wide | classical-ish play, goals are "shots" | what the `fortress` bot pushes the game toward (mean 33 m) |
| about 50 m (the tuned default) | half the pitch | wave play: you push *part* of the ball, parts reflect and interfere | kick-off value 49.6 m; bot matches average 46 m |
| 65-80 m | smeared over most of the pitch | fog: standing waves, nothing is anywhere | lowest standing mode is 66.7 m; an untouched ball breathes 50 -> 80 -> 65 m over 3 minutes |
| 100 m | uniform | nothing to play with | the ceiling |

A player's influence has a size (reach, 8 m). L / reach is therefore "how much of the ball one player can handle": about 6 at the default, 1 when the ball is cornered.

## 2. L as a pacing engine (what a director could do with it)

The match already has a natural arc, and L traces it: kick-off packet (50 m) -> it spreads (up to 80 m, the "fog") -> players squeeze it (down to 10-20 m) -> a goal is a
measurement: the ball is reset to a fresh 50 m packet. A **director** that only reads L (and goal probabilities) can shape that arc without touching the rules of physics:

- **Act structure.** Overture (L close to 50, nobody has the ball), Development (L falling as teams grab it), Crisis (L < 20 and a goal probability above half the threshold:
  the ball is cornered), Resolution (goal or the ball escapes, L jumps). Commentary, music, camera and UI can key on those thresholds.
- **Anti-stall.** L above 80 for 10 s: fog event, a "tremor" kicks the ball (a free phase kick). L below 12 for 10 s: the ball is pinned, release it with a short attractive/repulsive pulse. Both are cheap and fair, since they act on the ball, not on a team.
- **Comeback mechanics.** The trailing team gets a deeper well or a stronger kick for a while (the sliders are per-match today, but are just numbers in the sim). L tells *when*: help is wasted when the ball is smeared and decisive when it is compact.
- **The uncertainty principle as the villain.** Squeezing L costs: a squeezed packet has a broad momentum spread, so it explodes. Every squeeze is a countdown (4 s at L = 10 m, about 95 s at L = 50 m). That is a built-in tension curve: *how long can you hold it small before it escapes?*
- **Measurement as climax.** In Egan's original, reaching the goal threshold collapses the wave function. Here it only resets. Making the collapse real (project the ball into the goal, or into the *complement*, with the probabilities) turns every near-miss into a dice roll at the moment of maximum tension.

## 3. L as a story/campaign engine

- **Leagues by regime.** The same game with a different L: a *Newtonian league* (packet width 3: L about 10, the ball behaves like a ball), a *Bohr cup* (L about 25), the *Everett final* (L about 50 or more: the ball is everywhere and scoring is about interference). The player's career is learning to play in ever more quantum regimes.
- **Opponents as characters with a preferred L.** The bots already have fingerprints (mirror matches, mean L): fortress 33, relay 45, turns 45, shadow 46, plow 50, receiver 60, lanes 66. A character "compresses" (fortress, a squeezer) or "diffuses" (lanes, a smearer); a rival's backstory can be a number.
- **Objectives other than goals.** "Hold L under 15 m for 10 s", "get L from 70 to 20 m in under 15 s", "score while L is under 8 m" (a precision goal worth double). Solo puzzle levels fall out for free: no opponent, a target L, a clock.
- **Reading Egan.** *Border Guards* is a story about quantum games, measurement and who gets to be an observer. L is a visible measure of *how undecided the world is*: a plot can ask the players to decide when to force a measurement, and what they lose by doing so (the ball's other possibilities are gone).
- **Spectators.** A live plot of L and the two goal probabilities is a "win probability" graph that is actually physical. The broadcast can say "the ball is 22 metres wide and 9 % in the red goal".

## 4. Sketch of an implementation

A small `director` module, server-side, once per tick, with hysteresis so events do not flicker:

```
read  L (smoothed), goalP, score, time left
state fog | pinned | crisis | calm        (thresholds 80 / 12 / 20 / else, entered after 1 s, left after 3 s)
emit  events to clients      -> UI/narration
apply tremor / release pulse -> a phase kick or a potential bump on psi
set   per-team multipliers   -> comeback
```

L is already in every `state` message (`length`); the rest is rules and presentation.

## 5. Caveats and open questions

- L is measured on the long axis only, and the participation length is sensitive to nodes (a standing wave with deep nodes reads *more* compact than it feels). A 2D version, or an entropy-based length, may be better. Smooth it (an exponential average) before using it as a trigger.
- The tuning (`SPEC.md`) is by bots, not people. Whether "half the pitch" is fun, or just hard to push, needs real players. The tuned set is one point in a noisy landscape; goal rates varied from 3 to 8 per match across nearby settings.
- The bots are not symmetric between sides (the shadow bot scored 14-0 as blue in its mirror match but loses as red against others). That should be understood before any comeback logic is added.
- A director that nudges the ball is a rule about who is allowed to bend the physics. In a two-player online game that is a design decision, not a detail.
