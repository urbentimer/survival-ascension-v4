# Survival Ascension — Final Prototype Release

An 8-player online co-op zombie survival RPG built with an HTML5 Canvas client and a Node.js / Colyseus authoritative server.

## Included gameplay
- Private 8-player rooms and host-controlled wave progression.
- 50-wave campaign framework; standard waves run for 90 seconds; boss encounter every fourth wave and final boss at Wave 50.
- Five normal enemy types: Walker, Runner, Brute, Spitter and Mutant.
- Thirteen named boss encounters with escalating health/damage and boss health bars.
- Radio tower health objective and team defeat condition.
- Scrap, Electronics, Explosives and Fuel resources; kill drops and boss rewards.
- Repair and refuel actions for tower and generator.
- Barricades, turrets, mines, electric fences and flame traps.
- Day/night cycle, increased night enemy aggression and a minimap.
- Eight selectable classes with different base stats and active class abilities.
- Weapon choices: pistol, shotgun, rifle, SMG, sniper rifle and launcher; weapon loot drops with rarity tiers.
- Melee choices: knife, baseball bat, fire axe and katana.
- Ammo, medkit, scrap and currency pickups.
- Five-second hold-to-revive behavior with a 30-second bleed-out timer.
- Live kill leaderboard, end-of-match statistics, achievement callouts and the crown above the kill leader.
- Browser-local profile persistence for progression basics on the same browser/device.
- Original synthesized ambient drone audio toggle.
- Collapsible HOW TO PLAY guide.

## Important implementation notes
This is the final integrated playable prototype package for the current codebase, not a fully content-complete commercial game. Bosses have distinct names and scaling, but do not yet each have bespoke animation/telegraph/weak-point attack scripts. Character skill trees, cross-device account persistence, full equipment affix systems, detailed interior maps, voice lines, polished original soundtrack assets, headshot detection and full animation sets remain future content work. The headshot statistic is reserved but not currently populated because the prototype uses nearest-target automatic fire rather than directional hit detection.

Profiles are stored in the browser's local storage and passed to the server on joining. They persist on the same browser/device but are not a secure cloud account system and do not automatically sync between devices.

## Deploying
### Server (Render)
- Push the extracted `survival-ascension-coop` folder to your GitHub repository.
- Set Render Root Directory to `server`.
- Build command: `npm install`
- Start command: `npm start`
- Keep the existing public Render service URL / environment settings if they already work.

### Client (Netlify)
- Deploy the contents of the `client` folder (not the outer project folder) so `index.html` is at the publish root.
- Configure the client to use your existing server endpoint if required by your deployment. The client defaults to same-origin WebSocket unless a `?server=wss://YOUR-RENDER-HOST` query parameter is supplied.

## Recommended smoke test
1. Start a room and join from a second browser/device.
2. Select different survivor classes before starting.
3. Test movement, automatic firing, weapon switching, melee and class abilities.
4. Test revive: one player goes down, the other holds position nearby while revive progresses for five seconds.
5. Check tower damage and repair; generator refuel/repair; build every structure.
6. Pick up loot and test day/night and the minimap.
7. Complete a normal wave and a boss wave; test host progression.
8. Confirm the kill leaderboard, crown transfer and final match scoreboard.
9. Test the deployed server and client together before replacing the previously working public build.

Back up the currently deployed project before replacing it.

## Visual overhaul
The client now uses a tactical post-apocalyptic visual theme with charcoal metal panels, hazard-orange accents, updated HUD cards and bars, cinematic overlays, and a darker industrial battlefield palette. This is a client-side reskin; the Colyseus multiplayer protocol and server gameplay logic are unchanged.

## Pixel-art battlefield update
The Canvas battlefield renderer now uses hand-drawn pixel-art scenery and sprites: ruined city blocks, lit windows, asphalt road markings, sandbag defenses, a radio mast, detailed pixel survivors, distinct infected silhouettes by enemy type, boss accents, tactical structures, and a pixel-style minimap. This is a client-side rendering change; the Colyseus multiplayer server and gameplay state schema are unchanged.
