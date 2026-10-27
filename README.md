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
- Hungry sheep look for grass on their own; herd them to it. They only eat when the dog keeps its distance.
- The ring around a sheep shows what it ate today. Green = fully fed.
- Hungry sheep lose health overnight and can starve.
- In the evening the fully fed sheep walk home by themselves; hungry ones stay out and must be herded in (once they are on the cobblestone patio in front of the door, they go in on their own). Make sure every sheep is in the stable before nightfall. Then the wolves come!
- Wolves may attack by day too. Chase them off before they bite.
- A fully fed ram + a fully fed ewe in the stable = a lamb overnight. Lambs are small on their first day and need less food, grown up on their second day, and can have lambs themselves from their second night on.
- Running tires the dog. Its food bowl next to the stable restores energy.
- Seasons change every 3 days. Summer days are long, winter days short and cold!
- Once a season the farmer's tractor drives in through the gate and parks next to the stable for the day. The farmer works around the stable, digs, has a beer on the bench (not in winter!), pats the dog, and wolves keep away from both!
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
