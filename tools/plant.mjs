// Bot-plant check: put the carrier bot on its site and confirm it plants
// the core on its own within a few simulated seconds.
//   WINDOW_SIZE=800,450 node tools/cdp.mjs tools/plant.mjs http://localhost:8080/
export default async function plant(cdp) {
  const errors = [];
  cdp.onEvent = (event) => {
    if (event.method === 'Runtime.exceptionThrown') errors.push(JSON.stringify(event.params.exceptionDetails));
  };
  await cdp.waitFor('window.__game !== undefined', 20000);
  const rect = await cdp.eval(`JSON.stringify(document.querySelector('#play').getBoundingClientRect())`);
  const { x, y, width, height } = JSON.parse(rect);
  await cdp.click(x + width / 2, y + height / 2);
  await cdp.sleep(800);
  await cdp.eval(`window.__game.skipBuy()`);
  const site = await cdp.eval(`window.__game.state.bombSite`);
  const coords = site === 'A' ? [-20, -13] : [20, -13];
  // Move the defenders to the far site so the carrier is not engaged, then
  // drop the carrier right on its site. (Killing them would end the round
  // by elimination before the plant finishes.)
  await cdp.eval(`
    window.__game.bots.bots.filter(b => b.team === 'ember').forEach((b, i) => {
      b.body.position.set(22 + i, 0, -18);
      b.body.velocity.set(0, 0, 0);
      b.state = 'hold';
      b.target = null;
      b.holdUntil = 9999;
      window.__game.bots.syncFigures();
    });
    const c = window.__game.bots.carrier();
    c.body.position.set(${coords[0]}, 0, ${coords[1]});
    c.body.velocity.set(0, 0, 0);
    c.state = 'hold';
    c.target = null;
  `);
  try {
    await cdp.waitFor(`window.__game.state.bombState === 'planted'`, 20000, 500);
    console.log(`PASS bot carrier plants on its own — site ${site}`);
  } catch {
    const s = await cdp.eval(`JSON.stringify({bomb: window.__game.state.bombState, carrierState: window.__game.bots.carrier().state, progress: window.__game.bots.carrier().plantProgress})`);
    console.log(`FAIL bot carrier plants on its own — ${s}`);
    process.exitCode = 1;
  }
  // And the defuse: move the attackers away from the site and take the idle
  // player out of the defender's sight, then bring one defender back next
  // to the bomb and watch it defuse.
  await cdp.eval(`
    window.__game.bots.bots.filter(b => b.team === 'vanguard').forEach((b, i) => {
      b.body.position.set(-4 + i * 3, 0, 12);
      b.body.velocity.set(0, 0, 0);
      b.state = 'hold';
      b.target = null;
      b.holdUntil = 9999;
    });
    window.__game.player.state.alive = false;
    window.__game.player.state.health = 0;
    window.__game.bots.syncFigures();
  `);
  await cdp.eval(`
    const d = window.__game.bots.bots.find(b => b.team === 'ember');
    d.alive = true; d.health = 100; d.state = 'hold'; d.target = null;
    d.body.position.set(${coords[0] + 1}, 0, ${coords[1] + 1});
    d.figure.group.visible = true;
    window.__game.bots.syncFigures();
  `);
  try {
    await cdp.waitFor(`window.__game.state.phase === 'intermission'`, 30000, 500);
    const score = await cdp.eval(`window.__game.state.scoreV + '-' + window.__game.state.scoreE`);
    console.log(`PASS defender defuses the planted core — score ${score}`);
  } catch {
    console.log(`FAIL defender defuses — phase=${await cdp.eval(`window.__game.state.phase`)} bombTimer=${await cdp.eval(`window.__game.state.bombTimer`)}`);
    process.exitCode = 1;
  }
  console.log(`page errors: ${errors.length}`);
  for (const e of errors.slice(0, 3)) console.log(`  ${e.slice(0, 200)}`);
}
