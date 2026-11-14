// One body mover for the player and every bot: acceleration, friction, gravity,
// crouch and jump, resolved as a box against the world's colliders one axis at a
// time, so a wall never swallows anyone. Callers only supply a wish direction.
import * as THREE from 'three';

const RADIUS = 0.34;
const GRAVITY = 20;

export function createBody(colliders, x, z, options = {}) {
  const standHeight = options.standHeight ?? 1.72;
  const crouchHeight = options.crouchHeight ?? 1.12;
  const body = {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw: options.yaw ?? 0,
    pitch: 0,
    eye: options.standEye ?? 1.6,
    onGround: true,
    crouching: false,
    height: standHeight,
    standHeight,
    crouchHeight,
    standEye: options.standEye ?? 1.6,
    crouchEye: options.crouchEye ?? 1.02,
    walkSpeed: options.walkSpeed ?? 5.2,
    crouchSpeed: options.crouchSpeed ?? 2.4,
  };
  const probe = new THREE.Box3();

  // lift keeps the feet and the crown out of the horizontal tests, so standing on
  // the floor is not read as walking into a wall.
  function overlaps(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (const collider of colliders) {
      if (probe.intersectsBox(collider)) return collider;
    }
    return null;
  }

  // wishX/wishZ is a unit (or zero) direction in world space. speed is the target
  // ground speed; accel scales how fast the body reaches it.
  function step(dt, wishX, wishZ, opts = {}) {
    const crouching = !!opts.crouch;
    if (crouching && !body.crouching) {
      body.crouching = true;
      body.height = crouchHeight;
    } else if (!crouching && body.crouching && !overlaps(body.position.x, body.position.y, body.position.z, standHeight, 0.02)) {
      body.crouching = false;
      body.height = standHeight;
    }
    const eyeTarget = body.crouching ? body.crouchEye : body.standEye;
    body.eye += (eyeTarget - body.eye) * Math.min(1, dt * 12);

    const speed = opts.speed ?? (body.crouching ? body.crouchSpeed : body.walkSpeed);
    const accel = body.onGround ? (opts.groundAccel ?? 42) : (opts.airAccel ?? 9);
    const blend = Math.min(1, (accel * dt) / speed);
    body.velocity.x += (wishX * speed - body.velocity.x) * blend;
    body.velocity.z += (wishZ * speed - body.velocity.z) * blend;
    if (body.onGround && wishX === 0 && wishZ === 0) {
      const damp = Math.max(0, 1 - (opts.friction ?? 9) * dt);
      body.velocity.x *= damp;
      body.velocity.z *= damp;
    }

    if (opts.jump && body.onGround) {
      body.velocity.y = opts.jumpSpeed ?? 6.2;
      body.onGround = false;
    }
    body.velocity.y -= GRAVITY * dt;

    const nextX = body.position.x + body.velocity.x * dt;
    if (!overlaps(nextX, body.position.y, body.position.z, body.height, 0.04)) body.position.x = nextX;
    else body.velocity.x = 0;
    const nextZ = body.position.z + body.velocity.z * dt;
    if (!overlaps(body.position.x, body.position.y, nextZ, body.height, 0.04)) body.position.z = nextZ;
    else body.velocity.z = 0;

    body.position.y += body.velocity.y * dt;
    body.onGround = false;
    const hit = overlaps(body.position.x, body.position.y, body.position.z, body.height, 0);
    if (hit && body.velocity.y <= 0) {
      body.position.y = hit.max.y;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (hit) {
      body.position.y = hit.min.y - body.height;
      body.velocity.y = 0;
    }
    if (body.position.y < 0) {
      body.position.y = 0;
      body.velocity.y = 0;
      body.onGround = true;
    }
    body.velocity.y = Math.max(-30, body.velocity.y);
  }

  function groundSpeed() {
    return Math.hypot(body.velocity.x, body.velocity.z);
  }

  return { body, step, overlaps, groundSpeed };
}
