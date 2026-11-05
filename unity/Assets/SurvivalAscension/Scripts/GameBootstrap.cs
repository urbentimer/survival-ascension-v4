// Put this ONE script on an empty GameObject in your scene and press Play: it sets everything else up.
using UnityEngine;

namespace SurvivalAscension
{
    public class GameBootstrap : MonoBehaviour
    {
        void Awake()
        {
            if (!FindAnyObjectByType<Net>()) gameObject.AddComponent<Net>();
            if (!FindAnyObjectByType<WorldView>()) gameObject.AddComponent<WorldView>();
            if (!FindAnyObjectByType<PlayerControl>()) gameObject.AddComponent<PlayerControl>();
            if (!FindAnyObjectByType<Hud>()) gameObject.AddComponent<Hud>();
            var cam = Camera.main;
            if (!cam) { var g = new GameObject("Main Camera"); g.tag = "MainCamera"; cam = g.AddComponent<Camera>(); }
            if (!cam.GetComponent<CameraFollow>()) cam.gameObject.AddComponent<CameraFollow>();
            cam.transform.position = new Vector3(60, 16, -27); cam.farClipPlane = 300;
            if (!FindAnyObjectByType<Light>())
            {
                var l = new GameObject("Sun").AddComponent<Light>(); l.type = LightType.Directional; l.intensity = 1.1f;
                l.transform.rotation = Quaternion.Euler(50, -30, 0);
            }
            Application.targetFrameRate = 120;
            Application.runInBackground = true;   // keep the connection alive when the window isn't focused
        }
    }
}
