# Emberline — a tactical FPS in three.js

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/bimasetmuse61/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/bimasetmuse61/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A round-based, Counter-Strike-style tactical FPS that runs offline from static
files: two teams of five, a bomb-like core to plant and defuse, money earned
each round and spent in a buy menu, and bots that route, hold, see, hear and
shoot back. Single-player against bots, built on three.js 0.187.0 (vendored).

## Play

```sh
node serve.ts        # serves game/ on http://localhost:8080
```

Open the page, click to play (pointer lock), and fight. First team to 8
rounds takes the match.

- **W A S D** move, **mouse** look, **click** fire, **R** reload, **G** grenade
- **E** (hold) plant the core at a marked site, **1–4** switch weapon
- **B** opens the buy menu during the buy phase; **Ctrl** crouch, **Space** jump

Vanguard attacks: plant the core at Silo (Site A) or Depot (Site B), or
eliminate the Ember team. Ember defends and defuses. Kills pay $300, a round
win $3,250, a loss $1,900. The shop sells the Hornet SMG, the Longbow AR,
the Falcon DMR and Spark grenades.

## Build

`main.ts` (Node 22, standard library only) copies `game/` and `screenshots/`
to the output directory and writes `dossier.json` with the kit's vendored
`vendor/makefun-threejs.ts`:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Layout

- `game/index.html` — the page and the whole HUD (DOM + CSS)
- `game/src/main.js` — boot, the fixed 60 Hz loop, shooting, screenshots
- `game/src/map.js` — Cinder Yard: the map, cover, and the bots' nav graph
- `game/src/bots.js` — bot AI: routes, holds, perception, bursts, plant/defuse
- `game/src/rounds.js` — the match: buy phase, rounds, money, the core
- `game/src/combat.js` — hitscan, tracers, grenades, explosions
- `game/src/player.js`, `game/src/mover.js` — the shared body mover
- `game/src/weapons.js` — the four guns, the view model, the inventory
- `game/src/audio.js` — synthesised WebAudio sound, no audio files
- `game/src/hud.js`, `game/src/input.js`, `game/src/palette.js`, `game/src/rng.js`
- `tools/` — the headless-Chromium play-test driver (CDP) and the tests

## Entry

An entry for the make.fun competition `threejs-fps-02` ("Best three.js
tactical FPS"). MIT licensed.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
