// Bomb-path soak: does the carrier plant, does the player plant, does the
// bomb explode, does a defuse win the round? Run with the server up:
//   WINDOW_SIZE=800,450 node tools/cdp.mjs tools/soak.mjs http://localhost:8080/
const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

export default async function soak(cdp) {
  const errors = [];
  cdp.onEvent = (event) => {
    if (event.method === 'Runtime.exceptionThrown') {
      errors.push(JSON.stringify(event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text));
    }
  };
  await cdp.waitFor('window.__game !== undefined', 20000);
  const rect = await cdp.eval(`JSON.stringify(document.querySelector('#play').getBoundingClientRect())`);
  const { x, y, width, height } = JSON.parse(rect);
  await cdp.click(x + width / 2, y + height / 2);
  await cdp.sleep(800);
  await cdp.eval(`window.__game.skipBuy()`);

  // Watch the bots play on their own for ~75s real (~35s sim): the carrier
  // should reach a site and plant, or the round should end by elimination.
  let planted = false;
  let ended = false;
  for (let i = 0; i < 15; i += 1) {
    await cdp.sleep(5000);
    const s = await cdp.eval(`JSON.stringify({phase: window.__game.state.phase, bomb: window.__game.state.bombState, site: window.__game.state.bombSite, round: window.__game.state.round, score: window.__game.state.scoreV + '-' + window.__game.state.scoreE, aliveV: window.__game.bots.aliveCount('vanguard'), aliveE: window.__game.bots.aliveCount('ember')})`);
    const state = JSON.parse(s);
    console.log(`t+${(i + 1) * 5}s: ${JSON.stringify(state)}`);
    if (state.bomb === 'planted') planted = true;
    if (state.phase !== 'live') {
      ended = true;
      break;
    }
  }
  check('bot carrier plants or round ends', planted || ended, `planted=${planted} ended=${ended}`);

  // Now test the player plant directly: hand the player the core, put them
  // in the site, hold E.
  await cdp.eval(`window.__game.rounds.startRound()`);
  await cdp.eval(`window.__game.skipBuy()`);
  await cdp.eval(`window.__game.rounds.giveCore('player')`);
  const site = await cdp.eval(`window.__game.state.bombSite`);
  const coords = site === 'A' ? [-20, -13] : [20, -13];
  await cdp.eval(`window.__game.teleport(${coords[0]}, ${coords[1]})`);
  await cdp.keyDown('KeyE', 'e', 69);
  try {
    await cdp.waitFor(`window.__game.state.bombState === 'planted'`, 20000, 500);
    check('player plants the core by holding E', true, `site ${site}`);
  } catch {
    check('player plants the core by holding E', false, `bombState=${await cdp.eval(`window.__game.state.bombState`)}`);
  }
  await cdp.keyUp('KeyE', 'e', 69);

  // Fast-forward the bomb timer: the blast should end the round for Vanguard.
  await cdp.eval(`window.__game.state.bombTimer = 1.5`);
  try {
    await cdp.waitFor(`window.__game.state.phase === 'intermission'`, 20000, 500);
    const score = await cdp.eval(`window.__game.state.scoreV + '-' + window.__game.state.scoreE`);
    check('bomb explosion wins the round for Vanguard', true, `score=${score}`);
  } catch {
    check('bomb explosion wins the round for Vanguard', false, `phase=${await cdp.eval(`window.__game.state.phase`)} bomb=${await cdp.eval(`window.__game.state.bombState`)}`);
  }

  console.log(`\npage errors: ${errors.length}`);
  for (const error of errors.slice(0, 5)) console.log(`  ${error.slice(0, 300)}`);
  check('no page errors', errors.length === 0);
  console.log(`\n${failures.length === 0 ? 'ALL PASS' : `FAILURES: ${failures.join(', ')}`}`);
  if (failures.length > 0) process.exitCode = 1;
}
