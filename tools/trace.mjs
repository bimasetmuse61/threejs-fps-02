// Trace the carrier bot's state machine for 6s after teleporting it to its site.
export default async function trace(cdp) {
  await cdp.waitFor('window.__game !== undefined', 20000);
  const rect = await cdp.eval(`JSON.stringify(document.querySelector('#play').getBoundingClientRect())`);
  const { x, y, width, height } = JSON.parse(rect);
  await cdp.click(x + width / 2, y + height / 2);
  await cdp.sleep(800);
  await cdp.eval(`window.__game.skipBuy()`);
  const site = await cdp.eval(`window.__game.state.bombSite`);
  const coords = site === 'A' ? [-20, -13] : [20, -13];
  await cdp.eval(`
    window.__game.bots.bots.filter(b => b.team === 'ember').forEach(b => { b.alive = false; b.health = 0; b.state = 'dead'; b.figure.group.visible = false; });
    const c = window.__game.bots.carrier();
    c.body.position.set(${coords[0]}, 0, ${coords[1]});
    c.body.velocity.set(0, 0, 0);
    c.state = 'hold';
    c.target = null;
    window.__game.bots.syncFigures();
  `);
  for (let i = 0; i < 12; i += 1) {
    await cdp.sleep(500);
    const s = await cdp.eval(`JSON.stringify({t: (window.__game.state.timeLeft).toFixed(1), phase: window.__game.state.phase, bomb: window.__game.state.bombState, holder: typeof window.__game.state.coreHolder === 'string' ? window.__game.state.coreHolder : (window.__game.state.coreHolder && window.__game.state.coreHolder.name), cState: window.__game.bots.carrier().state, cPos: window.__game.bots.carrier().body.position.x.toFixed(1) + ',' + window.__game.bots.carrier().body.position.z.toFixed(1), path: window.__game.bots.carrier().path.join('/'), inv: window.__game.bots.carrier().investigateNode, holdUntil: window.__game.bots.carrier().holdUntil.toFixed(1), target: window.__game.bots.carrier().target ? window.__game.bots.carrier().target.name : null, progress: window.__game.bots.carrier().plantProgress.toFixed(2)})`);
    console.log(s);
  }
}
