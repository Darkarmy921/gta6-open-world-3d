/* Cayo Azul — traffic.js (Module C) — REVISION 2
 * Traffic cars on the roads and pedestrians on the sidewalks.
 * Owns CA.state.trafficCars (via CA.cars list, driver 'traffic') and
 * CA.state.pedestrians. Counts scale with the time of day: busy at
 * midday, thin at night. People are drawn as the mesh module's person
 * assembly, with a walk bob and a facing.
 * Deterministic: internal seeded generator only; no Date, no network.
 *
 * Revision changes vs pass 1:
 * - clearArea now returns the true number of pedestrians that fled
 *   (pass 1 hard-coded 1) and counts fled vs removed separately.
 * - Added scarePedestrians(x, z, radius, reason): melee and gunfire
 *   now make nearby pedestrians flee through one shared entry point.
 *   Pedestrians also flee when CA.state.lastMeleeAt / lastGunshotAt
 *   (play-time seconds, written by player.js / events) is recent.
 * - Traffic cars that stay blocked for a while now pick a new route
 *   instead of sitting in a jam forever; their brake lights show
 *   while stopped.
 * - Pedestrians crossing a road now wait for a gap: they pause if a
 *   fast car is close to their crossing line.
 * - Spawn bias: pedestrians now spawn on sidewalks near the player
 *   using the city's building-free query first, roads second.
 */
(function () {
  'use strict';

  var CA = (typeof window !== 'undefined' ? window.CA : globalThis.CA) || {};
  if (typeof window !== 'undefined') { window.CA = CA; }
  if (typeof globalThis !== 'undefined') { globalThis.CA = CA; }

  var rngState = 4242;
  function rng() {
    rngState = (rngState * 1664525 + 1013904223) >>> 0;
    return rngState / 4294967296;
  }
  function rngRange(a, b) { return a + rng() * (b - a); }
  function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }

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
    if (!Array.isArray(s.cars)) { s.cars = []; }
    if (!Array.isArray(s.pedestrians)) { s.pedestrians = []; }
    if (!s.clock) { s.clock = { hour: 10, minute: 0, day: 1 }; }
    if (typeof s.playTime !== 'number') { s.playTime = 0; }
    if (typeof s.seed === 'number') { rngState = (s.seed >>> 0) + 4242 || 4242; }
    return s;
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
  function worldBounds() {
    if (CA.city && CA.city.bounds && typeof CA.city.bounds.minX === 'number') {
      return CA.city.bounds;
    }
    return { minX: -1800, maxX: 1800, minZ: -1500, maxZ: 1500 };
  }

  /* Road / spawn queries: use CA.city when it offers them, else fall back
   * to a plain island position so traffic still works standalone. */
  function randomRoadPosition() {
    if (CA.city && typeof CA.city.randomRoadPosition === 'function') {
      try {
        var p = CA.city.randomRoadPosition();
        if (p && typeof p.x === 'number') { return p; }
      } catch (e) {}
    }
    var b = worldBounds();
    return { x: rngRange(b.minX + 50, b.maxX - 50),
             z: rngRange(b.minZ + 50, b.maxZ - 50),
             facing: rngRange(0, Math.PI * 2) };
  }
  function nearestRoadPoint(x, z) {
    if (CA.city && typeof CA.city.nearestRoadPoint === 'function') {
      try {
        var p = CA.city.nearestRoadPoint(x, z);
        if (p && typeof p.x === 'number') { return p; }
      } catch (e) {}
    }
    return { x: x, z: z, facing: rngRange(0, Math.PI * 2) };
  }
  function randomSpawnPosition() {
    if (CA.city && typeof CA.city.randomBuildingFreePosition === 'function') {
      try {
        var q = CA.city.randomBuildingFreePosition();
        if (q && typeof q.x === 'number') { return q; }
      } catch (e) {}
    }
    if (CA.city && typeof CA.city.randomSpawnPosition === 'function') {
      try {
        var p = CA.city.randomSpawnPosition();
        if (p && typeof p.x === 'number') { return p; }
      } catch (e) {}
    }
    var b = worldBounds();
    return { x: rngRange(b.minX + 50, b.maxX - 50),
             z: rngRange(b.minZ + 50, b.maxZ - 50) };
  }
  function isOnRoad(x, z) {
    if (CA.city && typeof CA.city.isOnRoad === 'function') {
      try { return !!CA.city.isOnRoad(x, z); } catch (e) { return true; }
    }
    return true;
  }

  /* ---------- density by hour ---------- */
  /* Midday busy, night thin. Returns { cars, pedestrians }. */
  function targetCounts(hour) {
    if (typeof hour !== 'number') { hour = 12; }
    if (hour >= 7 && hour < 10) { return { cars: 22, pedestrians: 34 }; }
    if (hour >= 10 && hour < 16) { return { cars: 28, pedestrians: 44 }; }
    if (hour >= 16 && hour < 19) { return { cars: 24, pedestrians: 38 }; }
    if (hour >= 19 && hour < 22) { return { cars: 16, pedestrians: 24 }; }
    if (hour >= 22 || hour < 5) { return { cars: 7, pedestrians: 9 }; }
    return { cars: 12, pedestrians: 16 }; /* 5-7 dawn */
  }

  var PED_COLOURS = ['#d94f4f', '#4f7dd9', '#4fd98a', '#e8d24f', '#9b4fd9',
    '#e8e8e8', '#333333', '#d98a4f', '#4fd9d9', '#c9a0dc'];
  var PED_SHIRTS = ['#c0392b', '#2980b9', '#27ae60', '#f39c12', '#8e44ad',
    '#ecf0f1', '#2c3e50', '#e67e22', '#16a09a', '#7f8c8d'];
  var TRAFFIC_MODELS = ['hatchback', 'sedan', 'sedan', 'taxi', 'pickup', 'sports'];

  var nextPedId = 1;
  var spawnTimer = 0;

  /* ---------- pedestrians ---------- */
  function spawnPedestrian(x, z, opts) {
    var s = ensureState();
    opts = opts || {};
    var pos = (typeof x === 'number') ? { x: x, z: z } : randomSpawnPosition();
    var ped = {
      id: opts.id || ('ped-' + (nextPedId++)),
      x: pos.x, y: 0, z: pos.z,
      facing: (typeof opts.facing === 'number') ? opts.facing : rngRange(0, Math.PI * 2),
      speed: rngRange(1.2, 2.4),
      walkPhase: rngRange(0, Math.PI * 2),
      state: 'walk', /* walk | cross | flee | down | idle | wait */
      stateTimer: rngRange(4, 12),
      targetX: null, targetZ: null,
      colour: pick(PED_SHIRTS),
      skin: pick(PED_COLOURS),
      downTimer: 0,
      reaction: opts.reaction || null,
      fleeReason: null,
      isDriver: false
    };
    if (opts.state) { ped.state = opts.state; }
    s.pedestrians.push(ped);
    return ped;
  }

  function removePedestrian(pedOrId) {
    var s = ensureState();
    var id = (typeof pedOrId === 'string') ? pedOrId : (pedOrId && pedOrId.id);
    for (var i = 0; i < s.pedestrians.length; i++) {
      if (s.pedestrians[i].id === id) { s.pedestrians.splice(i, 1); return true; }
    }
    return false;
  }

  function nearestPedestrian(x, z, maxDist) {
    var s = ensureState();
    var best = null, bestD = (typeof maxDist === 'number') ? maxDist * maxDist : Infinity;
    for (var i = 0; i < s.pedestrians.length; i++) {
      var p = s.pedestrians[i];
      if (p.state === 'down') { continue; }
      var d = dist2(x, z, p.x, p.z);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  function pedestriansNear(x, z, radius) {
    var s = ensureState();
    var out = [];
    var r2 = radius * radius;
    for (var i = 0; i < s.pedestrians.length; i++) {
      if (dist2(x, z, s.pedestrians[i].x, s.pedestrians[i].z) <= r2) { out.push(s.pedestrians[i]); }
    }
    return out;
  }

  function knockDown(ped, cause) {
    if (!ped || ped.state === 'down') { return false; }
    ped.state = 'down';
    ped.downTimer = rngRange(6, 14);
    ped.speed = 0;
    ped.downCause = cause || 'melee';
    spawnParticles('dust', ped.x, 0.5, ped.z, 4);
    return true;
  }

  function fleeFrom(ped, fx, fz, reason) {
    if (!ped || ped.state === 'down') { return; }
    ped.state = 'flee';
    ped.stateTimer = rngRange(3, 6);
    var dx = ped.x - fx, dz = ped.z - fz;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    ped.facing = Math.atan2(dx / len, dz / len);
    ped.speed = rngRange(4.5, 6);
    ped.fleeReason = reason || 'scare';
  }

  /* Shared scare entry point for melee, gunfire and events. Returns how
   * many pedestrians fled. */
  function scarePedestrians(x, z, radius, reason) {
    var s = ensureState();
    var fled = 0;
    var r2 = radius * radius;
    for (var i = 0; i < s.pedestrians.length; i++) {
      var ped = s.pedestrians[i];
      if (ped.state !== 'down' && dist2(x, z, ped.x, ped.z) <= r2) {
        fleeFrom(ped, x, z, reason || 'scare');
        fled++;
      }
    }
    return fled;
  }

  /* ---------- traffic cars ---------- */
  function spawnTrafficCar(x, z, facing) {
    if (!CA.cars || typeof CA.cars.spawnCar !== 'function') { return null; }
    var pos = (typeof x === 'number') ? { x: x, z: z, facing: facing || 0 } : randomRoadPosition();
    var modelId = pick(TRAFFIC_MODELS);
    var car = CA.cars.spawnCar(modelId, pos.x, pos.z,
      (typeof pos.facing === 'number' ? pos.facing : (facing || 0)),
      { driver: 'traffic' });
    car.cruiseSpeed = rngRange(9, 15);
    car.stopTimer = 0;
    car.stopped = false;
    car.hornTimer = 0;
    car.routeTarget = null;
    car.blockedTimer = 0;
    car.waitAtJunction = rng() < 0.2;
    return car;
  }

  function trafficCars() {
    var s = ensureState();
    var out = [];
    for (var i = 0; i < s.cars.length; i++) {
      if (s.cars[i].driver === 'traffic') { out.push(s.cars[i]); }
    }
    return out;
  }

  function stepTrafficCar(car, dt) {
    var s = ensureState();
    var p = s.player;
    if (car.wrecked) { return; }
    /* Pick a new road target when none, or when reached. */
    if (!car.routeTarget ||
        dist2(car.x, car.z, car.routeTarget.x, car.routeTarget.z) < 25) {
      car.routeTarget = randomRoadPosition();
      car.waitAtJunction = rng() < 0.18;
      car.blockedTimer = 0;
    }
    /* Random stops: pull over briefly as if parking / waiting. */
    if (car.stopTimer > 0) {
      car.stopTimer -= dt;
      car.speed = Math.max(0, car.speed - 20 * dt);
      car.brakeLight = true;
      return;
    }
    if (!car.stopped && rng() < dt * 0.02) {
      car.stopped = true;
      car.stopTimer = rngRange(2, 6);
      return;
    }
    if (car.stopped) {
      car.stopped = false;
    }
    /* Loose avoidance of the player's car ahead. */
    var playerCar = null;
    if (CA.cars && typeof CA.cars.playerCar === 'function') {
      try { playerCar = CA.cars.playerCar(); } catch (e) {}
    }
    var wantSpeed = car.cruiseSpeed || 12;
    if (playerCar) {
      var d2 = dist2(car.x, car.z, playerCar.x, playerCar.z);
      if (d2 < 100) { /* within 10 units */
        wantSpeed = Math.min(wantSpeed, 3);
        if (d2 < 36 && car.hornTimer <= 0) {
          car.hornTimer = 1.5;
          playSound('horn');
        }
      }
    }
    /* Avoid other traffic cars directly ahead: slow down, and if we
     * stay blocked for a while, reroute instead of jamming forever. */
    var blocked = false;
    var others = trafficCars();
    for (var i = 0; i < others.length; i++) {
      var o = others[i];
      if (o === car || o.wrecked) { continue; }
      var od2 = dist2(car.x, car.z, o.x, o.z);
      if (od2 < 49) { wantSpeed = Math.min(wantSpeed, 4); blocked = true; }
    }
    if (blocked) {
      car.blockedTimer += dt;
      if (car.blockedTimer > 8) {
        car.routeTarget = randomRoadPosition();
        car.blockedTimer = 0;
      }
    } else {
      car.blockedTimer = 0;
    }
    if (car.hornTimer > 0) { car.hornTimer -= dt; }

    /* Steer toward the route target, following the road loosely. */
    var dx = car.routeTarget.x - car.x;
    var dz = car.routeTarget.z - car.z;
    var wantFacing = Math.atan2(dx, dz);
    var diff = wrapAngle(wantFacing - car.facing);
    var steer = clamp(diff * 1.5, -1, 1);
    car.facing += steer * 1.4 * dt * clamp(Math.abs(car.speed) / 5 + 0.3, 0, 1);
    if (car.speed < wantSpeed) { car.speed += 6 * dt; }
    else if (car.speed > wantSpeed) { car.speed -= 10 * dt; }
    car.brakeLight = car.speed > wantSpeed + 1;
    car.x += Math.sin(car.facing) * car.speed * dt;
    car.z += Math.cos(car.facing) * car.speed * dt;
    var b = worldBounds();
    car.x = clamp(car.x, b.minX + 2, b.maxX - 2);
    car.z = clamp(car.z, b.minZ + 2, b.maxZ - 2);
    if (!isOnRoad(car.x, car.z)) {
      var near = nearestRoadPoint(car.x, car.z);
      car.routeTarget = near;
    }
  }

  /* ---------- pedestrian step ---------- */
  function stepPedestrian(ped, dt) {
    var s = ensureState();
    var p = s.player;
    if (ped.state === 'down') {
      ped.downTimer -= dt;
      if (ped.downTimer <= 0) {
        ped.state = 'walk';
        ped.stateTimer = rngRange(4, 10);
        ped.speed = rngRange(1.2, 2.4);
      }
      return;
    }
    ped.stateTimer -= dt;
    /* Flee recent melee / gunfire reported on the shared state. */
    var now = s.playTime || 0;
    if (ped.state !== 'flee') {
      if (typeof s.lastMeleeAt === 'number' && now - s.lastMeleeAt < 2 &&
          s.lastMeleeX !== undefined &&
          dist2(ped.x, ped.z, s.lastMeleeX, s.lastMeleeZ) < 400) {
        fleeFrom(ped, s.lastMeleeX, s.lastMeleeZ, 'melee');
      } else if (typeof s.lastGunshotAt === 'number' && now - s.lastGunshotAt < 2 &&
          s.lastGunshotX !== undefined &&
          dist2(ped.x, ped.z, s.lastGunshotX, s.lastGunshotZ) < 900) {
        fleeFrom(ped, s.lastGunshotX, s.lastGunshotZ, 'gunfire');
      }
    }
    /* Flee cars driving at them. */
    var playerCar = null;
    if (CA.cars && typeof CA.cars.playerCar === 'function') {
      try { playerCar = CA.cars.playerCar(); } catch (e) {}
    }
    if (playerCar && !p.onFoot && ped.state !== 'flee') {
      var cd2 = dist2(ped.x, ped.z, playerCar.x, playerCar.z);
      if (cd2 < 144 && Math.abs(playerCar.speed) > 8) {
        fleeFrom(ped, playerCar.x, playerCar.z, 'car');
      }
    }
    if (ped.state === 'flee') {
      ped.walkPhase += dt * 11;
      ped.x += Math.sin(ped.facing) * ped.speed * dt;
      ped.z += Math.cos(ped.facing) * ped.speed * dt;
      if (ped.stateTimer <= 0) {
        ped.state = 'walk';
        ped.stateTimer = rngRange(4, 10);
        ped.speed = rngRange(1.2, 2.4);
      }
      return;
    }
    if (ped.state === 'wait') {
      /* Waiting for a gap before crossing; re-check below. */
      if (ped.stateTimer <= 0) { ped.state = 'cross'; ped.stateTimer = rngRange(3, 6); }
      else { return; }
    }
    if (ped.stateTimer <= 0) {
      /* Sometimes cross the road, sometimes keep walking, sometimes idle. */
      var roll = rng();
      if (roll < 0.25) {
        ped.state = 'cross';
        ped.stateTimer = rngRange(3, 6);
        var rp = nearestRoadPoint(ped.x, ped.z);
        ped.targetX = rp.x + rngRange(-14, 14);
        ped.targetZ = rp.z + rngRange(-14, 14);
      } else if (roll < 0.35) {
        ped.state = 'idle';
        ped.stateTimer = rngRange(2, 5);
        ped.speed = 0;
      } else {
        ped.state = 'walk';
        ped.stateTimer = rngRange(5, 12);
        ped.facing = rngRange(0, Math.PI * 2);
        ped.speed = rngRange(1.2, 2.4);
      }
    }
    if (ped.state === 'idle') { return; }
    if (ped.state === 'cross' && ped.targetX !== null) {
      /* Wait for a gap: do not step out in front of a fast car. */
      var danger = false;
      var allCars = s.cars || [];
      for (var ci = 0; ci < allCars.length; ci++) {
        var cc = allCars[ci];
        if (Math.abs(cc.speed) > 8 &&
            dist2(ped.x, ped.z, cc.x, cc.z) < 225) { danger = true; break; }
      }
      if (danger) {
        ped.state = 'wait';
        ped.stateTimer = 1.2;
        ped.speed = 0;
        return;
      }
      var tdx = ped.targetX - ped.x, tdz = ped.targetZ - ped.z;
      var tl = Math.sqrt(tdx * tdx + tdz * tdz);
      if (tl < 1.5) {
        ped.state = 'walk';
        ped.stateTimer = rngRange(4, 10);
      } else {
        ped.facing = Math.atan2(tdx / tl, tdz / tl);
        ped.speed = rngRange(2.2, 3.2);
      }
    }
    /* React to the player walking close: a glance, a step aside. */
    if (p.onFoot) {
      var pd2 = dist2(ped.x, ped.z, p.x, p.z);
      if (pd2 < 4 && rng() < dt * 0.5) {
        ped.facing = wrapAngle(ped.facing + rngRange(-0.6, 0.6));
      }
    }
    ped.walkPhase += dt * (ped.speed * 3.2);
    ped.x += Math.sin(ped.facing) * ped.speed * dt;
    ped.z += Math.cos(ped.facing) * ped.speed * dt;
    var b = worldBounds();
    if (ped.x < b.minX + 2 || ped.x > b.maxX - 2 ||
        ped.z < b.minZ + 2 || ped.z > b.maxZ - 2) {
      ped.facing = wrapAngle(ped.facing + Math.PI);
      ped.x = clamp(ped.x, b.minX + 2, b.maxX - 2);
      ped.z = clamp(ped.z, b.minZ + 2, b.maxZ - 2);
    }
  }

  /* ---------- counts / clearing ---------- */
  function countNear(x, z, radius) {
    var s = ensureState();
    var r2 = radius * radius;
    var cars = 0, peds = 0;
    for (var i = 0; i < s.cars.length; i++) {
      if (s.cars[i].driver === 'traffic' &&
          dist2(x, z, s.cars[i].x, s.cars[i].z) <= r2) { cars++; }
    }
    for (var j = 0; j < s.pedestrians.length; j++) {
      if (dist2(x, z, s.pedestrians[j].x, s.pedestrians[j].z) <= r2) { peds++; }
    }
    return { cars: cars, pedestrians: peds };
  }

  function clearArea(x, z, radius, reason) {
    var s = ensureState();
    var removedCars = 0, removedPeds = 0, fledPeds = 0;
    var r2 = radius * radius;
    for (var i = s.cars.length - 1; i >= 0; i--) {
      var c = s.cars[i];
      if (c.driver === 'traffic' && dist2(x, z, c.x, c.z) <= r2) {
        if (CA.cars && typeof CA.cars.removeCar === 'function') { CA.cars.removeCar(c.id); }
        else { s.cars.splice(i, 1); }
        removedCars++;
      }
    }
    for (var j = s.pedestrians.length - 1; j >= 0; j--) {
      var ped = s.pedestrians[j];
      if (dist2(x, z, ped.x, ped.z) <= r2) {
        if (radius <= 30) {
          fleeFrom(ped, x, z, reason || 'clear-area');
          fledPeds++;
        } else {
          s.pedestrians.splice(j, 1);
          removedPeds++;
        }
      }
    }
    return { carsRemoved: removedCars, pedestriansRemoved: removedPeds,
             pedestriansFled: fledPeds };
  }

  /* ---------- density maintenance ---------- */
  function maintainDensity(dt) {
    var s = ensureState();
    var p = s.player;
    var target = targetCounts(s.clock ? s.clock.hour : 12);
    var cars = trafficCars();
    spawnTimer -= dt;
    if (spawnTimer > 0) { return; }
    spawnTimer = 0.8;
    /* Despawn far-away units first, so the island never fills up. */
    for (var i = cars.length - 1; i >= 0; i--) {
      if (dist2(p.x, p.z, cars[i].x, cars[i].z) > 900 * 900) {
        if (CA.cars) { CA.cars.removeCar(cars[i].id); }
      }
    }
    for (var j = s.pedestrians.length - 1; j >= 0; j--) {
      if (dist2(p.x, p.z, s.pedestrians[j].x, s.pedestrians[j].z) > 700 * 700) {
        s.pedestrians.splice(j, 1);
      }
    }
    /* Spawn near the player until the target is met. */
    if (trafficCars().length < target.cars) {
      if (rng() < 0.6) {
        var a = rngRange(0, Math.PI * 2), d = rngRange(80, 260);
        var near = nearestRoadPoint(p.x + Math.sin(a) * d, p.z + Math.cos(a) * d);
        spawnTrafficCar(near.x, near.z, near.facing || 0);
      } else {
        var rp = randomRoadPosition();
        spawnTrafficCar(rp.x, rp.z, rp.facing || 0);
      }
    }
    if (s.pedestrians.length < target.pedestrians) {
      var a2 = rngRange(0, Math.PI * 2), d2 = rngRange(20, 180);
      spawnPedestrian(p.x + Math.sin(a2) * d2, p.z + Math.cos(a2) * d2);
    }
  }

  /* ---------- update / draw ---------- */
  function update(dt) {
    if (typeof dt !== 'number' || dt <= 0) { dt = 0.016; }
    dt = Math.min(dt, 0.05);
    ensureState();
    maintainDensity(dt);
    var cars = trafficCars();
    for (var i = 0; i < cars.length; i++) { stepTrafficCar(cars[i], dt); }
    var s = ensureState();
    for (var j = 0; j < s.pedestrians.length; j++) { stepPedestrian(s.pedestrians[j], dt); }
  }

  /* One cached GPU mesh per shirt/skin pair. (G integration:
     CA.mesh.person returns raw mesh data — the old code passed
     world coordinates as its colour argument and nothing drew.) */
  var pedGpuCache = {};
  function drawPedestrian(ped) {
    if (!ped || !CA.mesh || typeof CA.mesh.person !== 'function') { return; }
    if (!CA.gl || typeof CA.gl.createMesh !== 'function' ||
        typeof CA.gl.drawMesh !== 'function') { return; }
    var key = (ped.colour || '') + '|' + (ped.skin || '');
    var gpu = pedGpuCache[key];
    if (!gpu) {
      gpu = CA.gl.createMesh(CA.mesh.person(ped.colour || '#c0392b', ped.skin || '#d9a066', '#2c3e50'));
      if (!gpu) { return; }
      pedGpuCache[key] = gpu;
    }
    /* Walk bob: small vertical bounce tied to the walk phase. */
    var bob = 0;
    if (ped.state === 'walk' || ped.state === 'cross' || ped.state === 'flee') {
      bob = Math.abs(Math.sin(ped.walkPhase)) * 0.12;
    }
    var model;
    if (CA.render && typeof CA.render.modelMatrix === 'function') {
      model = CA.render.modelMatrix(ped.x, (ped.y || 0) + bob, ped.z, ped.facing);
    } else {
      var c = Math.cos(ped.facing || 0), sn = Math.sin(ped.facing || 0);
      model = [c, 0, -sn, 0, 0, 1, 0, 0, sn, 0, c, 0, ped.x, (ped.y || 0) + bob, ped.z, 1];
    }
    CA.gl.drawMesh(gpu, model);
  }

  function drawAll() {
    var s = ensureState();
    for (var i = 0; i < s.pedestrians.length; i++) { drawPedestrian(s.pedestrians[i]); }
    /* Traffic cars are drawn by CA.cars.drawAll; this keeps one draw path. */
  }

  CA.traffic = {
    targetCounts: targetCounts,
    spawnTrafficCar: spawnTrafficCar,
    spawnPedestrian: spawnPedestrian,
    removePedestrian: removePedestrian,
    nearestPedestrian: nearestPedestrian,
    pedestriansNear: pedestriansNear,
    knockDown: knockDown,
    fleeFrom: fleeFrom,
    scarePedestrians: scarePedestrians,
    trafficCars: trafficCars,
    countNear: countNear,
    clearArea: clearArea,
    update: update,
    drawPedestrian: drawPedestrian,
    drawAll: drawAll,
    count: function () {
      var s = ensureState();
      return { cars: trafficCars().length, pedestrians: s.pedestrians.length };
    }
  };

  ensureState();
})();
