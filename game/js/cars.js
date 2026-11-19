/* Cayo Azul — cars.js (Module C) — REVISION 2
 * Car models, arcade 3D physics, entering / exiting / stealing.
 * Owns CA.state.cars. Draws through CA.mesh's car assembly.
 * Shared conventions: CA global; x = east, z = north, y = up;
 * facing is an angle around the up axis. Deterministic: the only
 * randomness here is an internal seeded generator (seed from
 * CA.state.seed, default 1337); no Date, no clock reads, no network.
 *
 * Revision changes vs pass 1:
 * - Fixed the E-key edge detection (pass 1 tracked the wrong previous
 *   state, so a held E could re-trigger). The module now keeps its own
 *   per-code previous-key table, updated every frame.
 * - Added a handbrake (Space while driving): hard stop, more drift.
 * - Added repairCar (garage / mission use) and isPlayerDriving.
 * - NPC-spawned cars now get a colour variant from the model's palette
 *   instead of every car sharing one colour.
 * - Hard crashes now hurt the driver a little and shake the camera
 *   proportional to impact speed.
 * - Wrecked, unowned cars far from the player are cleaned up so the
 *   car list cannot grow without bound during long sessions.
 * - Added headlightsOn / brakeLight state on each car for the renderer.
 */
(function () {
  'use strict';

  var CA = (typeof window !== 'undefined' ? window.CA : globalThis.CA) || {};
  if (typeof window !== 'undefined') { window.CA = CA; }
  if (typeof globalThis !== 'undefined') { globalThis.CA = CA; }

  /* ---------- internal deterministic rng (LCG) ---------- */
  var rngState = 1337;
  function rng() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  }
  function rngRange(a, b) { return a + rng() * (b - a); }
  function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

  /* ---------- state ---------- */
  function ensureState() {
    if (!CA.state) { CA.state = {}; }
    var s = CA.state;
    if (!s.player) {
      s.player = { x: 0, y: 0, z: 0, facing: 0, health: 100, maxHealth: 100,
        money: 0, onFoot: true, carId: null, killStreak: 0, streakTimer: 0,
        speed: 0, lastDamageTime: -999, sprinting: false };
    }
    if (!Array.isArray(s.cars)) { s.cars = []; }
    if (typeof s.wanted !== 'number') { s.wanted = 0; }
    if (typeof s.seed === 'number') { rngState = s.seed >>> 0 || 1337; }
    if (!s.clock) { s.clock = { hour: 10, minute: 0, day: 1 }; }
    if (!s.weather) { s.weather = { raining: false, intensity: 0 }; }
    if (typeof s.playTime !== 'number') { s.playTime = 0; }
    return s;
  }

  /* ---------- helpers ---------- */
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

  /* Edge-triggered keys: this module owns its previous-state table and
   * refreshes it once per update, so a held key fires exactly once. */
  var prevKeys = {};
  var TRACKED_KEYS = ['KeyE', 'KeyH', 'Space', 'KeyF'];
  function keyDown(code) {
    var inp = CA.input;
    if (!inp) { return false; }
    if (inp.keys && typeof inp.keys === 'object') {
      if (inp.keys[code]) { return true; }
    }
    if (typeof inp.down === 'function') { try { if (inp.down(code)) { return true; } } catch (e) {} }
    if (typeof inp.isDown === 'function') { try { if (inp.isDown(code)) { return true; } } catch (e) {} }
    if (typeof inp.pressed === 'function') { try { if (inp.pressed(code)) { return true; } } catch (e) {} }
    return false;
  }
  function keyPressed(code) {
    var inp = CA.input;
    if (!inp) { return false; }
    /* The input module's edge query is wasPressed. The old code
       fell back to keyDown && !prevKeys, which misses any quick
       press whose keyup lands before the next frame — at low
       frame rates the E key to enter a car was lost most of the
       time. */
    if (typeof inp.wasPressed === 'function') { try { return !!inp.wasPressed(code); } catch (e) {} }
    if (typeof inp.justPressed === 'function') { try { return !!inp.justPressed(code); } catch (e) {} }
    if (typeof inp.pressedOnce === 'function') { try { return !!inp.pressedOnce(code); } catch (e) {} }
    return keyDown(code) && !prevKeys[code];
  }
  function refreshPrevKeys() {
    for (var i = 0; i < TRACKED_KEYS.length; i++) {
      prevKeys[TRACKED_KEYS[i]] = keyDown(TRACKED_KEYS[i]);
    }
  }
  function playSound(name) {
    if (CA.audio && typeof CA.audio.play === 'function') {
      try { CA.audio.play(name); } catch (e) {}
    } else if (CA.audio && typeof CA.audio.sfx === 'function') {
      try { CA.audio.sfx(name); } catch (e) {}
    }
  }
  function spawnParticles(kind, x, y, z, n) {
    if (CA.particles && typeof CA.particles.spawn === 'function') {
      try { CA.particles.spawn(kind, x, y, z, n); } catch (e) {}
    } else if (CA.particles && typeof CA.particles.burst === 'function') {
      try { CA.particles.burst(kind, x, y, z, n); } catch (e) {}
    }
  }
  function addHeat(amount, reason) {
    if (CA.police && typeof CA.police.addHeat === 'function') {
      try { CA.police.addHeat(amount, reason); } catch (e) {}
    } else if (CA.police && typeof CA.police.addWanted === 'function') {
      try { CA.police.addWanted(amount, reason); } catch (e) {}
    } else {
      var s = ensureState();
      s.wanted = clamp(s.wanted + amount, 0, 5);
    }
  }
  function isNight() {
    var s = ensureState();
    if (CA.weather && typeof CA.weather.isNight === 'function') {
      try { return !!CA.weather.isNight(); } catch (e) {}
    }
    var h = s.clock ? s.clock.hour : 12;
    return h >= 19 || h < 6;
  }
  function worldBounds() {
    if (CA.city && CA.city.bounds && typeof CA.city.bounds.minX === 'number') {
      return CA.city.bounds;
    }
    return { minX: -1800, maxX: 1800, minZ: -1500, maxZ: 1500 };
  }

  /* ---------- models ---------- */
  var MODELS = [
    { id: 'hatchback', name: 'Azulito Hatch', colour: '#e8b23a', topSpeed: 26,
      acceleration: 11, handling: 1.15, price: 4500, seats: 4, size: 1.0,
      palette: ['#e8b23a', '#7ec8e3', '#e36a7e', '#f2f2f2'],
      desc: 'Small hatchback, nimble and cheap.' },
    { id: 'sedan', name: 'Coral Sedan', colour: '#3a7bd5', topSpeed: 30,
      acceleration: 12, handling: 1.0, price: 9500, seats: 4, size: 1.1,
      palette: ['#3a7bd5', '#5a5a66', '#8a2f3c', '#d9d9d9'],
      desc: 'Everyday sedan, balanced all-rounder.' },
    { id: 'taxi', name: 'Harbour Taxi', colour: '#f2c200', topSpeed: 29,
      acceleration: 11.5, handling: 1.0, price: 12000, seats: 4, size: 1.1,
      palette: ['#f2c200'],
      desc: 'Taxi cab, roof sign, honest fares.' },
    { id: 'pickup', name: 'Dune Pickup', colour: '#c65a2e', topSpeed: 28,
      acceleration: 10, handling: 0.85, price: 14000, seats: 2, size: 1.25,
      palette: ['#c65a2e', '#3f6b4f', '#4a4a55', '#c9a86a'],
      desc: 'Pickup truck, heavy and hard to push around.' },
    { id: 'sports', name: 'Vela GT Coupe', colour: '#c22e4a', topSpeed: 42,
      acceleration: 18, handling: 1.25, price: 32000, seats: 2, size: 1.05,
      palette: ['#c22e4a', '#f2f2f2', '#1c1c22', '#e8b23a'],
      desc: 'Sports coupe, the fastest car on the island.' },
    { id: 'police', name: 'Cayo Patrol Cruiser', colour: '#1c1c22', topSpeed: 36,
      acceleration: 15, handling: 1.1, price: 0, seats: 4, size: 1.15,
      palette: ['#1c1c22'], policeOnly: true,
      desc: 'Police cruiser. Not buyable.' }
  ];
  var MODEL_BY_ID = {};
  MODELS.forEach(function (m) { MODEL_BY_ID[m.id] = m; });

  var nextCarId = 1;

  function makeCar(modelId, x, z, facing, opts) {
    var model = MODEL_BY_ID[modelId] || MODEL_BY_ID.sedan;
    opts = opts || {};
    var colour = opts.colour;
    if (!colour && !opts.owned && model.palette) {
      colour = pick(model.palette); /* NPC cars vary; owned cars keep theirs */
    }
    if (!colour) { colour = model.colour; }
    var car = {
      id: opts.id || ('car-' + (nextCarId++)),
      modelId: model.id,
      name: model.name,
      colour: colour,
      x: x, y: 0, z: z,
      facing: (typeof facing === 'number' ? facing : 0),
      speed: 0,
      steer: 0,
      damage: 0,
      wrecked: false,
      smoke: 0,
      driver: opts.driver || 'none', /* none | npc | player | police | traffic */
      owner: opts.owner || null,
      owned: !!opts.owned,
      locked: !!opts.locked,
      windowBroken: false,
      hornTimer: 0,
      brakeLight: false,
      headlightsOn: false,
      handbrake: false,
      drift: 0,
      stuckTimer: 0,
      parked: !!opts.parked,
      siren: !!opts.siren,
      lastX: x, lastZ: z,
      despawn: !!opts.despawn
    };
    return car;
  }

  /* ---------- public API ---------- */
  function spawnCar(modelId, x, z, facing, opts) {
    var s = ensureState();
    var car = makeCar(modelId, x, z, facing, opts);
    s.cars.push(car);
    return car;
  }

  function removeCar(carOrId) {
    var s = ensureState();
    var id = (typeof carOrId === 'string') ? carOrId : (carOrId && carOrId.id);
    for (var i = 0; i < s.cars.length; i++) {
      if (s.cars[i].id === id) {
        if (s.player.carId === id) {
          s.player.carId = null;
          s.player.onFoot = true;
        }
        s.cars.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  function getCar(id) {
    var s = ensureState();
    for (var i = 0; i < s.cars.length; i++) {
      if (s.cars[i].id === id) { return s.cars[i]; }
    }
    return null;
  }

  function nearestCar(x, z, maxDist) {
    var s = ensureState();
    var best = null, bestD = (typeof maxDist === 'number') ? maxDist * maxDist : Infinity;
    for (var i = 0; i < s.cars.length; i++) {
      var c = s.cars[i];
      var d = dist2(x, z, c.x, c.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function carsNear(x, z, radius) {
    var s = ensureState();
    var out = [];
    var r2 = radius * radius;
    for (var i = 0; i < s.cars.length; i++) {
      if (dist2(x, z, s.cars[i].x, s.cars[i].z) <= r2) { out.push(s.cars[i]); }
    }
    return out;
  }

  function playerCar() {
    var s = ensureState();
    if (!s.player.carId) { return null; }
    return getCar(s.player.carId);
  }

  function isPlayerDriving() {
    var s = ensureState();
    return !s.player.onFoot && !!s.player.carId;
  }

  /* Full repair, used by garages and after a mission. */
  function repairCar(carOrId) {
    var car = (typeof carOrId === 'string') ? getCar(carOrId) : carOrId;
    if (!car) { return false; }
    car.damage = 0;
    car.wrecked = false;
    car.smoke = 0;
    car.windowBroken = false;
    return true;
  }

  /* ---------- entering / exiting / stealing ---------- */
  function tryEnter() {
    var s = ensureState();
    var p = s.player;
    if (!p.onFoot) { return null; }
    var car = nearestCar(p.x, p.z, 4.5);
    if (!car || car.wrecked) { return null; }
    if (car.driver === 'police') { return null; }
    if (car.locked && !car.owned) { return null; }
    var stolen = false;
    if (car.driver === 'npc' || car.driver === 'traffic') {
      stolen = true;
      car.driver = 'player';
    } else if (car.driver === 'none') {
      if (!car.owned) { stolen = true; }
      car.driver = 'player';
    }
    p.onFoot = false;
    p.carId = car.id;
    p.x = car.x; p.z = car.z; p.facing = car.facing;
    playSound(stolen ? 'steal' : 'door');
    if (stolen) {
      addHeat(1, 'car theft');
      if (CA.achievements && typeof CA.achievements.unlock === 'function') {
        try { CA.achievements.unlock('first-steal'); } catch (e) {}
      }
    }
    return car;
  }

  function exitCar() {
    var s = ensureState();
    var p = s.player;
    var car = playerCar();
    if (!car || p.onFoot) { return false; }
    car.driver = 'none';
    car.speed = 0;
    car.handbrake = false;
    var sideX = Math.cos(p.facing + Math.PI / 2) * 2.2;
    var sideZ = -Math.sin(p.facing + Math.PI / 2) * 2.2;
    p.x = car.x + sideX;
    p.z = car.z + sideZ;
    p.y = 0;
    p.onFoot = true;
    p.carId = null;
    p.speed = 0;
    playSound('door');
    return true;
  }

  function breakWindow(car) {
    if (!car || car.windowBroken) { return false; }
    car.windowBroken = true;
    car.damage = Math.min(100, car.damage + 4);
    spawnParticles('glass', car.x, 1.2, car.z, 8);
    playSound('glass');
    return true;
  }

  /* ---------- collisions ---------- */
  function collideWithBuildings(car, dt) {
    var b = worldBounds();
    var hit = false;
    if (car.x < b.minX + 2) { car.x = b.minX + 2; hit = true; }
    if (car.x > b.maxX - 2) { car.x = b.maxX - 2; hit = true; }
    if (car.z < b.minZ + 2) { car.z = b.minZ + 2; hit = true; }
    if (car.z > b.maxZ - 2) { car.z = b.maxZ - 2; hit = true; }
    /* Building collision via city query when available. */
    var blocked = null;
    if (CA.city && typeof CA.city.isBlocked === 'function') {
      try { blocked = CA.city.isBlocked(car.x, car.z); } catch (e) { blocked = null; }
    } else if (CA.city && typeof CA.city.collidesBuilding === 'function') {
      try { blocked = CA.city.collidesBuilding(car.x, car.z); } catch (e) { blocked = null; }
    }
    if (blocked) {
      car.x = car.lastX; car.z = car.lastZ;
      hit = true;
    }
    if (hit) {
      var impact = Math.abs(car.speed);
      if (impact > 4) {
        car.damage = Math.min(100, car.damage + impact * 0.6);
        spawnParticles('sparks', car.x, 0.8, car.z, 6);
        playSound('crash');
        if (CA.camera && typeof CA.camera.shake === 'function') {
          try { CA.camera.shake(clamp(impact / 40, 0.15, 0.6)); } catch (e) {}
        }
        /* A hard crash hurts the driver a little. */
        if (car.driver === 'player' && impact > 18 &&
            CA.player && typeof CA.player.damage === 'function') {
          try { CA.player.damage(Math.min(20, (impact - 18) * 0.8), 'crash'); } catch (e) {}
        }
        car.speed *= 0.35;
      } else {
        car.speed *= 0.5;
      }
    }
    return hit;
  }

  function collideCars(car, dt) {
    var s = ensureState();
    for (var i = 0; i < s.cars.length; i++) {
      var o = s.cars[i];
      if (o === car || o.wrecked) { continue; }
      var dx = car.x - o.x, dz = car.z - o.z;
      var d2 = dx * dx + dz * dz;
      var minD = 3.4;
      if (d2 < minD * minD && d2 > 0.0001) {
        var d = Math.sqrt(d2);
        var push = (minD - d) / 2;
        var nx = dx / d, nz = dz / d;
        car.x += nx * push; car.z += nz * push;
        o.x -= nx * push; o.z -= nz * push;
        var rel = Math.abs(car.speed - o.speed);
        if (rel > 3) {
          car.damage = Math.min(100, car.damage + rel * 0.4);
          o.damage = Math.min(100, o.damage + rel * 0.4);
          spawnParticles('sparks', (car.x + o.x) / 2, 0.8, (car.z + o.z) / 2, 5);
          playSound('crash');
        }
        var tmp = car.speed;
        car.speed = o.speed * 0.55 + car.speed * 0.3;
        o.speed = tmp * 0.55 + o.speed * 0.3;
      }
    }
  }

  /* ---------- per-car physics step ---------- */
  function stepCar(car, dt, input) {
    if (car.wrecked) {
      car.speed = 0;
      car.smoke = Math.min(1, car.smoke + dt * 0.5);
      return;
    }
    var model = MODEL_BY_ID[car.modelId] || MODEL_BY_ID.sedan;
    var rain = 1;
    if (CA.weather && typeof CA.weather.rainFactor === 'function') {
      try { rain = CA.weather.rainFactor(); } catch (e) { rain = 1; }
    } else if (CA.state && CA.state.weather && CA.state.weather.raining) {
      rain = 1.25;
    }
    var topSpeed = model.topSpeed;
    var accel = model.acceleration;
    var handling = model.handling / rain;

    car.lastX = car.x; car.lastZ = car.z;
    car.headlightsOn = isNight();

    if (input) {
      var throttle = input.throttle || 0; /* -1 reverse .. 1 forward */
      var steerIn = input.steer || 0;     /* -1 left .. 1 right */
      car.handbrake = !!input.handbrake;
      if (car.handbrake) {
        /* Handbrake: hard stop plus a bigger drift angle. */
        car.speed -= car.speed * 3.2 * dt;
        car.brakeLight = true;
      } else if (throttle > 0) {
        car.speed += accel * throttle * dt;
        car.brakeLight = false;
      } else if (throttle < 0) {
        if (car.speed > 0.5) {
          car.speed -= accel * 1.6 * dt; /* brake */
          car.brakeLight = true;
        } else {
          car.speed += accel * 0.55 * throttle * dt; /* reverse */
          car.brakeLight = false;
        }
      } else {
        car.brakeLight = false;
      }
      /* Drag and rolling resistance. */
      car.speed -= car.speed * 0.55 * dt;
      if (Math.abs(car.speed) < 0.05 && throttle === 0) { car.speed = 0; }
      car.speed = clamp(car.speed, -topSpeed * 0.45, topSpeed);
      /* Speed-sensitive steering: less turn at high speed. */
      var speedFactor = clamp(1 - Math.abs(car.speed) / (topSpeed * 1.6), 0.35, 1);
      var targetSteer = steerIn * speedFactor * handling;
      car.steer += (targetSteer - car.steer) * Math.min(1, dt * 8);
      var dir = car.speed >= 0 ? 1 : -1;
      car.facing += car.steer * 1.9 * dir * dt * clamp(Math.abs(car.speed) / 6, 0, 1);
      /* Drift on hard turns at speed; handbrake doubles it. */
      var driftTarget = 0;
      if (Math.abs(car.steer) > 0.7 && Math.abs(car.speed) > topSpeed * 0.55) {
        driftTarget = car.steer * (car.handbrake ? 0.7 : 0.35);
        if (Math.abs(car.speed) > topSpeed * 0.7) {
          spawnParticles('dust', car.x, 0.2, car.z, 1);
        }
      }
      car.drift += (driftTarget - car.drift) * Math.min(1, dt * 5);
    } else {
      /* NPC / parked: gentle decay. */
      car.speed -= car.speed * 0.8 * dt;
      if (Math.abs(car.speed) < 0.05) { car.speed = 0; }
      car.brakeLight = false;
    }

    var moveFacing = car.facing + car.drift * 0.4;
    car.x += Math.sin(moveFacing) * car.speed * dt;
    car.z += Math.cos(moveFacing) * car.speed * dt;

    collideWithBuildings(car, dt);
    collideCars(car, dt);

    if (car.damage >= 100) {
      car.wrecked = true;
      car.speed = 0;
      car.smoke = 1;
      spawnParticles('smoke', car.x, 1.2, car.z, 12);
      playSound('crash');
      if (car.driver === 'player') {
        if (CA.police && typeof CA.police.onPlayerWrecked === 'function') {
          try { CA.police.onPlayerWrecked(car); } catch (e) {}
        }
      }
    } else if (car.damage >= 70) {
      car.smoke = Math.min(1, car.smoke + dt * 0.2);
      if (rng() < dt * 2) { spawnParticles('smoke', car.x, 1.2, car.z, 1); }
    } else if (car.damage >= 40) {
      car.smoke = Math.max(0.25, car.smoke - dt * 0.1);
    } else {
      car.smoke = Math.max(0, car.smoke - dt * 0.3);
    }
  }

  /* ---------- player driving input ---------- */
  function readDriveInput() {
    var throttle = 0, steer = 0;
    if (keyDown('KeyW') || keyDown('ArrowUp')) { throttle += 1; }
    if (keyDown('KeyS') || keyDown('ArrowDown')) { throttle -= 1; }
    if (keyDown('KeyA') || keyDown('ArrowLeft')) { steer -= 1; }
    if (keyDown('KeyD') || keyDown('ArrowRight')) { steer += 1; }
    return { throttle: throttle, steer: steer, handbrake: keyDown('Space') };
  }

  /* ---------- update ---------- */
  function update(dt) {
    if (typeof dt !== 'number' || dt <= 0) { dt = 0.016; }
    dt = Math.min(dt, 0.05);
    var s = ensureState();
    var p = s.player;

    /* Enter / exit on E (edge). */
    if (keyPressed('KeyE')) {
      if (p.onFoot) { tryEnter(); } else { exitCar(); }
    }
    /* Honk on H while driving. */
    var car = playerCar();
    if (car && !p.onFoot) {
      if (keyDown('KeyH') && car.hornTimer <= 0) {
        car.hornTimer = 0.4;
        playSound('horn');
      }
    }
    for (var i = 0; i < s.cars.length; i++) {
      var c = s.cars[i];
      if (c.hornTimer > 0) { c.hornTimer -= dt; }
      if (c === car && !p.onFoot) {
        stepCar(c, dt, readDriveInput());
        p.x = c.x; p.z = c.z; p.facing = c.facing; p.speed = c.speed;
      } else {
        stepCar(c, dt, null);
      }
      /* Stuck detection for NPC cars (traffic may reset them). */
      if (Math.abs(c.speed) < 0.1 && c.driver !== 'none' && c.driver !== 'player') {
        c.stuckTimer += dt;
      } else {
        c.stuckTimer = 0;
      }
    }
    /* Clean up wrecked, unowned cars far from the player. */
    for (var j = s.cars.length - 1; j >= 0; j--) {
      var w = s.cars[j];
      if (w.wrecked && !w.owned && w.driver !== 'player' &&
          dist2(p.x, p.z, w.x, w.z) > 500 * 500) {
        s.cars.splice(j, 1);
      }
    }
    refreshPrevKeys();
  }

  /* ---------- drawing ---------- */
  /* GPU mesh cache, keyed by model + paint, so one car mesh is
     uploaded once and reused for every car of that kind. (G
     integration: CA.mesh.car returns raw mesh data, not a draw
     call — the old code passed world coordinates as its colour
     argument and nothing ever drew.) */
  var drawCache = {};
  function gpuCarMesh(car) {
    var key = (car.modelId || 'sedan') + '|' + (car.colour || '');
    var hit = drawCache[key];
    if (hit) { return hit; }
    if (!CA.mesh || typeof CA.mesh.car !== 'function') { return null; }
    if (!CA.gl || typeof CA.gl.createMesh !== 'function') { return null; }
    var data = CA.mesh.car(car.colour || '#888888', '#1a2a3a',
      { roofLight: car.modelId === 'police' ? [1.0, 0.2, 0.2] : null });
    var gpu = CA.gl.createMesh(data);
    if (gpu) { drawCache[key] = gpu; }
    return gpu;
  }

  function modelMatrixFor(x, y, z, facing) {
    if (CA.render && typeof CA.render.modelMatrix === 'function') {
      return CA.render.modelMatrix(x, y, z, facing);
    }
    var c = Math.cos(facing || 0), s = Math.sin(facing || 0);
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1];
  }

  function drawCar(car) {
    if (!car) { return; }
    var gpu = gpuCarMesh(car);
    if (!gpu || !CA.gl || typeof CA.gl.drawMesh !== 'function') { return; }
    CA.gl.drawMesh(gpu, modelMatrixFor(car.x, car.y || 0, car.z, car.facing));
  }

  function drawAll() {
    var s = ensureState();
    for (var i = 0; i < s.cars.length; i++) { drawCar(s.cars[i]); }
  }

  /* ---------- exports ---------- */
  CA.cars = {
    MODELS: MODELS,
    modelById: function (id) { return MODEL_BY_ID[id] || null; },
    spawnCar: spawnCar,
    removeCar: removeCar,
    getCar: getCar,
    nearestCar: nearestCar,
    carsNear: carsNear,
    playerCar: playerCar,
    isPlayerDriving: isPlayerDriving,
    repairCar: repairCar,
    tryEnter: tryEnter,
    exitCar: exitCar,
    breakWindow: breakWindow,
    update: update,
    drawCar: drawCar,
    drawAll: drawAll,
    count: function () { return ensureState().cars.length; },
    list: function () { return ensureState().cars; }
  };

  ensureState();
})();
