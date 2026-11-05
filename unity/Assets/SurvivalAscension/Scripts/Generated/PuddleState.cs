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
	public partial class PuddleState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve]
#endif
public PuddleState() { }
		[Type(0, "string")]
		public string id = default(string);

		[Type(1, "number")]
		public float x = default(float);

		[Type(2, "number")]
		public float y = default(float);

		[Type(3, "number")]
		public float r = default(float);

		[Type(4, "number")]
		public float life = default(float);

		[Type(5, "number")]
		public float maxLife = default(float);
	}
}
