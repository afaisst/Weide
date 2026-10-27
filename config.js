'use strict';
/*
 * Weide – tuning.
 *
 * Change the numbers here, save, and reload the page.
 * Both the game (game.js) and the help page (help.html) read these values,
 * so the "detailed gameplay" page always shows what you set here.
 * Distances are in pixels (the pasture is 960 x 640), times in seconds.
 */
window.WEIDE = (() => {
  const CFG = {
    dog:   {
      r: 11, speed: 190,
      staminaDrain: 6,       // % per second when running at full speed
      staminaRecover: 6,     // % per second when standing still
      tiredAt: 30, tiredSpeed: 0.7,          // below 30% stamina: 70% speed
      exhaustedAt: 10, exhaustedSpeed: 0.45, // below 10% stamina: 45% speed
    },
    sheep: {
      r: 10,
      dogRadius: 130,        // sheep start to move away from the dog inside this distance
      wolfRadius: 170,       // ... and panic when a wolf is this close
      maxSpeed: 100,         // slower than the wolf (125)!
      grazeSpeed: 22,        // walking speed when roaming on their own
      grazePause: 0.3,       // chance to stand still for a while (off the grass)
      eatRate: 5,            // food % per second while grazing
      panicSpread: 1.8,      // radians: how randomly sheep scatter when a wolf is near
      hungerMin: 10,         // health loss (%) over night if not fully fed
      hungerMax: 30,
      recoverMin: 5,         // health gain (%) over night if fully fed
      recoverMax: 25,
      grassAttract: 50,      // calm sheep this close to a grass patch walk onto it and stay
      coldNight: 5,          // health % lost by a sheep that stays outside the whole night
      homeRadius: 110,       // evening/night: sheep this close to the door walk in by themselves
    },
    wolf:  { r: 12, speed: 125, fleeSpeed: 165, fearRadius: 150, courage: 4, eatTime: 2.5,
             attackRange: 100,  // a wolf this close to the dog may turn on it ...
             attackChance: 0.3, // ... with this chance per second (night: x1.5)
             dogBite: 15,       // stamina % the dog loses per bite
             biteRate: 45 }, // health % per second a wolf takes from a sheep it touches
    pack:  { randomness: 0.2, dayFraction: 0.5, stagger: [2, 4] },
    bowl: { food: 100, rate: 3, reach: 16, wolfSmell: 120 }, // wolves close to the bowl eat from it too // dog food bowl: refills stamina 3x faster than resting
    obstacles: { trees: [3, 5], rocks: [3, 6], lakes: [1, 3], wolfSeesHidden: 55 }, // wolves only spot sheep under a tree up close
    fastForward: 4,          // speed multiplier while 'F' is on (daytime only)
    grass: { surplus: 1.3, minPatches: 3, maxPatches: 6, winterFactor: 0.85 }, // food in winter (0.85 = 15% less)
    summer: { dogDrain: 1.15 },                   // hot: the dog tires 15% faster
    winter: { dayDrain: 0.08, eveningDrain: 1.0, nightDrain: 1.5, // health % per second for sheep outside
              gloom: 0.2,    // winter days are never fully bright
              sheepSlow: [0.85, 0.9],    // sheep move 10-15% slower in winter (random per sheep)
              // snowfall, picked at random every winter day: none / light / moderate / heavy
              snowChance: [0.3, 0.35, 0.25, 0.1],   // chance of each kind of day
              snowFlakes: [0, 45, 110, 230] },      // number of snowflakes for each kind
  };

  // Seasons change every 3 days. All times are clock hours.
  //   morning: [starts getting light, full daylight]
  //   evening: [starts getting dark, fully dark]     night: nightfall, the wolves come
  const SEASONS = [
    { name: 'Spring', color: '#a8e07a', morning: [6, 8],  evening: [19, 21], night: 21 },
    { name: 'Summer', color: '#ffd34d', morning: [5, 7],  evening: [21, 23], night: 22 },
    { name: 'Fall',   color: '#f0a040', morning: [6, 8],  evening: [19, 21], night: 21 },
    { name: 'Winter', color: '#bfe3ff', morning: [7, 10], evening: [15, 18], night: 18 },
  ];
  // The sheep come out at 5:30, the day ends at midnight.
  // Real seconds per clock hour: day and night run at different speeds.
  const CLOCK = { start: 5.5, end: 24, daySecPerHour: 5.5, nightSecPerHour: 7, seasonDays: 3 };

  return { CFG, SEASONS, CLOCK };
})();
