'use strict';
/*
 * Weide – a small sheep herding game.
 *
 * Click (or click-and-drag) on the pasture to move the dog.
 * Sheep run away from the dog, so you can push them around.
 * Herd the sheep onto grass patches so they can eat during the day.
 * Bring all sheep into the stable before night, when the wolves come.
 * A fed ram (male, grey) and a fed ewe (female, white) produce a lamb overnight.
 */
(() => {
  // ---------------------------------------------------------------------------
  // Canvas & sizing
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const HUD = 44;            // height of the status bar on top
  const FW = 960, FH = 640;  // pasture (field) size in game units
  const CW = FW, CH = FH + HUD;
  let pxScale = 1;           // game units -> device pixels

  function fit() {
    const s = Math.min((window.innerWidth - 16) / CW, (window.innerHeight - 16) / CH);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = Math.floor(CW * s) + 'px';
    canvas.style.height = Math.floor(CH * s) + 'px';
    canvas.width = Math.round(CW * s * dpr);
    canvas.height = Math.round(CH * s * dpr);
    pxScale = canvas.width / CW;
  }
  window.addEventListener('resize', fit);
  fit();

  // ---------------------------------------------------------------------------
  // Tuning: all numbers live in config.js (shared with the help page)
  // ---------------------------------------------------------------------------
  const { CFG, SEASONS, CLOCK } = window.WEIDE;

  // Values changed on the help page ("detailed gameplay") are stored in the browser
  // and applied on top of config.js. An open help page also sends changes live.
  const CFG_ROOT = { CFG, SEASONS, CLOCK };
  const CFG_DEFAULTS = JSON.parse(JSON.stringify(CFG_ROOT));
  const CFG_KEY = 'weide.config';
  let customSettings = 0;   // how many values differ from config.js
  function cfgGet(root, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), root);
  }
  function cfgSet(path, value) {
    const def = cfgGet(CFG_DEFAULTS, path);
    const ok = typeof def === 'number' ? Number.isFinite(value)
      : typeof def === 'string' ? typeof value === 'string' && value.trim().length > 0 && value.length <= 14
      : Array.isArray(def) && Array.isArray(value) && value.length === def.length && value.every(Number.isFinite);
    if (!ok) return false;
    const keys = path.split('.'), last = keys.pop();
    const obj = cfgGet(CFG_ROOT, keys.join('.'));
    obj[last] = Array.isArray(value) ? value.slice() : value;
    return true;
  }
  function cfgApply(overrides) {
    // start from config.js, then apply the changes
    for (const k of Object.keys(CFG_ROOT)) {
      const fresh = JSON.parse(JSON.stringify(CFG_DEFAULTS[k]));
      if (Array.isArray(fresh)) fresh.forEach((v, i) => Object.assign(CFG_ROOT[k][i], v));
      else Object.assign(CFG_ROOT[k], fresh);
    }
    customSettings = 0;
    for (const [path, v] of Object.entries(overrides || {})) if (cfgSet(path, v)) customSettings++;
  }
  try { cfgApply(JSON.parse(localStorage.getItem(CFG_KEY) || '{}')); } catch (e) { /* ignore */ }
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.type === 'weide-config' && d.overrides && typeof d.overrides === 'object') cfgApply(d.overrides);
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // ---------------------------------------------------------------------------
  // Stable (top-left corner, door in the bottom wall)
  // ---------------------------------------------------------------------------
  const S = { x: 24, y: 24, w: 220, h: 165, door: 76, wall: 8 };
  S.d0 = S.x + S.w / 2 - S.door / 2;
  S.d1 = S.d0 + S.door;
  S.cx = S.x + S.w / 2;
  S.cy = S.y + S.h / 2;
  S.bottom = S.y + S.h;

  const WALLS = [
    [S.x, S.y, S.x + S.w, S.y],              // top
    [S.x, S.y, S.x, S.bottom],               // left
    [S.x + S.w, S.y, S.x + S.w, S.bottom],   // right
    [S.x, S.bottom, S.d0, S.bottom],         // bottom-left
    [S.d1, S.bottom, S.x + S.w, S.bottom],   // bottom-right
  ];

  // Gate in the top fence, right of the stable: the tractor comes in here and parks along the wall
  const GATE = { x0: S.x + S.w + 6, x1: S.x + S.w + 58, cx: S.x + S.w + 31 };

  // Dog food bowl near the front corner of the stable, in line with the right tyre track
  const bowl = { x: GATE.cx + 13, y: S.bottom - 6, r: 8, food: 100 };

  // Cobblestone patio in front of the door: in the evening, sheep standing on it walk in by themselves
  const P = { x: S.cx - 74, y: S.bottom + 4, w: 148, h: 68 };
  const onPatio = (p) => p.x > P.x && p.x < P.x + P.w && p.y > P.y - 4 && p.y < P.y + P.h;

  // Wooden bench against the front wall, right of the patio (the farmer has his beer there)
  const BENCH = { x: S.x + S.w - 18, y: S.bottom + 10, w: 30 };   // centre of the seat
  const BENCH_SEAT = { x: BENCH.x, y: BENCH.y + 3 };            // where the farmer sits

  // Swiss flag on a pole, left of the patio
  const FLAG = { x: S.x + 12, y: S.bottom + 30, h: 40, size: 20 };

  // The dog's hut, below the flag (door at the front). The dog can sleep in it.
  const HUT = { x: FLAG.x + 10, y: P.y + P.h * 1.5, w: 40, h: 30 };
  const inHut = (p) => Math.abs(p.x - HUT.x) < HUT.w / 2 - 4 && Math.abs(p.y - HUT.y) < HUT.h / 2 - 2;

  // distance from a point outside the stable to its walls (0 inside)
  function stableDist(p) {
    const dx = Math.max(S.x - p.x, 0, p.x - (S.x + S.w)), dy = Math.max(S.y - p.y, 0, p.y - S.bottom);
    return Math.hypot(dx, dy);
  }

  const inStable = (p) =>
    p.x > S.x && p.x < S.x + S.w && p.y > S.y && p.y < S.bottom - 2;

  // Push a circle out of all stable walls.
  function collideWalls(e) {
    for (const [x1, y1, x2, y2] of WALLS) {
      const dx = x2 - x1, dy = y2 - y1;
      const t = clamp(((e.x - x1) * dx + (e.y - y1) * dy) / (dx * dx + dy * dy), 0, 1);
      const cx = x1 + t * dx, cy = y1 + t * dy;
      let nx = e.x - cx, ny = e.y - cy;
      const d = Math.hypot(nx, ny);
      const min = e.r + S.wall / 2;
      if (d < min) {
        if (d < 1e-6) { nx = 0; ny = 1; } else { nx /= d; ny /= d; }
        e.x = cx + nx * min;
        e.y = cy + ny * min;
        const vn = e.vx * nx + e.vy * ny;
        if (vn < 0) { e.vx -= vn * nx; e.vy -= vn * ny; }
      }
    }
  }

  // Wolves never enter the stable: treat it as a solid block.
  function pushOutOfStable(e) {
    const pad = e.r + S.wall / 2 + 2;
    const x0 = S.x - pad, x1 = S.x + S.w + pad, y0 = S.y - pad, y1 = S.bottom + pad;
    if (e.x > x0 && e.x < x1 && e.y > y0 && e.y < y1) {
      const dl = e.x - x0, dr = x1 - e.x, dt = e.y - y0, db = y1 - e.y;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) e.x = x0; else if (m === dr) e.x = x1;
      else if (m === dt) e.y = y0; else e.y = y1;
    }
  }

  function clampToField(e, margin = 7) {
    e.x = clamp(e.x, e.r + margin, FW - e.r - margin);
    e.y = clamp(e.y, e.r + margin, FH - e.r - margin);
  }

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  const state = {
    screen: 'title',   // 'title' | 'play' | 'over'
    paused: false,
    day: 1,
    hour: CLOCK.start,
    best: 2,
    lost: 0,           // eaten by wolves
    starved: 0,
    born: 0,
    msg: null,
    floats: [],
    marker: null,
    dayWolfAt: null,
    spawnQ: [],        // wolves waiting to arrive: { t, night }
    fast: false,       // fast-forward (daytime only)
    wolfAdj: 0,        // player's wolf setting: -50 .. +50 (%)
    relax: false,      // relax mode: no wolves at all, just herding
    seasonStart: 0,    // season of day 1 (0 spring, 1 summer, 2 fall, 3 winter)
    snowLevel: 2,      // today's snowfall in winter: 0 none, 1 light, 2 moderate, 3 heavy
    lang: 'en',        // 'en' or 'de'
    flurry: 1,         // how hard it is snowing right now (0.5 .. 1)
    sheepTalkCD: 0, wolfTalkCD: 0,
    confirmExit: false, // "really exit?" dialog is open
    overDelay: 0,
    overReason: '',
    overT: 0,
    t: 0,
  };
  let dog = null;
  let sheep = [];
  let wolves = [];
  let patches = [];      // current grass patches
  let oldPatches = [];   // patches withering during the night

  const seasonIndex = (day = state.day) =>
    (Math.floor((day - 1) / CLOCK.seasonDays) + state.seasonStart) % SEASONS.length;
  const season = () => SEASONS[seasonIndex()];
  const seasonDay = () => (state.day - 1) % CLOCK.seasonDays;   // 0, 1, 2
  const isWinter = () => seasonIndex() === 3;
  function phaseName() {
    const se = season();
    return state.hour < se.evening[0] ? 'day' : state.hour < se.night ? 'dusk' : 'night';
  }
  const currentHour = () => state.hour;
  // How dark the sky is (0 = day, 0.65 = night); winter days stay a bit gloomy
  function darkness(h) {
    if (!isWinter()) return rawDarkness(h);
    // gloomy winter days, darker still while it snows (the snow comes in spells)
    const snow = (CFG.winter.snowDark[state.snowLevel] || 0) * state.flurry;
    return Math.max(rawDarkness(h), CFG.winter.gloom + snow);
  }
  // 0..1: how much of a night it is (ignores the winter gloom) - for lamps, lights, glowing eyes
  let nightLevel = 0;
  function rawDarkness(h) {
    const se = season(), D = 0.65;
    const ease = (t) => t * t * (3 - 2 * t);
    if (h < se.morning[0]) return D;
    if (h < se.morning[1]) return D * (1 - ease((h - se.morning[0]) / (se.morning[1] - se.morning[0])));
    if (h < se.evening[0]) return 0;
    if (h < se.evening[1]) return D * ease((h - se.evening[0]) / (se.evening[1] - se.evening[0]));
    return D;
  }

  // ---------------------------------------------------------------------------
  // Language: English / German (chosen with the flags on the start screen)
  // ---------------------------------------------------------------------------
  const pl = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const I18N = {
    en: {
      seasons: ['Spring', 'Summer', 'Fall', 'Winter'],
      subtitle: '~ sheep herding on a Swiss alp ~',
      howTo: 'HOW TO PLAY', options: 'OPTIONS', move: 'MOVE', keys: 'KEYS', or: 'or',
      clickDrag: 'click / drag on the pasture', pause: 'pause', fastDay: 'fast-forward', barkKey: 'bark',
      wolves: 'WOLVES', startSeason: 'START SEASON', startGame: 'START GAME', shuffle: 'SHUFFLE MAP',
      relax: 'RELAX MODE', relaxOn: 'RELAX MODE', relaxLine: ['No wolves at all.', 'Just herding, for fun.'], relaxShort: 'relax mode',
      nightOutRelax: (out) => `Night falls — ${out} sheep still outside. Bring them in, it's cold!`,
      nightSafeRelax: 'All sheep are safe in the stable. Good night!',
      tractorRelax: 'The farmer\'s tractor is here today.',
      pressEnter: 'or press ENTER', help: 'detailed gameplay',
      resume: 'RESUME GAME', newGame: 'NEW GAME', welcomeBack: (d) => `Welcome back! Day ${d}.`,
      savedHint: (d, n) => `ENTER: resume (day ${d}, ${n} sheep)  \u00B7  N: new game`,
      custom: (n) => `(${n} custom setting${n > 1 ? 's' : ''})`,
      wolvesExample: (n) => [`9 sheep: about ${n} wolves at night,`, 'half as many by day.'],
      difficulty: ['EASY', 'NORMAL', 'HARD', 'BRUTAL'],
      rules: [
        'Sheep run away from your Saint Bernard: use that to herd them.',
        'Hungry sheep look for grass; herd them to it. They only eat if the dog keeps away.',
        'The ring around a sheep shows what it ate today. Green = fully fed.',
        'Hungry sheep lose health overnight and can starve.',
        'Get every sheep into the stable before nightfall. Then the wolves come!',
        'Wolves may attack by day too. Chase them off before they bite.',
        'A fed ram (grey, horns) + a fed ewe (white) in the stable = a lamb overnight.',
        'Running tires the dog. Its food bowl next to the stable restores energy.',
        'Seasons change every 3 days. Summer days are long, winter days short and cold!',
        'No rams or no ewes left = game over.',
      ],
      exit: 'EXIT', exitTitle: 'EXIT GAME?', exitLine1: 'Your game will be saved.', exitLine2: 'Back to the main screen?',
      yes: 'YES', no: 'NO', paused: 'PAUSED', pausedLine: 'The game is saved when you exit.',
      pauseBtn: 'PAUSE', contBtn: 'CONTINUE', exitBtn: 'EXIT GAME',
      gameOver: 'GAME OVER', cont: 'CONTINUE',
      overRows: ['Day reached', 'Largest flock', 'Lambs born', 'Killed by wolves', 'Starved / froze', 'Wolves setting'],
      nSheep: (n) => `${n} sheep`,
      day: (n) => `Day ${n}`,
      hud: { best: 'Best', inStable: 'In stable', fed: 'fed', ewes: 'Ewes', rams: 'Rams' },
      allGone: 'All your sheep are gone.',
      noRams: 'No rams left — your flock can no longer grow.',
      noEwes: 'No ewes left — your flock can no longer grow.',
      firstDay: (se) => `Day 1, ${se} — herd your ram and ewe onto the grass so they can eat!`,
      snow: ['A clear, frosty day', 'Light snow today', 'It is snowing', 'Heavy snowfall today!'],
      fog: 'Thick fog this morning — it clears up by noon',
      blizzard: 'BLIZZARD! Storm and heavy snow all day — the cold bites outside',
      seasonMsg: [
        'Spring is here! Flowers everywhere, and the ducks come back',
        'Summer! Long days, but the heat tires the dog',
        'Fall: the leaves turn yellow and the ducks fly south',
        'Winter! Short, cold days. Keep the sheep warm in the stable',
      ],
      lambs: (n) => `${pl(n, 'lamb', 'lambs')} born (${pl(n, 'fed pair', 'fed pairs')})!`,
      noLambs: 'no lambs (needs a fed ram and a fed ewe in the stable)',
      starved: (n) => `${pl(n, 'sheep', 'sheep')} starved`,
      dayWolves: (n) => (n > 1 ? `${n} wolves are coming! Chase them away!` : 'A wolf! Chase it away with your dog!'),
      dusk: (winter) => (winter ? 'Evening already, and it is freezing! Bring the sheep in!' : 'Evening — bring the sheep into the stable!'),
      nightOut: (n, out) => `Night falls — ${pl(n, 'wolf is', 'wolves are')} coming! ${out} sheep still outside!`,
      nightSafe: (n) => `All sheep are safe. ${pl(n, 'wolf prowls', 'wolves prowl')} around… Good night!`,
      fastOn: (x) => `Fast-forward ${x}× (press F or >> again to stop)`, fastOff: 'Normal speed',
      woof2: 'Woof woof!', woof: 'Woof!', yelp: 'Yelp!', bark: 'WOOF!', barkBtn: 'WOOF!', energy: (n) => `-${n}% energy`,
      baa: ['Bahh!', 'Bahh!', 'Bahh!', 'Bahh!', 'Mäh!'], baaPanic: 'BAHH!!', brr: 'Brrr!',
      baaBark: ['Bahh!', 'Bahh bahh!', 'Bahh!', 'Bahh bahh!'],
      full: 'full!', froze: 'froze!', munch: 'munch!', givesUp: 'gives up!', bitten: 'bitten!',
      ramKilled: 'Ram killed!', eweKilled: 'Ewe killed!', growl: 'Grrr!', howl: 'Awoooo!', quack: 'quack', quack2: 'quack!',
      tractor: 'The farmer\'s tractor is here today. Wolves keep away from it!', honk: 'Tuut tuut!', beep: 'beep beep',
      zzz: 'Zzzzzz', yawn: 'Yawn!',
      hello: 'Grüezi!', goodDog: (n) => `Good dog, ${n}!`, hopp: 'Hopp hopp!', bye: 'Tschüss!', dig: 'Time to dig!', done: 'Done!',
      prost: 'Prost!', ahh: 'Ahh!', shovel: 'So much snow!', rakeTime: 'Leaves everywhere!',
      plantTime: 'Time to plant flowers!', brrm: 'Brrrrmm', appleTime: 'Apple time!', applesDone: 'Lots of apples!',
      snowmanTime: 'Let\'s build a snowman!', snowmanDone: 'What a fine snowman!',
    },
    de: {
      seasons: ['Frühling', 'Sommer', 'Herbst', 'Winter'],
      subtitle: '~ Schafe hüten auf einer Schweizer Alp ~',
      howTo: 'SO GEHT’S', options: 'OPTIONEN', move: 'LAUFEN', keys: 'TASTEN', or: 'oder',
      clickDrag: 'klicken / ziehen auf der Weide', pause: 'Pause', fastDay: 'vorspulen', barkKey: 'bellen',
      wolves: 'WÖLFE', startSeason: 'JAHRESZEIT', startGame: 'SPIEL STARTEN', shuffle: 'NEUE KARTE',
      relax: 'ENTSPANNT', relaxOn: 'ENTSPANNT', relaxLine: ['Gar keine Wölfe.', 'Einfach hüten, zum Spass.'], relaxShort: 'entspannt',
      nightOutRelax: (out) => `Die Nacht bricht herein — ${out === 1 ? '1 Schaf ist' : out + ' Schafe sind'} noch draußen. Bring sie rein, es ist kalt!`,
      nightSafeRelax: 'Alle Schafe sind sicher im Stall. Gute Nacht!',
      tractorRelax: 'Heute ist der Traktor des Bauern da.',
      pressEnter: 'oder ENTER drücken', help: 'ausführliche Spielregeln',
      resume: 'WEITERSPIELEN', newGame: 'NEUES SPIEL', welcomeBack: (d) => `Willkommen zurück! Tag ${d}.`,
      savedHint: (d, n) => `ENTER: weiter (Tag ${d}, ${n === 1 ? '1 Schaf' : n + ' Schafe'})  \u00B7  N: neues Spiel`,
      custom: (n) => `(${n} eigene Einstellung${n > 1 ? 'en' : ''})`,
      wolvesExample: (n) => [`9 Schafe: etwa ${n} Wölfe nachts,`, 'tagsüber halb so viele.'],
      difficulty: ['LEICHT', 'NORMAL', 'SCHWER', 'BRUTAL'],
      rules: [
        'Die Schafe laufen vor deinem Bernhardiner weg: so treibst du sie.',
        'Hungrige Schafe suchen Gras; treib sie hin. Sie fressen nur, wenn der Hund Abstand hält.',
        'Der Ring um ein Schaf zeigt, was es heute gefressen hat. Grün = satt.',
        'Hungrige Schafe verlieren über Nacht Gesundheit und können verhungern.',
        'Bring alle Schafe vor Einbruch der Nacht in den Stall. Dann kommen die Wölfe!',
        'Wölfe greifen auch tagsüber an. Verjag sie, bevor sie zubeißen.',
        'Satter Widder (grau, Hörner) + satte Aue (weiß) im Stall = ein Lamm über Nacht.',
        'Rennen ermüdet den Hund. Sein Futternapf beim Stall gibt neue Kraft.',
        'Alle 3 Tage wechselt die Jahreszeit. Sommertage sind lang, Wintertage kurz und kalt!',
        'Keine Widder oder keine Auen mehr = Spiel vorbei.',
      ],
      exit: 'ENDE', exitTitle: 'SPIEL BEENDEN?', exitLine1: 'Dein Spiel wird gespeichert.', exitLine2: 'Zurück zum Startbildschirm?',
      yes: 'JA', no: 'NEIN', paused: 'PAUSE', pausedLine: 'Beim Beenden wird das Spiel gespeichert.',
      pauseBtn: 'PAUSE', contBtn: 'WEITER', exitBtn: 'BEENDEN',
      gameOver: 'SPIEL VORBEI', cont: 'WEITER',
      overRows: ['Erreichter Tag', 'Größte Herde', 'Geborene Lämmer', 'Von Wölfen gerissen', 'Verhungert / erfroren', 'Wölfe-Einstellung'],
      nSheep: (n) => `${n} ${n === 1 ? 'Schaf' : 'Schafe'}`,
      day: (n) => `Tag ${n}`,
      hud: { best: 'Rekord', inStable: 'Im Stall', fed: 'satt', ewes: 'Auen', rams: 'Widder' },
      allGone: 'Alle deine Schafe sind weg.',
      noRams: 'Keine Widder mehr — deine Herde kann nicht mehr wachsen.',
      noEwes: 'Keine Auen mehr — deine Herde kann nicht mehr wachsen.',
      firstDay: (se) => `Tag 1, ${se} — treib Widder und Aue aufs Gras, damit sie fressen können!`,
      snow: ['Ein klarer, frostiger Tag', 'Heute leichter Schneefall', 'Es schneit', 'Heute starker Schneefall!'],
      fog: 'Dichter Nebel am Morgen — bis Mittag lichtet er sich',
      blizzard: 'SCHNEESTURM! Sturm und starker Schneefall den ganzen Tag — draußen ist es bitterkalt',
      seasonMsg: [
        'Der Frühling ist da! Überall Blumen, und die Enten kommen zurück',
        'Sommer! Lange Tage, aber die Hitze macht den Hund müde',
        'Herbst: Die Blätter werden gelb und die Enten fliegen in den Süden',
        'Winter! Kurze, kalte Tage. Halte die Schafe im Stall warm',
      ],
      lambs: (n) => `${n === 1 ? '1 Lamm' : n + ' Lämmer'} geboren (${n === 1 ? '1 sattes Paar' : n + ' satte Paare'})!`,
      noLambs: 'keine Lämmer (dazu braucht es einen satten Widder und eine satte Aue im Stall)',
      starved: (n) => `${n === 1 ? '1 Schaf' : n + ' Schafe'} verhungert`,
      dayWolves: (n) => (n > 1 ? `${n} Wölfe kommen! Verjag sie!` : 'Ein Wolf! Verjag ihn mit deinem Hund!'),
      dusk: (winter) => (winter ? 'Schon Abend, und es ist eiskalt! Bring die Schafe rein!' : 'Abend — bring die Schafe in den Stall!'),
      nightOut: (n, out) => `Die Nacht bricht herein — ${n === 1 ? 'ein Wolf kommt' : n + ' Wölfe kommen'}! ${out === 1 ? '1 Schaf ist' : out + ' Schafe sind'} noch draußen!`,
      nightSafe: (n) => `Alle Schafe sind sicher. ${n === 1 ? 'Ein Wolf schleicht' : n + ' Wölfe schleichen'} herum… Gute Nacht!`,
      fastOn: (x) => `Vorspulen ${x}× (F oder >> nochmal zum Stoppen)`, fastOff: 'Normale Geschwindigkeit',
      woof2: 'Wuff wuff!', woof: 'Wuff!', yelp: 'Jaul!', bark: 'WUFF!', barkBtn: 'WUFF!', energy: (n) => `-${n}% Kraft`,
      baa: ['Mäh!', 'Mäh!', 'Bääh!', 'Määh!', 'Mäh!'], baaPanic: 'MÄÄH!!', brr: 'Brrr!',
      baaBark: ['Mäh!', 'Mäh mäh!', 'Bääh!', 'Mäh mäh!'],
      full: 'satt!', froze: 'erfroren!', munch: 'mampf!', givesUp: 'gibt auf!', bitten: 'gebissen!',
      ramKilled: 'Widder gerissen!', eweKilled: 'Aue gerissen!', growl: 'Grrr!', howl: 'Auuuuu!', quack: 'quak', quack2: 'quak!',
      tractor: 'Heute ist der Traktor des Bauern da. Wölfe halten Abstand!', honk: 'Tüüt tüüt!', beep: 'piep piep',
      zzz: 'Zzzzzz', yawn: 'Gähn!',
      hello: 'Grüezi!', goodDog: (n) => `Braver ${n}!`, hopp: 'Hopp hopp!', bye: 'Tschüss!', dig: 'Ans Graben!', done: 'Fertig!',
      prost: 'Prost!', ahh: 'Ahh!', shovel: 'So viel Schnee!', rakeTime: 'Überall Laub!',
      plantTime: 'Blumen pflanzen!', brrm: 'Brrrrmm', appleTime: 'Äpfel pflücken!', applesDone: 'So viele Äpfel!',
      snowmanTime: 'Wir bauen einen Schneemann!', snowmanDone: 'Was für ein Schneemann!',
    },
  };
  // translated text: tr('key') or tr('key', args...) for texts with numbers in them
  function tr(key, ...args) {
    const v = (I18N[state.lang] || I18N.en)[key];
    return typeof v === 'function' ? v(...args) : v;
  }
  const seasonName = (i = seasonIndex()) => tr('seasons')[i];

  // Animal sounds: floating text that rises and fades (like the ducks' quack)
  const SAY_COLOR = { dog: '#ffe0b0', sheep: '#ffffff', wolf: '#ffd23f', tractor: '#ffc2b0', farmer: '#c8e6ff' };
  function say(ent, text, kind) {
    addFloat(ent.x, ent.y, text, SAY_COLOR[kind] || '#fff6c8');
  }

  function showMsg(text, t = 3.5) { state.msg = { text, t, max: t }; }
  function addFloat(x, y, text, color = '#ffdddd') {
    state.floats.push({ x, y, text, color, t: 1.6 });
  }

  // ---------------------------------------------------------------------------
  // Sheep
  // ---------------------------------------------------------------------------
  function newSheep(sex) {
    return {
      x: 0, y: 0, vx: 0, vy: 0, r: CFG.sheep.r,
      lamb: false,      // born last night: small, eats less; grown up the next morning
      nights: 99,       // nights lived (lambs start at 0)
      sex: sex || (Math.random() < 0.5 ? 'm' : 'f'),
      food: 0,          // % eaten today (100 = fully fed)
      health: 100,      // %
      heading: rand(0, TAU), wanderT: rand(0, 2), grazing: Math.random() < 0.5,
      fx: 1, fy: 0,     // facing direction (for the eyes)
      panicOff: 0, panicT: 0,
      alarm: 0, eating: false,
      hurtT: 0,         // > 0 while being bitten (red flash)
      headJit: 0, exitOff: rand(-20, 20), leaveT: 0, wasInside: false, trot: false,
      baaT: rand(4, 25),
      winterSlow: rand(CFG.winter.sheepSlow[0], CFG.winter.sheepSlow[1]),
      puffs: Array.from({ length: 9 }, () => rand(0.85, 1.15)), // wool lumps
    };
  }

  const countSex = (sex) => sheep.filter((s) => s.sex === sex).length;
  const fedCount = (sex) => sheep.filter((s) => s.sex === sex && s.food >= 100).length;
  const fedInStable = (sex) => sheep.filter((s) => s.sex === sex && s.nights >= CFG.sheep.matureNights &&
                                                  s.food >= 100 && inStable(s)).length;
  const unsafeSheep = () => sheep.filter((s) => !inStable(s));

  // Morning: the shepherd lets the flock out of the stable. (With all = false, sheep that spent
  // the night outside stay where they are; only the ones from the stable and newborn lambs come out.)
  function releaseFlock(all = true) {
    const cx = S.cx + 60, cy = S.bottom + 85;
    for (const s of sheep) {
      if (!all && (s.x || s.y) && !inStable(s)) { s.vx = s.vy = 0; continue; }
      s.x = cx + rand(-70, 70);
      s.y = cy + rand(-40, 45);
      s.vx = s.vy = 0;
      s.heading = rand(0, TAU);
    }
  }

  // Game over if one sex is gone: the flock can no longer grow.
  function checkExtinction() {
    if (state.overDelay > 0 || state.screen !== 'play') return false;
    let reason = '';
    if (sheep.length === 0) reason = tr('allGone');
    else if (countSex('m') === 0) reason = tr('noRams');
    else if (countSex('f') === 0) reason = tr('noEwes');
    if (!reason) return false;
    state.overReason = reason;
    state.overDelay = 2.5;
    showMsg(reason, 3);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Grass patches
  // ---------------------------------------------------------------------------
  const patchR = (p) => p.R * Math.sqrt(clamp(p.amount / p.max, 0, 1));

  function makePatchTexture(R, winter = false) {
    const c = document.createElement('canvas');
    const size = Math.ceil(R * 2 + 4);
    c.width = c.height = size;
    const g = c.getContext('2d');
    const m = size / 2;
    if (winter) { paintWinterPatch(g, m, R); return c; }
    const grd = g.createRadialGradient(m, m, 0, m, m, R);
    grd.addColorStop(0, '#3f8f2c');
    grd.addColorStop(0.85, '#4c9a33');
    grd.addColorStop(1, 'rgba(76,154,51,0.6)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(m, m, R, 0, TAU); g.fill();
    g.lineWidth = 1.4;
    const n = Math.floor(R * R * 0.12);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * R * 0.97;
      const x = m + Math.cos(a) * rr, y = m + Math.sin(a) * rr;
      g.strokeStyle = Math.random() < 0.5 ? 'rgba(25,80,15,0.55)' : 'rgba(150,215,90,0.5)';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-2.5, 2.5), y - rand(4, 8)); g.stroke();
    }
    for (let i = 0; i < n / 25; i++) {
      const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * R * 0.9;
      g.fillStyle = Math.random() < 0.5 ? '#fff6c8' : '#ffd9f0';
      g.beginPath(); g.arc(m + Math.cos(a) * rr, m + Math.sin(a) * rr, 1.6, 0, TAU); g.fill();
    }
    return c;
  }

  // Winter grass: thin, brownish and muddy (not very delicious)
  function paintWinterPatch(g, m, R) {
    const grd = g.createRadialGradient(m, m, 0, m, m, R);
    grd.addColorStop(0, '#7d6c3f');
    grd.addColorStop(0.8, '#76683b');
    grd.addColorStop(1, 'rgba(118,104,59,0.55)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(m, m, R, 0, TAU); g.fill();
    for (let i = 0; i < Math.round(R / 6); i++) {          // muddy puddles
      const a = rand(0, TAU), rr = Math.sqrt(Math.random()) * R * 0.75;
      const x = m + Math.cos(a) * rr, y = m + Math.sin(a) * rr, w = rand(4, 10), h = w * rand(0.5, 0.8);
      g.fillStyle = '#4f3c22';
      g.beginPath(); g.ellipse(x, y, w, h, rand(0, TAU), 0, TAU); g.fill();
      g.fillStyle = 'rgba(200,215,230,0.35)';              // a little icy shine
      g.beginPath(); g.ellipse(x - w * 0.25, y - h * 0.3, w * 0.35, h * 0.25, 0, 0, TAU); g.fill();
    }
    g.lineWidth = 1.2;
    const n = Math.floor(R * R * 0.06);                      // sparse, dry tufts
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * R * 0.95;
      const x = m + Math.cos(a) * rr, y = m + Math.sin(a) * rr;
      const roll = Math.random();
      g.strokeStyle = roll < 0.45 ? 'rgba(160,140,80,0.8)' : roll < 0.8 ? 'rgba(110,95,50,0.7)' : 'rgba(120,150,70,0.7)';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-2.5, 2.5), y - rand(3, 6)); g.stroke();
    }
    for (let i = 0; i < n / 3; i++) {                        // frost
      const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * R * 0.95;
      g.fillStyle = 'rgba(245,250,255,0.6)';
      g.beginPath(); g.arc(m + Math.cos(a) * rr, m + Math.sin(a) * rr, rand(0.6, 1.3), 0, TAU); g.fill();
    }
  }

  // Create a new set of grass patches with enough food for ~`nSheep` sheep.
  // In winter there is 30% less food: the patches are smaller and empty quicker.
  function generatePatches(nSheep, full, si = seasonIndex()) {
    const G = CFG.grass;
    const winter = si === 3;
    const count = clamp(G.minPatches + Math.floor(nSheep / 4), G.minPatches, G.maxPatches);
    const total = Math.max(2, nSheep) * 100 * G.surplus * (winter ? G.winterFactor : 1);
    const list = [];
    // Bonus: sometimes a small extra patch grows across a stream (in the corner behind it)
    for (const st of streams) {
      if (Math.random() >= CFG.streams.patchAcross) continue;
      const max = rand(18, 26) * (winter ? G.winterFactor : 1), R = 15 + 4 * Math.sqrt(max);
      for (let tries = 0; tries < 300; tries++) {
        const a = Math.abs(st.p0.x - st.corner.x), b = Math.abs(st.p1.y - st.corner.y);
        const x = st.corner.x + (st.corner.x ? -1 : 1) * rand(R + 10, Math.max(R + 11, a));
        const y = st.corner.y + (st.corner.y ? -1 : 1) * rand(R + 10, Math.max(R + 11, b));
        if (sideOf(st, { x, y }) !== st.side) continue;
        if (nearStream(x, y, R + 8) || nearBridge(x, y, R + 10)) continue;
        if (solids.some((o) => Math.hypot(o.x - x, o.y - y) < R * 0.55 + o.r)) continue;
        if (lakes.some((l) => inWater(l, x, y, R * 0.8 + 12))) continue;
        list.push({ x, y, R, max, amount: full ? max : 0, winter, tex: makePatchTexture(R, winter) });
        break;
      }
    }
    for (let i = 0; i < count; i++) {
      const max = (total / count) * rand(0.75, 1.25);
      const R = 15 + 4 * Math.sqrt(max);
      for (let tries = 0; tries < 300; tries++) {
        const x = rand(R + 20, FW - R - 20), y = rand(R + 20, FH - R - 20);
        if (nearStream(x, y, R * 0.8 + 6) || nearBridge(x, y, R + 10)) continue;
        // keep away from the stable and its door area
        const nearStable = x > S.x - R - 40 && x < S.x + S.w + R + 120 && y < S.bottom + R + 110;
        if (nearStable) continue;
        if (solids.some((o) => Math.hypot(o.x - x, o.y - y) < R * 0.55 + o.r)) continue;
        if (lakes.some((l) => inWater(l, x, y, R * 0.8 + 12))) continue;
        if (list.some((p) => Math.hypot(p.x - x, p.y - y) < p.R + R + 40)) continue;
        list.push({ x, y, R, max, amount: full ? max : 0, winter, tex: makePatchTexture(R, winter) });
        break;
      }
    }
    return list;
  }

  // A patch with less than this much grass left counts as eaten up (no sheep is drawn to it any more)
  const grassLeft = (p) => Math.max(3, p.max * 0.06);
  // How much a patch pulls: a full patch is seen from the whole distance, a half-eaten one from
  // about half as far, an eaten-up one not at all (a sheep already standing on the grass stays).
  const grassPull = (p) => (p.amount < grassLeft(p) ? 0 : clamp(p.amount / p.max, 0, 1));

  // The patch with grass that draws this sheep most (within `extra` x how full the patch is).
  function nearPatch(s, extra) {
    let best = null, bestScore = 1e9;
    for (const p of patches) {
      const pull = grassPull(p);
      if (pull <= 0) continue;                        // (eaten up: nothing to come for)
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      const gap = d - patchR(p);
      if (gap > 0 && gap >= extra * pull) continue;
      const score = gap / (0.3 + 0.7 * pull);         // fuller patches win over emptier ones
      if (score < bestScore) { bestScore = score; best = { p, d }; }
    }
    return best;
  }

  // Grass a hungry sheep would walk to (within `reach` x how full it is; not across a stream unless frozen)
  function grassToSeek(s, reach) {
    let best = null, bestScore = 1e9;
    for (const p of patches) {
      const pull = grassPull(p);
      if (pull <= 0) continue;
      if (!isWinter() && streams.some((st) => sideOf(st, s) !== sideOf(st, p))) continue;
      const gap = Math.hypot(p.x - s.x, p.y - s.y) - patchR(p);
      if (gap >= reach * pull) continue;
      const score = gap / (0.3 + 0.7 * pull);
      if (score < bestScore) { bestScore = score; best = p; }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Obstacles: trees (solid trunk, canopy you can hide under) and rocks (solid)
  // ---------------------------------------------------------------------------
  let trees = [], rocks = [], lakes = [], solids = [], ducks = [];
  const obstacleLayer = document.createElement('canvas'); // trunks, rocks and their shadows
  obstacleLayer.width = FW; obstacleLayer.height = FH;

  // Tree-top colours per season (spring, summer, fall); winter trees are bald
  const CANOPY = [
    { base: '#367a2e', rim: ['#3c8434', '#2f6d29'], light: '#4f9c42', hi: '#74bf5c', blossom: true },
    { base: '#2c6a29', rim: ['#31752d', '#2a6427'], light: '#3f8c37', hi: '#57a64b' },
    { base: '#b06d1e', rim: ['#c98a26', '#a3601b'], light: '#dca233', hi: '#f2c94c', red: true },
  ];

  function makeCanopy(R, seasonIdx = 1) {
    if (seasonIdx === 3) return makeBareTree(R);
    const P = CANOPY[seasonIdx];
    const c = document.createElement('canvas');
    const size = Math.ceil(R * 2 + 8);
    c.width = c.height = size;
    const g = c.getContext('2d');
    const m = size / 2;
    const blob = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
    blob(m, m, R * 0.82, P.base);
    const n = 9;
    for (let i = 0; i < n; i++) {                       // leafy rim
      const a = (i / n) * TAU + rand(-0.2, 0.2);
      blob(m + Math.cos(a) * R * 0.62, m + Math.sin(a) * R * 0.62, R * rand(0.32, 0.4), P.rim[i % 2]);
    }
    for (let i = 0; i < 7; i++) {                       // lighter clumps (light from top-left)
      const a = rand(0, TAU), rr = rand(0, R * 0.55);
      blob(m + Math.cos(a) * rr - R * 0.12, m + Math.sin(a) * rr - R * 0.12, R * rand(0.18, 0.28), P.light);
    }
    for (let i = 0; i < 5; i++) {
      const a = rand(0, TAU), rr = rand(0, R * 0.45);
      blob(m + Math.cos(a) * rr - R * 0.2, m + Math.sin(a) * rr - R * 0.2, R * rand(0.1, 0.16), P.hi);
    }
    if (P.red) {                                        // a few red-brown clumps in fall
      for (let i = 0; i < 4; i++) {
        const a = rand(0, TAU), rr = rand(0, R * 0.6);
        blob(m + Math.cos(a) * rr, m + Math.sin(a) * rr, R * rand(0.12, 0.2), '#b8481f');
      }
    }
    if (P.blossom) {                                    // spring blossoms
      for (let i = 0; i < 30; i++) {
        const a = rand(0, TAU), rr = Math.sqrt(Math.random()) * R * 0.85;
        blob(m + Math.cos(a) * rr, m + Math.sin(a) * rr, rand(1.3, 2.2), Math.random() < 0.6 ? '#ffffff' : '#ffc7dc');
      }
    }
    g.strokeStyle = P.red ? 'rgba(90,40,10,0.45)' : 'rgba(15,45,15,0.5)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 40; i++) {                      // leaf texture
      const a = rand(0, TAU), rr = Math.sqrt(Math.random()) * R * 0.85;
      const x = m + Math.cos(a) * rr, y = m + Math.sin(a) * rr;
      g.beginPath(); g.arc(x, y, rand(1.5, 3), rand(0, TAU), rand(3, 5)); g.stroke();
    }
    return c;
  }

  // Winter: bare branches with a little snow on them
  function makeBareTree(R) {
    const c = document.createElement('canvas');
    const size = Math.ceil(R * 2 + 8);
    c.width = c.height = size;
    const g = c.getContext('2d');
    const m = size / 2;
    g.lineCap = 'round';
    const branch = (x, y, a, len, w, depth) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      g.strokeStyle = '#4a3626'; g.lineWidth = w;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = Math.max(0.6, w * 0.4);  // snow on top
      g.beginPath(); g.moveTo(x - 0.5, y - 0.8); g.lineTo(x2 - 0.5, y2 - 0.8); g.stroke();
      if (depth > 0) {
        const k = depth > 1 ? 2 : 3;
        for (let i = 0; i < k; i++) branch(x2, y2, a + rand(-0.7, 0.7), len * rand(0.45, 0.65), w * 0.6, depth - 1);
      }
    };
    const n = Math.round(rand(6, 8));
    for (let i = 0; i < n; i++) {
      branch(m, m, (i / n) * TAU + rand(-0.25, 0.25), R * rand(0.38, 0.5), 3.2, 2);
    }
    return c;
  }

  function canopyTex(t) {
    const i = seasonIndex();
    if (!t.texs[i]) t.texs[i] = makeCanopy(t.R, i);
    return t.texs[i];
  }


  // ---------------------------------------------------------------------------
  // Streams: meander diagonally across a corner of the pasture (never the stable's).
  // Wading through is slow; the wooden bridge is the quick way across.
  // ---------------------------------------------------------------------------
  let streams = [];

  // corner: 'br' / 'bl' / 'tr'; a, b: how far along the two edges the stream starts and ends
  function makeStream(corner, a, b) {
    const W = CFG.streams;
    const cx = corner.includes('r') ? FW : 0, cy = corner.includes('b') ? FH : 0;
    // from the horizontal edge to the vertical edge, a bit beyond the fence on both ends
    const p0 = { x: cx === FW ? FW - a : a, y: cy === FH ? FH + 25 : -25 };
    const p1 = { x: cx === FW ? FW + 25 : -25, y: cy === FH ? FH - b : b };
    const dx = p1.x - p0.x, dy = p1.y - p0.y, L = Math.hypot(dx, dy);
    const nx = -dy / L, ny = dx / L;
    // longer streams meander a bit more
    const amp = rand(12, 18) + L * 0.025, k = rand(1.2, 1.8) + L / 700, ph = rand(0, TAU);
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, off = amp * Math.sin(TAU * k * t + ph);
      pts.push({ x: p0.x + dx * t + nx * off, y: p0.y + dy * t + ny * off });
    }
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const st = { corner: { x: cx, y: cy }, p0, p1, pts, cum, len: cum[cum.length - 1], w: rand(W.width[0], W.width[1]), amp, k, ph };
    // bridges: one on a short stream, two on a long one (spread out, inside the pasture)
    const nb = st.len > 520 ? 2 : 1;
    st.bridges = [];
    for (let i = 0; i < nb; i++) {
      const f = nb === 1 ? rand(0.38, 0.62) : (i === 0 ? rand(0.22, 0.36) : rand(0.64, 0.78));
      const bp = streamPointAt(st, st.len * f);
      st.bridges.push({ x: bp.x, y: bp.y, tx: bp.tx, ty: bp.ty, len: st.w + 24, wid: 26 });
    }
    // flowing streaks for the animation
    st.streaks = Array.from({ length: Math.round(st.len / 9) }, () => ({ s: rand(0, st.len), off: rand(-0.38, 0.38), sp: rand(0.8, 1.3), l: rand(5, 11) }));
    st.side = sideOf(st, st.corner);
    return st;
  }

  function streamPointAt(st, d) {
    d = clamp(d, 0, st.len);
    let i = 1;
    while (i < st.cum.length - 1 && st.cum[i] < d) i++;
    const a = st.pts[i - 1], b = st.pts[i], segL = st.cum[i] - st.cum[i - 1] || 1;
    const t = (d - st.cum[i - 1]) / segL;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tx: (b.x - a.x) / segL, ty: (b.y - a.y) / segL };
  }

  // distance from a point to the middle line of the stream
  function streamDist(st, x, y) {
    let best = 1e9;
    for (let i = 1; i < st.pts.length; i++) {
      const a = st.pts[i - 1], b = st.pts[i];
      const dx = b.x - a.x, dy = b.y - a.y;
      const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
      best = Math.min(best, Math.hypot(x - a.x - dx * t, y - a.y - dy * t));
    }
    return best;
  }
  // which side of the stream a point is on (+1 / -1), following the meanders
  function sideOf(st, p) {
    const dx = st.p1.x - st.p0.x, dy = st.p1.y - st.p0.y, L = Math.hypot(dx, dy);
    const rx = p.x - st.p0.x, ry = p.y - st.p0.y;
    const t = clamp((rx * dx + ry * dy) / (L * L), 0, 1);
    const off = (dx * ry - dy * rx) / L;                       // distance from the straight line
    const wig = st.amp ? st.amp * Math.sin(TAU * st.k * t + st.ph) : 0;   // where the meander is there
    return Math.sign(off - wig) || 1;
  }
  function onBridge(p) {
    for (const st of streams) for (const B of st.bridges) {
      const rx = p.x - B.x, ry = p.y - B.y;
      const along = rx * B.ty - ry * B.tx;        // across the stream (walking direction)
      const across = rx * B.tx + ry * B.ty;       // along the stream
      if (Math.abs(along) <= B.len / 2 + 4 && Math.abs(across) <= B.wid / 2) return true;
    }
    return false;
  }
  // wading in a stream (not on a bridge)?
  function inStream(p) {
    if (!streams.length || isWinter()) return false;   // frozen in winter: no wading
    for (const st of streams) if (streamDist(st, p.x, p.y) < st.w / 2 + 1) return !onBridge(p);
    return false;
  }
  function nearStream(x, y, pad) {
    return streams.some((st) => streamDist(st, x, y) < st.w / 2 + pad);
  }
  function nearBridge(x, y, pad) {
    return streams.some((st) => st.bridges.some((B) => Math.hypot(B.x - x, B.y - y) < B.len / 2 + pad));
  }

  // The streams cut off a corner each. Together they take `cutOff` of the pasture
  // (the part you can't reach from the stable without crossing water).
  function generateStreams() {
    const W = CFG.streams;
    const corners = ['br', 'bl', 'tr'].sort(() => Math.random() - 0.5);   // never top-left (the stable)
    const n = clamp(Math.round(rand(W.count[0], W.count[1])), 0, 3);
    // (x1.25: the triangles are measured from just outside the fence and the meanders eat a bit)
    const total = rand(W.cutOff[0], W.cutOff[1]) * FW * FH * 1.25;
    const legs = {};   // a = along the top/bottom edge, b = along the left/right edge
    for (const c of corners.slice(0, n)) {
      const area = (total / n) * rand(0.8, 1.2);               // triangle area = a * b / 2
      let a = Math.sqrt(2 * area * rand(0.9, 1.7));
      // keep away from the stable, its door and the morning meadow
      const maxA = c === 'tr' ? FW - 440 : FW * 0.85;
      const maxB = c === 'bl' ? FH - 360 : FH * 0.85;
      a = clamp(a, 120, maxA);
      let b = clamp((2 * area) / a, 120, maxB);
      a = clamp((2 * area) / b, 120, maxA);
      legs[c] = { a, b };
    }
    // two streams on the same edge must not run into each other
    const shrink = (c1, k1, c2, k2, room) => {
      if (!legs[c1] || !legs[c2]) return;
      const over = legs[c1][k1] + legs[c2][k2] - room;
      if (over > 0) { legs[c1][k1] -= over / 2; legs[c2][k2] -= over / 2; }
    };
    shrink('br', 'a', 'bl', 'a', FW - 120);   // bottom edge
    shrink('br', 'b', 'tr', 'b', FH - 120);   // right edge
    streams = Object.entries(legs).map(([c, L]) => makeStream(c, L.a, L.b));
  }

  function paintStreams(g) {
    const si = seasonIndex();
    const path = (st) => {
      g.beginPath();
      st.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    };
    g.lineJoin = 'round'; g.lineCap = 'round';
    for (const st of streams) {
      path(st); g.strokeStyle = si === 3 ? 'rgba(255,255,255,0.6)' : si === 2 ? 'rgba(150,120,40,0.35)' : 'rgba(70,110,40,0.4)';
      g.lineWidth = st.w + 16; g.stroke();                                   // damp grass / snow drift
      path(st); g.strokeStyle = si === 3 ? '#c6d0d8' : '#9a8a58'; g.lineWidth = st.w + 7; g.stroke();   // banks
      path(st); g.strokeStyle = si === 3 ? '#8db3c8' : '#2f6888'; g.lineWidth = st.w + 2; g.stroke();
      path(st); g.strokeStyle = si === 3 ? '#cfe6f1' : '#4590b6'; g.lineWidth = st.w; g.stroke();     // water / ice
      path(st); g.strokeStyle = si === 3 ? '#c3dcea' : '#3b80a6'; g.lineWidth = st.w * 0.45; g.stroke();
      // pebbles and a few reeds on the banks
      let seed = Math.floor(st.p0.x * 3 + st.p1.y * 7);
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      for (let i = 0; i < st.len / 14; i++) {
        const q = streamPointAt(st, rnd() * st.len), side = rnd() < 0.5 ? -1 : 1;
        const off = st.w / 2 + 3 + rnd() * 4;
        const x = q.x - q.ty * off * side, y = q.y + q.tx * off * side;
        if (onBridgeAt(st, x, y)) continue;
        if (rnd() < 0.6) {
          g.fillStyle = si === 3 ? '#f4f7fa' : '#8f8d84';
          g.beginPath(); g.ellipse(x, y, 2 + rnd() * 1.6, 1.5 + rnd(), rnd() * 3, 0, TAU); g.fill();
        } else if (si !== 3) {
          g.strokeStyle = si === 2 ? '#a68a40' : '#3f7d2c'; g.lineWidth = 1.3;
          for (let k = 0; k < 4; k++) {
            const a = Math.atan2(y - q.y, x - q.x) + (k - 1.5) * 0.4;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * (6 + k), y + Math.sin(a) * (6 + k)); g.stroke();
          }
        }
      }
    }
    g.lineCap = 'butt';
  }
  function onBridgeAt(st, x, y) {
    return st.bridges.some((B) => {
      const rx = x - B.x, ry = y - B.y;
      return Math.abs(rx * B.ty - ry * B.tx) <= B.len / 2 + 6 && Math.abs(rx * B.tx + ry * B.ty) <= B.wid / 2 + 6;
    });
  }

  // flowing water: light streaks drifting downstream (leaves in fall, nothing on ice)
  function updateStreams(dt) {
    for (const st of streams) for (const k of st.streaks) {
      k.s += 26 * k.sp * dt;
      if (k.s > st.len) k.s -= st.len;
    }
  }
  function drawStreamFlow() {
    const si = seasonIndex();
    if (si === 3) return;
    ctx.lineCap = 'round';
    for (const st of streams) {
      for (const k of st.streaks) {
        const a = streamPointAt(st, k.s), off = k.off * st.w;
        const x = a.x - a.ty * off, y = a.y + a.tx * off;
        if (si === 2 && k.l > 9.5) {                          // a floating leaf now and then
          ctx.fillStyle = '#e0a030';
          ctx.beginPath(); ctx.ellipse(x, y, 2.6, 1.5, k.s * 0.05, 0, TAU); ctx.fill();
          continue;
        }
        ctx.strokeStyle = 'rgba(225,242,255,0.45)';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + a.tx * k.l, y + a.ty * k.l); ctx.stroke();
      }
    }
    ctx.lineCap = 'butt';
  }

  // wooden bridges (drawn above the water, below the animals)
  function drawBridges() {
    const winter = isWinter();
    for (const st of streams) for (const B of st.bridges) {
      ctx.save();
      ctx.translate(B.x, B.y);
      ctx.rotate(Math.atan2(B.ty, B.tx) + Math.PI / 2);   // local x = across the stream
      const L = B.len, Wd = B.wid;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(-L / 2 + 3, -Wd / 2 + 4, L, Wd);
      ctx.fillStyle = '#8a5a2b';
      ctx.fillRect(-L / 2, -Wd / 2, L, Wd);
      ctx.strokeStyle = '#5a3a1c'; ctx.lineWidth = 1;
      for (let x = -L / 2 + 5; x < L / 2; x += 5) {          // planks
        ctx.beginPath(); ctx.moveTo(x, -Wd / 2); ctx.lineTo(x, Wd / 2); ctx.stroke();
      }
      ctx.fillStyle = '#5e3c1d';                              // rails
      ctx.fillRect(-L / 2 - 2, -Wd / 2 - 2, L + 4, 3.5);
      ctx.fillRect(-L / 2 - 2, Wd / 2 - 1.5, L + 4, 3.5);
      for (const px of [-L / 2 - 2, L / 2 - 2]) for (const py of [-Wd / 2 - 3, Wd / 2 - 2]) {
        ctx.fillStyle = '#4a2f16'; ctx.fillRect(px, py, 5, 5); // posts
      }
      if (winter) {
        ctx.fillStyle = 'rgba(245,248,252,0.85)';
        ctx.fillRect(-L / 2, -Wd / 2 + 2, L, Wd * 0.45);
        ctx.fillRect(-L / 2 - 2, -Wd / 2 - 2.5, L + 4, 2);
      }
      ctx.restore();
    }
  }

  function generateObstacles() {
    trees = []; rocks = []; lakes = []; ducks = [];
    generateStreams();
    const all = [];
    const fits = (x, y, space, edge = 25) => {
      if (x < space + edge || x > FW - space - edge || y < space + edge || y > FH - space - edge) return false;
      if (x < S.x + S.w + 170 && y < S.bottom + 190) return false; // stable, door, bowl, morning release
      if (nearStream(x, y, space + 22) || nearBridge(x, y, space + 40)) return false;
      return all.every((o) => Math.hypot(o.x - x, o.y - y) > o.space + space + 45);
    };
    const place = (space, edge) => {
      for (let t = 0; t < 400; t++) {
        const x = rand(0, FW), y = rand(0, FH);
        if (fits(x, y, space, edge)) return { x, y };
      }
      return null;
    };
    const O = CFG.obstacles;

    // Lakes first (they need the most room): a blob made of a few overlapping circles
    const nL = Math.round(rand(O.lakes[0], O.lakes[1]));
    for (let i = 0; i < nL; i++) {
      const R = rand(34, 50);
      const pos = place(R * 1.6, 55);   // keep a wide gap to the fence so nobody gets trapped
      if (!pos) continue;
      const circles = [{ x: pos.x, y: pos.y, r: R }];
      const extra = Math.random() < 0.5 ? 1 : 2;
      for (let j = 0; j < extra; j++) {
        const a = rand(0, TAU), r = R * rand(0.55, 0.8);
        circles.push({ x: pos.x + Math.cos(a) * R * 0.7, y: pos.y + Math.sin(a) * R * 0.55, r });
      }
      const lake = { x: pos.x, y: pos.y, space: R * 1.6, circles };
      decorateLake(lake);
      lakes.push(lake); all.push(lake);
    }

    const nT = Math.round(rand(O.trees[0], O.trees[1]));
    for (let i = 0; i < nT; i++) {
      const R = rand(38, 54), pos = place(R * 0.6);
      if (!pos) continue;
      const t = { x: pos.x, y: pos.y, r: rand(7, 9), R, space: R * 0.6, alpha: 0.92, texs: {} };
      trees.push(t); all.push(t);
    }
    const nR = Math.round(rand(O.rocks[0], O.rocks[1]));
    for (let i = 0; i < nR; i++) {
      const r = rand(12, 26), pos = place(r);
      if (!pos) continue;
      const k = 9;
      const pts = Array.from({ length: k }, (_, j) => {
        const a = (j / k) * TAU + rand(-0.25, 0.25), rr = r * rand(0.85, 1.12);
        return [Math.cos(a) * rr, Math.sin(a) * rr];
      });
      const rock = { x: pos.x, y: pos.y, r, space: r, pts };
      rocks.push(rock); all.push(rock);
    }
    rebuildSolids();
    paintObstacleLayer();
  }
  function rebuildSolids() {
    solids = [...trees, ...rocks, ...lakes.flatMap((l) => l.circles.map((c) => ({ x: c.x, y: c.y, r: c.r + 2 }))),
              { x: FLAG.x, y: FLAG.y, r: 4 },    // the flag pole
              { x: BENCH.x - 8, y: BENCH.y, r: 7 }, { x: BENCH.x + 8, y: BENCH.y, r: 7 },     // the bench
              { x: HUT.x - 9, y: HUT.y - 2, r: 14, hut: true }, { x: HUT.x + 9, y: HUT.y - 2, r: 14, hut: true }];   // dog hut
  }

  const inWater = (lake, x, y, pad = 0) => lake.circles.some((c) => Math.hypot(x - c.x, y - c.y) < c.r + pad);

  // Reeds, flowers and stones along the shore, lily pads on the water
  function decorateLake(lake) {
    lake.shore = [];
    lake.pads = [];
    for (const c of lake.circles) {
      const n = Math.round(c.r / 2.6);
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU);
        const off = rand(2, 9);
        const x = c.x + Math.cos(a) * (c.r + off), y = c.y + Math.sin(a) * (c.r + off);
        if (inWater(lake, x, y, 1)) continue;             // that spot is inside another circle
        const roll = Math.random();
        const kind = roll < 0.5 ? 'reeds' : roll < 0.7 ? 'cattail' : roll < 0.88 ? 'flower' : 'stone';
        lake.shore.push({ x, y, a, kind, size: rand(0.8, 1.25), hue: Math.random() });
      }
    }
    const main = lake.circles[0];
    const nPads = Math.round(rand(3, 7));
    for (let i = 0; i < nPads * 4 && lake.pads.length < nPads; i++) {
      const a = rand(0, TAU), rr = rand(0.3, 0.8) * main.r;
      const x = main.x + Math.cos(a) * rr, y = main.y + Math.sin(a) * rr;
      if (lake.pads.some((q) => Math.hypot(q.x - x, q.y - y) < 12)) continue;
      lake.pads.push({ x, y, r: rand(4, 6.5), rot: rand(0, TAU), flower: Math.random() < 0.35 });
    }
    lake.ripples = Array.from({ length: 3 }, () => {
      const a = rand(0, TAU), rr = rand(0, 0.45) * main.r;
      return { x: main.x + Math.cos(a) * rr, y: main.y + Math.sin(a) * rr, ph: Math.random() };
    });
  }

  function paintLake(g, lake) {
    const fillAll = (pad, color) => {
      g.fillStyle = color;
      for (const c of lake.circles) { g.beginPath(); g.arc(c.x, c.y, Math.max(1, c.r + pad), 0, TAU); g.fill(); }
    };
    const si = seasonIndex();
    if (si === 3) { paintFrozenLake(g, lake, fillAll); return; }
    const fall = si === 2;
    fillAll(9, fall ? 'rgba(150,120,40,0.3)' : 'rgba(70,110,40,0.35)');   // damp grass around
    fillAll(4.5, '#a99a63');              // muddy shore
    fillAll(1.5, '#2b5f7d');              // dark water edge
    fillAll(0, '#3f87ad');                // water
    fillAll(-9, '#3a7ea3');
    fillAll(-18, '#336f92');              // deeper in the middle
    // light reflection
    const m = lake.circles[0];
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    g.lineWidth = 2;
    g.beginPath(); g.arc(m.x - m.r * 0.15, m.y - m.r * 0.15, m.r * 0.55, Math.PI * 1.1, Math.PI * 1.45); g.stroke();
    g.lineWidth = 1.2;
    g.beginPath(); g.arc(m.x - m.r * 0.1, m.y - m.r * 0.1, m.r * 0.35, Math.PI * 1.15, Math.PI * 1.4); g.stroke();

    // lily pads
    for (const pd of lake.pads) {
      g.fillStyle = fall ? '#a39a3a' : '#4f9a3c';
      g.beginPath();
      g.moveTo(pd.x, pd.y);
      g.arc(pd.x, pd.y, pd.r, pd.rot + 0.35, pd.rot + TAU - 0.35);  // pad with a notch
      g.closePath(); g.fill();
      g.strokeStyle = '#2f6b25'; g.lineWidth = 0.8; g.stroke();
      if (pd.flower && !fall) {
        g.fillStyle = '#f7b6d2';
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU;
          g.beginPath(); g.arc(pd.x + Math.cos(a) * 1.8, pd.y + Math.sin(a) * 1.8, 1.6, 0, TAU); g.fill();
        }
        g.fillStyle = '#ffe066';
        g.beginPath(); g.arc(pd.x, pd.y, 1.1, 0, TAU); g.fill();
      }
    }

    // shore plants
    for (const sp of lake.shore) {
      const { x, y, size } = sp;
      if (sp.kind === 'stone') {
        g.fillStyle = '#8f8d84';
        g.beginPath(); g.ellipse(x, y, 3.2 * size, 2.4 * size, sp.a, 0, TAU); g.fill();
        g.strokeStyle = '#5f5d56'; g.lineWidth = 0.8; g.stroke();
      } else if (sp.kind === 'flower' && fall) {
        // fall: just a wilted brown tuft
        g.fillStyle = '#8a6a32';
        g.beginPath(); g.arc(x, y, 2.6 * size, 0, TAU); g.fill();
      } else if (sp.kind === 'flower') {
        // marsh marigold (yellow) or iris (purple)
        const col = sp.hue < 0.55 ? '#ffd23a' : '#9a7be0';
        g.fillStyle = '#3f7d2c';
        g.beginPath(); g.arc(x, y, 3.4 * size, 0, TAU); g.fill();
        g.fillStyle = col;
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU + sp.a;
          g.beginPath(); g.arc(x + Math.cos(a) * 2 * size, y + Math.sin(a) * 2 * size, 1.5 * size, 0, TAU); g.fill();
        }
        g.fillStyle = '#fff3c0';
        g.beginPath(); g.arc(x, y, 0.9 * size, 0, TAU); g.fill();
      } else {
        // reeds: a tuft of blades leaning outwards; cattails get brown tips
        const n = sp.kind === 'cattail' ? 5 : 7;
        g.lineCap = 'round';
        for (let k = 0; k < n; k++) {
          const a = sp.a + (k / (n - 1) - 0.5) * 1.6;
          const L = (7 + (k % 3) * 2.5) * size;
          g.strokeStyle = fall ? (k % 2 ? '#9a7d34' : '#b8994a') : k % 2 ? '#2f6e27' : '#4b8f35';
          g.lineWidth = 1.4;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
          if (sp.kind === 'cattail' && k % 2 === 0) {
            g.strokeStyle = '#6b3f1d'; g.lineWidth = 2.6;
            g.beginPath();
            g.moveTo(x + Math.cos(a) * L * 0.7, y + Math.sin(a) * L * 0.7);
            g.lineTo(x + Math.cos(a) * L * 0.95, y + Math.sin(a) * L * 0.95);
            g.stroke();
          }
        }
        g.lineCap = 'butt';
      }
    }
  }

  // Winter: ice, a snowy shore and dry reeds
  function paintFrozenLake(g, lake, fillAll) {
    fillAll(9, 'rgba(255,255,255,0.55)');   // snow drift around
    fillAll(4.5, '#c6d0d8');                // frozen mud
    fillAll(1.5, '#8db3c8');                // edge
    fillAll(0, '#cfe6f1');                  // ice
    fillAll(-12, '#c3dcea');
    const m = lake.circles[0];
    // white streaks
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const y = m.y - m.r * 0.4 + i * m.r * 0.35;
      g.beginPath(); g.moveTo(m.x - m.r * 0.5, y); g.lineTo(m.x - m.r * 0.1, y - m.r * 0.18); g.stroke();
    }
    // cracks
    g.strokeStyle = 'rgba(110,150,175,0.6)';
    g.lineWidth = 1;
    let seed = Math.floor(m.x * 7 + m.y * 13);
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 4; i++) {
      let x = m.x + (rnd() - 0.5) * m.r, y = m.y + (rnd() - 0.5) * m.r;
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 4; j++) {
        x += (rnd() - 0.5) * 18; y += (rnd() - 0.5) * 18;
        if (inWater(lake, x, y, -4)) g.lineTo(x, y);
      }
      g.stroke();
    }
    // dry reeds and snowy stones on the shore
    for (const sp of lake.shore) {
      const { x, y, size } = sp;
      if (sp.kind === 'stone') {
        g.fillStyle = '#8f8d84';
        g.beginPath(); g.ellipse(x, y, 3.2 * size, 2.4 * size, sp.a, 0, TAU); g.fill();
        g.fillStyle = '#ffffff';
        g.beginPath(); g.ellipse(x - 0.5, y - 0.8, 2.4 * size, 1.4 * size, sp.a, 0, TAU); g.fill();
      } else if (sp.kind !== 'flower') {
        g.lineCap = 'round';
        for (let k = 0; k < 4; k++) {
          const a = sp.a + (k / 3 - 0.5) * 1.4;
          const L = (6 + (k % 3) * 2) * size;
          g.strokeStyle = k % 2 ? '#8b7a52' : '#a69466';
          g.lineWidth = 1.2;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
        }
        g.lineCap = 'butt';
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Ducks: paddle around the lakes, flee from the dog, sometimes dabble or quack
  // ---------------------------------------------------------------------------
  function randomWaterPoint(lake, margin) {
    for (let i = 0; i < 40; i++) {
      const c = lake.circles[Math.floor(Math.random() * lake.circles.length)];
      if (c.r <= margin + 2) continue;
      const a = rand(0, TAU), rr = Math.sqrt(Math.random()) * (c.r - margin);
      const x = c.x + Math.cos(a) * rr, y = c.y + Math.sin(a) * rr;
      if (inWater(lake, x, y, -margin)) return { x, y };
    }
    return { x: lake.circles[0].x, y: lake.circles[0].y };
  }

  // How many ducks per lake depends on the season:
  // spring: they slowly come back from the south, summer: most (with ducklings),
  // fall: they fly south again, winter: none (the lakes are frozen)
  function populateDucks() {
    ducks = [];
    const si = seasonIndex(), sd = seasonDay();
    for (const lake of lakes) {
      let n = 0, kids = false;
      if (si === 0) n = Math.round(rand(0, 1 + sd * 0.5));
      else if (si === 1) { n = Math.random() < 0.25 ? 1 : Math.random() < 0.6 ? 2 : 3; kids = true; }
      else if (si === 2) n = Math.round(rand(0, 2 - sd * 0.7));
      addDucks(lake, n, kids);
    }
  }

  function addDucks(lake, n, withKids) {
    for (let i = 0; i < n; i++) {
      const p = randomWaterPoint(lake, 10);
      const duck = {
        lake, x: p.x, y: p.y, tx: p.x, ty: p.y, ang: rand(0, TAU), sp: 0,
        male: i % 2 === 0, scared: false, dabbleT: 0, nextT: rand(1, 4), kids: [],
      };
      ducks.push(duck);
      // sometimes a mother duck with a few ducklings paddling behind her
      if (withKids && !duck.male && Math.random() < 0.7) {
        const k = Math.round(rand(2, 4));
        let lead = duck;
        for (let j = 0; j < k; j++) {
          const kid = { lead, x: lead.x - Math.cos(duck.ang) * 7, y: lead.y - Math.sin(duck.ang) * 7, ang: duck.ang };
          duck.kids.push(kid);
          lead = kid;
        }
      }
    }
  }

  function updateDucks(dt) {
    for (const d of ducks) {
      const lake = d.lake;
      const dd = dog ? Math.hypot(dog.x - d.x, dog.y - d.y) : 1e9;
      const scared = dd < 85;
      if (scared && !d.scared) {
        // the dog came too close: swim to the far side
        let best = null, bd = -1;
        for (let i = 0; i < 8; i++) {
          const q = randomWaterPoint(lake, 9);
          const qd = Math.hypot(q.x - dog.x, q.y - dog.y);
          if (qd > bd) { bd = qd; best = q; }
        }
        d.tx = best.x; d.ty = best.y;
        d.dabbleT = 0;
        if (Math.random() < 0.6) addFloat(d.x, d.y + 8, tr('quack2'), '#fff6c8');
      }
      d.scared = scared;

      d.nextT -= dt;
      if (d.dabbleT > 0) d.dabbleT -= dt;
      const dist2t = Math.hypot(d.tx - d.x, d.ty - d.y);
      if (!scared && d.nextT <= 0) {
        d.nextT = rand(2, 6);
        if (Math.random() < 0.3 && d.kids.length === 0) d.dabbleT = rand(1.5, 3);   // head under water
        else { const q = randomWaterPoint(lake, 10); d.tx = q.x; d.ty = q.y; }
        if (Math.random() < 0.08) addFloat(d.x, d.y + 8, tr('quack'), '#fff6c8');
      }
      const want = d.dabbleT > 0 || dist2t < 3 ? 0 : scared ? 38 : 11;
      d.sp += (want - d.sp) * Math.min(1, 3 * dt);
      if (dist2t > 1) {
        const ta = Math.atan2(d.ty - d.y, d.tx - d.x);
        d.ang += Math.atan2(Math.sin(ta - d.ang), Math.cos(ta - d.ang)) * Math.min(1, 4 * dt);
      }
      const nx = d.x + Math.cos(d.ang) * d.sp * dt, ny = d.y + Math.sin(d.ang) * d.sp * dt;
      if (inWater(lake, nx, ny, -7)) { d.x = nx; d.y = ny; }
      else { const q = randomWaterPoint(lake, 10); d.tx = q.x; d.ty = q.y; }

      // ducklings follow in a line
      for (const k of d.kids) {
        const gx = k.lead.x - Math.cos(k.lead.ang) * 7, gy = k.lead.y - Math.sin(k.lead.ang) * 7;
        const kd = Math.hypot(gx - k.x, gy - k.y);
        if (kd > 0.3) {
          const step = Math.min(kd, (d.sp + 12) * 1.3 * dt);
          const kx = k.x + ((gx - k.x) / kd) * step, ky = k.y + ((gy - k.y) / kd) * step;
          if (inWater(lake, kx, ky, -3)) { k.x = kx; k.y = ky; }
          const ta = Math.atan2(k.lead.y - k.y, k.lead.x - k.x);
          k.ang += Math.atan2(Math.sin(ta - k.ang), Math.cos(ta - k.ang)) * Math.min(1, 6 * dt);
        }
      }
    }
  }

  function drawDuckling(k) {
    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.rotate(k.ang);
    ctx.fillStyle = '#e9c95c';
    ctx.beginPath(); ctx.ellipse(-0.5, 0, 3.4, 2.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#8a6a3a';
    ctx.beginPath(); ctx.ellipse(-1, 0, 2, 1.2, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f0d36a';
    ctx.beginPath(); ctx.arc(2.6, 0, 1.8, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e09a3a';
    ctx.beginPath(); ctx.ellipse(4.4, 0, 1, 0.6, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawDuck(d) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.ang);
    // little wake while swimming
    if (d.sp > 4) {
      ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.45, d.sp / 60)})`;
      ctx.lineWidth = 1;
      for (const sgn of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(-6, sgn * 3.5); ctx.lineTo(-13, sgn * 6.5); ctx.stroke();
      }
    }
    if (d.dabbleT > 0) {
      // dabbling: only the tail sticks out, with rings on the water
      const ph = (state.t * 1.5) % 1;
      ctx.strokeStyle = `rgba(255,255,255,${0.4 * (1 - ph)})`;
      ctx.beginPath(); ctx.ellipse(1, 0, 6 + ph * 6, 4 + ph * 4, 0, 0, TAU); ctx.stroke();
      ctx.fillStyle = d.male ? '#6e6a63' : '#8d6d47';
      ctx.beginPath(); ctx.ellipse(-1, 0, 4, 3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = d.male ? '#f2f2ee' : '#5e4a34';
      ctx.beginPath(); ctx.moveTo(-4, -1.5); ctx.lineTo(-7.5, 0); ctx.lineTo(-4, 1.5); ctx.closePath(); ctx.fill();
      ctx.restore();
      return;
    }
    // body
    ctx.fillStyle = d.male ? '#9b958b' : '#9a7a50';
    ctx.beginPath(); ctx.ellipse(-1, 0, 7, 4.6, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(40,30,20,0.55)'; ctx.lineWidth = 0.8; ctx.stroke();
    // folded wings with the blue patch
    ctx.fillStyle = d.male ? '#7c766c' : '#7d603c';
    ctx.beginPath(); ctx.ellipse(-2.5, 0, 5, 3.3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3c5fd8';
    for (const sgn of [-1, 1]) ctx.fillRect(-3.5, sgn * 2.6 - 0.6, 2.4, 1.2);
    // tail
    ctx.fillStyle = d.male ? '#1d1d1d' : '#6a5134';
    ctx.beginPath(); ctx.moveTo(-7, -1.6); ctx.lineTo(-10, 0); ctx.lineTo(-7, 1.6); ctx.closePath(); ctx.fill();
    if (d.male) {                                          // chestnut breast + white collar
      ctx.fillStyle = '#7a3f24';
      ctx.beginPath(); ctx.ellipse(3.6, 0, 2.4, 3.4, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#f4f4f0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(6, 0, 2.6, Math.PI * 0.6, Math.PI * 1.4); ctx.stroke();
    }
    // head + bill
    ctx.fillStyle = d.male ? '#1f6e3c' : '#8c6b45';
    ctx.beginPath(); ctx.arc(6.2, 0, 3, 0, TAU); ctx.fill();
    ctx.fillStyle = d.male ? '#e8c53a' : '#e0913a';
    ctx.beginPath(); ctx.ellipse(9.5, 0, 2.3, 1.25, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#111';
    for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.arc(6.8, sgn * 1.5, 0.55, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  function drawDucks() {
    for (const d of ducks) {
      for (const k of d.kids) drawDuckling(k);
      drawDuck(d);
    }
  }

  // gentle moving ripples on the lakes
  function drawLakeRipples() {
    if (isWinter()) return;   // frozen
    ctx.lineWidth = 1;
    for (const lake of lakes) {
      const m = lake.circles[0];
      for (const rp of lake.ripples) {
        const ph = (state.t * 0.35 + rp.ph) % 1;
        const r = 3 + ph * m.r * 0.35;
        ctx.strokeStyle = `rgba(255,255,255,${0.28 * (1 - ph)})`;
        ctx.beginPath(); ctx.ellipse(rp.x, rp.y, r, r * 0.75, 0, 0, TAU); ctx.stroke();
      }
    }
  }

  function paintObstacleLayer() {
    const g = obstacleLayer.getContext('2d');
    g.clearRect(0, 0, FW, FH);
    paintStreams(g);
    for (const lake of lakes) paintLake(g, lake);
    // tree shadows + trunks
    for (const t of trees) {
      g.fillStyle = seasonIndex() === 3 ? 'rgba(60,80,110,0.05)' : 'rgba(0,0,0,0.16)';
      g.beginPath(); g.ellipse(t.x + 9, t.y + 11, t.R * 0.95, t.R * 0.85, 0, 0, TAU); g.fill();
      g.fillStyle = '#6b4423';
      g.beginPath(); g.arc(t.x, t.y, t.r, 0, TAU); g.fill();
      g.strokeStyle = '#3e2612'; g.lineWidth = 1.5; g.stroke();
      g.strokeStyle = 'rgba(40,20,5,0.6)'; g.lineWidth = 1;
      g.beginPath(); g.arc(t.x, t.y, t.r * 0.55, 0, TAU); g.stroke(); // tree rings
    }
    // rocks
    for (const rk of rocks) {
      const path = (dx = 0, dy = 0, sc = 1) => {
        g.beginPath();
        rk.pts.forEach(([px, py], i) => {
          const x = rk.x + px * sc + dx, y = rk.y + py * sc + dy;
          if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
        });
        g.closePath();
      };
      g.fillStyle = 'rgba(0,0,0,0.22)'; path(3, 4); g.fill();   // shadow
      const grd = g.createLinearGradient(rk.x - rk.r, rk.y - rk.r, rk.x + rk.r, rk.y + rk.r);
      grd.addColorStop(0, '#b3b2aa'); grd.addColorStop(1, '#6f6e68');
      g.fillStyle = grd; path(); g.fill();
      g.strokeStyle = '#4d4c47'; g.lineWidth = 1.5; g.lineJoin = 'round'; g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.18)'; path(-rk.r * 0.18, -rk.r * 0.2, 0.5); g.fill(); // highlight
      g.strokeStyle = 'rgba(60,60,55,0.6)'; g.lineWidth = 1;                                 // crack
      g.beginPath();
      g.moveTo(rk.x - rk.r * 0.3, rk.y + rk.r * 0.1);
      g.lineTo(rk.x, rk.y + rk.r * 0.25);
      g.lineTo(rk.x + rk.r * 0.25, rk.y + rk.r * 0.05);
      g.stroke();
      // moss
      g.fillStyle = 'rgba(90,130,60,0.5)';
      g.beginPath(); g.arc(rk.x + rk.r * 0.35, rk.y + rk.r * 0.45, rk.r * 0.18, 0, TAU); g.fill();
      if (seasonIndex() === 3) {                         // snow cap
        g.fillStyle = 'rgba(250,252,255,0.95)'; path(-rk.r * 0.08, -rk.r * 0.16, 0.72); g.fill();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Seasons: ground layer (flowers / leaves / snow) and weather
  // ---------------------------------------------------------------------------
  const seasonLayer = document.createElement('canvas');
  seasonLayer.width = FW; seasonLayer.height = FH;
  let weather = [];   // snowflakes or falling leaves
  let groundLeaves = [];  // fall: leaves on the ground that the wind pushes around
  let bees = [];          // spring/summer: bees buzzing around the trees
  let prints = [];        // winter: paw and hoof prints in the snow
  const PRINT_LIFE = 10;  // seconds until a print has vanished
  // Wind: occasional gusts from a changing direction. Leaves are pulled back to
  // their spot by a soft spring, so on average they stay where they are.
  const wind = { dir: rand(0, TAU), gust: 0, t: 0, next: rand(2, 5), len: 3 };

  // Fall: leaves blown onto the patio (more fall every morning; the farmer rakes them up)
  function addPatioLeaves(n) {
    const cols = ['#e3a32b', '#d9772b', '#c4512a', '#e8c547', '#b8862f'];
    for (let i = 0; i < n; i++) {
      groundLeaves.push({
        hx: rand(P.x + 6, P.x + P.w - 6), hy: rand(P.y + 4, P.y + P.h - 4), ox: 0, oy: 0, vx: 0, vy: 0, rot: rand(0, TAU),
        w: rand(2, 3.4), h: rand(1.1, 1.8), col: cols[Math.floor(Math.random() * cols.length)], k: rand(0.5, 1.5),
      });
    }
  }

  function paintSeasonLayer() {
    const g = seasonLayer.getContext('2d');
    g.clearRect(0, 0, FW, FH);
    groundLeaves = [];
    const si = seasonIndex();
    const notStable = (x, y) => !(x > S.x - 6 && x < S.x + S.w + 6 && y > S.y - 6 && y < S.bottom + 6);
    const dot = (x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); };
    if (si === 0) {
      // spring: fresh green and lots of flowers in little clusters
      g.fillStyle = 'rgba(150,230,90,0.10)';
      g.fillRect(8, 8, FW - 16, FH - 16);
      const cols = ['#ffffff', '#ffe66d', '#ff9ecd', '#c9b6ff', '#8ec5ff', '#ff8a7a'];
      for (let c = 0; c < 70; c++) {
        const cx = rand(15, FW - 15), cy = rand(15, FH - 15);
        const col = cols[Math.floor(Math.random() * cols.length)];
        const n = Math.round(rand(4, 10));
        for (let i = 0; i < n; i++) {
          const x = cx + rand(-14, 14), y = cy + rand(-10, 10);
          if (!notStable(x, y)) continue;
          dot(x, y, rand(1.6, 2.4), col);
          dot(x, y, 0.8, col === '#ffe66d' ? '#ff9d2e' : '#ffe66d');
        }
      }
    } else if (si === 2) {
      // fall: golden grass and fallen leaves, most of them under the trees
      g.fillStyle = 'rgba(205,150,40,0.20)';
      g.fillRect(8, 8, FW - 16, FH - 16);
      // the fallen leaves themselves are animated (wind), see groundLeaves
      const cols = ['#e3a32b', '#d9772b', '#c4512a', '#e8c547', '#b8862f'];
      const leaf = (x, y) => {
        if (!notStable(x, y)) return;
        groundLeaves.push({
          hx: x, hy: y, ox: 0, oy: 0, vx: 0, vy: 0, rot: rand(0, TAU),
          w: rand(2, 3.4), h: rand(1.1, 1.8), col: cols[Math.floor(Math.random() * cols.length)],
          k: rand(0.5, 1.5),   // how easily the wind moves this leaf
        });
      };
      for (let i = 0; i < 320; i++) leaf(rand(10, FW - 10), rand(10, FH - 10));
      addPatioLeaves(28);                                  // and a good few on the patio
      for (const t of trees) {
        for (let i = 0; i < 55; i++) {
          const a = rand(0, TAU), r = Math.sqrt(Math.random()) * t.R * 1.15;
          leaf(t.x + Math.cos(a) * r, t.y + Math.sin(a) * r);
        }
      }
    } else if (si === 3) {
      // winter: snow
      g.fillStyle = 'rgba(232,239,246,0.9)';
      g.fillRect(6, 6, FW - 12, FH - 12);
      for (let i = 0; i < 80; i++) {                      // soft drifts
        g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.28)' : 'rgba(190,205,225,0.12)';
        g.beginPath(); g.ellipse(rand(0, FW), rand(0, FH), rand(18, 50), rand(8, 20), rand(-0.3, 0.3), 0, TAU); g.fill();
      }
      g.strokeStyle = 'rgba(70,100,50,0.35)';             // a few grass blades poking through
      g.lineWidth = 1;
      for (let i = 0; i < 260; i++) {
        const x = rand(10, FW - 10), y = rand(10, FH - 10);
        if (!notStable(x, y)) continue;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-2, 2), y - rand(2, 5)); g.stroke();
      }
      for (let i = 0; i < 500; i++) dot(rand(0, FW), rand(0, FH), rand(0.5, 1.2), 'rgba(160,180,205,0.35)');
    }
  }

  // Each winter day gets random snowfall: none / light / moderate / heavy
  function pickSnow() {
    const ch = CFG.winter.snowChance;
    let r = Math.random() * ch.reduce((a, b) => a + b, 0);
    state.snowLevel = ch.length - 1;
    for (let i = 0; i < ch.length; i++) { r -= ch[i]; if (r <= 0) { state.snowLevel = i; break; } }
  }

  // Repaint everything that looks different in the new season
  function applySeason() {
    paintSeasonLayer();
    paintObstacleLayer();
    weather = [];
    bees = [];
    prints = [];
  }

  function updateWind(dt) {
    wind.next -= dt;
    if (wind.next <= 0 && wind.t <= 0) {          // a new gust from a new direction
      wind.dir = wind.dir + Math.PI + rand(-1.2, 1.2);
      wind.len = rand(2.5, 4.5);
      wind.t = wind.len;
      wind.amp = rand(0.6, 1);
      wind.next = rand(3, 7);
    }
    if (wind.t > 0) {
      wind.t -= dt;
      wind.gust = Math.sin(Math.PI * (1 - wind.t / wind.len)) * wind.amp;   // smooth up and down
    } else wind.gust = 0;
  }

  function updateGroundLeaves(dt) {
    if (!groundLeaves.length) return;
    const fx = Math.cos(wind.dir) * wind.gust, fy = Math.sin(wind.dir) * wind.gust;
    // a runner leaves a little whirlwind behind it: leaves in its wake swirl up (nothing happens in front)
    const movers = [];
    const add = (e, minSp, R, power) => {
      if (!e || inStable(e)) return;
      const sp = Math.hypot(e.vx, e.vy);
      if (sp > minSp) movers.push({ x: e.x, y: e.y, ux: e.vx / sp, uy: e.vy / sp, R, f: power * Math.min(1, (sp - minSp) / 120) });
    };
    if (state.screen === 'play') {
      add(dog, 35, 30, 1);
      for (const w of wolves) add(w, 60, 24, 0.7);
      for (const s of sheep) add(s, 55, 16, 0.45);
    }
    for (const L of groundLeaves) {
      // wind pushes, a soft spring pulls back home, damping keeps it slow
      L.vx += (fx * 18 * L.k - L.ox * 0.9 - L.vx * 1.6) * dt;
      L.vy += (fy * 18 * L.k - L.oy * 0.9 - L.vy * 1.6) * dt;
      for (const m of movers) {
        const x = L.hx + L.ox, y = L.hy + L.oy, rx = x - m.x, ry = y - m.y;
        const nx = -m.uy, ny = m.ux;
        const along = rx * m.ux + ry * m.uy, lat = rx * nx + ry * ny;
        if (along > 0) continue;                                   // in front of it: untouched
        const back = -along, len = m.R * 2.2, wid = m.R * (0.55 + 0.35 * back / len);
        if (back > len || Math.abs(lat) > wid) continue;
        const f = m.f * (1 - back / len) * (1 - Math.abs(lat) / wid) * L.k * 760 * dt;
        // two small eddies behind it (one on each side, turning opposite ways), dragged along behind
        const side = lat >= 0 ? 1 : -1;
        const cx = m.x - m.ux * m.R * 0.8 + nx * side * m.R * 0.25, cy = m.y - m.uy * m.R * 0.8 + ny * side * m.R * 0.25;
        let tx = -(y - cy) * side, ty = (x - cx) * side;
        const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
        L.vx += (tx * 1.0 + m.ux * 0.55) * f;
        L.vy += (ty * 1.0 + m.uy * 0.55) * f;
        L.kick = 1.4;
      }
      L.ox += L.vx * dt;
      L.oy += L.vy * dt;
      L.rot += (L.vx - L.vy) * 0.04 * dt * L.k + (L.kick > 0 ? Math.hypot(L.vx, L.vy) * 0.08 * dt : 0);
      if (L.kick > 0) {
        // a leaf that was blown away stays where it lands (its resting place moves with it)
        L.kick -= dt;
        const c = Math.min(1, 2.5 * dt);
        L.hx = clamp(L.hx + L.ox * c, 8, FW - 8); L.hy = clamp(L.hy + L.oy * c, 8, FH - 8);
        L.ox -= L.ox * c; L.oy -= L.oy * c;
      }
    }
  }

  function drawGroundLeaves() {
    for (const L of groundLeaves) {
      ctx.fillStyle = L.col;
      ctx.beginPath(); ctx.ellipse(L.hx + L.ox, L.hy + L.oy, L.w, L.h, L.rot, 0, TAU); ctx.fill();
    }
  }

  // Footprints: every few steps an animal leaves a print (alternating left/right)
  function trackPrints(e, kind) {
    if (e.lpx === undefined) { e.lpx = e.x; e.lpy = e.y; e.stepD = 0; e.side = 1; return; }
    const d = Math.hypot(e.x - e.lpx, e.y - e.lpy);
    e.lpx = e.x; e.lpy = e.y;
    if (d > 30) return;                                // teleported (new morning)
    e.stepD += d;
    const stride = kind === 'sheep' ? 9 : kind === 'wolf' ? 13 : kind === 'boot' ? 12 : 11;
    if (e.stepD < stride) return;
    e.stepD = 0;
    if (inStable(e) || e.x < 0 || e.x > FW || e.y < 0 || e.y > FH) return;
    const ang = Math.atan2(e.vy, e.vx);
    e.side = -e.side;
    const off = kind === 'sheep' ? 3 : 3.5;
    prints.push({ x: e.x - Math.sin(ang) * off * e.side, y: e.y + Math.cos(ang) * off * e.side, ang, kind, t: PRINT_LIFE });
  }

  function updatePrints(dt) {
    if (!isWinter()) { if (prints.length) prints = []; return; }
    if (dog) trackPrints(dog, 'dog');
    for (const s of sheep) trackPrints(s, 'sheep');
    for (const w of wolves) trackPrints(w, 'wolf');
    if (farmerOut()) trackPrints(farmer, 'boot');
    for (const p of prints) p.t -= dt;
    prints = prints.filter((p) => p.t > 0);
    if (prints.length > 2500) prints.splice(0, prints.length - 2500);
  }

  function drawPrints() {
    for (const p of prints) {
      const a = Math.min(1, p.t / 4) * (p.kind === 'wolf' ? 0.55 : 0.45);   // fade out during the last 4 s
      ctx.fillStyle = p.kind === 'wolf' ? `rgba(55,65,85,${a})` : `rgba(95,115,145,${a})`;
      const c = Math.cos(p.ang), sn = Math.sin(p.ang);
      const dot = (fx, fy, rx, ry) => {               // fx forward, fy sideways (in print space)
        ctx.beginPath();
        ctx.ellipse(p.x + c * fx - sn * fy, p.y + sn * fx + c * fy, rx, ry, p.ang, 0, TAU);
        ctx.fill();
      };
      if (p.kind === 'sheep') {                       // cloven hoof: two little halves
        dot(0.6, -0.95, 1.5, 0.75);
        dot(0.6, 0.95, 1.5, 0.75);
      } else if (p.kind === 'boot') {                 // the farmer's boot: sole and heel
        dot(1.2, 0, 2.6, 1.4);
        dot(-2.6, 0, 1.3, 1.25);
      } else {                                        // paw: pad + four toes
        const k = p.kind === 'wolf' ? 1.2 : 1;
        dot(-0.6 * k, 0, 1.3 * k, 1.5 * k);
        dot(1.5 * k, -1.6 * k, 0.6 * k, 0.6 * k);
        dot(2.2 * k, -0.55 * k, 0.6 * k, 0.6 * k);
        dot(2.2 * k, 0.55 * k, 0.6 * k, 0.6 * k);
        dot(1.5 * k, 1.6 * k, 0.6 * k, 0.6 * k);
      }
    }
  }

  // Bees: a few around each tree in spring and summer, only in daylight
  function updateBees(dt) {
    const si = seasonIndex();
    const want = si <= 1 ? trees.length * 2 + (si === 1 ? trees.length : 0) : 0;
    if (bees.length !== want) {
      bees = [];
      trees.forEach((t, i) => {
        const n = si === 1 ? 3 : 2;
        for (let k = 0; k < n && bees.length < want; k++) {
          bees.push({ tree: t, a: rand(0, TAU), r: t.R * rand(0.55, 1.05), sp: rand(1.2, 2.4) * (Math.random() < 0.5 ? -1 : 1),
            ph: rand(0, TAU), x: t.x, y: t.y, wob: rand(3, 8) });
        }
      });
    }
    for (const b of bees) {
      b.a += b.sp * dt * (0.6 + 0.4 * Math.sin(b.ph * 0.7));
      b.ph += dt * 9;
      const r = b.r + Math.sin(b.ph * 0.5) * b.wob;
      const nx = b.tree.x + Math.cos(b.a) * r + Math.sin(b.ph) * 2;
      const ny = b.tree.y + Math.sin(b.a) * r * 0.85 + Math.cos(b.ph * 1.3) * 2;
      b.ang = Math.atan2(ny - b.y, nx - b.x);
      b.x = nx; b.y = ny;
    }
  }

  function drawBees(dark) {
    if (!bees.length || dark > 0.25) return;
    ctx.globalAlpha = 1 - dark * 4;
    for (const b of bees) {
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.ang || 0);
      ctx.scale(1.04, 1.04);
      const flap = Math.sin(state.t * 60 + b.ph) * 0.6;
      ctx.fillStyle = 'rgba(235,245,255,0.8)';                  // wings
      ctx.beginPath(); ctx.ellipse(-0.5, -2.2, 2.2, 1.2 + flap * 0.5, -0.4, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-0.5, 2.2, 2.2, 1.2 + flap * 0.5, 0.4, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f4c21b';                                // body
      ctx.beginPath(); ctx.ellipse(0, 0, 3, 2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a1a1a';                                // stripes + head
      ctx.fillRect(-1.6, -1.8, 1, 3.6);
      ctx.fillRect(0.2, -1.9, 1, 3.8);
      ctx.beginPath(); ctx.arc(2.8, 0, 1.1, 0, TAU); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function updateWeather(dt) {
    updateWind(dt);
    updateGroundLeaves(dt);
    updateBees(dt);
    const si = seasonIndex();
    // winter: today's snowfall, with slow lulls and flurries during the day
    const flurry = 0.75 + 0.25 * Math.sin(state.t * 0.09) * Math.sin(state.t * 0.031 + 1);
    state.flurry = flurry;
    const bz = blizzardLevel();
    const snow = (CFG.winter.snowFlakes[state.snowLevel] || 0) * (bz ? 1.6 : 1);
    const want = si === 3 ? Math.round(snow * (bz ? Math.max(flurry, bz) : flurry)) : si === 2 ? 14 : 0;
    const heavy = state.snowLevel === 3;
    const fresh = weather.length === 0;   // just started: fill the whole sky, not only the top
    while (weather.length < want) {
      weather.push({
        x: rand(0, FW), y: fresh ? rand(-20, FH) : rand(-40, 0), vy: si === 3 ? rand(18, 40) * (heavy ? 1.4 : 1) : rand(20, 35),
        vx: rand(-8, 8) + (heavy ? 14 : 0), r: si === 3 ? rand(1.4, heavy ? 3.4 : 2.8) : rand(2.2, 3.4), ph: rand(0, TAU),
        col: ['#e3a32b', '#d9772b', '#c4512a', '#e8c547'][Math.floor(Math.random() * 4)],
      });
    }
    if (weather.length > want) weather.length = want;
    const storm = si === 3 && bz ? 240 * bz : 0;              // the blizzard drives the snow sideways
    for (const f of weather) {
      f.ph += dt * 2;
      f.x += (f.vx + Math.sin(f.ph) * 12 + Math.cos(wind.dir) * wind.gust * (si === 2 ? 30 : 20) + storm) * dt;
      f.y += f.vy * dt * (storm ? 0.7 : 1);
      if (f.y > FH + 5) { f.y = -5; f.x = rand(0, FW); }
      if (f.x < -5) f.x = FW + 5; else if (f.x > FW + 5) f.x = -5;
    }
  }

  function drawWeather() {
    const winter = isWinter();
    for (const f of weather) {
      if (winter && state.blizzard) {
        // storm: streaks of snow flying past
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = f.r * 0.8; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x - 10 - f.r * 5, f.y - 2.5); ctx.stroke();
        ctx.lineCap = 'butt';
      } else if (winter) {
        // a soft shadow under each flake so it shows up against the white snow
        ctx.fillStyle = 'rgba(70,90,120,0.28)';
        ctx.beginPath(); ctx.arc(f.x + 1.2, f.y + 1.6, f.r, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.fill();
      } else {
        ctx.fillStyle = f.col;
        ctx.beginPath(); ctx.ellipse(f.x, f.y, f.r, f.r * 0.55, f.ph, 0, TAU); ctx.fill();
      }
    }
  }

  // Push a circle out of all trunks and rocks
  function collideSolids(e) {
    for (const o of solids) {
      if (o.hut && e === dog) continue;             // the dog can go into its hut
      let nx = e.x - o.x, ny = e.y - o.y;
      const d = Math.hypot(nx, ny);
      const min = o.r + e.r;
      if (d < min) {
        if (d < 1e-6) { nx = 1; ny = 0; } else { nx /= d; ny /= d; }
        e.x = o.x + nx * min;
        e.y = o.y + ny * min;
        const vn = e.vx * nx + e.vy * ny;
        if (vn < 0) { e.vx -= vn * nx; e.vy -= vn * ny; }
      }
    }
  }

  // Steer around trunks / rocks that lie ahead (keeps the speed)
  function avoidSolids(e, vx, vy, maxDist = 1e9) {
    const sp = Math.hypot(vx, vy);
    if (sp < 1) return [vx, vy];
    const ux = vx / sp, uy = vy / sp, px = -uy, py = ux;
    let ax = 0, ay = 0;
    for (const o of tractorHere() ? solids.concat(tractor.circles) : solids) {
      if (o.hut && e === dog) continue;
      const tx = o.x - e.x, ty = o.y - e.y;
      const ahead = tx * ux + ty * uy;
      const look = 45 + o.r;
      if (ahead <= 0 || ahead > look || ahead > maxDist + o.r) continue;
      const lat = tx * px + ty * py;
      const clear = o.r + e.r + 5;
      if (Math.abs(lat) >= clear) continue;
      const side = lat > 0 ? -1 : 1;
      const k = 1.6 * (1 - Math.abs(lat) / clear) * (1 - (ahead / look) * 0.5);
      ax += px * side * k; ay += py * side * k;
    }
    if (!ax && !ay) return [vx, vy];
    const nx = ux + ax, ny = uy + ay, n = Math.hypot(nx, ny) || 1;
    return [(nx / n) * sp, (ny / n) * sp];
  }

  // Tree whose canopy covers this point (animals can hide underneath)
  function underCanopy(p) {
    if (isWinter()) return null;   // bald trees: nowhere to hide
    for (const t of trees) if (Math.hypot(p.x - t.x, p.y - t.y) < t.R - 6) return t;
    return null;
  }

  // ---------------------------------------------------------------------------
  // Wolves
  // ---------------------------------------------------------------------------
  // perSheep x N^power wolves for N sheep (default: the square root, so a bigger
  // flock brings more wolves, but fewer per sheep), scaled by the player's wolf
  // setting, then randomly +/- randomness (at least one).
  function packBase(nSheep) {
    const P = CFG.pack;
    return P.perSheep * Math.pow(Math.max(0, nSheep), P.power) * (1 + state.wolfAdj / 100);
  }
  function packSize(nSheep) {
    const f = 1 + rand(-CFG.pack.randomness, CFG.pack.randomness);
    return Math.max(1, Math.round(packBase(nSheep) * f));
  }

  function queueWolves(n, night, firstDelay = 0) {
    if (state.relax) return;                     // relax mode: no wolves
    let t = firstDelay;
    for (let i = 0; i < n; i++) {
      state.spawnQ.push({ t, night });
      t += rand(CFG.pack.stagger[0], CFG.pack.stagger[1]);
    }
  }

  function scheduleDayWolves() {
    if (state.relax) { state.dayWolfAt = null; return; }
    const chance = state.day < 2 ? 0 : CFG.pack.dayChance;
    const se = season();
    state.dayWolfAt = Math.random() < chance ? rand(se.morning[1] + 0.5, se.evening[0] - 1.5) : null;
  }

  function spawnWolf(night) {
    if (state.relax) return;
    let best = { x: FW + 40, y: FH / 2 }, bd = -1;
    for (let i = 0; i < 12; i++) {
      const side = Math.floor(Math.random() * 4);
      let x, y;
      if (side === 0) { x = rand(0, FW); y = -40; }
      else if (side === 1) { x = FW + 40; y = rand(0, FH); }
      else if (side === 2) { x = rand(0, FW); y = FH + 40; }
      else { x = -40; y = rand(0, FH); }
      if (x < S.x + S.w + 40 && y < S.bottom + 40) continue; // not behind the stable
      const d = Math.hypot(x - dog.x, y - dog.y) + rand(0, 200);
      if (d > bd) { bd = d; best = { x, y }; }
    }
    wolves.push({
      x: best.x, y: best.y, vx: 0, vy: 0, r: CFG.wolf.r,
      night, mode: 'hunt', courage: CFG.wolf.courage + state.day * 0.3,
      eatT: 0, fx: 1, fy: 0, orbit: rand(0, TAU),
      howlT: night ? rand(1, 5) : rand(3, 9), attackT: 0, attackCD: rand(3, 6), retreatT: 0,
      ang: Math.atan2(FH / 2 - best.y, FW / 2 - best.x),
      phase: rand(0, TAU),                                   // trot animation offset
      fur: Array.from({ length: 14 }, () => Math.random()), // shaggy outline
    });
  }

  // ---------------------------------------------------------------------------
  // Start / new day
  // ---------------------------------------------------------------------------
  function startGame() {
    Object.assign(state, {
      screen: 'play', paused: false, day: 1, hour: CLOCK.start, best: 2, gameId: Date.now(),
      lost: 0, starved: 0, born: 0, floats: [], marker: null, spawnQ: [], fast: false,
      sheepTalkCD: 0, wolfTalkCD: 0,
      overDelay: 0, overReason: '', overT: 0,
    });
    wolves = [];
    dog = { x: S.cx, y: S.bottom + 160, tx: S.cx, ty: S.bottom + 160, vx: 0, vy: 0, r: CFG.dog.r,
            ang: -Math.PI / 2, moving: false, idleT: 0, boredAt: rand(4, 8), trick: null, stamina: 100,
            hurtT: 0, woofCD: 0, randWoofT: rand(10, 25) };
    sheep = [newSheep('m'), newSheep('f')];
    releaseFlock();
    // the map (trees, rocks, lakes, grass) is the one shown on the start screen
    applySeason();
    populateDucks();
    if (!patches.length) patches = generatePatches(sheep.length, true);
    for (const p of patches) p.amount = p.max;
    oldPatches = [];
    state.confirmExit = false;
    bowl.food = CFG.bowl.food;
    state.tractorDays = null; state.fogDays = null; state.blizzardDay = -1;
    Object.assign(deco, { flowers: null, mowed: null, snowman: null, trail: [] });
    growApples();
    planTractor();
    scheduleDayWolves();
    if (isWinter()) { pickSnow(); if (state.blizzard) state.snowLevel = 3; }
    showMsg(tr('firstDay', seasonName()) + (isWinter() ? ` — ${state.blizzard ? tr('blizzard') : tr('snow')[state.snowLevel]}` : '') +
            (state.foggy ? ` — ${tr('fog')}` : ''), 5);
  }

  // Called at midnight: hunger, births, then the next morning (5:30).
  function morning() {
    const prevSeason = seasonIndex();
    // One more night for everyone. Lambs grow up after their first night,
    // and can have lambs themselves from their second night on (matureNights).
    for (const s of sheep) {
      s.nights = (s.nights ?? 99) + 1;
      if (s.lamb) { s.lamb = false; s.r = CFG.sheep.r; }
    }
    // only grown-up, fully fed sheep that spend the night in the stable can have lambs
    const fedM = fedInStable('m'), fedF = fedInStable('f');

    // Hunger
    let starvedNow = 0;
    for (const s of sheep) {
      if (s.food >= 100) s.health = Math.min(100, s.health + rand(CFG.sheep.recoverMin, CFG.sheep.recoverMax));
      else s.health -= rand(CFG.sheep.hungerMin, CFG.sheep.hungerMax);
    }
    const before = sheep.length;
    sheep = sheep.filter((s) => s.health > 0);
    starvedNow = before - sheep.length;
    state.starved += starvedNow;

    // Births: each pair of a fed ram + a fed ewe gets one lamb
    // (2 rams + 2 ewes -> 2 lambs, 3 rams + 1 ewe -> 1 lamb)
    const births = Math.min(fedM, fedF);
    for (let i = 0; i < births; i++) {
      const l = newSheep();
      l.lamb = true; l.nights = 0; l.r = CFG.sheep.r * CFG.sheep.lambSize;
      sheep.push(l);
    }
    state.born += births;

    for (const s of sheep) s.food = 0;
    dog.stamina = 100; // the dog slept well
    bowl.food = CFG.bowl.food; // and the shepherd refilled the bowl

    state.day++;
    state.hour = CLOCK.start;
    const newSeason = seasonIndex() !== prevSeason;
    if (newSeason) applySeason();
    else if (seasonIndex() === 2) addPatioLeaves(18);   // fall: new leaves on the patio overnight
    // the farmer's traces through the seasons
    const siNow = seasonIndex();
    if (newSeason && siNow === 2) growApples();               // apples ripen in fall
    if (siNow === 3) deco.flowers = null;                      // the frost got the flowers
    if (deco.mowed && (siNow !== 1 || state.day - deco.mowed.day > 3)) deco.mowed = null;   // grown back
    if (deco.snowman && siNow !== 3) {                         // spring: it melts during the first day
      if (deco.snowman.melting) deco.snowman = null; else deco.snowman.melting = true;
    }
    populateDucks();
    wolves = [];
    state.spawnQ = [];
    oldPatches = [];
    for (const p of patches) p.amount = p.max;
    releaseFlock(false);
    state.best = Math.max(state.best, sheep.length);
    planTractor();
    scheduleDayWolves();

    const parts = [tr('day', state.day)];
    if (newSeason) parts.push(tr('seasonMsg')[seasonIndex()]);
    if (isWinter()) {
      pickSnow();
      if (state.blizzard) { state.snowLevel = 3; parts.push(tr('blizzard')); } else parts.push(tr('snow')[state.snowLevel]);
    }
    if (state.foggy) parts.push(tr('fog'));
    setTimeout(saveGame, 0);   // a new day: keep the game
    if (births) parts.push(tr('lambs', births));
    else parts.push(tr('noLambs'));
    if (starvedNow) parts.push(tr('starved', starvedNow));
    showMsg(parts.join(' — '), newSeason ? 6.5 : 5);

    checkExtinction();
  }

  // ---------------------------------------------------------------------------
  // Clock / phases
  // ---------------------------------------------------------------------------
  function updateClock(dt) {
    const se = season();
    const prev = phaseName();
    const night = prev === 'night';
    let rate = 1 / (night ? CLOCK.nightSecPerHour : CLOCK.daySecPerHour);
    if (night && unsafeSheep().length === 0) rate *= 6;   // night passes quickly once every sheep is safe
    const dh = dt * rate;
    state.hour += dh;

    if (prev === 'day' && state.dayWolfAt !== null && state.hour >= state.dayWolfAt) {
      state.dayWolfAt = null;
      const n = Math.max(1, Math.round(packSize(sheep.length) * CFG.pack.dayFraction));
      queueWolves(n, false);
      showMsg(tr('dayWolves', n));
    }

    // Cold: sheep outside the stable lose health at night (~5% over a whole night).
    // In winter they also get cold during the day (slowly) and very fast in the evening/night.
    const winter = isWinter();
    for (let i = sheep.length - 1; i >= 0; i--) {
      const s = sheep[i];
      if (inStable(s)) continue;
      let loss = 0;
      if (night) loss += CFG.sheep.coldNight * dh / (CLOCK.end - se.night);
      if (winter) {
        const W = CFG.winter;
        loss += (night ? W.nightDrain : prev === 'dusk' ? W.eveningDrain : W.dayDrain) * dt * (state.blizzard ? CFG.blizzard.cold : 1);
        if (prev !== 'day' && state.sheepTalkCD <= 0 && Math.random() < dt * 0.4) {
          say(s, tr('brr'), 'sheep');
          state.sheepTalkCD = 2;
        }
      }
      if (!loss) continue;
      s.health -= loss;
      if (s.health <= 0) {
        sheep.splice(i, 1);
        state.starved++;
        addFloat(s.x, s.y, tr('froze'), '#bfe3ff');
        checkExtinction();
      }
    }

    // Night: old grass withers, new grass grows somewhere else
    if (night) {
      const f = clamp((state.hour - se.night) / (CLOCK.end - se.night), 0, 1);
      for (const p of patches) p.amount = p.max * f;
      for (const p of oldPatches) p.amount = Math.max(0, p.amount - p.max * dh * CLOCK.nightSecPerHour / 4);
      oldPatches = oldPatches.filter((p) => p.amount > 0);
    }

    if (state.hour >= CLOCK.end) { morning(); return; }
    const now = phaseName();
    if (now !== prev) onPhaseStart(now);
  }

  function onPhaseStart(name) {
    if (name === 'dusk') {
      showMsg(tr('dusk', isWinter()), 4.5);
    } else if (name === 'night') {
      state.fast = false;
      const out = unsafeSheep().length;
      // the pack: wolves already here stay for the night, more may come
      const n = packSize(sheep.length);
      for (const w of wolves) { w.night = true; if (w.mode === 'leave') w.mode = 'hunt'; }
      for (const q of state.spawnQ) q.night = true;
      const missing = n - wolves.length - state.spawnQ.length;
      if (missing > 0) queueWolves(missing, true, 0.5);
      // grass regrows at different places
      const expectedLambs = Math.min(fedCount('m'), fedCount('f'));
      oldPatches = patches;
      patches = generatePatches(sheep.length + expectedLambs, false, seasonIndex(state.day + 1));
      if (state.relax) showMsg(out ? tr('nightOutRelax', out) : tr('nightSafeRelax'), 4);
      else showMsg(out ? tr('nightOut', n, out) : tr('nightSafe', n), 4);
    }
  }

  // ---------------------------------------------------------------------------
  // Dog
  // ---------------------------------------------------------------------------
  // Very small "path finding": go through the door when entering/leaving the stable.
  function dogWaypoint() {
    const target = { x: dog.tx, y: dog.ty };
    const dIn = inStable(dog), tIn = inStable(target);
    if (dIn === tIn) return target;
    if (dIn) return { x: S.cx, y: S.bottom + 16 };                       // leave through door
    if (dog.y < S.bottom + 12) return { x: S.cx, y: S.bottom + 26 };     // go around to the door first
    return { x: S.cx, y: S.bottom - 16 };                                 // enter through door
  }

  function dogMaxSpeed() {
    return dogSpeedNow() * (state.blizzard && !inStable(dog) ? CFG.blizzard.dogSlow : 1);
  }
  function dogSpeedNow() {
    const C = CFG.dog;
    if (dog.stamina <= 0.5) return C.speed * C.emptySpeed;   // completely out of breath
    if (dog.stamina < C.exhaustedAt) return C.speed * C.exhaustedSpeed;
    if (dog.stamina < C.tiredAt) return C.speed * C.tiredSpeed;
    return C.speed;
  }

  // Bark (key W or the WOOF button): for a moment the dog reaches further. Sheep move away from
  // further off, and wolves keep their distance and don't dare to attack.
  const dogBarking = () => !!dog && dog.barkT > 0;
  function bark() {
    if (state.screen !== 'play' || state.paused || !dog || (dog.barkCD || 0) > 0) return;
    dog.barkT = CFG.dog.barkTime; dog.barkCD = CFG.dog.barkCooldown;
    dog.sleeping = false; dog.hutT = 0; dog.trick = null; dog.idleT = 0;
    say(dog, tr('bark'), 'dog');
    dog.woofCD = Math.max(dog.woofCD, 1.5);
    // the flock answers: every sheep out on the pasture bleats once (handy in the fog!)
    for (const s of sheep) if (!inStable(s)) s.answerT = rand(0.2, 1.1);
  }

  function updateDog(dt) {
    if (dog.happyT > 0) dog.happyT -= dt;
    if (dog.barkT > 0) dog.barkT -= dt;
    if (dog.barkCD > 0) dog.barkCD -= dt;
    // In its hut and resting: the dog falls asleep (Zzz). It wakes up when you move it.
    if (inHut(dog) && !dog.moving) {
      dog.hutT = (dog.hutT || 0) + dt;
      if (dog.hutT > 1.2 && !dog.sleeping) { dog.sleeping = true; dog.zzzT = 0.3; dog.trick = null; }
    } else {
      if (dog.sleeping && dog.moving) say(dog, tr('yawn'), 'dog');
      dog.hutT = 0; dog.sleeping = false;
    }
    if (dog.sleeping) {
      dog.zzzT -= dt;
      if (dog.zzzT <= 0) { addFloat(HUT.x + 6, HUT.y - 8, tr('zzz'), '#cfe2ff'); dog.zzzT = 2.6; }
      dog.idleT = 0;
    }
    const wp = dogWaypoint();
    const dx = wp.x - dog.x, dy = wp.y - dog.y;
    const d = Math.hypot(dx, dy);
    let vx = 0, vy = 0;
    if (d > 1) {
      const sp = dogMaxSpeed() * Math.min(1, d / 25) * (inStream(dog) ? CFG.streams.dogSpeed : 1);
      vx = (dx / d) * sp; vy = (dy / d) * sp;
      [vx, vy] = avoidSolids(dog, vx, vy, d);
    }
    const k = Math.min(1, 12 * dt);
    dog.vx += (vx - dog.vx) * k;
    dog.vy += (vy - dog.vy) * k;
    dog.x += dog.vx * dt;
    dog.y += dog.vy * dt;
    const dsp = Math.hypot(dog.vx, dog.vy);

    // Stamina: running costs energy (more the faster it runs), resting restores it
    const C = CFG.dog;
    dog.eating = false;
    const heat = seasonIndex() === 1 ? CFG.summer.dogDrain : 1;
    if (dsp > 8) dog.stamina -= C.staminaDrain * heat * (dsp / C.speed) * dt;
    else if (bowl.food > 0 && dog.stamina < 100 && Math.hypot(dog.x - bowl.x, dog.y - bowl.y) < CFG.bowl.reach) {
      // eating from the bowl: 3x faster, the bowl empties by the same amount
      const gain = Math.min(C.staminaRecover * CFG.bowl.rate * dt, 100 - dog.stamina, bowl.food);
      dog.stamina += gain;
      bowl.food -= gain;
      dog.eating = true;
      dog.trick = null;
      dog.idleT = 0;
    } else dog.stamina += C.staminaRecover * dt * (dog.sleeping ? 2 : 1);   // sleeping: twice as fast
    dog.stamina = clamp(dog.stamina, 0, 100);
    dog.moving = dsp > 8;
    if (dog.hurtT > 0) dog.hurtT -= dt;

    // Woof woof! Especially when running towards a wolf
    dog.woofCD -= dt;
    dog.randWoofT -= dt;
    if (dog.moving && dog.woofCD <= 0) {
      let toward = false;
      for (const w of wolves) {
        if (w.mode !== 'hunt') continue;
        const wx = w.x - dog.x, wy = w.y - dog.y, wd = Math.hypot(wx, wy);
        if (wd < 230 && (wx * dog.vx + wy * dog.vy) / (wd * dsp) > 0.7) { toward = true; break; }
      }
      if (toward) { say(dog, tr('woof2'), 'dog'); dog.woofCD = rand(3, 5); }
      else if (dog.randWoofT <= 0) { say(dog, tr('woof'), 'dog'); dog.woofCD = 3; dog.randWoofT = rand(15, 35); }
    }

    if (dog.trick) {
      // bored dog doing something silly
      const tr = dog.trick;
      tr.t += dt;
      if (tr.type === 'chase') dog.ang += dt * TAU * 1.6;
      if (tr.t >= tr.dur) { dog.trick = null; dog.idleT = 0; dog.boredAt = rand(4, 8); }
      return;
    }

    // Getting bored when standing still for a while (not in the hut)
    if (dog.moving || inHut(dog)) dog.idleT = 0;
    else {
      dog.idleT += dt;
      if (dog.idleT >= dog.boredAt) {
        const type = Math.random() < 0.5 ? 'chase' : 'roll';
        dog.trick = { type, t: 0, dur: type === 'chase' ? rand(2.2, 3.2) : rand(2.8, 3.8) };
        if (type === 'chase' && Math.random() < 0.5) say(dog, tr('woof'), 'dog');
        return;
      }
    }

    // Running: look where it's going. Standing: look at the mouse cursor.
    let want = null;
    if (dog.moving) {
      want = Math.atan2(dog.vy, dog.vx);
    } else if (dog.eating) {
      want = Math.atan2(bowl.y - dog.y, bowl.x - dog.x); // head over the bowl
    } else if (mouse.inside && Math.hypot(mouse.x - dog.x, mouse.y - dog.y) > 14) {
      want = Math.atan2(mouse.y - dog.y, mouse.x - dog.x);
    }
    if (want !== null) {
      const d = Math.atan2(Math.sin(want - dog.ang), Math.cos(want - dog.ang));
      dog.ang += d * Math.min(1, 10 * dt);
    }
  }

  // ---------------------------------------------------------------------------
  // Sheep behaviour
  // ---------------------------------------------------------------------------
  function updateSheep(s, dt) {
    const C = CFG.sheep;
    const inside = inStable(s);
    let dx = 0, dy = 0, alarm = 0, panic = 0;

    // Move away from the dog (predictable – this is how you herd).
    // The stable wall blocks the dog: it only scares sheep on the same side.
    let d = dist(s, dog);
    const dogR = C.dogRadius * (dogBarking() ? CFG.dog.barkSheep : 1);   // a barking dog reaches further
    if (inStable(dog) === inside && d < dogR && d > 0.01) {
      const f = 1 - d / dogR;
      const sp = C.maxSpeed * Math.min(1, f * 1.7);
      let fx = ((s.x - dog.x) / d) * sp, fy = ((s.y - dog.y) / d) * sp;
      // During the day a sheep that just came out won't run back in:
      // it dodges sideways along the stable wall instead.
      if (phaseName() === 'day' && !inside && fy < 0 &&
          s.y < S.bottom + 35 && Math.abs(s.x - S.cx) < S.door / 2 + 25) {
        const side = s.x >= dog.x ? 1 : -1;
        fx += side * Math.abs(fy);
        fy = 0;
      }
      dx += fx;
      dy += fy;
      alarm = Math.max(alarm, f);
    }

    // The farmer: sheep make way for him (on the same side of the stable wall)
    if (farmerOut() && inStable(farmer) === inside) {
      const fd = dist(s, farmer), R = CFG.farmer.sheepRadius;
      if (fd < R && fd > 0.01) {
        const f = 1 - fd / R;
        dx += ((s.x - farmer.x) / fd) * C.maxSpeed * 0.5 * f; dy += ((s.y - farmer.y) / fd) * C.maxSpeed * 0.5 * f;
        alarm = Math.max(alarm, f * 0.5);
      }
    }

    // A moving tractor: sheep step out of its way
    if (tractor.moving && !inside) {
      const td = tractorDist(s), R = CFG.tractor.scareRadius;
      if (td < R) {
        const f = 1 - td / R;
        let [ax, ay] = awayFromTractor(s);
        if (Math.abs(s.x - GATE.cx) < TR.W / 2 + s.r) {      // right in front of it: step aside
          ax += (s.x >= GATE.cx ? 1 : -1) * 1.5;
          const n = Math.hypot(ax, ay); ax /= n; ay /= n;
        }
        dx += ax * C.maxSpeed * 0.7 * f; dy += ay * C.maxSpeed * 0.7 * f;
        alarm = Math.max(alarm, f * 0.8);
      }
    }

    // Panic from wolves: run away, but in a random direction.
    // Sheep inside the stable feel safe and stay put.
    s.freeze = false;
    // A sheep hiding under a tree keeps still unless a wolf comes really close.
    if (!inside && wolves.length) {
      let ax = 0, ay = 0;
      const hidden = underCanopy(s);
      const radius = hidden ? CFG.obstacles.wolfSeesHidden + 10 : C.wolfRadius;
      // hidden and a wolf around: freeze and keep quiet
      s.freeze = !!hidden && wolves.some((w) => dist(s, w) < C.wolfRadius + 60);
      for (const w of wolves) {
        const dw = dist(s, w);
        if (dw < radius && dw > 0.01) {
          const f = 1 - dw / radius;
          ax += ((s.x - w.x) / dw) * f;
          ay += ((s.y - w.y) / dw) * f;
          panic = Math.max(panic, f);
        }
      }
      if (panic > 0) {
        s.panicT -= dt;
        if (s.panicT <= 0) {
          s.panicT = rand(0.4, 1.2);
          s.panicOff = rand(-C.panicSpread, C.panicSpread);
        }
        const base = Math.atan2(ay, ax) + s.panicOff;
        const sp = C.maxSpeed * Math.min(1, panic * 2);
        dx += Math.cos(base) * sp;
        dy += Math.sin(base) * sp;
        alarm = Math.max(alarm, panic);
      }
    }

    // Flocking: keep some distance, but stay together (not while panicking)
    let cx = 0, cy = 0, n = 0;
    for (const o of sheep) {
      if (o === s) continue;
      const dd = dist(s, o);
      if (dd < 26 && dd > 0.01) {
        const f = (26 - dd) / 26;
        dx += ((s.x - o.x) / dd) * 50 * f;
        dy += ((s.y - o.y) / dd) * 50 * f;
      }
      if (dd < 180 && inStable(o) === inside) { cx += o.x; cy += o.y; n++; }
    }
    if (n && panic < 0.05) {
      cx /= n; cy /= n;
      const dc = Math.hypot(cx - s.x, cy - s.y);
      if (dc > 30) {
        const k = (alarm > 0.05 ? 35 : 6) * Math.min(1, dc / 120);
        dx += ((cx - s.x) / dc) * k;
        dy += ((cy - s.y) / dc) * k;
      }
    }

    // Grazing
    s.eating = false;
    const ph = phaseName();
    const calm = alarm < 0.05;
    const daytime = ph === 'day' || ph === 'dusk';
    // Calm sheep close to grass walk onto it and stay there
    const near = daytime && calm && !inside ? nearPatch(s, C.grassAttract) : null;
    const onPatch = near && near.d < patchR(near.p) + 2;
    if (onPatch && s.food < 100) {
      const p = near.p;
      // a lamb only needs part of an adult's food: it is full sooner and eats less grass
      const need = s.lamb ? C.lambFood : 1;
      const grass = Math.min(C.eatRate * dt, (100 - s.food) * need, p.amount);
      s.food = Math.min(100, s.food + grass / need);
      p.amount -= grass;
      if (p.amount < grassLeft(p)) p.amount = 0;     // the last few blades: the patch is gone
      s.eating = true;
      if (s.food >= 99.999) { s.food = 100; addFloat(s.x, s.y, tr('full'), '#d6ffb0'); }
    }

    // Evening / night: every fully fed sheep walks home to the stable by itself, at a normal walk.
    // (Hungry ones keep eating or stroll around: the dog has to bring them in, at least onto the patio.)
    // Across a stream it takes the nearest bridge; it steers around rocks, trunks and lakes.
    // A hungry sheep standing on the patio in front of the door goes in too (and keeps going once it started).
    const evening = ph === 'dusk' || ph === 'night';
    if (inside || !evening) s.homeNear = false;
    else if (onPatio(s)) s.homeNear = true;
    let goingHome = false;
    if (!inside && evening && panic < 0.3 && (s.food >= 100 || s.homeNear)) {
      goingHome = true;
      const doorX = S.cx, doorY = S.bottom;
      const dd = Math.hypot(s.x - doorX, s.y - doorY);
      let gx, gy;
      const far = !isWinter() && streams.find((st) => sideOf(st, s) === st.side);   // on the far side of a stream?
      if (far) {
        let B = far.bridges[0], bd = 1e9;
        for (const b of far.bridges) { const d = Math.hypot(b.x - s.x, b.y - s.y); if (d < bd) { bd = d; B = b; } }
        // the bridge runs across the stream; walk onto it, then off on the stable side
        let nx = -B.ty, ny = B.tx;
        if (sideOf(far, { x: B.x + nx * 20, y: B.y + ny * 20 }) === far.side) { nx = -nx; ny = -ny; }
        const along = (s.x - B.x) * nx + (s.y - B.y) * ny, lat = (s.x - B.x) * B.tx + (s.y - B.y) * B.ty;
        const ax = B.x - nx * (B.len / 2 + 4), ay = B.y - ny * (B.len / 2 + 4);
        const atBridge = (along > -(B.len / 2 + 14) && Math.abs(lat) < B.wid / 2 + 8) || Math.hypot(ax - s.x, ay - s.y) < 16;
        if (atBridge) {                                              // at / on the bridge: walk across
          gx = B.x + nx * (B.len / 2 + 30); gy = B.y + ny * (B.len / 2 + 30);
        } else {                                                     // go to the bridge's far end first
          gx = ax; gy = ay;
        }
      } else if (s.y < S.bottom + 10 && (s.x < S.x || s.x > S.x + S.w)) {
        // beside the stable: first walk around the corner
        gx = s.x > S.cx ? S.x + S.w + 18 : S.x - 18;
        gy = S.bottom + 22;
      } else {
        // line up below the door, then walk in
        const lined = Math.abs(s.x - doorX) < S.door / 2 - 14 && dd < 60;
        gx = doorX + s.exitOff * 0.5;
        gy = lined ? S.bottom - 40 : S.bottom + 18;
      }
      const dg = Math.max(1, Math.hypot(gx - s.x, gy - s.y));
      const pull = C.grazeSpeed * 1.2;   // their usual walking pace (no pauses)
      let hx = ((gx - s.x) / dg) * pull, hy = ((gy - s.y) / dg) * pull;
      [hx, hy] = avoidSolids(s, hx, hy, dg);
      dx += hx; dy += hy;
    }

    // Just walked out of the stable during the day: keep going for a bit
    if (s.wasInside && !inside && ph === 'day') {
      s.leaveT = rand(2.5, 4);
      s.heading = Math.PI / 2 + rand(-0.8, 0.8); // away from the door (down)
    }
    s.wasInside = inside;

    if (inside) {
      if (calm && ph === 'day') {
        // During the day the stable is boring: walk back out through the door
        const gx = S.cx + s.exitOff;
        const gy = s.y < S.bottom - 25 ? S.bottom - 5 : S.bottom + 60;
        const dg = Math.max(1, Math.hypot(gx - s.x, gy - s.y));
        dx += ((gx - s.x) / dg) * C.grazeSpeed * 2;
        dy += ((gy - s.y) / dg) * C.grazeSpeed * 2;
      } else if (calm) {
        // Evening / night: roam around inside, away from the door and walls
        s.wanderT -= dt;
        if (s.wanderT <= 0) {
          s.wanderT = rand(1.5, 4);
          s.grazing = Math.random() < 0.5;
          s.heading += rand(-1.5, 1.5);
        }
        const mx = 22, nearWall = s.x < S.x + mx || s.x > S.x + S.w - mx || s.y < S.y + mx || s.y > S.bottom - 32;
        if (nearWall) s.heading = Math.atan2(S.cy - 8 - s.y, S.cx - s.x) + rand(-0.5, 0.5);
        if (!s.grazing || nearWall) {
          dx += Math.cos(s.heading) * C.grazeSpeed * 0.6;
          dy += Math.sin(s.heading) * C.grazeSpeed * 0.6;
        }
      }
    } else if (calm && !goingHome && !s.freeze && ph === 'day' && s.food >= 100 && s.leaveT <= 0 &&
               stableDist(s) < C.parkRadius) {
      // Parked: a full sheep next to the stable just waits there (it goes in by itself in the evening)
      s.grazing = true;
    } else if (calm && !goingHome && !s.freeze) {
      s.wanderT -= dt;
      if (s.leaveT > 0) s.leaveT -= dt;
      if (s.wanderT <= 0) {
        s.wanderT = rand(1.5, 4.5);
        s.grazing = Math.random() < (near ? 0.75 : s.seeking ? C.grazePause * 0.5 : C.grazePause);
        s.trot = !near && Math.random() < 0.15;   // sometimes trot off a bit faster
        s.heading += rand(-1.6, 1.6);
        s.headJit = rand(-0.4, 0.4);
      }
      let sp = C.grazeSpeed * (s.trot ? 1.8 : 1);
      if (s.leaveT > 0) {
        s.grazing = false;
        sp = C.grazeSpeed * 1.6;
      } else if (near) {
        // stay on the grass: head back to the middle when drifting to the edge
        const r = patchR(near.p);
        if (near.d > r * 0.6) {
          s.heading = Math.atan2(near.p.y - s.y, near.p.x - s.x) + s.headJit;
          if (!onPatch) s.grazing = false; // walk over to it
        }
        if (onPatch) sp = C.grazeSpeed * 0.4;
      }
      if (!near) {
        const em = 60;
        if (s.x < em || s.x > FW - em || s.y < em || s.y > FH - em) {
          s.heading = Math.atan2(FH / 2 - s.y, FW / 2 - s.x) + s.headJit;
        }
        // hungry sheep amble over to grass they can see (with pauses, not in a straight line)
        if (daytime && s.food < 100 && s.leaveT <= 0) {
          const g = grassToSeek(s, C.grassSeek);
          s.seeking = !!g;
          if (g) { s.heading = Math.atan2(g.y - s.y, g.x - s.x) + s.headJit; s.trot = false; sp = C.grazeSpeed * 1.3; }
        } else s.seeking = false;
        // calm sheep don't wander into a stream by themselves (they turn along the bank)
        const ax = s.x + Math.cos(s.heading) * 22, ay = s.y + Math.sin(s.heading) * 22;
        if (!isWinter() && !inStream(s) && nearStream(ax, ay, 4) && !nearBridge(ax, ay, 4)) s.heading += Math.PI * 0.6 * (s.headJit >= 0 ? 1 : -1);
      }
      if (!s.grazing) {
        dx += Math.cos(s.heading) * sp;
        dy += Math.sin(s.heading) * sp;
      }
    }

    // Soft push away from the fence so sheep slide along it
    const m = 40;
    if (s.x < m) dx += (m - s.x) * 1.5;
    if (s.x > FW - m) dx -= (s.x - (FW - m)) * 1.5;
    if (s.y < m) dy += (m - s.y) * 1.5;
    if (s.y > FH - m) dy -= (s.y - (FH - m)) * 1.5;

    // winter: deep snow, cold legs - every sheep is 10-15% slower
    const slow = (isWinter() ? (s.winterSlow || 0.875) : 1) * (inStream(s) ? CFG.streams.sheepSpeed : 1) *
                 (state.blizzard && !inside ? CFG.blizzard.sheepSlow : 1);   // struggling against the storm
    dx *= slow; dy *= slow;
    const k = Math.min(1, (alarm > 0.05 ? 7 : 2) * dt);
    s.vx += (dx - s.vx) * k;
    s.vy += (dy - s.vy) * k;
    const sp = Math.hypot(s.vx, s.vy), max = C.maxSpeed * slow;
    if (sp > max) { s.vx *= max / sp; s.vy *= max / sp; }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (sp > 4) { s.fx = s.vx / sp; s.fy = s.vy / sp; }
    s.alarm = alarm;
    if (s.hurtT > 0) s.hurtT -= dt;

    // Bahh! (now and then, in a panic when a wolf is close, and in answer to a bark)
    if (s.answerT > 0) {
      s.answerT -= dt;
      if (s.answerT <= 0) { const b = tr('baaBark'); say(s, b[Math.floor(Math.random() * b.length)], 'sheep'); s.baaT = Math.max(s.baaT, 6); }
    }
    s.baaT -= dt;
    if (state.sheepTalkCD <= 0) {
      if (panic > 0.4 && Math.random() < dt * 1.5) {
        say(s, tr('baaPanic'), 'sheep'); state.sheepTalkCD = 1.5;
      } else if (s.baaT <= 0) {
        say(s, tr('baa')[Math.floor(Math.random() * 5)], 'sheep');
        state.sheepTalkCD = 2.5;
        s.baaT = rand(12, 35);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Wolf behaviour
  // ---------------------------------------------------------------------------
  function updateWolf(w, dt) {
    const C = CFG.wolf;
    const dd = Math.max(0.01, dist(w, dog));
    let dx = 0, dy = 0;

    if (w.mode === 'leave') {
      // Run to the nearest edge and disappear
      const ex = [w.x, FW - w.x, w.y, FH - w.y];
      const i = ex.indexOf(Math.min(...ex));
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      dx = dirs[i][0] * C.fleeSpeed;
      dy = dirs[i][1] * C.fleeSpeed;
      if (w.x < -45 || w.x > FW + 45 || w.y < -45 || w.y > FH + 45) { w.gone = true; return; }
    } else {
      const fearR = C.fearRadius * (dogBarking() ? CFG.dog.barkWolf : 1);   // barking keeps them further off
      const fearW = clamp((fearR - dd) / (fearR * 0.55), 0, 1);
      if (w.eatT > 0) {
        w.eatT -= dt;
        if (fearW > 0.6) w.eatT = 0; // the dog interrupts the meal
      }

      // Dog food! A wolf close to the bowl goes for it and eats (as fast as the dog would)
      const bd = Math.hypot(bowl.x - w.x, bowl.y - w.y);
      const smellsFood = bowl.food > 0 && bd < CFG.bowl.wolfSmell && w.eatT <= 0 && fearW < 0.6;
      w.feeding = smellsFood && bd < CFG.bowl.reach + 6;
      if (w.feeding) {
        const bite = Math.min(CFG.dog.staminaRecover * CFG.bowl.rate * dt, bowl.food);
        bowl.food -= bite;
        if (!w.munched) { addFloat(w.x, w.y, tr('munch'), '#ffe0a0'); w.munched = true; }
      } else w.munched = false;

      // Closest sheep that is not in the stable (and not hidden under a tree)
      let tgt = null, td = 1e9;
      for (const s of sheep) {
        if (inStable(s)) continue;
        const d = dist(s, w);
        if (d > CFG.obstacles.wolfSeesHidden && underCanopy(s)) continue;
        if (d < td) { td = d; tgt = s; }
      }

      let sx = 0, sy = 0;
      if (w.eatT > 0 || w.feeding) {
        // standing still, eating
      } else if (smellsFood) {
        sx = ((bowl.x - w.x) / bd) * C.speed * 0.8;
        sy = ((bowl.y - w.y) / bd) * C.speed * 0.8;
      } else if (tgt) {
        sx = ((tgt.x - w.x) / td) * C.speed;
        sy = ((tgt.y - w.y) / td) * C.speed;
      } else {
        // Nothing to hunt: prowl around the stable
        w.orbit += dt * 0.25;
        const ox = clamp(S.cx + Math.cos(w.orbit) * 340, 40, FW - 40);
        const oy = clamp(S.cy + Math.sin(w.orbit) * 300, 40, FH - 40);
        const od = Math.max(1, Math.hypot(ox - w.x, oy - w.y));
        sx = ((ox - w.x) / od) * C.speed * 0.6;
        sy = ((oy - w.y) / od) * C.speed * 0.6;
      }

      if (fearW > 0) {
        // Avoid the dog, but try to slip around it towards the sheep
        const ax = (w.x - dog.x) / dd, ay = (w.y - dog.y) / dd;
        let tx = -ay, ty = ax;
        if (tgt && tx * (tgt.x - w.x) + ty * (tgt.y - w.y) < 0) { tx = -tx; ty = -ty; }
        const side = C.speed * 0.6 * (1 - fearW * 0.5);
        const fx = ax * C.fleeSpeed + tx * side;
        const fy = ay * C.fleeSpeed + ty * side;
        dx = sx * (1 - fearW) + fx * fearW;
        dy = sy * (1 - fearW) + fy * fearW;

        // A daytime wolf loses courage when chased and eventually gives up
        if (!w.night) {
          w.courage -= dt * fearW;
          if (w.courage <= 0) {
            w.mode = 'leave';
            addFloat(w.x, w.y, tr('givesUp'), '#fff3b0');
          }
        }
      } else {
        dx = sx; dy = sy;
      }

      // Sometimes a wolf turns on the dog: a short charge, and a bite costs stamina
      const ax = (dog.x - w.x) / dd, ay = (dog.y - w.y) / dd;
      w.attackCD -= dt;
      if (dogBarking() && w.attackT > 0) { w.attackT = 0; w.retreatT = 0.8; w.attackCD = rand(4, 7); }
      if (w.retreatT > 0) {
        w.retreatT -= dt;
        dx = -ax * C.fleeSpeed; dy = -ay * C.fleeSpeed;
      } else if (w.attackT > 0) {
        w.attackT -= dt;
        dx = ax * C.fleeSpeed; dy = ay * C.fleeSpeed;
        if (dd < w.r + dog.r + 3) {
          dog.stamina = Math.max(0, dog.stamina - C.dogBite);
          dog.hurtT = 0.6;
          dog.trick = null;
          dog.x += ax * 6; dog.y += ay * 6;            // knocked back a bit
          say(dog, tr('yelp'), 'dog');
          dog.woofCD = Math.max(dog.woofCD, 1.6);
          addFloat(dog.x, dog.y, tr('energy', C.dogBite), '#ffb3a8');
          w.attackT = 0;
          w.retreatT = 0.9;
          w.attackCD = rand(6, 12);
        } else if (w.attackT <= 0) w.attackCD = rand(4, 8);
      } else if (w.attackCD <= 0 && dd < C.attackRange && w.eatT <= 0 && !w.feeding && !dogBarking() &&
                 Math.random() < C.attackChance * (w.night ? 1.5 : 1) * dt) {
        w.attackT = 1.4;
        say(w, tr('growl'), 'wolf');
      }

      // Howl now and then
      w.howlT -= dt;
      if (w.howlT <= 0) {
        if (state.wolfTalkCD <= 0 && w.attackT <= 0) {
          say(w, tr('howl'), 'wolf');
          state.wolfTalkCD = 3;
        }
        w.howlT = w.night ? rand(10, 22) : rand(18, 35);
      }
    }

    // wolves don't like the farmer's tractor: they keep their distance
    if (w.mode !== 'leave' && tractorHere()) {
      const td = tractorDist(w), R = CFG.tractor.wolfFear;
      if (td < R) {
        const f = clamp((R - td) / (R * 0.5), 0, 1), [ax, ay] = awayFromTractor(w);
        dx = dx * (1 - f) + ax * C.fleeSpeed * f; dy = dy * (1 - f) + ay * C.fleeSpeed * f;
      }
    }

    if (w.mode !== 'leave' && farmerOut() && !inStable(farmer)) {
      const fd = dist(w, farmer), R = CFG.farmer.wolfFear;
      if (fd < R && fd > 0.01) {
        const f = clamp((R - fd) / (R * 0.5), 0, 1);
        dx = dx * (1 - f) + ((w.x - farmer.x) / fd) * C.fleeSpeed * f; dy = dy * (1 - f) + ((w.y - farmer.y) / fd) * C.fleeSpeed * f;
      }
    }

    [dx, dy] = avoidSolids(w, dx, dy);
    const k = Math.min(1, 5 * dt);
    w.vx += (dx - w.vx) * k;
    w.vy += (dy - w.vy) * k;
    const sp = Math.hypot(w.vx, w.vy);
    const wmax = C.fleeSpeed * (inStream(w) ? CFG.streams.wolfSpeed : 1);
    if (sp > wmax) { w.vx *= wmax / sp; w.vy *= wmax / sp; }
    w.x += w.vx * dt;
    w.y += w.vy * dt;
    if (sp > 5) { w.fx = w.vx / sp; w.fy = w.vy / sp; }
    const want = Math.atan2(w.fy, w.fx);
    w.ang += Math.atan2(Math.sin(want - w.ang), Math.cos(want - w.ang)) * Math.min(1, 9 * dt);

    if (w.mode === 'hunt') {
      w.x = clamp(w.x, -50, FW + 50);
      w.y = clamp(w.y, -50, FH + 50);
      if (w.eatT <= 0) {
        // Bite: sheep in contact lose health quickly; they only die at 0%
        for (let i = sheep.length - 1; i >= 0; i--) {
          const s = sheep[i];
          if (inStable(s)) continue;
          if (dist(s, w) < s.r + w.r + 2) {
            if (s.hurtT <= 0) addFloat(s.x, s.y, tr('bitten'), '#ffb3a8');
            s.health -= C.biteRate * dt;
            s.hurtT = 0.3;
            if (s.health <= 0) {
              sheep.splice(i, 1);
              w.eatT = C.eatTime;
              state.lost++;
              addFloat(s.x, s.y, s.sex === 'm' ? tr('ramKilled') : tr('eweKilled'));
              checkExtinction();
              break;
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Collisions
  // ---------------------------------------------------------------------------
  function separate(a, b, moveA, moveB) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 0.01;
    const overlap = a.r + b.r - d;
    if (overlap <= 0) return;
    const nx = dx / d, ny = dy / d;
    const total = moveA + moveB;
    a.x -= nx * overlap * (moveA / total);
    a.y -= ny * overlap * (moveA / total);
    b.x += nx * overlap * (moveB / total);
    b.y += ny * overlap * (moveB / total);
  }

  function resolveCollisions() {
    for (let i = 0; i < sheep.length; i++) {
      for (let j = i + 1; j < sheep.length; j++) separate(sheep[i], sheep[j], 1, 1);
      separate(dog, sheep[i], 0, 1);
    }
    if (farmerOut()) {
      for (const s of sheep) separate(farmer, s, 0, 1);
      separate(farmer, dog, 0, 1);
    }
    for (let i = 0; i < wolves.length; i++) {
      separate(dog, wolves[i], 0, 1);
      for (let j = i + 1; j < wolves.length; j++) separate(wolves[i], wolves[j], 1, 1);
    }

    if (deco.snowman && deco.snowman.balls[0] && snowmanMelt() < 0.7) {   // the snowman is solid
      const c = { x: deco.snowman.x, y: deco.snowman.y, r: deco.snowman.balls[0] + 1 };
      for (const e of [dog, ...sheep, ...wolves]) {
        const d = Math.hypot(e.x - c.x, e.y - c.y), min = c.r + e.r;
        if (d < min && d > 0.01) { e.x = c.x + (e.x - c.x) / d * min; e.y = c.y + (e.y - c.y) / d * min; }
      }
    }
    for (const s of sheep) { collideSolids(s); collideTractor(s); collideWalls(s); clampToField(s); }
    collideSolids(dog); collideTractor(dog); collideWalls(dog); clampToField(dog);
    for (const w of wolves) { collideSolids(w); collideTractor(w); pushOutOfStable(w); }
  }

  // ---------------------------------------------------------------------------
  // The farmer's tractor: on some days (CFG.tractor.daysPerSeason) the gate opens in the
  // morning, the tractor drives in and parks along the stable, and it leaves before evening.
  // It is solid, it honks at animals in its way, moving it scares sheep, and wolves keep away.
  // The sheep still can't get out through the open gate.
  // ---------------------------------------------------------------------------
  const TR = { W: 36, L: 64 };
  const tractor = {
    mode: 'away', y: -80, gate: 0, honkCD: 0, beepT: 0, puffT: 0, puffs: [], moving: false,
    circles: [{ x: 0, y: 0, r: 18 }, { x: 0, y: 0, r: 18 }, { x: 0, y: 0, r: 18 }],
  };
  const tractorHere = () => state.screen !== 'title' && tractor.y > -TR.L / 2 - 4;
  const tractorParkY = () => bowl.y - 16 - TR.L / 2;
  const tractorLeaveHour = () => season().evening[0] - CFG.tractor.leaveEarly;

  // At the start of each day: is it a tractor day?
  // The farmer's two jobs of each season (spring, summer, fall, winter)
  const JOBS = [['beer', 'flowers'], ['beer', 'mow'], ['rake', 'apples'], ['shovel', 'snowman']];
  // Fall: on some mornings there is thick fog (CFG.fog.daysPerSeason of the season's days)
  function planFog() {
    if (seasonDay() === 0 || !state.fogDays) {
      state.fogDays = [...Array(CLOCK.seasonDays).keys()].sort(() => Math.random() - 0.5).slice(0, CFG.fog.daysPerSeason);
      // winter: a blizzard on one day, if it comes at all this winter
      state.blizzardDay = Math.random() < CFG.blizzard.chance ? Math.floor(Math.random() * CLOCK.seasonDays) : -1;
    }
    state.foggy = seasonIndex() === 2 && state.fogDays.includes(seasonDay());
    state.blizzard = isWinter() && state.blizzardDay === seasonDay();
  }
  // how hard the blizzard blows right now (0 = no blizzard): gusts come and go all day
  function blizzardLevel() {
    if (!state.blizzard || state.screen === 'title') return 0;
    return 0.75 + 0.25 * Math.sin(state.t * 0.35) * Math.sin(state.t * 0.13 + 1);
  }
  // how thick the fog is right now (0 = none): thick in the morning, gone by noon
  function fogLevel() {
    if (!state.foggy || state.screen === 'title') return 0;
    const C = CFG.fog, h = currentHour();
    if (h <= C.thickUntil) return C.thick;
    // thins out only slowly at first, then faster and faster until it is gone at clearBy
    const t = clamp((h - C.thickUntil) / (C.clearBy - C.thickUntil), 0, 1);
    return C.thick * (1 - Math.pow(t, 3));
  }

  function planTractor() {
    planFog();
    if (seasonDay() === 0 || !state.tractorDays || !state.farmerJobs) {
      // which days of this season the tractor comes, and which job the farmer does on each
      const days = [...Array(CLOCK.seasonDays).keys()].sort(() => Math.random() - 0.5)
        .slice(0, CFG.tractor.daysPerSeason);
      const jobs = [...JOBS[seasonIndex()]].sort(() => Math.random() - 0.5);
      state.tractorDays = days;
      state.farmerJobs = {};
      days.forEach((d, i) => { state.farmerJobs[d] = jobs[i % jobs.length]; });
    }
    state.tractorToday = state.tractorDays.includes(seasonDay());
    state.farmerJob = state.tractorToday ? state.farmerJobs[seasonDay()] : null;
    Object.assign(tractor, { mode: 'away', y: -80, gate: 0, puffs: [], moving: false });
    Object.assign(farmer, { mode: 'aboard', path: [], petT: 0 });
    dig.on = false;
    rake.on = false;
    barrow.on = false;
    deco.trail = [];
  }

  // distance from a point to the tractor's body (0 inside)
  function tractorDist(p) {
    const dx = Math.max(GATE.cx - TR.W / 2 - p.x, 0, p.x - (GATE.cx + TR.W / 2));
    const dy = Math.max(tractor.y - TR.L / 2 - p.y, 0, p.y - (tractor.y + TR.L / 2));
    return Math.hypot(dx, dy);
  }
  // unit vector from the tractor's body to a point
  function awayFromTractor(p) {
    const qx = clamp(p.x, GATE.cx - TR.W / 2, GATE.cx + TR.W / 2), qy = clamp(p.y, tractor.y - TR.L / 2, tractor.y + TR.L / 2);
    let ax = p.x - qx, ay = p.y - qy;
    if (Math.hypot(ax, ay) < 0.5) { ax = p.x - GATE.cx || 1; ay = 0; }
    const n = Math.hypot(ax, ay);
    return [ax / n, ay / n];
  }

  // Something in the way (dir = +1 driving in, -1 backing out)?
  function tractorBlocked(dir) {
    const edge = tractor.y + dir * TR.L / 2;
    for (const a of [...sheep, dog, ...wolves]) {
      if (Math.abs(a.x - GATE.cx) > TR.W / 2 + a.r - 2) continue;
      const ahead = (a.y - edge) * dir;
      if (ahead > -6 && ahead < a.r + 8) {
        if (tractor.honkCD <= 0) { say({ x: GATE.cx, y: Math.max(14, edge) }, tr('honk'), 'tractor'); tractor.honkCD = 2.2; }
        return true;
      }
    }
    return false;
  }

  // The farmer: gets off the parked tractor, walks over the patio into the stable and spends the
  // day in there. Before evening he walks back and drives off. Sheep make way for him, wolves keep
  // away, and when the dog comes close it wags its tail and gets a pat.
  const farmer = { mode: 'aboard', x: 0, y: 0, r: 9, vx: 0, vy: 0, ang: Math.PI / 2, path: [], walkPh: 0,
                   moving: false, petT: 0, petCD: 0, idleT: 0, hopCD: 0, didWork: false, workPh: 0, sipT: 0, sips: 0 };
  // where he digs today (dirt hole in front of the stable; in winter he shovels snow on the patio)
  const dig = { x: 0, y: 0, prog: 0, winter: false, on: false, lanes: [], lane: 0 };
  // winter: the patio is shovelled in three strips, back and forth; the snow is pushed to the ends
  const LANE_H = 24;
  const rake = { on: false, lanes: [], lane: 0 };   // fall: raking the leaves off the patio
  // Work the patio strip by strip (shovelling snow / raking leaves). Returns true when all strips are done.
  function sweepLanes(F, job, speed, dt, onPush) {
    const L = job.lanes[job.lane];
    if (L.reach === null) L.reach = L.x0;
    const tx = L.x1 - L.dir * 6;                                          // where he stops
    if (Math.abs(F.y - L.y) > 1.5) {                                      // stepping over to the strip
      F.ang = Math.atan2(L.y - F.y, 0.001);
      F.y += Math.sign(L.y - F.y) * Math.min(Math.abs(L.y - F.y), CFG.farmer.speed * 0.6 * dt);
      F.moving = true; F.walkPh += dt * 6;
    } else if ((tx - F.x) * L.dir > 0) {
      F.ang = L.dir > 0 ? 0 : Math.PI;
      F.x += L.dir * speed * dt;
      F.moving = true; F.walkPh += dt * 5;
      L.reach = clamp(F.x + L.dir * 13, Math.min(L.x0, L.x1), Math.max(L.x0, L.x1));
      if (onPush) onPush(L);
    } else {
      L.reach = L.x1;
      if (onPush) onPush(L);
      job.lane++;
      if (job.lane >= job.lanes.length) return true;                      // (else: turn round, next strip)
    }
    return false;
  }
  // the rake pushes the leaves on its strip along in front of it; at the end they make a heap
  function rakeLeaves(L) {
    const a = Math.min(L.x0, L.reach), b = Math.max(L.x0, L.reach);
    for (const lf of groundLeaves) {
      const x = lf.hx + lf.ox, y = lf.hy + lf.oy;
      if (Math.abs(y - L.y) > LANE_H / 2 || x < a - 1 || x > b + 1) continue;
      if ((L.reach - x) * L.dir > 4) {                                    // behind the rake: pull it to the rake
        lf.hx = L.reach - L.dir * rand(0, 4); lf.hy = clamp(lf.hy + rand(-0.6, 0.6), L.y - LANE_H / 2 + 2, L.y + LANE_H / 2 - 2);
        lf.ox = lf.oy = lf.vx = lf.vy = 0; lf.rot += rand(-0.5, 0.5);
      }
    }
  }
  function makeLanes() {
    const xl = P.x + 9, xr = P.x + P.w - 9;
    return [0, 1, 2].map((i) => {
      const dir = i % 2 ? -1 : 1;
      return { y: P.y + 12 + i * 22, dir, x0: dir > 0 ? xl : xr, x1: dir > 0 ? xr : xl, reach: null };
    });
  }
  const DOOR_IN = { x: S.cx, y: S.bottom - 32 }, DOOR_OUT = { x: S.cx, y: S.bottom + 20 };
  const BELOW_BENCH = { x: BENCH.x, y: BENCH.y + 34 };
  // how far through his day the farmer is (0 = tractor arrived, 1 = time to leave)
  const farmerDay = () => clamp((state.hour - CFG.tractor.arrive) / Math.max(0.5, tractorLeaveHour() - CFG.farmer.walkBack - CFG.tractor.arrive), 0, 1);
  const farmerOut = () => tractorHere() && farmer.mode !== 'aboard';
  const besideCab = () => ({ x: GATE.cx + TR.W / 2 + 16, y: tractor.y - 12 });
  const belowBowl = () => ({ x: GATE.cx + TR.W / 2 + 16, y: bowl.y + 26 });

  // Things the farmer leaves behind: a flower bed (spring -> wilts in summer -> gone in winter),
  // a freshly mown lawn (summer, grows back in a few days), a snowman (all winter, melts in spring),
  // the track of the rolled snowballs (until the next morning).
  const deco = { flowers: null, mowed: null, snowman: null, trail: [] };
  const job = { i: 0, step: 0, trees: [], barrowAt: null, roll: 0, rollR: 0 };   // today's job in progress
  const barrow = { on: false, apples: 0 };
  const SNOWMAN = { x: P.x + P.w + 44, y: P.y + P.h + 24 };
  const JOB_START = { beer: 0.35, flowers: 0.25, mow: 0.3, rake: 0.3, apples: 0.2, shovel: 0.1, snowman: 0.12 };

  function growApples() { for (const t of trees) t.apples = 6 + Math.floor(Math.random() * 4); }

  // flower bed: 5 holes in a row just below the patio
  function flowerSpots() {
    const cols = ['#e5533d', '#ffd84d', '#ff9ecd', '#b48cff', '#ffffff', '#ff8a3d'];
    return [0, 1, 2, 3, 4].map((i) => ({ x: P.x + 22 + i * (P.w - 44) / 4, y: P.y + P.h + 16, dug: 0, planted: false,
                                         col: cols[Math.floor(Math.random() * cols.length)] }));
  }
  // how the flowers look today
  function flowerStage() {
    const F = deco.flowers, si = seasonIndex();
    if (!F) return null;
    if (si === 0) { const d = state.day - F.day; return d <= 0 ? 'sprout' : d === 1 ? 'bud' : 'bloom'; }
    if (si === 1) return ['bloom', 'droop', 'wilt'][Math.min(2, seasonDay())];
    if (si === 2) return 'dry';
    return null;
  }

  // a spot near the patio without grass patches, obstacles or streams for mowing
  function pickMowArea() {
    const cands = [
      { x: P.x + 14, y: P.y + P.h + 40, w: 120, h: 56 },
      { x: S.x + S.w + 50, y: S.bottom + 62, w: 120, h: 56 },
      { x: P.x + 140, y: P.y + P.h + 70, w: 120, h: 56 },
      { x: S.x + S.w + 60, y: S.bottom + 130, w: 120, h: 56 },
    ];
    const free = (a) => {
      const near = (cx, cy, r) => {
        const qx = clamp(cx, a.x, a.x + a.w), qy = clamp(cy, a.y, a.y + a.h);
        return Math.hypot(cx - qx, cy - qy) < r;
      };
      if (patches.some((q) => q.amount > 0 && near(q.x, q.y, patchR(q) + 10))) return false;
      if (solids.some((o) => near(o.x, o.y, o.r + 6))) return false;
      for (let x = a.x; x <= a.x + a.w; x += 20) for (let y = a.y; y <= a.y + a.h; y += 14) if (nearStream(x, y, 8)) return false;
      if (deco.flowers && deco.flowers.items.some((f) => near(f.x, f.y, 8))) return false;
      return true;
    };
    return cands.find(free) || null;
  }
  function mowLanes(a) {
    const n = Math.floor(a.h / 14);
    return Array.from({ length: n }, (_, i) => {
      const dir = i % 2 ? -1 : 1;
      return { y: a.y + 7 + i * 14, dir, x0: dir > 0 ? a.x : a.x + a.w, x1: dir > 0 ? a.x + a.w : a.x, reach: null };
    });
  }

  // apple trees close enough to the stable (at most 3), in a round trip that doesn't cross water
  function segClear(a, b, skip) {
    const hits = (c, r) => {
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
      const t = clamp(((c.x - a.x) * dx + (c.y - a.y) * dy) / L2, 0, 1);
      return Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y) < r;
    };
    for (const l of lakes) for (const c of l.circles) if (hits(c, c.r + 12)) return false;
    for (const o of [...rocks, ...trees]) if (o !== skip && hits(o, o.r + 10)) return false;
    if (hits({ x: HUT.x, y: HUT.y }, 26) || hits({ x: BENCH.x, y: BENCH.y }, 18)) return false;
    if (!isWinter() && streams.some((st) => sideOf(st, a) !== sideOf(st, b))) return false;
    return true;
  }
  // a way from a to b: straight, or with one detour around a lake / rock / stream bend
  function routeTo(a, b, skip) {
    if (segClear(a, b, skip)) return [b];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L;
    for (const off of [45, -45, 80, -80, 120, -120, 170, -170]) {
      const m = { x: clamp(a.x + dx / 2 + nx * off, 20, FW - 20), y: clamp(a.y + dy / 2 + ny * off, 20, FH - 20) };
      if (segClear(a, m, skip) && segClear(m, b, skip)) return [m, b];
    }
    return null;
  }
  const APPLE_START = () => ({ x: S.cx + 30, y: P.y + P.h + 30 });
  // apple trees close to the stable (at most 3), each reachable without wading or walking through things
  function pickAppleTrees() {
    const R = CFG.farmer.appleRadius, route = [];
    let at = APPLE_START();
    let left = trees.filter((t) => (t.apples || 0) > 1 && Math.hypot(t.x - at.x, t.y - at.y) < R);
    // none close enough: the nearest tree a bit further away will do (just one)
    let max = 3;
    if (!left.length) { left = trees.filter((t) => (t.apples || 0) > 1 && Math.hypot(t.x - at.x, t.y - at.y) < R * 1.4); max = 1; }
    while (route.length < max && left.length) {
      left.sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
      const t = left.find((c) => {
        const d = Math.hypot(at.x - c.x, at.y - c.y) || 1;
        const stand = { x: c.x + (at.x - c.x) / d * (c.r + 13), y: c.y + (at.y - c.y) / d * (c.r + 13) };
        const way = routeTo(at, stand, c);
        if (!way) return false;
        c.stand = stand; c.way = way;
        return true;
      });
      if (!t) break;
      route.push(t); at = t.stand;
      left = left.filter((c) => c !== t);
    }
    // ...and the way home has to work too
    while (route.length) {
      const last = route[route.length - 1], home = routeTo(last.stand, APPLE_START(), last);
      if (home) { job.home = home; break; }
      route.pop();
    }
    return route;
  }

  // start today's job (he comes out of the stable for it)
  function startJob(F) {
    const kind = state.farmerJob, out = [DOOR_IN, DOOR_OUT];
    F.workPh = 0;
    job.i = 0; job.step = 0;
    if (kind === 'beer') {
      F.path = [...out, { x: BENCH.x, y: BELOW_BENCH.y + 6 }, BENCH_SEAT]; F.mode = 'toBench';
    } else if (kind === 'rake') {
      Object.assign(rake, { on: true, lanes: makeLanes(), lane: 0 });
      const L = rake.lanes[0];
      F.path = [...out, { x: L.x0 - L.dir * 8, y: L.y + 30 }, { x: L.x0 - L.dir * 8, y: L.y }]; F.mode = 'toRake';
    } else if (kind === 'shovel') {
      Object.assign(dig, { winter: true, on: true, lanes: makeLanes(), lane: 0, prog: 0 });
      const L = dig.lanes[0];
      F.path = [...out, { x: L.x0 - L.dir * 8, y: L.y }]; F.mode = 'toWork';
      say(F, tr('brr'), 'farmer');
    } else if (kind === 'flowers') {
      dig.winter = false;
      deco.flowers = { day: state.day, items: flowerSpots() };
      const h = deco.flowers.items[0];
      F.path = [...out, { x: h.x - 12, y: h.y }]; F.mode = 'toHole';
      say(F, tr('plantTime'), 'farmer');
    } else if (kind === 'mow') {
      const a = pickMowArea();
      if (!a) { state.farmerJob = 'beer'; startJob(F); return; }   // nowhere to mow: a beer instead
      deco.mowed = { ...a, day: state.day, lanes: mowLanes(a), lane: 0 };
      const L = deco.mowed.lanes[0];
      F.path = [...out, { x: L.x0 - L.dir * 10, y: L.y }]; F.mode = 'toMow';
    } else if (kind === 'apples') {
      job.trees = pickAppleTrees();
      if (!job.trees.length) { state.farmerJob = 'rake'; startJob(F); return; }   // no apple tree close by: rake instead
      Object.assign(barrow, { on: true, apples: 0 });
      F.path = [...out, APPLE_START(), ...job.trees[0].way]; F.mode = 'toTree';
      say(F, tr('appleTime'), 'farmer');
    } else if (kind === 'snowman') {
      deco.snowman = { x: SNOWMAN.x, y: SNOWMAN.y, balls: [], deco: 0, melt: 0 };
      F.path = [...out, { x: SNOWMAN.x, y: SNOWMAN.y + 20 }]; F.mode = 'snowman';
      say(F, tr('snowmanTime'), 'farmer');
    } else { F.didWork = true; return; }
    F.didWork = true;
  }
  const backInside = (F) => { F.path = [DOOR_OUT, DOOR_IN]; F.mode = 'off'; };
  // snowman: roll three balls (big, middle, head) in little loops, push each over and stack it,
  // then the face, buttons and arms
  const BALLS = [11, 8, 5.5];
  function snowmanStep(F, dt) {
    if (job.step >= 9) {                                       // decorating
      F.workPh += dt;
      F.ang = Math.atan2(SNOWMAN.y - F.y, SNOWMAN.x - F.x);
      deco.snowman.deco = clamp(F.workPh / 3, 0, 1);
      if (F.workPh > 3.2) { say(F, tr('snowmanDone'), 'farmer'); backInside(F); }
      return;
    }
    const k = Math.floor(job.step / 3), sub = job.step % 3;
    if (sub === 0) {                                           // roll it: walk a loop, the ball grows
      const cx = SNOWMAN.x, cy = SNOWMAN.y + 36, r = 15, turns = [1, 0.8, 0.6][k];
      F.path = [];
      for (let i = 1; i <= Math.round(14 * turns); i++) {
        const a = Math.PI / 2 + (i / 14) * TAU;
        F.path.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
      job.roll = 0; job.rollLen = 2 * Math.PI * r * turns; job.rollR = 2.5;
      F.mode = 'roll';
    } else if (sub === 1) {                                    // push it over to the snowman
      F.path = [{ x: SNOWMAN.x, y: SNOWMAN.y + 2 + BALLS[k] + 9 + (k ? 4 : 0) }];
      F.mode = 'roll';
    } else {                                                   // lift it on
      deco.snowman.balls[k] = BALLS[k];
      job.rollR = 0;
      if (k === 2) { F.workPh = 0; F.path = [{ x: SNOWMAN.x + 3, y: SNOWMAN.y + 19 }]; }
    }
    job.step++;
  }

  function farmerGetsOff() {
    const a = besideCab();
    Object.assign(farmer, { mode: 'off', x: a.x - 6, y: a.y, vx: 0, vy: 0, petT: 0, petCD: 2, idleT: 0, ang: Math.PI / 2 });
    farmer.path = [a, belowBowl(), BELOW_BENCH, { x: S.cx + 18, y: S.bottom + 30 }, { x: S.cx, y: S.bottom + 8 }, DOOR_IN];
    Object.assign(farmer, { didWork: false, sips: 0, lpx: undefined });
    say(farmer, tr('hello'), 'farmer');
  }
  function farmerGoesBack() {
    const back = [BELOW_BENCH, belowBowl(), besideCab()];
    if (farmer.mode === 'off' && barrow.on && !inStable(farmer)) {     // already on the way home with the apples
      farmer.path = [...farmer.path.filter((p) => p !== DOOR_OUT && p !== DOOR_IN), ...back];
      farmer.mode = 'return';
      return;
    }
    if (['toTree', 'pick'].includes(farmer.mode)) {
      // out with the wheelbarrow: back the same way he came
      // retrace: back through every tree visited (and its detour), then home
      const n = farmer.mode === 'toTree' ? job.i : job.i + 1, pts = [];
      for (let i = n - 1; i >= 0; i--) {
        const t = job.trees[i], prev = i ? job.trees[i - 1].stand : APPLE_START();
        if (i < n - 1) pts.push(t.stand);
        if (t.way.length > 1) pts.push(t.way[0]);
        if (!i) pts.push(prev);
      }
      if (!n) pts.push(APPLE_START());
      farmer.path = [...pts, ...back];
      farmer.mode = 'return';
      return;
    }
    if (inStable(farmer) || farmer.y < S.bottom + 4) {          // in the stable: out through the door first
      farmer.path = [DOOR_IN, DOOR_OUT, ...back];
    } else farmer.path = farmer.x > GATE.cx && farmer.y < bowl.y ? [besideCab()] : farmer.x > BENCH.x + 20 ? back.slice(1) : back;
    farmer.mode = 'return';
  }

  function updateFarmer(dt) {
    const F = farmer, C = CFG.farmer;
    F.moving = false;
    if (!farmerOut()) return;
    F.petCD -= dt; F.hopCD -= dt;
    const dd = dist(F, dog);
    const sameSide = inStable(dog) === inStable(F);
    // petting the dog
    if (F.petT > 0) {
      F.petT -= dt;
      F.ang = Math.atan2(dog.y - F.y, dog.x - F.x);
      dog.happyT = Math.max(dog.happyT || 0, 0.5);
      if (dd > C.petRadius + 25) F.petT = 0;      // the dog ran off
      return;
    }
    if (F.petCD <= 0 && sameSide && dd < C.petRadius) {
      F.petT = 2.4; F.petCD = 9;
      dog.happyT = 3;
      say(F, tr('goodDog', dogName()), 'farmer');
      return;
    }
    // His day: in the stable -> today's job outside -> back in (or a beer on the bench) -> back to the tractor
    const f = farmerDay();
    if (!F.path.length) {
      if (F.mode === 'off') {
        F.mode = 'inside'; F.idleT = rand(2, 5);
        if (barrow.on) { barrow.on = false; barrow.apples = 0; }           // apples unloaded in the stable
      } else if (F.mode === 'return') { F.mode = 'aboard'; barrow.on = false; say({ x: GATE.cx, y: tractor.y }, tr('bye'), 'farmer'); return; }
      else if (F.mode === 'toWork') {
        F.mode = 'work'; F.workPh = 0;
        say(F, tr('shovel'), 'farmer');
      } else if (F.mode === 'toBench') {
        F.mode = 'bench'; F.sipT = 2.5;
      } else if (F.mode === 'toRake') {
        F.mode = 'rake'; F.workPh = 0;
        say(F, tr('rakeTime'), 'farmer');
      } else if (F.mode === 'inside') {
        if (!F.didWork && state.farmerJob && f >= (JOB_START[state.farmerJob] || 0.3)) startJob(F);
        else {
          F.idleT -= dt;
          if (F.idleT <= 0) {
            F.path = [{ x: rand(S.x + 26, S.x + S.w - 26), y: rand(S.y + 26, S.bottom - 34) }];
            F.idleT = rand(3, 8);
          }
        }
      } else if (F.mode === 'work' && dig.winter) {
        // push the snow along the strip, then step over to the next one
        F.workPh += dt;
        if (sweepLanes(F, dig, C.shovelSpeed, dt)) { say(F, tr('done'), 'farmer'); backInside(F); }
        const L = dig.lanes[Math.min(dig.lane, dig.lanes.length - 1)];
        dig.prog = (Math.min(dig.lane, dig.lanes.length) + (dig.lane < dig.lanes.length && L.reach !== null ? Math.abs(L.reach - L.x0) / Math.abs(L.x1 - L.x0) : 0)) / dig.lanes.length;
      } else if (F.mode === 'rake') {
        F.workPh += dt;
        if (sweepLanes(F, rake, C.rakeSpeed, dt, rakeLeaves)) { say(F, tr('done'), 'farmer'); backInside(F); }
      } else if (F.mode === 'toHole') {
        F.mode = 'plantDig'; F.workPh = 0;
      } else if (F.mode === 'plantDig') {                    // spring: dig a hole ...
        const h = deco.flowers.items[job.i];
        F.ang = Math.atan2(h.y - F.y, h.x - F.x);
        F.workPh += dt;
        h.dug = clamp(F.workPh / 2.2, 0, 1);
        if (h.dug >= 1) { F.mode = 'plant'; F.workPh = 0; }
      } else if (F.mode === 'plant') {                       // ... and plant a flower in it
        F.workPh += dt;
        if (F.workPh > 1.1) {
          deco.flowers.items[job.i].planted = true;
          job.i++;
          if (job.i < deco.flowers.items.length) {
            const h = deco.flowers.items[job.i];
            F.path = [{ x: h.x - 12, y: h.y }]; F.mode = 'toHole';
          } else { say(F, tr('done'), 'farmer'); F.path = [{ x: S.cx, y: P.y + P.h + 30 }, DOOR_OUT, DOOR_IN]; F.mode = 'off'; }
        }
      } else if (F.mode === 'toMow') {
        F.mode = 'mow'; F.workPh = 0; F.brrT = 0;
      } else if (F.mode === 'mow') {                         // summer: mow the lawn, strip by strip
        F.workPh += dt; F.brrT -= dt;
        if (F.brrT <= 0) { say(F, tr('brrm'), 'farmer'); F.brrT = 3.5; }
        if (sweepLanes(F, deco.mowed, C.mowSpeed, dt)) { say(F, tr('done'), 'farmer'); backInside(F); }
      } else if (F.mode === 'toTree') {                      // fall: pick the apples off the tree
        const t = job.trees[job.i];
        F.mode = 'pick'; F.workPh = 0;
        const d = Math.hypot(F.x - t.x, F.y - t.y) || 1;
        job.barrowAt = { x: F.x + (F.y - t.y) / d * 14, y: F.y - (F.x - t.x) / d * 14, ang: Math.atan2(t.y - F.y, t.x - F.x) };
        job.start = t.apples;
      } else if (F.mode === 'pick') {
        const t = job.trees[job.i];
        F.ang = Math.atan2(t.y - F.y, t.x - F.x);
        F.workPh += dt;
        const want = Math.round(job.start * clamp(F.workPh / C.pickTime, 0, 1));
        const left = Math.max(1, job.start - want);
        barrow.apples += t.apples - left; t.apples = left;
        if (F.workPh >= C.pickTime) {
          job.barrowAt = null;
          job.i++;
          if (job.i < job.trees.length) { F.path = [...job.trees[job.i].way]; F.mode = 'toTree'; }
          else {
            say(F, tr('applesDone'), 'farmer');
            F.path = [...job.home, DOOR_OUT, DOOR_IN]; F.mode = 'off';
          }
        }
      } else if (F.mode === 'snowman' || F.mode === 'roll') {   // winter: build a snowman
        F.mode = 'snowman';
        snowmanStep(F, dt);
      } else if (F.mode === 'bench') {
        F.ang = Math.PI / 2;                                                  // looking out over the pasture
        F.sipT -= dt;
        if (F.sipT <= 0) {
          F.sips++;
          if (F.sips === 1) say(F, tr('prost'), 'farmer');
          else if (F.sips % 3 === 0) say(F, tr('ahh'), 'farmer');
          F.sipT = rand(4, 7);
        }
      }
    }
    F.vx = F.vy = 0;
    if (F.path.length) {
      const t = F.path[0], d = Math.hypot(t.x - F.x, t.y - F.y);
      const sp = C.speed * (F.mode === 'inside' ? 0.6 : F.mode === 'roll' ? 0.7 : 1) * (isWinter() ? 1.25 : 1);   // hurries in the cold
      if (d < 3) F.path.shift();
      else {
        F.vx = ((t.x - F.x) / d) * sp; F.vy = ((t.y - F.y) / d) * sp;
        F.x += ((t.x - F.x) / d) * Math.min(d, sp * dt);
        F.y += ((t.y - F.y) / d) * Math.min(d, sp * dt);
        if (F.mode === 'roll') {
          job.roll += Math.min(d, sp * dt);
          const k = Math.floor((job.step - 1) / 3);
          job.rollR = 2.5 + (BALLS[k] - 2.5) * clamp(job.roll / job.rollLen, 0, 1);
          const bx = F.x + Math.cos(F.ang) * (9 + job.rollR), by = F.y + Math.sin(F.ang) * (9 + job.rollR);
          const last = deco.trail[deco.trail.length - 1];
          if (!last || Math.hypot(last.x - bx, last.y - by) > 3) deco.trail.push({ x: bx, y: by, r: job.rollR });
        }
        const want = Math.atan2(t.y - F.y, t.x - F.x);
        F.ang += Math.atan2(Math.sin(want - F.ang), Math.cos(want - F.ang)) * Math.min(1, 8 * dt);
        F.moving = true;
        F.walkPh += dt * 9;
        // a sheep right in his way
        if (F.hopCD <= 0 && sheep.some((s) => Math.hypot(s.x - F.x - Math.cos(F.ang) * 14, s.y - F.y - Math.sin(F.ang) * 14) < s.r + 6)) {
          say(F, tr('hopp'), 'farmer'); F.hopCD = 4;
        }
      }
    }
  }

  function updateTractor(dt) {
    const C = CFG.tractor, T = tractor;
    T.honkCD -= dt;
    const h = state.hour, leave = tractorLeaveHour();
    T.moving = false;
    if (T.mode === 'away') {
      if (state.tractorToday && h >= C.arrive && h < leave - 1 && phaseName() === 'day') T.mode = 'opening';
    } else if (T.mode === 'opening') {
      T.gate = Math.min(1, T.gate + dt / 1.3);
      if (T.gate >= 1) {
        T.mode = 'in'; T.y = -TR.L / 2 - 6;
        showMsg(tr(state.relax ? 'tractorRelax' : 'tractor'), 5.5);
        say({ x: GATE.cx, y: 16 }, tr('honk'), 'tractor'); T.honkCD = 2;
        if (!inStable(dog) && dog.woofCD <= 0) { say(dog, tr('woof2'), 'dog'); dog.woofCD = 2; }
      }
    } else if (T.mode === 'in') {
      if (!tractorBlocked(1)) { T.y += C.speed * dt; T.moving = true; }
      if (T.y >= tractorParkY()) { T.y = tractorParkY(); T.mode = 'parked'; T.circles.forEach((c, i) => { c.x = GATE.cx; c.y = T.y + (i - 1) * 20; }); farmerGetsOff(); }
    } else if (T.mode === 'parked') {
      // the farmer heads back a bit early (walking takes a while), then they drive off
      if (h >= leave - CFG.farmer.walkBack || phaseName() !== 'day') {
        if (farmer.mode === 'aboard') { T.mode = 'out'; T.beepT = 0.8; }   // off we go
        else if (farmer.mode !== 'return') farmerGoesBack();
      }
    } else if (T.mode === 'out') {
      if (!tractorBlocked(-1)) {
        T.y -= C.speed * 0.7 * dt; T.moving = true;
        T.beepT -= dt;
        if (T.beepT <= 0 && T.y > 20) { say({ x: GATE.cx, y: T.y + TR.L / 2 }, tr('beep'), 'tractor'); T.beepT = 1.6; }
      }
      if (T.y < -TR.L / 2 - 8) { T.mode = 'closing'; T.y = -80; }
    } else if (T.mode === 'closing') {
      T.gate = Math.max(0, T.gate - dt / 1.3);
      if (T.gate <= 0) T.mode = 'away';
    }
    // collision circles along the body
    T.circles.forEach((c, i) => { c.x = GATE.cx; c.y = T.y + (i - 1) * 20; });
    // exhaust puffs while the engine runs
    if (T.mode === 'in' || T.mode === 'out') {
      T.puffT -= dt;
      if (T.puffT <= 0) {
        T.puffs.push({ x: GATE.cx + 5, y: T.y + 2, t: 0, life: rand(0.8, 1.2), dx: rand(-5, 5), dy: rand(-5, 5) });
        T.puffT = T.moving ? 0.12 : 0.3;
      }
    }
    for (const p of T.puffs) { p.t += dt; p.x += p.dx * dt; p.y += p.dy * dt; }
    T.puffs = T.puffs.filter((p) => p.t < p.life);
  }

  // Push a circle out of the tractor
  function collideTractor(e) {
    if (!tractorHere()) return;
    for (const o of tractor.circles) {
      let nx = e.x - o.x, ny = e.y - o.y;
      const d = Math.hypot(nx, ny), min = o.r + e.r;
      if (d < min) {
        if (d < 1e-6) { nx = 1; ny = 0; } else { nx /= d; ny /= d; }
        e.x = o.x + nx * min; e.y = o.y + ny * min;
        const vn = e.vx * nx + e.vy * ny;
        if (vn < 0) { e.vx -= vn * nx; e.vy -= vn * ny; }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Main update
  // ---------------------------------------------------------------------------
  function update(dt) {
    updateClock(dt);
    if (state.screen !== 'play') return;

    // wolves arriving
    for (const q of state.spawnQ) {
      q.t -= dt;
      if (q.t <= 0) spawnWolf(q.night);
    }
    state.spawnQ = state.spawnQ.filter((q) => q.t > 0);

    applyArrowKeys();
    updateTractor(dt);
    updateFarmer(dt);
    updateDog(dt);
    updateDucks(dt);
    updateStreams(dt);
    for (const s of sheep) updateSheep(s, dt);
    for (const w of wolves) updateWolf(w, dt);
    wolves = wolves.filter((w) => !w.gone);
    resolveCollisions();
    updatePrints(dt);

    for (const f of state.floats) { f.t -= dt; f.y -= 18 * dt; }
    state.floats = state.floats.filter((f) => f.t > 0);
    if (state.msg) { state.msg.t -= dt; if (state.msg.t <= 0) state.msg = null; }
    state.sheepTalkCD -= dt;
    state.wolfTalkCD -= dt;
    if (state.marker) { state.marker.t -= dt; if (state.marker.t <= 0) state.marker = null; }

    if (state.overDelay > 0) {
      state.overDelay -= dt;
      if (state.overDelay <= 0) {
        state.screen = 'over'; state.overT = 0;
        if (savedInfo && savedInfo.gameId === state.gameId) deleteSave();   // this game is over
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  // Pre-rendered pasture
  const grass = document.createElement('canvas');
  grass.width = FW; grass.height = FH;
  (function paintGrass() {
    const g = grass.getContext('2d');
    let seed = 12345;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

    // a bit drier than the grass patches, so those stand out
    const grd = g.createLinearGradient(0, 0, FW, FH);
    grd.addColorStop(0, '#9cbf68');
    grd.addColorStop(1, '#88ad58');
    g.fillStyle = grd;
    g.fillRect(0, 0, FW, FH);

    for (let i = 0; i < 45; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,240,180,0.035)' : 'rgba(40,60,0,0.03)';
      g.beginPath();
      g.ellipse(rnd() * FW, rnd() * FH, 40 + rnd() * 90, 30 + rnd() * 70, rnd() * TAU, 0, TAU);
      g.fill();
    }
    g.lineWidth = 1.1;
    for (let i = 0; i < 1800; i++) {
      const x = rnd() * FW, y = rnd() * FH;
      g.strokeStyle = rnd() < 0.55 ? 'rgba(70,100,35,0.3)' : 'rgba(210,225,150,0.3)';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + rnd() * 4 - 2, y - 2 - rnd() * 3);
      g.stroke();
    }
    for (let i = 0; i < 70; i++) {
      g.fillStyle = 'rgba(120,110,90,0.35)'; // little stones
      g.beginPath();
      g.arc(rnd() * FW, rnd() * FH, 1 + rnd() * 1.5, 0, TAU);
      g.fill();
    }
    // wooden fence around the pasture
    g.strokeStyle = '#8a5a2b';
    g.lineWidth = 4;
    g.beginPath();                                   // (with an opening for the gate at the top)
    g.moveTo(GATE.x0, 4); g.lineTo(4, 4); g.lineTo(4, FH - 4); g.lineTo(FW - 4, FH - 4); g.lineTo(FW - 4, 4); g.lineTo(GATE.x1, 4);
    g.stroke();
    g.fillStyle = '#6b4320';
    for (let x = 4; x <= FW - 4; x += 48) {
      if (x < GATE.x0 - 4 || x > GATE.x1 + 4) g.fillRect(x - 3, 1, 6, 7);
      g.fillRect(x - 3, FH - 8, 6, 7);
    }
    for (let y = 4; y <= FH - 4; y += 48) { g.fillRect(1, y - 3, 7, 6); g.fillRect(FW - 8, y - 3, 7, 6); }
  })();

  // Night overlay canvas
  const shade = document.createElement('canvas');
  shade.width = FW; shade.height = FH;
  const sctx = shade.getContext('2d');

  // Two lamps on the wall, left and right of the stable door; they switch on when it gets dark
  const LAMPS = [{ x: S.d0 - 9, y: S.bottom + 9 }, { x: S.d1 + 9, y: S.bottom + 9 }];
  // How bright the door lamps are: at dusk and night, and also all day when it snows in winter
  function lampLevel() {
    const snowy = state.screen === 'play' && isWinter() && state.snowLevel > 0 ? 0.4 + 0.15 * state.snowLevel : 0;
    return Math.max(nightLevel, snowy);
  }
  const lampsOn = () => lampLevel() > 0.12;
  let roofAlpha = 1;

  function drawPatches() {
    for (const p of [...oldPatches, ...patches]) {
      const r = patchR(p);
      if (r < 1) continue;
      const m = p.tex.width / 2;
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TAU);
      ctx.clip();
      ctx.drawImage(p.tex, p.x - m, p.y - m);
      const si = seasonIndex();
      if (si === 2 && !p.winter) {   // fall: golden tips
        ctx.fillStyle = 'rgba(210,160,50,0.28)';
        ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
      }
      ctx.restore();
    }
  }

  // Cobblestone patio (one picture per season; grass grows between the stones, snow in winter)
  const patioTex = [];
  function makePatio(si, cleared = false) {
    const c = document.createElement('canvas');
    const k = 2;                                     // painted at double resolution
    c.width = (P.w + 8) * k; c.height = (P.h + 8) * k;
    const g = c.getContext('2d');
    g.scale(k, k);
    g.translate(4, 4);
    let seed = 4242;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const winter = si === 3;
    const blade = ['#4f8a2e', '#4e7e2c', '#8f7430', '#7f9070'][si];
    const tuft = (x, y, n, len) => {
      g.strokeStyle = blade; g.lineWidth = 0.8;
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + rnd() * 1.6 - 0.8;
        g.beginPath(); g.moveTo(x + rnd() * 3 - 1.5, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
      }
    };
    // sand bed between the stones
    g.fillStyle = cleared ? '#9c988c' : ['#b3a582', '#b5a680', '#b09a6c', '#dfe6ee'][si];
    g.beginPath(); g.roundRect(0, 0, P.w, P.h, 3); g.fill();
    // a few spots where the grass has taken over
    const clumps = [[0.2, 0.55, 11], [0.72, 0.35, 9], [0.5, 0.85, 8], [0.9, 0.8, 10], [0.08, 0.15, 7]]
      .map(([fx, fy, r]) => [fx * P.w, fy * P.h, r]);
    const grassy = (x, y) => clumps.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r);
    const green = cleared ? '#8d977c' : ['#86bb57', '#85b053', '#a6a356', '#eef3f8'][si];
    for (const [cx, cy, r] of clumps) {
      g.fillStyle = green;
      g.beginPath(); g.ellipse(cx, cy, r * 1.15, r * 0.95, 0.3, 0, TAU); g.fill();
    }
    // rows of rounded cobbles inside a frame of long curb stones
    const rowH = 10, m = 5;
    let row = 0;
    const gaps = [];
    for (let y = m; y < P.h - m - 3; y += rowH, row++) {
      let x = m + (row % 2 ? -4 : 0) + rnd() * 3;
      while (x < P.w - m - 4) {
        let w = 8 + rnd() * 7;
        if (x + w > P.w - m) w = P.w - m - x;
        const h = rowH - 1.5 - rnd() * 1.5;
        const cx = x + w / 2, cy = y + rowH / 2;
        if (w > 4 && x >= m - 1 && !grassy(cx, cy) && rnd() < 0.95) {
          const tone = 128 + Math.floor(rnd() * 48), warm = Math.floor(rnd() * 16);
          g.save();
          g.translate(cx, cy + rnd() * 1.4 - 0.7);
          g.rotate(rnd() * 0.16 - 0.08);
          g.fillStyle = 'rgba(40,35,25,0.35)';                     // joint / shadow
          g.beginPath(); g.roundRect(-w / 2 + 0.2, -h / 2 + 0.6, w - 0.4, h, 3.6); g.fill();
          g.fillStyle = `rgb(${tone + warm},${tone + Math.floor(warm / 2)},${tone - 8})`;
          g.beginPath(); g.roundRect(-w / 2 + 0.6, -h / 2, w - 1.2, h - 0.6, 3.4); g.fill();
          g.fillStyle = 'rgba(255,255,255,0.2)';                    // light on top
          g.beginPath(); g.roundRect(-w / 2 + 1.8, -h / 2 + 0.8, w - 4.2, h * 0.38, 2); g.fill();
          g.restore();
        } else gaps.push([cx, cy + 3]);
        x += w + 0.8;
      }
    }
    // curb: long stones along the border
    const curb = (x, y, w, h) => {
      const tone = 110 + Math.floor(rnd() * 25);
      g.fillStyle = 'rgba(40,35,25,0.4)';
      g.beginPath(); g.roundRect(x, y + 0.6, w, h, 1.6); g.fill();
      g.fillStyle = `rgb(${tone + 6},${tone + 3},${tone - 4})`;
      g.beginPath(); g.roundRect(x + 0.3, y, w - 0.6, h - 0.5, 1.6); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.fillRect(x + 1, y + 0.6, w - 2, 1.2);
    };
    for (const [y0, horiz] of [[0, true], [P.h - 4.5, true]]) {
      if (!horiz) continue;
      for (let x = 0; x < P.w - 1; ) { const w = Math.min(12 + rnd() * 8, P.w - x); curb(x, y0, w, 4.5); x += w + 0.6; }
    }
    for (const x0 of [0, P.w - 4.5]) {
      for (let y = 4.5; y < P.h - 5; ) { const w = Math.min(10 + rnd() * 6, P.h - 4.5 - y); curb(x0, y, 4.5, w); y += w + 0.6; }
    }
    for (const [cx, cy, r] of clumps) {                        // grass in the green spots
      for (let i = 0; i < r * 1.6; i++) tuft(cx + (rnd() - 0.5) * r * 1.6, cy + (rnd() - 0.5) * r * 1.4, 3, 3.5);
      gaps.push([cx, cy]);
    }
    // grass in the gaps and a few blades in the joints
    for (const [x, y] of gaps) tuft(x, y, winter ? 2 : 5, 4);
    for (let i = 0; i < 70; i++) tuft(rnd() * P.w, rnd() * P.h, 2, 2.6);
    if (cleared) {
      // shovelled: wet stones, a little frost left in the joints
      g.fillStyle = 'rgba(40,50,70,0.10)'; g.fillRect(0, 0, P.w, P.h);
      for (let i = 0; i < 140; i++) {
        g.fillStyle = `rgba(245,250,255,${0.35 + rnd() * 0.4})`;
        g.beginPath(); g.ellipse(rnd() * P.w, rnd() * P.h, 0.8 + rnd() * 1.8, 0.5 + rnd() * 0.8, 0, 0, TAU); g.fill();
      }
    } else if (winter) {
      // snow: drifts at the edges and in the gaps, a dusting on the stones
      for (let i = 0; i < 60; i++) {
        const x = rnd() * P.w, y = rnd() * P.h;
        const edge = Math.min(x, P.w - x, y, P.h - y);
        g.fillStyle = `rgba(248,251,255,${edge < 10 ? 0.92 : 0.6})`;
        g.beginPath(); g.ellipse(x, y, 4 + rnd() * 8, 2.5 + rnd() * 3.5, rnd() - 0.5, 0, TAU); g.fill();
      }
      for (const [x, y] of gaps) { g.fillStyle = 'rgba(248,251,255,0.9)'; g.beginPath(); g.ellipse(x, y - 3, 6, 4, 0, 0, TAU); g.fill(); }
    } else {
      // a few flowers (spring/summer) or dry seed heads (fall) where the grass grows
      const cols = si === 2 ? ['#d9a03a', '#c4512a'] : ['#ffffff', '#ffe66d', '#ff9ecd'];
      gaps.forEach(([x, y], i) => {
        if (i % (si === 1 ? 3 : 2)) return;
        g.fillStyle = cols[i % cols.length];
        g.beginPath(); g.arc(x + rnd() * 4 - 2, y - 4, 1.3, 0, TAU); g.fill();
      });
    }
    return c;
  }
  // Tractor tracks along the right wall of the stable (it was parked there): two tyre tracks with a
  // chevron tread that come in from the meadow in a curve. Worn grass / mud, pressed snow in winter.
  const TRACK = { x0: GATE.x0, y0: 0, x1: GATE.x1, y1: bowl.y - 8 };   // painted area
  const trackTex = [];
  function makeTracks(si) {
    const k = 2, W = TRACK.x1 - TRACK.x0, H = TRACK.y1 - TRACK.y0;
    const c = document.createElement('canvas');
    c.width = W * k; c.height = H * k;
    const g = c.getContext('2d');
    g.scale(k, k);
    g.translate(-TRACK.x0, -TRACK.y0);
    let seed = 99;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const winter = si === 3;
    if (winter) {                                    // snow in the gate opening too
      g.fillStyle = 'rgba(232,239,246,0.9)';
      g.fillRect(GATE.x0, 0, W, 7);
    }
    const band = ['rgba(98,84,46,0.30)', 'rgba(104,88,48,0.30)', 'rgba(108,76,38,0.40)', 'rgba(150,168,192,0.55)'][si];
    const tread = ['rgba(66,52,26,0.42)', 'rgba(70,55,28,0.42)', 'rgba(66,42,18,0.55)', 'rgba(104,124,152,0.65)'][si];
    const half = 13, bw = 9, yEnd = TRACK.y1 - 6;    // half the distance between the wheels, tyre width
    for (const side of [-1, 1]) {
      const x = GATE.cx + side * half;
      const line = (off, col, lw) => {
        g.strokeStyle = col; g.lineWidth = lw;
        g.beginPath(); g.moveTo(x + off, -2); g.lineTo(x + off, yEnd); g.stroke();
      };
      line(0, band, bw);
      if (winter) { line(bw / 2 + 0.8, 'rgba(255,255,255,0.85)', 1.6); line(-bw / 2 - 0.8, 'rgba(255,255,255,0.85)', 1.6); }
      else line(0, 'rgba(0,0,0,0.05)', bw - 4);
      // chevron tread marks
      g.strokeStyle = tread; g.lineWidth = 1.5; g.lineCap = 'round';
      for (let y = 0; y < yEnd - 2; y += 4.5) {
        const j = rnd() * 0.6;
        for (const sgn of [-1, 1]) {
          g.beginPath(); g.moveTo(x + sgn * 3.6, y - 2.6 - j); g.lineTo(x + sgn * 0.6, y); g.stroke();
        }
      }
      g.lineCap = 'butt';
    }
    if (winter) {                                     // a bit of fresh snow blown over the tracks
      for (let i = 0; i < 18; i++) {
        g.fillStyle = 'rgba(248,251,255,0.6)';
        g.beginPath(); g.ellipse(GATE.cx + (rnd() - 0.5) * 40, rnd() * yEnd, 3 + rnd() * 5, 1.5 + rnd() * 2, rnd(), 0, TAU); g.fill();
      }
    }
    // the tracks end softly where the tractor stood, just before the bowl
    g.globalCompositeOperation = 'destination-out';
    const fade = g.createLinearGradient(0, yEnd - 14, 0, yEnd);
    fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = fade; g.fillRect(TRACK.x0, yEnd - 14, W, 20);
    return c;
  }

  // The gate: two strong posts and a wooden gate. Closed, it fills the opening in the fence;
  // on tractor days it swings open into the pasture and rests against the inside of the fence.
  function drawGate() {
    const winter = isWinter();
    const open = state.screen === 'title' ? 0 : tractor.gate;
    const e = open * open * (3 - 2 * open);                               // ease in/out
    const th = Math.PI - e * (Math.PI - 0.07);                            // pointing left (closed) .. right (open)
    const hx = GATE.x1, hy = 11, Lg = GATE.x1 - GATE.x0 - 6, gh = 9;
    const c = Math.cos(th), sn = Math.sin(th);
    const p0 = { x: hx + c * 3, y: hy + sn * 3 }, p1 = { x: hx + c * (3 + Lg), y: hy + sn * (3 + Lg) };
    const at = (f, up) => ({ x: p0.x + (p1.x - p0.x) * f, y: p0.y + (p1.y - p0.y) * f - up });
    ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 3.5;            // shadow on the ground
    ctx.beginPath(); ctx.moveTo(p0.x + 2, p0.y + 2); ctx.lineTo(p1.x + 2, p1.y + 2); ctx.stroke();
    const bar = (a, b, w) => {
      ctx.lineWidth = w + 1.4; ctx.strokeStyle = '#4a2c12';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.lineWidth = w; ctx.strokeStyle = '#9a6633';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    };
    ctx.lineCap = 'butt';
    bar(at(0, 1.5), at(1, 1.5), 2);                                       // bottom rail
    bar(at(0, gh / 2 + 1), at(1, gh / 2 + 1), 1.6);                       // middle rail
    bar(at(0.04, 1.5), at(0.96, gh - 0.5), 1.6);                          // diagonal brace
    bar(at(0, gh), at(1, gh), 2);                                         // top rail
    bar(at(0, 0), at(0, gh + 1), 2.4);                                    // hinge stile
    bar(at(1, 0), at(1, gh + 1), 2.4);                                    // latch stile
    if (winter) {
      const a = at(0, gh + 1.6), b = at(1, gh + 1.6);
      ctx.strokeStyle = '#f4f8fc'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (const px of [GATE.x0, GATE.x1]) {                               // gate posts
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(px - 2, 3, 8, 9);
      ctx.fillStyle = '#5a361a'; ctx.fillRect(px - 4, 0, 8, 9);
      ctx.fillStyle = '#7d4d26'; ctx.fillRect(px - 3, 1, 6, 2);
      if (winter) { ctx.fillStyle = '#f4f8fc'; ctx.fillRect(px - 4, 0, 8, 2.5); }
    }
  }

  // The tractor seen from above, front pointing down (towards the bowl)
  function drawTractor() {
    if (!tractorHere() && !tractor.puffs.length) return;
    const x = GATE.cx, y = tractor.y;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, FW, FH); ctx.clip();               // it comes in from outside
    if (tractorHere()) {
      ctx.translate(x, y);
      const rr = (x0, y0, w, h, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x0, y0, w, h, r); ctx.fill(); };
      rr(-15, -28, 36, 64, 7, 'rgba(0,0,0,0.25)');                     // shadow
      const roll = ((tractor.y % 3) + 3) % 3;                            // tread moves when it rolls
      const wheel = (cx, cy, w, h) => {
        rr(cx - w / 2, cy - h / 2, w, h, 2.5, '#1d1d1d');
        ctx.strokeStyle = '#3d3d3d'; ctx.lineWidth = 1;
        for (let k = -h / 2 + roll; k < h / 2; k += 3) {
          ctx.beginPath(); ctx.moveTo(cx - w / 2 + 1, cy + k); ctx.lineTo(cx + w / 2 - 1, cy + k); ctx.stroke();
        }
      };
      for (const sg of [-1, 1]) wheel(sg * 13.5, -15, 9, 24);          // big rear wheels
      for (const sg of [-1, 1]) wheel(sg * 11, 19, 7, 13);             // small front wheels
      rr(-11, 18, 22, 3, 1, '#333');                                    // front axle
      rr(-7.5, -4, 15, 35, 4, '#b8231f');                               // engine hood
      rr(-7.5, -4, 4, 35, 3, 'rgba(255,255,255,0.18)');                 // light on its left side
      rr(-5.5, 28, 11, 3.5, 1, '#2a2a2a');                              // grille
      rr(-7, 30, 3, 2, 0.8, '#fff3b0'); rr(4, 30, 3, 2, 0.8, '#fff3b0'); // headlights
      for (const sg of [-1, 1]) {                                       // red mudguards over the rear wheels
        rr(sg * 13.5 - 6, -27, 12, 19, 4, '#9e1d1a');
        rr(sg * 13.5 - 5, -26, 10, 17, 3.5, '#c42a24');
      }
      rr(-12.5, -29, 25, 25, 3, '#2b2b2b');                             // cab
      rr(-11.5, -28, 23, 23, 2.5, isWinter() ? '#f7fafd' : '#eef0f0');  // white roof
      rr(-11.5, -28, 23, 7, 2.5, 'rgba(0,0,0,0.08)');
      ctx.fillStyle = '#3a3a3a';                                        // exhaust pipe
      ctx.beginPath(); ctx.arc(5, 2, 2, 0, TAU); ctx.fill();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(5, 2, 1, 0, TAU); ctx.fill();
      rr(-3, -34, 6, 5, 1, '#444');                                     // hitch at the back
      ctx.setTransform(pxScale, 0, 0, pxScale, 0, HUD * pxScale);
    }
    for (const p of tractor.puffs) {                                    // exhaust
      const f = p.t / p.life;
      ctx.fillStyle = `rgba(110,110,110,${0.28 * (1 - f)})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 1.5 + f * 4, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // The farmer seen from above: straw hat, blue Swiss farmer's shirt, arms swinging
  function drawFarmer() {
    if (!farmerOut()) return;
    const F = farmer;
    ctx.save();
    ctx.translate(F.x, F.y);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse(2.5, 3, 10, 8, 0, 0, TAU); ctx.fill();
    ctx.rotate(F.ang);
    const sw = F.moving ? Math.sin(F.walkPh) : 0;
    const sitting = F.mode === 'bench' && !F.moving;
    const working = F.mode === 'work' || F.mode === 'plantDig';
    ctx.fillStyle = '#3b2a1a';                                        // boots (stretched out when sitting)
    if (sitting) {
      ctx.fillStyle = '#2c3a52';                                      // trousers
      ctx.fillRect(2, -5, 8, 3.4); ctx.fillRect(2, 1.6, 8, 3.4);
      ctx.fillStyle = '#3b2a1a';
      ctx.beginPath(); ctx.ellipse(11, -3.3, 2.6, 2, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(11, 3.3, 2.6, 2, 0, 0, TAU); ctx.fill();
    } else {
      ctx.beginPath(); ctx.ellipse(sw * 4.5, -3.2, 3, 2, 0, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-sw * 4.5, 3.2, 3, 2, 0, 0, TAU); ctx.fill();
    }
    const petting = F.petT > 0;
    const hand = (x, y) => {
      ctx.strokeStyle = '#1f3c78'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, Math.sign(y) * 7); ctx.lineTo(x, y); ctx.stroke();
      ctx.fillStyle = '#f0c9a0'; ctx.beginPath(); ctx.arc(x, y, 2, 0, TAU); ctx.fill();
    };
    if (F.mode === 'plant' && !petting) {
      // kneeling, putting a little flower into the hole
      const h = deco.flowers && deco.flowers.items[job.i];
      hand(9, -3); hand(9, 3);
      if (h) { ctx.fillStyle = h.col; ctx.beginPath(); ctx.arc(12, 0, 1.8, 0, TAU); ctx.fill(); }
    } else if ((F.mode === 'mow' || F.mode === 'toMow') && !petting) {
      // pushing the lawn mower
      const vib = Math.sin(state.t * 40) * 0.4;
      ctx.strokeStyle = '#333'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(7, -4); ctx.lineTo(12, -4); ctx.moveTo(7, 4); ctx.lineTo(12, 4); ctx.stroke();
      ctx.fillStyle = '#1d1d1d'; ctx.fillRect(12, -7.5 + vib, 3, 2.5); ctx.fillRect(12, 5 + vib, 3, 2.5); ctx.fillRect(20, -7.5 + vib, 3, 2.5); ctx.fillRect(20, 5 + vib, 3, 2.5);
      ctx.fillStyle = '#c8302a'; ctx.beginPath(); ctx.roundRect(12.5, -6 + vib, 10, 12, 2.5); ctx.fill();
      ctx.fillStyle = '#e0e0e0'; ctx.beginPath(); ctx.arc(17.5, vib, 2.6, 0, TAU); ctx.fill();
      hand(7, -4); hand(7, 4);
    } else if (F.mode === 'pick' && !petting) {
      // picking: arms up into the tree, one after the other
      const up = Math.sin(F.workPh * 5);
      hand(10 + up * 2, -4); hand(10 - up * 2, 4);
      ctx.fillStyle = '#d5352a'; ctx.beginPath(); ctx.arc(11 + up * 2, -4, 1.6, 0, TAU); ctx.fill();
    } else if ((barrow.on && !inStable(F) && F.mode !== 'pick') || F.mode === 'roll') {
      hand(8, -5); hand(8, 5);                                          // pushing the barrow / the snowball
    } else if (F.mode === 'rake' && !petting) {
      // raking: long handle forward, the rake head across, swinging a little
      const sw2 = F.moving ? Math.sin(F.walkPh * 1.3) * 2 : 0;
      const hx = 15 + sw2;
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-1, 3); ctx.lineTo(hx, 0); ctx.stroke();
      ctx.strokeStyle = '#6d6d6d'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(hx, -6); ctx.lineTo(hx, 6); ctx.stroke();
      ctx.lineWidth = 0.8;
      for (let k = -6; k <= 6; k += 2) { ctx.beginPath(); ctx.moveTo(hx, k); ctx.lineTo(hx + 2.5, k); ctx.stroke(); }
      hand(4, 5); hand(9 + sw2 * 0.5, -1);
    } else if (working && !petting && dig.winter) {
      // pushing snow: shovel held low in front, a growing lump of snow on the blade
      const bx = 13;
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-1, 3); ctx.lineTo(bx, 0); ctx.stroke();
      ctx.fillStyle = '#9aa2a8';
      ctx.beginPath(); ctx.roundRect(bx, -5, 3, 10, 1.2); ctx.fill();
      if (F.moving) {
        const L = dig.lanes[Math.min(dig.lane, dig.lanes.length - 1)];
        const f = L && L.reach !== null ? clamp(Math.abs(L.reach - L.x0) / Math.abs(L.x1 - L.x0), 0, 1) : 0;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(bx + 4 + f * 2, 0, 2 + f * 3, 4 + f * 3, 0, 0, TAU); ctx.fill();
      }
      hand(4, 5); hand(8, -2);
    } else if (working && !petting) {
      // digging: the shovel goes into the ground, comes up, throws the earth to the side
      const c = (F.workPh % 1.4) / 1.4, push = Math.sin(c * TAU);
      const bx = 12 + push * 3, by = (c > 0.55 && c < 0.85 ? 6 : 0) + (dig.winter ? -1 : 0);
      ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 1.8; ctx.lineCap = 'round';   // handle
      ctx.beginPath(); ctx.moveTo(-1, 5); ctx.lineTo(bx, by); ctx.stroke();
      ctx.fillStyle = '#9aa2a8';                                                  // blade
      ctx.save(); ctx.translate(bx, by); ctx.rotate(Math.atan2(by - 5, bx + 1));
      ctx.beginPath(); ctx.roundRect(0, -2.6, 5, 5.2, 1.2); ctx.fill();
      if (c > 0.4 && c < 0.75) { ctx.fillStyle = dig.winter ? '#ffffff' : '#7a5532'; ctx.beginPath(); ctx.arc(2.5, 0, 2, 0, TAU); ctx.fill(); }
      ctx.restore();
      hand(4 + push * 1.5, 6 + by * 0.3); hand(8 + push * 2.5, -3 + by * 0.5);
    } else if (sitting && !petting) {
      const sip = F.sipT < 1.1 && F.sipT > 0;                                     // bottle to the mouth
      const bx = sip ? 4 : 8, by = sip ? -2 : -7;
      hand(bx, by);
      ctx.save(); ctx.translate(bx + (sip ? 1 : 1.5), by); ctx.rotate(sip ? -0.6 : 0.2);
      ctx.fillStyle = '#5a3612'; ctx.beginPath(); ctx.roundRect(-1.6, -3.4, 3.2, 6, 1.2); ctx.fill();   // beer bottle
      ctx.fillStyle = '#c9a03a'; ctx.fillRect(-1.2, -0.6, 2.4, 1.8);                                    // label
      ctx.fillStyle = '#3a240c'; ctx.fillRect(-0.7, -5, 1.4, 1.8);                                      // neck
      ctx.restore();
      hand(5, 8);
    } else {
      if (petting) hand(10 + Math.sin(state.t * 10) * 1.5, -3);           // patting the dog
      else hand(-sw * 4, -9);
      hand(sw * 4, 9);
    }
    ctx.fillStyle = '#1f3c78';                                        // shoulders (blue shirt)
    ctx.beginPath(); ctx.ellipse(0, 0, 5.5, 9, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff';                                        // edelweiss embroidery
    for (const [ex, ey] of [[2.5, -4], [2.5, 4]]) { ctx.beginPath(); ctx.arc(ex, ey, 0.9, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#e2c27a';                                        // straw hat
    ctx.beginPath(); ctx.arc(0.5, 0, 7.2, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#b8964f'; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.strokeStyle = '#a5322a'; ctx.lineWidth = 1.2;                  // red hat band
    ctx.beginPath(); ctx.arc(0.5, 0, 4.4, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#d4b264';
    ctx.beginPath(); ctx.arc(0.5, 0, 3.7, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath(); ctx.arc(-0.5, -1.2, 2, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // The bench against the front wall (snow on it in winter)
  function drawBench() {
    const { x, y, w } = BENCH, winter = isWinter();
    const rr = (x0, y0, ww, hh, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(x0, y0, ww, hh, r); ctx.fill(); };
    rr(x - w / 2 + 2, y - 2, w, 11, 2, 'rgba(0,0,0,0.22)');                  // shadow
    rr(x - w / 2 + 1, y + 5, 3, 4, 1, '#4a2c12'); rr(x + w / 2 - 4, y + 5, 3, 4, 1, '#4a2c12');   // legs
    rr(x - w / 2, y - 6, w, 3.5, 1.2, '#6e4320');                           // backrest against the wall
    rr(x - w / 2, y - 2, w, 8, 1.5, '#8a5a2b');                             // seat: two planks
    ctx.strokeStyle = '#5e3a1a'; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(x - w / 2 + 1, y + 2); ctx.lineTo(x + w / 2 - 1, y + 2); ctx.stroke();
    rr(x - w / 2, y - 2, w, 1.4, 1, 'rgba(255,255,255,0.15)');
    if (winter) {
      const busy = farmer.mode === 'bench' && farmerOut();
      ctx.fillStyle = 'rgba(248,251,255,0.95)';
      ctx.beginPath(); ctx.roundRect(x - w / 2 - 0.5, y - 6.8, w + 1, 2.2, 1); ctx.fill();
      if (!busy) { ctx.beginPath(); ctx.roundRect(x - w / 2 + 0.5, y - 2.5, w - 1, 5, 2); ctx.fill(); }
    }
  }

  // Today's dig site: a hole with a heap of earth, or (winter) a shovelled patch with a snow heap
  function drawDigSite() {
    if (!dig.on || dig.prog <= 0.01 || state.screen === 'title') return;
    const { x, y, prog } = dig;
    if (dig.winter) return;                                                  // (drawn with the patio)
    ctx.fillStyle = '#4a3420';                                               // the hole
    ctx.beginPath(); ctx.ellipse(x, y, 3 + 4 * prog, 2.5 + 3 * prog, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2e2014';
    ctx.beginPath(); ctx.ellipse(x + 0.5, y + 0.6, 1.5 + 3 * prog, 1.2 + 2.2 * prog, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.15)';                                      // heap of earth
    ctx.beginPath(); ctx.ellipse(x + 4, y + 13, 3 + 6 * prog, 2.5 + 4 * prog, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7a5532';
    ctx.beginPath(); ctx.ellipse(x + 3, y + 11, 2.5 + 6 * prog, 2 + 4 * prog, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#93693f';
    ctx.beginPath(); ctx.ellipse(x + 2, y + 10, 1.5 + 3.5 * prog, 1.2 + 2.2 * prog, 0, 0, TAU); ctx.fill();
  }

  // how far the snowman has melted (only on the first day of spring)
  function snowmanMelt() {
    const m = deco.snowman;
    return m && m.melting ? clamp((state.hour - 6.5) / 6, 0, 1) : 0;
  }

  // The farmer's work on the ground: flower bed, mown lawn, the track of the rolled snowballs
  function drawFarmWork() {
    if (state.screen === 'title') return;
    const si = seasonIndex();
    // mown lawn: light and dark stripes, fading as the grass grows back
    const M = deco.mowed;
    if (M && si === 1) {
      const fade = clamp(1 - (state.day - M.day) / 4, 0, 1);
      M.lanes.forEach((L, i) => {
        if (L.reach === null) return;
        const a = Math.min(L.x0, L.reach), b = Math.max(L.x0, L.reach);
        ctx.fillStyle = i % 2 ? `rgba(225,245,170,${0.30 * fade})` : `rgba(60,110,30,${0.22 * fade})`;
        ctx.fillRect(a, L.y - 7, b - a, 14);
        ctx.fillStyle = `rgba(150,200,90,${0.18 * fade})`;
        ctx.fillRect(a, L.y - 7, b - a, 1.5);
      });
    }
    // snowball track in the snow
    if (si === 3 && deco.trail.length > 1) {
      ctx.strokeStyle = 'rgba(150,170,195,0.35)'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < deco.trail.length; i++) {
        const a = deco.trail[i - 1], b = deco.trail[i];
        ctx.lineWidth = Math.max(2, b.r * 1.6);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
    // flower bed
    const FL = deco.flowers;
    if (!FL) return;
    const stage = flowerStage();
    for (const h of FL.items) {
      if (h.dug <= 0) continue;
      if (!h.planted) {                                                 // a fresh hole and its heap
        ctx.fillStyle = '#7a5532'; ctx.beginPath(); ctx.ellipse(h.x + 7, h.y + 3, 2 + 3 * h.dug, 1.5 + 2 * h.dug, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#3a2614'; ctx.beginPath(); ctx.ellipse(h.x, h.y, 1.5 + 3 * h.dug, 1.2 + 2.2 * h.dug, 0, 0, TAU); ctx.fill();
        continue;
      }
      ctx.fillStyle = '#6b4a2b'; ctx.beginPath(); ctx.ellipse(h.x, h.y + 1, 6, 3.6, 0, 0, TAU); ctx.fill();   // soil
      ctx.fillStyle = '#80593a'; ctx.beginPath(); ctx.ellipse(h.x - 1, h.y, 3.5, 2, 0, 0, TAU); ctx.fill();
      if (!stage) continue;
      const leaf = stage === 'dry' ? '#8a7440' : stage === 'wilt' ? '#7d8a3a' : '#4f9a36';
      const lean = stage === 'droop' ? 2.5 : stage === 'wilt' ? 3.5 : stage === 'dry' ? 2.5 : 0;
      ctx.strokeStyle = leaf; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      const n = stage === 'sprout' ? 2 : 3;
      for (let k = 0; k < n; k++) {                                     // stems
        const sx = h.x + (k - (n - 1) / 2) * 3, len = stage === 'sprout' ? 3 : stage === 'bud' ? 6 : 8;
        ctx.beginPath(); ctx.moveTo(sx, h.y); ctx.quadraticCurveTo(sx, h.y - len * 0.6, sx + lean + (k - 1) * 0.8, h.y - len); ctx.stroke();
        const tx = sx + lean + (k - 1) * 0.8, ty = h.y - len;
        if (stage === 'sprout') { ctx.fillStyle = leaf; ctx.beginPath(); ctx.ellipse(tx, ty, 1.6, 0.9, 0.5, 0, TAU); ctx.fill(); continue; }
        if (stage === 'bud') { ctx.fillStyle = h.col; ctx.beginPath(); ctx.ellipse(tx, ty, 1.3, 1.8, 0, 0, TAU); ctx.fill(); continue; }
        if (stage === 'dry') { ctx.fillStyle = '#6e5430'; ctx.beginPath(); ctx.arc(tx, ty, 1.2, 0, TAU); ctx.fill(); continue; }
        // a blossom (paler and drooping when wilting)
        const r = stage === 'wilt' ? 1.6 : 2.4;
        ctx.globalAlpha = stage === 'wilt' ? 0.65 : stage === 'droop' ? 0.75 : 1;
        ctx.fillStyle = stage === 'wilt' ? '#b89060' : h.col;
        for (let pI = 0; pI < 5; pI++) {
          const a = pI * TAU / 5 + k;
          ctx.beginPath(); ctx.arc(tx + Math.cos(a) * r * 0.8, ty + Math.sin(a) * r * 0.8, r * 0.7, 0, TAU); ctx.fill();
        }
        ctx.fillStyle = '#ffd84d'; ctx.beginPath(); ctx.arc(tx, ty, r * 0.45, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineCap = 'butt';
    }
  }

  // The snowman: three snowballs seen slightly from the side, coal eyes, carrot nose, stick arms, red scarf
  function drawSnowman() {
    const m = deco.snowman;
    if (!m || !m.balls.length || state.screen === 'title') return;
    const melt = snowmanMelt(), k = 1 - melt * 0.92;
    const { x, y } = m;
    if (melt > 0) {                                                     // meltwater
      ctx.fillStyle = `rgba(120,160,200,${0.25 + 0.3 * melt})`;
      ctx.beginPath(); ctx.ellipse(x + 2, y + 4, 10 + 10 * melt, 6 + 5 * melt, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = 'rgba(40,60,90,0.2)';                               // shadow
    ctx.beginPath(); ctx.ellipse(x + 4, y + 4, (m.balls[0] + 2) * k, (m.balls[0] - 1) * k, 0, 0, TAU); ctx.fill();
    let cy = y;
    const centers = [];
    m.balls.forEach((r0, i) => {
      if (!r0) return;
      const r = r0 * k;
      if (i > 0) cy -= (m.balls[i - 1] * k) * 0.75 + r * 0.6;
      centers.push({ x, y: cy, r });
      const g = ctx.createRadialGradient(x - r * 0.35, cy - r * 0.35, r * 0.2, x, cy, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c9d6e4');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, cy, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(120,140,170,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();
    });
    const d = m.deco;
    const body = centers[1], head = centers[2];
    if (!head || melt > 0.85) {
      if (melt > 0.85) {                                                // left over: carrot and coal
        ctx.fillStyle = '#e8762b'; ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x + 5, y + 1); ctx.lineTo(x - 2, y + 2); ctx.fill();
        ctx.fillStyle = '#222'; for (const [a, b] of [[x - 5, y - 2], [x + 4, y - 3], [x - 1, y + 4]]) { ctx.beginPath(); ctx.arc(a, b, 1, 0, TAU); ctx.fill(); }
      }
      return;
    }
    if (d > 0.5 && body) {                                              // stick arms
      ctx.strokeStyle = '#5a3a1a'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      for (const sg of [-1, 1]) {
        ctx.beginPath(); ctx.moveTo(x + sg * body.r * 0.8, body.y - 1); ctx.lineTo(x + sg * (body.r + 7) * k, body.y - 5 * k); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + sg * (body.r + 4) * k, body.y - 3 * k); ctx.lineTo(x + sg * (body.r + 6) * k, body.y - 7 * k); ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
    if (d > 0.75 && body) {                                             // coal buttons
      ctx.fillStyle = '#222';
      for (const yy of [-0.3, 0.2]) { ctx.beginPath(); ctx.arc(x, body.y + yy * body.r, 1 * k, 0, TAU); ctx.fill(); }
    }
    if (d > 0.9) {                                                      // red scarf
      ctx.fillStyle = '#c42a24';
      ctx.fillRect(x - head.r * 0.9, head.y + head.r * 0.65, head.r * 1.8, 2.2 * k);
      ctx.fillRect(x + head.r * 0.3, head.y + head.r * 0.65, 2 * k, 5 * k);
    }
    if (d > 0.25) {                                                     // eyes and carrot nose
      ctx.fillStyle = '#1a1a1a';
      for (const sg of [-1, 1]) { ctx.beginPath(); ctx.arc(x + sg * head.r * 0.38, head.y - head.r * 0.2, 0.9 * k, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#e8762b';
      ctx.beginPath(); ctx.moveTo(x, head.y + head.r * 0.05); ctx.lineTo(x + head.r * 1.2, head.y + head.r * 0.25); ctx.lineTo(x, head.y + head.r * 0.4); ctx.fill();
    }
  }

  // The wheelbarrow (with the apples picked so far)
  function drawBarrow(x, y, ang, apples) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(1.5, 2, 9, 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222'; ctx.fillRect(7, -1.5, 4, 3);                // wheel in front
    ctx.strokeStyle = '#6b4320'; ctx.lineWidth = 1.4;                    // handles back to the farmer
    for (const sg of [-1, 1]) { ctx.beginPath(); ctx.moveTo(-6, sg * 4); ctx.lineTo(-13, sg * 4.5); ctx.stroke(); }
    ctx.fillStyle = '#3f7d5a';                                          // the tub
    ctx.beginPath(); ctx.moveTo(-7, -6); ctx.lineTo(6, -4.5); ctx.lineTo(8, 0); ctx.lineTo(6, 4.5); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2e5f43';
    ctx.beginPath(); ctx.moveTo(-5.5, -4.5); ctx.lineTo(5, -3.2); ctx.lineTo(6.2, 0); ctx.lineTo(5, 3.2); ctx.lineTo(-5.5, 4.5); ctx.closePath(); ctx.fill();
    for (let i = 0; i < Math.min(apples, 24); i++) {                    // apples
      const ax = -4 + (i % 5) * 2.2 + (Math.floor(i / 5) % 2) * 1.1, ay = -3 + ((i * 7) % 5) * 1.5;
      ctx.fillStyle = i % 4 === 3 ? '#e8b84a' : '#c8302a';
      ctx.beginPath(); ctx.arc(ax, ay, 1.3, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
  // the farmer's things that move with him: wheelbarrow, snowball being rolled
  function drawFarmerGear() {
    if (!farmerOut()) return;
    const F = farmer;
    if (barrow.on && !inStable(F)) {
      if (job.barrowAt && F.mode === 'pick') drawBarrow(job.barrowAt.x, job.barrowAt.y, job.barrowAt.ang, barrow.apples);
      else drawBarrow(F.x + Math.cos(F.ang) * 16, F.y + Math.sin(F.ang) * 16, F.ang, barrow.apples);
    }
    if (F.mode === 'roll' && job.rollR > 0) {
      const r = job.rollR, bx = F.x + Math.cos(F.ang) * (9 + r), by = F.y + Math.sin(F.ang) * (9 + r);
      const g = ctx.createRadialGradient(bx - r * 0.35, by - r * 0.35, r * 0.2, bx, by, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c9d6e4');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(120,140,170,0.5)'; ctx.lineWidth = 0.8; ctx.stroke();
    }
  }

  // Fog: two layers of soft fog banks drifting slowly, over a milky haze. Close around the dog
  // you can still see a bit; further away the sheep disappear in it.
  const fogBank = (() => {
    const c = document.createElement('canvas');
    c.width = FW; c.height = FH;
    const g = c.getContext('2d');
    let seed = 31;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 70; i++) {
      const x = rnd() * FW, y = rnd() * FH, r = 60 + rnd() * 140;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(236,238,240,${0.35 + rnd() * 0.3})`); gr.addColorStop(1, 'rgba(236,238,240,0)');
      g.fillStyle = gr;
      for (const [dx, dy] of [[0, 0], [-FW, 0], [FW, 0], [0, -FH], [0, FH]]) { g.save(); g.translate(dx, dy); g.fillRect(x - r, y - r, 2 * r, 2 * r); g.restore(); }
    }
    return c;
  })();
  const fogLayer = document.createElement('canvas');
  fogLayer.width = FW; fogLayer.height = FH;
  // Blizzard: blowing snow hides the pasture (gusting), you see a bit around the dog
  function drawWhiteout(bz) {
    const g = fogLayer.getContext('2d'), C = CFG.blizzard;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, FW, FH);
    g.fillStyle = `rgba(232,238,245,${C.whiteout * bz})`;
    g.fillRect(0, 0, FW, FH);
    const ox = ((state.t * 260) % FW + FW) % FW;                       // snow clouds racing across
    g.globalAlpha = 0.6 * bz;
    for (const dx of [ox - FW, ox]) g.drawImage(fogBank, dx, 0);
    g.globalAlpha = 1;
    if (dog) {
      const R = C.clearView, gr = g.createRadialGradient(dog.x, dog.y, R * 0.25, dog.x, dog.y, R);
      gr.addColorStop(0, 'rgba(0,0,0,0.4)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = gr; g.fillRect(dog.x - R, dog.y - R, 2 * R, 2 * R);
      g.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(fogLayer, 0, 0, FW, FH);
  }

  function drawFog() {
    const bz = blizzardLevel();
    if (bz > 0) return drawWhiteout(bz);
    const lvl = fogLevel();
    if (lvl <= 0.01) return;
    const g = fogLayer.getContext('2d');
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, FW, FH);
    g.fillStyle = `rgba(222,226,230,${0.78 * lvl})`;                    // milky haze
    g.fillRect(0, 0, FW, FH);
    const t = state.t;
    for (const [sp, a] of [[6, 0.9], [11, 0.7]]) {                       // drifting fog banks
      const ox = ((t * sp) % FW + FW) % FW, oy = Math.sin(t * 0.05 * sp) * 20;
      g.globalAlpha = a * lvl;
      for (const dx of [ox - FW, ox]) g.drawImage(fogBank, dx, oy);
    }
    g.globalAlpha = 1;
    if (dog) {                                                           // you can see a little around the dog
      const R = CFG.fog.clearView, gr = g.createRadialGradient(dog.x, dog.y, R * 0.25, dog.x, dog.y, R);
      gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = gr; g.fillRect(dog.x - R, dog.y - R, 2 * R, 2 * R);
      g.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(fogLayer, 0, 0, FW, FH);
  }

  const dogName = () => String(CFG.dog.name || 'Barry').trim().slice(0, 14) || 'Barry';

  // The dog's hut seen from above: a little gable roof, the door at the front, a name board
  function drawDogHut() {
    const { x, y, w, h } = HUT, winter = isWinter();
    const x0 = x - w / 2, y0 = y - h / 2;
    const rr = (a, b, ww, hh, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(a, b, ww, hh, r); ctx.fill(); };
    rr(x0 + 4, y0 + 5, w, h, 3, 'rgba(0,0,0,0.25)');                     // shadow
    // front wall with the round door (seen below the roof edge)
    rr(x0 + 3, y0 + h - 6, w - 6, 9, 1.5, '#8a5a2b');
    ctx.fillStyle = '#2a1a0c';
    ctx.beginPath(); ctx.moveTo(x - 7, y0 + h + 3); ctx.lineTo(x - 7, y0 + h - 2); ctx.arc(x, y0 + h - 2, 7, Math.PI, 0); ctx.lineTo(x + 7, y0 + h + 3); ctx.fill();
    if (dog && inHut(dog) && state.screen !== 'title') {                 // the nose in the door (eyes shut when asleep)
      ctx.fillStyle = '#9a4f22'; ctx.beginPath(); ctx.ellipse(x, y0 + h + 0.5, 4.5, 3.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#fbf6ee'; ctx.beginPath(); ctx.ellipse(x, y0 + h + 2, 2.6, 1.8, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(x, y0 + h + 3.2, 1, 0, TAU); ctx.fill();
      if (dog.sleeping) {
        ctx.strokeStyle = '#2a1a0c'; ctx.lineWidth = 0.8;                 // closed eyes
        for (const sg of [-1, 1]) { ctx.beginPath(); ctx.arc(x + sg * 2, y0 + h - 1, 1.1, 0.2, Math.PI - 0.2); ctx.stroke(); }
      } else {
        ctx.fillStyle = '#111';                                           // awake: eyes open
        for (const sg of [-1, 1]) { ctx.beginPath(); ctx.arc(x + sg * 2, y0 + h - 1.2, 0.9, 0, TAU); ctx.fill(); }
      }
    }
    // the roof: two slopes and a ridge along the long side
    rr(x0, y0, w, h - 4, 2, '#7a2e1d');
    rr(x0, y0, w, (h - 4) / 2, 2, '#a3412a');
    ctx.strokeStyle = 'rgba(40,10,5,0.4)'; ctx.lineWidth = 0.8;
    for (let k = 1; k < 4; k++) { const yy = y0 + k * (h - 4) / 4; ctx.beginPath(); ctx.moveTo(x0 + 1, yy); ctx.lineTo(x0 + w - 1, yy); ctx.stroke(); }
    rr(x0, y0 + (h - 4) / 2 - 1.5, w, 3, 1, '#5a2318');
    if (winter) {
      rr(x0 - 0.5, y0 - 0.5, w + 1, h - 3, 3, 'rgba(246,250,253,0.95)');
      ctx.fillStyle = 'rgba(150,170,195,0.3)'; ctx.fillRect(x0, y0 + (h - 4) / 2, w, (h - 4) / 2);
    }
    // name board over the door (it grows with the name; long names get smaller letters)
    const name = dogName().toUpperCase();
    let fs = 5.5;
    ctx.font = `600 ${fs}px system-ui, sans-serif`;
    let tw = ctx.measureText(name).width;
    if (tw > w - 8) { fs *= (w - 8) / tw; ctx.font = `600 ${fs}px system-ui, sans-serif`; tw = ctx.measureText(name).width; }
    const bw = Math.max(20, tw + 6);
    rr(x - bw / 2, y0 + h - 9, bw, 7, 1, '#e8d7ae');
    ctx.fillStyle = '#4a2c12'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, x, y0 + h - 5.4);
  }

  function drawTracks() {
    const si = seasonIndex();
    if (!trackTex[si]) trackTex[si] = makeTracks(si);
    ctx.drawImage(trackTex[si], TRACK.x0, TRACK.y0, TRACK.x1 - TRACK.x0, TRACK.y1 - TRACK.y0);
  }

  function drawPatio() {
    const si = seasonIndex();
    if (!patioTex[si]) patioTex[si] = makePatio(si);
    ctx.drawImage(patioTex[si], P.x - 4, P.y - 4, P.w + 8, P.h + 8);
    // fall: the heaps of raked leaves at the ends of the strips (the leaves themselves lie on top)
    if (si === 2 && rake.on && state.screen !== 'title') {
      rake.lanes.forEach((L, i) => {
        if (L.reach === null) return;
        const f = clamp(Math.abs(L.reach - L.x0) / Math.abs(L.x1 - L.x0), 0, 1);
        if (f < 0.15) return;
        const hx = L.reach - L.dir * 3, r = 2 + 5 * f;
        ctx.fillStyle = 'rgba(60,35,10,0.25)';
        ctx.beginPath(); ctx.ellipse(hx + 1.2, L.y + 2, r * 0.9, r * 1.3, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#a3612a';
        ctx.beginPath(); ctx.ellipse(hx, L.y, r * 0.85, r * 1.25, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#c98a3a';
        ctx.beginPath(); ctx.ellipse(hx - r * 0.2, L.y - r * 0.35, r * 0.45, r * 0.6, 0, 0, TAU); ctx.fill();
      });
    }
    // winter: the strips the farmer has shovelled today show the stones again
    if (si === 3 && dig.on && dig.winter && state.screen !== 'title') {
      if (!patioTex.cleared) patioTex.cleared = makePatio(3, true);
      for (const L of dig.lanes) {
        if (L.reach === null) continue;
        const a = Math.min(L.x0, L.reach), b = Math.max(L.x0, L.reach);
        if (b - a < 1) continue;
        ctx.save();
        ctx.beginPath(); ctx.roundRect(a, L.y - LANE_H / 2, b - a, LANE_H, 4); ctx.clip();
        ctx.drawImage(patioTex.cleared, P.x - 4, P.y - 4, P.w + 8, P.h + 8);
        ctx.restore();
      }
      // the snow pushed to the end of each strip
      for (const L of dig.lanes) {
        if (L.reach === null) continue;
        const f = clamp(Math.abs(L.reach - L.x0) / Math.abs(L.x1 - L.x0), 0, 1);
        if (f < 0.05) continue;
        const hx = L.reach + L.dir * (4 + 3 * f), r = 3 + 6 * f;
        ctx.fillStyle = 'rgba(60,80,110,0.18)';
        ctx.beginPath(); ctx.ellipse(hx + 1.5, L.y + 2.5, r * 0.8, r * 1.15, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#f7fafd';
        ctx.beginPath(); ctx.ellipse(hx, L.y, r * 0.8, r * 1.15, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.ellipse(hx - r * 0.2, L.y - r * 0.3, r * 0.4, r * 0.5, 0, 0, TAU); ctx.fill();
      }
    }
  }

  // Swiss flag (red square, white cross) waving on a pole
  const flagTex = (() => {
    const n = 40, c = document.createElement('canvas');
    c.width = c.height = n;
    const g = c.getContext('2d');
    g.fillStyle = '#d52b1e'; g.fillRect(0, 0, n, n);
    const arm = n * 6 / 32, len = n * 20 / 32;     // official proportions
    g.fillStyle = '#ffffff';
    g.fillRect((n - arm) / 2, (n - len) / 2, arm, len);
    g.fillRect((n - len) / 2, (n - arm) / 2, len, arm);
    return c;
  })();
  // The flag's wind: a steady breeze whose direction sways just a little
  const flagWind = { base: rand(-0.35, 0.35) };
  function flagWindNow() {
    const t = state.t;
    return { dir: flagWind.base + 0.18 * Math.sin(t * 0.11) + 0.08 * Math.sin(t * 0.37 + 1), str: 0.62 };
  }

  function drawFlag() {
    const { x, y, h, size } = FLAG, top = y - h;
    const winter = isWinter();
    const { dir, str } = flagWindNow();
    // which way the flag blows (seen from above at a slant), how far it stands out, how much it hangs
    const gx = Math.cos(dir), gy = Math.sin(dir);
    const ux = Math.sign(gx || 1) * Math.max(Math.abs(gx), 0.4), uy = gy * 0.45;   // never quite edge-on
    const L = size * (0.45 + 0.55 * str), droop = (1 - str) * size * 0.6;
    const amp = 0.4 + 1.4 * str, speed = 3 + 4 * str;
    // shadows on the ground (the sun is up-left, like for the roof)
    ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + h * 0.42, y + h * 0.3); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    const ax = x + h * 0.41, ay = y + h * 0.29, bx = x + h * 0.26, by = y + h * 0.19;
    ctx.beginPath();
    ctx.moveTo(ax, ay); ctx.lineTo(ax + gx * L, ay + gy * L * 0.8);
    ctx.lineTo(bx + gx * L, by + gy * L * 0.8); ctx.lineTo(bx, by);
    ctx.fill();
    // stone base
    ctx.fillStyle = winter ? '#eef3f8' : '#8d877b';
    ctx.beginPath(); ctx.ellipse(x, y, 6, 3.5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = winter ? '#b8c6d4' : '#5f5a50'; ctx.lineWidth = 1; ctx.stroke();
    const pole = () => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#6d6d6d'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, top); ctx.stroke();
      ctx.strokeStyle = '#e3e3e3'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x - 0.5, y - 1); ctx.lineTo(x - 0.5, top); ctx.stroke();
      ctx.lineCap = 'butt';
    };
    // the flag, drawn in thin strips that wave
    const flag = () => {
      const n = 20, src = flagTex.width / n, sgn = ux >= 0 ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const f0 = i / n, f1 = (i + 1) / n;
        const ph = state.t * speed - i * 0.45;
        const x0 = x + sgn * 1.5 + ux * L * f0, x1 = x + sgn * 1.5 + ux * L * f1;
        const yy = top + 2 + uy * L * f0 + droop * Math.pow(f0, 1.6) + Math.sin(ph) * amp * f0;
        const w = Math.max(0.8, Math.abs(x1 - x0) + 0.6), left = Math.min(x0, x1) - (x1 < x0 ? 0.6 : 0);
        ctx.drawImage(flagTex, i * src, 0, src, flagTex.height, left, yy, w, size);
        const fold = Math.cos(ph) * 0.2 * f0;                     // folds: lighter and darker strips
        ctx.fillStyle = fold > 0 ? `rgba(255,255,255,${fold})` : `rgba(0,0,0,${-fold})`;
        ctx.fillRect(left, yy, w, size);
        const edgeOn = (1 - Math.abs(ux)) * 0.18;                  // seen edge-on: a bit darker
        if (edgeOn > 0.01) { ctx.fillStyle = `rgba(0,0,0,${edgeOn})`; ctx.fillRect(left, yy, w, size); }
      }
    };
    if (uy < 0) { flag(); pole(); } else { pole(); flag(); }   // blowing away from us: behind the pole
    // golden knob on top (with a snow cap in winter)
    ctx.fillStyle = '#e8c547';
    ctx.beginPath(); ctx.arc(x, top - 1, 2.4, 0, TAU); ctx.fill();
    if (winter) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(x, top - 2.6, 2.6, 1.3, 0, 0, TAU); ctx.fill(); }
  }

  function drawStable() {
    // straw floor
    ctx.fillStyle = '#d8b56a';
    ctx.fillRect(S.x, S.y, S.w, S.h);
    ctx.strokeStyle = 'rgba(150,110,40,0.35)';
    ctx.lineWidth = 1;
    for (let y = S.y + 10; y < S.bottom; y += 12) {
      ctx.beginPath();
      ctx.moveTo(S.x + 4, y);
      ctx.lineTo(S.x + S.w - 4, y + ((y * 7) % 5) - 2);
      ctx.stroke();
    }
    // walls
    ctx.strokeStyle = '#5b3a1e';
    ctx.lineWidth = S.wall;
    ctx.lineCap = 'round';
    for (const [x1, y1, x2, y2] of WALLS) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // Snow on the roof (painted once): smooth slopes, faint ridges of the tile rows underneath,
  // a soft rounded overhang at the eaves and a few icicles along the front.
  let snowRoof = null;
  function makeSnowRoof(x0, y0, w, h, ridge) {
    const k = 2, c = document.createElement('canvas');
    c.width = (w + 8) * k; c.height = (h + 12) * k;
    const g = c.getContext('2d');
    g.scale(k, k); g.translate(4 - x0, 4 - y0);
    let seed = 777;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // the two slopes: the upper one in the sun, the lower one a little blue in the shade
    let gr = g.createLinearGradient(0, y0, 0, ridge);
    gr.addColorStop(0, '#e9eff6'); gr.addColorStop(0.6, '#f7fafd'); gr.addColorStop(1, '#ffffff');
    g.fillStyle = gr; g.fillRect(x0, y0, w, ridge - y0);
    gr = g.createLinearGradient(0, ridge, 0, y0 + h);
    gr.addColorStop(0, '#dfe7f0'); gr.addColorStop(1, '#cdd8e4');
    g.fillStyle = gr; g.fillRect(x0, ridge, w, y0 + h - ridge);
    // the tile rows show through as very soft ridges
    for (let y = y0 + 9; y < y0 + h - 4; y += 9) {
      if (Math.abs(y - ridge) < 6) continue;
      g.strokeStyle = y < ridge ? 'rgba(150,170,195,0.13)' : 'rgba(120,140,170,0.14)';
      g.lineWidth = 1.4;
      g.beginPath();
      for (let x = x0; x <= x0 + w; x += 6) {
        const yy = y + Math.sin(x * 0.05 + y) * 0.6;
        x === x0 ? g.moveTo(x, yy) : g.lineTo(x, yy);
      }
      g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;     // light on the upper side of each ridge
      g.beginPath(); g.moveTo(x0, y - 1.2); g.lineTo(x0 + w, y - 1.2); g.stroke();
    }
    // snow piled a bit higher along the ridge
    gr = g.createLinearGradient(0, ridge - 7, 0, ridge + 7);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.55, 'rgba(225,233,242,0.9)'); gr.addColorStop(1, 'rgba(225,233,242,0)');
    g.fillStyle = gr; g.fillRect(x0, ridge - 7, w, 14);
    // rounded overhang along the eaves (top and bottom edge), with a soft shadow under the front one
    const eave = (y, dir) => {
      g.beginPath();
      g.moveTo(x0 - 1, y - dir * 4);
      for (let x = x0 - 1; x <= x0 + w + 1; x += 3) g.lineTo(x, y + dir * (2.2 + 1.2 * Math.sin(x * 0.11) + 0.6 * Math.sin(x * 0.37)));
      g.lineTo(x0 + w + 1, y - dir * 4);
      g.closePath();
    };
    g.save(); g.translate(1.5, 2.5); eave(y0 + h, 1); g.fillStyle = 'rgba(40,60,90,0.18)'; g.fill(); g.restore();
    eave(y0 + h, 1); g.fillStyle = '#d3dde8'; g.fill();
    eave(y0, -1); g.fillStyle = '#f4f8fc'; g.fill();
    // side edges: a thin rounded rim
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(x0 - 1, y0, 2, h); g.fillRect(x0 + w - 1, y0, 2, h);
    // icicles hanging from the front eave
    for (let x = x0 + 6; x < x0 + w - 4; x += 7 + rnd() * 9) {
      const L = 2 + rnd() * 5, yb = y0 + h + 2.5 + Math.sin(x * 0.11) * 1.2;
      g.fillStyle = 'rgba(210,232,248,0.9)';
      g.beginPath(); g.moveTo(x - 1.1, yb); g.lineTo(x + 1.1, yb); g.lineTo(x, yb + L); g.closePath(); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x - 0.4, yb, 0.6, L * 0.6);
    }
    return c;
  }

  // Gable roof seen from above (ridge along the long side). It turns see-through
  // while sheep (or the dog) are inside, so you can watch them.
  function drawRoof() {
    const someoneInside = sheep.some(inStable) || (dog && inStable(dog));
    roofAlpha += ((someoneInside ? 0.3 : 1) - roofAlpha) * 0.1;
    const x0 = S.x - 7, y0 = S.y - 7, w = S.w + 14, h = S.h + 14, ridge = S.cy;
    const si = seasonIndex();
    ctx.save();
    ctx.globalAlpha = roofAlpha;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';                          // shadow on the ground
    ctx.fillRect(x0 + w, y0 + 9, 8, h - 2);
    ctx.fillRect(x0 + 8, y0 + h, w, 9);
    ctx.fillStyle = '#a4472f'; ctx.fillRect(x0, y0, w, ridge - y0);       // sunny slope
    ctx.fillStyle = '#80361f'; ctx.fillRect(x0, ridge, w, y0 + h - ridge); // shady slope
    // tile rows
    ctx.strokeStyle = 'rgba(40,10,5,0.45)';
    ctx.lineWidth = 1;
    let row = 0;
    for (let y = y0 + 9; y < y0 + h; y += 9, row++) {
      if (Math.abs(y - ridge) < 4) continue;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke();
      for (let x = x0 + (row % 2 ? 7 : 14); x < x0 + w; x += 14) {
        ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x, y); ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(255,200,170,0.12)';                    // light on the upper slope
    ctx.fillRect(x0, y0, w, (ridge - y0) * 0.5);
    if (si === 3) {                                               // a smooth blanket of snow
      if (!snowRoof) snowRoof = makeSnowRoof(x0, y0, w, h, ridge);
      ctx.drawImage(snowRoof, x0 - 4, y0 - 4, w + 8, h + 12);
      ctx.strokeStyle = 'rgba(170,190,210,0.6)';
    } else ctx.strokeStyle = '#4f1d12';
    // ridge cap and outline
    if (si === 3) {                                               // snowed-over ridge: just a soft crest
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x0, ridge - 2.5, w, 3);
      ctx.fillStyle = 'rgba(160,178,200,0.35)'; ctx.fillRect(x0, ridge + 0.5, w, 1.6);
    } else {
      ctx.fillStyle = '#5a2318';
      ctx.fillRect(x0, ridge - 3, w, 6);
    }
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + 1, y0 + 1, w - 2, h - 2);
    if (si === 2) {                                               // a few leaves on the roof
      const cols = ['#e3a32b', '#d9772b', '#c4512a'];
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = cols[i % 3];
        ctx.beginPath();
        ctx.ellipse(x0 + 12 + ((i * 37) % (w - 24)), y0 + 10 + ((i * 23) % (h - 20)), 2.6, 1.5, i, 0, TAU);
        ctx.fill();
      }
    }
    // name plate over the door
    const pw = 56, ph = 15, px = S.cx - pw / 2, py = S.bottom - 12;
    ctx.fillStyle = '#6b4423'; ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = '#2e1a0c'; ctx.lineWidth = 1.5; ctx.strokeRect(px, py, pw, ph);
    ctx.fillStyle = '#f3e4bf';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('STALL', S.cx, py + ph / 2 + 0.5);
    if (si === 3) {                                               // buried under snow
      ctx.fillStyle = 'rgba(244,248,252,0.96)';
      ctx.fillRect(px - 3, py - 3, pw + 6, ph * 0.72 + 3);
      for (let i = 0; i < 5; i++) {
        ctx.beginPath(); ctx.arc(px + 4 + i * 12, py + ph * 0.72, 5 + (i % 2) * 2, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }

  // Wall lamps (lit = bright glass)
  function drawLamps(lit) {
    for (const L of LAMPS) {
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(L.x - 1.5, L.y - 9, 3, 5);                    // bracket on the wall
      ctx.fillStyle = '#1e1e1e';
      ctx.fillRect(L.x - 4.5, L.y - 4.5, 9, 9);
      ctx.fillStyle = lit ? '#fff1b0' : '#9a8f6a';
      ctx.fillRect(L.x - 3, L.y - 3, 6, 6);
      if (lit) {
        ctx.fillStyle = 'rgba(255,230,140,0.5)';
        ctx.beginPath(); ctx.arc(L.x, L.y, 8, 0, TAU); ctx.fill();
      }
    }
  }

  function drawBowl() {
    const { x, y, r } = bowl;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.beginPath(); ctx.ellipse(x + 1.5, y + 2, r + 1, r, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c0392b';                          // red bowl rim
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#7d1f15'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#5e1a12';                          // inside
    ctx.beginPath(); ctx.arc(x, y, r - 2.2, 0, TAU); ctx.fill();
    const f = clamp(bowl.food / 100, 0, 1);              // kibble
    if (f > 0) {
      const kr = (r - 2.6) * Math.sqrt(f);
      ctx.fillStyle = '#b07a3c';
      ctx.beginPath(); ctx.arc(x, y, kr, 0, TAU); ctx.fill();
      ctx.fillStyle = '#7f5326';
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4, rr = kr * (0.25 + (i % 3) * 0.25);
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 0.9, 0, TAU); ctx.fill();
      }
    }
    // little bone sign
    ctx.save();
    ctx.translate(x, y + r + 6);
    ctx.fillStyle = 'rgba(255,250,235,0.85)';
    ctx.fillRect(-4, -0.8, 8, 1.6);
    for (const [bx, by] of [[-4, -1.2], [-4, 1.2], [4, -1.2], [4, 1.2]]) {
      ctx.beginPath(); ctx.arc(bx, by, 1.3, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // Tree tops are drawn over the animals; they turn see-through when something hides below
  function drawCanopies() {
    const animals = dog ? [dog, ...sheep, ...wolves] : [];
    if (farmerOut() && !inStable(farmer)) animals.push(farmer);
    for (const t of trees) {
      const hiding = !isWinter() && animals.some((a) => Math.hypot(a.x - t.x, a.y - t.y) < t.R);
      const target = hiding ? 0.55 : 0.95;
      t.alpha += (target - t.alpha) * 0.12;
      ctx.globalAlpha = t.alpha;
      const tex = canopyTex(t);
      ctx.drawImage(tex, t.x - tex.width / 2, t.y - tex.height / 2);
      if (seasonIndex() === 2 && state.screen !== 'title' && t.apples > 0) {   // apples!
        for (let k = 0; k < t.apples; k++) {
          const a = k * 2.39996 + (t.x % 7), rr = t.R * (0.25 + 0.5 * ((k * 0.618 + t.y * 0.013) % 1));
          const ax = t.x + Math.cos(a) * rr, ay = t.y + Math.sin(a) * rr;
          ctx.fillStyle = '#7a1510'; ctx.beginPath(); ctx.arc(ax + 0.6, ay + 0.6, 2.4, 0, TAU); ctx.fill();
          ctx.fillStyle = '#d5352a'; ctx.beginPath(); ctx.arc(ax, ay, 2.2, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.beginPath(); ctx.arc(ax - 0.7, ay - 0.7, 0.7, 0, TAU); ctx.fill();
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawShadow(e) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(e.x + 2, e.y + 3, e.r, e.r * 0.85, 0, 0, TAU);
    ctx.fill();
  }

  function drawCircle(e, fill, stroke) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawEyes(e, color, size, glow) {
    const px = -e.fy, py = e.fx;
    const ex = e.x + e.fx * e.r * 0.5, ey = e.y + e.fy * e.r * 0.5;
    ctx.save();
    ctx.fillStyle = color;
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 8; }
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(ex + px * e.r * 0.36 * sgn, ey + py * e.r * 0.36 * sgn, size, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  // Fluffy sheep seen from above: a cloud of wool with a little head in front.
  function drawSheep(s) {
    const male = s.sex === 'm';
    const hurt = s.hurtT > 0 && Math.floor(state.t * 16) % 2 === 0;
    const wool = hurt ? '#ff9c8f' : male ? '#b9bdc2' : '#fbfaf5';
    const edge = hurt ? '#c0392b' : male ? '#7d8288' : '#b8b2a6';
    const face = male ? '#cdbfae' : '#efe3d2';
    const r = CFG.sheep.r;   // drawn at adult size, then scaled (lambs are smaller)
    const puffs = s.puffs || [1, 1, 1, 1, 1, 1, 1, 1, 1];
    const n = puffs.length;

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.atan2(s.fy, s.fx));
    if (s.r !== CFG.sheep.r) ctx.scale(s.r / CFG.sheep.r, s.r / CFG.sheep.r);

    // wool: outline pass, then fill pass
    const puff = (grow, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const px = Math.cos(a) * r * 0.6 - 1.5, py = Math.sin(a) * r * 0.6;
        const pr = r * 0.42 * puffs[i] + grow;
        ctx.moveTo(px + pr, py);
        ctx.arc(px, py, pr, 0, TAU);
      }
      ctx.moveTo(-1.5 + r * 0.7 + grow, 0);
      ctx.arc(-1.5, 0, r * 0.7 + grow, 0, TAU);
      ctx.fill();
    };
    puff(1.3, edge);
    puff(0, wool);
    // little curls in the wool
    ctx.strokeStyle = male ? 'rgba(90,95,100,0.45)' : 'rgba(170,160,145,0.55)';
    ctx.lineWidth = 0.9;
    for (const [cx, cy] of [[-5, -3], [-1, 3], [2, -2], [-5, 3.5], [-8, 0]]) {
      ctx.beginPath();
      ctx.arc(cx, cy, 1.6, 0.3, Math.PI * 1.4);
      ctx.stroke();
    }

    // head
    const hx = r * 0.95;
    ctx.fillStyle = face;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    for (const sgn of [-1, 1]) {           // ears
      ctx.beginPath();
      ctx.ellipse(hx - 1.5, sgn * 4.6, 2.6, 1.5, sgn * 0.5, 0, TAU);
      ctx.fill(); ctx.stroke();
    }
    ctx.beginPath();
    ctx.ellipse(hx + 1, 0, 4.8, 3.9, 0, 0, TAU);
    ctx.fill(); ctx.stroke();
    if (male) {                             // curled ram horns
      ctx.strokeStyle = '#b8955a';
      ctx.lineWidth = 1.8;
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(hx - 1, sgn * 3.6, 2.4, sgn > 0 ? -0.6 : -2.6, sgn > 0 ? 2.6 : 0.6);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#111';                  // eyes
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(hx + 2.4, sgn * 1.8, 1.1, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    // food ring (how much it ate today)
    if (s.food > 0) {
      ctx.strokeStyle = s.food >= 100 ? '#3fe07a' : '#e8e04a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r + 4.5, -Math.PI / 2, -Math.PI / 2 + (s.food / 100) * TAU);
      ctx.stroke();
    }
    // health bar (only when not healthy)
    if (s.health < 100) {
      const w = 20, h = 3, x = s.x - w / 2, y = s.y + s.r + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
      const f = clamp(s.health / 100, 0, 1);
      ctx.fillStyle = f > 0.6 ? '#7bd36b' : f > 0.3 ? '#f0c040' : '#e5533d';
      ctx.fillRect(x, y, w * f, h);
    }
  }

  // Saint Bernard seen from above: white body with a brown saddle, brown head with white blaze.
  const DOG = { brown: '#9a4f22', dark: '#6a3315', white: '#fbf6ee', line: '#5a3a22' };

  function drawDogTail(wag) {
    ctx.save();
    ctx.translate(-12, 0);
    ctx.rotate(wag);
    ctx.lineCap = 'round';
    ctx.strokeStyle = DOG.line; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-5, 1, -9, 0); ctx.stroke();
    ctx.strokeStyle = DOG.brown; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(-5, 1, -9, 0); ctx.stroke();
    ctx.fillStyle = DOG.white;
    ctx.beginPath(); ctx.arc(-9, 0, 1.8, 0, TAU); ctx.fill();
    ctx.lineCap = 'butt';
    ctx.restore();
  }

  // standing / running, back up
  function drawDogBack(wag) {
    const { brown, dark, white, line } = DOG;
    drawDogTail(wag);

    // body (white) with brown saddle
    ctx.beginPath();
    ctx.ellipse(-2, 0, 12, 8, 0, 0, TAU);
    ctx.fillStyle = white; ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = brown;
    ctx.beginPath(); ctx.ellipse(-4, 0, 6.5, 9, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath(); ctx.ellipse(-5, 0, 4, 9, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = line; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.ellipse(-2, 0, 12, 8, 0, 0, TAU); ctx.stroke();

    drawDogHead();
  }

  // head pointing along +x, centred at (9, 0)
  function drawDogHead() {
    const { brown, dark, white, line } = DOG;
    // ears
    ctx.fillStyle = dark;
    for (const sgn of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(7, sgn * 5.6, 3.4, 2.3, sgn * 0.3, 0, TAU); ctx.fill();
    }
    // head
    ctx.fillStyle = brown;
    ctx.beginPath(); ctx.arc(9, 0, 6, 0, TAU); ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 1.1; ctx.stroke();
    // white blaze + muzzle
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.ellipse(10.5, 0, 4.5, 1.5, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(14, 0, 3.3, 3.5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 0.9; ctx.stroke();
    // nose & eyes
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(16.6, 0, 1.4, 0, TAU); ctx.fill();
    for (const sgn of [-1, 1]) {
      ctx.beginPath(); ctx.arc(10, sgn * 2.7, 1.1, 0, TAU); ctx.fill();
    }
    // tired: panting with the tongue out
    if (dog.stamina < CFG.dog.tiredAt) {
      const pant = Math.sin(state.t * 20) * 0.6;
      ctx.fillStyle = '#e8737f';
      ctx.beginPath(); ctx.ellipse(17.6 + pant, 1.6, 2.4 + pant * 0.5, 1.4, 0.25, 0, TAU); ctx.fill();
    }
  }

  // lying on its back with the paws in the air, very happy
  function drawDogBelly(t) {
    const { brown, dark, white, line } = DOG;
    drawDogTail(Math.sin(t * 18) * 0.6);

    // paddling paws
    ctx.fillStyle = white; ctx.strokeStyle = line; ctx.lineWidth = 1;
    [[6, -8], [6, 8], [-9, -7.5], [-9, 7.5]].forEach(([px, py], i) => {
      const k = Math.sin(t * 13 + i * 1.7);
      ctx.beginPath();
      ctx.ellipse(px + k * 1.6, py + Math.sign(py) * (1 + Math.cos(t * 13 + i) * 1.2), 2.7, 2.3, 0, 0, TAU);
      ctx.fill(); ctx.stroke();
    });

    // belly: brown sides, white tummy with a pink spot
    ctx.beginPath(); ctx.ellipse(-2, 0, 12, 8, 0, 0, TAU);
    ctx.fillStyle = brown; ctx.fill();
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.ellipse(-2, 0, 10.5, 5.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#f2c4b8';
    ctx.beginPath(); ctx.ellipse(-4, 0, 4, 2.4, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.ellipse(-2, 0, 12, 8, 0, 0, TAU); ctx.stroke();

    // floppy ears spread on the ground
    ctx.fillStyle = dark;
    for (const sgn of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(9, sgn * 7, 3.8, 2.4, -sgn * 0.5, 0, TAU); ctx.fill();
    }
    // head upside down (eyes face the ground), tongue out
    ctx.fillStyle = brown;
    ctx.beginPath(); ctx.arc(9, 0, 6, 0, TAU); ctx.fill();
    ctx.strokeStyle = line; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.ellipse(14, 0, 3.3, 3.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8737f';
    ctx.beginPath(); ctx.ellipse(16, 2.6, 1.5, 2.6, 0.3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.arc(16.6, 0, 1.4, 0, TAU); ctx.fill();
  }

  // Curled up in a "C", spinning after its own tail
  function drawDogCurled() {
    const { brown, white, line } = DOG;
    const R = 9, deg = Math.PI / 180;
    const a0 = -200 * deg, a1 = 0;          // body runs from the rump (a0) to the shoulders (a1)
    // body: outline, white, brown saddle
    ctx.lineCap = 'round';
    ctx.strokeStyle = line; ctx.lineWidth = 13.5;
    ctx.beginPath(); ctx.arc(0, 0, R, a0, a1); ctx.stroke();
    ctx.strokeStyle = white; ctx.lineWidth = 11;
    ctx.beginPath(); ctx.arc(0, 0, R, a0, a1); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.strokeStyle = brown; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.arc(0, 0, R, -165 * deg, -45 * deg); ctx.stroke();
    // tail sticks out of the rump into the gap, wagging, almost at the nose
    const wag = Math.sin(state.t * 22) * 7 * deg;
    const t0 = a0 - 48 * deg + wag;          // tail tip
    ctx.lineCap = 'round';
    ctx.strokeStyle = line; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(0, 0, R, t0, a0); ctx.stroke();
    ctx.strokeStyle = brown; ctx.lineWidth = 3.4;
    ctx.beginPath(); ctx.arc(0, 0, R, t0, a0); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = white;
    ctx.beginPath(); ctx.arc(Math.cos(t0) * R, Math.sin(t0) * R, 1.9, 0, TAU); ctx.fill();
    // head at the front end, looking along the curl towards the tail
    ctx.save();
    ctx.translate(Math.cos(a1) * R, Math.sin(a1) * R);
    ctx.rotate(a1 + Math.PI / 2 + 0.35);
    ctx.translate(-6, 0);
    drawDogHead();
    ctx.restore();
  }

  function drawDog() {
    const tr = dog.trick;
    ctx.save();
    ctx.translate(dog.x, dog.y);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';                   // shadow (cast down-right)
    if (tr && tr.type === 'chase') {
      ctx.beginPath(); ctx.arc(2, 3, 14, 0, TAU); ctx.fill();
    } else {
      ctx.beginPath(); ctx.ellipse(2, 3, 15, 9, dog.ang, 0, TAU); ctx.fill();
    }
    ctx.rotate(dog.ang);

    if (tr && tr.type === 'roll') {
      // straight onto its back and wiggle
      ctx.rotate(Math.sin(tr.t * 5) * 0.25);
      drawDogBelly(tr.t);
    } else if (tr && tr.type === 'chase') {
      drawDogCurled();
    } else {
      const fast = dog.moving || dog.eating || dog.happyT > 0;
      const wag = Math.sin(state.t * (dog.happyT > 0 ? 24 : fast ? 16 : 5)) * (dog.happyT > 0 ? 0.65 : fast ? 0.5 : 0.25);
      drawDogBack(wag);
    }
    ctx.restore();
  }

  // Small energy bar under the dog (only when not full)
  function drawStaminaBar() {
    if (dog.stamina >= 99.5) return;
    const C = CFG.dog;
    const w = 24, h = 3.5, x = dog.x - w / 2, y = dog.y + 16;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    const st = dog.stamina;
    ctx.fillStyle = st < C.exhaustedAt ? '#e5533d' : st < C.tiredAt ? '#f0a030' : '#5bc0ff';
    ctx.fillRect(x, y, (w * st) / 100, h);
    // markers at the tired / exhausted thresholds
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(x + (w * C.tiredAt) / 100, y, 1, h);
    ctx.fillRect(x + (w * C.exhaustedAt) / 100, y, 1, h);
  }

  // Wolf seen from above: shaggy grey fur, dark back, bushy tail, pointy ears.
  function drawWolf(w) {
    const sp = Math.hypot(w.vx, w.vy);
    const trot = sp > 20 ? Math.sin(state.t * 15 + w.phase) : 0;
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';                     // shadow
    ctx.beginPath(); ctx.ellipse(2, 3, 16, 9, w.ang, 0, TAU); ctx.fill();
    ctx.rotate(w.ang);

    // bushy tail, swinging while trotting
    ctx.save();
    ctx.translate(-12, 0);
    ctx.rotate(trot * 0.18 + (w.eatT > 0 || w.feeding ? 0.25 : 0));
    ctx.beginPath();
    ctx.moveTo(0, -3.6);
    ctx.quadraticCurveTo(-9, -6, -16, 0);
    ctx.quadraticCurveTo(-9, 6, 0, 3.6);
    ctx.closePath();
    ctx.fillStyle = '#3a3a40'; ctx.fill();
    ctx.strokeStyle = '#141416'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#1b1b1e';
    ctx.beginPath(); ctx.ellipse(-13, 0, 3.5, 2.2, 0, 0, TAU); ctx.fill();
    ctx.restore();

    // shaggy body
    const n = w.fur.length * 2;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const rr = i % 2 ? 1.04 : 0.9 + w.fur[(i / 2) % w.fur.length] * 0.06;
      const x = -1 + Math.cos(a) * 13 * rr, y = Math.sin(a) * 8.5 * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = '#55555d'; ctx.fill();
    ctx.strokeStyle = '#161618'; ctx.lineWidth = 1.1; ctx.stroke();
    // darker saddle along the back + lighter flanks
    ctx.fillStyle = '#2b2b30';
    ctx.beginPath(); ctx.ellipse(-2, 0, 10, 3.6, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(160,160,170,0.35)'; ctx.lineWidth = 0.9;
    for (const sgn of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(-8, sgn * 5.5); ctx.lineTo(-5, sgn * 6.5); ctx.moveTo(-2, sgn * 6); ctx.lineTo(1, sgn * 7); ctx.stroke();
    }

    // head (bobs down while eating)
    const hx = 9 + (w.eatT > 0 || w.feeding ? Math.sin(state.t * 12) * 1.3 : trot * 0.5);
    ctx.fillStyle = '#404047';
    ctx.beginPath(); ctx.ellipse(hx, 0, 6, 5.2, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#161618'; ctx.lineWidth = 1; ctx.stroke();
    // pointy ears, standing up
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hx - 3.5, sgn * 1.6);
      ctx.lineTo(hx - 5.5, sgn * 8.8);
      ctx.lineTo(hx + 1.2, sgn * 4.6);
      ctx.closePath();
      ctx.fillStyle = '#26262b'; ctx.fill();
      ctx.strokeStyle = '#111113'; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(hx - 3, sgn * 3); ctx.lineTo(hx - 4.6, sgn * 7.2); ctx.lineTo(hx - 0.4, sgn * 4.6);
      ctx.closePath();
      ctx.fillStyle = '#7a6260'; ctx.fill();
    }
    // long snout
    ctx.fillStyle = '#5a5a62';
    ctx.beginPath(); ctx.ellipse(hx + 6, 0, 5, 2.6, 0, 0, TAU); ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0b0b0c';
    ctx.beginPath(); ctx.arc(hx + 10.6, 0, 1.4, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Slanted yellow eyes; glowing in the dark
  function drawWolfEyes(w, glow) {
    const hx = 9 + (w.eatT > 0 || w.feeding ? Math.sin(state.t * 12) * 1.3 : 0);
    ctx.save();
    ctx.translate(w.x, w.y);
    ctx.rotate(w.ang);
    ctx.fillStyle = glow ? '#ffd23f' : '#e6b42e';
    if (glow) { ctx.shadowColor = '#ffd23f'; ctx.shadowBlur = 9; }
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(hx + 2.2, sgn * 2.3, 1.7, 0.95, sgn * 0.45, 0, TAU);
      ctx.fill();
    }
    if (!glow) {                                           // pupils by day
      ctx.fillStyle = '#111';
      for (const sgn of [-1, 1]) { ctx.beginPath(); ctx.arc(hx + 2.5, sgn * 2.3, 0.5, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }

  function drawEntities(dark) {
    for (const s of sheep) drawShadow(s);

    for (const s of sheep) drawSheep(s);
    for (const w of wolves) drawWolf(w);
    for (const w of wolves) drawWolfEyes(w, nightLevel > 0.3);

    if (state.marker && state.screen === 'play') {
      const m = state.marker, a = Math.min(1, m.t / 0.8);
      ctx.strokeStyle = `rgba(255,255,255,${0.8 * a})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(m.x, m.y, 6 + (1 - a) * 8, 0, TAU);
      ctx.stroke();
    }
    if (dog && inHut(dog) && !dog.trick) {
      // in its hut: only the nose shows in the door (drawn with the hut)
    } else if (dog) {
      drawDog();
      if (dog.hurtT > 0 && Math.floor(state.t * 14) % 2 === 0) {  // bitten: red flash
        ctx.strokeStyle = 'rgba(230,60,40,0.9)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(dog.x, dog.y, 17, 0, TAU); ctx.stroke();
      }
      drawStaminaBar();
      if (dogBarking()) {                                         // sound waves
        const k = 1 - dog.barkT / CFG.dog.barkTime;
        for (let i = 0; i < 3; i++) {
          const f = (k * 1.6 + i * 0.33) % 1;
          ctx.strokeStyle = `rgba(255,240,200,${0.55 * (1 - f)})`; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(dog.x, dog.y, 16 + f * 60, 0, TAU); ctx.stroke();
        }
      }
    }
  }

  function drawNight(dark) {
    if (dark <= 0.001) return;
    sctx.globalCompositeOperation = 'source-over';
    sctx.clearRect(0, 0, FW, FH);
    sctx.fillStyle = `rgba(8,12,38,${dark})`;
    sctx.fillRect(0, 0, FW, FH);
    sctx.globalCompositeOperation = 'destination-out';
    const light = (x, y, r, s) => {
      const g = sctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${s})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.fillStyle = g;
      sctx.beginPath(); sctx.arc(x, y, r, 0, TAU); sctx.fill();
    };
    // the dog's own little light (dim, so the night stays exciting)
    if (dog && nightLevel > 0.05) light(dog.x, dog.y, 115, 0.42 * nightLevel);
    const on = lampsOn(dark);
    const lamp = lampLevel();
    if (on) for (const L of LAMPS) light(L.x, L.y + 6, 120, 0.8 * lamp);
    ctx.drawImage(shade, 0, 0, FW, FH);

    // warm lamp glow
    if (on) {
      const a = lamp * (isWinter() ? 0.6 : 1);
      ctx.globalCompositeOperation = 'lighter';
      for (const L of LAMPS) {
        const g = ctx.createRadialGradient(L.x, L.y, 0, L.x, L.y, 75);
        g.addColorStop(0, `rgba(255,190,90,${0.38 * a})`);
        g.addColorStop(1, 'rgba(255,190,90,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(L.x, L.y, 75, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      drawLamps(true);
    }

    // glowing wolf eyes in the dark
    if (nightLevel > 0.3) for (const w of wolves) drawWolfEyes(w, true);
  }

  function drawDoorHint() {
    const ph = phaseName();
    if (!(ph === 'dusk' || ph === 'night') || unsafeSheep().length === 0) return;
    const a = 0.45 + 0.4 * Math.sin(state.t * 6);
    ctx.strokeStyle = `rgba(255,235,120,${a})`;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (let i = 0; i < 2; i++) {
      const y = S.bottom + 22 + i * 12;
      ctx.beginPath();
      ctx.moveTo(S.cx - 12, y + 8);
      ctx.lineTo(S.cx, y);
      ctx.lineTo(S.cx + 12, y + 8);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  function drawFloats() {
    ctx.font = '700 14px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of state.floats) {
      ctx.globalAlpha = clamp(f.t / 0.6, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(f.text, f.x + 1, f.y - 19);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y - 20);
    }
    ctx.globalAlpha = 1;
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawMessage() {
    const m = state.msg;
    if (!m || state.screen !== 'play') return;
    const a = clamp(Math.min(m.t, m.max - m.t) / 0.3, 0, 1);
    ctx.font = `23px ${TXT}`;
    // long messages wrap onto a second line (there is room right of the stable)
    let lines = [m.text];
    const maxW = FW - 270 - 26 - 32;
    if (ctx.measureText(m.text).width > maxW) {
      const parts = m.text.split(' \u2014 ');
      lines = parts.length > 1
        ? [parts.slice(0, -1).join(' \u2014 '), parts[parts.length - 1]]
        : wrapText(m.text, maxW).slice(0, 2);
      if (lines.some((l) => ctx.measureText(l).width > maxW)) lines = wrapText(m.text, maxW).slice(0, 2);
    }
    const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const lh = 22, bh = 12 + lines.length * lh;
    const x = clamp(FW / 2 + 110, tw / 2 + 270, FW - tw / 2 - 26), y = 16;   // right of the stable
    ctx.globalAlpha = a;
    // pixel-style box like the menus
    const bx = Math.round(x - tw / 2 - 16), bw = Math.round(tw + 32);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(bx + 4, y + 4, bw, bh);
    ctx.fillStyle = 'rgba(24,48,32,0.92)';
    ctx.fillRect(bx, y, bw, bh);
    ctx.strokeStyle = COL.cream; ctx.lineWidth = 2;
    ctx.strokeRect(bx + 1, y + 1, bw - 2, bh - 2);
    ctx.fillStyle = '#fbf6e4';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, x, y + 6 + lh / 2 + i * lh + 1));
    ctx.globalAlpha = 1;
  }

  // Season symbols for the top bar: flower, sun over grass, brown leaf, snowflake
  function drawSeasonIcon(x, y, si) {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    if (si === 0) {                                       // spring: a flower
      ctx.strokeStyle = '#5fae4e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, 2); ctx.quadraticCurveTo(1, 7, -1, 11); ctx.stroke();
      ctx.fillStyle = '#ffb3d1';
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i * TAU / 5;
        ctx.beginPath(); ctx.ellipse(Math.cos(a) * 4.6, -3 + Math.sin(a) * 4.6, 3.6, 2.6, a, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = '#ffd84d'; ctx.beginPath(); ctx.arc(0, -3, 2.6, 0, TAU); ctx.fill();
    } else if (si === 1) {                                // summer: sun over grass
      ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 1.6;
      for (let i = 0; i < 8; i++) {
        const a = i * TAU / 8;
        ctx.beginPath(); ctx.moveTo(3 + Math.cos(a) * 6.5, -4 + Math.sin(a) * 6.5); ctx.lineTo(3 + Math.cos(a) * 9, -4 + Math.sin(a) * 9); ctx.stroke();
      }
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(3, -4, 5, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#6cc04a'; ctx.lineWidth = 2;
      for (const [bx, h, lean] of [[-9, 9, -2], [-5, 12, 1], [-1, 8, 2], [3, 11, -1], [7, 9, 2], [10, 7, 1]]) {
        ctx.beginPath(); ctx.moveTo(bx, 11); ctx.quadraticCurveTo(bx + lean * 0.3, 11 - h * 0.6, bx + lean, 11 - h); ctx.stroke();
      }
    } else if (si === 2) {                                // fall: a brown leaf
      ctx.rotate(-0.6);
      ctx.fillStyle = '#b8642a';
      ctx.beginPath(); ctx.moveTo(0, -10); ctx.quadraticCurveTo(9, -3, 0, 8); ctx.quadraticCurveTo(-9, -3, 0, -10); ctx.fill();
      ctx.strokeStyle = '#7a3a14'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, 11); ctx.stroke();
      ctx.lineWidth = 0.9;
      for (const k of [-4, 0, 4]) {
        ctx.beginPath(); ctx.moveTo(0, k); ctx.lineTo(4, k - 3.5); ctx.moveTo(0, k); ctx.lineTo(-4, k - 3.5); ctx.stroke();
      }
    } else {                                              // winter: a snowflake
      ctx.strokeStyle = '#bfe3ff'; ctx.lineWidth = 1.8;
      for (let i = 0; i < 6; i++) {
        ctx.save(); ctx.rotate(i * TAU / 6);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -10);
        ctx.moveTo(0, -5.5); ctx.lineTo(-3, -8.5); ctx.moveTo(0, -5.5); ctx.lineTo(3, -8.5);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // Little golden trophy for the top bar (largest flock so far)
  function drawHudTrophy(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = '#e0a43a'; ctx.lineWidth = 1.8;                  // handles
    for (const sg of [-1, 1]) { ctx.beginPath(); ctx.arc(sg * 6.5, -4.5, 3.4, sg > 0 ? -1.6 : 1.6 - Math.PI, sg > 0 ? 1.3 : Math.PI - 1.3 + Math.PI); ctx.stroke(); }
    ctx.fillStyle = '#f4c542';                                         // cup
    ctx.beginPath(); ctx.moveTo(-7, -9); ctx.lineTo(7, -9); ctx.quadraticCurveTo(7, 1, 0, 2.5); ctx.quadraticCurveTo(-7, 1, -7, -9); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';                          // shine
    ctx.beginPath(); ctx.ellipse(-3, -5, 1.4, 3, 0.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d9a12e';                                         // stem and base
    ctx.fillRect(-1.3, 2, 2.6, 4);
    ctx.fillRect(-5, 6, 10, 3);
    ctx.fillStyle = '#8a5a2b'; ctx.fillRect(-6, 8.5, 12, 2);
    ctx.restore();
  }

  // Little stable for the top bar: red barn front with a white-framed door
  function drawHudStable(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1.25, 1.25);
    ctx.fillStyle = '#5a2318';                                         // roof
    ctx.beginPath(); ctx.moveTo(-11, -1); ctx.lineTo(0, -10); ctx.lineTo(11, -1); ctx.lineTo(9, 0); ctx.lineTo(0, -7.5); ctx.lineTo(-9, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#b8402a';                                         // walls
    ctx.beginPath(); ctx.moveTo(-8.5, -0.5); ctx.lineTo(0, -7.2); ctx.lineTo(8.5, -0.5); ctx.lineTo(8.5, 9); ctx.lineTo(-8.5, 9); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#f3e4bf';                                         // door frame
    ctx.fillRect(-4, 1.5, 8, 7.5);
    ctx.fillStyle = '#7a2a1a';
    ctx.fillRect(-3, 2.5, 6, 6.5);
    ctx.strokeStyle = '#f3e4bf'; ctx.lineWidth = 0.9;                   // the X on the door
    ctx.beginPath(); ctx.moveTo(-3, 2.5); ctx.lineTo(3, 9); ctx.moveTo(3, 2.5); ctx.lineTo(-3, 9); ctx.stroke();
    ctx.fillStyle = '#f3e4bf';                                         // hay-loft window
    ctx.fillRect(-1.5, -4, 3, 2.5);
    if (isWinter()) {                                                  // snow on the roof
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(-11, -1); ctx.lineTo(0, -10.5); ctx.lineTo(11, -1); ctx.lineTo(9.5, -0.2); ctx.lineTo(0, -8.4); ctx.lineTo(-9.5, -0.2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  // Little sheep for the top bar (grey ram with horns / white ewe)
  function drawHudSheep(x, y, male) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1.2, 1.2);
    ctx.fillStyle = male ? '#7d8288' : '#b8b2a6';
    for (const [px, py] of [[-3, -3], [1, -4], [-4, 1], [0, 1], [-2, 4], [2, 3]]) { ctx.beginPath(); ctx.arc(px, py, 4.2, 0, TAU); ctx.fill(); }
    ctx.fillStyle = male ? '#b9bdc2' : '#fbfaf5';
    for (const [px, py] of [[-3, -3], [1, -4], [-4, 1], [0, 1], [-2, 4], [2, 3]]) { ctx.beginPath(); ctx.arc(px, py, 3.4, 0, TAU); ctx.fill(); }
    ctx.fillStyle = male ? '#cdbfae' : '#efe3d2';
    ctx.beginPath(); ctx.ellipse(6.5, 0, 3.6, 3, 0, 0, TAU); ctx.fill();
    if (male) {
      ctx.strokeStyle = '#b8955a'; ctx.lineWidth = 1.5;
      for (const sg of [-1, 1]) { ctx.beginPath(); ctx.arc(5.5, sg * 3, 2, sg > 0 ? -0.6 : -2.6, sg > 0 ? 2.6 : 0.6); ctx.stroke(); }
    }
    ctx.fillStyle = '#111';
    for (const sg of [-1, 1]) { ctx.beginPath(); ctx.arc(8, sg * 1.3, 0.8, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  function drawSkyIcon(ix, cy, hour) {
    const se = season();
    const morning = hour >= se.morning[0] && hour < se.morning[1];
    const evening = hour >= se.evening[0] && hour < se.evening[1];
    const night = hour < se.morning[0] || hour >= se.evening[1];
    if (night) {
      ctx.fillStyle = '#e9ecf5';
      ctx.beginPath(); ctx.arc(ix, cy, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#16241a';
      ctx.beginPath(); ctx.arc(ix + 4, cy - 3, 7, 0, TAU); ctx.fill();
    } else if (morning || evening) {
      // half a sun on the horizon, with rays
      const col = morning ? '#ffbf4d' : '#ff8a4a';
      const by = cy + 4;
      ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const a = Math.PI + (i + 0.5) * (Math.PI / 5);
        ctx.beginPath();
        ctx.moveTo(ix + Math.cos(a) * 10, by + Math.sin(a) * 10);
        ctx.lineTo(ix + Math.cos(a) * 13, by + Math.sin(a) * 13);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(ix, by, 7.5, Math.PI, TAU); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c9b48a';
      ctx.fillRect(ix - 12, by, 24, 1.6);                      // horizon
    } else {
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath(); ctx.arc(ix, cy, 7, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        ctx.beginPath();
        ctx.moveTo(ix + Math.cos(a) * 9.5, cy + Math.sin(a) * 9.5);
        ctx.lineTo(ix + Math.cos(a) * 12, cy + Math.sin(a) * 12);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
  }

  function drawHUD() {
    ctx.fillStyle = '#16241a';
    ctx.fillRect(0, 0, CW, HUD);
    if (state.screen === 'title') return;   // the start screen has its own title there
    const cy = HUD / 2;
    const hour = state.screen === 'title' ? 12 : currentHour();
    const dark = darkness(hour);

    // the day, then the season symbol
    ctx.font = `27px ${TXT}`;                                  // same retro font as the start screen
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f1efe2';
    const dayText = tr('day', state.day);
    ctx.fillText(dayText, 16, cy);
    drawSeasonIcon(116, cy, seasonIndex());                   // right next to the sun / moon

    // sun / rising or setting sun / moon
    drawSkyIcon(142, cy, hour);

    const h = Math.floor(hour) % 24, mi = Math.floor((hour % 1) * 60);
    ctx.font = `27px ${TXT}`;
    ctx.fillStyle = '#f1efe2';
    ctx.fillText(`${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, 160, cy);

    // time-of-day bar
    const bx = 228, bw = 210, by = cy - 5, bh = 10;
    const se = season();
    const span = CLOCK.end - CLOCK.start;
    const hx = (h) => bx + ((h - CLOCK.start) / span) * bw;
    const bands = [
      [CLOCK.start, se.morning[0], '#2b3a67'], [se.morning[0], se.morning[1], '#e9c46a'],
      [se.morning[1], se.evening[0], '#8ecae6'], [se.evening[0], se.night, '#f4a261'],
      [se.night, CLOCK.end, '#2b3a67'],
    ];
    for (const [a, b, col] of bands) { ctx.fillStyle = col; ctx.fillRect(hx(a), by, hx(b) - hx(a), bh); }
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    const mx = hx(clamp(hour, CLOCK.start, CLOCK.end));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(mx - 1.5, by - 5, 3, bh + 10);
    // flock info, right to left: best, in stable, ewes, rams
    const safe = sheep.length - unsafeSheep().length;
    const H = tr('hud');
    ctx.textAlign = 'left';
    let x = CW - 76;
    const one = (text, color) => {                        // a single line
      ctx.font = `23px ${TXT}`;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = color; ctx.fillText(text, x - w, cy);
      x -= w + 24;
    };
    const two = (male) => {                               // sheep icon, count, and how many are fed below
      const n = countSex(male ? 'm' : 'f'), fed = fedCount(male ? 'm' : 'f');
      const main = `${male ? H.rams : H.ewes} ${n}`, sub = `${H.fed} ${fed}/${n}`;
      ctx.font = `23px ${TXT}`;
      const w1 = ctx.measureText(main).width;
      ctx.font = `18px ${TXT}`;
      const w = Math.max(w1, ctx.measureText(sub).width), left = x - w;
      ctx.fillStyle = n > 0 && fed === n ? '#9fe08a' : fed > 0 ? '#e8e04a' : '#8f9a8c';
      ctx.fillText(sub, left, cy + 9);
      ctx.font = `23px ${TXT}`;
      ctx.fillStyle = male ? '#c9ced4' : '#ffffff';
      ctx.fillText(main, left, cy - 7);
      drawHudSheep(left - 16, cy, male);
      x = left - 16 - 10 - 22;
    };
    {                                                     // trophy + largest flock so far
      const text = `${state.best}`;
      ctx.font = `23px ${TXT}`;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = '#ffd86b';
      ctx.fillText(text, x - w, cy);
      drawHudTrophy(x - w - 14, cy);
      x -= w + 14 + 12 + 24;
    }
    {                                                     // stable symbol + how many are inside
      const text = `${safe}/${sheep.length}`;
      ctx.font = `23px ${TXT}`;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = safe === sheep.length && sheep.length ? '#9fe08a' : '#f1efe2';
      ctx.fillText(text, x - w, cy);
      drawHudStable(x - w - 18, cy);
      x -= w + 18 + 13 + 24;
    }
    two(false);
    two(true);
    if (state.screen === 'play') {
      const U = uiRects();
      drawButton(U.exit, tr('pauseBtn'), 8, COL.blue);
      // WOOF button: greys out while the dog gets its breath back
      const B = U.bark, cd = dog ? clamp((dog.barkCD || 0) / CFG.dog.barkCooldown, 0, 1) : 0;
      ctx.globalAlpha = 0.92;
      drawButton(B, tr('barkBtn'), 11, '#9a4f22');
      ctx.globalAlpha = 1;
      if (cd > 0) { ctx.fillStyle = 'rgba(11,21,13,0.55)'; ctx.fillRect(B.x, B.y, B.w * cd, B.h); }
      // fast-forward (daytime only): lit while it is on
      const ph = phaseName(), can = ph === 'day' || ph === 'dusk';
      drawButton(U.fast, '', 8, state.fast ? COL.amber : '#3d5a45', can);
      const oy = hit(U.fast) && pointerDown && can ? 3 : 0, cx = U.fast.x + U.fast.w / 2, cy2 = U.fast.y + oy + U.fast.h / 2;
      ctx.fillStyle = can ? (state.fast ? COL.ink : COL.cream) : '#9a9a90';
      for (const dx of [-7, 1]) { ctx.beginPath(); ctx.moveTo(cx + dx, cy2 - 5); ctx.lineTo(cx + dx + 7, cy2); ctx.lineTo(cx + dx, cy2 + 5); ctx.closePath(); ctx.fill(); }
    }
  }

  function drawOverlay(lines, footer) {
    ctx.fillStyle = 'rgba(10,18,12,0.75)';
    ctx.fillRect(0, 0, CW, CH);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const totalH = lines.reduce((a, l) => a + (l.gap || 28), 0);
    let y = CH / 2 - totalH / 2 - 10;
    for (const l of lines) {
      ctx.font = l.font;
      ctx.fillStyle = l.color || '#f5f1de';
      ctx.fillText(l.text, CW / 2, y);
      y += l.gap || 28;
    }
    if (footer) {
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(state.t * 3);
      ctx.font = '700 20px system-ui, sans-serif';
      ctx.fillStyle = '#ffe680';
      ctx.fillText(footer, CW / 2, y + 16);
      ctx.globalAlpha = 1;
    }
  }

  function render() {
    // field
    ctx.setTransform(pxScale, 0, 0, pxScale, 0, HUD * pxScale);
    ctx.drawImage(grass, 0, 0);
    ctx.drawImage(seasonLayer, 0, 0);
    drawTracks();
    drawGate();
    drawPatio();
    drawDigSite();
    drawFarmWork();
    drawBench();
    drawGroundLeaves();
    drawPatches();
    drawPrints();
    ctx.drawImage(obstacleLayer, 0, 0);
    drawStreamFlow();
    drawBridges();
    drawLakeRipples();
    drawDucks();
    drawStable();
    drawBowl();
    const dark = state.screen === 'title' ? (isWinter() ? CFG.winter.gloom : 0) : darkness(currentHour());
    nightLevel = state.screen === 'title' ? 0 : clamp(rawDarkness(currentHour()) / 0.65, 0, 1);
    drawSnowman();
    drawEntities(dark);
    drawDogHut();
    drawTractor();
    drawFarmerGear();
    drawFarmer();
    drawRoof();
    drawLamps(false);
    drawFlag();
    drawCanopies();
    drawBees(dark);
    if (state.blizzard) {
      // blizzard: the gloom first, then the bright blowing snow and the streaks flying past on top
      drawNight(dark);
      drawFog();
      drawWeather();
    } else {
      drawWeather();
      drawFog();
      drawNight(dark);
    }
    if (state.screen === 'play') drawDoorHint();
    drawFloats();
    drawMessage();
    if (state.fast && state.screen === 'play') {      // fast-forward badge
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText(`\u25B6\u25B6 ${CFG.fastForward}\u00D7`, 115, FH - 15);
      ctx.fillStyle = '#ffe680';
      ctx.fillText(`\u25B6\u25B6 ${CFG.fastForward}\u00D7`, 114, FH - 16);
    }

    // HUD & screens
    ctx.setTransform(pxScale, 0, 0, pxScale, 0, 0);
    drawHUD();

    if (state.screen === 'title') drawTitle();
    else if (state.screen === 'over') drawGameOver();
    else if (state.confirmExit) drawConfirmExit();
    else if (state.paused) drawPaused();
    updateCursor();
  }

  // ---------------------------------------------------------------------------
  // Title / menu screens (retro style)
  // ---------------------------------------------------------------------------
  const PIX = '"Press Start 2P", monospace';
  const TXT = 'VT323, monospace';
  if (document.fonts && document.fonts.load) {
    document.fonts.load(`16px ${PIX}`).catch(() => {});
    document.fonts.load(`20px ${TXT}`).catch(() => {});
  }
  const ui = { x: -1, y: -1 };   // pointer in canvas units
  const COL = {
    cream: '#f3e4bf', ink: '#0b150d', panel: '#183020', red: '#c8553d',
    amber: '#e0a43a', green: '#5fae4e', blue: '#4c8fbf',
  };

  function uiRects() {
    const L = { x: 22, y: 94, w: 584, h: 476 };
    const R = { x: 622, y: 94, w: 316, h: 476 };
    return {
      L, R,
      minus: { x: R.x + 22, y: R.y + 96, w: 56, h: 56 },
      plus: { x: R.x + R.w - 78, y: R.y + 96, w: 56, h: 56 },
      start: { x: CW / 2 - 175, y: 586, w: 350, h: 54 },
      resume: { x: CW / 2 - 216, y: 586, w: 210, h: 54 },
      newGame: { x: CW / 2 + 6, y: 586, w: 210, h: 54 },
      cont: { x: CW / 2 - 140, y: 470, w: 280, h: 54 },
      help: { x: 8, y: CH - 26, w: helpLinkWidth(), h: 22 },
      langEn: { x: CW - 124, y: 14, w: 48, h: 32 },
      langDe: { x: CW - 66, y: 14, w: 48, h: 32 },
      shuffle: { x: CW / 2 + 175 + 58, y: 592, w: 196, h: 42 },
      relax: { x: CW / 2 - 175 - 58 - 196, y: 592, w: 196, h: 42 },
      exit: { x: CW - 66, y: 9, w: 56, h: 26 },        // (the PAUSE button in the top bar)
      fast: { x: 446, y: 10, w: 36, h: 24 },            // fast-forward button next to the time bar
      bark: { x: 14, y: CH - 58, w: 86, h: 44 },        // WOOF button (lower left corner of the pasture)
      pResume: { x: CW / 2 - 176, y: CH / 2 + 4, w: 168, h: 48 },
      pExit: { x: CW / 2 + 8, y: CH / 2 + 4, w: 168, h: 48 },
      yes: { x: CW / 2 - 150, y: CH / 2 + 18, w: 130, h: 48 },
      no: { x: CW / 2 + 20, y: CH / 2 + 18, w: 130, h: 48 },
      seasons: SEASONS.map((_, i) => ({ x: R.x + 34 + (i % 2) * 132, y: R.y + 380 + Math.floor(i / 2) * 40, w: 120, h: 30 })),
    };
  }
  const hit = (r) => ui.x >= r.x && ui.x <= r.x + r.w && ui.y >= r.y && ui.y <= r.y + r.h;
  function helpLinkWidth() {
    ctx.save();
    ctx.font = `18px ${TXT}`;
    let w = ctx.measureText(tr('help')).width + 12;
    if (customSettings) w += ctx.measureText(tr('custom', customSettings)).width + 10;
    ctx.restore();
    return w;
  }

  // Pixel flags (20 x 12 "pixels") for the language buttons
  const FLAG_W = 20, FLAG_H = 12;
  const FLAGS = (() => {
    const uk = [], de = [];
    const diag = Math.hypot(FLAG_W, FLAG_H);
    for (let j = 0; j < FLAG_H; j++) for (let i = 0; i < FLAG_W; i++) {
      const x = i + 0.5, y = j + 0.5;
      // Union Jack: blue field, white+red diagonals, white-bordered red cross
      const d1 = Math.abs(FLAG_H * x - FLAG_W * y) / diag, d2 = Math.abs(FLAG_H * x + FLAG_W * y - FLAG_W * FLAG_H) / diag;
      const dx = Math.abs(x - FLAG_W / 2), dy = Math.abs(y - FLAG_H / 2);
      let c = '#1d3f8f';
      if (Math.min(d1, d2) < 1.9) c = '#f4f4f4';
      if (Math.min(d1, d2) < 0.75) c = '#cf1b2b';
      if (dx < 2.6 || dy < 2.2) c = '#f4f4f4';
      if (dx < 1.5 || dy < 1.2) c = '#cf1b2b';
      uk.push(c);
      // Germany: black, red, gold
      de.push(j < 4 ? '#151515' : j < 8 ? '#dd1f1f' : '#ffcc1a');
    }
    return { en: uk, de };
  })();

  function drawFlagButton(r, lang) {
    const sel = state.lang === lang, hov = hit(r);
    const px = 2, fw = FLAG_W * px, fh = FLAG_H * px;
    const fx = Math.round(r.x + (r.w - fw) / 2), fy = Math.round(r.y + (r.h - fh) / 2) - 2;
    ctx.fillStyle = COL.ink;                                     // chunky shadow
    ctx.fillRect(fx + 3, fy + 3, fw + 4, fh + 4);
    ctx.fillStyle = sel ? '#ffe27a' : hov ? COL.cream : '#6f7d6a'; // frame shows the selected language
    ctx.fillRect(fx - 2, fy - 2, fw + 4, fh + 4);
    ctx.globalAlpha = sel || hov ? 1 : 0.55;
    FLAGS[lang].forEach((c, k) => {
      ctx.fillStyle = c;
      ctx.fillRect(fx + (k % FLAG_W) * px, fy + Math.floor(k / FLAG_W) * px, px, px);
    });
    ctx.globalAlpha = 1;
    pixelText(lang.toUpperCase(), r.x + r.w / 2, fy + fh + 11, 8, sel ? '#ffe27a' : '#a9b9a2', 'center', false);
  }

  function setLang(l) {
    state.lang = l === 'de' ? 'de' : 'en';
    try { localStorage.setItem('weide.lang', state.lang); } catch (e) { /* ignore */ }
  }

  function wrapText(text, maxW) {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }

  function dimScreen(alpha = 0.78) {
    ctx.fillStyle = `rgba(6,12,8,${alpha})`;
    ctx.fillRect(0, 0, CW, CH);
    ctx.fillStyle = 'rgba(0,0,0,0.12)';          // scanlines
    for (let y = 0; y < CH; y += 3) ctx.fillRect(0, y, CW, 1);
  }

  function pixelText(text, x, y, size, color, align = 'center', shadow = true) {
    ctx.font = `${size}px ${PIX}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (shadow) { ctx.fillStyle = COL.ink; ctx.fillText(text, x + Math.max(2, size / 8), y + Math.max(2, size / 8)); }
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function drawPixelBox(b, title, band, alpha = 0.95) {
    ctx.fillStyle = `rgba(0,0,0,${0.55 * alpha})`;
    ctx.fillRect(b.x + 7, b.y + 7, b.w, b.h);
    ctx.fillStyle = `rgba(24,48,32,${alpha})`;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = band;
    ctx.fillRect(b.x, b.y, b.w, 38);
    ctx.fillStyle = COL.ink;
    ctx.fillRect(b.x, b.y + 38, b.w, 3);
    ctx.strokeStyle = COL.cream; ctx.lineWidth = 4;
    ctx.strokeRect(b.x + 2, b.y + 2, b.w - 4, b.h - 4);
    ctx.strokeStyle = COL.ink; ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
    pixelText(title, b.x + b.w / 2, b.y + 22, 15, COL.cream);
  }

  function tint(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => clamp(Math.round(c + amt), 0, 255);
    return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
  }

  // The main button on the start screen slowly pulses: a soft glow around it and a little brighter
  function drawPulsingButton(r, label, size, color) {
    const k = 0.5 + 0.5 * Math.sin(state.t * 2.4);
    for (let i = 3; i >= 1; i--) {
      const g = i * (2 + 2.5 * k);
      ctx.fillStyle = `rgba(255,226,122,${(0.10 + 0.16 * k) / i})`;
      ctx.fillRect(r.x - g, r.y - g, r.w + 2 * g, r.h + 2 * g);
    }
    const n = parseInt(color.slice(1), 16), up = (c) => clamp(Math.round(c + 26 * k), 0, 255);
    const hex = '#' + [n >> 16, (n >> 8) & 255, n & 255].map((c) => up(c).toString(16).padStart(2, '0')).join('');
    drawButton(r, label, size, hex);
  }

  function drawButton(r, label, size, color, enabled = true) {
    const hov = enabled && hit(r);
    const press = hov && pointerDown;
    const oy = press ? 3 : 0;
    ctx.fillStyle = COL.ink;                               // chunky drop shadow
    ctx.fillRect(r.x + 5, r.y + 6, r.w, r.h);
    ctx.fillStyle = enabled ? (hov ? tint(color, 30) : color) : '#5b5b55';
    ctx.fillRect(r.x, r.y + oy, r.w, r.h);
    ctx.fillStyle = 'rgba(255,255,255,0.28)';              // top bevel
    ctx.fillRect(r.x + 3, r.y + oy + 3, r.w - 6, 4);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';                    // bottom bevel
    ctx.fillRect(r.x + 3, r.y + oy + r.h - 7, r.w - 6, 4);
    ctx.strokeStyle = COL.ink; ctx.lineWidth = 3;
    ctx.strokeRect(r.x + 1.5, r.y + oy + 1.5, r.w - 3, r.h - 3);
    pixelText(label, r.x + r.w / 2, r.y + oy + r.h / 2 + 1, size, enabled ? COL.cream : '#9a9a90');
  }

  function drawKey(x, y, label) {
    ctx.font = `10px ${PIX}`;
    const w = Math.max(30, ctx.measureText(label).width + 16), h = 28;
    ctx.fillStyle = '#8c8676';                             // key side
    ctx.fillRect(x, y + 4, w, h);
    ctx.fillStyle = '#ece6d4';                             // key top
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(x + 3, y + 3, w - 6, 3);
    ctx.strokeStyle = COL.ink; ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h + 2);
    ctx.fillStyle = '#2a2a2a';
    const dirs = { '\u25C0': Math.PI, '\u25B6': 0, '\u25B2': -Math.PI / 2, '\u25BC': Math.PI / 2 };
    if (label in dirs) {                                   // arrow keys: draw a crisp triangle
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2 + 1);
      ctx.rotate(dirs[label]);
      ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -6); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
      return w;
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 1);
    return w;
  }

  // classic arrow mouse pointer
  function drawMouseCursor(x, y) {
    const pts = [[0, 0], [0, 19], [5, 14], [8.5, 22], [12, 20.5], [8.5, 13], [15, 13]];
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 1.8; ctx.lineJoin = 'miter'; ctx.stroke();
    ctx.restore();
  }

  function difficultyName(adj) {
    const D = tr('difficulty');
    if (adj <= -30) return [D[0], COL.green];
    if (adj <= 10) return [D[1], COL.amber];
    if (adj <= 30) return [D[2], '#e8743a'];
    return [D[3], '#e5533d'];
  }


  function drawTitle() {
    ctx.setTransform(pxScale, 0, 0, pxScale, 0, 0);
    dimScreen(0.42);   // light enough to peek at the map
    const U = uiRects();

    // title
    const bob = Math.sin(state.t * 2) * 2;
    pixelText('WEIDE', CW / 2, 33 + bob, 42, '#ffe27a');
    ctx.font = `26px ${TXT}`;
    ctx.fillStyle = '#cfe8b8';
    ctx.textAlign = 'center';
    ctx.fillText(tr('subtitle'), CW / 2, 72);

    // left: rules + keys
    const L = U.L;
    drawPixelBox(L, tr('howTo'), COL.red, 0.74);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    // pick the largest text size that still fits (German needs a bit more room)
    const room = L.h - 60 - 96;
    let fs = 20, wrapped;
    for (fs = 20; fs >= 16; fs--) {
      ctx.font = `${fs}px ${TXT}`;
      wrapped = tr('rules').map((r) => wrapText(r, L.w - 62));
      const h = wrapped.reduce((a, ls) => a + ls.length * (fs - 1) + 3, 0);
      if (h <= room) break;
    }
    let y = L.y + 60;
    for (const lines of wrapped) {
      ctx.fillStyle = '#ffe27a';
      ctx.fillRect(L.x + 22, y - 4, 7, 7);                 // square bullet
      ctx.fillStyle = '#f5efdc';
      lines.forEach((ln, i) => ctx.fillText(ln, L.x + 40, y + i * (fs - 1)));
      y += lines.length * (fs - 1) + 3;
    }
    // controls
    y += 6;
    ctx.fillStyle = 'rgba(243,228,191,0.35)';
    ctx.fillRect(L.x + 20, y, L.w - 40, 2);
    y += 12;
    const label = (t, xx, yy) => {
      ctx.font = `21px ${TXT}`; ctx.fillStyle = '#f5efdc'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(t, xx, yy + 15);
      return ctx.measureText(t).width;
    };
    // row 1: move the dog
    // the key caps start after the longer of the two row labels
    ctx.font = `11px ${PIX}`;
    const kx0 = L.x + 22 + Math.max(ctx.measureText(tr('move')).width, ctx.measureText(tr('keys')).width) + 16;
    pixelText(tr('move'), L.x + 22, y + 15, 11, COL.cream, 'left', false);
    let x = kx0;
    for (const k of ['\u25C0', '\u25B2', '\u25BC', '\u25B6']) x += drawKey(x, y, k) + 4;
    x += 10;
    x += label(tr('or'), x, y) + 12;
    drawMouseCursor(x, y + 3);
    x += 24;
    label(tr('clickDrag'), x, y);
    // row 2: other keys
    y += 40;
    pixelText(tr('keys'), L.x + 22, y + 15, 11, COL.cream, 'left', false);
    x = kx0;
    x += drawKey(x, y, 'P') + 4;
    x += drawKey(x, y, 'ESC') + 10;
    x += label(tr('pause'), x, y) + 28;
    x += drawKey(x, y, 'F') + 10;
    x += label(tr('fastDay'), x, y) + 28;
    x += drawKey(x, y, 'W') + 10;
    label(tr('barkKey'), x, y);

    // right: options
    const R = U.R;
    drawPixelBox(R, tr('options'), COL.blue, 0.74);
    pixelText(tr('wolves'), R.x + R.w / 2, R.y + 70, 13, COL.cream);
    drawButton(U.minus, '-', 22, COL.amber, state.wolfAdj > -50);
    drawButton(U.plus, '+', 22, COL.amber, state.wolfAdj < 50);
    const v = state.wolfAdj;
    pixelText(`${v > 0 ? '+' : ''}${v}%`, R.x + R.w / 2, U.minus.y + 30, 22, v === 0 ? COL.cream : v < 0 ? '#9be08a' : '#ff9a7a');

    // segment meter -50 .. +50
    const segW = 20, gap = 4, n = 11, mw = n * segW + (n - 1) * gap;
    const mx = R.x + (R.w - mw) / 2, my = R.y + 182;
    for (let i = 0; i < n; i++) {
      const val = (i - 5) * 10;
      const on = val === 0 || (v > 0 && val > 0 && val <= v) || (v < 0 && val < 0 && val >= v);
      ctx.fillStyle = COL.ink;
      ctx.fillRect(mx + i * (segW + gap) + 2, my + 3, segW, 22);
      ctx.fillStyle = !on ? '#2e4434' : val === 0 ? COL.cream : val < 0 ? COL.green : '#e5533d';
      ctx.fillRect(mx + i * (segW + gap), my, segW, 22);
    }
    ctx.font = `18px ${TXT}`; ctx.fillStyle = '#b9c9b0'; ctx.textAlign = 'center';
    ctx.fillText('-50%', mx + 10, my + 38);
    ctx.fillText('0', mx + mw / 2, my + 38);
    ctx.fillText('+50%', mx + mw - 10, my + 38);

    const [name, ncol] = difficultyName(v);
    pixelText(name, R.x + R.w / 2, R.y + 262, 16, ncol);

    ctx.font = `20px ${TXT}`; ctx.fillStyle = '#f5efdc'; ctx.textAlign = 'center';
    const ex = Math.max(1, Math.round(packBase(9)));
    const [exA, exB] = tr('wolvesExample', ex);
    ctx.fillText(exA, R.x + R.w / 2, R.y + 292);
    ctx.fillText(exB, R.x + R.w / 2, R.y + 312);
    if (state.relax) {                                           // relax mode: no wolves to set
      ctx.fillStyle = 'rgba(16,32,22,0.88)';
      ctx.fillRect(R.x + 8, R.y + 52, R.w - 16, 274);
      pixelText(tr('relaxOn'), R.x + R.w / 2, R.y + 150, 16, '#7fe0c8');
      ctx.font = `22px ${TXT}`; ctx.fillStyle = '#f5efdc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const [ra, rb] = tr('relaxLine');
      ctx.fillText(ra, R.x + R.w / 2, R.y + 196);
      ctx.fillText(rb, R.x + R.w / 2, R.y + 222);
    }

    // start season (radio buttons)
    ctx.fillStyle = 'rgba(243,228,191,0.35)';
    ctx.fillRect(R.x + 20, R.y + 332, R.w - 40, 2);
    pixelText(tr('startSeason'), R.x + R.w / 2, R.y + 356, 12, COL.cream);
    SEASONS.forEach((se, i) => {
      const b = U.seasons[i];
      const sel = state.seasonStart === i, hov = hit(b);
      const cx = b.x + 13, cy2 = b.y + b.h / 2;
      ctx.fillStyle = COL.ink;                                   // pixel radio button
      ctx.fillRect(cx - 9, cy2 - 9, 18, 18);
      ctx.fillStyle = hov ? '#fffaf0' : '#ece6d4';
      ctx.fillRect(cx - 7, cy2 - 7, 14, 14);
      if (sel) { ctx.fillStyle = COL.ink; ctx.fillRect(cx - 4, cy2 - 4, 8, 8); }
      ctx.font = `22px ${TXT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillStyle = sel ? se.color : hov ? '#f5efdc' : '#b9c9b0';
      ctx.fillText(tr('seasons')[i], cx + 16, cy2 + 1);
    });

    // start (or, with a saved game: resume / new game)
    ctx.font = `19px ${TXT}`; ctx.fillStyle = '#c3d6bd'; ctx.textAlign = 'center';
    if (savedInfo) {
      drawPulsingButton(U.resume, tr('resume'), 13, COL.red);
      drawButton(U.newGame, tr('newGame'), 13, '#b07a2a');
      ctx.font = `19px ${TXT}`; ctx.fillStyle = '#c3d6bd'; ctx.textAlign = 'center';
      ctx.fillText(tr('savedHint', savedInfo.day, savedInfo.n), CW / 2, 667);   // (stays put: a bit below the buttons)
    } else {
      drawPulsingButton(U.start, tr('startGame'), 20, COL.red);
      ctx.font = `19px ${TXT}`; ctx.fillStyle = '#c3d6bd'; ctx.textAlign = 'center';
      ctx.fillText(tr('pressEnter'), CW / 2, 667);   // (stays put: a bit below the buttons)
    }
    drawButton(U.shuffle, tr('shuffle'), 10, COL.green);
    // relax mode: a toggle with a pixel check box
    drawButton(U.relax, '', 10, state.relax ? '#3f9c8a' : '#4d6a5a');
    {
      const r = U.relax, oy = hit(U.relax) && pointerDown ? 3 : 0;
      const bx = r.x + 16, by = r.y + oy + r.h / 2 - 9;
      ctx.fillStyle = COL.ink; ctx.fillRect(bx, by, 18, 18);
      ctx.fillStyle = '#ece6d4'; ctx.fillRect(bx + 2, by + 2, 14, 14);
      if (state.relax) {                                         // pixel check mark
        ctx.fillStyle = COL.ink;
        for (const [px, py] of [[4, 9], [6, 11], [8, 9], [10, 7], [12, 5]]) ctx.fillRect(bx + px - 1, by + py - 1, 3, 3);
      }
      pixelText(tr('relax'), r.x + r.w / 2 + 14, r.y + oy + r.h / 2 + 1, 10, COL.cream);
    }

    // language: click a flag
    drawFlagButton(U.langEn, 'en');
    drawFlagButton(U.langDe, 'de');

    // small print in the corners
    const hy = CH - 14;
    ctx.font = `18px ${TXT}`;
    ctx.textAlign = 'left';
    const hov = hit(U.help);
    ctx.fillStyle = hov ? '#d8ecc8' : '#7f957a';
    ctx.fillText(tr('help'), 14, hy);
    if (hov) {
      const lw = ctx.measureText(tr('help')).width;
      ctx.fillRect(14, hy + 8, lw, 1);
    }
    if (customSettings) {   // reminder that tuning from the help page is active
      const lw = ctx.measureText(tr('help')).width;
      ctx.fillStyle = '#e8c45a';
      ctx.fillText(tr('custom', customSettings), 14 + lw + 10, hy);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = '#6f8569';
    ctx.fillText('\u00A9 Andreas Faisst', CW - 14, hy);
  }

  function drawGameOver() {
    ctx.setTransform(pxScale, 0, 0, pxScale, 0, 0);
    dimScreen();
    const U = uiRects();
    const b = { x: CW / 2 - 290, y: 150, w: 580, h: 290 };
    drawPixelBox(b, tr('gameOver'), COL.red);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `25px ${TXT}`; ctx.fillStyle = '#ffd9a8';
    wrapText(state.overReason, b.w - 60).forEach((ln, i) => ctx.fillText(ln, CW / 2, b.y + 78 + i * 24));
    const K = tr('overRows');
    const rows = [
      [K[0], state.day],
      [K[1], tr('nSheep', state.best)],
      [K[2], state.born],
      [K[3], state.lost],
      [K[4], state.starved],
      [K[5], state.relax ? tr('relaxShort') : `${state.wolfAdj > 0 ? '+' : ''}${state.wolfAdj}%`],
    ];
    ctx.font = `23px ${TXT}`;
    rows.forEach(([k, val], i) => {
      const yy = b.y + 128 + i * 25;
      ctx.textAlign = 'left'; ctx.fillStyle = '#c9d8c0'; ctx.fillText(k, b.x + 130, yy);
      ctx.textAlign = 'right'; ctx.fillStyle = '#ffe27a'; ctx.fillText(String(val), b.x + b.w - 130, yy);
    });
    if (state.overT > 1) drawButton(U.cont, tr('cont'), 16, COL.blue);
  }

  function drawConfirmExit() {
    ctx.setTransform(pxScale, 0, 0, pxScale, 0, 0);
    dimScreen();
    const U = uiRects();
    const b = { x: CW / 2 - 220, y: CH / 2 - 110, w: 440, h: 200 };
    drawPixelBox(b, tr('exitTitle'), COL.red);
    ctx.font = `24px ${TXT}`; ctx.fillStyle = '#f5efdc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tr('exitLine1'), CW / 2, b.y + 70);
    ctx.fillText(tr('exitLine2'), CW / 2, b.y + 94);
    drawButton(U.yes, tr('yes'), 14, COL.red);
    drawButton(U.no, tr('no'), 14, COL.blue);
  }

  function drawPaused() {
    ctx.setTransform(pxScale, 0, 0, pxScale, 0, 0);
    dimScreen();
    const b = { x: CW / 2 - 210, y: CH / 2 - 100, w: 420, h: 190 };
    drawPixelBox(b, tr('paused'), COL.blue);
    ctx.font = `22px ${TXT}`; ctx.fillStyle = '#f5efdc'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(tr('pausedLine'), CW / 2, b.y + 78);
    const U = uiRects();
    drawButton(U.pResume, tr('contBtn'), 11, COL.green);
    drawButton(U.pExit, tr('exitBtn'), 11, COL.red);
  }

  // In-game cursor: a cream ring with a little paw print (hot spot in the middle)
  const pawCursor = (ring, paw, fallback) => {
    const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'>" +
      "<circle cx='16' cy='16' r='12' fill='none' stroke='#0b150d' stroke-width='4'/>" +
      `<circle cx='16' cy='16' r='12' fill='none' stroke='${ring}' stroke-width='2'/>` +
      `<g fill='${paw}' stroke='#0b150d' stroke-width='1'>` +
      "<ellipse cx='16' cy='18.6' rx='3.6' ry='3'/><circle cx='11.6' cy='14.4' r='1.7'/>" +
      "<circle cx='14.5' cy='12' r='1.7'/><circle cx='17.5' cy='12' r='1.7'/><circle cx='20.4' cy='14.4' r='1.7'/>" +
      '</g></svg>';
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, ${fallback}`;
  };
  // In-game and menu cursor: a cream ring with a little paw print (hot spot in the middle).
  // Over something clickable the paw turns yellow.
  const PAW_CURSOR = pawCursor('#f3e4bf', '#f3e4bf', 'crosshair');
  const PAW_CURSOR_HOVER = pawCursor('#ffe27a', '#ffe27a', 'pointer');

  let lastCursor = '';
  function updateCursor() {
    const U = uiRects();
    let c = PAW_CURSOR;
    if (state.screen === 'title') c = [...(savedInfo ? [U.resume, U.newGame] : [U.start]), U.shuffle, U.relax, U.minus, U.plus, U.help, U.langEn, U.langDe, ...U.seasons].some(hit) ? PAW_CURSOR_HOVER : PAW_CURSOR;
    else if (state.screen === 'over') c = state.overT > 1 && hit(U.cont) ? PAW_CURSOR_HOVER : PAW_CURSOR;
    else if (state.confirmExit) c = hit(U.yes) || hit(U.no) ? PAW_CURSOR_HOVER : PAW_CURSOR;
    else if (state.paused ? hit(U.pResume) || hit(U.pExit) : hit(U.exit) || hit(U.fast) || hit(U.bark)) c = PAW_CURSOR_HOVER;
    if (c !== lastCursor) { canvas.style.cursor = c; lastCursor = c; }
  }

  // Choosing the start season also shows it behind the menu
  // Back to the start screen: same map, fresh grass, no animals (so you can see the map)
  // ---------------------------------------------------------------------------
  // Saving: the running game is kept in the browser (on EXIT, when the page is closed or
  // hidden, and every morning). The start screen then offers RESUME GAME.
  // ---------------------------------------------------------------------------
  const SAVE_KEY = 'weide.save';
  const SAVE_STATE = ['day', 'hour', 'best', 'lost', 'starved', 'born', 'dayWolfAt', 'spawnQ', 'wolfAdj', 'relax',
                      'seasonStart', 'snowLevel', 'tractorDays', 'tractorToday', 'gameId', 'farmerJobs', 'farmerJob',
                      'fogDays', 'foggy', 'blizzardDay', 'blizzard'];
  let savedInfo = null;   // { day, n, gameId } of the saved game, for the start screen
  function readSave() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY));
      return d && d.v === 1 ? d : null;
    } catch (e) { return null; }
  }
  function deleteSave() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    savedInfo = null;
  }
  function saveGame() {
    if (state.screen !== 'play' || !dog || state.overDelay > 0) return;
    const st = {};
    for (const k of SAVE_STATE) st[k] = state[k];
    const data = {
      v: 1, state: st, dog, sheep, wolves, bowlFood: bowl.food, tractor, farmer, dig, rake, leaves: groundLeaves,
      deco, barrow, job: { ...job, trees: job.trees.map((t) => trees.indexOf(t)) },
      map: { trees, rocks, lakes, streams, patches, oldPatches },
    };
    // pictures (canvases) are not saved; they are painted again when the game is loaded
    const json = JSON.stringify(data, (k, v) => (k === 'tex' || k === 'texs' || k === 'lake' ? undefined : v));
    try {
      localStorage.setItem(SAVE_KEY, json);
      savedInfo = { day: st.day, n: sheep.length, gameId: st.gameId };
    } catch (e) { /* storage full or blocked: never mind */ }
  }
  function resumeGame() {
    const d = readSave();
    if (!d) { savedInfo = null; return; }
    Object.assign(state, d.state, {
      screen: 'play', paused: false, floats: [], marker: null, fast: false, msg: null,
      sheepTalkCD: 0, wolfTalkCD: 0, overDelay: 0, overReason: '', overT: 0, confirmExit: false,
    });
    dog = d.dog; sheep = d.sheep; wolves = d.wolves; bowl.food = d.bowlFood;
    trees = d.map.trees.map((t) => ({ ...t, texs: {} }));
    rocks = d.map.rocks; lakes = d.map.lakes; streams = d.map.streams;
    const withTex = (p) => ({ ...p, tex: makePatchTexture(p.R, p.winter) });
    patches = d.map.patches.map(withTex);
    oldPatches = d.map.oldPatches.map(withTex);
    rebuildSolids();
    Object.assign(tractor, d.tractor, { puffs: [] });
    Object.assign(farmer, d.farmer);
    Object.assign(dig, d.dig);
    if (d.rake) Object.assign(rake, d.rake);
    if (d.deco) Object.assign(deco, d.deco);
    if (d.barrow) Object.assign(barrow, d.barrow);
    if (d.job) Object.assign(job, d.job, { trees: (d.job.trees || []).map((i) => trees[i]).filter(Boolean) });
    for (const e of [dog, ...sheep, ...wolves, farmer]) e.lpx = undefined;   // (footprints)
    applySeason();
    if (d.leaves && seasonIndex() === 2) groundLeaves = d.leaves;   // (raked heaps stay raked)
    populateDucks();
    showMsg(tr('welcomeBack', state.day), 4);
  }
  { const d = readSave(); if (d) savedInfo = { day: d.state.day, n: d.sheep.length, gameId: d.state.gameId }; }
  window.addEventListener('pagehide', saveGame);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });

  function backToTitle() {
    loadPrefs();
    state.screen = 'title';
    state.paused = false;
    state.confirmExit = false;
    state.fast = false;
    state.day = 1;
    state.floats = [];
    state.msg = null;
    dog = null; sheep = []; wolves = [];
    applySeason();
    populateDucks();
    patches = generatePatches(2, true);
    oldPatches = [];
  }

  // New random map: trees, rocks, lakes, ducks and grass
  function shuffleMap() {
    generateObstacles();
    applySeason();
    populateDucks();
    patches = generatePatches(2, true);
    oldPatches = [];
  }

  function setSeasonStart(i) {
    if (state.seasonStart === i) return;
    state.seasonStart = i;
    try { localStorage.setItem('weide.season', String(i)); } catch (e) { /* ignore */ }
    if (state.screen === 'title') {
      state.day = 1;
      applySeason();
      populateDucks();
      patches = generatePatches(2, true);
    }
  }

  // Relax mode is off whenever the game is opened; the choice only lasts while the page is open.
  let relaxPref = false;
  function setRelax(on) {
    state.relax = relaxPref = on;
  }
  function setWolfAdj(v) {
    state.wolfAdj = clamp(v, -50, 50);
    try { localStorage.setItem('weide.wolfAdj', String(state.wolfAdj)); } catch (e) { /* ignore */ }
  }
  function loadPrefs() {
    try {
      const saved = parseInt(localStorage.getItem('weide.wolfAdj'), 10);
      state.wolfAdj = Number.isFinite(saved) ? clamp(Math.round(saved / 10) * 10, -50, 50) : 0;
      const ss = parseInt(localStorage.getItem('weide.season'), 10);
      state.seasonStart = ss >= 0 && ss < 4 ? ss : 0;
    } catch (e) { /* ignore */ }
    state.relax = relaxPref;
  }
  try {
    const saved = parseInt(localStorage.getItem('weide.wolfAdj'), 10);
    if (Number.isFinite(saved)) state.wolfAdj = clamp(Math.round(saved / 10) * 10, -50, 50);
    const lg = localStorage.getItem('weide.lang');
    state.lang = lg === 'de' || lg === 'en' ? lg : /^de\b/i.test(navigator.language || '') ? 'de' : 'en';
    const ss = parseInt(localStorage.getItem('weide.season'), 10);
    if (ss >= 0 && ss < 4) state.seasonStart = ss;
    localStorage.removeItem('weide.relax');        // (older versions remembered relax mode)
  } catch (e) { /* ignore */ }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function toField(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * CW,
      y: ((e.clientY - r.top) / r.height) * CH - HUD,
    };
  }
  const mouse = { x: 0, y: 0, inside: false };

  function setTarget(p) {
    dog.trick = null;
    dog.idleT = 0;
    dog.tx = clamp(p.x, dog.r + 7, FW - dog.r - 7);
    dog.ty = clamp(p.y, dog.r + 7, FH - dog.r - 7);
    state.marker = { x: dog.tx, y: dog.ty, t: 0.8 };
  }

  // Arrow keys move the dog as an alternative to clicking
  const arrows = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
  let arrowsWereDown = false;
  function applyArrowKeys() {
    const kx = (arrows.ArrowRight ? 1 : 0) - (arrows.ArrowLeft ? 1 : 0);
    const ky = (arrows.ArrowDown ? 1 : 0) - (arrows.ArrowUp ? 1 : 0);
    if (kx || ky) {
      const n = Math.hypot(kx, ky);
      dog.tx = clamp(dog.x + (kx / n) * 40, dog.r + 7, FW - dog.r - 7);
      dog.ty = clamp(dog.y + (ky / n) * 40, dog.r + 7, FH - dog.r - 7);
      dog.trick = null;
      dog.idleT = 0;
      arrowsWereDown = true;
    } else if (arrowsWereDown) {
      dog.tx = dog.x; dog.ty = dog.y;   // let go: stop
      arrowsWereDown = false;
    }
  }
  window.addEventListener('keyup', (e) => { if (e.key in arrows) arrows[e.key] = false; });
  window.addEventListener('blur', () => { for (const k in arrows) arrows[k] = false; });

  let held = false;
  let pointerDown = false;
  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    ui.x = ((e.clientX - r.left) / r.width) * CW;
    ui.y = ((e.clientY - r.top) / r.height) * CH;
  }
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    toCanvas(e);
    pointerDown = true;
    const U = uiRects();
    if (state.screen === 'title') {
      if (savedInfo && hit(U.resume)) resumeGame();
      else if (savedInfo && hit(U.newGame)) startGame();
      else if (!savedInfo && hit(U.start)) startGame();
      else if (hit(U.shuffle)) shuffleMap();
      else if (hit(U.relax)) setRelax(!state.relax);
      else if (hit(U.minus) && !state.relax) setWolfAdj(state.wolfAdj - 10);
      else if (hit(U.plus) && !state.relax) setWolfAdj(state.wolfAdj + 10);
      else if (hit(U.help)) window.open('help.html', '_blank');
      else if (hit(U.langEn)) setLang('en');
      else if (hit(U.langDe)) setLang('de');
      else U.seasons.forEach((b, i) => { if (hit(b)) setSeasonStart(i); });
      return;
    }
    if (state.screen === 'over') { if (state.overT > 1 && hit(U.cont)) backToTitle(); return; }
    if (state.confirmExit) {
      if (hit(U.yes)) { saveGame(); backToTitle(); }
      else if (hit(U.no)) state.confirmExit = false;
      return;
    }
    if (state.paused) {
      if (hit(U.pResume)) state.paused = false;
      else if (hit(U.pExit)) { saveGame(); backToTitle(); }
      return;
    }
    if (hit(U.exit)) { state.paused = true; state.fast = false; return; }   // PAUSE button
    if (hit(U.fast)) { toggleFast(); return; }
    if (hit(U.bark)) { bark(); return; }
    held = true;
    canvas.setPointerCapture(e.pointerId);
    setTarget(toField(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    toCanvas(e);
    const f = toField(e);
    mouse.x = f.x; mouse.y = f.y; mouse.inside = f.y >= 0;
    if (held && state.screen === 'play') setTarget(f);
  });
  canvas.addEventListener('pointerleave', () => { mouse.inside = false; ui.x = ui.y = -1; });
  canvas.addEventListener('pointerup', () => { held = false; pointerDown = false; });
  canvas.addEventListener('pointercancel', () => { held = false; pointerDown = false; });

  // fast-forward on/off (key F or the >> button), only during the day
  function toggleFast() {
    const ph = phaseName();
    if (ph !== 'day' && ph !== 'dusk') return;
    state.fast = !state.fast;
    showMsg(state.fast ? tr('fastOn', CFG.fastForward) : tr('fastOff'), 2);
  }

  window.addEventListener('keydown', (e) => {
    if (state.screen === 'title') {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (savedInfo) resumeGame(); else startGame(); }
      else if (savedInfo && (e.key === 'n' || e.key === 'N')) startGame();
      else if (e.key === 'ArrowLeft' || e.key === '-') setWolfAdj(state.wolfAdj - 10);
      else if (e.key === 'ArrowRight' || e.key === '+' || e.key === '=') setWolfAdj(state.wolfAdj + 10);
      else if (e.key === 's' || e.key === 'S') shuffleMap();
      else if (e.key === 'r' || e.key === 'R') setRelax(!state.relax);
      else if (e.key === 'l' || e.key === 'L') setLang(state.lang === 'de' ? 'en' : 'de');
      else if (e.key === 'ArrowUp') setSeasonStart((state.seasonStart + 3) % 4);
      else if (e.key === 'ArrowDown') setSeasonStart((state.seasonStart + 1) % 4);
      return;
    }
    if (state.screen === 'over') {
      if ((e.key === 'Enter' || e.key === ' ') && state.overT > 1) { e.preventDefault(); backToTitle(); }
      return;
    }
    if (state.confirmExit) {
      if (e.key === 'Enter' || e.key === 'y' || e.key === 'Y') { saveGame(); backToTitle(); }
      else if (e.key === 'Escape' || e.key === 'n' || e.key === 'N') state.confirmExit = false;
      return;
    }
    if (e.key in arrows) {
      e.preventDefault();
      if (state.screen === 'play' && !state.paused) arrows[e.key] = true;
    }
    if ((e.key === 'p' || e.key === 'P' || e.key === 'Escape') && state.screen === 'play') {
      state.paused = !state.paused;
    }
    if ((e.key === 'f' || e.key === 'F') && state.screen === 'play' && !state.paused) toggleFast();
    if ((e.key === 'w' || e.key === 'W') && state.screen === 'play' && !state.paused) bark();
    if (state.paused && (e.key === 'x' || e.key === 'X')) { saveGame(); backToTitle(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.screen === 'play') state.paused = true;
  });

  // ---------------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------------
  // Title screen shows some grass already
  generateObstacles();
  applySeason();
  populateDucks();
  patches = generatePatches(2, true);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    state.t += dt;
    if (state.screen === 'play' && !state.paused && !state.confirmExit) {
      // F = fast-forward: run several simulation steps per frame, only during the day
      const ph = phaseName();
      const steps = state.fast && (ph === 'day' || ph === 'dusk') ? CFG.fastForward : 1;
      for (let i = 0; i < steps && state.screen === 'play'; i++) update(dt);
    }
    else if (state.screen === 'over') state.overT += dt;
    if (!state.paused && !state.confirmExit) {
      updateWeather(dt);
      if (state.screen !== 'play') updateStreams(dt);   // keep the water flowing on the menus too
    }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Handy for debugging in the browser console
  window.weide = {
    bark, packSize, scheduleDayWolves, blizzardLevel, fogLevel, grassToSeek, nearPatch, flagWind, tractor, planTractor, farmer, dig, rake, deco, job, barrow, HUT, pickAppleTrees, segClear, routeTo, saveGame, resumeGame, get savedInfo() { return savedInfo; },
    state, SEASONS, CLOCK, CFG,
    get sheep() { return sheep; }, get wolves() { return wolves; },
    get dog() { return dog; }, get patches() { return patches; }, mouse, bowl,
    get trees() { return trees; }, get rocks() { return rocks; }, get lakes() { return lakes; }, get streams() { return streams; }, get ducks() { return ducks; },
    get groundLeaves() { return groundLeaves; }, get bees() { return bees; },
  };
})();
