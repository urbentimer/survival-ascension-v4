# SURVIVAL ASCENSION — REDESIGN BLUEPRINT

This document records the agreed redesign requirements. It is a design specification, not a claim that every listed system is already implemented.

## 1. Core game
- 8-player online co-op zombie survival RPG.
- Top-down camera and pixel-art presentation.
- Abandoned-city setting with cracked roads, wrecked cars and buses, ruined buildings and accessible interiors, burnt shops, pharmacies, apartments, military vehicles, overgrowth, debris, barricades, blood trails, fog and atmospheric lighting.
- Districts: Downtown, Residential, Commercial, Military Checkpoint and City Hospital.
- Preserve the existing Colyseus multiplayer architecture and private-room flow.

## 2. Campaign and waves
- 50 waves total.
- Standard waves last 90 seconds.
- Boss encounter every fourth wave (4, 8, 12 ... 48), plus a final boss on wave 50.
- Difficulty scales progressively through enemy numbers, health, damage, speed and enemy combinations.
- Boss encounters should be objective-driven and tactical, with telegraphed attacks, weak points, counters, vulnerability windows and enrage phases.
- Bosses should not be removed by the normal-wave timer; the intended design is to complete the boss encounter by defeating the boss.

## 3. Zombie roster
Five core enemy types, visually and mechanically distinct:
- Walker — slow, common horde enemy.
- Runner — fast, fragile pursuer.
- Brute — high-health heavy enemy with slam/knockback.
- Spitter — ranged acid attacker that leaves hazardous pools.
- Mutant — unpredictable lunges and frenzy behavior.

Suggested introduction: Walkers W1–3, Runners W5–7, Brutes W9–11, Spitters W13–15, Mutants W17–19; all types can mix from W21 onward. Optional Normal, Armored, Enraged and Elite variants are proposed for later balancing.

## 4. Boss roster
- W4 The Butcher — cleaver, charge and ground slam; bait into obstacles and attack exposed back.
- W8 Plague Brute — toxic clouds and pools; attack infection sacs.
- W12 Screamer — sonic scream and summons; interrupt and use cover.
- W16 Abomination — regeneration and extra limbs; destroy organs.
- W20 Devourer — pull/swallow attacks; use cover and interrupt.
- W24 Stalker — vanishes/teleports and strikes rapidly; follow shadow indicators.
- W28 Bone Crusher — armored hammer and shockwaves; target joints/back.
- W32 Hive Mother — spawns infected and nests; destroy nests/abdomen.
- W36 Executioner — marks a player for a dangerous attack; dodge the marked strike.
- W40 Colossus — stomps and throws vehicles; bait attacks and hit weak points.
- W44 Reaper — life drain and shadow zones; interrupt drain and destroy anchors.
- W48 Undead King — commands elites and uses a shield; eliminate guards.
- W50 Apocalypse — multi-phase final boss requiring coordinated weak-point attacks.

## 5. Survivors and classes
Eight distinct selectable survivors:
- Marcus — Assault; Adrenaline Rush; bonus damage against full-health enemies.
- Briggs — Juggernaut; Iron Wall; damage reduction.
- Elena — Medic; Emergency Field; faster revives.
- Viktor — Engineer; Auto Turret; improved deployables and engineering.
- Raven — Scout; Shadow Dash; speed and evasion.
- Dante — Demolitionist; Cluster Bomb; explosive specialization.
- Sienna — Sniper; Deadeye; weak-point highlighting and precision damage.
- Hayes — Commander; Rally Signal; team damage-resistance support.

Each survivor should have distinct appearance, personality, stats, active skill, passive, ultimate, animations, portrait, pixel sprite and voice lines. Character selection occurs in the lobby. Duplicate-pick restriction is a proposed option, not yet finalized.

## 6. Progression and profiles
- Both permanent character progression and weapon/equipment progression.
- Independent character XP and levels, skill trees, passive bonuses and unlocks.
- Character-specific progression and milestone rewards.
- Persistent profiles should retain levels, XP, unlocked characters, inventory, currency, upgrades, highest wave, statistics and achievements between sessions.

## 7. Weapons, loot and equipment
- Weapon categories: pistols, shotguns, assault rifles, sniper rifles, SMGs and special weapons (e.g. flamethrowers, launchers and experimental weapons).
- Rarity tiers: Common, Uncommon, Rare, Epic, Legendary and Mythic.
- Loot can include ammunition, healing, upgrade materials, gold and rare equipment.
- Bosses should guarantee a special reward, with a chance of higher rarity.
- Proposed equipment slots: primary firearm, secondary firearm, melee, helmet, body armor and two accessories.
- Weapon upgrades: magazine, reload, damage, critical chance, recoil and elemental effects.
- Proposed wave rarity curve: W1–10 Common/Uncommon; W11–20 Uncommon/Rare; W21–30 Rare/Epic; W31–40 Epic/Legendary; W41–49 Legendary/Mythic; W50 exclusive reward.
- Carry capacity, loot distribution and ammunition rules remain to be finalized.

## 8. Melee weapons
- Every player starts with a basic melee weapon and can discover stronger replacements.
- Weapon examples: baseball bat, fire axe, katana, sledgehammer, machete and combat knife.
- Planned mechanics: combos, heavy attacks, stagger, finishers, durability/repair and upgrades.
- Possible special effects: fire, electrical stun, poison, lifesteal and armor breaking.
- Melee occupies a weapon slot and can be swapped for a discovered weapon.

## 9. Downed and revive
- At zero HP, a player becomes downed and cannot move or attack.
- Teammates receive a notification and can approach to revive.
- Proposed revive: hold interaction for 5 seconds; incoming damage interrupts; successful revive restores 30% HP.
- Proposed bleed-out timer: 30 seconds, shortened by 5 seconds for each subsequent down in the same wave, to a 10-second minimum.
- If every player is down, the team wipes and the match ends.
- Exact timing and HP values are tuning proposals.

## 10. Radio tower objective
- Protect a radio tower station with a visible health bar.
- If tower HP reaches zero, the team loses.
- Proposed starting tower HP: 10,000 (balance value to test).
- Zombies and bosses attack the tower.
- Players can repair the tower during active waves, not only between waves.
- Scrap Metal is the proposed repair resource. Initial repair examples: 10 scrap/250 HP, 25/750 HP, 50/1,750 HP.
- Repairing requires the player to remain stationary while holding the action; damage interrupts. Engineer gets a repair bonus.
- Tower warning at 25% health.
- Win condition: survive all 50 waves and defeat the final boss while the tower remains operational.

## 11. Base building and defenses
- Shared team construction limits.
- Structures: wooden barricades, automated turrets, landmines, electric fences, military sandbags and flame traps.
- Resources: Scrap Metal, Electronics, Explosives and Fuel.
- Viktor/Engineer gets build and repair bonuses, stronger turrets and access to advanced blueprints.
- Proposed shared limits: 20 barricades, 6 turrets, 12 mines, 8 fences, 12 sandbags and 4 flame traps. These are balance proposals.
- Shared resources and structure capacity are visible to the team; destroyed structures free their slot; structures can be upgraded.

## 12. Generators and electricity
- Generators require fuel and maintenance/repair resources.
- Generators can power streetlights, electric fences, turrets, radio tower communications/emergency systems and floodlights.
- Generator failure from low fuel or damage disables connected systems.
- Resources include Fuel, Scrap, Electronics and Batteries.
- Viktor's proposed Electrical Engineering passive improves repair speed, reduces fuel use and unlocks advanced generator upgrades.

## 13. Day and night
- Dynamic day/night cycle.
- Day: better visibility, standard enemy strength and safer scavenging/preparation.
- Night: reduced visibility, more aggressive zombies and a chance of special enemies.
- Proposed night modifiers: zombie health +25%, damage +30%, movement +20%, detection +30%.
- Enemy-specific night behaviors and additional boss attack patterns are planned.
- Exact cycle duration and modifiers require playtesting.

## 14. Scoreboard and kill-leader crown
- Live leaderboard during the match, toggled with TAB.
- End-of-match scoreboard after victory or defeat.
- Rank players by zombie kills and show team total kills.
- Track kills, boss damage, tower repairs, revives, damage dealt/taken, structures built and headshots.
- Match awards: Zombie Slayer, Boss Hunter, Guardian, Lifesaver, Master Engineer and Sharpshooter.
- The player currently holding the most kills wears a visible golden crown above their in-game character. It is visible to all players and transfers automatically when another player takes the lead.
- Tie rule: crown remains with the player who first reached the tied kill count; a new kill by another player transfers it.
- Scoreboard and crown are the first redesign features added to the current prototype in this package. Other listed systems remain blueprint requirements.

## 15. HUD, map and objective tracker
- HUD shows tower HP, current wave/50, timer, zombies remaining, day/night, generator status, team status and boss HP during boss fights.
- Alerts for tower at 25%, generator destroyed/out of fuel, teammate down and other critical objectives.
- Objective markers, construction capacity/resources and a minimap showing zombies, teammates and structures.
- Optional customizable/movable/resizable/hideable HUD panels; critical warnings remain visible.

## 16. Guide and controls
- Main-menu HOW TO PLAY area with collapsible sections: Main Objective; Waves & Difficulty; Survivors & Classes; Combat & Weapons; Downed & Revive; Build & Defend; Generators & Electricity; Day & Night; Character Progression.
- Existing prototype controls to verify during implementation: WASD/arrow keys move, mouse aims, firing is automatic, Space dash, E revive, P pause.
- Controls must be displayed accurately after they are finalized.

## 17. Audio
- Original ominous ambient soundtrack: deep drones, distant metallic sounds, horror strings, radio static and suspense percussion.
- Dynamic music states: day, night, horde, boss, tower critical, W50, victory and defeat.
- Music and SFX volume sliders, mute and seamless looping/transitions.
- Use original or properly licensed audio assets.

## Implementation notes
- Preserve the working 8-player online room flow and server-authoritative gameplay.
- Implement in safe stages, testing multiplayer after each stage.
- Do not treat proposed numbers or unconfirmed choices as final balance decisions.
- This blueprint is not a completed implementation of every system. The current codebase is an early prototype; a full redesign requires substantial new gameplay, UI, server-state and persistence work.


## Implementation progress — prototype build
The latest prototype package now includes an initial implementation of:
- 50-wave progression with 90-second standard waves and boss encounters every fourth wave, plus the Wave 50 final boss.
- Five zombie archetypes in the spawn progression, including Mutants.
- Radio tower health and loss condition.
- Scrap/electronics/explosives/fuel resource counters and boss/kill resource drops.
- Tower repairs, generator repairs and refuelling.
- Generator-powered turret, electric fence and flame-trap effects; deployable mines and barricades are available as build placements.
- A basic day/night cycle with stronger/faster night spawns.
- HUD readouts for tower, generator, resources and day/night, plus a collapsible HOW TO PLAY guide.

Still planned for subsequent implementation passes: full unique boss attack patterns and weak-point mechanics; proper barricade pathing and structure damage; class selection and eight survivor abilities; permanent account/profile persistence; weapon inventory, rarity, loot and melee systems; full revive timer/downed bleed-out; minimap and richer city map/interiors; dynamic original music; detailed final awards/statistics. The existing live multiplayer connection and room flow are retained, but this package needs fresh multiplayer playtesting before deployment.


## Final prototype package status
The integrated final prototype package additionally includes class selection and active class abilities, selectable firearms and melee weapons, rarity-labelled weapon drops, ammo/medkit/resource pickups, a timed revive/bleed-out loop, browser-local progression persistence, a minimap, match award callouts and a synthesized ambient audio toggle. See README.md for what is implemented and the remaining content/polish limitations.
