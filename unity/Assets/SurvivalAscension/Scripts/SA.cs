// Survival Ascension 3D - shared settings and helpers.
// The game server is the SAME one the browser game uses (Colyseus on Render). The server works in 2D pixels
// (x right, y DOWN, a 3600 x 2280 city); here 1 Unity unit = PX pixels, x stays x and the server's y becomes -z.
using UnityEngine;

namespace SurvivalAscension
{
    public static class SA
    {
        public const string Server = "wss://survival-ascension-sg.onrender.com";   // same as client/config.js
        public const string RoomName = "survival";
        public const float PX = 30f;   // pixels per metre (a survivor is ~54px tall = ~1.8m)

        public static readonly string[] Heroes = { "assault", "juggernaut", "operator", "engineer", "scout", "demolitionist", "sniper", "dispatcher" };
        public static readonly string[] HeroNames = { "Marcus", "Briggs", "Sofea", "Viktor", "Raven", "Dante", "Sienna", "Astra" };

        public static Vector3 ToWorld(float x, float y, float height = 0f) => new Vector3(x / PX, height, -y / PX);
        public static Vector2 ToServer(Vector3 w) => new Vector2(w.x * PX, -w.z * PX);
        // a server angle (radians, y down) <-> a Unity yaw (degrees around Y, 0 = +z)
        public static float AngleToYaw(float a) => 90f + a * Mathf.Rad2Deg;
        public static float ServerAngle(Vector3 from, Vector3 to) => Mathf.Atan2(-(to.z - from.z), to.x - from.x);

        public static Color Hex(string hex, Color fallback)
        {
            if (!string.IsNullOrEmpty(hex) && ColorUtility.TryParseHtmlString(hex, out var c)) return c;
            return fallback;
        }

        // a plain coloured material that works in URP (and the built-in pipeline as a fallback)
        public static Material Mat(Color c)
        {
            var sh = Shader.Find("Universal Render Pipeline/Lit") ?? Shader.Find("Standard");
            var m = new Material(sh) { color = c };
            return m;
        }

        public static GameObject Prim(PrimitiveType t, Color c, Transform parent = null, string name = null)
        {
            var g = GameObject.CreatePrimitive(t);
            if (name != null) g.name = name;
            var col = g.GetComponent<Collider>(); if (col) Object.Destroy(col);   // the server does all the collisions
            g.GetComponent<Renderer>().sharedMaterial = Mat(c);
            if (parent) g.transform.SetParent(parent, false);
            return g;
        }
    }
}
