# Cayo Azul

Cayo Azul is a 3D open-world crime game that runs in a browser. You play Dario
Venn, a driver new to the island, hired by Ilsa Crane, who runs a harbour cafe
that fronts for the neighbourhood. Her rival crew, The Breakers, led by Silas
Vane, wants the harbour trade, and Dario's driving is what stands between the
cafe and the crew.

The game is set on an island port city with a harbour on its south shore,
beaches on its east shore, and hills in the north. The city has fifteen
districts, from the Harbour and Old Town to Coral Beach and North Hill, joined
by a ring road, a central grid, and a coastal avenue. Twenty landmarks mark
the map, from the harbour piers and cranes to the old fort. Everything is
shown from a chase camera behind Dario, on foot or in a car.

## How to play

You explore the island freely. On foot you walk, run, and sprint, and you can
fight with a short melee swing. Near a car you can get in, drive it, and get
out again. Taking a car that is not yours raises your wanted level.

The story is an eight-mission campaign. Each mission starts with a short
briefing from Ilsa or another character, then a chain of objectives: deliver
something, chase or lose a car, pick something up against the clock, survive
an ambush, pull off a harbour heist, race the ring road at night, and finish
with a convoy chase across the island. Missions pay more as they go, from 750
for the first delivery to 12,000 for the island finale. Failing a mission lets
you retry from its briefing, and checkpoints inside a mission save your
progress so a fail resumes mid-mission rather than from the start.

Between missions there are four side jobs: taxi fares, parcel deliveries,
vigilante work chasing a getaway car, and street racing through checkpoints.
Twelve small street events can also appear while you roam, from a mugging to
stop to a stray dog that follows you for a while. Jobs and events pay cash,
and a clean run pays a small bonus. A kill streak from consecutive melee
knockdowns multiplies job payouts slightly.

The police watch everything. The wanted level runs from zero to five stars.
Stealing cars, hurting pedestrians, and mission heat raise it; staying out of
sight and out of trouble lets it fall. At one star, foot officers approach.
At two, cruisers join the chase. At three and above, roadblocks appear ahead.
At five stars the whole island is hunting you. Getting caught means busted,
and getting your health to zero means wasted; either way you pay a fine and
respawn at the nearest garage. Health regenerates slowly out of combat and
refills at a garage or after a mission.

Money buys cars. Six garages around the island each hold up to four cars you
own, from a cheap hatchback to a dear sports coupe, with a sedan, a taxi, and
a pickup truck between them. You can store a car, take one out at the garage
door, and sell cars you no longer want.

Progress saves to the browser. The game saves at mission checkpoints, at
garages, and from the pause menu, and loading restores your player, money,
mission progress, story flags, owned cars and their garages, achievements,
play time, and settings (radio station and volume). A corrupt or missing save
simply starts a new game.

Twenty-four achievements track the whole game: your first mission and all
eight, your first stolen car, your first taxi fare, delivery, race win, and
vigilante stop, your first five-star wanted level and escaping it, a kill
streak of five, earning 10,000 in total, owning three cars and then all six
models, visiting all fifteen districts and all twenty landmarks, surviving a
night of rain, listening to every station, finishing a mission with no damage,
completing a job cleanly, finding the stray dog, finishing the island finale,
saving the game, and playing for one hour in total.

## Controls

- W A S D — move (on foot, relative to the camera; driving, steer and pedals)
- Shift — sprint on foot
- Mouse drag — orbit the camera a little
- Mouse wheel — pull the camera closer or further
- E — enter or exit a car
- F — melee attack
- Space — handbrake while driving
- R — switch radio station
- M — start the next mission
- G — garage menu
- Esc — pause

## Radio

Six stations play procedural music made by the game itself: a sun-soaked pop
station, a harbour rock station, a night-drive synth station, a salsa
station, a talk station with invented local news, and a classical station.
The current station shows on the HUD, and R switches between them.

## Weather and time

A full day passes in a few minutes of play. Dawn, midday, dusk, and night each
have their own sky, light, and lit windows. Rain starts and stops on its own,
darkens the light, draws streaks and splashes, and makes cars handle slightly
looser.

## Technology

The game is built on a custom WebGL renderer written from scratch for this
game: raw WebGL 1, hand-written 3D math, shaders written as text by the game
code, and low-poly geometry built procedurally by the game's own code. There
are no libraries, no engine, no downloaded files, and no network requests at
any time. All sound, including the radio music and the sound effects, is
synthesised with the browser's own audio. The game is deterministic: the same
seed always gives the same city, the same traffic, and the same mission
layouts, and a seed can be passed in the page address.

## Running it

Open `game/index.html` in a desktop browser. No server, install, or network
connection is needed. The page address may carry a `shot` parameter naming one
of the four screenshot scenes and a `seed` parameter; with no `shot`
parameter the game starts normally at the title screen. The four screenshots
in `screenshots/` were taken of the real game running in a real browser, each
staged by the `shot` parameter with a fixed seed.

To build the entry, run `node main.ts` from the repository root. It copies
`game/` and `screenshots/` into the output folder (the folder named by the
`MAKEFUN_OUTPUT_DIR` environment variable, or `/output` when unset) and
writes `dossier.json` there.

## What the game does not do

There is no multiplayer, no account, and no online feature of any kind. The
game never sends or receives anything over the network, and it stores nothing
outside the browser's own local storage on your machine.
