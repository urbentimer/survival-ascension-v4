# Server protocol (what the Unity client sends and receives)

Server: `wss://survival-ascension-sg.onrender.com`, room name `survival` (Colyseus 0.16). The Unity client and the browser
client use the SAME rooms: a Unity player can join a browser player's room code and the other way round.

## Coordinates
The server is 2D: pixels, x to the right, y DOWN. Angles are radians, `atan2(dy, dx)` in those pixels (0 = right, +PI/2 = down).
Unity: `x = px / 30`, `z = -py / 30` (see `SA.ToWorld`). `SA.ServerAngle` converts a Unity direction to a server angle.

## Joining
`client.Create<GameState>("survival", { name, profile: { characterClass } })` or `client.JoinById<GameState>(roomCode, same options)`.
characterClass: assault (Marcus), juggernaut (Briggs), operator (Sofea), engineer (Viktor), scout (Raven), demolitionist (Dante), sniper (Sienna), dispatcher (Astra).

## Client -> server (the ones the starter uses)
| Message | Data | What |
|---|---|---|
| input | dx, dy (-1..1), s (sequence number), dt (ms) | movement, every ~50ms; in Sofea's vehicles also a (aim) and f (1 = holding fire) |
| attack | a (aim), d (distance to the mouse) | left click: whatever is in your hand |
| dash | dx, dy, s | Space |
| ability | a, d | E |
| ult | a | Q (unlocks at 100 kills) |
| skill2 | - | R (Astra's safehouse, Sofea's mecha) |
| mechaSlash | a | right click in Sofea's mecha |
| slot | n (1 melee, 2 primary, 3 secondary, 5 medkit) | 1-4 keys |
| reload | - | C |
| start | {} | host: start the match |
| ready | - | non-host: toggle ready |
| addBot | - | host: add an AI teammate |
| nextStage | - | host: next wave (after "cleared") |
| ackBoss | - | after the boss intro |
| restart | - | host: play again |

Others (shop, building, revive, settings...): see `this.onMessage(` in server/src/SurvivalRoom.js.

## Server -> client
- **State** (synced automatically, classes in Scripts/Generated): players, zombies, structures, loot, puddles, robots, vehicles + phase
  (lobby / playing / cleared / defeat / victory), stage (wave), towerHp, isNight, worldW/H, towerX/Y, mapLayout, message...
- **Effect messages** (Net.Effect event): shot, boom, dash, heal, swing, zdead, chop, slam, spit, sofea, astra, briggs, demo, sky,
  shadow, hive, laser, summon, wreck... Each tells you where to play an effect / sound.

## Regenerating the C# state classes (if the server's schema.js changes)
From the server folder: `npx schema-codegen src/schema.js --csharp --namespace SurvivalAscension --output <unity>/Assets/SurvivalAscension/Scripts/Generated`
