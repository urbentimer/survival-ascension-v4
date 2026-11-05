// Shows the server's world in 3D with simple placeholder shapes (capsules = survivors / zombies, boxes = buildings).
// Swap the placeholders for real 3D models later: see MakeSurvivor / MakeZombie below.
using System.Collections.Generic;
using Colyseus;
using Colyseus.Schema;
using UnityEngine;

namespace SurvivalAscension
{
    public class WorldView : MonoBehaviour
    {
        class View { public GameObject go; public Transform gun; public TextMesh label; }
        readonly Dictionary<string, (PlayerState s, View v)> players = new Dictionary<string, (PlayerState, View)>();
        readonly Dictionary<string, (ZombieState s, View v)> zombies = new Dictionary<string, (ZombieState, View)>();
        readonly Dictionary<string, (RobotState s, View v)> robots = new Dictionary<string, (RobotState, View)>();
        readonly Dictionary<string, (StructureState s, View v)> structures = new Dictionary<string, (StructureState, View)>();
        readonly Dictionary<string, (LootState s, View v)> loot = new Dictionary<string, (LootState, View)>();
        Transform mapRoot, ground, tower, generator;
        string builtLayout = null;
        public Transform MyAvatar;

        void Start() { Net.I.Joined += OnJoined; }

        void OnJoined(ColyseusRoom<GameState> room)
        {
            var cb = Callbacks.Get(room);   // keep ONE callbacks object per room
            cb.OnAdd(s => s.players, (k, p) => players[k] = (p, MakeSurvivor(p)));
            cb.OnRemove(s => s.players, (k, p) => Drop(players, k));
            cb.OnAdd(s => s.zombies, (k, z) => zombies[k] = (z, MakeZombie(z)));
            cb.OnRemove(s => s.zombies, (k, z) => Drop(zombies, k));
            cb.OnAdd(s => s.robots, (k, r) => robots[k] = (r, MakeSimple(Color.cyan, .5f, 1.2f, r.x, r.y)));
            cb.OnRemove(s => s.robots, (k, r) => Drop(robots, k));
            cb.OnAdd(s => s.structures, (k, st) => structures[k] = (st, MakeSimple(new Color(.6f, .45f, .25f), 1.2f, 1f, st.x, st.y, PrimitiveType.Cube)));
            cb.OnRemove(s => s.structures, (k, st) => Drop(structures, k));
            cb.OnAdd(s => s.loot, (k, l) => loot[k] = (l, MakeSimple(Color.yellow, .4f, .4f, l.x, l.y, PrimitiveType.Cube)));
            cb.OnRemove(s => s.loot, (k, l) => Drop(loot, k));
        }

        static void Drop<T>(Dictionary<string, (T, View)> d, string k) { if (d.TryGetValue(k, out var e)) { Destroy(e.Item2.go); d.Remove(k); } }

        View MakeSurvivor(PlayerState p)
        {
            var root = new GameObject("Survivor " + p.name);
            var body = SA.Prim(PrimitiveType.Capsule, SA.Hex(p.color, new Color(.4f, .8f, .8f)), root.transform, "Body");
            body.transform.localPosition = new Vector3(0, 1f, 0); body.transform.localScale = new Vector3(.8f, 1f, .8f);
            var gun = SA.Prim(PrimitiveType.Cube, Color.black, root.transform, "Gun");
            gun.transform.localPosition = new Vector3(0, 1.2f, .55f); gun.transform.localScale = new Vector3(.12f, .12f, .7f);
            var label = Label(root.transform, p.name, 2.6f);
            root.transform.position = SA.ToWorld(p.x, p.y);
            if (Net.I.Room != null && p.sessionId == Net.I.Room.SessionId) MyAvatar = root.transform;
            return new View { go = root, gun = gun.transform, label = label };
        }

        View MakeZombie(ZombieState z)
        {
            var root = new GameObject("Zombie " + z.kind);
            float s = Mathf.Max(.6f, z.radius / 14f) * (z.boss ? 1.2f : 1f);
            var c = z.boss ? new Color(.7f, .1f, .1f) : z.kind == "brute" ? new Color(.35f, .5f, .2f) : z.kind == "runner" ? new Color(.6f, .7f, .3f) : new Color(.45f, .6f, .35f);
            var body = SA.Prim(PrimitiveType.Capsule, c, root.transform, "Body");
            body.transform.localPosition = new Vector3(0, s, 0); body.transform.localScale = new Vector3(.8f * s, s, .8f * s);
            root.transform.position = SA.ToWorld(z.x, z.y);
            return new View { go = root, label = z.boss ? Label(root.transform, z.kind.ToUpper(), 2.6f * s) : null };
        }

        View MakeSimple(Color c, float size, float height, float x, float y, PrimitiveType t = PrimitiveType.Cylinder)
        {
            var g = SA.Prim(t, c); g.transform.localScale = new Vector3(size, height / 2f, size);
            g.transform.position = SA.ToWorld(x, y, height / 2f);
            return new View { go = g };
        }

        static TextMesh Label(Transform parent, string text, float h)
        {
            var g = new GameObject("Label"); g.transform.SetParent(parent, false); g.transform.localPosition = new Vector3(0, h, 0);
            var t = g.AddComponent<TextMesh>(); t.text = text; t.characterSize = .12f; t.fontSize = 48; t.anchor = TextAnchor.MiddleCenter; t.color = Color.white;
            return t;
        }

        void Update()
        {
            var room = Net.I.Room; if (room?.State == null) return;
            BuildMap(room.State);
            float k = 1f - Mathf.Exp(-15f * Time.deltaTime);   // smooth toward the server position (it updates 20 times a second)
            foreach (var e in players.Values)
            {
                var p = e.s; var v = e.v;
                v.go.transform.position = Vector3.Lerp(v.go.transform.position, SA.ToWorld(p.x, p.y), k);
                v.go.transform.rotation = Quaternion.Slerp(v.go.transform.rotation, Quaternion.Euler(0, SA.AngleToYaw(p.aim), 0), k);
                v.go.transform.localScale = p.alive ? Vector3.one : new Vector3(1, .3f, 1);   // downed: lying on the ground
                if (v.label) { v.label.text = $"{p.name}  {Mathf.CeilToInt(p.hp)}/{Mathf.CeilToInt(p.maxHp)}"; Face(v.label.transform); }
            }
            foreach (var e in zombies.Values)
            {
                var z = e.s; var v = e.v;
                var to = SA.ToWorld(z.x, z.y); var d = to - v.go.transform.position; d.y = 0;
                if (d.sqrMagnitude > .0004f) v.go.transform.rotation = Quaternion.Slerp(v.go.transform.rotation, Quaternion.LookRotation(d), k);
                v.go.transform.position = Vector3.Lerp(v.go.transform.position, to, k);
                if (v.label) { v.label.text = $"{z.kind.ToUpper()}  {Mathf.CeilToInt(z.hp)}"; Face(v.label.transform); }
            }
            foreach (var e in robots.Values) { var r = e.s; var v = e.v; v.go.transform.position = Vector3.Lerp(v.go.transform.position, SA.ToWorld(r.x, r.y, .6f), k); }
            foreach (var e in loot.Values) { var l = e.s; var v = e.v; v.go.transform.Rotate(0, 90 * Time.deltaTime, 0); }
        }

        static void Face(Transform t) { if (Camera.main) t.rotation = Camera.main.transform.rotation; }

        // ground, radio tower, generator and the city's solid pieces (same layout + sizes as server/src/mapLayout.js)
        static readonly string[] Kinds = { "car", "burntCar", "bus", "police", "building", "ruin", "streetlight", "dumpster", "blood", "manhole", "rubble", "tree" };
        static readonly Dictionary<string, float[]> Solid = new Dictionary<string, float[]> {   // ox, oy, hw, hh (px), height (m)
            { "building", new[] { 0f, -60, 76, 52, 6 } }, { "ruin", new[] { 0f, -36, 64, 28, 2.5f } }, { "car", new[] { 0f, -44, 40, 30, 1.4f } },
            { "burntCar", new[] { 2f, -40, 40, 26, 1.2f } }, { "police", new[] { 4f, -42, 44, 28, 1.5f } }, { "bus", new[] { 0f, -56, 62, 40, 3f } },
            { "dumpster", new[] { 0f, -24, 34, 16, 1.4f } }, { "rubble", new[] { 0f, -22, 32, 14, .6f } }, { "tree", new[] { -2f, -12, 13, 9, 4f } },
            { "streetlight", new[] { -18f, -14, 8, 7, 4.5f } } };

        void BuildMap(GameState s)
        {
            if (s.mapLayout == builtLayout || s.worldW <= 0) return;
            builtLayout = s.mapLayout;
            if (mapRoot) Destroy(mapRoot.gameObject);
            mapRoot = new GameObject("Map").transform;
            var g = SA.Prim(PrimitiveType.Cube, new Color(.16f, .18f, .17f), mapRoot, "Ground");
            g.transform.localScale = new Vector3(s.worldW / SA.PX, .1f, s.worldH / SA.PX);
            g.transform.position = SA.ToWorld(s.worldW / 2, s.worldH / 2, -.05f);
            float tx = s.towerX > 0 ? s.towerX : s.worldW / 2, ty = s.towerY > 0 ? s.towerY : s.worldH / 2;
            var t = SA.Prim(PrimitiveType.Cube, new Color(.55f, .15f, .12f), mapRoot, "Radio Tower");
            t.transform.localScale = new Vector3(68 / SA.PX, 8, 68 / SA.PX); t.transform.position = SA.ToWorld(tx, ty, 4);
            var gen = SA.Prim(PrimitiveType.Cube, new Color(.9f, .7f, .1f), mapRoot, "Generator");
            gen.transform.localScale = new Vector3(40 / SA.PX, 1.2f, 40 / SA.PX); gen.transform.position = SA.ToWorld(tx + 118, ty + 6, .6f);
            if (string.IsNullOrEmpty(s.mapLayout) || s.mapLayout.StartsWith("P:")) return;   // painted maps (Fallen Dynasty): no pieces yet
            foreach (var piece in s.mapLayout.Split(';'))
            {
                var f = piece.Split(','); if (f.Length < 4) continue;
                int ki = int.Parse(f[0]); if (ki < 0 || ki >= Kinds.Length || !Solid.TryGetValue(Kinds[ki], out var b)) continue;
                float x = float.Parse(f[1], System.Globalization.CultureInfo.InvariantCulture), y = float.Parse(f[2], System.Globalization.CultureInfo.InvariantCulture);
                bool flip = f[3] == "1";
                var c = Kinds[ki] == "tree" ? new Color(.2f, .4f, .18f) : Kinds[ki] == "building" ? new Color(.35f, .33f, .32f) : new Color(.3f, .3f, .32f);
                var box = SA.Prim(PrimitiveType.Cube, c, mapRoot, Kinds[ki]);
                box.transform.localScale = new Vector3(b[2] * 2 / SA.PX, b[4], b[3] * 2 / SA.PX);
                box.transform.position = SA.ToWorld(x + (flip ? -b[0] : b[0]), y + b[1], b[4] / 2);
            }
        }
    }
}
