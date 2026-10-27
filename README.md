# Weide

A small browser game about herding sheep on a Swiss alp ("Weide" means pasture).
You play a Saint Bernard: herd the flock onto the grass so the sheep can eat, bring them
into the stable before nightfall, and protect them from the wolves. Every night, fed sheep
have lambs. How big can your flock grow?

## Goal

You start with **one ram** (grey, with horns) and **one ewe** (white). Keep them fed and safe
so they have lambs, and grow the **largest flock** you can. The game is over when all rams
or all ewes are gone.

## How to play

- Sheep run away from your Saint Bernard: use that to herd them.
- Herd the sheep onto the lush grass. They only eat when the dog keeps its distance.
- The ring around a sheep shows what it ate today. Green = fully fed.
- Hungry sheep lose health overnight and can starve.
- Get every sheep into the stable before nightfall. Then the wolves come!
- Wolves may attack by day too. Chase them off before they bite.
- A fully fed ram + a fully fed ewe = a lamb overnight.
- Running tires the dog. Its food bowl next to the stable restores energy.
- Seasons change every 3 days. Summer days are long, winter days short and cold!
- No rams or no ewes left = game over.

## Controls

| Input | What it does |
| --- | --- |
| Click / drag on the pasture, or arrow keys | Move the dog |
| `P` or `Esc` | Pause |
| `F` | Fast-forward the day |
| `EXIT` button | Back to the start screen |

On the start screen you can set the number of **wolves** (−50% to +50%), choose the
**start season**, and **shuffle the map** until you like it. Click the little flags in the top
right corner (or press `L`) to play in **English or German**.

## Running the game

No installation needed: download or clone this repository and open `index.html` in a
web browser.

| File | Contents |
| --- | --- |
| `index.html` | The game page |
| `game.js` | The game |
| `config.js` | All the numbers you can tune (speeds, wolves, food, seasons, ...) |
| `help.html` | Detailed gameplay and a settings editor |
| `fonts.css` | The retro fonts (Press Start 2P and VT323, SIL Open Font License) |

## More

All the rules, numbers, and every setting you can tune are on the
**[detailed gameplay page](help.html)** (also linked from the start screen of the game).
You can even change the settings there and see the effect in the game right away.

© Andreas Faisst
