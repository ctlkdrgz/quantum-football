# Research: Greg Egan's Quantum Soccer

"Quantum football" is **Quantum Soccer**, the game played in Greg Egan's novelette *Border Guards* (1999).
Egan also published a Java applet and technical notes:

- Game page: https://www.gregegan.net/BORDER/Soccer/Soccer.html
- Technical notes: https://www.gregegan.net/BORDER/Soccer/SoccerNotes.html

**Caveat: gregegan.net was not reachable from the cloud session (host not allowed by the network policy).**
What follows comes from search-engine summaries of those pages, not from reading them. Verify against the originals
before relying on any detail marked (verify).

## What the game is (as summarised)

- The ball is a quantum wave function, not a point. The pitch is a 2D square well with infinitely high walls:
  the wave reflects at the boundary and cannot tunnel out. Pitch 100 m x 50 m.
- The wave function is a sum of energy eigenfunctions of the 2D square well (quantum numbers n, p), with adjustable
  amplitudes. The probability density is a constant plus cosine terms at the *beat frequencies* between eigenfunctions.
- Players do not touch the ball. They move across the field, and their motion changes the energy spectrum of the wave:
  a player can add or remove energy, which drives transitions between eigenmodes. Significant coupling happens only when
  a beat frequency matches (energy difference)/hbar. Which pairs couple depends on the player's velocity (verify).
- Goal: shape the wave so the probability of the ball being inside a goal passes a threshold (the applet shows the
  probability for each goal). On "measurement" the wave function is projected into the subspace matching the result
  (verify: exact rule and threshold).
- Reference given in the notes: Schiff, *Quantum Mechanics* (1968) (verify).

## What this prototype borrows, and what it simplifies

| Egan | This prototype |
|---|---|
| Sum of 2D square-well eigenmodes | Direct grid simulation of the Schroedinger equation (leapfrog); eigenmodes appear on their own (see the stationary-wave test) |
| Player motion couples modes via velocity | A moving potential (well / wall) and phase kicks pump energy into the wave; no hand-written selection rules |
| Goal probability above a threshold | Same. Threshold is a slider. No projective measurement: a goal resets the wave to a fresh packet |
| One player per side, pitch 100x50 | Same, 1 cell = 1 m |
| (no stances) | Attack / Defense / Pass stances (the task's addition) |

Possible next step closer to Egan: replace the grid by an eigenmode expansion and let player speed select which mode pairs couple.
