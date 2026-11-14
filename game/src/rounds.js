// Rounds: the match. One match is first to 8 rounds. Each round is a buy phase
// (8 s, frozen, the shop is open), a live phase (100 s), and a short
// intermission. Vanguard attacks: one of them carries the core and must plant
// it at Silo or Depot; Ember defends. A round ends on elimination, on the core
// exploding (35 s after the plant), on a defuse, or on the clock. Money is
// earned for kills, plants and round wins, and spent in the buy menu.
import * as THREE from 'three';
import { SITES, SPAWNS } from './map.js';
import { WEAPON_DEFS, GRENADE_PRICE } from './weapons.js';

const BUY_SECONDS = 8;
const ROUND_SECONDS = 100;
const BOMB_SECONDS = 35;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;
const WIN_SCORE = 8;
const WIN_BONUS = 3250;
const LOSS_BONUS = 1900;
const KILL_BONUS = 300;
const PLANT_BONUS = 300;

export function createRounds(deps) {
  const { bots, player, inventory, weapon, combat, audio, hud, random } = deps;
  const scene = deps.scene;

  // The core: a glowing amber octahedron carried by its holder, dropped on the
  // ground when the holder dies, and replaced by the planted bomb at a site.
  const coreMesh = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.22),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#f0a830'), emissive: new THREE.Color('#f0a830'), emissiveIntensity: 0.9, roughness: 0.3 }),
  );
  coreMesh.visible = false;
  scene.add(coreMesh);
  const bombMesh = new THREE.Group();
  const bombBody = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.28, 0.36),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#2c323a'), roughness: 0.5, metalness: 0.4 }),
  );
  const bombLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#d8442c') }),
  );
  bombLight.position.set(0.18, 0.18, 0);
  bombMesh.add(bombBody, bombLight);
  bombMesh.visible = false;
  scene.add(bombMesh);
  const bombLightPoint = new THREE.PointLight(new THREE.Color('#d8442c'), 0, 8, 1.6);
  scene.add(bombLightPoint);

  const state = {
    phase: 'buy',
    round: 1,
    scoreV: 0,
    scoreE: 0,
    money: 2000,
    timeLeft: BUY_SECONDS,
    bombState: 'carried',
    bombSite: 'A',
    bombTimer: 0,
    bombPosition: new THREE.Vector3(),
    coreHolder: null,
    corePosition: new THREE.Vector3(),
    matchWinner: null,
    playerPlantProgress: 0,
    plantSite: null,
  };
  let beepAt = 0;
  let coreDutyBot = null;

  function siteOf(key) {
    return SITES[key];
  }

  function carrierBot() {
    return bots.carrier();
  }

  function dropCore(at) {
    state.bombState = 'dropped';
    state.coreHolder = null;
    state.corePosition.copy(at);
    state.corePosition.y = 0.3;
    coreMesh.visible = true;
    coreMesh.position.copy(state.corePosition);
    coreDutyBot = null;
  }

  function giveCore(holder) {
    state.bombState = 'carried';
    state.coreHolder = holder;
    coreMesh.visible = true;
  }

  function startRound() {
    const site = random() < 0.5 ? 'A' : 'B';
    state.bombSite = site;
    state.phase = 'buy';
    state.timeLeft = BUY_SECONDS;
    state.bombState = 'carried';
    state.bombTimer = 0;
    state.playerPlantProgress = 0;
    state.plantSite = null;
    bombMesh.visible = false;
    bombLightPoint.intensity = 0;
    combat.clearGrenades();
    inventory.resetRound();
    const def = inventory.def();
    const ammo = inventory.ammo();
    weapon.equip(def, ammo.mag, ammo.reserve);
    hud.setWeapon(def.name);
    player.spawnAt(SPAWNS.vanguard[0]);
    bots.spawnRound({
      vanguardSpawns: SPAWNS.vanguard.slice(1),
      emberSpawns: SPAWNS.ember,
      site,
    });
    giveCore(carrierBot());
    hud.setScore(state.scoreV, state.scoreE);
    hud.setMoney(state.money);
    hud.setHealth(100);
    hud.setSpectating(null);
    hud.hidePlant();
    hud.message(`Round ${state.round} — plant the core at Site ${site} (${siteOf(site).name})`, 3400);
    syncBuyPanel();
  }

  function startMatch() {
    state.round = 1;
    state.scoreV = 0;
    state.scoreE = 0;
    state.money = 2000;
    state.matchWinner = null;
    inventory.resetMatch();
    startRound();
  }

  function syncBuyPanel() {
    const rows = [
      { key: '1', name: WEAPON_DEFS.pistol.name, detail: '12 / 120 · semi-auto', price: 0, owned: true, affordable: true },
      { key: '2', name: WEAPON_DEFS.smg.name, detail: '28 / 112 · automatic', price: WEAPON_DEFS.smg.price, owned: inventory.has('smg'), affordable: state.money >= WEAPON_DEFS.smg.price },
      { key: '3', name: WEAPON_DEFS.rifle.name, detail: '30 / 90 · automatic', price: WEAPON_DEFS.rifle.price, owned: inventory.has('rifle'), affordable: state.money >= WEAPON_DEFS.rifle.price },
      { key: '4', name: WEAPON_DEFS.dmr.name, detail: '8 / 24 · heavy, scoped', price: WEAPON_DEFS.dmr.price, owned: inventory.has('dmr'), affordable: state.money >= WEAPON_DEFS.dmr.price },
      { key: '5', name: 'Spark grenade', detail: 'frag · up to 2 carried', price: GRENADE_PRICE, owned: false, affordable: state.money >= GRENADE_PRICE },
    ];
    hud.showBuy(state.phase === 'buy', state.money, rows);
  }

  function buyWeapon(id) {
    if (state.phase !== 'buy') return false;
    const def = WEAPON_DEFS[id];
    if (!def) return false;
    if (inventory.has(id)) {
      // Re-buying a gun you own refills its ammo for free.
      inventory.buy(id);
      if (inventory.current() === id) {
        const ammo = inventory.ammo();
        weapon.equip(def, ammo.mag, ammo.reserve);
        hud.setWeapon(def.name);
      }
      audio.buy();
      syncBuyPanel();
      return true;
    }
    if (state.money < def.price) {
      audio.denied();
      return false;
    }
    state.money -= def.price;
    inventory.buy(id);
    inventory.select(id);
    const ammo = inventory.ammo();
    weapon.equip(def, ammo.mag, ammo.reserve);
    hud.setWeapon(def.name);
    hud.setAmmo(ammo.mag, ammo.reserve);
    hud.setMoney(state.money);
    audio.buy();
    syncBuyPanel();
    return true;
  }

  function buyGrenade() {
    if (state.phase !== 'buy') return false;
    if (inventory.grenades() >= 2) return false;
    if (state.money < GRENADE_PRICE) {
      audio.denied();
      return false;
    }
    state.money -= GRENADE_PRICE;
    inventory.addGrenade();
    hud.setMoney(state.money);
    hud.setGrenades(inventory.grenades());
    audio.buy();
    syncBuyPanel();
    return true;
  }

  function endRound(winner, reason) {
    if (state.phase === 'intermission' || state.phase === 'matchEnd') return;
    state.phase = 'intermission';
    state.timeLeft = 5;
    if (winner === 'vanguard') {
      state.scoreV += 1;
      state.money += WIN_BONUS;
    } else {
      state.scoreE += 1;
      state.money += LOSS_BONUS;
    }
    hud.setScore(state.scoreV, state.scoreE);
    hud.setMoney(state.money);
    hud.hidePlant();
    hud.showBuy(false, state.money, []);
    const won = winner === 'vanguard';
    hud.message(won ? `Round ${state.round} won — ${reason}` : `Round ${state.round} lost — ${reason}`, 4200);
    if (won) audio.roundWin();
    else audio.roundLose();
    state.bombState = 'none';
    coreMesh.visible = false;
    bombMesh.visible = false;
    bombLightPoint.intensity = 0;
  }

  function finishMatch() {
    state.phase = 'matchEnd';
    state.matchWinner = state.scoreV >= WIN_SCORE ? 'vanguard' : 'ember';
    const won = state.matchWinner === 'vanguard';
    hud.showOverlay(won ? 'matchWin' : 'matchLose', `${state.scoreV} — ${state.scoreE}`);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function plantBomb(at, siteKey, byPlayer) {
    state.bombState = 'planted';
    state.bombTimer = BOMB_SECONDS;
    state.bombPosition.copy(at);
    state.plantSite = siteKey;
    coreMesh.visible = false;
    bombMesh.visible = true;
    bombMesh.position.copy(at);
    bombMesh.position.y = 0.18;
    bombLightPoint.position.copy(at);
    bombLightPoint.position.y = 1;
    bombLightPoint.intensity = 10;
    beepAt = 0;
    if (byPlayer) {
      state.money += PLANT_BONUS;
      hud.setMoney(state.money);
    }
    hud.message(`Core planted at Site ${siteKey} — ${BOMB_SECONDS}s to detonation`, 3600);
    audio.plant();
    bots.onBombPlanted(siteKey);
  }

  function onPlanted(bot) {
    if (state.phase !== 'live' || state.bombState !== 'carried') return;
    const site = siteOf(state.bombSite);
    plantBomb(new THREE.Vector3(site.x, 0, site.z), state.bombSite, false);
  }

  function onDefused() {
    if (state.phase !== 'live' || state.bombState !== 'planted') return;
    audio.defuse();
    endRound('ember', 'the core was defused');
  }

  function explodeBomb() {
    combat.explode(state.bombPosition, null);
    audio.explosion();
    endRound('vanguard', 'the core detonated');
  }

  function playerPlant(dt, holdingKey) {
    if (state.phase !== 'live' || state.bombState !== 'carried' || state.coreHolder !== 'player') {
      state.playerPlantProgress = 0;
      return;
    }
    const site = siteOf(state.bombSite);
    const dx = player.body.position.x - site.x;
    const dz = player.body.position.z - site.z;
    const inside = Math.hypot(dx, dz) <= site.radius;
    if (inside && holdingKey) {
      state.playerPlantProgress += dt;
      hud.showPlant(`Planting the core — Site ${state.bombSite}`, state.playerPlantProgress / PLANT_SECONDS);
      if (state.playerPlantProgress >= PLANT_SECONDS) {
        state.playerPlantProgress = 0;
        hud.hidePlant();
        plantBomb(new THREE.Vector3(site.x, 0, site.z), state.bombSite, true);
      }
    } else {
      if (state.playerPlantProgress > 0) hud.hidePlant();
      state.playerPlantProgress = 0;
      if (inside && state.coreHolder === 'player') {
        hud.showPlant(`Hold E to plant — Site ${state.bombSite}`, 0);
      }
    }
  }

  function step(dt, time) {
    // The core follows its holder; a dead holder drops it where they fell.
    if (state.bombState === 'carried' && state.coreHolder) {
      if (state.coreHolder === 'player') {
        if (!player.state.alive) dropCore(player.body.position);
        else coreMesh.position.set(player.body.position.x, player.body.position.y + 1.0, player.body.position.z);
      } else if (state.coreHolder.alive) {
        coreMesh.position.set(state.coreHolder.body.position.x, state.coreHolder.body.position.y + 1.0, state.coreHolder.body.position.z);
      } else {
        dropCore(state.coreHolder.body.position);
      }
    }

    if (state.phase === 'buy') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        state.phase = 'live';
        state.timeLeft = ROUND_SECONDS;
        hud.showBuy(false, state.money, []);
        hud.message(`Go — Site ${state.bombSite} (${siteOf(state.bombSite).name})`, 2200);
      }
      return;
    }

    if (state.phase === 'intermission') {
      state.timeLeft -= dt;
      if (state.timeLeft <= 0) {
        if (state.scoreV >= WIN_SCORE || state.scoreE >= WIN_SCORE) {
          finishMatch();
        } else {
          state.round += 1;
          startRound();
        }
      }
      return;
    }

    if (state.phase !== 'live') return;

    state.timeLeft -= dt;

    // Core pickup: the player, or the nearest living Vanguard bot.
    if (state.bombState === 'dropped') {
      const pdx = player.body.position.x - state.corePosition.x;
      const pdz = player.body.position.z - state.corePosition.z;
      if (player.state.alive && Math.hypot(pdx, pdz) < 1.6) {
        giveCore('player');
        hud.message('You picked up the core', 2200);
      } else {
        const bot = bots.nearestAlive('vanguard', state.corePosition.x, state.corePosition.z);
        if (bot) {
          const bdx = bot.body.position.x - state.corePosition.x;
          const bdz = bot.body.position.z - state.corePosition.z;
          if (Math.hypot(bdx, bdz) < 1.6) {
            giveCore(bot);
          } else if (coreDutyBot !== bot) {
            // Send the nearest living attacker straight to the dropped core.
            coreDutyBot = bot;
            bots.gotoPoint(bot, state.corePosition.x, state.corePosition.z);
          }
        }
      }
    }

    // Carrier bot plants when it reaches its site and no enemy is engaging it.
    if (state.bombState === 'carried' && state.coreHolder && state.coreHolder !== 'player') {
      const carrier = state.coreHolder;
      if (carrier.alive) {
        const site = siteOf(state.bombSite);
        const dist = Math.hypot(carrier.body.position.x - site.x, carrier.body.position.z - site.z);
        if (dist <= site.radius && carrier.state !== 'plant') {
          // The bot itself breaks off to fight a close threat (bots.js).
          carrier.state = 'plant';
          carrier.plantProgress = 0;
        } else if (dist > site.radius && carrier.state === 'plant') {
          carrier.state = 'route';
          carrier.plantProgress = 0;
        }
      }
    }

    // A defending bot defuses when it reaches the planted core.
    if (state.bombState === 'planted') {
      const defuser = bots.nearestAlive('ember', state.bombPosition.x, state.bombPosition.z);
      if (defuser) {
        const dist = Math.hypot(defuser.body.position.x - state.bombPosition.x, defuser.body.position.z - state.bombPosition.z);
        if (dist <= 1.8 && defuser.state !== 'defuse') {
          // The bot itself breaks off to fight a close threat (bots.js).
          defuser.state = 'defuse';
          defuser.defuseProgress = 0;
        } else if (dist > 2.2 && defuser.state === 'defuse') {
          defuser.state = 'route';
          defuser.defuseProgress = 0;
        }
      }
      // Planted-core beeps, accelerating as the timer runs down.
      state.bombTimer -= dt;
      const interval = state.bombTimer > 15 ? 1.0 : state.bombTimer > 5 ? 0.55 : 0.3;
      if (time - beepAt >= interval) {
        beepAt = time;
        audio.plantBeep(state.bombTimer <= 5);
        bombLight.material.color.setHex(state.bombTimer <= 5 ? 0xff3020 : 0xd8442c);
      }
      if (state.bombTimer <= 0) {
        explodeBomb();
        return;
      }
    }

    // Round end: elimination, or the clock with no plant.
    const vanguardAlive = (player.state.alive ? 1 : 0) + bots.aliveCount('vanguard');
    const emberAlive = bots.aliveCount('ember');
    if (vanguardAlive === 0) {
      if (state.bombState === 'planted') {
        // Defenders still have to defuse; if none are left, the blast wins it.
        if (emberAlive === 0) explodeBomb();
      } else {
        endRound('ember', 'Vanguard eliminated');
      }
      return;
    }
    if (emberAlive === 0) {
      if (state.bombState === 'planted') {
        // Nobody left to defuse: the blast is coming, but the round is won.
        endRound('vanguard', 'Ember eliminated — the core will detonate');
      } else {
        endRound('vanguard', 'Ember eliminated');
      }
      return;
    }
    if (state.timeLeft <= 0) {
      if (state.bombState === 'planted') {
        // The bomb timer decides it from here; the round clock stops mattering.
        state.timeLeft = 0;
      } else {
        endRound('ember', 'time expired — the core was never planted');
      }
    }
  }

  return {
    state,
    startMatch,
    startRound,
    step,
    buyWeapon,
    buyGrenade,
    syncBuyPanel,
    onPlanted,
    onDefused,
    playerPlant,
    dropCore,
    giveCore,
    awardKill() {
      state.money += KILL_BONUS;
      hud.setMoney(state.money);
    },
    coreHolderIsPlayer() {
      return state.coreHolder === 'player';
    },
  };
}
