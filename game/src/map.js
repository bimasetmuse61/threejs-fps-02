// Cinder Yard: an original dusk desert yard, 56 x 44 m, built from boxes and
// cylinders only. Two bomb sites (Silo west, Depot east), three lanes (west, mid,
// east) joined by two cross connectors, and cover sized for crouch play. Every
// solid is a collider for bodies and a surface bullets stop on. The nav graph at
// the bottom is what the bots walk: nodes at junctions and holds, edges between
// neighbours, with a BFS route() the bots share.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Nav nodes: id, x, z, and the yaw a bot holding there faces (toward the lane's
// likely approach). South (z +) is the Vanguard spawn, north (z -) Ember's.
// Yaw 0 looks north (-z); yaw PI looks south (+z).
export const NAV = [
  { id: 'vs0', x: 0, z: 18, yaw: 0 },
  { id: 'vs1', x: -8, z: 18, yaw: 0 },
  { id: 'vs2', x: 8, z: 18, yaw: 0 },
  { id: 'es0', x: 0, z: -18, yaw: Math.PI },
  { id: 'es1', x: -8, z: -18, yaw: Math.PI },
  { id: 'es2', x: 8, z: -18, yaw: Math.PI },
  { id: 'm0', x: 0, z: 10, yaw: 0 },
  { id: 'm1', x: 0, z: 0, yaw: 0 },
  { id: 'm2', x: 0, z: -8, yaw: Math.PI },
  { id: 'w0', x: -20, z: 14, yaw: 0 },
  { id: 'w1', x: -20, z: 4, yaw: 0 },
  { id: 'w2', x: -20, z: -6, yaw: 0 },
  { id: 'e0', x: 20, z: 14, yaw: 0 },
  { id: 'e1', x: 20, z: 4, yaw: 0 },
  { id: 'e2', x: 20, z: -6, yaw: 0 },
  { id: 'c0', x: -10, z: 0, yaw: Math.PI / 2 },
  { id: 'c1', x: 10, z: 0, yaw: -Math.PI / 2 },
  { id: 'c2', x: -10, z: -10, yaw: Math.PI / 2 },
  { id: 'c3', x: 10, z: -10, yaw: -Math.PI / 2 },
  { id: 'a0', x: -20, z: -13, yaw: 0 },
  { id: 'a1', x: -14, z: -16, yaw: Math.PI / 4 },
  { id: 'b0', x: 20, z: -13, yaw: 0 },
  { id: 'b1', x: 14, z: -16, yaw: -Math.PI / 4 },
  { id: 'd0', x: -8, z: -14, yaw: Math.PI },
  { id: 'd1', x: 8, z: -14, yaw: Math.PI },
  { id: 'd2', x: 0, z: -14, yaw: Math.PI },
  { id: 'h0', x: -12, z: 8, yaw: 0 },
  { id: 'h1', x: 12, z: 8, yaw: 0 },
];
const EDGES = [
  ['vs0', 'vs1'], ['vs0', 'vs2'], ['vs0', 'm0'], ['vs1', 'w0'], ['vs2', 'e0'],
  ['vs1', 'h0'], ['vs2', 'h1'], ['m0', 'h0'], ['m0', 'h1'], ['m0', 'm1'],
  ['w0', 'w1'], ['w1', 'w2'], ['w2', 'a0'], ['w2', 'c2'],
  ['e0', 'e1'], ['e1', 'e2'], ['e2', 'b0'], ['e2', 'c3'],
  ['m1', 'c0'], ['m1', 'c1'], ['m1', 'm2'], ['c0', 'w1'], ['c1', 'e1'],
  ['c0', 'c2'], ['c1', 'c3'], ['c2', 'a0'], ['c3', 'b0'], ['c2', 'd0'],
  ['c3', 'd1'], ['m2', 'd2'], ['d2', 'd0'], ['d2', 'd1'], ['d0', 'a1'],
  ['d1', 'b1'], ['a0', 'a1'], ['b0', 'b1'], ['es0', 'd2'], ['es1', 'd0'],
  ['es2', 'd1'], ['es0', 'es1'], ['es0', 'es2'],
];
const NAV_BY_ID = new Map(NAV.map((node) => [node.id, node]));
const ADJACENT = new Map(NAV.map((node) => [node.id, []]));
for (const [a, b] of EDGES) {
  ADJACENT.get(a).push(b);
  ADJACENT.get(b).push(a);
}

export function nodeById(id) {
  return NAV_BY_ID.get(id);
}

export function nearestNode(x, z) {
  let best = NAV[0];
  let bestD = Infinity;
  for (const node of NAV) {
    const d = (node.x - x) ** 2 + (node.z - z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = node;
    }
  }
  return best;
}

// Breadth-first route from one node to another, as a list of node ids.
export function route(fromId, toId) {
  if (fromId === toId) return [fromId];
  const came = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of ADJACENT.get(current) ?? []) {
      if (came.has(next)) continue;
      came.set(next, current);
      if (next === toId) {
        const path = [toId];
        let step = current;
        while (step !== null) {
          path.unshift(step);
          step = came.get(step);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [fromId];
}

export const SITES = {
  A: { name: 'Silo', x: -20, z: -13, radius: 4.2, node: 'a0' },
  B: { name: 'Depot', x: 20, z: -13, radius: 4.2, node: 'b0' },
};

export const SPAWNS = {
  vanguard: [
    { x: 0, z: 18, yaw: 0 },
    { x: -4, z: 19, yaw: 0 },
    { x: 4, z: 19, yaw: 0 },
    { x: -8, z: 17, yaw: 0 },
    { x: 8, z: 17, yaw: 0 },
  ],
  ember: [
    { x: 0, z: -18, yaw: Math.PI },
    { x: -4, z: -19, yaw: Math.PI },
    { x: 4, z: -19, yaw: Math.PI },
    { x: -8, z: -17, yaw: Math.PI },
    { x: 8, z: -17, yaw: Math.PI },
  ],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.94,
      metalness: name === 'rust' ? 0.35 : 0.03,
    });
  }
  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(radius, height, x, y, z, material, segments = 18) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // A box bounds the cylinder for collision and bullets: close enough at this scale.
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Ground: one sand slab, plus darker patches laid flat (visual only).
  box(56.8, 0.4, 44.8, 0, -0.2, 0, 'sand');
  box(14, 0.02, 10, -14, 0.01, 8, 'sandLight', false);
  box(12, 0.02, 9, 12, 0.01, -4, 'sandLight', false);
  box(10, 0.02, 8, 0, 0.01, -14, 'sandLight', false);
  // Perimeter walls, 5 m, open sky above.
  box(0.6, 5, 44.8, -28.3, 2.5, 0, 'surface');
  box(0.6, 5, 44.8, 28.3, 2.5, 0, 'surface');
  box(56.8, 5, 0.6, 0, 2.5, -22.3, 'surface');
  box(56.8, 5, 0.6, 0, 2.5, 22.3, 'surface');

  // Site A — Silo: two rust tanks, a pipe gantry, crates.
  cylinder(2.4, 6.4, -24, 3.2, -15, 'rust');
  cylinder(1.8, 5.2, -18, 2.6, -18, 'rust');
  box(1.0, 1.0, 9, -24, 5.4, -10.5, 'hairline');
  box(2.2, 1.1, 1.2, -16.5, 0.55, -11, 'hairline');
  box(1.2, 1.1, 2.2, -23.5, 0.55, -8.5, 'hairline');
  box(1.2, 2.2, 1.2, -15, 1.1, -16.5, 'surface');
  // Site B — Depot: stacked containers and barrels.
  box(4.8, 2.4, 2.4, 24, 1.2, -16, 'surface');
  box(4.8, 2.4, 2.4, 24, 3.6, -16, 'hairline');
  box(2.4, 2.4, 2.4, 17.5, 1.2, -17, 'rust');
  cylinder(0.55, 1.1, 16.5, 0.55, -10.5, 'rust');
  cylinder(0.55, 1.1, 18, 0.55, -10.5, 'rust');
  box(1.2, 1.1, 2.4, 23.5, 0.55, -9, 'hairline');

  // Mid: a low wall pair and a central pillar split the lane into two.
  box(1.4, 3.4, 1.4, 0, 1.7, 2, 'surface');
  box(3.4, 1.1, 1.2, -5, 0.55, 6, 'hairline');
  box(3.4, 1.1, 1.2, 5, 0.55, -2, 'hairline');
  box(1.2, 1.1, 3.4, -5, 0.55, -6, 'hairline');
  box(1.2, 1.1, 3.4, 5, 0.55, 6, 'hairline');
  // West and east lanes: crates to crouch behind, tall blocks for sightline breaks.
  box(2.4, 1.1, 1.2, -20, 0.55, 9, 'hairline');
  box(1.2, 2.4, 1.2, -20, 1.2, -1, 'surface');
  box(2.4, 1.1, 1.2, 20, 0.55, 9, 'hairline');
  box(1.2, 2.4, 1.2, 20, 1.2, -1, 'surface');
  box(1.6, 0.9, 1.6, -13, 0.45, 12, 'hairline');
  box(1.6, 0.9, 1.6, 13, 0.45, 12, 'hairline');
  box(1.6, 0.9, 1.6, -14, 0.45, -6, 'rust');
  box(1.6, 0.9, 1.6, 14, 0.45, -6, 'rust');
  // Spawn cover: two blocks each side of the lane, so neither side is shot
  // from across the map at round start, but the lane itself stays open.
  box(3, 2.2, 0.8, -5.5, 1.1, 14.5, 'surface');
  box(3, 2.2, 0.8, 5.5, 1.1, 14.5, 'surface');
  box(3, 2.2, 0.8, -5.5, 1.1, -14.5, 'surface');
  box(3, 2.2, 0.8, 5.5, 1.1, -14.5, 'surface');
  // Distant skyline silhouettes outside the walls, for the dusk read.
  box(10, 9, 4, -34, 4.5, -8, 'canvas', false);
  box(8, 12, 4, 36, 6, 6, 'canvas', false);
  box(12, 7, 4, 6, 3.5, -30, 'canvas', false);
  box(9, 10, 4, -12, 5, 30, 'canvas', false);

  // Bomb-site markers: a glowing ring on the ground and a lamp pole.
  const siteMarkers = {};
  for (const key of Object.keys(SITES)) {
    const site = SITES[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.25, site.radius, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.03, site.z);
    group.add(ring);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 8), materials.hairline);
    pole.position.set(site.x + site.radius - 0.4, 1.7, site.z + site.radius - 0.4);
    group.add(pole);
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE.accent), 14, 14, 1.6);
    lamp.position.set(site.x, 3.2, site.z);
    scene.add(lamp);
    siteMarkers[key] = { ring, lamp };
  }

  // Light: a low warm sun from the west, a cool violet sky fill, lamps at the sites.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8a7aa8'), new THREE.Color(PALETTE.canvas), 1.25);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.7);
  sun.position.set(-26, 12, 10);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -32;
  sun.shadow.camera.right = 32;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7a86b8'), 0.5);
  fill.position.set(20, 14, 16);
  scene.add(fill);
  const midLamp = new THREE.PointLight(new THREE.Color('#ffd9a0'), 8, 12, 1.8);
  midLamp.position.set(0, 3.4, 2);
  scene.add(midLamp);

  return { colliders, shootables, group, siteMarkers };
}
