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
	public partial class RobotState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve]
#endif
public RobotState() { }
		[Type(0, "string")]
		public string id = default(string);

		[Type(1, "string")]
		public string kind = default(string);

		[Type(2, "float32")]
		public float x = default(float);

		[Type(3, "float32")]
		public float y = default(float);

		[Type(4, "number")]
		public float hp = default(float);

		[Type(5, "number")]
		public float maxHp = default(float);

		[Type(6, "string")]
		public string ownerId = default(string);

		[Type(7, "number")]
		public float aim = default(float);

		[Type(8, "string")]
		public string act = default(string);

		[Type(9, "number")]
		public float hx = default(float);

		[Type(10, "number")]
		public float hy = default(float);

		[Type(11, "number")]
		public float uses = default(float);

		[Type(12, "number")]
		public float face = default(float);

		[Type(13, "string")]
		public string tgt = default(string);
	}
}
