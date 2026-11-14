// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. main.js owns the wiring — the player entity the bots shoot,
// the shot results, the buy keys, the grenade, the spectate camera — and leaves
// movement to player.js, the round to rounds.js, and the bots to bots.js.
// ?shot=start|play|plant|end with &seed=N stages a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld, SPAWNS } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, createInventory, WEAPON_DEFS, WEAPON_ORDER } from './weapons.js';
import { createCombat } from './combat.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const player = createPlayer(world.colliders);
const weapon = createWeapon(camera);
const inventory = createInventory();
const combat = createCombat(scene, world);
const bots = createBots(scene, world, combat, random);
// Nine bots: four Vanguard teammates (the player is the fifth) and five Ember.
for (let i = 0; i < 4; i += 1) bots.makeBot('vanguard', i, SPAWNS.vanguard[i + 1]);
for (let i = 0; i < 5; i += 1) bots.makeBot('ember', i, SPAWNS.ember[i]);

// The player as a combat target: two invisible hit boxes riding on the camera
// group, so bot rays hit the same body the player sees through.
const playerHitGroup = new THREE.Group();
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const playerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), hitMat);
playerTorso.position.y = 1.06;
const playerHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), hitMat);
playerHead.position.y = 1.55;
playerHitGroup.add(playerTorso, playerHead);
scene.add(playerHitGroup);

const playerEntity = {
  id: 'player',
  name: 'You',
  team: 'vanguard',
  health: 100,
  position: player.body.position,
  velocity: player.body.velocity,
  hitMeshes: [playerTorso, playerHead],
  get alive() {
    return player.state.alive;
  },
  takeDamage(amount, part, attacker) {
    if (!player.state.alive) return false;
    player.state.health -= amount;
    hud.setHealth(player.state.health);
    hud.damageFlash();
    audio.hurt();
    if (player.state.health > 0) return false;
    player.state.health = 0;
    player.state.alive = false;
    hud.setHealth(0);
    return true;
  },
};
playerTorso.userData.entity = playerEntity;
playerTorso.userData.part = 'torso';
playerHead.userData.entity = playerEntity;
playerHead.userData.part = 'head';
combat.registerTarget(playerEntity);

const rounds = createRounds({
  scene, bots, player, inventory, weapon, combat, audio, hud, random,
});

const input = createInput(renderer.domElement, onLockChange);

const eyePos = new THREE.Vector3();
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
let elapsed = 0;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let fireHeld = false;
let spectateBot = null;

function enemiesFor(team) {
  if (rounds.state.phase !== 'live') return [];
  if (team === 'vanguard') return bots.bots.filter((b) => b.team === 'ember' && b.alive);
  return bots.bots.filter((b) => b.team === 'vanguard' && b.alive).concat([playerEntity]);
}

function handleShotResult(shooter, result) {
  if (!result || !result.entity) return;
  const victim = result.entity;
  const shooterName = shooter === playerEntity ? 'You' : shooter.name;
  const weaponName = shooter === playerEntity ? weapon.state.def.name : shooter.def.name;
  if (result.killed) {
    hud.killFeed(shooterName, victim.name, weaponName, result.part === 'head');
    if (shooter === playerEntity) {
      rounds.awardKill();
      audio.kill();
    }
    if (victim === playerEntity) {
      hud.message(`${shooterName} eliminated you`, 3000);
      spectateBot = bots.bots.find((b) => b.team === 'vanguard' && b.alive) ?? null;
      hud.setSpectating(spectateBot ? spectateBot.name : null);
    }
  } else if (shooter === playerEntity) {
    audio.hit(result.part === 'head');
    hud.hitMarker(false);
  }
}

function onBotShot(bot, from, dir, result) {
  audio.shot('enemy');
  handleShotResult(bot, result);
  if (result && result.killed) hud.hitMarker(false);
}

combat.events.onBounce = () => {
  audio.bounce();
};

function syncCamera() {
  if (!player.state.alive && spectateBot && spectateBot.alive) {
    const body = spectateBot.body;
    camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
    camera.rotation.set(0, body.yaw, 0, 'YXZ');
    return;
  }
  player.eyePosition(eyePos);
  camera.position.copy(eyePos);
  camera.rotation.set(player.body.pitch, player.body.yaw, 0, 'YXZ');
  playerHitGroup.position.set(player.body.position.x, player.body.position.y, player.body.position.z);
  playerHitGroup.rotation.y = player.body.yaw;
}

function aimAt(point) {
  const dx = point.x - player.body.position.x;
  const dy = point.y - (player.body.position.y + player.body.eye);
  const dz = point.z - player.body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  player.body.yaw = Math.atan2(-dx, -dz);
  player.body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  if (!weapon.takeRound()) {
    audio.dryFire();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  player.eyePosition(eyePos);
  scene.updateMatrixWorld(true);
  const result = combat.shoot(eyePos, direction, weapon.state.def, playerEntity);
  weapon.pullTrigger();
  player.recoil(weapon.state.def.recoilPitch + random() * 0.004, (random() * 2 - 1) * weapon.state.def.recoilYaw);
  audio.shot(weapon.state.def.sound);
  bots.hearNoise(eyePos.x, eyePos.z, elapsed);
  if (result && result.entity) {
    hud.hitMarker(result.killed);
  }
  handleShotResult(playerEntity, result);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  return true;
}

function switchWeapon(id) {
  if (!inventory.has(id) || inventory.current() === id) return;
  inventory.syncFromWeapon(weapon);
  inventory.select(id);
  const def = WEAPON_DEFS[id];
  const ammo = inventory.ammo();
  weapon.equip(def, ammo.mag, ammo.reserve);
  hud.setWeapon(def.name);
  hud.setAmmo(ammo.mag, ammo.reserve);
}

function throwGrenade() {
  if (!inventory.useGrenade()) {
    audio.denied();
    return;
  }
  camera.getWorldDirection(direction);
  player.eyePosition(eyePos);
  muzzle.copy(eyePos).addScaledVector(direction, 0.5);
  muzzle.y -= 0.15;
  combat.throwGrenade(muzzle, direction, playerEntity);
  audio.throwGrenade();
  hud.setGrenades(inventory.grenades());
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
  } else if (rounds.state.phase === 'matchEnd') {
    hud.showOverlay(rounds.state.matchWinner === 'vanguard' ? 'matchWin' : 'matchLose', `${rounds.state.scoreV} — ${rounds.state.scoreE}`);
  } else if (started) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (rounds.state.phase === 'matchEnd') {
    rounds.startMatch();
    spectateBot = null;
  }
  input.requestLock();
});

function step(dt) {
  elapsed += dt;
  const phase = rounds.state.phase;
  const live = phase === 'live';

  // Buy keys work in the buy phase; weapon keys switch during live play.
  if (phase === 'buy') {
    if (input.consume('Digit1')) rounds.buyWeapon('pistol');
    if (input.consume('Digit2')) rounds.buyWeapon('smg');
    if (input.consume('Digit3')) rounds.buyWeapon('rifle');
    if (input.consume('Digit4')) rounds.buyWeapon('dmr');
    if (input.consume('Digit5')) rounds.buyGrenade();
    if (input.consume('KeyB')) rounds.syncBuyPanel();
  } else if (live) {
    if (input.consume('Digit1')) switchWeapon('pistol');
    if (input.consume('Digit2')) switchWeapon('smg');
    if (input.consume('Digit3')) switchWeapon('rifle');
    if (input.consume('Digit4')) switchWeapon('dmr');
    if (input.consume('KeyG')) throwGrenade();
    if (input.consume('KeyR') && weapon.reload()) audio.reload();
  }
  input.clearPressed();

  const look = input.takeLook();
  if (player.state.alive) player.look(look.x, look.y);
  if (player.state.alive && phase !== 'buy') {
    player.step(dt, input.state.keys);
  }

  // Fire: automatics hold, semi-autos need a fresh press.
  const firing = input.state.firing && player.state.alive && live;
  const def = weapon.state.def;
  if (firing && weapon.ready() && (def.auto || !fireHeld)) {
    shoot(shot ? 0 : weapon.spread(player.groundSpeed()));
  }
  fireHeld = input.state.firing;

  weapon.step(dt);
  combat.step(dt);
  bots.step(dt, elapsed, {
    enemiesFor,
    onShot: onBotShot,
    onPlanted: (bot) => rounds.onPlanted(bot),
    onDefused: () => rounds.onDefused(),
    onIdle: () => {},
  });
  rounds.playerPlant(dt, input.state.keys.has('KeyE') && player.state.alive);
  rounds.step(dt, elapsed);

  // HUD, every step, from the one state object.
  const state = rounds.state;
  const timerLabel = state.phase === 'buy' ? 'BUY PHASE' : state.bombState === 'planted' && state.phase === 'live' ? 'CORE LIVE' : state.phase === 'live' ? 'ROUND' : state.phase === 'intermission' ? 'ROUND END' : 'MATCH END';
  const timerValue = state.bombState === 'planted' && state.phase === 'live' ? state.bombTimer : state.timeLeft;
  hud.setTimer(Math.max(0, timerValue), timerLabel);
  hud.setAlive(
    (player.state.alive ? 1 : 0) + bots.aliveCount('vanguard'),
    bots.aliveCount('ember'),
    5,
    5,
  );
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  hud.crosshairSpread(4 + weapon.spread(player.groundSpeed()) * 900);
  if (!player.state.alive && spectateBot && !spectateBot.alive) {
    spectateBot = bots.bots.find((b) => b.team === 'vanguard' && b.alive) ?? null;
    hud.setSpectating(spectateBot ? spectateBot.name : null);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  // The simulation freezes while the player has not started or has unlocked
  // the pointer (paused): the buy clock and the bots wait for them.
  const paused = !started || !input.state.locked;
  if (!frozen && !paused) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
  syncCamera();
}

function placeBot(bot, x, z, yaw) {
  bot.body.position.set(x, 0, z);
  bot.body.velocity.set(0, 0, 0);
  bot.body.yaw = yaw;
  bot.health = 100;
  bot.alive = true;
  bot.state = 'hold';
  bot.target = null;
  bot.path = [];
  bot.gotoPoint = null;
  bot.fall = 0;
  bot.figure.group.visible = true;
  bots.syncFigures();
}

function runShot(name) {
  hud.hideOverlay();
  rounds.startMatch();
  const state = rounds.state;
  if (name === 'start') {
    hud.showBuy(false, state.money, []);
    player.body.position.set(0, 0, 18);
    player.body.yaw = 0;
    player.body.pitch = -0.02;
    settle(20);
    aimAt(new THREE.Vector3(-6, 1.5, -8));
    hud.showOverlay('start');
  } else if (name === 'play') {
    state.phase = 'live';
    state.timeLeft = 87;
    state.bombSite = 'A';
    hud.showBuy(false, state.money, []);
    // Stage a firefight at mid: two Ember bots ahead, one Vanguard bot at our side.
    const ember = bots.bots.filter((b) => b.team === 'ember');
    const vanguard = bots.bots.filter((b) => b.team === 'vanguard');
    placeBot(ember[0], 1.5, -4, Math.PI);
    placeBot(ember[1], -4.5, -7, Math.PI - 0.4);
    placeBot(vanguard[0], -3, 12, 0);
    placeBot(vanguard[1], 4, 10, 0);
    player.body.position.set(0, 0, 12);
    player.body.yaw = 0;
    player.body.pitch = 0;
    settle(10);
    inventory.buy('rifle');
    inventory.select('rifle');
    weapon.equip(WEAPON_DEFS.rifle, 24, 90);
    hud.setWeapon('Longbow AR');
    hud.setAmmo(24, 90);
    state.money = 2400;
    aimAt(new THREE.Vector3(1.5, 1.1, -4));
    shoot(0);
    settle(1);
    hud.killFeed('You', 'Ash', 'Longbow AR', false);
    hud.message('Round 3 — plant the core at Site A (Silo)', 4000);
  } else if (name === 'plant') {
    state.phase = 'live';
    state.timeLeft = 64;
    state.bombState = 'planted';
    state.bombSite = 'A';
    state.bombTimer = 22;
    state.bombPosition.set(-20, 0, -13);
    hud.showBuy(false, state.money, []);
    const vanguard = bots.bots.filter((b) => b.team === 'vanguard');
    const ember = bots.bots.filter((b) => b.team === 'ember');
    placeBot(vanguard[0], -16, -9, 0.6);
    placeBot(vanguard[1], -23, -8, -0.5);
    placeBot(ember[0], -10, -14, Math.PI);
    placeBot(ember[1], 8, -12, Math.PI);
    player.body.position.set(-12, 0, -5);
    player.body.yaw = 0;
    player.body.pitch = 0;
    settle(10);
    inventory.buy('rifle');
    inventory.select('rifle');
    weapon.equip(WEAPON_DEFS.rifle, 18, 60);
    hud.setWeapon('Longbow AR');
    hud.setAmmo(18, 60);
    state.money = 1500;
    aimAt(new THREE.Vector3(-20, 1.2, -13));
    hud.message('Core planted at Site A — 22s to detonation', 4000);
  } else {
    // end: the round just won, score on the board, the yard behind it.
    state.phase = 'intermission';
    state.timeLeft = 4;
    state.scoreV = 5;
    state.scoreE = 3;
    state.bombState = 'none';
    hud.setScore(5, 3);
    hud.showBuy(false, state.money, []);
    const vanguard = bots.bots.filter((b) => b.team === 'vanguard');
    const ember = bots.bots.filter((b) => b.team === 'ember');
    placeBot(vanguard[0], -4, 6, 0);
    placeBot(vanguard[1], 3, 8, 0);
    placeBot(ember[0], -2, -2, Math.PI);
    player.body.position.set(0, 0, 12);
    player.body.yaw = 0;
    player.body.pitch = 0;
    settle(10);
    weapon.equip(WEAPON_DEFS.rifle, 30, 90);
    hud.setWeapon('Longbow AR');
    hud.setAmmo(30, 90);
    state.money = 4050;
    hud.setHealth(100);
    aimAt(new THREE.Vector3(0, 1.4, -6));
    hud.killFeed('You', 'Vex', 'Longbow AR', true);
    hud.killFeed('Rook', 'Flint', 'Longbow AR', false);
    hud.message('Round 8 won — Ember eliminated', 4000);
  }
  hud.setScore(state.scoreV, state.scoreE);
  hud.setMoney(state.money);
  hud.setAlive(
    (player.state.alive ? 1 : 0) + bots.aliveCount('vanguard'),
    bots.aliveCount('ember'),
    5,
    5,
  );
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Debug and play-test hook: the round state, the bodies, and a few verbs the
// headless play-test drives. It changes nothing about the game itself.
window.__game = {
  state: rounds.state,
  player,
  bots,
  rounds,
  weapon,
  inventory,
  look(dx, dy) {
    player.look(dx, dy);
    syncCamera();
  },
  aimAt(x, y, z) {
    aimAt(new THREE.Vector3(x, y, z));
  },
  fire() {
    return shoot(weapon.spread(player.groundSpeed()));
  },
  teleport(x, z) {
    player.body.position.set(x, 0, z);
    player.body.velocity.set(0, 0, 0);
    syncCamera();
  },
  skipBuy() {
    rounds.state.phase = 'live';
    rounds.state.timeLeft = 100;
    hud.showBuy(false, rounds.state.money, []);
  },
  setTimeLeft(seconds) {
    rounds.state.timeLeft = seconds;
  },
};

syncCamera();
if (shot) runShot(shot);
else {
  rounds.startMatch();
  requestAnimationFrame(frame);
}
