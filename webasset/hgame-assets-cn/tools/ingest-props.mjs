import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Document, NodeIO, getBounds } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, quantize, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { makeFriendlyName, makeFriendlyNameEn, PACK_ZH } from './zh-names.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const BUILT_MODELS_DIR = path.join(ROOT, 'built', 'models');

const EXCLUDE_RE = /(_wep_|_chr_attach|attach_|bullet_?holes|dead_|blood|sign_|largesign_|_wheel_|_wheels_|_tyre_|_tire_|_door_|_topdoor_|_hood_|_bonnet_|_bumper_|_spoiler_|_steering|_rotor_|_propeller|_turret_|_axle_|_windscreen_|_addon_|_exhaust_|_payload_|_cage_|_lights_|_lid_|_drawer_|_fastener_|_handset_|_needle_|_canopy|_armour_|_armor_|_amour_|_drawbar_|_part_|_logs_|_guard_|_rollcage_|_side_?skirts?|_splitter|_diffuser|_fender|_claw_\d|_bullbars_|_ram_0|_towhook_|_gunner_|_luggage_0|_cannon_0|_light_cover|_roof_01_new|_seats_01_new|_undercarriage_|_flatbed_0|_tray_dirt|_control_|_containers_|_ramp_0|_fueltank|_plate_01$|_exotic_01_new|_handlebar|_stick$|_bike$|_cone_01$|_liquid$|_0\d_l$|_outline$|_pool_|_hinges$|_lock_0|_painting_0|_filling_0|_top$|_cover_0|_longhand|_shorthand|_flame_|_rope_|_end_01$|_tarp$|_hand_\d|_cord_|_pin_0|_hook_0|_swivel$|_stand$|_nets_0|_screen_colour|flak_01_barrel|wall_safe_01$|^sm_prop_chair_04$|^sm_prop_table_suite|^sm_prop_chandelier_0[34]|^sm_prop_clock_02$|^sm_prop_lamp_01$|^sm_prop_lamp_magnifier|^sm_prop_barber_backwash_chair_01_t|^sm_prop_barber_chair_01$|^sm_prop_shop_chair_01$|^sm_veh_chair_01$|^sm_prop_cabinet_02_dress|^sm_prop_cabinet_04_dish|^sm_prop_computer_monitor_0[12]|^sm_prop_tv_01$|^sm_prop_monitor_02$|^sm_prop_kitchen_monitor_01$|^sm_prop_loud_speaker_01$|^sm_prop_emergency_phone_cover|_cork$|_plastic_0|_food_insert|_base_01$|warpgate|fishtank_01_chest|containercrane|_low_01$)/i;

function parseArgs(argv) {
  let srcDir = process.env.HGAME_UNREAL_EXPORT_ROOT || '';
  let limit = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--src' && argv[i + 1]) srcDir = argv[++i];
    else if (argv[i] === '--limit' && argv[i + 1]) limit = Number(argv[++i]) || 0;
  }
  return { srcDir, limit };
}

function classifyPropGroup(filename) {
  if (!filename.endsWith('.glb')) return null;
  const base = path.basename(filename, '.glb');
  const assetName = base.includes('__') ? base.split('__').slice(1).join('__') : base;
  if (EXCLUDE_RE.test(assetName)) return null;
  if (/^SM_Bld_/i.test(assetName) && !/(diner_table|diner_stool|bridge_chair)/i.test(assetName)) return null;
  if (/^SM_Env_/i.test(assetName) && !/(plant_carrot)/i.test(assetName)) return null;

  const nl = assetName.toLowerCase();
  if (/^(?:sm|sk)_veh_/i.test(nl)) {
    if (/(top_01|addon|tail|wheels_)/i.test(nl)) return null;
    return 'prop_vehicle';
  }
  if (/(?:^|_)(potion|flask|coin|gold|gem|crystal|diamond|jewel|trophy|key|medkit|firstaid|bandage|scroll|book|tome|compass|flashlight|radio|walkietalkie|battery|ore_)(?:_|\d|$)/i.test(nl) && !/(bookcase|bookshelf|key_?board|key_?card)/i.test(nl)) {
    return 'prop_collectible';
  }
  if (/(?:^|_)(apple|banana|orange|lemon|grape|melon|pear|peach|fruit|carrot|potato|tomato|corn|cabbage|pumpkin|bread|cake|pie|pizza|burger|hotdog|sushi|meat|steak|fish|cheese|egg|milk|coffee|cup|mug|goblet|bottle|wine|beer|soda|plate|bowl|pot_|pan_|kettle|donut|icecream|cookie|candy|sandwich|taco|noodle|ramen|food|fork|knife|spoon)(?:_|\d|$)/i.test(nl) && !/(table|cabinet|fishtank|coffee_?table|side_?table)/i.test(nl)) {
    return 'prop_food';
  }
  if (/(?:^|_)(chair|table|desk|sofa|couch|bench|stool|bed|cabinet|cupboard|shelf|shelves|bookcase|bookshelf|wardrobe|dresser|drawer|counter|throne|lamp|chandelier|lantern|candle|fireplace|mirror|clock)(?:_|\d|$)/i.test(nl)) {
    return 'prop_furniture';
  }
  if (/(?:^|_)(chest|barrel|crate|keg|safe|vault|suitcase|briefcase|sack|toolbox|ammo_crate|ammo_box)(?:_|\d|$)/i.test(nl)) {
    return 'prop_container';
  }
  if (/(?:^|_)(arcade|guitar|piano|drum|violin|mic|microphone|speaker|tv|television|monitor|computer|laptop|keyboard|phone|smartphone|printer|camera|fridge|freezer|stove|oven|microwave|vending|atm|cashregister|gramophone)(?:_|\d|$)/i.test(nl)) {
    return 'prop_tech';
  }
  return null;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

function colorCluster(r, g, b) {
  const { h, s, l } = rgbToHsl(r, g, b);
  if (s < 0.16) {
    if (l >= 0.68) return 'white';
    if (l < 0.32) return 'dark';
    return 'grey';
  }
  if (h < 18 || h >= 330) return 'red';
  if (h < 66) return 'yellow';
  if (h < 168) return 'green';
  if (h < 265) return 'blue';
  return 'purple';
}

function getAssetDomain(group, assetName) {
  const nl = (assetName || '').toLowerCase();
  const isSciFi = /^polygonscifi/i.test(nl);
  const isWoodPack = /^polygon(?:adventure|fantasykingdom)/i.test(nl);

  if (/(?:^|_)(gold|coin|coins|trophy|goblet|chalice|crown|medal|treasure|bell|candelabra|candlestick)(?:_|\d|$)/i.test(nl) && !/(book_?phone|tiki)/i.test(nl)) {
    return 'precious_metal';
  }
  if (/(?:^|_)(copper_?bowl|copper)(?:_|\d|$)/i.test(nl)) {
    return 'copper_metal';
  }
  if (/(?:^|_)(key|keys|key_?ring|padlock|lock|handcuff|chain)(?:_|\d|$)/i.test(nl) && !/(key_?board|key_?card)/i.test(nl)) {
    return 'key_hardware';
  }
  if (/(?:^|_)(ore_)(?:_|\w|\d|$)/i.test(nl)) {
    return 'ore_mineral';
  }
  if (/(?:^|_)(gem|crystal|diamond|jewel|emerald|ruby|sapphire)(?:_|\d|$)/i.test(nl)) {
    return 'gem_crystal';
  }
  if (/(?:^|_)(sack|bag|pouch|burlap)(?:_|\d|$)/i.test(nl)) {
    return 'burlap_sack';
  }
  if (/(?:^|_)(water_?bottle|soda_?bottle|drink_?bottle|milk_?bottle|item_?bottle|bottle_clear|bottle_01|bottle_02|bottle_15|bottle_16)(?:_|\d|$)/i.test(nl) && !/(bar_bottle|wine|beer|saki|glass)/i.test(nl)) {
    return 'plastic_bottle';
  }
  if (/(?:^|_)(cleaning_?bottle|mayo_?bottle|spray_?bottle|ketchup|mustard|plastic|cone|bucket|cooler|laundry|soap|detergent|shampoo|bowling_?ball|air_?hockey|striker|puck|toy|rubber|keyboard_?box|mouse_?box|modem_?box)(?:_|\d|$)/i.test(nl)) {
    return 'opaque_plastic';
  }
  if (/(?:^|_)(dripper|coffee_?pot|coffeemachine_?dripper)(?:_|\d|$)/i.test(nl)) {
    return 'coffee_carafe';
  }
  if (/(?:^|_)(wine_?glass|champagne_?glass|cocktail|martini|beer_?glass|glass_cup|magnifying_glass|hourglass|bar_?bottle|wine_?bottle|beer_?bottle|saki_?bottle|bottle|potion|flask|vial|jar)(?:_|\d|$)/i.test(nl)) {
    return 'glass_vessel';
  }
  if (/(?:^|_)(book|books|tome|scroll|paper|note|letter|map|diary|journal|newspaper|magazine|card|cards|folder|clipboard|blueprint|poster|comic|menu)(?:_|\d|$)/i.test(nl) && !/(bookcase|bookshelf|book_?stand)/i.test(nl)) {
    return 'book_paper';
  }
  if (/(?:^|_)(toilet|sink|bathtub|urinal|basin)(?:_|\d|$)/i.test(nl)) {
    return 'porcelain_fixture';
  }
  if (/(?:^|_)(zen_?lantern|stone_?lantern|vase|urn|statue|fountain|bust|pillar|pedestal|column|gravestone|tombstone|stone|rock)(?:_|\d|$)/i.test(nl)) {
    return 'stone_ceramic';
  }
  if (/(?:^|_)(beanbag|pillow|cushion|rug|carpet|curtain|mattress|tent|flag|banner)(?:_|\d|$)/i.test(nl)) {
    return 'soft_cloth_only';
  }
  if (/(?:^|_)(bed_?military|bed_?medical|bed_?gurney|bed_?frame|bed_?stretcher|bench_?press|office_?chair|desk_?chair|swivel|folding|chair_?metal|bar_?stool|diner_?stool|wheelchair)(?:_|\d|$)/i.test(nl)) {
    return 'metal_seating';
  }
  if (isSciFi && /(?:^|_)(chair|bed|medical|crate|chest|table|desk|shelf|bench|couch|sofa)(?:_|\d|$)/i.test(nl)) {
    return 'scifi_fixture';
  }
  if (/(?:^|_)(sofa|couch|armchair|bed|chair|cafe_?chair|chair_?soft|stool|bench|booth|throne)(?:_|\d|$)/i.test(nl)) {
    return /^polygonnightclubs/i.test(nl) ? 'nightclub_seating' : 'seating_upholstery';
  }
  if (/(?:^|_)(crate_?stack_?cover)(?:_|\d|$)/i.test(nl)) {
    return 'soft_cloth_only';
  }
  if (/(?:^|_)(barrel_water|barrel_nuke_pool)(?:_|\d|$)/i.test(nl)) {
    return 'water_plastic_barrel';
  }
  if (/(?:^|_)(barrel|drum)(?:_|\d|$)/i.test(nl) && !isWoodPack && !/^polygontown/i.test(nl)) {
    return 'metal_container_tech';
  }
  if (/(?:^|_)(locker|file_?cabinet|filing_?cabinet|metal_?shelf|diner_?table|ammo_?crate|ammo_?box|safe|vault|toolbox|oil_?barrel|fuel|gas_?can|jerrycan|trash|bin|dumpster|nuke_0|toxic|camera|flashlight|radio|walkietalkie|battery|compass|wrench|hammer|screwdriver|crowbar|pliers|drill|saw)(?:_|\d|$)/i.test(nl)) {
    return 'metal_container_tech';
  }
  if (/(?:^|_)(lamp|chandelier|lantern|candle|clock|mirror)(?:_|\d|$)/i.test(nl)) {
    return 'lighting_hardware';
  }
  if (/(?:^|_)(briefcase|suitcase)(?:_|\d|$)/i.test(nl)) {
    return 'leather_case';
  }
  if (/(?:^|_)(barrel|keg|crate|chest)(?:_|\d|$)/i.test(nl)) {
    return 'wood_container';
  }
  if (/(?:^|_)(piano|gramophone)(?:_|\d|$)/i.test(nl)) {
    return 'acoustic_classic';
  }
  if (/(?:^|_)(table|cafe_?table|coffee_?table|side_?table|stall_?table|bar_?table|blackjack_?table|pool_?table|desk|dresser|cabinet|cupboard|wardrobe|shelf|shelves|bookcase|bookshelf|counter|drawer)(?:_|\d|$)/i.test(nl)) {
    return 'wood_case_furniture';
  }
  if (group === 'prop_food') {
    if (/(?:^|_)(stew|soup|broth|tea_?pot|teapot)(?:_|\d|$)/i.test(nl)) {
      return 'food_organic';
    }
    if (/(?:^|_)(pot_02|pot_03|pot_06|pot_07)(?:_|\d|$)/i.test(nl) && /^polygon(?:fantasykingdom|samurai|town)/i.test(nl)) {
      return 'stone_ceramic';
    }
    if (/(?:^|_)(pot|pan|kettle|canteen|thermos|ladle|whisk|spatula|knife|fork|spoon|cauldron|can|tin|tray_metal)(?:_|\d|$)/i.test(nl)) {
      return 'metal_cookware';
    }
    if (/(?:^|_)(cutting_board|wood|tiki)(?:_|\d|$)/i.test(nl)) {
      return 'wood_container';
    }
    return 'food_organic';
  }
  if (group === 'prop_vehicle' || group === 'prop_tech') {
    if (/(?:^|_)(wagon|cart|carriage|canoe|raft|boat|ship|guitar|violin|drum)(?:_|\d|$)/i.test(nl)) {
      return 'wood_tech';
    }
    return 'vehicle_tech';
  }
  return 'general';
}

function classifyColor(r, g, b, matName, domain, normY = 0.5) {
  if (/glass|window|windscreen/i.test(matName || '')) return 'glass:clear';
  const { h, s, l } = rgbToHsl(r, g, b);
  const cc = colorCluster(r, g, b);

  if (domain === 'precious_metal') {
    if (h >= 18 && h <= 62 && s >= 0.22 && l >= 0.28) return 'gold_metal';
    if (s < 0.22 && l >= 0.42) return 'bright_metal';
    if (s < 0.22 && l < 0.42) return 'dark_metal';
    return `painted_color:${cc}`;
  }

  if (domain === 'copper_metal') {
    if (h >= 12 && h <= 58 && s >= 0.20) return `tinted_metal:${cc}`;
    return 'bright_metal';
  }

  if (domain === 'key_hardware') {
    if (h >= 15 && h <= 62 && s >= 0.16 && l >= 0.22) return 'gold_metal';
    if (l >= 0.48) return 'bright_metal';
    if (l >= 0.26) return 'bright_metal';
    return 'dark_metal';
  }

  if (domain === 'gem_crystal') {
    return `gem_metal:${cc}`;
  }

  if (domain === 'ore_mineral') {
    if (h >= 24 && h <= 62 && s >= 0.35 && l >= 0.34) return 'gold_metal';
    if (s >= 0.30 && l >= 0.30) return `gem_metal:${cc}`;
    return 'rock';
  }

  if (domain === 'burlap_sack') {
    if (h >= 14 && h <= 46 && s >= 0.16 && l <= 0.34) return 'leather';
    return 'jute';
  }

  if (domain === 'plastic_bottle') {
    if (l < 0.45 || s >= 0.35 || l >= 0.80) return `painted_color:${cc}`;
    if (s < 0.18) return 'plastic_clear:clear';
    return `plastic_clear:${cc}`;
  }

  if (domain === 'opaque_plastic' || domain === 'water_plastic_barrel') {
    return `painted_color:${cc}`;
  }

  if (domain === 'coffee_carafe') {
    if (s < 0.18 && l >= 0.42) return 'glass:clear';
    if (s < 0.20 && l < 0.42) return 'painted_color:dark';
    return 'glass:clear';
  }

  if (domain === 'glass_vessel') {
    if (normY > 0.72 && h >= 14 && h <= 42 && s >= 0.16 && l <= 0.48) return 'wood';
    if (normY <= 0.72 && h >= 16 && h <= 46 && s >= 0.14 && l >= 0.32 && l <= 0.76) return 'paper_stone';
    if (s < 0.18 && l >= 0.72) return 'paper_stone';
    if (s < 0.16 && l < 0.32) return 'painted_color:dark';
    if (s < 0.16 && l >= 0.32 && l <= 0.65) return 'glass:clear';
    return `glass:${cc === 'white' ? 'clear' : cc}`;
  }

  if (domain === 'book_paper') {
    if (s < 0.28 && l >= 0.62) return 'paper_stone';
    if (h >= 12 && h <= 38 && s >= 0.25 && l >= 0.10 && l <= 0.38) return 'leather';
    return `cloth:${cc}`;
  }

  if (domain === 'porcelain_fixture') {
    if (h >= 34 && h <= 56 && s >= 0.52 && l >= 0.42 && l <= 0.68) return 'gold_metal';
    if (s < 0.18 && l >= 0.26 && l <= 0.58) return 'chrome_metal';
    return `painted_color:${cc === 'grey' ? 'white' : cc}`;
  }

  if (domain === 'stone_ceramic') {
    if (s < 0.22 && l < 0.85) return 'paper_stone';
    return `painted_color:${cc}`;
  }

  if (domain === 'soft_cloth_only') {
    return `cloth:${cc}`;
  }

  if (domain === 'nightclub_seating') {
    if (h >= 10 && h <= 34 && s >= 0.14 && s <= 0.44 && l >= 0.12 && l <= 0.44) return 'wood';
    return `cloth:${cc}`;
  }

  if (domain === 'seating_upholstery') {
    if (h >= 10 && h <= 42 && s >= 0.14 && s <= 0.48 && l >= 0.12 && l <= 0.52) return 'wood';
    if (h >= 12 && h <= 36 && s >= 0.25 && l <= 0.36) return 'leather';
    return `cloth:${cc}`;
  }

  if (domain === 'metal_seating') {
    if (h >= 12 && h <= 36 && s >= 0.25 && l <= 0.36) return 'leather';
    if (s < 0.16 && l >= 0.34 && l < 0.72) return 'bright_metal';
    if (s < 0.16 && l < 0.34) return 'dark_metal';
    return `cloth:${cc}`;
  }

  if (domain === 'scifi_fixture') {
    if (s >= 0.20) return `painted_color:${cc}`;
    if (l >= 0.62) return 'painted_color:white';
    if (l < 0.28) return 'dark_metal';
    return 'bright_metal';
  }

  if (domain === 'wood_case_furniture') {
    if (h >= 10 && h <= 48 && s >= 0.14 && l >= 0.10 && l <= 0.64) return 'wood';
    if (cc === 'green' || cc === 'blue') return `cloth:${cc}`;
    return `painted_color:${cc}`;
  }

  if (domain === 'lighting_hardware') {
    if (h >= 34 && h <= 58 && s >= 0.48 && l >= 0.40 && l <= 0.68) return 'gold_metal';
    if (h >= 14 && h <= 44 && s >= 0.16 && l >= 0.12 && l <= 0.58) return 'wood';
    if (s < 0.18 && l >= 0.46) return 'paper_stone';
    if (s < 0.18 && l < 0.34) return 'dark_metal';
    if (s < 0.18) return 'bright_metal';
    return `painted_color:${cc}`;
  }

  if (domain === 'leather_case') {
    if (h >= 34 && h <= 56 && s >= 0.45 && l >= 0.40) return 'gold_metal';
    if (s < 0.18 && l >= 0.42) return 'chrome_metal';
    if (s < 0.18 && l < 0.30) return 'dark_metal';
    return 'leather';
  }

  if (domain === 'metal_container_tech') {
    if (s < 0.18 && l < 0.34) return 'dark_metal';
    if (s < 0.18 && l >= 0.34 && l < 0.72) return 'bright_metal';
    if (s >= 0.18) return `tinted_metal:${cc}`;
    return 'bright_metal';
  }

  if (domain === 'wood_container') {
    if (h >= 34 && h <= 58 && s >= 0.50 && l >= 0.44 && l <= 0.68) return 'gold_metal';
    if (h >= 10 && h <= 56 && s >= 0.12 && l >= 0.10 && l <= 0.72) return 'wood';
    if (s < 0.15 && l < 0.30) return 'dark_metal';
    if (s < 0.15 && l < 0.68) return 'wood';
    return `painted_color:${cc}`;
  }

  if (domain === 'acoustic_classic') {
    if (h >= 12 && h <= 44 && s >= 0.18 && l >= 0.12 && l <= 0.50) return 'wood';
    if (h >= 24 && h <= 60 && s >= 0.30 && l > 0.42) return 'gold_metal';
    if (s < 0.18 && l >= 0.62) return 'painted_color:white';
    if (s < 0.18 && l < 0.34) return 'painted_color:dark';
    return 'wood';
  }

  if (domain === 'food_organic') {
    if (h >= 15 && h <= 38 && s >= 0.16 && s <= 0.58 && l >= 0.12 && l <= 0.43) return 'wood';
    return `painted_color:${cc}`;
  }

  if (domain === 'metal_cookware') {
    if (h >= 14 && h <= 38 && s >= 0.18 && l >= 0.12 && l <= 0.46) return 'wood';
    if (s < 0.18 && l >= 0.58) return 'bright_metal';
    if (s < 0.20 && l >= 0.34) return 'bright_metal';
    if (s < 0.20 && l < 0.34) return 'dark_metal';
    return `tinted_metal:${cc}`;
  }

  if (domain === 'vehicle_tech') {
    if (s >= 0.18) return `painted_color:${cc}`;
    if (l >= 0.62) return 'painted_color:white';
    if (l < 0.26) return 'painted_color:dark';
    return 'bright_metal';
  }

  if (domain === 'wood_tech') {
    if (h >= 14 && h <= 42 && s >= 0.18 && l >= 0.12 && l <= 0.56) return 'wood';
    if (s >= 0.20) return `painted_color:${cc}`;
    if (l >= 0.62) return 'painted_color:white';
    if (l < 0.26) return 'painted_color:dark';
    return 'bright_metal';
  }

  // 'general': NEVER guess metal from grey/black! Default to wood + painted matte/satin
  if (h >= 34 && h <= 56 && s >= 0.52 && l >= 0.42 && l <= 0.66) return 'gold_metal';
  if (h >= 12 && h <= 46 && s >= 0.14 && l >= 0.12 && l <= 0.62) return 'wood';
  return `painted_color:${cc}`;
}

const SLOT_PRESETS = {
  gold_metal: {
    pbrSlot: 'metal_frosted_fine',
    pbrTint: [1.0, 1.0, 1.0],
    uvScale: 1.5,
    previewFactor: [0.92, 0.72, 0.12, 1],
    metallic: 0.95,
    roughness: 0.15,
  },
  chrome_metal: {
    pbrSlot: 'metal_chrome_silver',
    pbrTint: [0.92, 0.94, 0.96],
    uvScale: 1.5,
    previewFactor: [0.88, 0.90, 0.93, 1],
    metallic: 1.0,
    roughness: 0.10,
  },
  gem_metal: {
    pbrSlot: 'metal_chrome_silver',
    pbrTint: null,
    baseLin: [0.95, 0.95, 0.92],
    maxTint: 1.05,
    satBoost: 1.25,
    uvScale: 1.5,
    previewFactor: null,
    metallic: 1.0,
    roughness: 0.05,
  },
  tinted_metal: {
    pbrSlot: 'metal_brushed_stainless',
    pbrTint: null,
    baseLin: [0.30, 0.30, 0.31],
    maxTint: 2.15,
    satBoost: 1.15,
    uvScale: 1.5,
    previewFactor: null,
    metallic: 0.90,
    roughness: 0.36,
  },
  bright_metal: {
    pbrSlot: 'metal_brushed_stainless',
    pbrTint: [1.05, 1.06, 1.08],
    uvScale: 1.5,
    previewFactor: [0.70, 0.72, 0.75, 1],
    metallic: 0.90,
    roughness: 0.38,
  },
  dark_metal: {
    pbrSlot: 'metal_matte_grey',
    pbrTint: [0.40, 0.41, 0.44],
    uvScale: 1.5,
    previewFactor: [0.24, 0.25, 0.28, 1],
    metallic: 0.80,
    roughness: 0.45,
  },
  wood: {
    pbrSlot: 'wood_floor_01',
    pbrTint: null,
    baseLin: [0.54, 0.54, 0.54],
    maxTint: 1.55,
    uvScale: 1.1,
    previewFactor: null,
    metallic: 0.0,
    roughness: 0.78,
  },
  cloth: {
    pbrSlot: 'fabric_furniture_01',
    pbrTint: null,
    baseLin: [0.60, 0.56, 0.47],
    maxTint: 1.45,
    satBoost: 1.15,
    uvScale: 3.5,
    previewFactor: null,
    metallic: 0.0,
    roughness: 0.80,
  },
  jute: {
    pbrSlot: 'fabric_jute_weave',
    pbrTint: null,
    baseLin: [0.60, 0.48, 0.28],
    maxTint: 1.45,
    uvScale: 3.5,
    previewFactor: null,
    metallic: 0.0,
    roughness: 0.55,
  },
  rock: {
    pbrSlot: 'nature_granite_rock',
    pbrTint: null,
    baseLin: [0.22, 0.19, 0.16],
    maxTint: 1.65,
    uvScale: 2.5,
    previewFactor: null,
    metallic: 0.0,
    roughness: 0.90,
  },
  leather: {
    pbrSlot: 'leather_01',
    pbrTint: [1.35, 1.35, 1.35],
    uvScale: 3.0,
    previewFactor: [0.36, 0.19, 0.08, 1],
    metallic: 0.0,
    roughness: 0.50,
  },
  paper_stone: {
    pbrSlot: 'stucco_wall',
    pbrTint: null,
    baseLin: [0.68, 0.66, 0.62],
    maxTint: 1.28,
    uvScale: 3.0,
    previewFactor: null,
    metallic: 0.0,
    roughness: 0.85,
  },
  painted_color: {
    pbrSlot: 'fabric_cotton_white',
    pbrTint: null,
    baseLin: [0.72, 0.72, 0.71],
    maxTint: 1.28,
    satBoost: 1.15,
    uvScale: 2.5,
    previewFactor: null,
    metallic: 0.0,
    roughness: 0.62,
  },
  glass: {
    pbrSlot: '__special_glass__',
    pbrTint: null,
    baseLin: [0.95, 0.95, 0.95],
    maxTint: 0.98,
    satBoost: 1.25,
    uvScale: 1.5,
    previewFactor: null,
    metallic: 0.0,
    roughness: 0.08,
  },
  plastic_clear: {
    pbrSlot: '__special_plastic_clear__',
    pbrTint: null,
    baseLin: [0.95, 0.95, 0.95],
    maxTint: 0.98,
    satBoost: 1.15,
    uvScale: 1.5,
    previewFactor: null,
    metallic: 0.0,
    roughness: 0.28,
  },
  emissive: {
    pbrSlot: '__special_emissive__',
    pbrTint: [1, 1, 1],
    uvScale: 1.0,
    previewFactor: null,
    metallic: 0.0,
    roughness: 0.2,
  },
};

function transformPoint(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

const textureCache = new Map();
async function decodeTextureCached(tex) {
  if (!tex) return null;
  const bytes = tex.getImage();
  if (!bytes || !bytes.length) return null;
  const hash = createHash('sha1').update(bytes).digest('hex');
  if (textureCache.has(hash)) return textureCache.get(hash);
  const decoded = await sharp(Buffer.from(bytes)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const entry = { data: decoded.data, width: decoded.info.width, height: decoded.info.height };
  textureCache.set(hash, entry);
  return entry;
}

function makeModelId(filename) {
  return 'prop_' + path.basename(filename, '.glb').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function computeBoundsWithSphere(doc) {
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const bounds = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
  const size = [0, 1, 2].map((i) => +Math.max(1e-4, bounds.max[i] - bounds.min[i]).toFixed(4));
  const center = [0, 1, 2].map((i) => +((bounds.max[i] + bounds.min[i]) * 0.5).toFixed(4));
  const boundingSphereRadius = +Math.hypot(size[0] * 0.5, size[1] * 0.5, size[2] * 0.5).toFixed(4);
  return {
    bounds: { size, center, boundingSphereRadius, minY: +bounds.min[1].toFixed(4) },
    collider: { type: 'box', size, pos: center },
  };
}

async function processPropGlb({ srcFile, group, srcDir, io, catalogMeta }) {
  const srcDoc = await io.read(path.join(srcDir, 'static_models', srcFile));
  const assetDomain = getAssetDomain(group, path.basename(srcFile, '.glb'));

  const rawTris = [];
  const vertFaces = new Map();
  const posKey = (pt) => `${Math.round(pt[0] * 2000)},${Math.round(pt[1] * 2000)},${Math.round(pt[2] * 2000)}`;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  let primSeq = 0;
  let maxY = -Infinity;
  for (const node of srcDoc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const worldMat = node.getWorldMatrix();

    for (const prim of mesh.listPrimitives()) {
      const curPrimIdx = primSeq++;
      const posAcc = prim.getAttribute('POSITION');
      if (!posAcc) continue;
      const uvAcc = prim.getAttribute('TEXCOORD_0');
      const idxAcc = prim.getIndices();
      const srcMat = prim.getMaterial();
      const matName = srcMat?.getName() || '';
      const isMatEnergy = /emissive|glow|neon/i.test(matName);
      const texDecoded = await decodeTextureCached(srcMat?.getBaseColorTexture() || null);
      const emDecoded = await decodeTextureCached(srcMat?.getEmissiveTexture() || null);

      const sampleDecoded = (decoded, u, v) => {
        const cu = ((u % 1) + 1) % 1;
        const cv = ((v % 1) + 1) % 1;
        const px = Math.min(decoded.width - 1, Math.floor(cu * decoded.width));
        const py = Math.min(decoded.height - 1, Math.floor(cv * decoded.height));
        const off = (py * decoded.width + px) * 4;
        return [decoded.data[off], decoded.data[off + 1], decoded.data[off + 2]];
      };

      const BARY_SAMPLES = [
        [1 / 3, 1 / 3, 1 / 3],
        [0.6, 0.2, 0.2],
        [0.2, 0.6, 0.2],
        [0.2, 0.2, 0.6],
        [0.45, 0.45, 0.1],
        [0.45, 0.1, 0.45],
        [0.1, 0.45, 0.45],
      ];

      const sampleTriMedoid = (decoded, uv0, uv1, uv2, uvSpan) => {
        if (uvSpan <= 0.002) {
          return sampleDecoded(decoded, (uv0[0] + uv1[0] + uv2[0]) / 3, (uv0[1] + uv1[1] + uv2[1]) / 3);
        }
        const pts = BARY_SAMPLES.map(([a, b, c]) =>
          sampleDecoded(
            decoded,
            a * uv0[0] + b * uv1[0] + c * uv2[0],
            a * uv0[1] + b * uv1[1] + c * uv2[1],
          ),
        );
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < pts.length; i++) {
          let sum = 0;
          for (let j = 0; j < pts.length; j++) {
            sum += Math.abs(pts[i][0] - pts[j][0]) + Math.abs(pts[i][1] - pts[j][1]) + Math.abs(pts[i][2] - pts[j][2]);
          }
          if (sum < bestDist) {
            bestDist = sum;
            bestIdx = i;
          }
        }
        return pts[bestIdx];
      };

      const triCount = idxAcc ? Math.floor(idxAcc.getCount() / 3) : Math.floor(posAcc.getCount() / 3);
      for (let t = 0; t < triCount; t++) {
        const i0 = idxAcc ? idxAcc.getScalar(t * 3) : t * 3;
        const i1 = idxAcc ? idxAcc.getScalar(t * 3 + 1) : t * 3 + 1;
        const i2 = idxAcc ? idxAcc.getScalar(t * 3 + 2) : t * 3 + 2;

        const p0 = transformPoint(worldMat, posAcc.getElement(i0, [0, 0, 0]));
        const p1 = transformPoint(worldMat, posAcc.getElement(i1, [0, 0, 0]));
        const p2 = transformPoint(worldMat, posAcc.getElement(i2, [0, 0, 0]));

        for (const pt of [p0, p1, p2]) {
          if (pt[0] < minX) minX = pt[0];
          if (pt[0] > maxX) maxX = pt[0];
          if (pt[1] < minY) minY = pt[1];
          if (pt[1] > maxY) maxY = pt[1];
          if (pt[2] < minZ) minZ = pt[2];
          if (pt[2] > maxZ) maxZ = pt[2];
        }

        let r = 165;
        let g = 165;
        let b = 165;
        let isEmissive = isMatEnergy;
        let er = 255;
        let eg = 220;
        let eb = 140;
        let uvs = null;
        let uvSpan = 0;

        if (uvAcc) {
          const uv0 = uvAcc.getElement(i0, [0, 0]);
          const uv1 = uvAcc.getElement(i1, [0, 0]);
          const uv2 = uvAcc.getElement(i2, [0, 0]);
          uvs = [uv0, uv1, uv2];
          uvSpan = Math.max(
            Math.abs(uv0[0] - uv1[0]), Math.abs(uv1[0] - uv2[0]), Math.abs(uv0[0] - uv2[0]),
            Math.abs(uv0[1] - uv1[1]), Math.abs(uv1[1] - uv2[1]), Math.abs(uv0[1] - uv2[1]),
          );
          const cu = (uv0[0] + uv1[0] + uv2[0]) / 3;
          const cv = (uv0[1] + uv1[1] + uv2[1]) / 3;

          if (texDecoded) [r, g, b] = sampleTriMedoid(texDecoded, uv0, uv1, uv2, uvSpan);
          if (emDecoded) {
            const [ceR, ceG, ceB] = sampleDecoded(emDecoded, cu, cv);
            if (Math.max(ceR, ceG, ceB) > 95 && ceR + ceG + ceB > 180) {
              isEmissive = true;
              er = ceR;
              eg = ceG;
              eb = ceB;
            }
          }
        }

        rawTris.push({
          p0,
          p1,
          p2,
          baseR: r,
          baseG: g,
          baseB: b,
          r: isEmissive ? er : r,
          g: isEmissive ? eg : g,
          b: isEmissive ? eb : b,
          matName,
          slotKey: 'pending',
          isEmissive,
          primIdx: curPrimIdx,
          uvs,
          uvSpan,
        });
      }
    }
  }

  if (rawTris.length === 0) return null;

  if (group === 'prop_vehicle') {
    const emCount = rawTris.filter((t) => t.isEmissive).length;
    if (emCount > rawTris.length * 0.18) {
      for (const tri of rawTris) {
        if (tri.isEmissive) {
          tri.isEmissive = false;
          tri.r = tri.baseR;
          tri.g = tri.baseG;
          tri.b = tri.baseB;
        }
      }
    }
  }

  const heightY = Math.max(1e-4, maxY - minY);
  for (const tri of rawTris) {
    const normY = ((tri.p0[1] + tri.p1[1] + tri.p2[1]) / 3 - minY) / heightY;
    tri.slotKey = tri.isEmissive ? 'emissive' : classifyColor(tri.baseR, tri.baseG, tri.baseB, tri.matName, assetDomain, normY);
  }

  const offX = (minX + maxX) * 0.5;
  const offY = minY;
  const offZ = (minZ + maxZ) * 0.5;

  for (const tri of rawTris) {
    for (const pt of [tri.p0, tri.p1, tri.p2]) {
      pt[0] -= offX;
      pt[1] -= offY;
      pt[2] -= offZ;
    }
    const ax = tri.p1[0] - tri.p0[0];
    const ay = tri.p1[1] - tri.p0[1];
    const az = tri.p1[2] - tri.p0[2];
    const bx = tri.p2[0] - tri.p0[0];
    const by = tri.p2[1] - tri.p0[1];
    const bz = tri.p2[2] - tri.p0[2];
    const cx = ay * bz - az * by;
    const cy = az * bx - ax * bz;
    const cz = ax * by - ay * bx;
    const area2 = Math.hypot(cx, cy, cz);
    tri.fn = area2 > 1e-10 ? [cx / area2, cy / area2, cz / area2] : [0, 0, 1];
    tri.area2 = area2;
    tri.ks = [posKey(tri.p0), posKey(tri.p1), posKey(tri.p2)];
    for (const k of tri.ks) {
      let list = vertFaces.get(k);
      if (!list) {
        list = [];
        vertFaces.set(k, list);
      }
      list.push(tri);
    }
  }

  const COS_CREASE = Math.cos((64 * Math.PI) / 180);
  function smoothNormalForCorner(tri, cornerKey) {
    const neighbors = vertFaces.get(cornerKey);
    if (!neighbors || neighbors.length <= 1) return tri.fn;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const nb of neighbors) {
      const dot = tri.fn[0] * nb.fn[0] + tri.fn[1] * nb.fn[1] + tri.fn[2] * nb.fn[2];
      if (dot >= COS_CREASE) {
        const w = Math.max(nb.area2, 1e-8);
        sx += nb.fn[0] * w;
        sy += nb.fn[1] * w;
        sz += nb.fn[2] * w;
      }
    }
    const len = Math.hypot(sx, sy, sz);
    return len > 1e-10 ? [sx / len, sy / len, sz / len] : tri.fn;
  }

  // Unify coplanar continuous wide-UV textured patches so printed 2D graphics/decals
  // never tear across diagonal split-quad triangles.
  const nTris = rawTris.length;
  const parent = Int32Array.from({ length: nTris }, (_, i) => i);
  const findRoot = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const unionTris = (a, b) => {
    const ra = findRoot(a);
    const rb = findRoot(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const COS_PATCH = Math.cos((25 * Math.PI) / 180);
  const edgeFirst = new Map();
  for (let ti = 0; ti < nTris; ti++) {
    const tri = rawTris[ti];
    if (tri.isEmissive || !tri.uvs || tri.uvSpan <= 0.003) continue;
    for (let e = 0; e < 3; e++) {
      const ka = tri.ks[e];
      const kb = tri.ks[(e + 1) % 3];
      const ek = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const ua = tri.uvs[e];
      const ub = tri.uvs[(e + 1) % 3];
      const prev = edgeFirst.get(ek);
      if (prev) {
        const pt = rawTris[prev.ti];
        if (pt.primIdx === tri.primIdx) {
          const dot = pt.fn[0] * tri.fn[0] + pt.fn[1] * tri.fn[1] + pt.fn[2] * tri.fn[2];
          if (dot >= COS_PATCH) {
            const pUa = prev.ka === ka ? prev.ua : prev.ub;
            const pUb = prev.ka === ka ? prev.ub : prev.ua;
            const uvDiff = Math.max(
              Math.abs(pUa[0] - ua[0]),
              Math.abs(pUa[1] - ua[1]),
              Math.abs(pUb[0] - ub[0]),
              Math.abs(pUb[1] - ub[1]),
            );
            if (uvDiff < 0.005) unionTris(prev.ti, ti);
          }
        }
      } else {
        edgeFirst.set(ek, { ti, ka, kb, ua, ub });
      }
    }
  }
  const patches = new Map();
  for (let ti = 0; ti < nTris; ti++) {
    const tri = rawTris[ti];
    if (tri.isEmissive || !tri.uvs || tri.uvSpan <= 0.003) continue;
    const root = findRoot(ti);
    let grp = patches.get(root);
    if (!grp) {
      grp = [];
      patches.set(root, grp);
    }
    grp.push(tri);
  }
  for (const grp of patches.values()) {
    if (grp.length < 2) continue;
    const stats = new Map();
    for (const tri of grp) {
      const w = Math.max(tri.area2, 1e-6);
      let s = stats.get(tri.slotKey);
      if (!s) {
        s = { w: 0, rw: 0, gw: 0, bw: 0 };
        stats.set(tri.slotKey, s);
      }
      s.w += w;
      s.rw += tri.r * w;
      s.gw += tri.g * w;
      s.bw += tri.b * w;
    }
    if (stats.size <= 1) continue;
    let winKey = null;
    let winStat = null;
    for (const [k, s] of stats.entries()) {
      if (!winStat || s.w > winStat.w) {
        winKey = k;
        winStat = s;
      }
    }
    const wr = winStat.rw / winStat.w;
    const wg = winStat.gw / winStat.w;
    const wb = winStat.bw / winStat.w;
    for (const tri of grp) {
      tri.slotKey = winKey;
      tri.r = wr;
      tri.g = wg;
      tri.b = wb;
    }
  }

  const baseKey = (k) => k.split(':')[0];
  const slotCounts = new Map();
  for (const tri of rawTris) slotCounts.set(tri.slotKey, (slotCounts.get(tri.slotKey) || 0) + 1);
  if (slotCounts.size > 6) {
    const pinned = [...slotCounts.keys()].filter((k) => k === 'emissive' || baseKey(k) === 'glass' || baseKey(k) === 'plastic_clear').slice(0, 2);
    const rest = [...slotCounts.entries()]
      .filter(([k]) => !pinned.includes(k))
      .sort((a, b) => b[1] - a[1]);
    const keepList = [...pinned, ...rest.slice(0, Math.max(1, 6 - pinned.length)).map(([k]) => k)];
    const keepSet = new Set(keepList);
    const remap = new Map();
    for (const [dropKey] of slotCounts.entries()) {
      if (keepSet.has(dropKey)) continue;
      const sameFamily = keepList.find((k) => k !== 'emissive' && baseKey(k) === baseKey(dropKey));
      remap.set(dropKey, sameFamily || rest[0]?.[0] || pinned[0]);
    }
    for (const tri of rawTris) {
      if (!keepSet.has(tri.slotKey)) tri.slotKey = remap.get(tri.slotKey);
    }
  }

  const buckets = new Map();
  for (const tri of rawTris) {
    let bkt = buckets.get(tri.slotKey);
    if (!bkt) {
      bkt = { pos: [], norm: [], uv: [], rSum: 0, gSum: 0, bSum: 0, count: 0 };
      buckets.set(tri.slotKey, bkt);
    }
    bkt.rSum += tri.r;
    bkt.gSum += tri.g;
    bkt.bSum += tri.b;
    bkt.count++;

    const preset = SLOT_PRESETS[baseKey(tri.slotKey)];
    const s = preset.uvScale;
    const anx = Math.abs(tri.fn[0]);
    const any = Math.abs(tri.fn[1]);
    const anz = Math.abs(tri.fn[2]);
    const project = (pt) => {
      if (anx >= any && anx >= anz) return [pt[2] * s, pt[1] * s];
      if (any >= anx && any >= anz) return [pt[0] * s, pt[2] * s];
      return [pt[0] * s, pt[1] * s];
    };

    const sn0 = smoothNormalForCorner(tri, tri.ks[0]);
    const sn1 = smoothNormalForCorner(tri, tri.ks[1]);
    const sn2 = smoothNormalForCorner(tri, tri.ks[2]);
    const tuv0 = project(tri.p0);
    const tuv1 = project(tri.p1);
    const tuv2 = project(tri.p2);

    bkt.pos.push(...tri.p0, ...tri.p1, ...tri.p2);
    bkt.norm.push(...sn0, ...sn1, ...sn2);
    bkt.uv.push(...tuv0, ...tuv1, ...tuv2);
  }

  const outDoc = new Document();
  const outBuf = outDoc.createBuffer();
  const outMesh = outDoc.createMesh('mesh_lod0');
  const outNode = outDoc.createNode('mesh_lod0').setMesh(outMesh).setExtras({ lodLevel: 0 });
  const outScene = outDoc.createScene('Scene').addChild(outNode);
  outDoc.getRoot().setDefaultScene(outScene);

  const slotMap = {};
  const emissiveSubmeshes = [];
  for (const [slotKey, bkt] of buckets.entries()) {
    const pKey = baseKey(slotKey);
    const preset = SLOT_PRESETS[pKey];
    const avgR = bkt.rSum / bkt.count;
    const avgG = bkt.gSum / bkt.count;
    const avgB = bkt.bSum / bkt.count;

    let mat;
    if (slotKey === 'emissive') {
      const isScreen = /(monitor|tv|laptop|screen|computer_setup)/i.test(srcFile);
      const emCol = [
        +Math.max(0.02, Math.min(1, avgR / 255)).toFixed(3),
        +Math.max(0.02, Math.min(1, avgG / 255)).toFixed(3),
        +Math.max(0.02, Math.min(1, avgB / 255)).toFixed(3),
      ];
      mat = outDoc.createMaterial('emissive::prop_glow')
        .setBaseColorFactor([...emCol, 1])
        .setEmissiveFactor(emCol)
        .setMetallicFactor(0.0)
        .setRoughnessFactor(0.2)
        .setExtras({
          emissivePure: true,
          pbrSlot: '__special_emissive__',
          pbrEmissiveColor: emCol,
          pbrEmissiveStrength: isScreen ? 1.05 : 2.0,
        });
      emissiveSubmeshes.push('emissive');
      slotMap[slotKey] = '__special_emissive__';
    } else {
      let tint = preset.pbrTint;
      let previewFactor = preset.previewFactor;
      if (!tint) {
        let rLin = (avgR / 255) ** 2.2;
        let gLin = (avgG / 255) ** 2.2;
        let bLin = (avgB / 255) ** 2.2;
        if (preset.satBoost && preset.satBoost > 1) {
          const meanL = (rLin + gLin + bLin) / 3;
          rLin = Math.max(0.015, meanL + (rLin - meanL) * preset.satBoost);
          gLin = Math.max(0.015, meanL + (gLin - meanL) * preset.satBoost);
          bLin = Math.max(0.015, meanL + (bLin - meanL) * preset.satBoost);
        }
        const [bR, bG, bB] = preset.baseLin || [0.72, 0.72, 0.71];
        const maxTint = preset.maxTint || 1.35;
        if (slotKey === 'glass:clear' || slotKey === 'glass:grey' || slotKey === 'glass:white') {
          tint = [0.84, 0.92, 0.97];
        } else if (slotKey === 'plastic_clear:clear' || slotKey === 'plastic_clear:grey' || slotKey === 'plastic_clear:white') {
          tint = [0.86, 0.91, 0.95];
        } else if (slotKey === 'rock') {
          tint = [0.88, 0.85, 0.80];
        } else {
          tint = [
            +Math.min(maxTint, rLin / bR).toFixed(3),
            +Math.min(maxTint, gLin / bG).toFixed(3),
            +Math.min(maxTint, bLin / bB).toFixed(3),
          ];
        }
        const prevAlpha = pKey === 'glass' ? 0.40 : pKey === 'plastic_clear' ? 0.56 : 1;
        previewFactor = [
          +Math.min(1, avgR / 255).toFixed(3),
          +Math.min(1, avgG / 255).toFixed(3),
          +Math.min(1, avgB / 255).toFixed(3),
          prevAlpha,
        ];
      }

      mat = outDoc.createMaterial(`slot::${slotKey}`)
        .setBaseColorFactor(previewFactor)
        .setMetallicFactor(preset.metallic)
        .setRoughnessFactor(preset.roughness)
        .setExtras({ pbrSlot: preset.pbrSlot, pbrTint: tint });
      if (pKey === 'glass' || pKey === 'plastic_clear') mat.setAlphaMode('BLEND');

      slotMap[slotKey.replace(':', '_')] = preset.pbrSlot;
    }

    const posAcc = outDoc.createAccessor().setType('VEC3').setArray(new Float32Array(bkt.pos)).setBuffer(outBuf);
    const normAcc = outDoc.createAccessor().setType('VEC3').setArray(new Float32Array(bkt.norm)).setBuffer(outBuf);
    const uvAcc = outDoc.createAccessor().setType('VEC2').setArray(new Float32Array(bkt.uv)).setBuffer(outBuf);

    const prim = outDoc.createPrimitive()
      .setAttribute('POSITION', posAcc)
      .setAttribute('NORMAL', normAcc)
      .setAttribute('TEXCOORD_0', uvAcc)
      .setMaterial(mat);
    outMesh.addPrimitive(prim);
  }

  outDoc.getRoot().setExtras({
    tier: 'T_PROP',
    textureMode: 'array_override',
    pbrSlotMap: slotMap,
  });

  await outDoc.transform(
    weld(),
    dedup(),
    prune({ keepAttributes: true }),
    quantize(),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );

  const pack = catalogMeta?.pack || srcFile.split('__')[0] || 'Prop';
  const assetName = catalogMeta?.assetName || path.basename(srcFile, '.glb').split('__').slice(1).join('__') || path.basename(srcFile, '.glb');
  const id = makeModelId(srcFile);

  const outGlb = path.join(BUILT_MODELS_DIR, group, `${id}.glb`);
  await mkdir(path.dirname(outGlb), { recursive: true });
  const glbBytes = await io.writeBinary(outDoc);
  await writeFile(outGlb, glbBytes);

  let gpuVerts = 0;
  let tris = 0;
  let submeshes = 0;
  for (const prim of outMesh.listPrimitives()) {
    submeshes++;
    const idx = prim.getIndices();
    const pos = prim.getAttribute('POSITION');
    gpuVerts += pos ? pos.getCount() : 0;
    tris += idx ? Math.round(idx.getCount() / 3) : Math.round((pos ? pos.getCount() : 0) / 3);
  }

  const { bounds, collider } = computeBoundsWithSphere(outDoc);
  const relGlbPath = path.relative(path.join(ROOT, 'built'), outGlb).replaceAll('\\', '/');
  const fileKB = +(glbBytes.length / 1024).toFixed(2);

  const shortPack = pack.replace(/^Polygon_?/, '');
  const meta = {
    id,
    name: makeFriendlyName(pack, assetName),
    nameEn: makeFriendlyNameEn(pack, assetName),
    group,
    tier: 'T_PROP',
    kind: group.replace('prop_', ''),
    quadrants: [],
    tags: ['prop', shortPack.toLowerCase(), PACK_ZH[shortPack] || '', group].filter(Boolean),
    materialMode: 'array_override',
    materialSlots: slotMap,
    hasComplexEmissive: false,
    bounds,
    collider,
    pivots: [],
    emissiveSubmeshes,
    sockets: [],
    path: relGlbPath,
    fileKB,
    lods: [
      {
        level: 0,
        node: 'mesh_lod0',
        tris,
        gpuVerts,
        submeshes,
        minScreenRatio: 0.005,
      },
    ],
    license: 'local-prop-pbr',
  };

  await writeFile(outGlb.replace(/\.glb$/i, '.meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

async function main() {
  const { srcDir, limit } = parseArgs(process.argv.slice(2));
  if (!srcDir || !existsSync(path.join(srcDir, 'static_models'))) {
    throw new Error('Missing --src <exportRoot> (or HGAME_UNREAL_EXPORT_ROOT) containing static_models/');
  }

  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions([KHRMeshQuantization, EXTMeshoptCompression])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

  const catalogPath = path.join(srcDir, 'catalog.json');
  const catalogById = new Map();
  if (existsSync(catalogPath)) {
    const cat = JSON.parse(await readFile(catalogPath, 'utf8'));
    for (const sm of cat.staticModels || []) {
      catalogById.set(`${sm.id}.glb`, sm);
    }
  }

  const allFiles = (await readdir(path.join(srcDir, 'static_models')))
    .map((f) => ({ file: f, group: classifyPropGroup(f) }))
    .filter((x) => x.group !== null)
    .sort((a, b) => {
      const penalty = (f) => (/_(Preset|Static)\.glb$/i.test(f) ? 2 : 0);
      const pa = penalty(a.file);
      const pb = penalty(b.file);
      if (pa !== pb) return pa - pb;
      return a.file.localeCompare(b.file);
    });

  const targets = limit > 0 ? allFiles.slice(0, limit) : allFiles;
  let ok = 0;
  let skippedDup = 0;
  let totalBytes = 0;
  const groupCounts = {};
  const seenGeoSigs = new Set();

  for (let i = 0; i < targets.length; i++) {
    const { file, group } = targets[i];
    const meta = await processPropGlb({
      srcFile: file,
      group,
      srcDir,
      io,
      catalogMeta: catalogById.get(file) || null,
    });
    if (meta) {
      const sortedSize = [...meta.bounds.size].sort((a, b) => a - b).map((v) => Math.round(v * 100)).join(',');
      const geoSig = `${meta.lods[0].tris}|${sortedSize}`;
      if (seenGeoSigs.has(geoSig)) {
        const dupGlb = path.join(ROOT, 'built', meta.path);
        await unlink(dupGlb).catch(() => {});
        await unlink(dupGlb.replace(/\.glb$/i, '.meta.json')).catch(() => {});
        skippedDup++;
      } else {
        seenGeoSigs.add(geoSig);
        ok++;
        totalBytes += Math.round(meta.fileKB * 1024);
        groupCounts[meta.group] = (groupCounts[meta.group] || 0) + 1;
      }
    }
    if ((i + 1) % 150 === 0 || i + 1 === targets.length) {
      console.log(`[props:ingest] ${i + 1}/${targets.length} processed (${ok} kept, ${skippedDup} dupes skipped, ${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
    }
  }
  console.log('[props:ingest] Groups:', groupCounts);
}

main().catch((err) => {
  console.error('[props:ingest] FAILED:', err);
  process.exit(1);
});
