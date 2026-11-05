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
	public partial class ZombieState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve]
#endif
public ZombieState() { }
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

		[Type(6, "number")]
		public float speed = default(float);

		[Type(7, "number")]
		public float damage = default(float);

		[Type(8, "number")]
		public float radius = default(float);

		[Type(9, "number")]
		public float attackCooldown = default(float);

		[Type(10, "string")]
		public string targetId = default(string);

		[Type(11, "boolean")]
		public bool boss = default(bool);

		[Type(12, "string")]
		public string role = default(string);

		[Type(13, "number")]
		public float slam = default(float);

		[Type(14, "string")]
		public string act = default(string);

		[Type(15, "number")]
		public float actLen = default(float);

		[Type(16, "number")]
		public float aim = default(float);

		[Type(17, "string")]
		public string hookId = default(string);

		[Type(18, "number")]
		public float hookD = default(float);

		[Type(19, "boolean")]
		public bool enraged = default(bool);

		[Type(20, "number")]
		public float burn = default(float);
	}
}
