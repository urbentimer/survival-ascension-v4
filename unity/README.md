# Survival Ascension 3D: Unity starter

A first playable 3D version of the game that plays on the SAME server as the browser game (you can even play together:
one on the web, one in Unity). Everything is placeholder shapes for now: capsules for survivors and zombies, boxes for
buildings. The real 3D models come next (Docs/GAME_DESIGN.md has the art checklist).

## What's in here
- `Assets/SurvivalAscension/Scripts`: the game client (connect, show the world, your controls, camera, a simple menu/HUD)
- `Assets/SurvivalAscension/Scripts/Generated`: the server's game state as C# classes (made from server/src/schema.js)
- `Assets/SurvivalAscension/Audio`: all the browser game's sound effects (mp3)
- `Docs`: GAME_DESIGN.md (heroes, skills, zombies, art checklist), PROTOCOL.md (how the client talks to the server), BROWSER_GAME_NOTES.md
- `Reference`: hero art, face cards, Sofea's mecha sheets, the Fallen Dynasty map, effects: for making the 3D models

## Steps
1. **Unity Hub > Installs > Install Editor**: pick the latest **Unity 6 LTS**. Modules: tick **Windows Build Support (IL2CPP)** if offered (and WebGL Build Support if you want a browser version later).
2. **Projects > New project > Universal 3D** (the URP 3D template). Name it `SurvivalAscension3D`, choose a folder, **Create project**.
3. **Install the Colyseus SDK** (the multiplayer library the server uses): *Window > Package Management > Package Manager* (in Unity 6.0 it is just *Window > Package Manager*) > **+** > **Install package from git URL...** and paste
   `https://github.com/colyseus/colyseus-unity-sdk.git?path=Assets/Colyseus#0.16.14`
   (this exact version matches the server). Wait until it finishes.
4. **Copy the starter in**: drag this zip's `Assets/SurvivalAscension` folder into the **Project** window's `Assets` folder (or copy it into `<your project>/Assets/` in File Explorer). Wait for Unity to import and compile: the Console (*Window > General > Console*) should show no red errors.
5. **Set it up**: open `Assets/Scenes/SampleScene`. *GameObject > Create Empty*, rename it `Game`, then in the Inspector **Add Component > Game Bootstrap**.
6. **Press Play** (top middle). Type your name, pick a hero, **Create a room**. The first connect can take up to a minute while the free server wakes up.
7. Press **START** (or Add a bot first). WASD to move, mouse to aim, hold left click to shoot, Space dash, E / Q / R skills.
8. **Play with a friend**: they open the browser game and join your room code, or you join theirs with **Join room**.
9. **Fire VFX**: *Assets > Import Package > Custom Package...* > pick `Vefects_VFX_Free_Fire_URP_Final_01.unitypackage` (you already have it). It works as-is in this URP project.

## If something goes wrong
- *"The type or namespace name 'Colyseus' could not be found"*: step 3 didn't finish. Check Package Manager shows "Colyseus SDK".
- *"InvalidOperationException ... Input System"*: *Edit > Project Settings > Player > Active Input Handling*: set it to **Both**.
- Can't connect: open the browser game once to wake the server, then try again.
- Send any red Console error to Claude: copy the text (click it, the details show below).
