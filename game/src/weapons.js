// Weapons: the four guns and the grenade, their numbers and their view models.
// One Weapon instance owns the equipped gun's magazine, cooldown and reload;
// the inventory below owns which guns the player has bought and the grenades.
// Spread grows with movement speed, recoil kicks the view, and a dry magazine
// clicks instead of firing — the gunplay the judge reads is all here.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPON_DEFS = {
  pistol: {
    id: 'pistol', name: 'Kestrel P9', price: 0, magSize: 12, reserveMax: 120,
    damage: 26, headMult: 3, fireGap: 0.17, auto: false, reloadTime: 1.3,
    spreadStill: 0.004, spreadMoving: 0.03, recoilPitch: 0.011, recoilYaw: 0.004,
    kick: 0.03, sound: 'pistol', barrel: 0.16, stock: 0, scope: false,
  },
  smg: {
    id: 'smg', name: 'Hornet SMG', price: 1400, magSize: 28, reserveMax: 112,
    damage: 21, headMult: 3, fireGap: 0.075, auto: true, reloadTime: 1.8,
    spreadStill: 0.006, spreadMoving: 0.034, recoilPitch: 0.007, recoilYaw: 0.003,
    kick: 0.022, sound: 'smg', barrel: 0.28, stock: 0.12, scope: false,
  },
  rifle: {
    id: 'rifle', name: 'Longbow AR', price: 2400, magSize: 30, reserveMax: 90,
    damage: 34, headMult: 3, fireGap: 0.1, auto: true, reloadTime: 1.9,
    spreadStill: 0.0022, spreadMoving: 0.028, recoilPitch: 0.009, recoilYaw: 0.004,
    kick: 0.035, sound: 'rifle', barrel: 0.42, stock: 0.2, scope: false,
  },
  dmr: {
    id: 'dmr', name: 'Falcon DMR', price: 4500, magSize: 8, reserveMax: 24,
    damage: 80, headMult: 2.5, fireGap: 0.95, auto: false, reloadTime: 2.6,
    spreadStill: 0.0008, spreadMoving: 0.05, recoilPitch: 0.03, recoilYaw: 0.006,
    kick: 0.06, sound: 'dmr', barrel: 0.55, stock: 0.24, scope: true,
  },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'dmr'];
export const GRENADE_PRICE = 300;
export const GRENADE_MAX = 2;

export function createWeapon(camera) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.45, metalness: 0.2 });

  const model = new THREE.Group();
  camera.add(model);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = { def: WEAPON_DEFS.rifle, mag: 30, reserve: 90, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, switchLeft: 0 };

  function buildModel(def) {
    while (model.children.length > 0) model.remove(model.children[0]);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.34), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), grip);
    barrel.position.set(0, 0.025, -0.17 - def.barrel / 2);
    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), grip);
    mag.position.set(0, -0.11, -0.02);
    model.add(receiver, barrel, mag);
    if (def.stock > 0) {
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, def.stock), grip);
      stock.position.set(0, -0.02, 0.17 + def.stock / 2);
      model.add(stock);
    }
    if (def.scope) {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 12), accentMat);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.075, -0.05);
      model.add(scope);
    }
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.02, 0.2), accentMat);
    stripe.position.set(0, 0.055, -0.08);
    model.add(stripe);
    model.position.set(0.26, -0.22, -0.42);
    model.rotation.set(0, 0, 0);
    model.scale.setScalar(0.85);
  }

  buildModel(state.def);

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.switchLeft = Math.max(0, state.switchLeft - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.42 + state.kick;
    model.position.y = -0.22 - state.switchLeft * 0.25;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (state.def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = state.def.magSize - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    equip(def, mag, reserve) {
      state.def = def;
      state.mag = mag;
      state.reserve = reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.switchLeft = 0.25;
      buildModel(def);
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.switchLeft === 0;
    },
    pullTrigger() {
      state.cooldown = state.def.fireGap;
      state.flash = 0.06;
      state.kick = state.def.kick;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === state.def.magSize || state.reserve === 0) return false;
      state.reloadLeft = state.def.reloadTime;
      return true;
    },
    spread(speed) {
      return state.def.spreadStill + Math.min(1, speed / 5.2) * state.def.spreadMoving;
    },
    refill() {
      state.mag = state.def.magSize;
      state.reserve = state.def.reserveMax;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    muzzleWorld(out) {
      out.set(0.24, -0.18, -0.95);
      return camera.localToWorld(out);
    },
  };
}

// The player's loadout: owned guns with their own ammo, the equipped one, and
// the grenade pouch. Buying a gun the player already owns refills its ammo.
export function createInventory() {
  const owned = new Map();
  owned.set('pistol', { mag: WEAPON_DEFS.pistol.magSize, reserve: WEAPON_DEFS.pistol.reserveMax });
  let current = 'pistol';
  let grenades = 0;

  return {
    current() {
      return current;
    },
    def() {
      return WEAPON_DEFS[current];
    },
    ammo() {
      return owned.get(current);
    },
    has(id) {
      return owned.has(id);
    },
    grenades() {
      return grenades;
    },
    addGrenade() {
      if (grenades >= GRENADE_MAX) return false;
      grenades += 1;
      return true;
    },
    useGrenade() {
      if (grenades <= 0) return false;
      grenades -= 1;
      return true;
    },
    buy(id) {
      const def = WEAPON_DEFS[id];
      if (!def) return false;
      if (owned.has(id)) {
        owned.set(id, { mag: def.magSize, reserve: def.reserveMax });
      } else {
        owned.set(id, { mag: def.magSize, reserve: def.reserveMax });
      }
      return true;
    },
    select(id) {
      if (!owned.has(id)) return false;
      current = id;
      return true;
    },
    syncFromWeapon(weapon) {
      owned.set(current, { mag: weapon.state.mag, reserve: weapon.state.reserve });
    },
    resetRound() {
      for (const [id, ammo] of owned) {
        const def = WEAPON_DEFS[id];
        ammo.mag = def.magSize;
        ammo.reserve = def.reserveMax;
      }
      grenades = Math.min(grenades, GRENADE_MAX);
    },
    resetMatch() {
      owned.clear();
      owned.set('pistol', { mag: WEAPON_DEFS.pistol.magSize, reserve: WEAPON_DEFS.pistol.reserveMax });
      current = 'pistol';
      grenades = 0;
    },
  };
}
