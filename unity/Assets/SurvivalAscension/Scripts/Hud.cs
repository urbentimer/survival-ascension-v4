// A quick on-screen menu + HUD (Unity's simple OnGUI), so you can play straight away. Replace with a proper UI later.
using UnityEngine;

namespace SurvivalAscension
{
    public class Hud : MonoBehaviour
    {
        public static bool Typing;   // true while a text box has focus (so WASD doesn't move you)
        string playerName = "Survivor", code = "";
        int hero;
        bool busy;
        float nextAck;

        void OnGUI()
        {
            var net = Net.I; var room = net.Room; var s = room?.State;
            GUI.skin.label.fontSize = 16; GUI.skin.button.fontSize = 16; GUI.skin.textField.fontSize = 16;
            Typing = GUIUtility.keyboardControl != 0;
            if (room == null) { Menu(net); return; }
            if (s == null) return;
            var me = net.Me;
            GUILayout.BeginArea(new Rect(12, 12, 460, 420), GUI.skin.box);
            GUILayout.Label($"Room code: {room.RoomId}   ·   {s.phase.ToUpper()}   ·   Wave {s.stage}");
            GUILayout.Label($"Radio tower: {Mathf.CeilToInt(s.towerHp)} / {Mathf.CeilToInt(s.towerMaxHp)}   ·   Zombies: {s.zombies.Count}");
            if (me != null) GUILayout.Label($"{me.name} ({me.characterClass})   HP {Mathf.CeilToInt(me.hp)}/{Mathf.CeilToInt(me.maxHp)}   {me.weapon} {me.mag}/{me.ammo}   kills {me.kills}");
            if (!string.IsNullOrEmpty(s.message)) GUILayout.Label(s.message);
            if (s.phase == "lobby")
            {
                if (net.IsHost) { if (GUILayout.Button("START")) net.Send("start", new System.Collections.Generic.Dictionary<string, object>()); if (GUILayout.Button("Add a bot")) net.Send("addBot"); }
                else if (GUILayout.Button(me != null && me.ready ? "Ready ✓ (click to cancel)" : "I'm ready")) net.Send("ready");
            }
            if (s.phase == "cleared" && net.IsHost && GUILayout.Button("Next wave")) net.Send("nextStage");
            if ((s.phase == "defeat" || s.phase == "victory") && net.IsHost && GUILayout.Button("Play again")) net.Send("restart");
            if (s.bossPhase == "intro" && Time.time > nextAck) { nextAck = Time.time + 1; net.Send("ackBoss"); }   // boss intro: carry straight on
            GUILayout.Label("WASD move · mouse aim · hold click attack · Space dash · E skill · Q ultimate · R 3rd skill · 1-4 slots · C reload");
            GUILayout.EndArea();
        }

        void Menu(Net net)
        {
            GUILayout.BeginArea(new Rect(Screen.width / 2 - 220, Screen.height / 2 - 200, 440, 400), GUI.skin.box);
            GUILayout.Label("SURVIVAL ASCENSION 3D (prototype)");
            GUILayout.Label("Your name"); playerName = GUILayout.TextField(playerName, 16);
            GUILayout.Label("Hero"); hero = GUILayout.SelectionGrid(hero, SA.HeroNames, 4);
            GUI.enabled = !busy;
            if (GUILayout.Button("Create a room")) Go(() => net.CreateRoom(playerName, SA.Heroes[hero]));
            GUILayout.Label("…or join a friend's room (works with browser players too)");
            code = GUILayout.TextField(code, 20);
            if (GUILayout.Button("Join room") && code.Trim().Length > 0) Go(() => net.JoinRoom(code, playerName, SA.Heroes[hero]));
            GUI.enabled = true;
            GUILayout.Label(net.Status);
            GUILayout.EndArea();
        }

        async void Go(System.Func<System.Threading.Tasks.Task> f) { busy = true; GUIUtility.keyboardControl = 0; try { await f(); } finally { busy = false; } }
    }
}
