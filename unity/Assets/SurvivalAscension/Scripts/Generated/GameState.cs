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
	public partial class GameState : Schema {
#if UNITY_5_3_OR_NEWER
[Preserve]
#endif
public GameState() { }
		[Type(0, "map", typeof(MapSchema<PlayerState>))]
		public MapSchema<PlayerState> players = null;

		[Type(1, "map", typeof(MapSchema<ZombieState>))]
		public MapSchema<ZombieState> zombies = null;

		[Type(2, "map", typeof(MapSchema<StructureState>))]
		public MapSchema<StructureState> structures = null;

		[Type(3, "map", typeof(MapSchema<LootState>))]
		public MapSchema<LootState> loot = null;

		[Type(4, "map", typeof(MapSchema<PuddleState>))]
		public MapSchema<PuddleState> puddles = null;

		[Type(5, "map", typeof(MapSchema<RobotState>))]
		public MapSchema<RobotState> robots = null;

		[Type(6, "map", typeof(MapSchema<VehicleState>))]
		public MapSchema<VehicleState> vehicles = null;

		[Type(7, "number")]
		public float stage = default(float);

		[Type(8, "number")]
		public float elapsed = default(float);

		[Type(9, "string")]
		public string phase = default(string);

		[Type(10, "string")]
		public string hostId = default(string);

		[Type(11, "string")]
		public string message = default(string);

		[Type(12, "number")]
		public float totalKills = default(float);

		[Type(13, "number")]
		public float towerHp = default(float);

		[Type(14, "number")]
		public float towerMaxHp = default(float);

		[Type(15, "number")]
		public float scrap = default(float);

		[Type(16, "number")]
		public float electronics = default(float);

		[Type(17, "number")]
		public float explosives = default(float);

		[Type(18, "number")]
		public float fuel = default(float);

		[Type(19, "boolean")]
		public bool isNight = default(bool);

		[Type(20, "number")]
		public float generatorHp = default(float);

		[Type(21, "number")]
		public float generatorMaxHp = default(float);

		[Type(22, "number")]
		public float generatorFuel = default(float);

		[Type(23, "string")]
		public string waveType = default(string);

		[Type(24, "number")]
		public float countdown = default(float);

		[Type(25, "number")]
		public float worldW = default(float);

		[Type(26, "number")]
		public float worldH = default(float);

		[Type(27, "number")]
		public float towerX = default(float);

		[Type(28, "number")]
		public float towerY = default(float);

		[Type(29, "boolean")]
		public bool explore = default(bool);

		[Type(30, "string")]
		public string mapLayout = default(string);

		[Type(31, "string")]
		public string bossPhase = default(string);

		[Type(32, "string")]
		public string bossIntro = default(string);

		[Type(33, "number")]
		public float introNeed = default(float);

		[Type(34, "number")]
		public float introReady = default(float);

		[Type(35, "number")]
		public float hookSpeed = default(float);

		[Type(36, "boolean")]
		public bool noCd = default(bool);

		[Type(37, "number")]
		public float mapSite = default(float);

		[Type(38, "string")]
		public string difficulty = default(string);

		[Type(39, "string")]
		public string waveMode = default(string);

		[Type(40, "boolean")]
		public bool friendlyFire = default(bool);

		[Type(41, "boolean")]
		public bool extraLoot = default(bool);
	}
}
