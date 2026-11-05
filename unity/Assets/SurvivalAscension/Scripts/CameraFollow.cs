// A 3/4 top-down camera that follows your survivor (like the browser game's view, but in 3D).
using UnityEngine;

namespace SurvivalAscension
{
    public class CameraFollow : MonoBehaviour
    {
        public Vector3 offset = new Vector3(0, 16, -11);   // height and distance behind
        public float smooth = 8f;
        WorldView view;

        void Start() { view = FindAnyObjectByType<WorldView>(); }

        void LateUpdate()
        {
            Vector3 target;
            if (view && view.MyAvatar) target = view.MyAvatar.position;
            else { var s = Net.I?.Room?.State; if (s == null || s.worldW <= 0) return; target = SA.ToWorld(s.towerX > 0 ? s.towerX : s.worldW / 2, s.towerY > 0 ? s.towerY : s.worldH / 2); }
            transform.position = Vector3.Lerp(transform.position, target + offset, 1f - Mathf.Exp(-smooth * Time.deltaTime));
            transform.rotation = Quaternion.LookRotation(-offset.normalized + Vector3.zero, Vector3.up);
        }
    }
}
