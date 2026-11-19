// garages.js — Cayo Azul garages.
// Six garages, one in each of six districts, each holding up to four
// cars the player owns. Buying a car stores it in the current garage;
// taking one out spawns it at the garage door. Garage positions come
// from CA.city.garages when the city module has loaded; until then a
// fixed fallback layout (same six districts, same capacities) stands
// in so the economy and save modules never see an empty list.
// Revision notes: store() now rejects unknown models instead of
// filing them; cars can be moved between garages with transfer();
// repairCar() restores a stored car's health for cash; findCar()
// locates a car by plate across all six garages.
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});
  if (!CA.state) CA.state = {};
  if (!CA.state.garages) CA.state.garages = null;
  if (!CA.state.ownedCars) CA.state.ownedCars = [];

  var CAPACITY = 4;
  /* Canonical car model ids are the car module's ids; the old
     'sports-coupe' / 'police-cruiser' spellings never match a car. */
  var KNOWN_MODELS = ['hatchback', 'sedan', 'taxi', 'pickup', 'sports', 'police'];

  // Fallback positions, in world units (x east, z north). The city
  // module replaces these with its own surveyed positions when present.
  var FALLBACK = [
    { id: 'harbour', name: 'Harbour Garage', district: 'the Harbour', x: -900, z: -1250, doorX: -880, doorZ: -1250, facing: 0 },
    { id: 'marina', name: 'Marina Garage', district: 'the Marina', x: 1050, z: -1050, doorX: 1070, doorZ: -1050, facing: 1.5708 },
    { id: 'old-town', name: 'Old Town Garage', district: 'Old Town', x: -350, z: -250, doorX: -330, doorZ: -250, facing: 0 },
    { id: 'palm-row', name: 'Palm Row Garage', district: 'Palm Row', x: 750, z: 150, doorX: 770, doorZ: 150, facing: 1.5708 },
    { id: 'university', name: 'University Garage', district: 'the University', x: -750, z: 650, doorX: -730, doorZ: 650, facing: 0 },
    { id: 'coral-beach', name: 'Coral Beach Garage', district: 'Coral Beach', x: 1250, z: 550, doorX: 1270, doorZ: 550, facing: 1.5708 }
  ];

  function defs() {
    if (CA.city && CA.city.garages && CA.city.garages.length) return CA.city.garages;
    return FALLBACK;
  }

  // Stored contents live in CA.state.garages: { garageId: [car, ...] }.
  // A stored car is plain data: { model, colour, plate, health }.
  function contents() {
    if (!CA.state.garages) CA.state.garages = {};
    var d = defs();
    for (var i = 0; i < d.length; i++) {
      if (!CA.state.garages[d[i].id]) CA.state.garages[d[i].id] = [];
    }
    return CA.state.garages;
  }

  function garageById(id) {
    var d = defs();
    for (var i = 0; i < d.length; i++) if (d[i].id === id) return d[i];
    return null;
  }

  function nearest(x, z) {
    var d = defs();
    var best = null;
    var bestD = Infinity;
    for (var i = 0; i < d.length; i++) {
      var dx = d[i].x - x;
      var dz = d[i].z - z;
      var dist = dx * dx + dz * dz;
      if (dist < bestD) { bestD = dist; best = d[i]; }
    }
    return best;
  }

  function isNearGarage(x, z, radius) {
    var g = nearest(x, z);
    if (!g) return null;
    var dx = g.x - x;
    var dz = g.z - z;
    var r = radius || 60;
    if (dx * dx + dz * dz <= r * r) return g;
    return null;
  }

  // The garage the player is standing in, or null when on the road.
  function currentGarageFor(x, z) {
    return isNearGarage(x, z, 60);
  }

  function plateFor() {
    return 'CA-' + (1000 + CA.state.ownedCars.length);
  }

  function store(car, garageId) {
    if (!car || !car.model) return { ok: false, reason: 'no-car' };
    if (KNOWN_MODELS.indexOf(car.model) < 0) return { ok: false, reason: 'unknown-model', model: car.model };
    var g = garageById(garageId) || nearest(car.x || 0, car.z || 0);
    if (!g) return { ok: false, reason: 'no-garage' };
    var c = contents();
    var slot = c[g.id];
    if (slot.length >= CAPACITY) return { ok: false, reason: 'garage-full', garage: g };
    var health = (typeof car.health === 'number') ? car.health : 100;
    if (health < 0) health = 0;
    if (health > 100) health = 100;
    var stored = {
      model: car.model,
      colour: car.colour || 'blue',
      plate: car.plate || plateFor(),
      health: health
    };
    slot.push(stored);
    CA.state.ownedCars.push({ model: stored.model, garage: g.id, plate: stored.plate });
    if (CA.achievements) {
      /* (G integration: the count thresholds live in carsChanged
         — the old code awarded 'own-three-cars' and
         'own-all-models' on the very first car stored.) */
      if (typeof CA.achievements.carsChanged === 'function') { CA.achievements.carsChanged(); }
      CA.achievements.check('first-car-bought');
    }
    return { ok: true, garage: g, car: stored };
  }

  // Take a stored car out: removes it from the garage and asks the car
  // module to spawn it at the garage door, facing out.
  function takeOut(garageId, index) {
    var g = garageById(garageId);
    if (!g) return { ok: false, reason: 'no-garage' };
    var c = contents();
    var slot = c[g.id];
    if (!slot || index < 0 || index >= slot.length) return { ok: false, reason: 'empty-slot' };
    var stored = slot.splice(index, 1)[0];
    var spawned = null;
    if (CA.cars && typeof CA.cars.spawnCar === 'function') {
      spawned = CA.cars.spawnCar(stored.model, g.doorX || g.x + 20, g.doorZ || g.z, g.facing || 0);
      if (spawned) {
        spawned.colour = stored.colour;
        spawned.plate = stored.plate;
        spawned.health = stored.health;
      }
    }
    var owned = CA.state.ownedCars;
    for (var i = owned.length - 1; i >= 0; i--) {
      if (owned[i].plate === stored.plate && owned[i].garage === g.id) { owned.splice(i, 1); break; }
    }
    return { ok: true, garage: g, car: stored, spawned: spawned };
  }

  // Move a stored car to another garage without spawning it.
  function transfer(fromId, index, toId) {
    var from = garageById(fromId);
    var to = garageById(toId);
    if (!from || !to) return { ok: false, reason: 'no-garage' };
    if (fromId === toId) return { ok: false, reason: 'same-garage' };
    var c = contents();
    var src = c[from.id];
    var dst = c[to.id];
    if (!src || index < 0 || index >= src.length) return { ok: false, reason: 'empty-slot' };
    if (dst.length >= CAPACITY) return { ok: false, reason: 'garage-full', garage: to };
    var car = src.splice(index, 1)[0];
    dst.push(car);
    var owned = CA.state.ownedCars;
    for (var i = 0; i < owned.length; i++) {
      if (owned[i].plate === car.plate && owned[i].garage === from.id) { owned[i].garage = to.id; break; }
    }
    return { ok: true, from: from, to: to, car: car };
  }

  // Restore a stored car to full health. Cost scales with the damage.
  function repairCar(garageId, index) {
    var cars = list(garageId);
    if (!cars || index < 0 || index >= cars.length) return { ok: false, reason: 'empty-slot' };
    var car = cars[index];
    var missing = 100 - (car.health || 0);
    if (missing <= 0) return { ok: false, reason: 'already-full' };
    var cost = Math.ceil(missing * 8);
    if (!CA.economy) return { ok: false, reason: 'no-economy' };
    var paid = CA.economy.pay(cost, 'repair car ' + car.model);
    if (!paid.ok) return { ok: false, reason: paid.reason, needed: cost, balance: paid.balance };
    contents()[garageId][index].health = 100;
    return { ok: true, car: car, cost: cost, balance: paid.balance };
  }

  function findCar(plate) {
    var c = contents();
    var d = defs();
    for (var i = 0; i < d.length; i++) {
      var slot = c[d[i].id];
      for (var j = 0; j < slot.length; j++) {
        if (slot[j].plate === plate) return { garage: d[i], index: j, car: slot[j] };
      }
    }
    return null;
  }

  function list(garageId) {
    var c = contents();
    if (garageId) return c[garageId] ? c[garageId].slice() : [];
    var out = {};
    var d = defs();
    for (var i = 0; i < d.length; i++) out[d[i].id] = c[d[i].id].slice();
    return out;
  }

  function totalOwned() { return CA.state.ownedCars.length; }

  function ownedModels() {
    var seen = {};
    var owned = CA.state.ownedCars;
    for (var i = 0; i < owned.length; i++) seen[owned[i].model] = true;
    return Object.keys(seen);
  }

  function respawnGarage(x, z) {
    return nearest(x == null ? 0 : x, z == null ? 0 : z);
  }

  CA.garages = {
    capacity: CAPACITY,
    knownModels: KNOWN_MODELS,
    defs: defs,
    contents: contents,
    garageById: garageById,
    nearest: nearest,
    isNearGarage: isNearGarage,
    currentGarageFor: currentGarageFor,
    store: store,
    takeOut: takeOut,
    transfer: transfer,
    repairCar: repairCar,
    findCar: findCar,
    list: list,
    totalOwned: totalOwned,
    ownedModels: ownedModels,
    respawnGarage: respawnGarage
  };
})();
