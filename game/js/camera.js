/* Cayo Azul — camera.js (Module B) — revision 2
   Chase camera: follows the player or the player's car smoothly
   from behind and above, zooms out slightly at high speed, shakes
   briefly on hard impacts. Mouse drag orbits a little around the
   player; the wheel pulls the camera closer or further within a
   small range. Answers the current view position and target, and
   takes shake requests with a strength.
   Revision changes: the camera is now clamped inside the island
   and never drops below y = 1.2, so it cannot sink under the
   ground or drift out over the water; the look target leads the
   player forward with speed so fast driving does not outrun the
   view; shakeTime resets to zero when the shake fully decays;
   added reset() and setZoom() helpers and a yaw getter. */
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});

  var BASE_DISTANCE = 10;
  var BASE_HEIGHT = 4.5;
  var MIN_DISTANCE = 6;
  var MAX_DISTANCE = 15;
  var SPEED_ZOOM = 0.06;   /* extra distance per unit of speed */
  var MAX_SPEED_ZOOM = 5;
  var ORBIT_LIMIT = 0.9;   /* radians either side of straight behind */
  var SMOOTH = 6;          /* follow smoothing rate */
  var SHAKE_DECAY = 3.5;
  var MIN_CAM_Y = 1.2;
  var LOOK_AHEAD = 0.15;   /* target lead per unit of speed */

  var cam = {
    pos: [0, BASE_HEIGHT, -BASE_DISTANCE],
    target: [0, 1.5, 0],
    yaw: 0,          /* camera yaw: the direction it looks, around Y */
    orbitYaw: 0,     /* mouse orbit offset from straight behind */
    orbitPitch: 0,   /* mouse orbit height offset */
    distance: BASE_DISTANCE,
    wheelDistance: 0, /* wheel zoom offset, clamped */
    shake: 0,
    shakeTime: 0
  };

  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* Read the mouse state from the input module when it is there.
     (G integration: CA.input has no .mouse object — it exposes
     getMouseDX/DY, isMouseDown and getWheelDelta, cleared each
     frame by input.update().) Dragging orbits; the wheel adjusts
     distance. Both are clamped so the camera can never swing far
     from the chase view. */
  function readInput(dt) {
    var input = CA.input;
    if (!input) return;
    var dragging = false;
    if (typeof input.isMouseDown === 'function') {
      try { dragging = !!input.isMouseDown(0); } catch (e) { dragging = false; }
    }
    if (dragging && typeof input.getMouseDX === 'function') {
      cam.orbitYaw = clamp(cam.orbitYaw - input.getMouseDX() * 0.004, -ORBIT_LIMIT, ORBIT_LIMIT);
    }
    if (dragging && typeof input.getMouseDY === 'function') {
      cam.orbitPitch = clamp(cam.orbitPitch + input.getMouseDY() * 0.002, -0.5, 0.6);
    }
    if (typeof input.getWheelDelta === 'function') {
      var wheel = input.getWheelDelta();
      if (wheel) {
        cam.wheelDistance = clamp(cam.wheelDistance + wheel * 0.005, MIN_DISTANCE - BASE_DISTANCE, MAX_DISTANCE - BASE_DISTANCE);
      }
    }
    /* Idle: the orbit eases back to straight behind the player. */
    if (!dragging) {
      cam.orbitYaw = lerp(cam.orbitYaw, 0, Math.min(1, dt * 1.2));
      cam.orbitPitch = lerp(cam.orbitPitch, 0, Math.min(1, dt * 1.2));
    }
  }

  /* Keep the camera over the island and above the ground. The
     island half-extents come from the city module when it is
     loaded; otherwise the spec's 3600 x 3000 size is used. */
  function clampCameraPos(p) {
    var halfW = (CA.city && CA.city.HALF_W) || 1800;
    var halfD = (CA.city && CA.city.HALF_D) || 1500;
    p[0] = clamp(p[0], -halfW - 120, halfW + 120);
    p[2] = clamp(p[2], -halfD - 120, halfD + 120);
    if (p[1] < MIN_CAM_Y) p[1] = MIN_CAM_Y;
    return p;
  }

  /* follow: { x, y, z, facing, speed } — the player or the car.
     dt is the clamped frame step from the loop. */
  function update(dt, follow) {
    if (!dt || dt <= 0) dt = 0.016;
    if (dt > 0.1) dt = 0.1;
    readInput(dt);
    if (!follow) return cam;

    var facing = follow.facing || 0;
    var speed = Math.abs(follow.speed || 0);
    var wantDistance = BASE_DISTANCE + cam.wheelDistance +
      Math.min(MAX_SPEED_ZOOM, speed * SPEED_ZOOM);
    cam.distance = lerp(cam.distance, wantDistance, Math.min(1, dt * 3));

    /* Desired camera yaw sits behind the facing, plus orbit. */
    var wantYaw = facing + Math.PI + cam.orbitYaw;
    var dyaw = wantYaw - cam.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    cam.yaw += dyaw * Math.min(1, dt * SMOOTH);

    var height = BASE_HEIGHT + cam.orbitPitch * 4 + Math.min(2, speed * 0.02);
    var backX = Math.sin(cam.yaw) * cam.distance;
    var backZ = Math.cos(cam.yaw) * cam.distance;
    var wantPos = [follow.x + backX, (follow.y || 0) + height, follow.z + backZ];
    /* Look target leads the player forward with speed, so fast
       driving shows the road ahead instead of the bumper.
       Forward is (sin facing, cos facing); the camera sits behind
       at yaw = facing + PI, so the lead uses that direction. */
    var lead = Math.min(12, speed * LOOK_AHEAD);
    var wantTarget = [
      follow.x + Math.sin(facing) * lead,
      (follow.y || 0) + 1.6,
      follow.z + Math.cos(facing) * lead
    ];

    var k = Math.min(1, dt * SMOOTH);
    cam.pos[0] = lerp(cam.pos[0], wantPos[0], k);
    cam.pos[1] = lerp(cam.pos[1], wantPos[1], k);
    cam.pos[2] = lerp(cam.pos[2], wantPos[2], k);
    clampCameraPos(cam.pos);
    cam.target[0] = lerp(cam.target[0], wantTarget[0], Math.min(1, dt * 8));
    cam.target[1] = lerp(cam.target[1], wantTarget[1], Math.min(1, dt * 8));
    cam.target[2] = lerp(cam.target[2], wantTarget[2], Math.min(1, dt * 8));

    /* Shake decays; it is applied at read time, not baked in. */
    if (cam.shake > 0) {
      cam.shakeTime += dt;
      cam.shake = Math.max(0, cam.shake - dt * SHAKE_DECAY);
      if (cam.shake === 0) cam.shakeTime = 0;
    }
    return cam;
  }

  /* The view position, with the current shake offset applied.
     The shake is a deterministic wobble from shakeTime, not from
     the wall clock, so a replayed trace shakes the same way. */
  function position() {
    if (cam.shake <= 0) return cam.pos.slice();
    var s = cam.shake;
    var t = cam.shakeTime * 31;
    return [
      cam.pos[0] + Math.sin(t * 1.3) * s * 0.35,
      cam.pos[1] + Math.sin(t * 1.7) * s * 0.25,
      cam.pos[2] + Math.cos(t * 1.1) * s * 0.35
    ];
  }

  function target() { return cam.target.slice(); }

  function addShake(strength) {
    cam.shake = Math.min(1.5, cam.shake + (strength || 0.5));
    if (cam.shakeTime === 0) cam.shakeTime = 0.001;
  }

  function snapTo(follow) {
    if (!follow) return;
    cam.yaw = (follow.facing || 0) + Math.PI;
    cam.orbitYaw = 0;
    cam.orbitPitch = 0;
    cam.pos = [
      follow.x + Math.sin(cam.yaw) * cam.distance,
      (follow.y || 0) + BASE_HEIGHT,
      follow.z + Math.cos(cam.yaw) * cam.distance
    ];
    clampCameraPos(cam.pos);
    cam.target = [follow.x, (follow.y || 0) + 1.6, follow.z];
    cam.shake = 0;
    cam.shakeTime = 0;
  }

  /* Wheel zoom from code (screenshot staging): offset in world
     units, negative pulls closer, clamped to the wheel range. */
  function setZoom(offset) {
    cam.wheelDistance = clamp(offset || 0, MIN_DISTANCE - BASE_DISTANCE, MAX_DISTANCE - BASE_DISTANCE);
  }

  function reset() {
    cam.pos = [0, BASE_HEIGHT, -BASE_DISTANCE];
    cam.target = [0, 1.5, 0];
    cam.yaw = 0;
    cam.orbitYaw = 0;
    cam.orbitPitch = 0;
    cam.distance = BASE_DISTANCE;
    cam.wheelDistance = 0;
    cam.shake = 0;
    cam.shakeTime = 0;
  }

  CA.camera = {
    update: update,
    position: position,
    target: target,
    addShake: addShake,
    /* Alias the gameplay modules ask for. */
    shake: addShake,
    snapTo: snapTo,
    setZoom: setZoom,
    reset: reset,
    get distance() { return cam.distance; },
    get shake() { return cam.shake; },
    get yaw() { return cam.yaw; }
  };
})();
