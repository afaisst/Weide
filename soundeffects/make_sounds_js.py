#!/usr/bin/env python3
"""
Pack the sound files in this folder into sounds.js, which the game loads.

Run it again whenever you add, change or remove a sound file:

    python3 soundeffects/make_sounds_js.py

Why a .js file? Browsers don't let a page opened straight from the disk
(file://...) read other files with JavaScript, but they do load scripts.
So the sounds are stored inside a script, as text (base64).

File names: <kind>_<number>.mp3, e.g. sheep_1.mp3, sheep_2.mp3 - every time a
sheep bleats, one of the sheep_... files is picked at random. The game knows
these kinds:
    dog_bark_N      the dog barking
    sheep_N         a sheep bleating
    wolf_N          a wolf howling
    duck_N          a single quack
    duck_ambient    a lake full of ducks (played in a loop near the lakes)
    crickets        crickets (played in a loop on summer evenings)
    grassmower      the farmer's lawn mower (played in a loop while he mows)
    beeropen        the farmer opening his beer on the bench
    stream          a babbling stream (played in a loop when the dog is close to one)
Sounds that loop should be short clips whose end flows smoothly into their start.
(Files in subfolders, like originals/, are not packed.)
(.mp3, .ogg, .wav and .m4a files work.)
"""
import base64
import pathlib

here = pathlib.Path(__file__).resolve().parent
files = sorted(p for p in here.iterdir() if p.suffix.lower() in ('.mp3', '.ogg', '.wav', '.m4a'))
if not files:
    # e.g. a fresh git clone: the sound files aren't in git, only sounds.js - keep it
    raise SystemExit('No sound files here - sounds.js left as it is.')

lines = [
    '// Made by make_sounds_js.py from the sound files in this folder - do not edit by hand.',
    '// Run  python3 soundeffects/make_sounds_js.py  again after adding or changing a sound file.',
    'window.WEIDE_SOUNDS = {',
]
for p in files:
    data = base64.b64encode(p.read_bytes()).decode('ascii')
    lines.append(f'  "{p.stem}": "{data}",')
lines.append('};')
(here / 'sounds.js').write_text('\n'.join(lines) + '\n', encoding='ascii')

total = sum(p.stat().st_size for p in files)
print(f'sounds.js: {len(files)} sound files ({total / 1024:.0f} KB):', ', '.join(p.stem for p in files))
