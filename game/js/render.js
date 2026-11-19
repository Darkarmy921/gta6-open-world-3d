/* Cayo Azul — render.js (Module B) — revision 2
   Draws the whole world each frame: sets projection and view from
   the camera, draws the static city buffers, draws cars, people,
   police, particles and water through the renderer (CA.gl),
   applies fog and the current sky. Owns the per-frame draw order.
   Revision changes: distance culling for districts (by the
   per-district centres world.js now exposes), cars, people and
   police; the lit-windows buffer is drawn only when the weather
   module reports window lights above 0.05; a flat water plane is
   drawn when the renderer has no drawWater helper; the player on
   foot is drawn from CA.state.player; per-category draw stats;
   aspect falls back to the canvas client size when the drawing
   buffer size is not set. */
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});

  var FOV = 62;            /* vertical field of view, degrees */
  var NEAR = 0.5;
  var FAR = 4000;
  var WATER_Y = -0.6;
  var WATER_SIZE = 9000;
  var CULL_MARGIN = 400;   /* extra reach past a district's radius */
  var WATER_COLOUR = [0.15, 0.45, 0.65];

  var frameCount = 0;
  var lastStats = { draws: 0, frame: 0, city: 0, cars: 0, people: 0, police: 0, culled: 0 };

  /* GPU mesh caches. (G integration: CA.mesh.* builders return raw
     mesh data, but CA.gl.drawMesh only accepts GPU meshes from
     createMesh. The old code passed raw data straight to drawMesh
     every frame, so cars, people and the city never drew at all.
     Each cache entry is uploaded once and reused.) */
  var carGpuCache = {};
  var personGpuCache = {};
  var particleGpuCache = {};
  var waterGpuMesh = null;

  function gpuMeshFor(data, cache, key) {
    if (!data) return null;
    if (cache && key && cache[key]) return cache[key];
    var g = CA.gl;
    if (!g || typeof g.createMesh !== 'function') return null;
    var gpu = g.createMesh(data);
    if (gpu && cache && key) cache[key] = gpu;
    return gpu;
  }

  function waterMesh() {
    if (waterGpuMesh) return waterGpuMesh;
    if (!CA.mesh || typeof CA.mesh.groundPlane !== 'function') return null;
    var g = CA.gl;
    if (!g || typeof g.createMesh !== 'function') return null;
    var data = CA.mesh.groundPlane(WATER_SIZE, WATER_SIZE, WATER_COLOUR, 1);
    if (CA.mesh.translate) CA.mesh.translate(data, 0, WATER_Y, 0);
    waterGpuMesh = g.createMesh(data);
    return waterGpuMesh;
  }

  /* Particle quad drawer: one GPU box per effect kind, scaled to
     the particle's size by the model matrix. */
  function drawParticleQuad(x, y, z, size, r, g, b, a) {
    if (!CA.mesh || typeof CA.mesh.box !== 'function') return;
    var key = [r.toFixed(2), g.toFixed(2), b.toFixed(2)].join(',');
    var gpu = particleGpuCache[key];
    if (!gpu) {
      gpu = gpuMeshFor(CA.mesh.box(1, 1, 1, [r, g, b]), particleGpuCache, key);
      if (!gpu) return;
    }
    drawMesh(CA.gl, gpu, modelMatrix(x, y, z, 0, Math.max(0.1, size)));
  }

  function degToRad(d) { return d * Math.PI / 180; }

  /* Perspective matrix, written out by hand (column-major, the
     layout WebGL expects). Only used when the engine math module
     has not supplied one. */
  function perspective(fovDeg, aspect, near, far) {
    var f = 1 / Math.tan(degToRad(fovDeg) / 2);
    var nf = 1 / (near - far);
    return [
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, 2 * far * near * nf, 0
    ];
  }

  function lookAt(eye, target, up) {
    var zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
    var zl = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1;
    zx /= zl; zy /= zl; zz /= zl;
    var xx = up[1] * zz - up[2] * zy;
    var xy = up[2] * zx - up[0] * zz;
    var xz = up[0] * zy - up[1] * zx;
    var xl = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1;
    xx /= xl; xy /= xl; xz /= xl;
    var yx = zy * xz - zz * xy;
    var yy = zz * xx - zx * xz;
    var yz = zx * xy - zy * xx;
    return [
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1
    ];
  }

  function identity() {
    return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  /* Model matrix from a position and a facing angle around Y. */
  function modelMatrix(x, y, z, facing, scale) {
    var c = Math.cos(facing || 0), s = Math.sin(facing || 0);
    var sc = scale || 1;
    return [
      c * sc, 0, -s * sc, 0,
      0, sc, 0, 0,
      s * sc, 0, c * sc, 0,
      x, y, z, 1
    ];
  }

  function drawMesh(gl, meshOrBuffer, model) {
    if (!gl) return false;
    if (typeof gl.draw === 'function') { gl.draw(meshOrBuffer, model); return true; }
    if (typeof gl.drawMesh === 'function') { gl.drawMesh(meshOrBuffer, model); return true; }
    return false;
  }

  function dist2D(ax, az, bx, bz) {
    var dx = ax - bx, dz = az - bz;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function draw(state, dt, time) {
    var gl = CA.gl;
    var world = CA.world && CA.world.get ? CA.world.get() : null;
    var camera = CA.camera;
    var weather = CA.weather;
    frameCount++;
    var draws = 0, culled = 0;
    var statCity = 0, statCars = 0, statPeople = 0, statPolice = 0;
    if (!gl || !camera) return lastStats;

    /* 1. Sky, sun and fog from the weather module. */
    var light = null;
    if (weather) {
      light = weather.apply ? weather.apply(gl) : weather.lighting();
    }
    if (gl && typeof gl.clear === 'function') gl.clear();

    /* 2. Projection and view from the camera. */
    var aspect = 1280 / 720;
    /* (G integration: CA.gl exposes the canvas as getCanvas(), not
       a .canvas property — the old check always fell through.) */
    var canvasEl = (gl && typeof gl.getCanvas === 'function') ? gl.getCanvas() : null;
    if (canvasEl) {
      var cw = canvasEl.width || canvasEl.clientWidth || 1280;
      var ch = canvasEl.height || canvasEl.clientHeight || 720;
      aspect = cw / Math.max(1, ch);
    }
    var proj = null, view = null;
    var m3 = CA.math3d;
    if (m3 && typeof m3.perspective === 'function') proj = m3.perspective(FOV, aspect, NEAR, FAR);
    else proj = perspective(FOV, aspect, NEAR, FAR);
    var eye = camera.position();
    var tgt = camera.target();
    if (m3 && typeof m3.lookAt === 'function') view = m3.lookAt(eye, tgt, [0, 1, 0]);
    else view = lookAt(eye, tgt, [0, 1, 0]);
    if (gl) {
      if (typeof gl.setProjection === 'function') gl.setProjection(proj);
      if (typeof gl.setView === 'function') gl.setView(view);
      if (typeof gl.setCamera === 'function') gl.setCamera(eye, tgt);
    }

    /* 3. Water first (it sits below the island, behind the piers).
       (G integration: drawWater takes (mesh, modelMatrix, time,
       deep, shallow) — the old call passed the size as the mesh,
       so the water pass silently refused every frame.) */
    if (gl && typeof gl.drawWater === 'function') {
      var wMesh = waterMesh();
      if (wMesh) {
        gl.drawWater(wMesh, identity(), time || 0, [0.05, 0.25, 0.45], [0.15, 0.55, 0.7]);
        draws++;
      }
    }

    /* 4. Static city: shared ground/roads always, then one buffer
       per district unless its centre is far beyond the fog, then
       trees, streetlights, and — only at night — lit windows. */
    if (world && world.buffers) {
      var b = world.buffers;
      if (b.shared && drawMesh(gl, b.shared, identity())) { draws++; statCity++; }
      var centres = {};
      (world.districtCentres || []).forEach(function (d) { centres[d.id] = d; });
      Object.keys(b).forEach(function (key) {
        if (key === 'shared' || key === 'trees' || key === 'lights' || key === 'windows') return;
        var c = centres[key];
        if (c && dist2D(eye[0], eye[2], c.centre[0], c.centre[1]) > c.radius + FAR * 0.6 + CULL_MARGIN) { culled++; return; }
        if (drawMesh(gl, b[key], identity())) { draws++; statCity++; }
      });
      if (b.trees && drawMesh(gl, b.trees, identity())) { draws++; statCity++; }
      if (b.lights && drawMesh(gl, b.lights, identity())) { draws++; statCity++; }
      var windowLevel = light ? (light.windowLights || 0) : 0;
      if (b.windows && windowLevel > 0.05 && drawMesh(gl, b.windows, identity())) { draws++; statCity++; }
    }

    /* 5. Cars, one by one, placed and rotated by position/facing.
       Cars beyond the far plane are skipped outright. (G: cars
       carry modelId + colour; mesh.car takes a paint colour, not
       a model id, and returns raw data that must be uploaded once
       per paint job and cached.) */
    var cars = (state && state.cars) || (CA.state && CA.state.cars) || [];
    var mesh = CA.mesh;
    cars.forEach(function (car) {
      if (!car) return;
      if (dist2D(eye[0], eye[2], car.x, car.z) > FAR) { culled++; return; }
      var carKey = (car.modelId || 'sedan') + '|' + (car.colour || '');
      var carGpu = carGpuCache[carKey];
      if (!carGpu && mesh && typeof mesh.car === 'function') {
        carGpu = gpuMeshFor(mesh.car(car.colour || '#888888', '#1a2a3a',
          { roofLight: car.modelId === 'police' ? [1.0, 0.2, 0.2] : null }), carGpuCache, carKey);
      }
      if (carGpu && drawMesh(gl, carGpu, modelMatrix(car.x, car.y || 0, car.z, car.facing))) { draws++; statCars++; }
    });

    /* 6. People: pedestrians, then the player on foot when they
       are not driving. Walk bob comes from the frame time. */
    var people = (state && state.pedestrians) || (CA.state && CA.state.pedestrians) || [];
    var player = (state && state.player) || (CA.state && CA.state.player);
    if (player && !player.driving && player.car == null) {
      people = people.concat([{ x: player.x, y: player.y || 0, z: player.z, facing: player.facing, colour: player.colour, walking: player.moving }]);
    }
    people.forEach(function (p) {
      if (!p) return;
      if (dist2D(eye[0], eye[2], p.x, p.z) > FAR) { culled++; return; }
      /* person(shirt, skin, pants): the shirt colour is the
         pedestrian's colour, the skin is their skin. */
      var personKey = (p.colour || p.shirt || '') + '|' + (p.skin || '');
      var personGpu = personGpuCache[personKey];
      if (!personGpu && mesh && typeof mesh.person === 'function') {
        personGpu = gpuMeshFor(mesh.person(p.colour || p.shirt || '#c0392b',
          p.skin || '#d9a066', '#2c3e50'), personGpuCache, personKey);
      }
      var bob = p.walking ? Math.sin((time || 0) * 10 + (p.phase || 0)) * 0.05 : 0;
      if (personGpu && drawMesh(gl, personGpu, modelMatrix(p.x, (p.y || 0) + bob, p.z, p.facing))) { draws++; statPeople++; }
    });

    /* 7. Police foot officers (cruisers are in the car list and
       were drawn in step 5). Officers wear navy. */
    var police = (state && state.police) || (CA.state && CA.state.police) || [];
    police.forEach(function (unit) {
      if (!unit) return;
      if (dist2D(eye[0], eye[2], unit.x, unit.z) > FAR) { culled++; return; }
      if (unit.car) return; /* cruiser: already drawn with the cars */
      var officerGpu = personGpuCache['officer'];
      if (!officerGpu && mesh && typeof mesh.person === 'function') {
        officerGpu = gpuMeshFor(mesh.person('#1a2a6b', '#d9a066', '#1a1a22'), personGpuCache, 'officer');
      }
      if (officerGpu && drawMesh(gl, officerGpu, modelMatrix(unit.x, unit.y || 0, unit.z, unit.facing))) { draws++; statPolice++; }
    });

    /* 8. Particles last among the 3D draws. (G integration:
       particles.draw takes a quad-drawing function, not the
       renderer's (gl, view, proj, time) — the old call passed the
       GL object as the drawer and threw every frame.) */
    if (CA.particles && typeof CA.particles.draw === 'function') {
      CA.particles.draw(drawParticleQuad);
      draws++;
    }

    lastStats = { draws: draws, frame: frameCount, city: statCity, cars: statCars, people: statPeople, police: statPolice, culled: culled };
    return lastStats;
  }

  CA.render = {
    draw: draw,
    modelMatrix: modelMatrix,
    perspective: perspective,
    lookAt: lookAt,
    stats: function () { return lastStats; }
  };
})();
