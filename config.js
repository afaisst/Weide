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
      name: 'Barry',         // the dog's name (on its hut; the farmer calls it that too)
      r: 11, speed: 190,
      staminaDrain: 6,       // % per second when running at full speed
      staminaRecover: 6,     // % per second when standing still
      tiredAt: 30, tiredSpeed: 0.7,          // below 30% stamina: 70% speed
      exhaustedAt: 10, exhaustedSpeed: 0.45, // below 10% stamina: 45% speed
      emptySpeed: 0.25,                      // no stamina left at all: 25% speed
      // barking (key W or the WOOF button): for a moment the dog reaches further
      barkTime: 2,           // seconds a bark lasts
      barkCooldown: 2.5,     // seconds until it can bark again
      barkSheep: 1.6,        // sheep move away from up to dogRadius x this
      barkWolf: 1.8,         // wolves keep away from up to fearRadius x this, and don't attack the dog
    },
    sheep: {
      r: 10,
      dogRadius: 100,        // sheep start to move away from the dog inside this distance
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
      grassSeek: 300,        // by day, hungry calm sheep slowly walk to grass this close (not across streams)
      coldNight: 5,          // health % lost by a sheep that stays outside the whole night
      parkRadius: 130,       // fully fed sheep this close to the stable wait there (and go in at evening)
      lambSize: 0.5,         // newborn lambs are half the size of a grown sheep (for their first day)
      lambFood: 0.75,        // ... and need only 75% of an adult's food to be full
      matureNights: 2,       // a lamb can have lambs itself from its 2nd night on (small 1st day, grown 2nd day)
    },
    wolf:  { r: 12, speed: 125, fleeSpeed: 165, fearRadius: 150, courage: 4, eatTime: 2.5,
             attackRange: 100,  // a wolf this close to the dog may turn on it ...
             attackChance: 0.3, // ... with this chance per second (night: x1.5)
             dogBite: 15,       // stamina % the dog loses per bite
             biteRate: 45 }, // health % per second a wolf takes from a sheep it touches
    // wolves per night = perSheep x sheep^power  (power 0.5 = square root: 4 sheep -> 2, 9 -> 3, 16 -> 4, 25 -> 5)
    //   then x (1 + wolf setting), randomly +/- randomness, at least 1
    pack:  { perSheep: 1, power: 0.5, randomness: 0.2,
             dayChance: 0.4,     // chance that a pack also comes during the day (from day 2 on)
             dayFraction: 0.5,   // a day pack is this share of the night pack
             stagger: [2, 4] },
    bowl: { food: 100, rate: 3, reach: 16, wolfSmell: 120 }, // wolves close to the bowl eat from it too // dog food bowl: refills stamina 3x faster than resting
    obstacles: { trees: [3, 5], rocks: [3, 6], lakes: [1, 3], wolfSeesHidden: 55 }, // wolves only spot sheep under a tree up close
    // streams near the corners, each with a wooden bridge
    streams: { count: [1, 2], width: [18, 24],
               cutOff: [0.15, 0.25],  // share of the pasture behind the streams (all streams together)
               sheepSpeed: 0.35, dogSpeed: 0.6, wolfSpeed: 0.6,   // speed while wading through the water
               patchAcross: 0.6 },   // chance that a grass patch grows on the far side of a stream
    // the farmer's tractor: on some days the gate opens and it parks along the stable
    tractor: { daysPerSeason: 2,  // tractor days per season: the farmer has 2 jobs per season (0 = never)
               arrive: 6.5,       // clock hour it drives in
               leaveEarly: 1.5,   // leaves this many hours before evening starts
               speed: 40,         // driving speed (backs out slower)
               scareRadius: 60,   // a moving tractor scares sheep this close
               wolfFear: 110 },   // wolves keep this far away from the tractor
    // the farmer who comes with the tractor
    farmer: { speed: 35,          // walking speed
              sheepRadius: 50,    // sheep make way for him
              wolfFear: 120,      // wolves keep this far away from him
              petRadius: 32,      // the dog this close gets a pat (and wags its tail)
              walkBack: 1,        // starts walking back to the tractor this many hours before it leaves
              shovelSpeed: 40,    // winter: how fast he shovels the snow off the patio (px per second)
              rakeSpeed: 30,      // fall: how fast he rakes the leaves off the patio (px per second)
              mowSpeed: 26,       // summer: how fast he mows the lawn next to the patio (px per second)
              appleRadius: 360,   // fall: apple trees this close to the stable get picked (at most 3)
              pickTime: 4 },      // fall: seconds to pick one apple tree
    // fall: thick fog on some mornings
    fog: { daysPerSeason: 1,   // foggy mornings per fall (of the 3 days)
           thick: 0.8,         // how thick it is in the early morning (0 .. 1)
           thickUntil: 7.5,    // stays thick until this hour ...
           clearBy: 13,        // ... then thins out and is gone by this hour
           clearView: 90 },    // you can see a bit within this distance around the dog
    // winter: on one day of a winter there may be a blizzard (all day)
    blizzard: { chance: 0.8,     // chance that a winter has a blizzard day
                cold: 3,         // sheep outside get cold this many times faster
                sheepSlow: 0.8,  // sheep outside move at this speed (x the winter speed)
                dogSlow: 0.85,   // the dog runs at this speed
                whiteout: 0.5,   // how much the blowing snow hides the pasture (0 .. 1)
                clearView: 90 }, // you see a bit within this distance around the dog
    fastForward: 4,          // speed multiplier while 'F' is on (daytime only)
    grass: { surplus: 1.3, minPatches: 3, maxPatches: 6, winterFactor: 0.85 }, // food in winter (0.85 = 15% less)
    summer: { dogDrain: 1.15 },                   // hot: the dog tires 15% faster
    winter: { dayDrain: 0.08, eveningDrain: 1.0, nightDrain: 1.5, // health % per second for sheep outside
              gloom: 0.35,    // winter days are never fully bright
              snowDark: [0, 0.17, 0.24, 0.5],  // extra darkness while it snows (none / light / moderate / heavy)
              sheepSlow: [0.85, 0.9],    // sheep move 10-15% slower in winter (random per sheep)
              // snowfall, picked at random every winter day: none / light / moderate / heavy
              snowChance: [0.15, 0.25, 0.25, 0.3],   // chance of each kind of day
              snowFlakes: [0, 45, 150, 300] },      // number of snowflakes for each kind
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
  const CLOCK = { start: 5.0, end: 24, daySecPerHour: 7, nightSecPerHour: 7, seasonDays: 3 };

  return { CFG, SEASONS, CLOCK };
})();
