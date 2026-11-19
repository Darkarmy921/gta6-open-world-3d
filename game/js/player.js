/* Cayo Azul — player.js (Module C) — REVISION 2
 * On-foot movement, melee combat, kill streak, health.
 * Owns the on-foot parts of CA.state.player. Cars are owned by
 * CA.cars; wanted heat is owned by CA.police; this module only
 * reports crimes to them. Map bounds keep the player off the water
 * and off the island.
 * Deterministic: no Date, no clock reads, no network.
 *
 * Revision changes vs pass 1:
 * - Sprint now uses stamina (player.stamina 0–100): sprint drains it,
 *   it recovers when not sprinting, and sprint stops at zero. The HUD
 *   can read CA.state.player.stamina.
 * - Melee can now hit a police officer as well as a pedestrian:
 *   knocking an officer down adds 2 heat instead of 1.
 * - Melee now writes CA.state.lastMeleeAt / lastMeleeX / lastMeleeZ
 *   (play-time seconds), so traffic.js pedestrians flee the swing
 *   even when it hits nothing.
 * - Added setPosition(x, z, facing) for missions / respawns, and
 *   damage() now applies a small knockback away from the attacker
 *   when a source position is supplied.
 * - Health regen pauses while the wanted level is above 0 (the
 *   player is still in trouble), not just after damage.
 * - Fixed sprint speed: running backwards or strafing no longer
 *   grants sprint speed.
 */
(function () {
  'use strict';

  var CA = (typeof window !== 'undefined' ? window.CA : globalThis.CA) || {};
  if (typeof window !== 'undefined') { window.CA = CA; }
  if (typeof globalThis !== 'undefined') { globalThis.CA = CA; }

  var WALK_SPEED = 4.2;
  var RUN_SPEED = 6.8;
  var SPRINT_SPEED = 9.5;
  var MELEE_RANGE = 2.6;
  var MELEE_ARC = 1.1; /* radians either side of facing */
  var MELEE_COOLDOWN = 0.45;
  var STREAK_WINDOW = 6; /* seconds between knockdowns to keep a streak */
  var REGEN_DELAY = 5; /* seconds out of combat before regen starts */
  var REGEN_RATE = 3; /* health per second */
  var STAMINA_MAX = 100;
  var STAMINA_DRAIN = 22; /* per second while sprinting */
  var STAMINA_RECOVER = 14; /* per second while not sprinting */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function wrapAngle(a) {
    while (a > Math.PI) { a -= Math.PI * 2; }
    while (a < -Math.PI) { a += Math.PI * 2; }
    return a;
  }
  function dist2(ax, az, bx, bz) {
    var dx = ax - bx, dz = az - bz;
    return dx * dx + dz * dz;
  }

  function ensureState() {
    if (!CA.state) { CA.state = {}; }
    var s = CA.state;
    if (!s.player) {
      s.player = { x: 0, y: 0, z: 0, facing: 0, health: 100, maxHealth: 100,
        money: 0, onFoot: true, carId: null, killStreak: 0, streakTimer: 0,
        speed: 0, lastDamageTime: -999, sprinting: false };
    }
    var p = s.player;
    if (typeof p.health !== 'number') { p.health = 100; }
    if (typeof p.maxHealth !== 'number') { p.maxHealth = 100; }
    if (typeof p.killStreak !== 'number') { p.killStreak = 0; }
    if (typeof p.streakTimer !== 'number') { p.streakTimer = 0; }
    if (typeof p.lastDamageTime !== 'number') { p.lastDamageTime = -999; }
    if (typeof p.meleeCooldown !== 'number') { p.meleeCooldown = 0; }
    if (typeof p.meleeSwing !== 'number') { p.meleeSwing = 0; }
    if (typeof p.totalKnockdowns !== 'number') { p.totalKnockdowns = 0; }
    if (typeof p.stamina !== 'number') { p.stamina = STAMINA_MAX; }
    if (typeof p.walkPhase !== 'number') { p.walkPhase = 0; }
    if (typeof s.playTime !== 'number') { s.playTime = 0; }
    if (typeof s.wanted !== 'number') { s.wanted = 0; }
    if (!s.clock) { s.clock = { hour: 10, minute: 0, day: 1 }; }
    if (!s.weather) { s.weather = { raining: false, intensity: 0 }; }
    return s;
  }

  function keyDown(code) {
    var inp = CA.input;
    if (!inp) { return false; }
    if (inp.keys && inp.keys[code]) { return true; }
    if (typeof inp.down === 'function') { try { if (inp.down(code)) { return true; } } catch (e) {} }
    if (typeof inp.isDown === 'function') { try { if (inp.isDown(code)) { return true; } } catch (e) {} }
    return false;
  }
  function keyPressed(code) {
    var inp = CA.input;
    if (!inp) { return false; }
    /* The input module's edge query is wasPressed; the old
       justPressed / pressedOnce names never existed, so this
       always returned false and the F melee key was dead. */
    if (typeof inp.wasPressed === 'function') { try { return !!inp.wasPressed(code); } catch (e) { return false; } }
    if (typeof inp.justPressed === 'function') { try { return !!inp.justPressed(code); } catch (e) { return false; } }
    if (typeof inp.pressedOnce === 'function') { try { return !!inp.pressedOnce(code); } catch (e) { return false; } }
    return false;
  }
  function playSound(name) {
    if (CA.audio && typeof CA.audio.play === 'function') {
      try { CA.audio.play(name); } catch (e) {}
    }
  }
  function spawnParticles(kind, x, y, z, n) {
    if (CA.particles && typeof CA.particles.spawn === 'function') {
      try { CA.particles.spawn(kind, x, y, z, n); } catch (e) {}
    }
  }
  function addHeat(amount, reason) {
    if (CA.police && typeof CA.police.addHeat === 'function') {
      try { CA.police.addHeat(amount, reason); } catch (e) {}
    } else if (CA.police && typeof CA.police.addWanted === 'function') {
      try { CA.police.addWanted(amount, reason); } catch (e) {}
    } else {
      var s = ensureState();
      s.wanted = clamp((s.wanted || 0) + amount, 0, 5);
    }
  }
  function unlockAchievement(id) {
    if (CA.achievements && typeof CA.achievements.unlock === 'function') {
      try { CA.achievements.unlock(id); } catch (e) {}
    }
  }
  function worldBounds() {
    if (CA.city && CA.city.bounds && typeof CA.city.bounds.minX === 'number') {
      return CA.city.bounds;
    }
    return { minX: -1800, maxX: 1800, minZ: -1500, maxZ: 1500 };
  }
  function cameraYaw() {
    if (CA.camera) {
      if (typeof CA.camera.yaw === 'number') { return CA.camera.yaw; }
      if (typeof CA.camera.heading === 'number') { return CA.camera.heading; }
      if (typeof CA.camera.angle === 'number') { return CA.camera.angle; }
    }
    var s = CA.state;
    return (s && s.player) ? s.player.facing : 0;
  }
  function isBlocked(x, z) {
    if (CA.city && typeof CA.city.isBlocked === 'function') {
      try { return !!CA.city.isBlocked(x, z); } catch (e) { return false; }
    }
    if (CA.city && typeof CA.city.isInWater === 'function') {
      try { return !!CA.city.isInWater(x, z); } catch (e) { return false; }
    }
    if (CA.city && typeof CA.city.isWaterAt === 'function') {
      try { return !!CA.city.isWaterAt(x, z); } catch (e) { return false; }
    }
    return false;
  }

  /* ---------- positioning (missions / respawns) ---------- */
  function setPosition(x, z, facing) {
    var s = ensureState();
    var p = s.player;
    if (typeof x === 'number') { p.x = x; }
    if (typeof z === 'number') { p.z = z; }
    if (typeof facing === 'number') { p.facing = facing; }
    p.y = 0;
    p.speed = 0;
    var b = worldBounds();
    p.x = clamp(p.x, b.minX + 2, b.maxX - 2);
    p.z = clamp(p.z, b.minZ + 2, b.maxZ - 2);
    return p;
  }

  /* ---------- health ---------- */
  function damage(amount, source, fromX, fromZ) {
    var s = ensureState();
    var p = s.player;
    if (p.health <= 0 || typeof amount !== 'number' || amount <= 0) { return p.health; }
    p.health = Math.max(0, p.health - amount);
    p.lastDamageTime = s.playTime;
    p.lastDamageSource = source || 'unknown';
    /* Knockback away from the attacker, when its position is known. */
    if (typeof fromX === 'number' && typeof fromZ === 'number') {
      var dx = p.x - fromX, dz = p.z - fromZ;
      var len = Math.sqrt(dx * dx + dz * dz) || 1;
      var nx = p.x + (dx / len) * 1.2;
      var nz = p.z + (dz / len) * 1.2;
      if (!isBlocked(nx, nz)) { p.x = nx; p.z = nz; }
    }
    playSound('hurt');
    if (CA.camera && typeof CA.camera.shake === 'function') {
      try { CA.camera.shake(0.25); } catch (e) {}
    }
    if (p.health <= 0) {
      if (CA.police && typeof CA.police.onPlayerWasted === 'function') {
        try { CA.police.onPlayerWasted(source); } catch (e) {}
      }
    }
    return p.health;
  }

  function heal(amount) {
    var s = ensureState();
    var p = s.player;
    if (typeof amount !== 'number' || amount <= 0) { return p.health; }
    p.health = Math.min(p.maxHealth, p.health + amount);
    return p.health;
  }

  function refillHealth(reason) {
    var s = ensureState();
    var p = s.player;
    p.health = p.maxHealth;
    if (reason === 'garage') { playSound('heal'); }
    return p.health;
  }

  /* ---------- kill streak ---------- */
  function streakMultiplier() {
    var s = ensureState();
    var k = s.player.killStreak || 0;
    if (k <= 1) { return 1; }
    /* +5% per extra knockdown in the streak, capped at +50%. */
    return 1 + Math.min(0.5, (k - 1) * 0.05);
  }

  function registerKnockdown() {
    var s = ensureState();
    var p = s.player;
    if (p.streakTimer > 0) {
      p.killStreak += 1;
    } else {
      p.killStreak = 1;
    }
    p.streakTimer = STREAK_WINDOW;
    p.totalKnockdowns += 1;
    if (p.killStreak >= 5) { unlockAchievement('streak-five'); }
    return p.killStreak;
  }

  /* ---------- melee ---------- */
  function meleeAttack() {
    var s = ensureState();
    var p = s.player;
    if (!p.onFoot) { return null; }
    if (p.meleeCooldown > 0) { return null; }
    if (p.health <= 0) { return null; }
    p.meleeCooldown = MELEE_COOLDOWN;
    p.meleeSwing = 0.25; /* HUD / render can read this for the swing pose */
    playSound('melee');
    /* Publish the swing so traffic pedestrians flee it. */
    s.lastMeleeAt = s.playTime;
    s.lastMeleeX = p.x;
    s.lastMeleeZ = p.z;
    var hitX = p.x + Math.sin(p.facing) * MELEE_RANGE * 0.7;
    var hitZ = p.z + Math.cos(p.facing) * MELEE_RANGE * 0.7;
    spawnParticles('melee', hitX, 1.1, hitZ, 3);
    var result = { hitPedestrian: null, hitOfficer: null, hitCar: null,
                   knockedDown: false };

    /* Pedestrians in front, inside range and arc. */
    var peds = s.pedestrians || [];
    var best = null, bestD = MELEE_RANGE * MELEE_RANGE;
    for (var i = 0; i < peds.length; i++) {
      var ped = peds[i];
      if (ped.state === 'down') { continue; }
      var d2 = dist2(p.x, p.z, ped.x, ped.z);
      if (d2 > bestD) { continue; }
      var ang = Math.atan2(ped.x - p.x, ped.z - p.z);
      if (Math.abs(wrapAngle(ang - p.facing)) > MELEE_ARC) { continue; }
      bestD = d2; best = ped;
    }
    if (best) {
      result.hitPedestrian = best;
      var knocked = false;
      if (CA.traffic && typeof CA.traffic.knockDown === 'function') {
        try { knocked = CA.traffic.knockDown(best, 'melee'); } catch (e) {}
      } else {
        best.state = 'down'; best.downTimer = 8; knocked = true;
      }
      if (knocked) {
        result.knockedDown = true;
        registerKnockdown();
        addHeat(1, 'assault');
        spawnParticles('hit', best.x, 1.1, best.z, 5);
        if (CA.traffic && typeof CA.traffic.scarePedestrians === 'function') {
          try { CA.traffic.scarePedestrians(p.x, p.z, 12, 'melee'); } catch (e) {}
        }
      }
      return result;
    }

    /* Police officers in front: hitting one is a bigger crime. */
    var officers = s.police || [];
    var bestOfficer = null, bestOfficerD = MELEE_RANGE * MELEE_RANGE;
    for (var oi = 0; oi < officers.length; oi++) {
      var off = officers[oi];
      if (off.state === 'down') { continue; }
      var od2 = dist2(p.x, p.z, off.x, off.z);
      if (od2 > bestOfficerD) { continue; }
      var oang = Math.atan2(off.x - p.x, off.z - p.z);
      if (Math.abs(wrapAngle(oang - p.facing)) > MELEE_ARC) { continue; }
      bestOfficerD = od2; bestOfficer = off;
    }
    if (bestOfficer) {
      result.hitOfficer = bestOfficer;
      bestOfficer.state = 'down';
      bestOfficer.downTimer = 10;
      bestOfficer.arrestTimer = 0;
      result.knockedDown = true;
      registerKnockdown();
      addHeat(2, 'assaulting an officer');
      spawnParticles('hit', bestOfficer.x, 1.1, bestOfficer.z, 5);
      return result;
    }

    /* No person: a car window in front can be broken. */
    var cars = s.cars || [];
    var bestCar = null, bestCarD = MELEE_RANGE * MELEE_RANGE;
    for (var k = 0; k < cars.length; k++) {
      var car = cars[k];
      if (car.wrecked) { continue; }
      var cd2 = dist2(p.x, p.z, car.x, car.z);
      if (cd2 > bestCarD) { continue; }
      var cang = Math.atan2(car.x - p.x, car.z - p.z);
      if (Math.abs(wrapAngle(cang - p.facing)) > MELEE_ARC) { continue; }
      bestCarD = cd2; bestCar = car;
    }
    if (bestCar) {
      result.hitCar = bestCar;
      if (CA.cars && typeof CA.cars.breakWindow === 'function') {
        try { CA.cars.breakWindow(bestCar); } catch (e) {}
      } else {
        bestCar.windowBroken = true;
      }
      addHeat(0.25, 'vandalism');
    }
    return result;
  }

  /* ---------- movement ---------- */
  function stepMovement(dt) {
    var s = ensureState();
    var p = s.player;
    /* (G integration: while driving, the car module owns p.speed —
       the old code zeroed it here after cars.update had just set
       it, so the HUD speed read 0 km/h at any speed.) */
    if (!p.onFoot || p.health <= 0) { if (p.onFoot) { p.speed = 0; } p.sprinting = false; return; }
    var fwd = 0, strafe = 0;
    if (keyDown('KeyW') || keyDown('ArrowUp')) { fwd += 1; }
    if (keyDown('KeyS') || keyDown('ArrowDown')) { fwd -= 1; }
    if (keyDown('KeyA') || keyDown('ArrowLeft')) { strafe -= 1; }
    if (keyDown('KeyD') || keyDown('ArrowRight')) { strafe += 1; }
    var moving = (fwd !== 0 || strafe !== 0);
    var wantSprint = (keyDown('ShiftLeft') || keyDown('ShiftRight')) && fwd > 0;
    /* Sprint only while stamina lasts; it recovers when not sprinting. */
    p.sprinting = wantSprint && p.stamina > 0 && moving;
    if (p.sprinting) {
      p.stamina = Math.max(0, p.stamina - STAMINA_DRAIN * dt);
      if (p.stamina <= 0) { p.sprinting = false; }
    } else {
      p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_RECOVER * dt);
    }
    var speed = WALK_SPEED;
    if (moving) {
      if (p.sprinting) { speed = SPRINT_SPEED; }
      else if (fwd > 0 && strafe === 0) { speed = RUN_SPEED; }
      else if (fwd > 0) { speed = RUN_SPEED * 0.9; }
      else { speed = WALK_SPEED; }
    }
    /* Rain makes footing slightly looser: a touch slower on foot. */
    if (s.weather && s.weather.raining) { speed *= 0.96; }
    var yaw = cameraYaw();
    var len = Math.sqrt(fwd * fwd + strafe * strafe) || 1;
    fwd /= len; strafe /= len;
    /* Camera-relative: forward is where the camera looks, strafe is right. */
    var mx = Math.sin(yaw) * fwd + Math.cos(yaw) * strafe;
    var mz = Math.cos(yaw) * fwd - Math.sin(yaw) * strafe;
    p.speed = moving ? speed : 0;
    if (moving) {
      var wantFacing = Math.atan2(mx, mz);
      var diff = wrapAngle(wantFacing - p.facing);
      p.facing += clamp(diff, -dt * 10, dt * 10);
      var nx = p.x + mx * speed * dt;
      var nz = p.z + mz * speed * dt;
      var b = worldBounds();
      nx = clamp(nx, b.minX + 2, b.maxX - 2);
      nz = clamp(nz, b.minZ + 2, b.maxZ - 2);
      /* Buildings and water block the step; slide along them instead. */
      if (!isBlocked(nx, nz)) {
        p.x = nx; p.z = nz;
      } else if (!isBlocked(nx, p.z)) {
        p.x = nx;
      } else if (!isBlocked(p.x, nz)) {
        p.z = nz;
      }
      p.walkPhase = (p.walkPhase || 0) + dt * speed * 1.6;
    }
    p.y = 0;
  }

  /* ---------- update ---------- */
  function update(dt) {
    if (typeof dt !== 'number' || dt <= 0) { dt = 0.016; }
    dt = Math.min(dt, 0.05);
    var s = ensureState();
    var p = s.player;
    if (typeof s.playTime === 'number') { s.playTime += dt; }

    if (p.meleeCooldown > 0) { p.meleeCooldown -= dt; }
    if (p.meleeSwing > 0) { p.meleeSwing -= dt; }
    if (p.streakTimer > 0) {
      p.streakTimer -= dt;
      if (p.streakTimer <= 0) { p.killStreak = 0; }
    }

    /* Melee on Space or F (edge for F, held Space repeats on cooldown). */
    if (p.onFoot && p.health > 0) {
      if (keyPressed('KeyF') || keyDown('Space')) { meleeAttack(); }
    }

    stepMovement(dt);

    /* Health regen, slowly, only out of combat and not actively wanted. */
    if (p.health > 0 && p.health < p.maxHealth) {
      var wanted = (CA.police && typeof CA.police.level === 'function')
        ? CA.police.level() : (s.wanted || 0);
      if (s.playTime - p.lastDamageTime > REGEN_DELAY && wanted === 0) {
        p.health = Math.min(p.maxHealth, p.health + REGEN_RATE * dt);
      }
    }

    /* Keep the player inside the island even if another module moved them. */
    var b = worldBounds();
    p.x = clamp(p.x, b.minX + 2, b.maxX - 2);
    p.z = clamp(p.z, b.minZ + 2, b.maxZ - 2);
  }

  /* ---------- draw (person assembly, on foot only) ---------- */
  /* One cached GPU mesh for the player figure. (G integration:
     CA.mesh.person returns raw mesh data — the old code passed
     world coordinates as its colour argument and nothing drew.) */
  var playerGpuMesh = null;
  function draw() {
    var s = ensureState();
    var p = s.player;
    if (!p.onFoot || p.health <= 0) { return; }
    if (!CA.mesh || typeof CA.mesh.person !== 'function') { return; }
    if (!CA.gl || typeof CA.gl.createMesh !== 'function' ||
        typeof CA.gl.drawMesh !== 'function') { return; }
    if (!playerGpuMesh) {
      playerGpuMesh = CA.gl.createMesh(CA.mesh.person('#2e6f4e', '#d9a066', '#2c3e50'));
      if (!playerGpuMesh) { return; }
    }
    var bob = Math.abs(Math.sin(p.walkPhase || 0)) * 0.1;
    var model;
    if (CA.render && typeof CA.render.modelMatrix === 'function') {
      model = CA.render.modelMatrix(p.x, (p.y || 0) + bob, p.z, p.facing);
    } else {
      var c = Math.cos(p.facing || 0), sn = Math.sin(p.facing || 0);
      model = [c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, p.x, (p.y || 0) + bob, p.z, 1];
    }
    CA.gl.drawMesh(playerGpuMesh, model);
  }

  CA.player = {
    WALK_SPEED: WALK_SPEED,
    RUN_SPEED: RUN_SPEED,
    SPRINT_SPEED: SPRINT_SPEED,
    STAMINA_MAX: STAMINA_MAX,
    MELEE_RANGE: MELEE_RANGE,
    update: update,
    meleeAttack: meleeAttack,
    damage: damage,
    heal: heal,
    refillHealth: refillHealth,
    setPosition: setPosition,
    streakMultiplier: streakMultiplier,
    registerKnockdown: registerKnockdown,
    getStreak: function () { return ensureState().player.killStreak; },
    getHealth: function () { return ensureState().player.health; },
    getStamina: function () { return ensureState().player.stamina; },
    isAlive: function () { return ensureState().player.health > 0; },
    draw: draw
  };

  ensureState();
})();
