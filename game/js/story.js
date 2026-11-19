(function () {
  'use strict';

  var CA = window.CA || (window.CA = {});

  function state() {
    if (!CA.state) { CA.state = {}; }
    if (!CA.state.storyFlags) { CA.state.storyFlags = {}; }
    if (!CA.state.storyFlags.missionsDone) { CA.state.storyFlags.missionsDone = []; }
    if (!CA.state.storyFlags.charactersMet) { CA.state.storyFlags.charactersMet = []; }
    if (!CA.state.storyFlags.callsHeard) { CA.state.storyFlags.callsHeard = []; }
    if (typeof CA.state.storyFlags.finished !== 'boolean') { CA.state.storyFlags.finished = false; }
    return CA.state;
  }

  function pushUnique(list, value) {
    if (list.indexOf(value) === -1) { list.push(value); }
  }

  function markMet(name) {
    if (!name) { return; }
    pushUnique(state().storyFlags.charactersMet, name);
  }

  function markMissionDone(id) {
    if (typeof id !== 'number') { return; }
    pushUnique(state().storyFlags.missionsDone, id);
  }

  function markCallHeard(id) {
    if (typeof id !== 'number') { return; }
    pushUnique(state().storyFlags.callsHeard, id);
  }

  var CHARACTERS = {
    dario: {
      id: 'dario', name: 'Dario Venn',
      role: 'Driver, new to Cayo Azul',
      line: 'I came here with a borrowed car and a full tank. That is the whole plan.'
    },
    ilsa: {
      id: 'ilsa', name: 'Ilsa Crane',
      role: 'Runs the harbour cafe that fronts for the neighbourhood',
      line: 'The cafe feeds the harbour. The harbour feeds everyone else. Remember the order.'
    },
    silas: {
      id: 'silas', name: 'Silas Vane',
      role: 'Leads The Breakers, who want the harbour trade',
      line: 'The harbour was never yours, Ilsa. It was only ever waiting for someone stronger.'
    },
    mara: {
      id: 'mara', name: 'Mara Solis',
      role: 'Harbour mechanic, fixes anything with wheels',
      line: 'Bring it back in one piece and I will not charge you for the lecture.'
    },
    tico: {
      id: 'tico', name: 'Tico Reyes',
      role: 'Market runner, knows every shortcut on the island',
      line: 'Shortcuts are only shortcuts if you know where the police are not.'
    },
    officer: {
      id: 'officer', name: 'Officer Lena Frost',
      role: 'Harbour patrol officer who watches both crews',
      line: 'I do not care who runs the harbour. I care who makes my shift longer.'
    },
    ferry: {
      id: 'ferry', name: 'Captain Rosa Hale',
      role: 'Runs the Marina ferry, keeps its timetable',
      line: 'The ferry waits for no one, driver. Not even for a good story.'
    }
  };

  var TITLES = {
    1: 'First Fare',
    2: 'Heat on the Ring Road',
    3: 'Two Districts, One Clock',
    4: 'The Ambush at Palm Row',
    5: 'Five Stops, No Excuses',
    6: 'The Harbour Heist',
    7: 'Night on the Ring Road',
    8: 'The Convoy and the Choice'
  };

  var BRIEFINGS = {
    1: {
      id: 1, title: 'First Fare', giver: 'Ilsa Crane', reward: 750,
      text: 'You are new, so we start small. Take this crate from the cafe to the market stall in Old Town. Drive like the island is watching, because it is.',
      hint: 'Get in a car and follow the marker. A delivery is only late if you crash.'
    },
    2: {
      id: 2, title: 'Heat on the Ring Road', giver: 'Ilsa Crane', reward: 1500,
      text: 'The Breakers sent a driver to scare our couriers off the ring road. Chase him down and make him stop. Expect the police to notice. That is the lesson.',
      hint: 'Ram the marked car until it stops. Then lose the police before you come home.'
    },
    3: {
      id: 3, title: 'Two Districts, One Clock', giver: 'Tico Reyes', reward: 2500,
      text: 'A parcel is waiting at the University and it has to reach the Marina before the ferry leaves. Two districts, one clock, no excuses. Tico drew you the fast route.',
      hint: 'Pick up the parcel, then drive to the Marina before the timer runs out.'
    },
    4: {
      id: 4, title: 'The Ambush at Palm Row', giver: 'Mara Solis', reward: 3750,
      text: 'The Breakers are waiting on Palm Row and they are not there to talk. Hold your ground, stay on your feet, and do not let them take the van.',
      hint: 'Survive the ambush until the timer ends. Keep moving so they cannot corner you.'
    },
    5: {
      id: 5, title: 'Five Stops, No Excuses', giver: 'Ilsa Crane', reward: 5000,
      text: 'Five shops owe us, five shops pay today. Collect from each one, in any order you like, and bring it all back to the cafe. The police will be watching the harbour by now.',
      hint: 'Visit every marked stop. Heat rises with each collection, so plan a quiet route back.'
    },
    6: {
      id: 6, title: 'The Harbour Heist', giver: 'Ilsa Crane', reward: 7000,
      text: 'Silas keeps his ledger in a warehouse on the Docks. Take it. Quietly if you can, loudly if you must. Then get out along the water and do not stop until the cafe lights are behind you.',
      hint: 'Steal the ledger from the warehouse, then reach the getaway point at the harbour.'
    },
    7: {
      id: 7, title: 'Night on the Ring Road', giver: 'Tico Reyes', reward: 9000,
      text: 'One race, one lap of the ring road, at night, against the best driver The Breakers have. Win and the island stops laughing at us. Lose and we pay for it in respect.',
      hint: 'Hit every checkpoint before the rival does. Night rain makes the road loose.'
    },
    8: {
      id: 8, title: 'The Convoy and the Choice', giver: 'Ilsa Crane', reward: 12000,
      text: 'Silas is moving his whole crew off the island in one convoy, and the harbour is the price. Chase the convoy down, stop Vane, and then decide what the harbour becomes.',
      hint: 'Chase the convoy across the island, stop the lead car, then make your choice.'
    }
  };

  var DIALOGUE = {
    1: [
      { stage: 0, speaker: 'Ilsa Crane', line: 'Crate is by the back door. Old Town market stall, the one with the blue awning.' },
      { stage: 1, speaker: 'Dario Venn', line: 'Blue awning. Got it. I will not keep them waiting.' },
      { stage: 2, speaker: 'Ilsa Crane', line: 'Good. First fare done clean and the harbour starts to trust you.' }
    ],
    2: [
      { stage: 0, speaker: 'Ilsa Crane', line: 'That is the Breakers driver, the grey sedan. Do not let him out of your sight.' },
      { stage: 1, speaker: 'Dario Venn', line: 'He is fast, but he keeps looking back. Nervous drivers make mistakes.' },
      { stage: 2, speaker: 'Officer Lena Frost', line: 'Slow down, both of you. This is your one warning, driver.' },
      { stage: 3, speaker: 'Ilsa Crane', line: 'You lost them. Now come home quiet and park like you were never out.' }
    ],
    3: [
      { stage: 0, speaker: 'Tico Reyes', line: 'Parcel is at the University gate. Ferry leaves the Marina in minutes, so move.' },
      { stage: 1, speaker: 'Dario Venn', line: 'University to Marina, straight through the centre. I know the route.' },
      { stage: 1, speaker: 'Captain Rosa Hale', line: 'Ferry leaves on the minute, driver. I will hold the rope for thirty seconds, no more.' },
      { stage: 2, speaker: 'Tico Reyes', line: 'You made it with time to spare. The ferry captain owes me a favour now.' }
    ],
    4: [
      { stage: 0, speaker: 'Mara Solis', line: 'They are coming from both ends of the street. Do not let them box you in.' },
      { stage: 1, speaker: 'Dario Venn', line: 'I count four. The van is still mine and it is staying mine.' },
      { stage: 2, speaker: 'Mara Solis', line: 'They are pulling back. You held the street, Dario. That matters here.' }
    ],
    5: [
      { stage: 0, speaker: 'Ilsa Crane', line: 'Five stops. Start anywhere, finish at the cafe. And Dario, count it twice.' },
      { stage: 1, speaker: 'Dario Venn', line: 'One down. The shopkeeper tried to short me and thought better of it.' },
      { stage: 2, speaker: 'Dario Venn', line: 'Three down. The harbour is paying attention now, I can feel it.' },
      { stage: 3, speaker: 'Officer Lena Frost', line: 'That is a lot of envelopes for one afternoon, Venn. Keep driving like you have somewhere legal to be.' },
      { stage: 4, speaker: 'Ilsa Crane', line: 'Last one. Bring it home and the harbour eats well tonight.' }
    ],
    6: [
      { stage: 0, speaker: 'Ilsa Crane', line: 'The ledger is in the back office, second floor. In and out, no sightseeing.' },
      { stage: 1, speaker: 'Dario Venn', line: 'Got it. It is heavier than it looks. That means it is worth something.' },
      { stage: 2, speaker: 'Silas Vane', line: 'You stole from me in my own warehouse. The harbour will remember this, Venn.' }
    ],
    7: [
      { stage: 0, speaker: 'Tico Reyes', line: 'One lap, ring road, night. The rival is already revving. Do not let him set the pace.' },
      { stage: 1, speaker: 'Dario Venn', line: 'First corner done. He braked early, I did not. That tells me everything.' },
      { stage: 2, speaker: 'Dario Venn', line: 'Halfway and I can see his tail lights. He is starting to worry.' },
      { stage: 3, speaker: 'Tico Reyes', line: 'Final stretch. The whole island is watching this corner, Dario.' }
    ],
    8: [
      { stage: 0, speaker: 'Silas Vane', line: 'You want the harbour? Come and take it from a moving convoy, driver.' },
      { stage: 1, speaker: 'Dario Venn', line: 'Two cars down. Vane is in the lead car and he is running out of road.' },
      { stage: 2, speaker: 'Ilsa Crane', line: 'It is over, Silas. Now Dario decides what the harbour becomes.' }
    ]
  };

  var CALLS = {
    1: { id: 1, afterMission: 1, caller: 'Ilsa Crane', text: 'First fare, clean and on time. The cafe regulars are already asking your name. Come by tomorrow, there is more work.' },
    2: { id: 2, afterMission: 2, caller: 'Mara Solis', text: 'I saw the chase from the garage roof. Your car needs new paint and you need a better excuse. Bring it by, I will fix the paint.' },
    3: { id: 3, afterMission: 3, caller: 'Tico Reyes', text: 'Ferry made it, parcel made it, and nobody got arrested. You drive like you grew up here. Call me when you need a route.' },
    4: { id: 4, afterMission: 4, caller: 'Ilsa Crane', text: 'Palm Row is quiet tonight because of you. The Breakers will try something bigger next. Rest, then come see me.' },
    5: { id: 5, afterMission: 5, caller: 'Officer Lena Frost', text: 'Five stops in one afternoon is a lot of driving, Venn. I am not accusing you of anything. I am telling you I am watching.' },
    6: { id: 6, afterMission: 6, caller: 'Silas Vane', text: 'You have my ledger, driver. Keep it. Read it. Then ask yourself who Ilsa really works for. We will talk soon.' },
    7: { id: 7, afterMission: 7, caller: 'Tico Reyes', text: 'You beat their best driver on their best road. The ring road is yours now, Dario. The whole island saw it.' },
    8: { id: 8, afterMission: 8, caller: 'Ilsa Crane', text: 'It is done. Whatever you choose next, the harbour chose you first. Come home to the cafe.' }
  };

  var ENDINGS = {
    harbour: {
      id: 'harbour', title: 'Harbour Keeper', choiceLabel: 'Keep the harbour open to everyone',
      text: 'Dario hands the ledger to Ilsa and keeps the harbour open to everyone. The cafe stays busy, the boats keep coming, and The Breakers leave Cayo Azul to find easier water. Dario Venn, the driver who arrived with nothing, becomes the harbour keeper.',
      epilogue: 'The harbour belongs to the neighbourhood. That was always the deal.'
    },
    crown: {
      id: 'crown', title: 'King of Cayo Azul', choiceLabel: 'Keep the ledger and take the harbour trade',
      text: 'Dario keeps the ledger and takes the harbour trade for himself. Silas Vane leaves the island, Ilsa Crane closes the cafe door behind him, and the harbour learns a new name. Dario Venn arrived with nothing and now owns the water he drives beside.',
      epilogue: 'Every harbour needs a keeper. This one just got a king.'
    }
  };

  function briefing(id) {
    var b = BRIEFINGS[id];
    if (!b) { return null; }
    markMet(b.giver);
    return { id: b.id, title: b.title, giver: b.giver, reward: b.reward, text: b.text, hint: b.hint };
  }

  function allBriefings() {
    var out = [];
    var id;
    for (id = 1; id <= 8; id++) { out.push(briefing(id)); }
    return out;
  }

  function nextBriefing() {
    var done = state().storyFlags.missionsDone;
    var id;
    for (id = 1; id <= 8; id++) {
      if (done.indexOf(id) === -1) { return briefing(id); }
    }
    return null;
  }

  function title(id) { return TITLES[id] || ('Mission ' + id); }

  function character(id) {
    return CHARACTERS[id] || null;
  }

  function characterByName(name) {
    var key;
    for (key in CHARACTERS) {
      if (CHARACTERS[key].name === name) { return CHARACTERS[key]; }
    }
    return null;
  }

  // Revision: fall back to the nearest EARLIER stage line, not the last
  // line in the mission. A stage-3 lookup in a mission whose lines stop
  // at stage 1 now returns the stage-1 line, which is still in context.
  function dialogueFor(missionId, stage) {
    var lines = DIALOGUE[missionId] || [];
    var out = [];
    var i;
    for (i = 0; i < lines.length; i++) {
      if (lines[i].stage === stage) { out.push(lines[i]); }
    }
    if (out.length > 0) { return out; }
    var best = null;
    for (i = 0; i < lines.length; i++) {
      if (lines[i].stage <= stage && (!best || lines[i].stage > best.stage)) { best = lines[i]; }
    }
    if (best) { return [best]; }
    return lines.length > 0 ? [lines[0]] : [];
  }

  function dialogueLine(missionId, stage) {
    var lines = dialogueFor(missionId, stage);
    return lines.length > 0 ? lines[0] : null;
  }

  function allDialogue(missionId) {
    return (DIALOGUE[missionId] || []).slice();
  }

  function phoneCall(afterMissionId) {
    var c = CALLS[afterMissionId];
    if (!c) { return null; }
    markCallHeard(c.id);
    markMet(c.caller);
    return { id: c.id, afterMission: c.afterMission, caller: c.caller, text: c.text };
  }

  function allCalls() {
    var out = [];
    var id;
    for (id = 1; id <= 8; id++) { out.push(CALLS[id]); }
    return out;
  }

  function ending(choice) {
    var e = ENDINGS[choice];
    if (!e) { return null; }
    var s = state();
    s.storyFlags.ending = e.id;
    s.storyFlags.finished = true;
    return { id: e.id, title: e.title, choiceLabel: e.choiceLabel, text: e.text, epilogue: e.epilogue };
  }

  function endingChoices() {
    return [ENDINGS.harbour, ENDINGS.crown];
  }

  function progress() {
    var s = state();
    return {
      missionsDone: s.storyFlags.missionsDone.slice(),
      doneCount: s.storyFlags.missionsDone.length,
      totalMissions: 8,
      charactersMet: s.storyFlags.charactersMet.slice(),
      callsHeard: s.storyFlags.callsHeard.slice(),
      finished: !!s.storyFlags.finished,
      ending: s.storyFlags.ending || null,
      nextMission: nextBriefing() ? nextBriefing().id : null
    };
  }

  function intro() {
    return 'Dario Venn arrives on Cayo Azul with a borrowed car and a full tank. Ilsa Crane offers him work at her harbour cafe, and The Breakers, led by Silas Vane, want the harbour trade for themselves.';
  }

  function summary() {
    var p = progress();
    return intro() + ' Missions done: ' + p.doneCount + ' of 8.' +
      (p.finished ? ' Ending: ' + (ENDINGS[p.ending] ? ENDINGS[p.ending].title : 'none') + '.' : '');
  }

  CA.story = {
    characters: CHARACTERS,
    titles: TITLES,
    briefings: BRIEFINGS,
    dialogue: DIALOGUE,
    calls: CALLS,
    endings: ENDINGS,
    intro: intro,
    summary: summary,
    briefing: briefing,
    allBriefings: allBriefings,
    nextBriefing: nextBriefing,
    title: title,
    character: character,
    characterByName: characterByName,
    dialogueFor: dialogueFor,
    dialogueLine: dialogueLine,
    allDialogue: allDialogue,
    phoneCall: phoneCall,
    allCalls: allCalls,
    ending: ending,
    endingChoices: endingChoices,
    progress: progress,
    markMissionDone: markMissionDone,
    markMet: markMet,
    isMissionDone: function (id) { return state().storyFlags.missionsDone.indexOf(id) !== -1; },
    hasMet: function (name) { return state().storyFlags.charactersMet.indexOf(name) !== -1; },
    hasHeardCall: function (id) { return state().storyFlags.callsHeard.indexOf(id) !== -1; },
    flags: function () { return state().storyFlags; }
  };
})();
