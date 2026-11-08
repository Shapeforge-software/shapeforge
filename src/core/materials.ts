/**
 * Materials found in EmbervaleToolkit.exe v3.4.1: 74 building-block materials and 61 terrain materials.
 * Block names come from the EnshroudedPalettes file (by materialItem), roof materials from the community block ID
 * list; terrain names from the community terrain ID lists.
 * index is the game's material number within its kind (the voxel byte is index + 128 for blocks, index for terrain).
 * color is Embervale's preview color, used for the viewport only.
 */
export type MaterialKind = 'block' | 'terrain';

export interface Material {
  materialItem: number;
  kind: MaterialKind;
  index: number;
  name: string;
  color: string;
}

export const MATERIALS: Material[] = [
  { materialItem: 296562836, kind: "block", index: 0, name: "Refined Stone Block", color: "#68655e" },
  { materialItem: 4077117519, kind: "block", index: 2, name: "Plant fiber Roof Block", color: "#302921" },
  { materialItem: 582832101, kind: "block", index: 4, name: "Highly Polished Stone Block", color: "#9a8b78" },
  { materialItem: 3502973158, kind: "block", index: 5, name: "Tarred Shingle Roof Block", color: "#574c3e" },
  { materialItem: 276744828, kind: "block", index: 7, name: "Iron Block", color: "#8b847d" },
  { materialItem: 72900743, kind: "block", index: 8, name: "Rough Sandstone Block", color: "#5c4738" },
  { materialItem: 3337807364, kind: "block", index: 10, name: "Roughly Cut Stone Block", color: "#5d5546" },
  { materialItem: 2871749713, kind: "block", index: 12, name: "Half-Timbered Block", color: "#66513e" },
  { materialItem: 57557573, kind: "block", index: 13, name: "Ancient Circles Block", color: "#353026" },
  { materialItem: 1406367026, kind: "block", index: 14, name: "Weathered Stone Block", color: "#514b40" },
  { materialItem: 2012474258, kind: "block", index: 15, name: "Rough Wood Block", color: "#5c4936" },
  { materialItem: 1358536105, kind: "block", index: 16, name: "Refined Wood Block", color: "#54483d" },
  { materialItem: 3627519922, kind: "block", index: 17, name: "Fancy Stone Block", color: "#736054" },
  { materialItem: 310129061, kind: "block", index: 18, name: "Well Block", color: "#2b2f24" },
  { materialItem: 2581939916, kind: "block", index: 19, name: "Shroud Wood Block", color: "#34302a" },
  { materialItem: 1956408861, kind: "block", index: 20, name: "Citywall Block", color: "#615c4f" },
  { materialItem: 2543947810, kind: "block", index: 21, name: "Mycelium Overgrown Block", color: "#706047" },
  { materialItem: 2216303598, kind: "block", index: 22, name: "Regular Sandstone Block", color: "#9d7e5e" },
  { materialItem: 3312174805, kind: "block", index: 23, name: "Regular Stone Block", color: "#867f73" },
  { materialItem: 2825372463, kind: "block", index: 24, name: "Palm Wood Block", color: "#563723" },
  { materialItem: 3775747292, kind: "block", index: 25, name: "Fired Bricks Block", color: "#996748" },
  { materialItem: 54733896, kind: "block", index: 26, name: "Ancient Dungeon Block", color: "#232a2b" },
  { materialItem: 2175686957, kind: "block", index: 27, name: "Rough Stone Block", color: "#565144" },
  { materialItem: 2060473756, kind: "block", index: 29, name: "Ancient Stone Block", color: "#272e2d" },
  { materialItem: 1555483091, kind: "block", index: 30, name: "Refined Sandstone Block", color: "#9a8d87" },
  { materialItem: 196827131, kind: "block", index: 31, name: "Red Tile Roof Block", color: "#563629" },
  { materialItem: 2067027342, kind: "block", index: 32, name: "Ancient Gold Block", color: "#72603e" },
  { materialItem: 2875012578, kind: "block", index: 33, name: "Desert Temple Block", color: "#7d7a75" },
  { materialItem: 2365603799, kind: "block", index: 34, name: "Limestone Block", color: "#776e59" },
  { materialItem: 1856761753, kind: "block", index: 35, name: "Tarred Wood Block", color: "#40362d" },
  { materialItem: 3178080467, kind: "block", index: 36, name: "Desert City Block", color: "#ac8f73" },
  { materialItem: 1506458989, kind: "block", index: 37, name: "Castle Wall Stone Block", color: "#3b3a32" },
  { materialItem: 1405390032, kind: "block", index: 38, name: "Rough Flintstone Block", color: "#6e6555" },
  { materialItem: 192912459, kind: "block", index: 39, name: "Blue Luminescent Block", color: "#2174cb" },
  { materialItem: 3389648330, kind: "block", index: 40, name: "Tarred Straw Block", color: "#2b323d" },
  { materialItem: 551181842, kind: "block", index: 41, name: "Straw Roof Block", color: "#745a39" },
  { materialItem: 53541119, kind: "block", index: 42, name: "Bronze Block", color: "#7f643a" },
  { materialItem: 1619485296, kind: "block", index: 43, name: "Copper Block", color: "#584131" },
  { materialItem: 485052852, kind: "block", index: 44, name: "Metal Block", color: "#4f5056" },
  { materialItem: 1699388154, kind: "block", index: 45, name: "Stone Shingle Roof Block", color: "#585552" },
  { materialItem: 1176719610, kind: "block", index: 46, name: "Bone Block", color: "#5e4d3a" },
  { materialItem: 641139736, kind: "block", index: 48, name: "Ornate Wood Block", color: "#403022" },
  { materialItem: 2041116756, kind: "block", index: 49, name: "Hollow Halls Block", color: "#1b1b20" },
  { materialItem: 3877300758, kind: "block", index: 50, name: "Ectoplasm Block", color: "#355e55" },
  { materialItem: 3721356294, kind: "block", index: 51, name: "Red Marble", color: "#34100b" },
  { materialItem: 627477408, kind: "block", index: 52, name: "Brick-Timbered Block", color: "#865f4e" },
  { materialItem: 3402080269, kind: "block", index: 53, name: "Green Luminescent Block", color: "#085b2a" },
  { materialItem: 2310650651, kind: "block", index: 54, name: "White Luminescent Block", color: "#ac8469" },
  { materialItem: 3380780330, kind: "block", index: 55, name: "Temple Stones", color: "#5d5333" },
  { materialItem: 168200942, kind: "block", index: 56, name: "Weathered Ancient Stone Block", color: "#4c452c" },
  { materialItem: 2762553617, kind: "block", index: 57, name: "Plaited Block", color: "#67472b" },
  { materialItem: 3379333313, kind: "block", index: 58, name: "Mixed Sandstone Block", color: "#7b664d" },
  { materialItem: 2615018308, kind: "block", index: 63, name: "Conifer Wood Block", color: "#4a392b" },
  { materialItem: 835259216, kind: "block", index: 64, name: "Granite Block", color: "#3e3d37" },
  { materialItem: 3950526602, kind: "block", index: 65, name: "Polished Granite Block", color: "#423f3b" },
  { materialItem: 1398837105, kind: "block", index: 66, name: "Granite Ornamented Roof Block", color: "#47433a" },
  { materialItem: 3147026944, kind: "block", index: 67, name: "Granite Shingle Roof Block", color: "#33321f" },
  { materialItem: 1010285014, kind: "block", index: 68, name: "Obsidian Block", color: "#253135" },
  { materialItem: 3288587434, kind: "block", index: 69, name: "Yellow Luminescent Block", color: "#5a534d" },
  { materialItem: 2848160320, kind: "block", index: 70, name: "Midnight Tomb Block", color: "#211e15" },
  { materialItem: 688801496, kind: "block", index: 71, name: "Starlight Block", color: "#676560" },
  { materialItem: 3899129081, kind: "block", index: 72, name: "Desert Shingles Roof Block", color: "#2e3d3e" },
  { materialItem: 755945588, kind: "block", index: 73, name: "Drak Temple Block", color: "#71774c" },
  { materialItem: 3575022075, kind: "block", index: 74, name: "Castle Block", color: "#676e75" },
  { materialItem: 531118786, kind: "block", index: 75, name: "Bamboo Wood Block", color: "#534428" },
  { materialItem: 228876949, kind: "block", index: 76, name: "Drak Temple Roof Block", color: "#5b6042" },
  { materialItem: 2670548968, kind: "block", index: 77, name: "Palm Leaf Roof Block", color: "#4e4b38" },
  { materialItem: 1253279979, kind: "block", index: 78, name: "Half-timbered Shell Limestone Block", color: "#544d3e" },
  { materialItem: 4234622287, kind: "block", index: 79, name: "Shell Limestone Shingle Block", color: "#4e4323" },
  { materialItem: 1749208422, kind: "block", index: 80, name: "Castle Roof Block", color: "#30412f" },
  { materialItem: 2587516407, kind: "block", index: 81, name: "Shell Limestone Block", color: "#9a835c" },
  { materialItem: 3952140415, kind: "block", index: 82, name: "Red Carpet Block", color: "#ad212a" },
  { materialItem: 2130648477, kind: "block", index: 83, name: "Ancient Beacon Block", color: "#b6671a" },
  { materialItem: 454345705, kind: "block", index: 84, name: "Moonstone Block", color: "#768c95" },
  { materialItem: 1558115984, kind: "terrain", index: 1, name: "Springlands Dirt", color: "#495a2d" },
  { materialItem: 631520303, kind: "terrain", index: 2, name: "Stone", color: "#59554a" },
  { materialItem: 1257792166, kind: "terrain", index: 8, name: "Rubble", color: "#574f43" },
  { materialItem: 2493843175, kind: "terrain", index: 9, name: "Sand", color: "#b1826d" },
  { materialItem: 4095370049, kind: "terrain", index: 10, name: "Veilwater Basin Dirt", color: "#595b2a" },
  { materialItem: 2732808327, kind: "terrain", index: 11, name: "Nomad Highlands Dirt", color: "#766334" },
  { materialItem: 3937186197, kind: "terrain", index: 12, name: "Revelwood Dirt", color: "#443e25" },
  { materialItem: 3865976041, kind: "terrain", index: 13, name: "Granite", color: "#46413b" },
  { materialItem: 447697249, kind: "terrain", index: 20, name: "Dirt Road Block", color: "#846c4b" },
  { materialItem: 323499580, kind: "terrain", index: 21, name: "Smooth Stone Road Block", color: "#6a5f51" },
  { materialItem: 3938514298, kind: "terrain", index: 22, name: "Rocky Stone Road Block", color: "#564836" },
  { materialItem: 1401630464, kind: "terrain", index: 28, name: "Sandstone", color: "#8e6557" },
  { materialItem: 3152907053, kind: "terrain", index: 32, name: "Luminous Growth", color: "#546056" },
  { materialItem: 1823674426, kind: "terrain", index: 39, name: "Farm Soil", color: "#6a4d31" },
  { materialItem: 1181280513, kind: "terrain", index: 40, name: "Revelwood Stone", color: "#585943" },
  { materialItem: 260133819, kind: "terrain", index: 41, name: "Fertillised Farm Soil", color: "#4a341d" },
  { materialItem: 3445636557, kind: "terrain", index: 42, name: "Limestone", color: "#9b8461" },
  { materialItem: 3604850591, kind: "terrain", index: 45, name: "Flower Soil", color: "#454a1d" },
  { materialItem: 3489782185, kind: "terrain", index: 46, name: "Fine Sand", color: "#d9b59d" },
  { materialItem: 1227021926, kind: "terrain", index: 47, name: "Blackmire Bark", color: "#35381b" },
  { materialItem: 2297010177, kind: "terrain", index: 52, name: "Foliage", color: "#384a20" },
  { materialItem: 1745782985, kind: "terrain", index: 53, name: "Blackmire Heartwood", color: "#825937" },
  { materialItem: 2479098085, kind: "terrain", index: 54, name: "Mushroom Flesh", color: "#7f6941" },
  { materialItem: 3577968307, kind: "terrain", index: 55, name: "Vukah Nesting Material", color: "#654c28" },
  { materialItem: 2541805223, kind: "terrain", index: 56, name: "Snow", color: "#dededf" },
  { materialItem: 4199799645, kind: "terrain", index: 57, name: "Ice", color: "#2d393b" },
  { materialItem: 2080424991, kind: "terrain", index: 58, name: "Albaneve Summits Dirt", color: "#55422a" },
  { materialItem: 3585782303, kind: "terrain", index: 59, name: "Moss", color: "#292c05" },
  { materialItem: 3376745431, kind: "terrain", index: 64, name: "Granite Rubble Road Block", color: "#4b423a" },
  { materialItem: 4233423640, kind: "terrain", index: 66, name: "Springlands Rubble", color: "#5a5a43" },
  { materialItem: 2992740264, kind: "terrain", index: 67, name: "Field Stones", color: "#605c45" },
  { materialItem: 3232269711, kind: "terrain", index: 69, name: "Nomad Highlands Rubble", color: "#948160" },
  { materialItem: 3787344002, kind: "terrain", index: 70, name: "Fertile Nomad Highlands Dirt", color: "#705e29" },
  { materialItem: 4056696698, kind: "terrain", index: 74, name: "Kindlewastes Rubble", color: "#996e5c" },
  { materialItem: 2925726773, kind: "terrain", index: 75, name: "Fertile Kindlewastes Sand", color: "#9b6f4d" },
  { materialItem: 3234886486, kind: "terrain", index: 77, name: "Shroud Infused Farm Soil", color: "#665849" },
  { materialItem: 3321738283, kind: "terrain", index: 78, name: "Limestone Road Block", color: "#9c7860" },
  { materialItem: 2517406505, kind: "terrain", index: 79, name: "Fertile Springlands Dirt", color: "#486128" },
  { materialItem: 459345780, kind: "terrain", index: 80, name: "Fertile Revelwood Dirt", color: "#40491f" },
  { materialItem: 1619282664, kind: "terrain", index: 81, name: "Revelwood Rubble", color: "#4b4538" },
  { materialItem: 1853942795, kind: "terrain", index: 86, name: "Shell Limestone", color: "#917d65" },
  { materialItem: 2252426664, kind: "terrain", index: 87, name: "Veilwater Basin Rubble", color: "#87795d" },
  { materialItem: 1422307195, kind: "terrain", index: 88, name: "Fertile Veilwater Basin Dirt", color: "#3f4719" },
  { materialItem: 2572858337, kind: "terrain", index: 90, name: "Gold Coins", color: "#a57e37" },
  { materialItem: 890360552, kind: "terrain", index: 91, name: "Underwater Mud", color: "#574e28" },
  { materialItem: 1068232992, kind: "terrain", index: 93, name: "Underwater Luminous Growth", color: "#1b3011" },
  { materialItem: 2181045178, kind: "terrain", index: 95, name: "Veilwater Basin Sand", color: "#d4b285" },
  { materialItem: 303090384, kind: "terrain", index: 99, name: "Shell Limestone Road Block", color: "#8b765c" },
  { materialItem: 885155884, kind: "terrain", index: 100, name: "Cinder Rock", color: "#0d0c09" },
  { materialItem: 2421105715, kind: "terrain", index: 101, name: "Cinder's Cradle Dirt", color: "#2a2c2c" },
  { materialItem: 2780052662, kind: "terrain", index: 102, name: "Cinder's Cradle Rubble", color: "#27292b" },
  { materialItem: 4044361518, kind: "terrain", index: 103, name: "Fertile Cinder's Cradle Dirt", color: "#332a12" },
  { materialItem: 2385754716, kind: "terrain", index: 104, name: "Terrain material 104", color: "#454f11" },
  { materialItem: 4219078478, kind: "terrain", index: 105, name: "Terrain material 105", color: "#3b4913" },
  { materialItem: 760251531, kind: "terrain", index: 106, name: "Terrain material 106", color: "#5c6243" },
  { materialItem: 3620677285, kind: "terrain", index: 107, name: "Terrain material 107", color: "#52543a" },
  { materialItem: 3899759098, kind: "terrain", index: 108, name: "Cinder's Cradle Sand", color: "#14191c" },
  { materialItem: 2851443310, kind: "terrain", index: 109, name: "Basalt", color: "#171d21" },
  { materialItem: 1458330217, kind: "terrain", index: 110, name: "Fertile Altered Dirt", color: "#2f383d" },
  { materialItem: 1930450533, kind: "terrain", index: 111, name: "Basalt Farm Soil", color: "#31251a" },
  { materialItem: 1187543406, kind: "terrain", index: 112, name: "Ancient Road Block", color: "#3b4445" },
];

export const BLOCK_MATERIALS = MATERIALS.filter((m) => m.kind === 'block');

/** Block materials made for roofs (from the community block ID list). */
const ROOF_INDEXES = new Set([2, 5, 31, 40, 41, 45, 66, 67, 72, 76, 77, 79, 80]);
export const ROOF_MATERIALS = BLOCK_MATERIALS.filter((m) => ROOF_INDEXES.has(m.index));
export const TERRAIN_MATERIALS = MATERIALS.filter((m) => m.kind === 'terrain');

/** Weathered Stone Block, confirmed in game. */
export const DEFAULT_MATERIAL = 1406367026;

const BY_ID = new Map(MATERIALS.map((m) => [m.materialItem, m]));

export function materialById(id: number): Material | undefined {
  return BY_ID.get(id);
}
