/* Cayo Azul — city.js (Module B) — revision 2
   The island layout: 15 districts, the road network, blocks of
   buildings, 20 landmarks, 6 garages, and every map query the other
   modules ask. All layout data is generated from one fixed seed, so
   the same seed always gives the same city.
   Coordinates: x = east, z = north, y = up. Island is about
   3600 (x) by 3000 (z) world units, centred on (0, 0).
   Revision changes: bounds/water helpers, district-by-id and
   nearest-landmark/garage queries, garage-door spawn positions,
   buildings kept off garage plots, and random helpers that accept
   either a plain function or a seeded-generator object. */
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});

  var WORLD_W = 3600;
  var WORLD_D = 3000;
  var HALF_W = WORLD_W / 2;
  var HALF_D = WORLD_D / 2;
  var CITY_SEED = 20261119;
  /* Water starts just past the south shore and the east beach edge;
     the harbour piers reach into it. */
  var WATER_SOUTH = -1500;
  var WATER_EAST = 1800;

  /* Deterministic seeded generator (local to the city layout, fixed
     seed, so the city never depends on call order elsewhere). */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Normalise a random source: a plain function, an object with a
     next() method (the seeded generator shape), or nothing. */
  function asRand(rng, seed) {
    if (typeof rng === 'function') return rng;
    if (rng && typeof rng.next === 'function') return function () { return rng.next(); };
    if (rng && typeof rng.random === 'function') return function () { return rng.random(); };
    return mulberry32(seed >>> 0);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function distToSegment(px, pz, ax, az, bx, bz) {
    var dx = bx - ax, dz = bz - az;
    var len2 = dx * dx + dz * dz;
    var t = len2 === 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
    t = clamp(t, 0, 1);
    var cx = ax + t * dx, cz = az + t * dz;
    var ex = px - cx, ez = pz - cz;
    return { d: Math.sqrt(ex * ex + ez * ez), x: cx, z: cz };
  }

  /* ---- Districts ------------------------------------------------ */
  /* bounds are [x0, z0, x1, z1]; palette is [wall, roof, accent]
     as [r, g, b] 0..1 triples; style drives building heights. */
  var DISTRICTS = [
    { id: 'harbour',   name: 'Harbour',            bounds: [-600, -1500,  600, -900], palette: [[0.62, 0.58, 0.50], [0.45, 0.30, 0.22], [0.20, 0.45, 0.60]], style: 'warehouse',  height: [14, 26] },
    { id: 'old-town',  name: 'Old Town',           bounds: [-900,  -900,    0, -300], palette: [[0.85, 0.72, 0.52], [0.55, 0.25, 0.18], [0.30, 0.55, 0.35]], style: 'terrace',    height: [10, 22] },
    { id: 'market',    name: 'Market',             bounds: [   0,  -900,  900, -300], palette: [[0.90, 0.78, 0.55], [0.70, 0.35, 0.20], [0.85, 0.55, 0.15]], style: 'market',     height: [8, 18] },
    { id: 'docks',     name: 'Docks',              bounds: [-1800, -1500, -600, -900], palette: [[0.55, 0.52, 0.48], [0.35, 0.35, 0.38], [0.55, 0.40, 0.20]], style: 'warehouse',  height: [12, 24] },
    { id: 'north-hill',name: 'North Hill',         bounds: [-900,   900,  300, 1500], palette: [[0.78, 0.76, 0.72], [0.30, 0.32, 0.38], [0.25, 0.40, 0.55]], style: 'tower',      height: [28, 64] },
    { id: 'marina',    name: 'Marina',             bounds: [ 900, -1500, 1800, -600], palette: [[0.88, 0.86, 0.80], [0.20, 0.45, 0.55], [0.95, 0.75, 0.30]], style: 'marina',     height: [12, 30] },
    { id: 'palm-row',  name: 'Palm Row',           bounds: [ 900,  -600, 1800,  300], palette: [[0.92, 0.85, 0.70], [0.75, 0.45, 0.30], [0.20, 0.60, 0.45]], style: 'villa',      height: [8, 20] },
    { id: 'university',name: 'University',         bounds: [ 300,   900, 1500, 1500], palette: [[0.80, 0.70, 0.60], [0.40, 0.20, 0.25], [0.30, 0.45, 0.70]], style: 'campus',     height: [12, 28] },
    { id: 'stadium',   name: 'Stadium',            bounds: [-1800, -300, -900,  600], palette: [[0.75, 0.75, 0.78], [0.25, 0.55, 0.30], [0.90, 0.30, 0.25]], style: 'stadium',    height: [16, 34] },
    { id: 'coral-beach',name:'Coral Beach',        bounds: [ 900,   300, 1800, 1500], palette: [[0.95, 0.88, 0.75], [0.90, 0.60, 0.45], [0.15, 0.65, 0.70]], style: 'resort',     height: [10, 26] },
    { id: 'airport-road',name:'Airport Road',      bounds: [-1800,  600, -900, 1500], palette: [[0.70, 0.70, 0.72], [0.45, 0.45, 0.50], [0.85, 0.65, 0.20]], style: 'industrial', height: [10, 22] },
    { id: 'fishermans-wharf', name: "Fisherman's Wharf", bounds: [ 600, -1500,  900, -900], palette: [[0.70, 0.60, 0.48], [0.35, 0.28, 0.22], [0.20, 0.50, 0.55]], style: 'cottage', height: [7, 14] },
    { id: 'gardens',   name: 'Gardens',            bounds: [-900,   300,  300,  900], palette: [[0.82, 0.80, 0.68], [0.35, 0.50, 0.30], [0.45, 0.65, 0.35]], style: 'garden',     height: [8, 18] },
    { id: 'old-fort',  name: 'Old Fort',           bounds: [-1800, -900, -900, -300], palette: [[0.68, 0.60, 0.48], [0.50, 0.42, 0.32], [0.60, 0.50, 0.30]], style: 'fort',       height: [10, 20] },
    { id: 'sunset-terrace', name: 'Sunset Terrace',bounds: [   0,  -300,  900,  300], palette: [[0.88, 0.72, 0.58], [0.60, 0.30, 0.30], [0.95, 0.60, 0.25]], style: 'terrace',    height: [10, 24] }
  ];
  /* Centre of each district, for the renderer's distance culling. */
  DISTRICTS.forEach(function (d) {
    var b = d.bounds;
    d.centre = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    d.radius = Math.sqrt(Math.pow(b[2] - b[0], 2) + Math.pow(b[3] - b[1], 2)) / 2;
  });

  /* ---- Roads ---------------------------------------------------- */
  function road(ax, az, bx, bz, width, kind) {
    return { ax: ax, az: az, bx: bx, bz: bz, width: width, kind: kind };
  }
  var ROADS = [];
  ROADS.push(road(-1500, -1250, 1500, -1250, 22, 'ring'));
  ROADS.push(road( 1500, -1250, 1500,  1250, 22, 'ring'));
  ROADS.push(road( 1500,  1250, -1500, 1250, 22, 'ring'));
  ROADS.push(road(-1500,  1250, -1500, -1250, 22, 'ring'));
  [-900, 0, 900].forEach(function (x) { ROADS.push(road(x, -1250, x, 1250, 16, 'grid')); });
  [-600, 0, 600].forEach(function (z) { ROADS.push(road(-1500, z, 1500, z, 16, 'grid')); });
  ROADS.push(road(1650, -1250, 1650, 1250, 18, 'coastal'));
  ROADS.push(road(-1500, -1250, 1500, 1250, 18, 'avenue'));
  ROADS.push(road( 1500, -1250, -1500, 1250, 18, 'avenue'));
  ROADS.push(road(-1500, 0, 900, -1250, 14, 'avenue'));
  ROADS.push(road(-900, 1250, 1500, 300, 14, 'avenue'));

  /* ---- Landmarks (20) ------------------------------------------- */
  var LANDMARKS = [
    { name: 'Crane Cafe',            district: 'Harbour',            x: -120, z: -1080, desc: 'Ilsa Crane\u2019s harbour cafe, front for the neighbourhood.' },
    { name: 'The Great Crane',       district: 'Harbour',            x:  320, z: -1320, desc: 'The tallest harbour crane, visible from anywhere south.' },
    { name: 'Old Town Square',       district: 'Old Town',           x: -450, z: -600,  desc: 'Cobbles, a fountain, and the oldest facades on the island.' },
    { name: 'St. Anselm Bell Tower', district: 'Old Town',           x: -750, z: -420,  desc: 'A pale bell tower that rings the hour over Old Town.' },
    { name: 'Grand Market Hall',     district: 'Market',             x:  450, z: -600,  desc: 'A vaulted hall of stalls, loud from dawn to dusk.' },
    { name: 'Spice Arcade',          district: 'Market',             x:  120, z: -780,  desc: 'Narrow lanes of spice sellers and fabric stalls.' },
    { name: 'Dry Dock No. 3',        district: 'Docks',              x: -1200, z: -1200, desc: 'A drained dock where hulls are patched and painted.' },
    { name: 'Customs House',         district: 'Docks',              x: -900, z: -1020, desc: 'The grey customs house at the dock gates.' },
    { name: 'Hilltop Observatory',   district: 'North Hill',         x: -300, z: 1200,  desc: 'A white dome watching the sky from the highest hill.' },
    { name: 'Marina Lighthouse',     district: 'Marina',             x: 1650, z: -900,  desc: 'A striped lighthouse guarding the marina mouth.' },
    { name: 'Yacht Basin',           district: 'Marina',             x: 1200, z: -1200, desc: 'White hulls moored in neat rows.' },
    { name: 'Palm Promenade',        district: 'Palm Row',           x: 1350, z: -150,  desc: 'A palm-lined walk of cafes and shopfronts.' },
    { name: 'University Library',    district: 'University',         x:  900, z: 1200,  desc: 'The red-brick library at the heart of campus.' },
    { name: 'Azul Stadium',          district: 'Stadium',            x: -1350, z: 150,  desc: 'The island\u2019s bowl stadium, home of the Azul FC.' },
    { name: 'Coral Beach Pier',      district: 'Coral Beach',        x: 1650, z:  900,  desc: 'A long pier over pale water at the east beach.' },
    { name: 'Beachfront Pavilion',   district: 'Coral Beach',        x: 1200, z:  600,  desc: 'An open pavilion where the beach crowds gather.' },
    { name: 'Signal Tower',          district: 'Airport Road',       x: -1350, z: 1050, desc: 'A skeletal tower blinking over the west flats.' },
    { name: 'Wharf Chapel',          district: "Fisherman's Wharf",  x:  750, z: -1200, desc: 'A tiny white chapel above the fishing boats.' },
    { name: 'Botanical Glasshouse',  district: 'Gardens',            x: -300, z:  600,  desc: 'A glasshouse of island flowers in the public gardens.' },
    { name: 'Old Fort Battery',      district: 'Old Fort',           x: -1500, z: -600,  desc: 'Stone ramparts and old cannon above the south-west shore.' }
  ];

  /* ---- Garages (6, capacity 4 each) ----------------------------- */
  var GARAGES = [
    { id: 'harbour', name: 'Harbour Garage',   district: 'Harbour',     x: -300, z: -1020, capacity: 4, doorX: -300, doorZ: -986, facing: 0 },
    { id: 'marina', name: 'Marina Garage',    district: 'Marina',      x: 1050, z: -1350, capacity: 4, doorX: 1050, doorZ: -1316, facing: 0 },
    { id: 'old-town', name: 'Old Town Garage',  district: 'Old Town',    x: -600, z: -750, capacity: 4, doorX: -600, doorZ: -716, facing: 0 },
    { id: 'stadium', name: 'Stadium Garage',   district: 'Stadium',     x: -1200, z: 300, capacity: 4, doorX: -1200, doorZ: 334, facing: 0 },
    { id: 'university', name: 'University Garage', district: 'University',  x:  600, z: 1050, capacity: 4, doorX: 600, doorZ: 1084, facing: 0 },
    { id: 'coral-beach', name: 'Coral Beach Garage', district: 'Coral Beach', x: 1500, z: 750, capacity: 4, doorX: 1500, doorZ: 784, facing: 0 }
  ];

  /* ---- Bounds, water, districts --------------------------------- */
  function isInBounds(x, z, margin) {
    var m = margin || 0;
    return x >= -HALF_W + m && x <= HALF_W - m && z >= -HALF_D + m && z <= HALF_D - m;
  }
  function clampToIsland(x, z, margin) {
    var m = margin || 40;
    return { x: clamp(x, -HALF_W + m, HALF_W - m), z: clamp(z, -HALF_D + m, HALF_D - m) };
  }
  function isWater(x, z) { return z < WATER_SOUTH || x > WATER_EAST; }

  /* A point is blocked for driving / walking when a building stands
     on it or it is in the water. (G integration: the gameplay
     modules ask for isBlocked; the city answers from its own data.) */
  function isBlocked(x, z) { return isWater(x, z) || !!buildingAt(x, z); }

  /* Island bounds as a plain object, for modules that clamp to it. */
  var BOUNDS = { minX: -HALF_W, maxX: HALF_W, minZ: -HALF_D, maxZ: HALF_D };

  function districtAt(x, z) {
    for (var i = 0; i < DISTRICTS.length; i++) {
      var b = DISTRICTS[i].bounds;
      if (x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]) return DISTRICTS[i];
    }
    return null;
  }
  function districtById(id) {
    for (var i = 0; i < DISTRICTS.length; i++) if (DISTRICTS[i].id === id) return DISTRICTS[i];
    return null;
  }
  function districtNameAt(x, z) {
    var d = districtAt(x, z);
    return d ? d.name : 'Open Water';
  }

  function pointOnRoad(x, z, margin) {
    var m = margin || 0;
    for (var i = 0; i < ROADS.length; i++) {
      var r = ROADS[i];
      var hit = distToSegment(x, z, r.ax, r.az, r.bx, r.bz);
      if (hit.d <= r.width / 2 + m) return true;
    }
    return false;
  }

  function nearLandmark(x, z, radius) {
    for (var i = 0; i < LANDMARKS.length; i++) {
      var dx = x - LANDMARKS[i].x, dz = z - LANDMARKS[i].z;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }
  function nearGarage(x, z, radius) {
    for (var i = 0; i < GARAGES.length; i++) {
      var dx = x - GARAGES[i].x, dz = z - GARAGES[i].z;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }

  /* ---- Buildings ------------------------------------------------ */
  var BUILDINGS = [];
  (function generateBuildings() {
    var rng = mulberry32(CITY_SEED);
    var paletteJitter = 0.12;
    for (var d = 0; d < DISTRICTS.length; d++) {
      var dist = DISTRICTS[d];
      var b = dist.bounds;
      var stepX = dist.style === 'tower' ? 170 : 120;
      var stepZ = dist.style === 'tower' ? 170 : 120;
      for (var x = b[0] + 70; x < b[2] - 40; x += stepX) {
        for (var z = b[1] + 70; z < b[3] - 40; z += stepZ) {
          if (rng() < 0.22) continue; /* leave courtyards and gaps */
          var bx = x + (rng() - 0.5) * 30;
          var bz = z + (rng() - 0.5) * 30;
          if (pointOnRoad(bx, bz, 26)) continue;
          if (nearLandmark(bx, bz, 90)) continue;
          if (nearGarage(bx, bz, 70)) continue; /* keep garage doors clear */
          var w = 34 + rng() * 34;
          var dep = 30 + rng() * 30;
          var h = dist.height[0] + rng() * (dist.height[1] - dist.height[0]);
          var base = dist.palette[0];
          var colour = [
            clamp(base[0] + (rng() - 0.5) * paletteJitter, 0.05, 1),
            clamp(base[1] + (rng() - 0.5) * paletteJitter, 0.05, 1),
            clamp(base[2] + (rng() - 0.5) * paletteJitter, 0.05, 1)
          ];
          BUILDINGS.push({
            x: bx, z: bz, y: 0, w: w, d: dep, h: h,
            colour: colour, roof: dist.palette[1],
            district: dist.id, districtName: dist.name,
            style: dist.style, rot: rng() < 0.5 ? 0 : Math.PI / 2
          });
        }
      }
    }
  })();

  function buildingAt(x, z) {
    for (var i = 0; i < BUILDINGS.length; i++) {
      var b = BUILDINGS[i];
      if (Math.abs(x - b.x) <= b.w / 2 + 2 && Math.abs(z - b.z) <= b.d / 2 + 2) return b;
    }
    return null;
  }
  function buildingsInDistrict(id) {
    var out = [];
    for (var i = 0; i < BUILDINGS.length; i++) if (BUILDINGS[i].district === id) out.push(BUILDINGS[i]);
    return out;
  }

  /* ---- Queries -------------------------------------------------- */
  function isOnRoad(x, z) { return pointOnRoad(x, z, 0); }

  function nearestRoadPoint(x, z) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < ROADS.length; i++) {
      var r = ROADS[i];
      var hit = distToSegment(x, z, r.ax, r.az, r.bx, r.bz);
      if (hit.d < bestD) { bestD = hit.d; best = { x: hit.x, z: hit.z, distance: hit.d, road: r }; }
    }
    return best;
  }

  function nearestLandmark(x, z) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < LANDMARKS.length; i++) {
      var dx = x - LANDMARKS[i].x, dz = z - LANDMARKS[i].z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestD) { bestD = d; best = LANDMARKS[i]; }
    }
    return best ? { landmark: best, distance: bestD } : null;
  }

  function nearestGarage(x, z) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < GARAGES.length; i++) {
      var dx = x - GARAGES[i].x, dz = z - GARAGES[i].z;
      var d = Math.sqrt(dx * dx + dz * dz);
      if (d < bestD) { bestD = d; best = GARAGES[i]; }
    }
    return best ? { garage: best, distance: bestD } : null;
  }

  /* Where a car taken out of a garage appears: just south of the
     garage door, facing north up the nearest road. */
  function garageSpawnPosition(garage) {
    var g = garage || GARAGES[0];
    return { x: g.x, z: g.z + 34, y: 0, facing: 0, garage: g };
  }

  function randomRoadPosition(rng) {
    var rand = asRand(rng, CITY_SEED + 7);
    var r = ROADS[Math.floor(rand() * ROADS.length)];
    var t = rand();
    var lane = rand() * 2 - 1; /* lane offset across the road */
    var dx = r.bx - r.ax, dz = r.bz - r.az;
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    var nx = -dz / len, nz = dx / len;
    return {
      x: r.ax + dx * t + nx * lane * (r.width / 4),
      z: r.az + dz * t + nz * lane * (r.width / 4),
      facing: Math.atan2(dx, dz),
      road: r
    };
  }

  function randomSpawnPosition(rng) {
    var rand = asRand(rng, CITY_SEED + 13);
    for (var tries = 0; tries < 200; tries++) {
      var x = (rand() * 2 - 1) * (HALF_W - 120);
      var z = (rand() * 2 - 1) * (HALF_D - 120);
      if (isWater(x, z)) continue;
      if (pointOnRoad(x, z, 14)) continue;
      if (buildingAt(x, z)) continue;
      if (nearLandmark(x, z, 60)) continue;
      if (nearGarage(x, z, 50)) continue;
      return { x: x, z: z, y: 0 };
    }
    var near = nearestRoadPoint(0, 0);
    return { x: near.x, z: near.z, y: 0 };
  }

  CA.city = {
    WORLD_W: WORLD_W, WORLD_D: WORLD_D,
    HALF_W: HALF_W, HALF_D: HALF_D,
    seed: CITY_SEED,
    districts: DISTRICTS,
    roads: ROADS,
    buildings: BUILDINGS,
    landmarks: LANDMARKS,
    garages: GARAGES,
    districtAt: districtAt,
    districtById: districtById,
    districtNameAt: districtNameAt,
    isOnRoad: isOnRoad,
    isInBounds: isInBounds,
    clampToIsland: clampToIsland,
    isWater: isWater,
    isBlocked: isBlocked,
    bounds: BOUNDS,
    nearestRoadPoint: nearestRoadPoint,
    nearestLandmark: nearestLandmark,
    nearestGarage: nearestGarage,
    garageSpawnPosition: garageSpawnPosition,
    randomRoadPosition: randomRoadPosition,
    randomSpawnPosition: randomSpawnPosition,
    /* Alias the traffic module asks for: a building-free spawn point. */
    randomBuildingFreePosition: randomSpawnPosition,
    buildingAt: buildingAt,
    buildingsInDistrict: buildingsInDistrict,
    landmarkList: function () { return LANDMARKS.slice(); },
    garageList: function () { return GARAGES.slice(); }
  };
})();
