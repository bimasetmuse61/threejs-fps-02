// Trace the defusing defender's state after a bot plant.
export default async function traceDefuse(cdp) {
  await cdp.waitFor('window.__game !== undefined', 20000);
  const rect = await cdp.eval(`JSON.stringify(document.querySelector('#play').getBoundingClientRect())`);
  const { x, y, width, height } = JSON.parse(rect);
  await cdp.click(x + width / 2, y + height / 2);
  await cdp.sleep(800);
  await cdp.eval(`window.__game.skipBuy()`);
  const site = await cdp.eval(`window.__game.state.bombSite`);
  const coords = site === 'A' ? [-20, -13] : [20, -13];
  await cdp.eval(`
    window.__game.bots.bots.filter(b => b.team === 'ember').forEach((b, i) => {
      b.body.position.set(22 + i, 0, -18);
      b.body.velocity.set(0, 0, 0);
      b.state = 'hold'; b.target = null; b.holdUntil = 9999;
      window.__game.bots.syncFigures();
    });
    const c = window.__game.bots.carrier();
    c.body.position.set(${coords[0]}, 0, ${coords[1]});
    c.body.velocity.set(0, 0, 0);
    c.state = 'hold'; c.target = null;
  `);
  await cdp.waitFor(`window.__game.state.bombState === 'planted'`, 20000, 500);
  console.log('planted at site ' + site);
  await cdp.eval(`
    window.__game.bots.bots.filter(b => b.team === 'vanguard').forEach((b, i) => {
      b.body.position.set(-4 + i * 3, 0, 12);
      b.body.velocity.set(0, 0, 0);
      b.state = 'hold'; b.target = null; b.holdUntil = 9999;
    });
    window.__game.player.state.alive = false;
    window.__game.player.state.health = 0;
    const d = window.__game.bots.bots.find(b => b.team === 'ember');
    d.body.position.set(${coords[0] + 1}, 0, ${coords[1] + 1});
    d.state = 'hold'; d.target = null;
    window.__game.bots.syncFigures();
  `);
  for (let i = 0; i < 16; i += 1) {
    await cdp.sleep(500);
    const s = await cdp.eval(`(() => { const d = window.__game.bots.bots.find(b => b.team === 'ember'); return JSON.stringify({phase: window.__game.state.phase, bomb: window.__game.state.bombState, dState: d.state, dTarget: d.target ? d.target.name : null, dProg: d.defuseProgress.toFixed(2), dPos: d.body.position.x.toFixed(1) + ',' + d.body.position.z.toFixed(1), dYaw: d.body.yaw.toFixed(2)}); })()`);
    console.log(s);
  }
}
