// radio.js — Cayo Azul radio: six procedural stations.
// Music is synthesized live: each station has its own chord set, bass
// pattern and lead character, played on a loop that changes every few
// bars. No audio file is loaded. The talk station speaks in text
// banners (invented local news) instead of sung notes.
// Switch with CA.radio.next() / prev() or setStation(i); the current
// station name is read by the HUD from CA.radio.currentName().
// Revision notes: dt is clamped so a tab switch cannot fire a burst
// of bars at once; every fourth bar the lead plays an octave higher
// for variation; the talk station announces a headline immediately
// on switch; stations are also reachable by id, and the bar/beat
// position is exposed for the HUD and for tests.
(function () {
  'use strict';
  var CA = window.CA || (window.CA = {});
  if (!CA.state) CA.state = {};
  if (!CA.state.settings) CA.state.settings = { volume: 0.8, radioStation: 0, muted: false };
  if (typeof CA.state.settings.radioStation !== 'number') CA.state.settings.radioStation = 0;
  if (!CA.state.listenedStations) CA.state.listenedStations = [];

  // Chord tones are plain frequencies in Hz. Each station cycles its
  // chords one per bar; the bass walks the chord roots.
  var STATIONS = [
    {
      id: 'sol-azul', name: 'Sol Azul FM', desc: 'Sun-soaked pop',
      tempo: 112, wave: 'triangle',
      chords: [[261.63, 329.63, 392.0], [196.0, 246.94, 293.66], [220.0, 277.18, 329.63], [246.94, 293.66, 392.0]],
      bass: [130.81, 98.0, 110.0, 123.47],
      leadSteps: [0, 2, 1, 2, 0, 1, 2, 1]
    },
    {
      id: 'breakwater', name: 'Breakwater Rock', desc: 'Harbour rock',
      tempo: 128, wave: 'sawtooth',
      chords: [[164.81, 207.65, 246.94], [146.83, 185.0, 220.0], [196.0, 246.94, 293.66], [164.81, 207.65, 246.94]],
      bass: [82.41, 73.42, 98.0, 82.41],
      leadSteps: [0, 0, 2, 1, 2, 0, 1, 1]
    },
    {
      id: 'midnight-drive', name: 'Midnight Drive', desc: 'Night-drive synth',
      tempo: 96, wave: 'square',
      chords: [[110.0, 130.81, 164.81], [87.31, 110.0, 130.81], [98.0, 123.47, 146.83], [82.41, 98.0, 123.47]],
      bass: [55.0, 43.65, 49.0, 41.2],
      leadSteps: [2, 1, 2, 0, 1, 2, 1, 0]
    },
    {
      id: 'salsa-puerto', name: 'Salsa del Puerto', desc: 'Salsa',
      tempo: 140, wave: 'triangle',
      chords: [[220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66], [146.83, 220.0, 277.18]],
      bass: [110.0, 87.31, 98.0, 73.42],
      leadSteps: [0, 1, 2, 1, 0, 2, 1, 2]
    },
    {
      id: 'cayo-talk', name: 'Radio Cayo Talk', desc: 'Invented local news',
      tempo: 100, wave: 'sine', talk: true,
      chords: [[220.0, 277.18, 329.63]],
      bass: [110.0],
      leadSteps: [0],
      headlines: [
        'Harbour cafe reports record morning trade as fishing boats return early.',
        'Ring road resurfacing finishes ahead of schedule, drivers rejoice.',
        'Marina festival announces fireworks over the water this weekend.',
        'Old Fort tours reopen after the spring restoration work.',
        'Coral Beach lifeguards remind swimmers to watch the afternoon tide.'
      ]
    },
    {
      id: 'azul-clasica', name: 'Azul Clasica', desc: 'Classical',
      tempo: 84, wave: 'sine',
      chords: [[261.63, 329.63, 392.0], [220.0, 277.18, 329.63], [174.61, 220.0, 261.63], [196.0, 246.94, 293.66]],
      bass: [130.81, 110.0, 87.31, 98.0],
      leadSteps: [0, 1, 2, 1, 2, 1, 0, 1]
    }
  ];

  var current = CA.state.settings.radioStation || 0;
  if (current < 0 || current >= STATIONS.length) current = 0;
  var playing = false;
  var barTimer = 0;
  var barIndex = 0;
  var barCount = 0;
  var beatTimer = 0;
  var beatIndex = 0;
  var headlineIndex = 0;
  var headlineTimer = 0;
  var lastHeadline = '';

  function station() { return STATIONS[current]; }

  function stationById(id) {
    for (var i = 0; i < STATIONS.length; i++) if (STATIONS[i].id === id) return STATIONS[i];
    return null;
  }

  function markListened() {
    var id = station().id;
    if (CA.state.listenedStations.indexOf(id) < 0) {
      CA.state.listenedStations.push(id);
      if (CA.achievements) CA.achievements.check('all-stations');
    }
  }

  function announceHeadline() {
    var st = station();
    if (!st.talk) return;
    lastHeadline = st.headlines[headlineIndex % st.headlines.length];
    headlineIndex = (headlineIndex + 1) % st.headlines.length;
    headlineTimer = 0;
    if (CA.hud) CA.hud.toast('Radio Cayo: ' + lastHeadline);
  }

  function setStation(i) {
    if (typeof i !== 'number') return;
    var n = STATIONS.length;
    current = ((Math.floor(i) % n) + n) % n;
    CA.state.settings.radioStation = current;
    barTimer = 0;
    barIndex = 0;
    beatTimer = 0;
    beatIndex = 0;
    markListened();
    if (CA.audio) CA.audio.radioClick();
    if (CA.hud) CA.hud.toast(station().name + ' — ' + station().desc);
    if (station().talk) announceHeadline();
  }

  function setStationById(id) {
    for (var i = 0; i < STATIONS.length; i++) {
      if (STATIONS[i].id === id) { setStation(i); return true; }
    }
    return false;
  }

  function next() { setStation(current + 1); }
  function prev() { setStation(current - 1); }

  function start() {
    playing = true;
    markListened();
    if (CA.audio) CA.audio.resume();
  }

  function stop() { playing = false; }

  function barLength() {
    return 4 * (60 / station().tempo);
  }

  function beatLength() {
    return 60 / station().tempo;
  }

  function playChord(chord, dur, vol) {
    if (!CA.audio || !CA.audio.blip) return;
    for (var i = 0; i < chord.length; i++) {
      CA.audio.blip(chord[i], chord[i], dur, station().wave, vol);
    }
  }

  function playBass(freq, dur) {
    if (!CA.audio || !CA.audio.blip) return;
    CA.audio.blip(freq, freq, dur, 'sine', 0.22);
  }

  function playLead(freq, dur, octaveUp) {
    if (!CA.audio || !CA.audio.blip) return;
    var f = octaveUp ? freq * 4 : freq * 2;
    CA.audio.blip(f, f, dur, station().wave, 0.1);
  }

  function tickTalk(dt) {
    headlineTimer += dt;
    if (headlineTimer > 9) announceHeadline();
    // A soft bed under the talk so the station is never silent.
    beatTimer += dt;
    if (beatTimer >= beatLength() * 2) {
      beatTimer = 0;
      playChord(station().chords[0], beatLength() * 1.8, 0.05);
    }
  }

  function update(dt) {
    if (!playing) return;
    if (dt <= 0) return;
    if (dt > 0.25) dt = 0.25;
    var st = station();
    if (st.talk) { tickTalk(dt); return; }
    var barLen = barLength();
    var beatLen = beatLength();
    barTimer += dt;
    beatTimer += dt;
    if (barTimer >= barLen) {
      barTimer -= barLen;
      barIndex = (barIndex + 1) % st.chords.length;
      barCount++;
      playChord(st.chords[barIndex], barLen * 0.9, 0.09);
      playBass(st.bass[barIndex], barLen * 0.9);
    }
    if (beatTimer >= beatLen) {
      beatTimer -= beatLen;
      beatIndex = (beatIndex + 1) % 8;
      var step = st.leadSteps[beatIndex % st.leadSteps.length];
      var chord = st.chords[barIndex];
      var note = chord[step % chord.length];
      // Every fourth bar the lead jumps an octave so the loop breathes.
      var octaveUp = (barCount % 4 === 3) && (beatIndex % 2 === 0);
      if (beatIndex % 2 === 0) playLead(note, beatLen * 0.8, octaveUp);
      if (beatIndex % 4 === 0) playBass(st.bass[barIndex] / 2, beatLen);
    }
  }

  CA.radio = {
    stations: STATIONS,
    get current() { return current; },
    currentStation: station,
    stationById: stationById,
    currentName: function () { return station().name; },
    currentDesc: function () { return station().desc; },
    isTalkStation: function () { return !!station().talk; },
    setStation: setStation,
    setStationById: setStationById,
    next: next,
    prev: prev,
    start: start,
    stop: stop,
    update: update,
    isPlaying: function () { return playing; },
    lastHeadline: function () { return lastHeadline; },
    barIndex: function () { return barIndex; },
    beatIndex: function () { return beatIndex; },
    listenedCount: function () { return CA.state.listenedStations.length; }
  };
})();
