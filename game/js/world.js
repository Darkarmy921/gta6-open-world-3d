/* Cayo Azul — world.js (Module B) — revision 2
   Turns the city layout into static render meshes: buildings,
   roads, sidewalks, piers, trees and streetlights merged into a
   small number of large buffers, one per district where sensible.
   Uses the mesh builders from the engine (CA.mesh); each builder
   returns plain mesh data { positions, normals, colors, indices }.
   Revision changes: fixed the road-quad rotation (the flat mesh
   length lies along local X, so the angle is atan2(-dz, dx), not
   atan2(dx, dz) — the first pass laid north-south roads sideways);
   added a separate lit-windows buffer for night, garage door
   slabs, beach umbrellas on Coral Beach, per-district centres for
   the renderer's culling, vertex/triangle counts, and a rebuild()
   that forces a fresh build. */
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});

  var ROAD_COLOUR = [0.16, 0.16, 0.18];
  var WALK_COLOUR = [0.55, 0.53, 0.48];
  var GRASS_COLOUR = [0.30, 0.52, 0.28];
  var SAND_COLOUR = [0.88, 0.80, 0.60];
  var PIER_COLOUR = [0.45, 0.36, 0.26];
  var TRUNK_COLOUR = [0.35, 0.25, 0.15];
  var LEAF_COLOUR = [0.20, 0.55, 0.25];
  var POLE_COLOUR = [0.25, 0.25, 0.28];
  var LAMP_COLOUR = [1.0, 0.90, 0.60];
  var CRANE_COLOUR = [0.85, 0.55, 0.15];
  var WINDOW_COLOUR = [1.0, 0.80, 0.45];
  var GARAGE_DOOR_COLOUR = [0.30, 0.32, 0.38];
  var UMBRELLA_COLOUR = [0.90, 0.35, 0.30];

  function emptyMesh() {
    return { positions: [], normals: [], colors: [], indices: [] };
  }

  /* Append src mesh into dst, translating by (ox, oy, oz). The src
     mesh is in its own local space with its base at y = 0. */
  function appendMesh(dst, src, ox, oy, oz) {
    if (!src || !src.positions || src.positions.length === 0) return;
    var base = dst.positions.length / 3;
    for (var i = 0; i < src.positions.length; i += 3) {
      dst.positions.push(src.positions[i] + ox, src.positions[i + 1] + oy, src.positions[i + 2] + oz);
      dst.normals.push(src.normals[i], src.normals[i + 1], src.normals[i + 2]);
    }
    for (var j = 0; j < src.colors.length; j++) dst.colors.push(src.colors[j]);
    for (var k = 0; k < src.indices.length; k++) dst.indices.push(src.indices[k] + base);
  }

  /* Rotate a flat (horizontal) mesh around Y so its local X axis
     lies along (dx, dz). A rotation by theta maps local +X to
     (cos theta, 0, -sin theta), so theta = atan2(-dz, dx). Flat
     quads keep their up normal under a Y rotation. */
  function rotateFlatY(meshData, dx, dz) {
    var len = Math.sqrt(dx * dx + dz * dz) || 1;
    var ang = Math.atan2(-dz, dx);
    var cos = Math.cos(ang), sin = Math.sin(ang);
    for (var i = 0; i < meshData.positions.length; i += 3) {
      var px = meshData.positions[i], pz = meshData.positions[i + 2];
      meshData.positions[i] = px * cos + pz * sin;
      meshData.positions[i + 2] = -px * sin + pz * cos;
    }
    return meshData;
  }

  /* Fallback box builder, used only if the engine mesh module has
     not supplied one yet; it emits the same mesh data shape. */
  function fallbackBox(w, h, d, colour) {
    var x = w / 2, y = h, z = d / 2;
    var faces = [
      [[-x, 0, -z], [x, 0, -z], [x, y, -z], [-x, y, -z], [0, 0, -1]],
      [[-x, 0, z], [-x, y, z], [x, y, z], [x, 0, z], [0, 0, 1]],
      [[-x, 0, -z], [-x, y, -z], [-x, y, z], [-x, 0, z], [-1, 0, 0]],
      [[x, 0, -z], [x, 0, z], [x, y, z], [x, y, -z], [1, 0, 0]],
      [[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z], [0, 1, 0]],
      [[-x, 0, -z], [-x, 0, z], [x, 0, z], [x, 0, -z], [0, -1, 0]]
    ];
    var m = emptyMesh();
    faces.forEach(function (f) {
      var base = m.positions.length / 3;
      var n = f[4];
      for (var i = 0; i < 4; i++) {
        m.positions.push(f[i][0], f[i][1], f[i][2]);
        m.normals.push(n[0], n[1], n[2]);
        m.colors.push(colour[0], colour[1], colour[2]);
      }
      m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    return m;
  }

  function fallbackFlat(w, d, colour, y) {
    var x = w / 2, z = d / 2, yy = y || 0;
    return {
      positions: [-x, yy, -z, x, yy, -z, x, yy, z, -x, yy, z],
      normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      colors: [colour[0], colour[1], colour[2], colour[0], colour[1], colour[2],
               colour[0], colour[1], colour[2], colour[0], colour[1], colour[2]],
      indices: [0, 1, 2, 0, 2, 3]
    };
  }

  /* A vertical quad facing +Z, for lit windows on building faces.
     Width and height in world units; the quad's base sits at y. */
  function fallbackWindowQuad(w, h, colour) {
    var x = w / 2, y = h;
    return {
      positions: [-x, 0, 0, x, 0, 0, x, y, 0, -x, y, 0],
      normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      colors: [colour[0], colour[1], colour[2], colour[0], colour[1], colour[2],
               colour[0], colour[1], colour[2], colour[0], colour[1], colour[2]],
      indices: [0, 1, 2, 0, 2, 3]
    };
  }

  function mesh() { return CA.mesh || {}; }

  function boxMesh(w, h, d, colour) {
    var m = mesh();
    if (typeof m.box === 'function') return m.box(w, h, d, colour);
    return fallbackBox(w, h, d, colour);
  }

  function flatMesh(w, d, colour, y) {
    var m = mesh();
    if (typeof m.plane === 'function') return m.plane(w, d, colour, y);
    if (typeof m.groundPlane === 'function') return m.groundPlane(w, d, colour, y);
    return fallbackFlat(w, d, colour, y);
  }

  function cylinderMesh(radius, height, segments, colour) {
    var m = mesh();
    /* (G integration: mesh.cylinder takes (rTop, rBottom, h,
       segments, color) — the old call passed four args, so the
       colour landed in the segments slot and the colour was
       undefined, crashing the world build.) */
    if (typeof m.cylinder === 'function') return m.cylinder(radius, radius, height, segments, colour);
    return fallbackBox(radius * 2, height, radius * 2, colour);
  }

  function coneMesh(radius, height, segments, colour) {
    var m = mesh();
    if (typeof m.cone === 'function') return m.cone(radius, height, segments, colour);
    return fallbackBox(radius * 2, height, radius * 2, colour);
  }

  /* ---- Static build --------------------------------------------- */
  var built = null;

  function buildWorld() {
    var city = CA.city;
    if (!city) return null;
    var perDistrict = {};
    var shared = emptyMesh(); /* ground, roads, piers, water edge */
    var trees = emptyMesh();
    var lights = emptyMesh();
    var windows = emptyMesh(); /* lit windows, drawn only at night */

    /* Ground slab for the whole island, then sand on the east edge. */
    appendMesh(shared, flatMesh(city.WORLD_W, city.WORLD_D, GRASS_COLOUR, -0.2), 0, 0, 0);
    appendMesh(shared, flatMesh(260, city.WORLD_D, SAND_COLOUR, -0.1), city.HALF_W - 130, 0, 0);

    /* Roads: a flat quad per segment, slightly above the ground,
       plus a sidewalk strip on one edge (the other edge is covered
       by the next parallel road's strip in the grid). */
    city.roads.forEach(function (r) {
      var dx = r.bx - r.ax, dz = r.bz - r.az;
      var len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1) return;
      var seg = rotateFlatY(flatMesh(len, r.width, ROAD_COLOUR, 0.05), dx, dz);
      appendMesh(shared, seg, (r.ax + r.bx) / 2, 0, (r.az + r.bz) / 2);
      var nx = -dz / len, nz = dx / len;
      var walk = rotateFlatY(flatMesh(len, 4, WALK_COLOUR, 0.08), dx, dz);
      appendMesh(shared, walk, (r.ax + r.bx) / 2 + nx * (r.width / 2 + 3), 0, (r.az + r.bz) / 2 + nz * (r.width / 2 + 3));
    });

    /* Harbour piers and cranes on the south shore. (G: every mesh
       builder is centred on its origin, so each part is raised by
       half its height — the old code left piers, crane poles and
       buildings half-buried and their roofs floating.) */
    [-900, -300, 300, 900].forEach(function (px) {
      appendMesh(shared, boxMesh(60, 3, 260, PIER_COLOUR), px, 1.5, -1420);
      appendMesh(shared, boxMesh(10, 46, 10, CRANE_COLOUR), px + 18, 23, -1380);
      appendMesh(shared, boxMesh(46, 8, 8, CRANE_COLOUR), px + 18, 42, -1380);
      appendMesh(shared, boxMesh(8, 8, 30, CRANE_COLOUR), px + 36, 40, -1395);
    });

    /* Buildings, one merged buffer per district, plus lit window
       quads on the south face of every third building. The window
       quad sits 0.3 units proud of the wall so it never z-fights. */
    city.buildings.forEach(function (b, bi) {
      var key = b.district;
      if (!perDistrict[key]) perDistrict[key] = emptyMesh();
      /* Body spans 0..h, roof slab sits on top at h..h+2. */
      appendMesh(perDistrict[key], boxMesh(b.w, b.h, b.d, b.colour), b.x, b.h / 2, b.z);
      appendMesh(perDistrict[key], boxMesh(b.w + 2, 2, b.d + 2, b.roof), b.x, b.h + 1, b.z);
      if (b.style === 'villa' || b.style === 'cottage') {
        var prism = mesh();
        var top = (typeof prism.prism === 'function')
          ? prism.prism(b.w, 6, b.d, b.roof)
          : boxMesh(b.w * 0.7, 5, b.d * 0.7, b.roof);
        appendMesh(perDistrict[key], top, b.x, b.h + 2 + 3, b.z);
      }
      if (bi % 3 === 0 && b.h >= 10) {
        var floors = Math.min(4, Math.floor(b.h / 8));
        for (var f = 0; f < floors; f++) {
          var winY = 4 + f * 7;
          if (winY + 3 > b.h) break;
          appendMesh(windows, fallbackWindowQuad(5, 3, WINDOW_COLOUR), b.x - b.w / 4, winY, b.z + b.d / 2 + 0.3);
          appendMesh(windows, fallbackWindowQuad(5, 3, WINDOW_COLOUR), b.x + b.w / 4, winY, b.z + b.d / 2 + 0.3);
        }
      }
    });

    /* Landmark markers: a tall pale pillar so each landmark reads
       from a distance, plus a coloured cap. */
    city.landmarks.forEach(function (lm) {
      var dist = city.districtAt(lm.x, lm.z);
      var key = dist ? dist.id : 'shared';
      if (!perDistrict[key]) perDistrict[key] = emptyMesh();
      appendMesh(perDistrict[key], boxMesh(8, 30, 8, [0.92, 0.90, 0.82]), lm.x, 15, lm.z);
      appendMesh(perDistrict[key], boxMesh(12, 4, 12, [0.85, 0.55, 0.20]), lm.x, 30, lm.z);
    });

    /* Garage buildings: a low wide block with a dark door slab on
       its south face, one per garage in the list. */
    city.garages.forEach(function (g) {
      var dist = city.districtAt(g.x, g.z);
      var key = dist ? dist.id : 'shared';
      if (!perDistrict[key]) perDistrict[key] = emptyMesh();
      appendMesh(perDistrict[key], boxMesh(56, 12, 40, [0.60, 0.58, 0.55]), g.x, 6, g.z);
      appendMesh(perDistrict[key], boxMesh(40, 9, 2, GARAGE_DOOR_COLOUR), g.x, 4.5, g.z + 21);
    });

    /* Beach umbrellas on Coral Beach: a pole and a cone canopy. */
    for (var u = 0; u < 12; u++) {
      var ux = 1560 + (u % 4) * 55;
      var uz = 500 + Math.floor(u / 4) * 180;
      appendMesh(shared, cylinderMesh(0.5, 5, 5, TRUNK_COLOUR), ux, 2.5, uz);
      appendMesh(shared, coneMesh(9, 4, 8, UMBRELLA_COLOUR), ux, 7, uz);
    }

    /* Trees and streetlights, scattered deterministically along
       roads and in the Gardens district. */
    var nextRand = (function () {
      var s = 4242;
      return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    })();
    city.roads.forEach(function (r, ri) {
      var dx = r.bx - r.ax, dz = r.bz - r.az;
      var len = Math.sqrt(dx * dx + dz * dz);
      var steps = Math.floor(len / 140);
      for (var s = 0; s < steps; s++) {
        var t = (s + 0.5) / steps;
        var side = (ri + s) % 2 === 0 ? 1 : -1;
        var off = r.width / 2 + 8;
        var nx = -dz / (len || 1), nz = dx / (len || 1);
        var tx = r.ax + dx * t + nx * off * side;
        var tz = r.az + dz * t + nz * off * side;
        if (city.buildingAt && city.buildingAt(tx, tz)) continue;
        if ((ri + s) % 3 === 0) {
          appendMesh(trees, cylinderMesh(1.5, 8, 6, TRUNK_COLOUR), tx, 4, tz);
          appendMesh(trees, coneMesh(7, 14, 8, LEAF_COLOUR), tx, 15, tz);
        } else {
          appendMesh(lights, cylinderMesh(0.6, 11, 6, POLE_COLOUR), tx, 5.5, tz);
          appendMesh(lights, boxMesh(3, 1.5, 2, LAMP_COLOUR), tx, 11, tz);
        }
      }
    });
    for (var g = 0; g < 40; g++) {
      var gx = -850 + nextRand() * 1100;
      var gz = 350 + nextRand() * 500;
      if (city.buildingAt && city.buildingAt(gx, gz)) continue;
      appendMesh(trees, cylinderMesh(1.5, 8, 6, TRUNK_COLOUR), gx, 4, gz);
      appendMesh(trees, coneMesh(8, 16, 8, LEAF_COLOUR), gx, 16, gz);
    }

    /* Upload the merged meshes to GPU buffers through the renderer.
       (G integration: the engine's upload call is createMesh — the
       old createBuffer/uploadMesh names never existed, so buffers
       used to stay raw mesh data and nothing drew.) */
    var gl = CA.gl;
    function toBuffer(m) {
      if (gl && typeof gl.createMesh === 'function') return gl.createMesh(m);
      return m; /* raw mesh data; the renderer can upload it later */
    }
    var buffers = {};
    Object.keys(perDistrict).forEach(function (key) {
      buffers[key] = toBuffer(perDistrict[key]);
    });
    buffers.shared = toBuffer(shared);
    buffers.trees = toBuffer(trees);
    buffers.lights = toBuffer(lights);
    buffers.windows = toBuffer(windows);

    function triCount(m) { return m.indices.length / 3; }
    var totalTris = triCount(shared) + triCount(trees) + triCount(lights) + triCount(windows);
    Object.keys(perDistrict).forEach(function (key) { totalTris += triCount(perDistrict[key]); });

    built = {
      meshes: { districts: perDistrict, shared: shared, trees: trees, lights: lights, windows: windows },
      buffers: buffers,
      districtCentres: city.districts.map(function (d) {
        return { id: d.id, centre: d.centre, radius: d.radius };
      }),
      counts: {
        districts: Object.keys(perDistrict).length,
        buildings: city.buildings.length,
        roads: city.roads.length,
        treesAndLights: trees.positions.length / 3 + lights.positions.length / 3,
        windowQuads: windows.indices.length / 6,
        triangles: totalTris
      }
    };
    return built;
  }

  function getBuilt() {
    if (!built) return buildWorld();
    return built;
  }

  CA.world = {
    build: buildWorld,
    rebuild: function () { built = null; return buildWorld(); },
    get: getBuilt,
    built: function () { return built; }
  };
})();
