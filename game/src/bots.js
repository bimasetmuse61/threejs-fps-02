// Bots: the other nine soldiers. Each bot is a body on the shared mover, a
// procedural figure, and a small state machine — route, hold, engage, plant,
// defuse, investigate — driven by a waypoint graph, line of sight, and hearing.
// They pick routes to the round's plan, hold their lanes, react to what they
// see after a human-ish delay, and shoot back in bursts with aim error that
// grows with distance and target speed.
import * as THREE from 'three';
import { createBody } from './mover.js';
import { PALETTE } from './palette.js';
import { NAV, nodeById, nearestNode, route } from './map.js';
import { gauss, range, pick } from './rng.js';

const BOT_DEFS = {
  rifle: { name: 'Longbow AR', damage: 14, headMult: 2.5, fireGap: 0.12, burst: 4, sound: 'enemy' },
  smg: { name: 'Hornet SMG', damage: 11, headMult: 2.5, fireGap: 0.08, burst: 5, sound: 'enemy' },
};
const HEALTH = 100;
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.85;
const LOSE_SIGHT_SECONDS = 1.4;
const SIGHT_RANGE = 42;
const HEAR_RADIUS = 26;

const VANGUARD_NAMES = ['Rook', 'Sable', 'Iris', 'Dune'];
const EMBER_NAMES = ['Ash', 'Cinder', 'Flint', 'Rust', 'Vex'];

function buildFigure(scene, team) {
  const teamColor = team === 'vanguard' ? PALETTE.teal : PALETTE.ember;
  const group = new THREE.Group();
  const torsoMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.3), torsoMat);
  torso.position.y = 1.06;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skinMat);
  head.position.y = 1.55;
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), darkMat);
  helmet.position.y = 1.68;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.72, 0.16), darkMat);
  legL.position.set(-0.12, 0.36, 0);
  const legR = legL.clone();
  legR.position.x = 0.12;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), darkMat);
  gun.position.set(0.22, 1.18, -0.28);
  const trim = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.06, 0.32), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5 }));
  trim.position.y = 1.32;
  group.add(torso, head, helmet, legL, legR, gun, trim);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  scene.add(group);
  return { group, torso, head, legL, legR };
}

export function createBots(scene, world, combat, random) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const bots = [];
  const tmp = new THREE.Vector3();
  const aimDir = new THREE.Vector3();
  const eyePos = new THREE.Vector3();
  const targetPos = new THREE.Vector3();
  let now = 0;

  function makeBot(team, index, spawn) {
    const isVanguard = team === 'vanguard';
    const name = isVanguard ? VANGUARD_NAMES[index] : EMBER_NAMES[index];
    const mover = createBody(world.colliders, spawn.x, spawn.z, { yaw: spawn.yaw, walkSpeed: 4.4 });
    const figure = buildFigure(scene, team);
    const def = random() < 0.7 ? BOT_DEFS.rifle : BOT_DEFS.smg;
    const bot = {
      id: `${team}-${index}`,
      name,
      team,
      def,
      mover,
      body: mover.body,
      figure,
      health: HEALTH,
      alive: true,
      state: 'hold',
      path: [],
      pathIndex: 0,
      holdNode: null,
      holdUntil: 0,
      scanPhase: random() * 6,
      target: null,
      lastSeen: null,
      lastSeenAt: -99,
      reactionAt: 0,
      burstLeft: 0,
      burstTimer: 0,
      cooldown: 0,
      strafeDir: 1,
      strafeUntil: 0,
      investigateNode: null,
      plantProgress: 0,
      defuseProgress: 0,
      isCarrier: false,
      gotoPoint: null,
      walkPhase: 0,
      fall: 0,
      perceiveAt: random() * 0.12,
      position: mover.body.position,
      hitMeshes: [],
    };
    figure.torso.userData.entity = bot;
    figure.torso.userData.part = 'torso';
    figure.head.userData.entity = bot;
    figure.head.userData.part = 'head';
    figure.legL.userData.entity = bot;
    figure.legL.userData.part = 'torso';
    figure.legR.userData.entity = bot;
    figure.legR.userData.part = 'torso';
    bot.hitMeshes = [figure.torso, figure.head, figure.legL, figure.legR];
    combat.registerTarget(bot);
    bot.takeDamage = (amount, part, attacker) => {
      if (!bot.alive) return false;
      bot.health -= amount;
      if (attacker && attacker.alive) {
        // Being shot spins the bot toward its attacker: it heard the shot.
        bot.lastSeen = attacker;
        bot.lastSeenAt = now;
        bot.target = attacker;
        bot.reactionAt = Math.min(bot.reactionAt || now + 0.7, now + 0.25);
      }
      if (bot.health > 0) return false;
      bot.alive = false;
      bot.health = 0;
      bot.state = 'dead';
      bot.fall = 0;
      return true;
    };
    bots.push(bot);
    return bot;
  }

  function hasLineOfSight(from, to) {
    eyePos.copy(from);
    targetPos.copy(to);
    aimDir.copy(targetPos).sub(eyePos);
    const distance = aimDir.length();
    if (distance > SIGHT_RANGE) return false;
    aimDir.normalize();
    raycaster.set(eyePos, aimDir);
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    return !hit || hit.distance >= distance - 0.2;
  }

  function perceive(bot, time, enemies) {
    if (time < bot.perceiveAt) return;
    bot.perceiveAt = time + 0.12 + (bot.id.charCodeAt(bot.id.length - 1) % 5) * 0.02;
    let best = null;
    let bestD = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dx = enemy.position.x - bot.body.position.x;
      const dz = enemy.position.z - bot.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > SIGHT_RANGE || dist > bestD) continue;
      // Field of view: 120 degrees, but anything very close is heard anyway.
      const angleTo = Math.atan2(-dx, -dz);
      let diff = angleTo - bot.body.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 1.15 && dist > 7) continue;
      tmp.set(enemy.position.x, enemy.position.y + 1.2, enemy.position.z);
      eyePos.set(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
      if (!hasLineOfSight(eyePos, tmp)) continue;
      best = enemy;
      bestD = dist;
    }
    if (best) {
      if (bot.target !== best) bot.reactionAt = time + range(random, REACTION_MIN, REACTION_MAX);
      bot.target = best;
      bot.lastSeen = best;
      bot.lastSeenAt = time;
    } else if (bot.target && time - bot.lastSeenAt > LOSE_SIGHT_SECONDS) {
      bot.target = null;
    }
  }

  function setRoute(bot, nodeId) {
    const from = nearestNode(bot.body.position.x, bot.body.position.z);
    bot.path = route(from.id, nodeId);
    bot.pathIndex = 0;
    bot.state = 'route';
  }

  function followPath(bot, dt, time) {
    if (bot.gotoPoint) {
      const dx = bot.gotoPoint.x - bot.body.position.x;
      const dz = bot.gotoPoint.z - bot.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.8) {
        bot.gotoPoint = null;
        bot.state = 'hold';
        bot.holdUntil = time + range(random, 3, 7);
        return { x: 0, z: 0 };
      }
      return { x: dx / dist, z: dz / dist };
    }
    if (bot.pathIndex >= bot.path.length) {
      bot.state = 'hold';
      bot.holdUntil = time + range(random, 3, 7);
      return { x: 0, z: 0 };
    }
    const node = nodeById(bot.path[bot.pathIndex]);
    const dx = node.x - bot.body.position.x;
    const dz = node.z - bot.body.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.7) {
      bot.pathIndex += 1;
      if (bot.pathIndex >= bot.path.length) {
        bot.state = 'hold';
        bot.holdUntil = time + range(random, 3, 7);
        bot.holdNode = node;
      }
      return { x: 0, z: 0 };
    }
    return { x: dx / dist, z: dz / dist };
  }

  function faceToward(bot, x, z, dt, rate = 4.5) {
    const want = Math.atan2(-(x - bot.body.position.x), -(z - bot.body.position.z));
    let diff = want - bot.body.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const step = Math.max(-rate * dt, Math.min(rate * dt, diff));
    bot.body.yaw += step;
    return Math.abs(diff);
  }

  function fireBurst(bot, dt, time, onShot) {
    bot.cooldown -= dt;
    if (bot.burstLeft > 0) {
      bot.burstTimer -= dt;
      if (bot.burstTimer <= 0 && bot.cooldown <= 0) {
        bot.burstLeft -= 1;
        bot.burstTimer = bot.def.fireGap;
        bot.cooldown = 0;
        const enemy = bot.target;
        if (!enemy || !enemy.alive) return;
        const aimHead = random() < 0.25;
        const aimY = enemy.position.y + (aimHead ? 1.55 : 1.15);
        const dx = enemy.position.x - bot.body.position.x;
        const dy = aimY - (bot.body.position.y + bot.body.eye);
        const dz = enemy.position.z - bot.body.position.z;
        const dist = Math.hypot(dx, dy, dz) || 1;
        const speed = Math.hypot(enemy.velocity ? enemy.velocity.x : 0, enemy.velocity ? enemy.velocity.z : 0);
        const error = 0.02 + dist * 0.0009 + speed * 0.004 + (bot.mover.groundSpeed() > 1 ? 0.015 : 0);
        aimDir.set(dx / dist + gauss(random, error), dy / dist + gauss(random, error), dz / dist + gauss(random, error)).normalize();
        eyePos.set(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
        const muzzle = eyePos.clone().addScaledVector(aimDir, 0.6);
        muzzle.y -= 0.25;
        const result = combat.shoot(muzzle, aimDir, bot.def, bot);
        onShot(bot, muzzle, aimDir, result);
      }
      return;
    }
    if (bot.cooldown <= 0 && bot.target) {
      bot.burstLeft = bot.def.burst;
      bot.burstTimer = 0;
      bot.cooldown = range(random, 0.45, 0.95);
    }
  }

  function stepBot(bot, dt, time, ctx) {
    const { onShot, bomb, planSite, noise } = ctx;
    const enemies = ctx.enemiesFor(bot.team);
    if (!bot.alive) {
      bot.fall = Math.min(1, bot.fall + dt / 0.4);
      bot.figure.group.rotation.x = -bot.fall * 1.5;
      bot.figure.group.position.y = -bot.fall * 0.1;
      return;
    }
    perceive(bot, time, enemies);
    const engaged = bot.target && bot.target.alive && time >= bot.reactionAt;
    // A plant or defuse only breaks off for a threat close enough to stop it;
    // a distant enemy the bot can see does not cancel the channel.
    const threatDist = engaged
      ? Math.hypot(bot.target.position.x - bot.body.position.x, bot.target.position.z - bot.body.position.z)
      : Infinity;
    const closeThreat = engaged && threatDist < 14;

    // Bomb duties override movement, unless an enemy is right in front of us.
    let wish = { x: 0, z: 0 };
    let crouch = false;
    if (bot.state === 'plant') {
      if (closeThreat) {
        bot.state = 'engage';
        bot.plantProgress = 0;
      } else {
        bot.plantProgress += dt;
        crouch = true;
        if (bot.plantProgress >= 3) ctx.onPlanted(bot);
      }
    } else if (bot.state === 'defuse') {
      if (closeThreat) {
        bot.state = 'engage';
        bot.defuseProgress = 0;
      } else {
        bot.defuseProgress += dt;
        crouch = true;
        if (bot.defuseProgress >= 5) ctx.onDefused(bot);
      }
    } else if (engaged) {
      const enemy = bot.target;
      faceToward(bot, enemy.position.x, enemy.position.z, dt, 5);
      // Keep a fighting distance: close in if far, strafe if near.
      const dx = enemy.position.x - bot.body.position.x;
      const dz = enemy.position.z - bot.body.position.z;
      const dist = Math.hypot(dx, dz);
      if (time > bot.strafeUntil) {
        bot.strafeDir = random() < 0.5 ? -1 : 1;
        bot.strafeUntil = time + range(random, 0.7, 1.6);
      }
      if (dist > 26) {
        wish = { x: dx / dist, z: dz / dist };
      } else if (dist < 6) {
        wish = { x: -dx / dist, z: -dz / dist };
      } else {
        wish = { x: (-dz / dist) * bot.strafeDir, z: (dx / dist) * bot.strafeDir };
      }
      if (random() < 0.12) crouch = true;
      bot.state = 'engage';
      fireBurst(bot, dt, time, onShot);
    } else if (bot.state === 'route') {
      wish = followPath(bot, dt, time);
      if (wish.x || wish.z) faceToward(bot, bot.body.position.x + wish.x, bot.body.position.z + wish.z, dt);
    } else if (bot.state === 'hold') {
      const node = bot.holdNode;
      const baseYaw = node ? node.yaw : bot.body.yaw;
      bot.body.yaw = baseYaw + Math.sin(time * 0.5 + bot.scanPhase) * 0.45;
      if (time > bot.holdUntil && bot.investigateNode) {
        setRoute(bot, bot.investigateNode);
        bot.investigateNode = null;
      } else if (time > bot.holdUntil && bot.state === 'hold' && ctx.onIdle) {
        ctx.onIdle(bot, time);
      }
    } else if (bot.state === 'investigate') {
      wish = followPath(bot, dt, time);
      if (wish.x || wish.z) faceToward(bot, bot.body.position.x + wish.x, bot.body.position.z + wish.z, dt);
      if (bot.state === 'hold') {
        bot.holdUntil = time + 2.5;
        bot.investigateNode = null;
      }
    }

    // Hearing: a recent loud noise nearby becomes a place to look.
    if (noise && noise.at > time - 0.2 && bot.state !== 'engage' && bot.state !== 'plant' && bot.state !== 'defuse') {
      const d = Math.hypot(noise.x - bot.body.position.x, noise.z - bot.body.position.z);
      if (d < HEAR_RADIUS) {
        const node = nearestNode(noise.x, noise.z);
        if (bot.state === 'hold' || bot.state === 'route') {
          bot.investigateNode = node.id;
          if (bot.state === 'hold') {
            setRoute(bot, node.id);
            bot.state = 'investigate';
          }
        }
      }
    }

    const speed = engaged ? 2.6 : 4.4;
    bot.mover.step(dt, wish.x, wish.z, { crouch, speed });
    const moving = bot.mover.groundSpeed();
    if (moving > 0.5) bot.walkPhase += dt * moving * 1.6;
    const swing = moving > 0.5 ? Math.sin(bot.walkPhase) * 0.45 : 0;
    bot.figure.legL.rotation.x = swing;
    bot.figure.legR.rotation.x = -swing;
    bot.figure.group.position.set(bot.body.position.x, bot.body.position.y, bot.body.position.z);
    bot.figure.group.rotation.y = bot.body.yaw;
    if (bot.state === 'dead') bot.figure.group.rotation.x = -1.5;
  }

  function spawnRound(plan) {
    // plan carries the spawn lists in team order and the round's site.
    let vanguardIndex = 0;
    let emberIndex = 0;
    for (const bot of bots) {
      const spawn = bot.team === 'vanguard'
        ? plan.vanguardSpawns[vanguardIndex++]
        : plan.emberSpawns[emberIndex++];
      bot.body.position.set(spawn.x, 0, spawn.z);
      bot.body.velocity.set(0, 0, 0);
      bot.body.yaw = spawn.yaw;
      bot.body.pitch = 0;
      bot.health = HEALTH;
      bot.alive = true;
      bot.state = 'hold';
      bot.path = [];
      bot.target = null;
      bot.lastSeen = null;
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      bot.isCarrier = false;
      bot.fall = 0;
      bot.figure.group.rotation.set(0, bot.body.yaw, 0);
      bot.figure.group.position.set(spawn.x, 0, spawn.z);
      bot.figure.group.visible = true;
    }
    // Roles for this round.
    const attackers = bots.filter((b) => b.team === 'vanguard');
    const defenders = bots.filter((b) => b.team === 'ember');
    const carrier = attackers[1] ?? attackers[0];
    carrier.isCarrier = true;
    const site = plan.site;
    const siteNode = site === 'A' ? 'a0' : 'b0';
    const lanes = site === 'A' ? ['w1', 'c2', 'm1'] : ['e1', 'c3', 'm1'];
    attackers.forEach((bot, i) => {
      if (bot === carrier) {
        setRoute(bot, siteNode);
      } else {
        setRoute(bot, lanes[i % lanes.length]);
      }
      bot.holdNode = nodeById(siteNode);
    });
    const defHolds = site === 'A'
      ? ['a1', 'd0', 'm2', 'd1', 'b1']
      : ['b1', 'd1', 'm2', 'd0', 'a1'];
    defenders.forEach((bot, i) => {
      const node = nodeById(defHolds[i % defHolds.length]);
      bot.holdNode = node;
      setRoute(bot, node.id);
      bot.state = 'route';
    });
  }

  function onBombPlanted(site) {
    // Attackers fall back to guard the site; defenders converge to defuse.
    for (const bot of bots) {
      if (!bot.alive) continue;
      if (bot.team === 'vanguard') {
        const node = nodeById(site === 'A' ? 'a1' : 'b1');
        bot.holdNode = node;
        setRoute(bot, node.id);
      } else {
        const node = nodeById(site === 'A' ? 'a0' : 'b0');
        bot.holdNode = node;
        setRoute(bot, node.id);
        bot.state = 'route';
      }
    }
  }

  function aliveCount(team) {
    return bots.filter((b) => b.team === team && b.alive).length;
  }

  function hearNoise(x, z, at) {
    // Stored for one step; stepBot reads it through ctx.
    bots._noise = { x, z, at };
  }

  return {
    bots,
    makeBot,
    syncFigures() {
      for (const bot of bots) {
        bot.figure.group.position.set(bot.body.position.x, bot.body.position.y, bot.body.position.z);
        bot.figure.group.rotation.set(bot.fall > 0 ? -bot.fall * 1.5 : 0, bot.body.yaw, 0);
      }
    },
    step(dt, time, ctx) {
      now = time;
      ctx.noise = bots._noise;
      for (const bot of bots) stepBot(bot, dt, time, ctx);
      bots._noise = null;
    },
    spawnRound,
    onBombPlanted,
    gotoPoint(bot, x, z) {
      bot.gotoPoint = { x, z };
      bot.path = [];
      bot.pathIndex = 0;
      bot.state = 'route';
    },
    aliveCount,
    hearNoise,
    carrier() {
      return bots.find((b) => b.isCarrier);
    },
    nearestAlive(team, x, z) {
      let best = null;
      let bestD = Infinity;
      for (const bot of bots) {
        if (bot.team !== team || !bot.alive) continue;
        const d = (bot.body.position.x - x) ** 2 + (bot.body.position.z - z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = bot;
        }
      }
      return best;
    },
    pick,
    range,
  };
}
