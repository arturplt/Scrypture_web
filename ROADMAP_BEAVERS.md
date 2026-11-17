# Beavers roadmap

What is built, and what comes next for the beavers of the world map. The code is `src/domain/beavers.ts` (simulation),
`src/domain/berries.ts` (berry bushes), `src/screens/beaversprites.ts` (pictures) and the beaver blocks in
`src/screens/WorldMap.tsx` (drawing, the interaction panel).
The wider ecosystem plan is in `ROADMAP.md` (phase 5 is the dams).

## Built (2026-11-16)

- Colonies come from the world's seed, one chance per 48 x 48 tile cell, and settle only where there is water to dam.
- A pair (male, female) lives at a burrow, fetches sticks and stones off the ground (gone for the player once taken)
  and lays them across the water: 2 sticks and 1 stone per dam tile.
- A finished dam lets its region hold 40 more water tiles and a pond grows beside it.
- The player can hand a stick or stone to a dam they stand by.
- Dams are saved with the world. Beavers and burrows come back from the seed.
- **The burrow is a real structure (B1).** It takes 6 sticks before it counts as a home (`BURROW_STICKS`); the pair
  fetch sticks for it before the dam, and the player can hand it sticks too. It is drawn by how much is built: a bare
  spot, then one stick of the lodge per stick laid (3 at the base, 2, 1 on top), the way in only once it is a home.
  It is saved (place and sticks laid), so it no longer moves when the pond changes the shore.
- **Birth and growing up (B2, steps 1 and 2).** A pair with a home and a finished dam has a litter of 1 to 3 kits
  (`LITTER_WAIT`, 90 s after the last brood has grown). Every beaver has an age in seconds: baby under 120 s (2 world
  days), young under 360 s (6 days), then adult. Kits stay by a parent, the young carry sticks only, and each stage
  walks slower (0.6x, 0.5x). One litter at a time; a colony holds at most 6 (`BROOD_CAP`) until the young can leave.
  Kits and young are drawn with `baby_idle` and `young_idle` at half and three-quarter size. A colony that is not
  the plain seed pair (kits, young, or a different count) is saved with each beaver's sex and age.
- **Leaving, old age, death (B2, steps 3 and 4).** A young beaver that turns adult leaves unless its colony lacks an
  adult of its sex (then it stays to fill the place). It walks to the nearest colony within 150 tiles that has an adult
  of the other sex and none of its own (a widow, a loner, or one that another is already walking to), else to the
  nearest cell of the seed with a place to dam and no colony yet, which is reserved for it: there it settles and the
  next to come pairs up. With nowhere to go it stays. Adults turn old at 36 world days (slow, no hauling or breeding,
  mostly indoors) and die at 46. A colony with nobody left (and nobody on the way) is abandoned: its burrow and dam
  stay, and it is saved as abandoned so the seed does not give it a fresh pair.
- **Needs (B3, rest and food).** The colonies use the sky's existing clock (`eco.hour`, `isNight`): they work from dusk to
  dawn and sleep in the finished burrow by day (the map turns this on with `dayNight`; off, they work round the clock,
  as the tests and the soak run do). Each beaver has food (300 s when fed, falling by 1 a second); under 100 it goes to
  gnaw bark: the nearest bush or tree within 14 tiles of the burrow (a bush is eaten whole, a tree loses a step of its
  size). A tree gnawed through gives a stick for the burrow or dam when the colony still wants one, so sticks no longer
  run out with the ground. Bushes that bear berries are left alone for the player. A berry from the player fills the
  beaver. A colony with a hungry adult does not breed. A gnawing beaver bobs at the trunk.
- **Dams that age (B4).** A standing dam loses a stick from a random tile every 60 s (`LEAK_EVERY`), four times as often
  under a heavy rain cloud, which then takes the weakest tile. A leaking dam is mended like a new one: the beavers fetch
  sticks for it, and the player can hand it pieces (the give button shows again). When more than half its tiles have
  lost every stick it breaks: its pond water is taken off the region's target (`addWaterTarget` with a negative number)
  and the pond drains back as the ecosystem works it off. An abandoned dam is not mended, so it breaks in the end (a
  one-tile dam in about 2 minutes, a long one much later). A rebuilt dam holds water again. A saved dam counts as
  standing if every tile has its stone and it has not broken.
- **Danger and the player (B5).** Beavers within 5 tiles of a fire run for the nearest water clear of it (else into the
  burrow, else away from the flames) and drop what they carry. A fire at the burrow for 2 s burns it to nothing: the pair
  build it again from the first stick. The player can break the dam beside them (the Break button on the dam card):
  half its sticks and stones come back, the pond drains, the colony trusts them one step less, and the beavers start
  mending. Trust now does something: from 2, a colony's beavers come to a player on foot who holds berries; from 4, its
  kits follow the player when they are within 12 tiles.
- Beavers with nothing to do go into a finished burrow and rest 5 to 13 s out of sight (not drawn, cannot be fed).
- The dam is drawn as its sticks and stones.
- **Berries.** Half the world's bushes bear berries (which ones is fixed by the seed, per tile). On foot the player
  picks a ripe bush clean for 2 berries; it is ripe again 3 world days later. Picked bushes are saved with the world.
  The berry is an inventory item like the stick and the stone (`scripts/make-berry.mjs` draws its picture).
- **Feeding.** A beaver within 2 tiles can be handed a berry. It stops to eat, then is full for 90 s: it moves 1.4x
  as fast and takes no more. Each feeding raises its colony's trust a step (0 to 5), saved with the dams.
- **Interaction panel.** On foot, a card appears for each thing in reach: a beaver (picture, trust pips, hungry or
  full, Feed), a berry bush (Pick), an unfinished dam (Give stick, Give stone). Each button shows the item it uses
  and how many are in the bag; the F key presses the marked one (feed, else pick, else give).

## Status

| # | Phase | Size | Status |
|---|---|---|---|
| B1 | The burrow as a real structure | Small | Done except the peeking head and its own sprites |
| B2 | Life cycle: kits, growing up, leaving | Medium | Done (birth, growing up, leaving, old age, death, saving); open questions below |
| B3 | Needs: food, rest, day and night | Medium | Done except the winter store |
| B4 | Dams that age: leaks, repair, breaking | Medium | Done except longer or second dams |
| B5 | Danger: fire, flood, the player | Small-medium | Done except flood and the Bóbr tie-in |
| B6 | Art and animation | Small each | Waiting on sprites |
| B7 | Balance and long runs | Small | Soak hook and first tuning done; start-point colony and steering open |

## B1: The burrow as a real structure

Built: see the list above. Still open:

- A beaver's head at the way in now and then, while the lodge is lived in.
- The burrow sprites, one per stage (today the stages are the stick stand-ins; swap them in with the pictures, see B6).
- No kits until the burrow is a home: waits for B2, which is where kits are born.
- The panel calls the burrow "DAM, BUILDING" while it takes sticks; give it its own card and name.

## B2: Life cycle

Why: this is the heart of it. A colony should grow, age and send out young, so the map fills with beavers over time
instead of holding a fixed pair per cell.

Stages, using the pictures already in `src/assets`:

| Stage | Picture | Lasts | Does |
|---|---|---|---|
| Baby (kit) | `baby_idle.png` | about 2 world days | Stays in or beside the burrow, follows a parent a few tiles |
| Young | `young_idle.png` | about 4 world days | Wanders further, carries sticks only (half as fast as an adult) |
| Adult | `male_idle.png` / `female_idle.png` | about 30 world days | Hauls, builds, pairs, breeds |
| Old | adult picture, slower | until it dies | Stays near the burrow, no hauling |

Rules, all built (see the Built list above):

1. **Birth.** A pair with a finished burrow and a finished dam has a litter of 1 to 3 kits. One litter at a time,
   and not again until the young of the last one have left (so a colony tops out at about 2 adults and 3 young).
2. **Growing up.** Each beaver has an age in world days (`DAY_SECONDS` in `sky.ts` is 60 s, so the table above is
   minutes of play, tunable). The stage follows from the age; the sprite changes with it.
3. **Leaving home.** A young beaver that turns adult walks off to the nearest colony cell of the seed that has no
   colony yet and a place to dam, within some reach (say 150 tiles). Two that meet there pair up. One that finds
   nothing settles as a loner and waits for a mate.
4. **Old age and death.** An adult past its span slows down and then dies. A widowed beaver takes a wandering adult
   as a new mate. A colony with no adults left is abandoned: its burrow and dam stay and start to decay (B4).
5. **Saving.** Per colony: its beavers with age, sex and stage, and the litter timer. Capped, and checked in
   `sanitizeWorlds` like the dams. This replaces "the pair comes back from the seed".

Still open: does a colony far from the player age while nobody watches (catch up on return from the time away, or stay
frozen as now)? Is there a cap on beavers per world? An abandoned colony is never resettled; a beaver could take over
its burrow and dam. A beaver on its way when the player leaves is frozen mid-walk and, after a reload, is back home
(its arrival is not saved). The old have no sprite of their own yet (B6).

## B3: Needs

Built: see the list above (rest by day, hunger and gnawing, hungry colonies do not breed). Still open:

- **Winter store.** In a cold spell (`stepWeather`) they stay in and live off a stick pile kept by the burrow.
- Hunger has no teeth yet: a beaver with no food left only stops a colony from breeding. Starvation, and kits that
  need feeding, are not built.
- Bark is the only food. Beavers could also eat berries themselves (see B5, trust).

## B4: Dams that age

Built: see the list above (leaks, mending, breaking, the pond draining, rain). Still open:

- Colonies with spare time lengthen the dam or build a second one, so ponds differ in size.
- Leaks only run while the colony is near the watched area, so a dam far from the player does not age.
- No sign on the dam of how worn it is (a leaking dam draws fewer sticks; there is no dripping water or gap).
- Tuning: `LEAK_EVERY`, the four-fold rain rate and the half-bare break rule are first guesses (see B7).

## B5: Danger and the player

Built: see the list above (fire, the burnt burrow, breaking a dam, what trust buys). Still open:

- **Flood.** Heavy rain only speeds up the leaks (B4); it never floods a burrow or washes a dam out whole.
- **Bóbr tie-in.** A happy Bóbr at home could mean better luck for the wild colonies (a faster litter, slower leaks).
- Beavers do not run from the player; trust only draws them in. A beaver that flees a fire loses what it carried.
- Fire needs `eco.fires` to be in the watched area: a fire far away does not reach the burrows there.
- **Predators.** Only if other animals are ever added; not planned.

## B6: Art and animation

Waiting on sprites. Each is a drop-in once the picture exists (`beaversprites.ts` cuts and sizes them):

- Female walk frames (she slides on her idle still for now).
- Baby and young walk frames; swim frames for all; a gnawing, an eating and a building pose (a fed beaver nods
  over a berry on its idle still for now). A heart or two over a beaver whose colony's trust went up.
- Burrow, one picture per building stage. Dam pieces: stick-only, finished, leaking.
- In the 2D view the beavers are drawn after the trees, not by row with them.

## B7: Balance and long runs

Built: the soak run (`npm run soak`, `SOAK=<minutes>`; `ecostats.ts`) now runs a `BeaversManager` with the world (turn it
off with `beavers: false`). Each biome prints a second table: colonies, homes, standing dams, abandoned colonies,
beavers by stage, leaks, dams broken, pond tiles grown, sticks hauled, trees gnawed, born, died, left, and the sticks and
stones still lying in the area. A test checks that it is deterministic and that the counts add up.

What the first 30 and 60 minute runs (seed "soak") showed, and what was changed:

- Almost no births (0 to 1 in 30 min): hunger reset the litter wait. Now hunger only pauses it. After: 14 to 23 births.
- Dams starved of sticks: upkeep (a stick a minute) was more than the 20 or so sticks within reach, so dams broke and
  stayed broken. `LEAK_EVERY` 60 to 120, `HAUL_REACH` 40 to 60, and a bush now gives a stick and a felled tree three
  (`FELL_STICKS`). After: most colonies keep a standing dam.
- Lake colonies never finished a dam (3 or 4 stones within reach) and then never bred (no bark within 14 tiles): the
  longer reach fixed the first, `FOOD_REACH` 14 to 24 the second. After: 16 colonies, 29 births in 60 minutes.
- Old age works: the first deaths come at about minute 46, and colonies spread by the young leaving (1 or 2 colonies at
  the start, 5 to 17 after an hour). Forest and lake reach 25 to 35 beavers in the area by minute 60 and are still
  growing, so watch a 2 to 3 hour run for a cap (food and free cells should hold it).
- Grassland shrinks again after 45 minutes (2 beavers at minute 60, 3 colonies abandoned): the beavers eat the few
  bushes and trees near the water. This is the intended pressure; if it feels too harsh, let bushes regrow faster or
  let the gnawed trunk leave a stump.
- Ponds and the lake budget did not fight: water in each biome stayed within a few percent of where it began while the
  ponds grew (forest 776 pond tiles, water 31% to 31%). Deserts have no colonies at all (no water to dam).
- Colonies near the start: over 24 seeds the nearest colony to the origin is 11 to 222 tiles away (median about 45; 4 of
  24 beyond 120). Raising `COLONY_CHANCE` from 0.6 to 0.85 barely helped, so the limit is water near the start, not the
  dice. Open: guarantee one by placing a first colony at the nearest dam site, or give a start with no water a stream.

Still open:

- Beavers walk in straight lines through trees. Add simple steering round them if it looks wrong once there are more.
- Long runs (2 to 3 hours of play) for the population cap; the stay-home rule for old colonies; the soak area is 64 tiles
  across, so colonies the young found outside it are counted but not simulated.

## Suggested order

B1, then B2 steps 1 and 2 (birth and growing up, which only need the burrow), then B7's soak hook so the numbers
can be watched, then B2 steps 3 to 5, B3, B4, B5. B6 lands whenever sprites do.
