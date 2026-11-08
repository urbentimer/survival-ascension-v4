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
	public partial class StructureState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve]
#endif
public StructureState() { }
		[Type(0, "string")]
		public string id = default(string);

		[Type(1, "string")]
		public string kind = default(string);

		[Type(2, "number")]
		public float x = default(float);

		[Type(3, "number")]
		public float y = default(float);

		[Type(4, "number")]
		public float hp = default(float);

		[Type(5, "number")]
		public float maxHp = default(float);

		[Type(6, "string")]
		public string ownerId = default(string);

		[Type(7, "number")]
		public float aim = default(float);

		[Type(8, "number")]
		public float deploy = default(float);

		[Type(9, "number")]
		public float life = default(float);

		[Type(10, "boolean")]
		public bool fire = default(bool);
	}
}
