# Three ways to play: default, waves, additive walls

Which parameter set is the most fun to play, and which gives a human the most interesting options? This is a reasoned comparison, **not a playtest**:
nobody has played these with a mouse. The evidence is (1) frames and videos of bot matches, (2) numbers from `node tools/variants.js [preset]`
(bots, 120 s matches, single deterministic runs: indicative only, a small change can swing a count by a few goals).

## The variants (presets in `sim.js`, `PRESET=<name> node server.js`)

| Preset | What changes | Why |
|---|---|---|
| `default` | the tuned defaults (ball length about half the pitch) | the baseline |
| `waves` | time speed 12, mass 0.5, attenuation 1, kick 0.3, wall 1, well 0.3 | **2 to 3 waves across the pitch length** instead of about 15 |
| `additive` | default physics, but wall rebounds add probability instead of interfering | **no destructive interference at the walls** |
| `hybrid` | waves + additive + well 1 | an experiment, see below. Not recommended |

*Waves across the width* is `N = W * k_rms / 2 pi` (`wavesAcrossWidth()`): the lowest standing mode reads 0.5, a plane wave with three wavelengths reads 3.
The default had a median N of about 16 over the bot matches (the fine "gravel" in screenshots); `waves` brings it to 2.7. Two honest limits: N swings a lot in time
(it is above 3 for a good share of the match, only about a third of the time is inside 2-3), and the literal "final match" `plow` vs `plow` stays near 1.2 in `waves`:
two lines of walls only push the ball slowly and cannot excite short waves.

*Additive walls* unfold the pitch into a mirrored 2W x 2H torus. The ball evolves freely there and the pitch shows the **sum of the densities of the four mirror images**:
a rebound adds probability, never cancels it, so there are no nodes at the walls (test: wall-cell density is 0.94 of the peak against 0.21 for the coherent wall).
The ball still interferes with *itself* (kicks, wells and walls make fringes), only the wall rebound is incoherent. It costs a 4x larger grid.

## Measurements (bots, 6 pairings, 120 s each; options: 90 s)

| | default | waves | additive | hybrid |
|---|---|---|---|---|
| median waves across the width | 15.7 | **2.7** | 19.7 | 2.1 |
| ball length L (m), mean | 47 | 44 | 35 | 37 |
| time with L in 35-65 m | 65 % | 73 % | 34 % | 44 % |
| goals per match, both sides | 2.8 | 4.5 | 2.2 | 2.3 |
| standing pass: ball shifted (m) | +21 | +14 | +16 | +10 |
| attack "carry" for 10 s: ball shifted (m) | +3.6 | **-17** | +3.3 | -2.7 |
| bot styles that score unopposed in 90 s (of 6) | **5** | 3 | 2 | 1 |
| goals vs the fortress bot (best style) | 5 (shadow) | **0** | 6 (shadow) | 0 |

Bot styles: `turns receiver shadow relay plow lanes`. "Carry" = one attacker running at 6 m/s with the well on; a negative number means the ball escaped backwards.

## What it looks like

![default, waves, additive, top to bottom](img/variants.png)

- **default**: speckle. Many fine fringes (15 waves): the ball looks like gravel and a kick, a wall and a well all end up as the same noise. Information is there but hard to read by eye.
- **waves**: smooth lobes that the walls visibly carve and the players visibly feed. When a line of walls moves, you see the ball bunch up in front of it and leave a shadow behind. This is the clearest picture of cause and effect of the three.
- **additive**: crisp travelling fronts, a ring spreading from a kick, and bright bands piling up along the walls (no nodes there, so the ball "sticks" to the pitch edge and into the corners). Easy to read, but the edges become dominant.

## Which is more fun, and which has the better options?

**To watch: `waves`.** The shapes are large, slow and attributable. A viewer can follow what a team is doing, and the ball length stays near half the pitch for 73 % of the time.

**For options: nothing wins yet, and the numbers disagree with the looks.**
- `default` keeps the most ways to score: 5 of 6 styles score unopposed, and passing moves the ball furthest. Its weakness is legibility.
- `waves` is the most *watchable* but has the **narrowest set of working options**: carrying the ball fails (the weaker well loses the ball: -17 m), the fortress bot concedes nothing, and only 3 styles score unopposed. Defence beats attack, so a human who attacks has little to try, and a human who defends has one dominant answer.
- `additive` is better for intuition (a rebound adds probability, so the wall is a tool, not a trap: shadow scores 6 against the fortress, the best of all variants) but only 2 styles score, and L drops to 35 m: the ball is squeezed against the walls more often.
- `hybrid` (waves + additive + deeper well) was tried to get the best of both: it is **worse than either parent** (only `turns` scores, 0 against the fortress). Mixing presets is not additive; do not stack them blindly.

**Recommendation.** Make `waves` the look to aim for and fix its options, rather than adopting any preset as is:
1. Keep time speed 12, mass 0.5, attenuation 1 (they set the 2-3 waves) and **raise the kick** (0.3 -> about 1): passing and the attack push come back without adding fringes, because the smoothing caps the wavenumber.
2. Restore carrying with a **deeper well but wider reach**, not a deeper well alone (the hybrid shows that depth is not enough).
3. Weaken the defence in this regime (wall 1 -> lower, or a shorter reach for defenders) so attack styles can beat the fortress.
4. Only then try the additive walls for the goal strips: in coherent mode the goal sits where the density has a node (a wall), in additive mode it does not. That is the one place where it should clearly help, and `shadow` vs `fortress` suggests it does.
Each step is a slider or a preset line; `node tools/variants.js <preset>` reruns the table (about a minute).

## Caveats
- Bots are not humans; the "options" counts are how many *scripted* styles work, a proxy for how many *human* ideas work.
- Single runs; the pool is six pairings; the sim is deterministic but chaotic, so neighbouring settings swing goal counts by a few.
- Waves across the width is measured on the whole field (RMS wavenumber along x): a few fast ripples raise it. The median is the fair number; the mean is higher.
