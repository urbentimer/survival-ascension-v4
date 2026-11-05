// Connects to the Survival Ascension server (the same rooms as the browser game: friends on the web and in Unity can play together).
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Colyseus;
using UnityEngine;

namespace SurvivalAscension
{
    public class Net : MonoBehaviour
    {
        public static Net I;
        public ColyseusRoom<GameState> Room;
        public string Status = "Not connected";
        public event Action<ColyseusRoom<GameState>> Joined;
        ColyseusClient client;

        // effect messages the server sends (dash trails, explosions, heals...). Not drawn yet: listed so the SDK doesn't warn.
        static readonly string[] Broadcasts = { "arshan", "astra", "boom", "bossDead", "briggs", "chop", "clang", "dash", "deflect", "frag", "demo", "heal",
            "hive", "hooked", "katanaTier", "laser", "roar", "rush", "shadow", "shot", "sky", "slam", "sofea", "spit", "summon", "swing", "whip", "wreck", "zdead" };
        public event Action<string, object> Effect;   // (type, message) for when you add effects

        void Awake() { I = this; }

        Dictionary<string, object> Options(string name, string hero) => new Dictionary<string, object> {
            { "name", name },
            { "profile", new Dictionary<string, object> { { "characterClass", hero } } },
        };

        public async Task CreateRoom(string name, string hero) => await Connect(() => client.Create<GameState>(SA.RoomName, Options(name, hero)), "Creating room...");
        public async Task JoinRoom(string code, string name, string hero) => await Connect(() => client.JoinById<GameState>(code.Trim(), Options(name, hero)), "Joining...");

        async Task Connect(Func<Task<ColyseusRoom<GameState>>> join, string label)
        {
            if (client == null) client = new ColyseusClient(SA.Server);
            // the free Render server sleeps after ~15 min idle and can take up to a minute to wake: keep trying for ~90s
            for (int attempt = 1; attempt <= 9; attempt++)
            {
                try
                {
                    Status = attempt == 1 ? label : $"{label} (waking the server up, try {attempt}/9)";
                    Room = await join();
                    break;
                }
                catch (Exception e)
                {
                    Debug.LogWarning("Connect failed: " + e.Message);
                    if (e.Message.Contains("not found") || e.Message.Contains("full")) { Status = e.Message; return; }   // wrong room code / full
                    if (attempt == 9) { Status = "Could not connect: " + e.Message; return; }
                    await Task.Delay(10000);
                }
            }
            Status = "Connected";
            foreach (var t in Broadcasts) { var type = t; Room.OnMessage<object>(type, m => Effect?.Invoke(type, m)); }
            Room.OnLeave += code => { Status = "Disconnected (" + code + ")"; Room = null; };
            Room.OnError += (code, msg) => Debug.LogError($"Room error {code}: {msg}");
            Joined?.Invoke(Room);
        }

        public void Send(string type, object msg = null)
        {
            if (Room == null) return;
            if (msg == null) _ = Room.Send(type); else _ = Room.Send(type, msg);
        }

        public PlayerState Me => Room?.State?.players != null && Room.SessionId != null ? Room.State.players[Room.SessionId] : null;
        public bool IsHost => Room?.State != null && Room.State.hostId == Room.SessionId;

        async void OnApplicationQuit() { if (Room != null) await Room.Leave(); }
    }
}
