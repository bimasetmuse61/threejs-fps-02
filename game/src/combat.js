// Combat: hitscan shots, tracers, and grenades. One raycaster serves every
// shooter — player or bot — against the world's surfaces and every registered
// target's body parts. A head hit multiplies damage; a wall hit stops the shot.
// Grenades are simulated points with gravity and a bounce off colliders, then
// an area explosion. No new objects are made in the hot loop: tracers and the
// explosion mesh come from small pools.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_POOL = 24;
const TRACER_LIFE = 0.07;
const GRENADE_FUSE = 1.6;
const GRENADE_RADIUS = 6.5;
const GRENADE_DAMAGE = 95;
const GRAVITY = 14;

export function createCombat(scene, world) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const targets = [];
  const hitMeshes = [];
  const tracers = [];
  const tracerDirection = new THREE.Vector3();
  const grenades = [];
  const probe = new THREE.Box3();

  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(PALETTE.accent),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  const boomMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1, 20, 14),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false }),
  );
  boomMesh.visible = false;
  scene.add(boomMesh);
  const boomLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 22, 1.4);
  scene.add(boomLight);
  let boomLife = 0;

  const events = { onNoise: null, onExplode: null, onBounce: null };

  function registerTarget(entity) {
    targets.push(entity);
    for (const mesh of entity.hitMeshes) hitMeshes.push(mesh);
  }

  function spawnTracer(from, to) {
    const tracer = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_POOL;
    const positions = tracer.line.geometry.attributes.position.array;
    positions[0] = from.x;
    positions[1] = from.y;
    positions[2] = from.z;
    positions[3] = to.x;
    positions[4] = to.y;
    positions[5] = to.z;
    tracer.line.geometry.attributes.position.needsUpdate = true;
    tracer.line.visible = true;
    tracer.line.material.opacity = 0.85;
    tracer.life = TRACER_LIFE;
  }

  // Fire one hitscan round. origin/direction are world space. Returns the hit
  // (or null) so the caller can score, play sounds and show hit markers.
  function shoot(origin, direction, def, shooter) {
    raycaster.set(origin, direction);
    const all = hitMeshes.concat(world.shootables);
    const hit = raycaster.intersectObjects(all, false)[0];
    if (!hit) return null;
    const point = hit.point.clone();
    spawnTracer(origin, point);
    const entity = hit.object.userData.entity;
    if (entity && entity !== shooter && entity.alive) {
      const part = hit.object.userData.part ?? 'torso';
      const damage = def.damage * (part === 'head' ? def.headMult : 1);
      const killed = entity.takeDamage(damage, part, shooter);
      return { hit: true, point, entity, part, damage, killed };
    }
    return { hit: true, point, entity: null, part: null, damage: 0, killed: false };
  }

  function throwGrenade(origin, direction, owner) {
    const velocity = direction.clone().multiplyScalar(13);
    velocity.y += 3.2;
    grenades.push({ position: origin.clone(), velocity, fuse: GRENADE_FUSE, owner, mesh: null });
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.danger), roughness: 0.5 }),
    );
    mesh.position.copy(origin);
    scene.add(mesh);
    grenades[grenades.length - 1].mesh = mesh;
    if (events.onNoise) events.onNoise(origin, 30);
  }

  function explode(position, owner) {
    boomMesh.position.copy(position);
    boomMesh.visible = true;
    boomLife = 0.45;
    boomLight.position.copy(position);
    boomLight.intensity = 60;
    if (events.onExplode) events.onExplode(position);
    for (const entity of targets) {
      if (!entity.alive || entity === owner) continue;
      const distance = entity.position.distanceTo(position);
      if (distance > GRENADE_RADIUS) continue;
      // A wall between the blast and the target halves the damage.
      tracerDirection.copy(entity.position).add(new THREE.Vector3(0, 1.1, 0));
      tracerDirection.sub(position).normalize();
      raycaster.set(position, tracerDirection);
      const wall = raycaster.intersectObjects(world.shootables, false)[0];
      const blocked = wall && wall.distance < distance;
      const damage = GRENADE_DAMAGE * (1 - distance / GRENADE_RADIUS) * (blocked ? 0.5 : 1);
      entity.takeDamage(Math.max(12, damage), 'blast', owner);
    }
  }

  function step(dt) {
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      if (tracer.life <= 0) {
        tracer.line.visible = false;
      } else {
        tracer.line.material.opacity = (tracer.life / TRACER_LIFE) * 0.85;
      }
    }
    if (boomLife > 0) {
      boomLife -= dt;
      const t = Math.max(0, boomLife / 0.45);
      boomMesh.scale.setScalar(1 + (1 - t) * GRENADE_RADIUS);
      boomMesh.material.opacity = t * 0.55;
      boomLight.intensity = t * 60;
      if (boomLife <= 0) {
        boomMesh.visible = false;
        boomLight.intensity = 0;
      }
    }
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const grenade = grenades[i];
      grenade.fuse -= dt;
      grenade.velocity.y -= GRAVITY * dt;
      // Axis-separated movement with a bounce: try each axis, reflect on a hit.
      const pos = grenade.position;
      const vel = grenade.velocity;
      const r = 0.12;
      function blockedAt(x, y, z) {
        probe.min.set(x - r, y - r, z - r);
        probe.max.set(x + r, y + r, z + r);
        for (const collider of world.colliders) {
          if (probe.intersectsBox(collider)) return true;
        }
        return false;
      }
      const nx = pos.x + vel.x * dt;
      if (!blockedAt(nx, pos.y, pos.z)) pos.x = nx;
      else {
        vel.x *= -0.45;
        if (events.onBounce) events.onBounce(pos);
      }
      const nz = pos.z + vel.z * dt;
      if (!blockedAt(pos.x, pos.y, nz)) pos.z = nz;
      else {
        vel.z *= -0.45;
        if (events.onBounce) events.onBounce(pos);
      }
      const ny = pos.y + vel.y * dt;
      if (ny < r) {
        pos.y = r;
        vel.y *= -0.45;
        vel.x *= 0.7;
        vel.z *= 0.7;
        if (events.onBounce) events.onBounce(pos);
      } else if (!blockedAt(pos.x, ny, pos.z)) {
        pos.y = ny;
      } else {
        vel.y *= -0.45;
        if (events.onBounce) events.onBounce(pos);
      }
      if (Math.abs(vel.x) < 0.3) vel.x = 0;
      if (Math.abs(vel.z) < 0.3) vel.z = 0;
      grenade.mesh.position.copy(pos);
      if (grenade.fuse <= 0) {
        scene.remove(grenade.mesh);
        grenades.splice(i, 1);
        explode(pos, grenade.owner);
      }
    }
  }

  return {
    registerTarget,
    shoot,
    throwGrenade,
    explode,
    step,
    events,
    clearGrenades() {
      for (const grenade of grenades) scene.remove(grenade.mesh);
      grenades.length = 0;
    },
  };
}
