// Your controls, sent to the server exactly like the browser game does:
// WASD move, mouse aim, hold left click attack, Space dash, E skill, Q ultimate, R 3rd skill, 1-4 slots, C reload.
using System.Collections.Generic;
using UnityEngine;
#if ENABLE_INPUT_SYSTEM
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.Controls;
#endif

namespace SurvivalAscension
{
    public class PlayerControl : MonoBehaviour
    {
        WorldView view;
        float nextInput, nextAttack;
        int seq;
        public Vector3 AimPoint;

        void Start() { view = FindAnyObjectByType<WorldView>(); }

        void Update()
        {
            var net = Net.I; var room = net.Room; var me = net.Me;
            if (room?.State == null || me == null || room.State.phase != "playing" || Hud.Typing) return;
            var self = view && view.MyAvatar ? view.MyAvatar.position : SA.ToWorld(me.x, me.y);

            // aim: where the mouse points on the ground
            var cam = Camera.main; float aim = me.aim, dist = 200;
            if (cam)
            {
                var ray = cam.ScreenPointToRay(MousePos());
                if (new Plane(Vector3.up, Vector3.zero).Raycast(ray, out float t))
                {
                    AimPoint = ray.GetPoint(t);
                    aim = SA.ServerAngle(self, AimPoint);
                    dist = Vector3.Distance(new Vector3(self.x, 0, self.z), AimPoint) * SA.PX;
                }
            }

            // movement: one input every 50ms (dx/dy in the server's directions: +y = down the screen = toward the camera)
            float dx = (Key("d") ? 1 : 0) - (Key("a") ? 1 : 0), dy = (Key("s") ? 1 : 0) - (Key("w") ? 1 : 0);
            if (Time.time >= nextInput)
            {
                float dt = Mathf.Min(100f, (Time.time - (nextInput - .05f)) * 1000f);
                nextInput = Time.time + .05f; seq++;
                net.Send("input", new Dictionary<string, object> { { "dx", dx }, { "dy", dy }, { "s", seq }, { "dt", Mathf.Round(dt) }, { "a", aim }, { "f", Mouse(0) ? 1 : 0 } });
            }
            if (Mouse(0) && Time.time >= nextAttack) { nextAttack = Time.time + .1f; net.Send("attack", Msg(aim, dist)); }   // the server applies each weapon's fire rate
            if (MouseDown(1)) net.Send("mechaSlash", Msg(aim, dist));   // Sofea's mecha saber (ignored otherwise)
            if (Down("space")) { seq++; net.Send("dash", new Dictionary<string, object> { { "dx", dx }, { "dy", dy }, { "s", seq } }); }
            if (Down("e")) net.Send("ability", Msg(aim, dist));
            if (Down("q")) net.Send("ult", Msg(aim, dist));
            if (Down("r")) net.Send("skill2");
            if (Down("c")) net.Send("reload");
            for (int n = 1; n <= 4; n++) if (Down(n.ToString())) net.Send("slot", new Dictionary<string, object> { { "n", n == 4 ? 5 : n } });
        }

        static Dictionary<string, object> Msg(float a, float d) => new Dictionary<string, object> { { "a", a }, { "d", d } };

#if ENABLE_INPUT_SYSTEM
        static Vector2 MousePos() => UnityEngine.InputSystem.Mouse.current?.position.ReadValue() ?? Vector2.zero;
        static ButtonControl Btn(int b) { var m = UnityEngine.InputSystem.Mouse.current; return m == null ? null : b == 0 ? m.leftButton : m.rightButton; }
        static bool Mouse(int b) => Btn(b)?.isPressed ?? false;
        static bool MouseDown(int b) => Btn(b)?.wasPressedThisFrame ?? false;
        static KeyControl K(string k)
        {
            var kb = Keyboard.current; if (kb == null) return null;
            switch (k) { case "space": return kb.spaceKey; case "1": return kb.digit1Key; case "2": return kb.digit2Key; case "3": return kb.digit3Key; case "4": return kb.digit4Key; }
            return kb.FindKeyOnCurrentKeyboardLayout(k);
        }
        static bool Key(string k) => K(k)?.isPressed ?? false;
        static bool Down(string k) => K(k)?.wasPressedThisFrame ?? false;
#else
        static Vector2 MousePos() => Input.mousePosition;
        static bool Mouse(int b) => Input.GetMouseButton(b);
        static bool MouseDown(int b) => Input.GetMouseButtonDown(b);
        static bool Key(string k) => Input.GetKey(k);
        static bool Down(string k) => Input.GetKeyDown(k);
#endif
    }
}
