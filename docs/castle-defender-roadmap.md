# Castle Defender — design roadmap

Stage I of the Realm of Ashford campaign is complete and stable. This
document records the agreed design for later stages and kingdoms so
that new units and battlefields can be added one stage at a time
without changing the shape of the engine. Nothing here is built yet
unless the text says so.

The unit catalogue that goes with this document is
`src/components/castleDefender/data/roster.js`.

## Principles

- **Keep Stage I working.** Every addition is opt-in per stage through
  data. The Stage I files (`stages.js` Greenhollow, `enemies.js` entries
  used by it) are not changed by later work except for bug fixes.
- **Units fit their kingdom.** Each kingdom gets the units that suit
  its historical inspiration. No kingdom gets everything. The West
  African kingdom is built with the same depth and dignity as the
  others; no caricature, no generic "tribal" presentation.
- **Traits, not one-off code.** A special unit is an enemy or soldier
  definition plus a list of traits (`def.traits`). The engine reads
  traits in a few well-defined places: movement, blocking, damage,
  auras, and gate contact. Balance numbers live in data.
- **Effects follow traits.** Each trait names its effects (hoof dust,
  drum loop, banner, entrance horn) so the renderer and audio react by
  trait, not by unit name.
- **Screen shake stays rare.** Elephants and siege impacts use a light
  shake; nothing else does.

## Trait rules (engine work for later stages)

| Trait | Movement | Contact | Weakness | Effects |
| --- | --- | --- | --- | --- |
| cavalry | ×2 speed | Charge damage and knockback on the first defender met; breaks free from a block after `blockTime` | ×1.5 damage from spear units and stake barricades | hoof dust, hoof sound, charge trail |
| elephant | ×0.45 speed | Tramples soldiers within `trampleRadius`, 12 gate damage, stuns the nearest tower it passes for 4 s | ×2 from fire, ×1.5 from pierce | footstep dust, light shake, trumpet, large health bar, entrance horn |
| chariot | ×1.7 speed | Attacks while moving; +30 % on `open` segments, −40 % on `narrow` or `rough` | Narrow paths, ballistas | wheel spin, dust, wheel rattle |
| warDog | ×2.4 speed, half health | Slips past a blocker after 1 s | Archers | dust puffs, bark |
| standardBearer | normal | Aura: +15 % armour and +10 % speed to allies within 110 | Marked as a priority target for archer towers | banner cloth, rally shout |
| drummer | normal | Aura: +25 % attack speed within 120 | Priority target | audible drum loop, beat ring |
| scout | ×2.2 speed, half health | Reaching the route marker pulls the next wave's countdown forward by 6 s | Anything | dust, short horn |
| commander | ×4 health, ×2 damage | Aura +10 % armour within 130; mini-boss bar; unique look | Focused fire, hero charge | plume, cape, entrance horn |
| shieldWall | two abreast | While touching a wall-mate: 70 % frontal projectile block and +15 % armour | Catapults, flanking soldiers | shield clatter |
| berserker | normal | Attack speed +50 % below half health; ignores the first stun | Ranged focus before it closes | war cry |
| horseArcher | ×1.8 speed | Shoots while riding past instead of stopping | Barracks placed off the road, ballistas | hoof dust, bow twang |
| siege / siegeTower | slow | Unblockable; soldiers chase; heavy gate damage or gate DPS | Ballista, catapult | creak, wheel spin |
| longship | on water | Lands a raiding party at a marked landing | Towers covering the landing | oars, landing horn |

### Engine hooks to add (in this order)

1. `def.traits` read in `spawnEnemy` to derive speed, health and the
   trait flags. Existing enemies keep working with no traits.
2. Route segments carry terrain tags (`TERRAIN_TAGS`), set from the
   stage layout; `syncEnemyPos` records the current tag on the enemy.
3. Aura pass in `stepGame`: once per step, each aura unit marks allies
   in radius; damage and speed code read the marks.
4. Contact rules in `stepFighter` / `stepEnemy`: charge on first
   engagement, trample, slip-past timers.
5. Tower stun (`t.stunT`) read by `stepTower`.
6. Priority targeting: `towerTarget` prefers `priorityTarget` enemies
   in range before falling back to the furthest one.

Each hook ships with node tests in `test/castle-engine.mjs` and the
Stage I scripted run must still finish with the same result.

## Stage plan for the Realm of Ashford

- **Stage II, Stonebridge Ford.** Introduces cavalry (mounted scouts,
  enemy knights, war dogs), crossbowmen and standard bearers. Two roads
  from the start, the bridge as a choke point, a ford that opens on
  wave 4. Ends with twin rams. Player unlock: the mounted knight rally
  for barracks level 4.
- **Stage III, The Siege of Ashford.** Introduces the siege tower and a
  siege camp at each entrance, dusk lighting, three roads, a siege gate
  ahead of the castle. Boss: Warlord Blackmoor and the Ironbreaker in
  three phases (horn that summons bandits, ram charge that Royal Charge
  can break, unhorsed melee with a ground smash). Player unlock: Sir
  Edric mounted.

## Kingdom plan

| Kingdom | Signature units | Battlefield |
| --- | --- | --- |
| Legion of the Frontier (Roman) | legion shield walls, auxiliary cavalry, mounted officer, signifer, ballista crew; arena chariot in one fantasy-flavoured mission | Mediterranean coast, stone forts, olive hills |
| Jarldom of the Fjords (Viking) | shield wall warriors, axe warriors, berserker commander, banner carrier, longship landings, mounted scouts | snowy coast, palisades, pine forest |
| Domain of the Mountain (Samurai) | samurai, mounted samurai, horse archers, yari cavalry, bow formations, banner units, elite swordsman | mountain passes, blossom groves, wooden fortress |
| Kingdom of the Two Rivers (Egyptian) | spearmen, archers, war chariots on open sand, camel riders, desert cavalry, elite guard, siege ram | desert, river valley, sandstone walls |
| Kingdom of the Golden Stool (West African) | royal guards, spear units, archers, shield units, royal horsemen, drummers, standard bearers, elite commander; a war elephant in selected fantasy-flavoured missions | savanna, forest edge, fortified city with woven-pattern banners |

## Battlefield features

Rivers, bridges, fords, castle walls with health, siege gates,
destructible barricades built on plots, hills that extend tower range,
open farmland for cavalry, deserts, snowy coasts, mountain passes,
villages with temporary reinforcements, and siege camps that spawn
formations. Each feature is a layout entry (`BATTLEFIELD_FEATURES`),
so a stage declares what it uses and the terrain painter and engine
respond.
