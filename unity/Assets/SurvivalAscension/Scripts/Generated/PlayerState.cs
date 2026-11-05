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
	public partial class PlayerState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve]
#endif
public PlayerState() { }
		[Type(0, "string")]
		public string sessionId = default(string);

		[Type(1, "string")]
		public string name = default(string);

		[Type(2, "float32")]
		public float x = default(float);

		[Type(3, "float32")]
		public float y = default(float);

		[Type(4, "number")]
		public float hp = default(float);

		[Type(5, "number")]
		public float maxHp = default(float);

		[Type(6, "number")]
		public float level = default(float);

		[Type(7, "number")]
		public float xp = default(float);

		[Type(8, "number")]
		public float xpNext = default(float);

		[Type(9, "number")]
		public float kills = default(float);

		[Type(10, "number")]
		public float damage = default(float);

		[Type(11, "number")]
		public float fireRate = default(float);

		[Type(12, "number")]
		public float speed = default(float);

		[Type(13, "number")]
		public float defence = default(float);

		[Type(14, "boolean")]
		public bool alive = default(bool);

		[Type(15, "boolean")]
		public bool ready = default(bool);

		[Type(16, "string")]
		public string characterClass = default(string);

		[Type(17, "number")]
		public float abilityCooldown = default(float);

		[Type(18, "number")]
		public float bleedout = default(float);

		[Type(19, "string")]
		public string weapon = default(string);

		[Type(20, "string")]
		public string melee = default(string);

		[Type(21, "number")]
		public float ammo = default(float);

		[Type(22, "number")]
		public float currency = default(float);

		[Type(23, "number")]
		public float killLeadSince = default(float);

		[Type(24, "number")]
		public float bossDamage = default(float);

		[Type(25, "number")]
		public float revives = default(float);

		[Type(26, "number")]
		public float damageDealt = default(float);

		[Type(27, "number")]
		public float damageTaken = default(float);

		[Type(28, "number")]
		public float towerRepairs = default(float);

		[Type(29, "number")]
		public float structuresBuilt = default(float);

		[Type(30, "number")]
		public float aim = default(float);

		[Type(31, "number")]
		public float facing = default(float);

		[Type(32, "boolean")]
		public bool bledOut = default(bool);

		[Type(33, "string")]
		public string owned = default(string);

		[Type(34, "number")]
		public float armor = default(float);

		[Type(35, "boolean")]
		public bool isBot = default(bool);

		[Type(36, "string")]
		public string primary = default(string);

		[Type(37, "string")]
		public string secondary = default(string);

		[Type(38, "number")]
		public float activeSlot = default(float);

		[Type(39, "number")]
		public float mag = default(float);

		[Type(40, "number")]
		public float reloadLeft = default(float);

		[Type(41, "number")]
		public float medkits = default(float);

		[Type(42, "boolean")]
		public bool isHost = default(bool);

		[Type(43, "string")]
		public string color = default(string);

		[Type(44, "boolean")]
		public bool charging = default(bool);

		[Type(45, "number")]
		public float stunned = default(float);

		[Type(46, "number")]
		public float slowed = default(float);

		[Type(47, "number")]
		public float ultKills = default(float);

		[Type(48, "number")]
		public float ultCd = default(float);

		[Type(49, "boolean")]
		public bool ultReady = default(bool);

		[Type(50, "number")]
		public float ultActive = default(float);

		[Type(51, "number")]
		public float shadow = default(float);

		[Type(52, "number")]
		public float fire = default(float);

		[Type(53, "number")]
		public float storm = default(float);

		[Type(54, "number")]
		public float katanaKills = default(float);

		[Type(55, "number")]
		public float robotCharges = default(float);

		[Type(56, "number")]
		public float chargeCd = default(float);

		[Type(57, "number")]
		public float skillT = default(float);

		[Type(58, "number")]
		public float ack = default(float);

		[Type(59, "number")]
		public float cdr = default(float);

		[Type(60, "number")]
		public float hands = default(float);

		[Type(61, "number")]
		public float reloadTotal = default(float);
	}
}
