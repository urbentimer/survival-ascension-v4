// 
// THIS FILE HAS BEEN GENERATED AUTOMATICALLY
// DO NOT CHANGE IT MANUALLY UNLESS YOU KNOW WHAT YOU'RE DOING
// 
// GENERATED USING @colyseus/schema 3.0.76
// 

using Colyseus.Schema;
#if UNITY_5_3_OR_NEWER
using UnityEngine.Scripting;
#endif

namespace SurvivalAscension {
	public partial class VehicleState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve]
#endif
public VehicleState() { }
		[Type(0, "string")]
		public string id = default(string);

		[Type(1, "string")]
		public string kind = default(string);

		[Type(2, "string")]
		public string phase = default(string);

		[Type(3, "float32")]
		public float x = default(float);

		[Type(4, "float32")]
		public float y = default(float);

		[Type(5, "number")]
		public float hull = default(float);

		[Type(6, "number")]
		public float aim = default(float);

		[Type(7, "number")]
		public float left = default(float);

		[Type(8, "boolean")]
		public bool mv = default(bool);

		[Type(9, "number")]
		public float shots = default(float);

		[Type(10, "boolean")]
		public bool fire = default(bool);
	}
}
