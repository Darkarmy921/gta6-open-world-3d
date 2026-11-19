// Cayo Azul — util.js
// Small math and list helpers shared by every module. Pure functions
// only: no state, no randomness, no clock reads. All angles in radians.
// Facing convention: an angle of 0 faces +z (north), and it grows
// toward +x (east), matching the world axes in the design spec.

(function () {
  'use strict';

  window.CA = window.CA || {};
  var CA = window.CA;

  var TAU = Math.PI * 2;

  function clamp(v, lo, hi) {
    if (v < lo) { return lo; }
    if (v > hi) { return hi; }
    return v;
  }

  function clamp01(v) {
    return clamp(v, 0, 1);
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  // Inverse lerp: where does v sit between a and b, as 0..1.
  function invLerp(a, b, v) {
    if (a === b) { return 0; }
    return clamp((v - a) / (b - a), 0, 1);
  }

  // Smoothstep easing between 0 and 1.
  function smoothstep(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Frame-rate independent smoothing factor: damp(8, dt) is the
  // fraction of the remaining gap closed this frame at rate 8.
  function damp(rate, dt) {
    return 1 - Math.exp(-rate * dt);
  }

  function fract(v) {
    return v - Math.floor(v);
  }

  function deg2rad(d) { return d * Math.PI / 180; }
  function rad2deg(r) { return r * 180 / Math.PI; }

  function sign(v) {
    if (v > 0) { return 1; }
    if (v < 0) { return -1; }
    return 0;
  }

  // Wrap an angle to the range -PI .. PI.
  function angleWrap(a) {
    a = a % TAU;
    if (a > Math.PI) { a -= TAU; }
    if (a < -Math.PI) { a += TAU; }
    return a;
  }

  // Shortest-path interpolation between two angles.
  function angleLerp(a, b, t) {
    return a + angleWrap(b - a) * t;
  }

  // Smallest signed difference from angle a to angle b.
  function angleDiff(a, b) {
    return angleWrap(b - a);
  }

  // Facing angle for a ground-plane direction (dx, dz): 0 faces
  // +z (north), positive angles turn toward +x (east).
  function headingFromDelta(dx, dz) {
    return Math.atan2(dx, dz);
  }

  // Unit ground-plane forward vector for a facing angle.
  function forwardFromAngle(yaw) {
    return [Math.sin(yaw), 0, Math.cos(yaw)];
  }

  // Right vector for a facing angle (90 degrees clockwise from
  // forward when seen from above).
  function rightFromAngle(yaw) {
    return [Math.cos(yaw), 0, -Math.sin(yaw)];
  }

  // Move current toward target by at most maxDelta. Never overshoots.
  function moveToward(current, target, maxDelta) {
    var d = target - current;
    if (Math.abs(d) <= maxDelta) { return target; }
    return current + sign(d) * maxDelta;
  }

  // 2D distance on the ground plane (x, z). y is ignored.
  function dist2(ax, az, bx, bz) {
    var dx = bx - ax;
    var dz = bz - az;
    return Math.sqrt(dx * dx + dz * dz);
  }

  function dist2Sq(ax, az, bx, bz) {
    var dx = bx - ax;
    var dz = bz - az;
    return dx * dx + dz * dz;
  }

  function dist3(ax, ay, az, bx, by, bz) {
    var dx = bx - ax;
    var dy = by - ay;
    var dz = bz - az;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Pick an element from an array. When rng is given it must be a
  // function returning a float in [0, 1); without one the first
  // element is returned so the call stays deterministic.
  function pick(arr, rng) {
    if (!arr || arr.length === 0) { return undefined; }
    if (typeof rng === 'function') {
      return arr[Math.floor(rng() * arr.length)];
    }
    return arr[0];
  }

  function pickIndex(n, rng) {
    if (n <= 0) { return -1; }
    if (typeof rng === 'function') {
      return Math.floor(rng() * n);
    }
    return 0;
  }

  // Clamp a value into a range and return the fraction it sits at.
  function range01(v, lo, hi) {
    return invLerp(lo, hi, v);
  }

  function approxEqual(a, b, eps) {
    return Math.abs(a - b) <= (eps === undefined ? 0.000001 : eps);
  }

  CA.util = {
    TAU: TAU,
    clamp: clamp,
    clamp01: clamp01,
    lerp: lerp,
    invLerp: invLerp,
    smoothstep: smoothstep,
    damp: damp,
    fract: fract,
    deg2rad: deg2rad,
    rad2deg: rad2deg,
    sign: sign,
    angleWrap: angleWrap,
    angleLerp: angleLerp,
    angleDiff: angleDiff,
    headingFromDelta: headingFromDelta,
    forwardFromAngle: forwardFromAngle,
    rightFromAngle: rightFromAngle,
    moveToward: moveToward,
    dist2: dist2,
    dist2Sq: dist2Sq,
    dist3: dist3,
    pick: pick,
    pickIndex: pickIndex,
    range01: range01,
    approxEqual: approxEqual
  };
})();
