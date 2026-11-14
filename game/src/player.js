// The player: the shared body mover plus look, recoil and the health the round
// logic owns. Movement reads the key set; main.js owns shooting and the rules.
import { createBody } from './mover.js';

const LOOK_SENSITIVITY = 0.0022;

export function createPlayer(colliders) {
  const mover = createBody(colliders, 0, 18, { yaw: 0 });
  const body = mover.body;
  const state = { health: 100, alive: true };

  function look(dx, dy) {
    body.yaw -= dx * LOOK_SENSITIVITY;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * LOOK_SENSITIVITY));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wishX = 0;
    let wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      wishX = -sin * forward + cos * strafe;
      wishZ = -cos * forward - sin * strafe;
      const length = Math.hypot(wishX, wishZ);
      wishX /= length;
      wishZ /= length;
    }
    mover.step(dt, wishX, wishZ, {
      crouch: keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC'),
      jump: keys.has('Space'),
    });
  }

  function spawnAt(spawn) {
    body.position.set(spawn.x, 0, spawn.z);
    body.velocity.set(0, 0, 0);
    body.yaw = spawn.yaw;
    body.pitch = 0;
    body.eye = body.standEye;
    body.crouching = false;
    body.height = body.standHeight;
    state.health = 100;
    state.alive = true;
  }

  return {
    body,
    state,
    step,
    look,
    recoil,
    spawnAt,
    groundSpeed() {
      return mover.groundSpeed();
    },
    eyePosition(out) {
      out.set(body.position.x, body.position.y + body.eye, body.position.z);
      return out;
    },
  };
}
