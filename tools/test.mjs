// Play-test: load the game, click play, move, shoot, throw a grenade, watch
// the bots fight a round, and report what happened. Run with:
//   node serve.ts --port 8080 &
//   node tools/cdp.mjs tools/test.mjs http://localhost:8080/
const errors = [];
const failures = [];
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(name);
}

export default async function test(cdp) {
  cdp.onEvent = (event) => {
    if (event.method === 'Runtime.exceptionThrown') {
      errors.push(JSON.stringify(event.params.exceptionDetails.exception?.description ?? event.params.exceptionDetails.text));
    }
    if (event.method === 'Log.entryAdded' && event.params.entry.level === 'error') {
      errors.push(event.params.entry.text);
    }
  };
  await cdp.waitFor('window.__game !== undefined', 20000);
  check('game boots', true);
  check('webgl canvas', await cdp.eval(`!!document.querySelector('#game canvas')`));
  check('bots created', (await cdp.eval(`window.__game.bots.bots.length`)) === 9);
  check('phase starts buy', (await cdp.eval(`window.__game.state.phase`)) === 'buy');

  // Click the play button to request pointer lock.
  const rect = await cdp.eval(`JSON.stringify(document.querySelector('#play').getBoundingClientRect())`);
  const { x, y, width, height } = JSON.parse(rect);
  await cdp.click(x + width / 2, y + height / 2);
  await cdp.sleep(1000);
  const locked = await cdp.eval(`!!document.pointerLockElement`);
  console.log(`pointer lock: ${locked}`);
  check('pointer lock after play click', locked);

  // Buy an SMG with key 2 during the buy phase.
  await cdp.keyPress('Digit2', '2', 50);
  await cdp.sleep(300);
  check('bought smg', (await cdp.eval(`window.__game.inventory.current()`)) === 'smg');
  check('money spent', (await cdp.eval(`window.__game.state.money`)) === 600, `$${await cdp.eval(`window.__game.state.money`)}`);

  // Skip the buy phase and move forward with W.
  await cdp.eval(`window.__game.skipBuy()`);
  const before = await cdp.eval(`JSON.stringify({x: window.__game.player.body.position.x, z: window.__game.player.body.position.z})`);
  await cdp.keyDown('KeyW', 'w', 87);
  await cdp.sleep(2000);
  await cdp.keyUp('KeyW', 'w', 87);
  const after = await cdp.eval(`JSON.stringify({x: window.__game.player.body.position.x, z: window.__game.player.body.position.z})`);
  const b = JSON.parse(before);
  const a = JSON.parse(after);
  check('WASD moves the player', Math.hypot(a.x - b.x, a.z - b.z) > 2, `moved ${Math.hypot(a.x - b.x, a.z - b.z).toFixed(1)}m`);

  // Look with the debug hook (headless pointer-lock mouse deltas are flaky).
  const yawBefore = await cdp.eval(`window.__game.player.body.yaw`);
  await cdp.eval(`window.__game.look(400, 0)`);
  const yawAfter = await cdp.eval(`window.__game.player.body.yaw`);
  check('mouse look turns the view', Math.abs(yawAfter - yawBefore) > 0.5, `yaw ${yawBefore.toFixed(2)} -> ${yawAfter.toFixed(2)}`);

  // Fire at a bot and check ammo drops.
  await cdp.eval(`window.__game.aimAt(0, 1.1, -10)`);
  const ammoBefore = await cdp.eval(`window.__game.weapon.state.mag`);
  await cdp.eval(`window.__game.fire()`);
  await cdp.sleep(200);
  const ammoAfter = await cdp.eval(`window.__game.weapon.state.mag`);
  check('firing spends ammo', ammoAfter === ammoBefore - 1, `${ammoBefore} -> ${ammoAfter}`);

  // Throw a grenade.
  await cdp.eval(`window.__game.inventory.addGrenade(); window.__game.inventory.addGrenade()`);
  await cdp.keyPress('KeyG', 'g', 71);
  await cdp.sleep(300);
  check('grenade thrown', (await cdp.eval(`window.__game.inventory.grenades()`)) === 1);

  // Let the bots fight for a while and watch the round evolve.
  const botsBefore = await cdp.eval(`window.__game.bots.bots.map(b => b.body.position.x.toFixed(1) + ',' + b.body.position.z.toFixed(1)).join(' ')`);
  await cdp.sleep(30000);
  const botsAfter = await cdp.eval(`window.__game.bots.bots.map(b => b.body.position.x.toFixed(1) + ',' + b.body.position.z.toFixed(1)).join(' ')`);
  check('bots move', botsBefore !== botsAfter);
  const alive = await cdp.eval(`window.__game.bots.aliveCount('vanguard') + window.__game.bots.aliveCount('ember') + (window.__game.player.state.alive ? 1 : 0)`);
  const phase = await cdp.eval(`window.__game.state.phase`);
  const score = await cdp.eval(`window.__game.state.scoreV + '-' + window.__game.state.scoreE`);
  console.log(`after 30s of combat: alive=${alive}/10 phase=${phase} score=${score} money=$${await cdp.eval(`window.__game.state.money`)} simTime=${(await cdp.eval(`window.__game.state.timeLeft`))}`);
  check('bots fight and someone dies', alive < 10, `alive=${alive}/10`);
  check('round still live or advanced sanely', phase === 'live' || phase === 'intermission' || phase === 'buy');

  // Fast-forward the round clock to verify the round ends on its own.
  await cdp.eval(`window.__game.setTimeLeft(2)`);
  try {
    await cdp.waitFor(`window.__game.state.phase === 'intermission' || window.__game.state.round > 1`, 30000, 1000);
    check('round ends and advances', true, `round=${await cdp.eval(`window.__game.state.round`)} score=${await cdp.eval(`window.__game.state.scoreV + '-' + window.__game.state.scoreE`)}`);
  } catch {
    check('round ends and advances', false, `stuck in phase ${await cdp.eval(`window.__game.state.phase`)}`);
  }

  console.log(`\npage errors: ${errors.length}`);
  for (const error of errors.slice(0, 10)) console.log(`  ${error.slice(0, 300)}`);
  check('no page errors', errors.length === 0);
  console.log(`\n${failures.length === 0 ? 'ALL PASS' : `FAILURES: ${failures.join(', ')}`}`);
  if (failures.length > 0) process.exitCode = 1;
}
