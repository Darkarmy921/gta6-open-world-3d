// Cayo Azul — rng.js
// Seeded random generator. The same seed always produces the same
// sequence, so the same seed gives the same city, traffic and mission
// layouts. No Date, no Math.random anywhere in game logic.
// Generators are independent objects: forking one never disturbs
// the parent's sequence.

(function () {
  'use strict';

  window.CA = window.CA || {};
  var CA = window.CA;

  // Mulberry32: a small, well-understood 32-bit seeded generator.
  // Written here from the algorithm's definition, not copied.
  function create(seed) {
    var state = (seed >>> 0) || 1;
    // A zero state would lock the sequence, so force it non-zero.
    if (state === 0) { state = 0x9e3779b9; }
    var spareGauss = null;

    function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      var t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    function range(min, max) {
      return min + next() * (max - min);
    }

    function int(min, max) {
      // Inclusive on both ends.
      return min + Math.floor(next() * (max - min + 1));
    }

    function pick(list) {
      if (!list || list.length === 0) { return undefined; }
      return list[Math.floor(next() * list.length)];
    }

    // Weighted pick: weights[i] is the relative weight of list[i].
    // Zero or negative weights never win; all-zero falls back to
    // a uniform pick so the call still returns something.
    function pickWeighted(list, weights) {
      if (!list || list.length === 0) { return undefined; }
      var total = 0;
      for (var i = 0; i < weights.length; i++) {
        if (weights[i] > 0) { total += weights[i]; }
      }
      if (total <= 0) { return pick(list); }
      var roll = next() * total;
      for (var j = 0; j < list.length; j++) {
        roll -= weights[j] > 0 ? weights[j] : 0;
        if (roll <= 0) { return list[j]; }
      }
      return list[list.length - 1];
    }

    function shuffle(list) {
      // Returns a new array; the input is left untouched.
      var out = list.slice();
      for (var i = out.length - 1; i > 0; i--) {
        var j = Math.floor(next() * (i + 1));
        var tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
      }
      return out;
    }

    function chance(p) {
      return next() < p;
    }

    function bool() {
      return next() < 0.5;
    }

    // Approximately normal value, mean 0, standard deviation 1,
    // via Box-Muller. The second sample is kept for the next call.
    function gauss() {
      if (spareGauss !== null) {
        var s = spareGauss;
        spareGauss = null;
        return s;
      }
      var u = 0, v = 0;
      while (u === 0) { u = next(); }
      v = next();
      var r = Math.sqrt(-2 * Math.log(u));
      var t = 2 * Math.PI * v;
      spareGauss = r * Math.sin(t);
      return r * Math.cos(t);
    }

    function gaussRange(mean, stddev) {
      return mean + gauss() * stddev;
    }

    // A child generator with its own sequence, derived from the
    // next value of this one. Use it for a subsystem (traffic,
    // pedestrians) that must not disturb the parent's sequence.
    function fork() {
      return create(Math.floor(next() * 4294967296));
    }

    function reset(seed) {
      state = (seed >>> 0) || 1;
      if (state === 0) { state = 0x9e3779b9; }
      spareGauss = null;
    }

    return {
      next: next,
      range: range,
      int: int,
      pick: pick,
      pickWeighted: pickWeighted,
      shuffle: shuffle,
      chance: chance,
      bool: bool,
      gauss: gauss,
      gaussRange: gaussRange,
      fork: fork,
      reset: reset,
      // Expose the raw state so a sequence can be checkpointed.
      getState: function () { return state; },
      setState: function (s) { state = (s >>> 0) || 1; spareGauss = null; }
    };
  }

  // Hash a string into a 32-bit seed, so a named seed is stable too.
  function seedFromString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function createFromString(str) {
    return create(seedFromString(str));
  }

  CA.rng = {
    create: create,
    seedFromString: seedFromString,
    createFromString: createFromString
  };
})();
