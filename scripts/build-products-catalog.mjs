/**
 * Builds src/products.js from FGP Midwest master price sheet (PDF pages 1–4).
 * Run: node scripts/build-products-catalog.mjs
 */
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, "../src/products.js");

/** @typedef {{ key: string, name: string, category: string, pricingModel?: string, kits: object[] }} ProductDef */

/** Main products: explicit tier kit totals from master columns. */
function mainKit(size, gals, lbs, msrp, small, tier2, preferred) {
  const kit = { size, msrp, tierPrices: { small, tier2, preferred } };
  if (gals != null) kit.gals = gals;
  if (lbs != null) kit.lbs = lbs;
  return kit;
}

/** Ancillaries: small/tier2 = MSRP; preferred = EIN column (5% off). */
function ancKit(size, msrp, preferred, extra = {}) {
  return { size, msrp, tierPrices: { preferred }, pricingModel: "accessory", ...extra };
}

/** @type {ProductDef[]} */
const CATALOG = [
  // ─── EPOXY (page 1) ───────────────────────────────────────────────────────
  { key: "hyperbond_clear", name: "HyperBOND (Clear)", category: "epoxy", kits: [mainKit("15 gal", 15, null, 870, 826.5, 783, 739.4), mainKit("3 gal", 3, null, 195, 185.25, 175.5, 165.75)] },
  { key: "hyperbond_medium_gray", name: "HyperBOND (Medium Gray)", category: "epoxy", kits: [mainKit("15 gal", 15, null, 900, 855, 810, 765), mainKit("3 gal", 3, null, 201, 190.95, 180.9, 170.85)] },
  { key: "hyperbond_sable_gray", name: "HyperBOND (Sable Gray)", category: "epoxy", kits: [mainKit("15 gal", 15, null, 900, 855, 810, 765), mainKit("3 gal", 3, null, 201, 190.95, 180.9, 170.85)] },
  { key: "hyperbond_tan", name: "HyperBOND (Tan)", category: "epoxy", kits: [mainKit("15 gal", 15, null, 900, 855, 810, 765), mainKit("3 gal", 3, null, 201, 190.95, 180.9, 170.85)] },
  { key: "dt454_clear", name: "DT 454 (Clear) — Turbo same $", category: "epoxy", kits: [mainKit("15 gal", 15, null, 975, 926.25, 877.5, 828.75), mainKit("3 gal", 3, null, 210, 199.5, 189, 178.5)] },
  { key: "hyperrez_uv", name: "HyperREZ UV", category: "epoxy", kits: [mainKit("15 gal", 15, null, 975, 926.25, 877.5, 828.75), mainKit("3 gal", 3, null, 210, 199.5, 189, 178.5)] },
  { key: "mv2112", name: "MV 2112", category: "epoxy", kits: [mainKit("15 gal", 15, null, 1575, 1496.25, 1417.5, 1338.75), mainKit("3 gal", 3, null, 360, 342, 324, 306)] },
  { key: "hyperflex", name: "HyperFLEX", category: "epoxy", kits: [mainKit("10 gal", 10, null, 750, 712.5, 675, 637.5), mainKit("2 gal", 2, null, 166, 157.7, 149.4, 141.1)] },
  { key: "hyperflow", name: "HyperFLOW", category: "epoxy", kits: [mainKit("15 gal", 15, null, 995, 945.25, 895.5, 845.75), mainKit("3 gal", 3, null, 210, 199.5, 189, 178.5)] },
  { key: "hyperprime_mvb", name: "HyperPrime MVB — Clear", category: "epoxy", kits: [mainKit("15 gal", 15, null, 855, 812.25, 769.5, 726.75), mainKit("3 gal", 3, null, 177, 168.15, 159.3, 150.45)] },
  { key: "hyperprime_mvb_pig", name: "HyperPrime MVB — Pigmented", category: "epoxy", kits: [mainKit("15 gal", 15, null, 960, 912, 864, 816), mainKit("3 gal", 3, null, 195, 185.25, 175.5, 165.75)] },
  { key: "hydroprime_40", name: "HydroPrime 40", category: "epoxy", kits: [mainKit("2 gal", 2, null, 165, 156.75, 148.5, 140.25), mainKit("10 gal", 10, null, 924.68, 878.45, 832.21, 785.98)] },

  // ─── POLYASPARTIC (page 1) ────────────────────────────────────────────────
  { key: "aspartic85_slow", name: "Aspartic 85 Slow Go", category: "polyaspartic", kits: [mainKit("15 gal", 15, null, 1425, 1353.75, 1282.5, 1211.25), mainKit("3 gal", 3, null, 295, 280.25, 265.5, 250.75)] },
  { key: "aspartic85_slow_low", name: "Aspartic 85 Slow Go (Low Odor)", category: "polyaspartic", kits: [mainKit("15 gal", 15, null, 1475, 1401.25, 1327.5, 1253.75), mainKit("3 gal", 3, null, 300, 285, 270, 255)] },
  { key: "aspartic85_fast", name: "Aspartic 85 Fast Cure", category: "polyaspartic", kits: [mainKit("15 gal", 15, null, 1425, 1353.75, 1282.5, 1211.25), mainKit("3 gal", 3, null, 295, 280.25, 265.5, 250.75)] },
  { key: "aspartic85_fast_low", name: "Aspartic 85 Fast Cure (Low Odor)", category: "polyaspartic", kits: [mainKit("15 gal", 15, null, 1475, 1401.25, 1327.5, 1253.75), mainKit("3 gal", 3, null, 300, 285, 270, 255)] },
  { key: "aspartic100", name: "Aspartic 100", category: "polyaspartic", kits: [mainKit("15 gal", 15, null, 1550, 1472.5, 1395, 1317.5), mainKit("3 gal", 3, null, 325, 308.75, 292.5, 276.25)] },

  // ─── POLYUREA (page 1) ────────────────────────────────────────────────────
  { key: "polyurea_slow", name: "Polyurea Basecoat (Slow)", category: "polyurea", kits: [mainKit("15 gal", 15, null, 750, 712.5, 675, 637.5), mainKit("3 gal", 3, null, 156, 148.2, 140.4, 132.6)] },
  { key: "polyurea_med", name: "Polyurea Basecoat (Medium)", category: "polyurea", kits: [mainKit("15 gal", 15, null, 750, 684, 648, 612), mainKit("3 gal", 3, null, 156, 142.5, 135, 127.5)] },
  { key: "polyurea_fast", name: "Polyurea Basecoat (Fast)", category: "polyurea", kits: [mainKit("15 gal", 15, null, 750, 712.5, 675, 637.5), mainKit("3 gal", 3, null, 156, 148.2, 140.4, 132.6)] },

  // ─── URETHANE (page 1) ───────────────────────────────────────────────────
  { key: "h20_ziothane_gloss", name: "H20 Ziothane (Gloss)", category: "urethane", kits: [mainKit("15 gal", 15, null, 1450, 1377.5, 1305, 1232.5), mainKit("3 gal", 3, null, 330, 313.5, 297, 280.5)] },
  { key: "h20_ziothane_low_gloss", name: "H20 Ziothane (Low Gloss)", category: "urethane", kits: [mainKit("15 gal", 15, null, 1450, 1377.5, 1305, 1232.5), mainKit("3 gal", 3, null, 330, 313.5, 297, 280.5)] },
  { key: "ez_top_85", name: "E-Z Top 85", category: "urethane", kits: [mainKit("1 gal", 1, null, 158.8, 130.77, 121.43, 112.09)] },
  { key: "wearmax", name: "WearMax (goes in E-Z Top 85)", category: "urethane", pricingModel: "accessory", kits: [mainKit("1 unit", 0, null, 26.74, 22.02, 20.45, 18.88)] },

  // ─── REPAIR (page 2) ──────────────────────────────────────────────────────
  { key: "hypercure", name: "HyperCURE", category: "repair", kits: [mainKit("0.5 gal", 0.5, null, 100.1, 94.5, 87.5, 81.9)] },
  { key: "pe85_joint_fill", name: "PE-85 (Twin Tube Polyurea Joint Fill)", category: "repair", kits: [mainKit("22 oz", 0, null, 111.54, 52.65, 48.75, 45.63)] },
  { key: "patch_pro_10x", name: "Patch Pro 10X (ET)", category: "repair", kits: [mainKit("2 gal", 2, null, 146.07, 133.41, 126.59, 119.78)] },

  // ─── FLAKE (page 2) ───────────────────────────────────────────────────────
  { key: "flake_vinyl_quarter", name: 'Vinyl — 1/4" (stocking colors)', category: "flake", kits: [mainKit("40lb box", 0, 40, 95, 90.25, 85.5, 80.75)] },
  { key: "flake_vinyl_eighth", name: 'Vinyl — 1/8" (stocking colors)', category: "flake", kits: [mainKit("40lb box", 0, 40, 99, 94.05, 89.1, 84.15)] },
  { key: "flake_hybrid", name: "Hybrid", category: "flake", kits: [mainKit("40lb box", 0, 40, 122, 115.9, 109.8, 103.7)] },
  { key: "flake_marble", name: "Marble", category: "flake", kits: [mainKit("40lb box", 0, 40, 99, 94.05, 89.1, 84.15)] },
  { key: "flake_mica", name: "Mica", category: "flake", kits: [mainKit("10lb box", 0, 10, 250, 237.5, 225, 212.5)] },
  { key: "permaseal_clear", name: "Permaseal — Clear Urethane (5 Gal Pail)", category: "flake", kits: [mainKit("5 gal pail", 5, null, 336.45, 302.81, 289.35, 269.16)] },
  { key: "flake_fan_deck", name: "Small Fan Deck — Color Deck of Flakes - FGP", category: "flake", kits: [mainKit("1 deck", 0, null, 52.5, 47.95, 45.5, 43.05)] },
  { key: "flake_suitcase", name: "Large Suitcase Colors — All Color options & Misc. Floors", category: "flake", kits: [mainKit("1 suitcase", 0, null, 298.5, 272.63, 258.7, 244.77)] },

  // ─── E-POLY PIGMENT (page 3) — ancillary preferred = EIN column ───────────
  { key: "epoly_pigment_black", name: "E-Poly Pigment — Black", category: "epoly_pigment", pricingModel: "accessory", kits: [ancKit("32oz", 39.8, 37.81, { gals: 0.25 })] },
  { key: "epoly_pigment_metal_gray", name: "E-Poly Pigment — Metal Gray", category: "epoly_pigment", pricingModel: "accessory", kits: [ancKit("32oz", 40.2, 38.19, { gals: 0.25 })] },
  { key: "epoly_pigment_medium_gray", name: "E-Poly Pigment — Medium Gray", category: "epoly_pigment", pricingModel: "accessory", kits: [ancKit("32oz", 40.9, 38.86, { gals: 0.25 })] },
  { key: "epoly_pigment_sable_gray", name: "E-Poly Pigment — Sable Gray", category: "epoly_pigment", pricingModel: "accessory", kits: [ancKit("32oz", 44.3, 42.09, { gals: 0.25 })] },
  { key: "epoly_pigment_white", name: "E-Poly Pigment — White", category: "epoly_pigment", pricingModel: "accessory", kits: [ancKit("32oz", 52.6, 49.97, { gals: 0.25 })] },
  { key: "epoly_pigment_dover_beige", name: "E-Poly Pigment — Dover Beige", category: "epoly_pigment", pricingModel: "accessory", kits: [ancKit("32oz", 44.5, 42.28, { gals: 0.25 })] },
  { key: "epoly_pigment_tan", name: "E-Poly Pigment — Tan", category: "epoly_pigment", pricingModel: "accessory", kits: [ancKit("32oz", 43.2, 41.04, { gals: 0.25 })] },
  { key: "epoly_pigment_nonstock", name: "E-Poly Pigment (specialty tint)", category: "epoly_pigment", pricingModel: "accessory", kits: [ancKit("32oz", 39.8, 37.81, { gals: 0.25 })] },

  // ─── METALLIC / QUARTZ / SPIKE SHOES (page 3) ─────────────────────────────
  { key: "metallic_mica_4oz", name: "Metallic Pigment (stocking colors)", category: "metallic_pigment", pricingModel: "accessory", kits: [ancKit("4oz", 12.5, 11.88)] },
  { key: "quartz_agg", name: "Quartz (stocking colors)", category: "quartz", pricingModel: "accessory", kits: [ancKit("50lb bag", 25, 23.75, { lbs: 50 })] },
  { key: "spike_shoes_medium", name: "Spike Shoes — Medium", category: "spike_shoes", pricingModel: "accessory", kits: [ancKit("pair", 145, 137.75)] },
  { key: "spike_shoes_large", name: "Spike Shoes — Large", category: "spike_shoes", pricingModel: "accessory", kits: [ancKit("pair", 145, 137.75)] },
  { key: "spike_shoes_xl", name: "Spike Shoes — Xtra Large", category: "spike_shoes", pricingModel: "accessory", kits: [ancKit("pair", 145, 137.75)] },

  // ─── ANCILLARIES (pages 3–4) ──────────────────────────────────────────────
  { key: "anc_qt_lid", name: "1 Qt Multi-Mix Container Lid", category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 0.48, 0.46)] },
  { key: "anc_qt_container", name: "1 Qt Multi-Mix Container — Quart", category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 1.05, 1.0)] },
  { key: "anc_caution_tape", name: '1000\'x3" Caution Tape', category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 27.01, 25.66)] },
  { key: "anc_mixing_stick_12", name: "12\" Mixing Stick — No Finger Grip", category: "supplies", pricingModel: "accessory", kits: [ancKit("100/box", 6.48, 6.16)] },
  { key: "anc_coater_refill_12", name: "12\" Woven Floor Coater Refill", category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 14.45, 13.73)] },
  { key: "anc_coater_refill_18_nyl", name: "18\" Floor Coater Refill Nylfoam", category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 14.78, 14.04)] },
  { key: "anc_coater_refill_18_woven", name: "18\" Floor Coater Refill Woven", category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 18.75, 17.81)] },
  { key: "anc_painters_tape", name: "2\" — 60 yd Roll of Blue Painters Tape", category: "supplies", pricingModel: "accessory", kits: [ancKit("6/box", 79.5, 75.53)] },
  { key: "anc_chip_brush", name: "3\" Chip Brush", category: "supplies", pricingModel: "accessory", kits: [ancKit("12/box", 9.07, 8.62)] },
  { key: "anc_turbo_cup", name: "4.5\" 9 Segment Turbo Cup Wheel", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 49.99, 47.49)] },
  { key: "anc_saw_blade", name: "4.5\" X .080 Premium Segmented Saw Blade", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 25, 23.75)] },
  { key: "anc_arrow_cup", name: "7\" Arrow Segment Cup Wheel", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 95, 90.25)] },
  { key: "anc_turbo_blade", name: "7\" Turbo Diamond Blade (24) Segmented", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 100, 95)] },
  { key: "anc_cloth_gloves", name: "Cloth Gloves", category: "supplies", pricingModel: "accessory", kits: [ancKit("12/box", 12, 11.4)] },
  { key: "anc_dust_mask", name: "Dust Mask", category: "supplies", pricingModel: "accessory", kits: [ancKit("20/box", 33.49, 31.82)] },
  { key: "anc_dust_pan", name: "Dust Pan", category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 24.95, 23.7)] },
  { key: "anc_ear_muffs", name: "Ear Muffs", category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 14.43, 13.71)] },
  { key: "anc_garbage_bags", name: "Garbage Bags", category: "supplies", pricingModel: "accessory", kits: [ancKit("50/box", 46.65, 44.32)] },
  { key: "anc_dust_shroud_hose", name: "Grinding Dust Shroud Hose 18\"", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 34.22, 32.51)] },
  { key: "anc_sand_screen", name: "Norton Sand Screen Disc 100 Grit", category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 9.3, 8.84)] },
  { key: "anc_vapor_respirator", name: "Organic Vapor Repirator (FTC)", category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 38.84, 36.9)] },
  { key: "anc_rags", name: "Rags 80-100 rags per box", category: "supplies", pricingModel: "accessory", kits: [ancKit("100/box", 25.83, 24.54)] },
  { key: "anc_safety_glasses", name: "Safety Glasses", category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 5.42, 5.15)] },
  { key: "anc_nitrile_gloves", name: "SemperForce HD 5 Mil Black Nitrile Disposable gloves", category: "supplies", pricingModel: "accessory", kits: [ancKit("100/box", 10.61, 10.08)] },
  { key: "anc_spikes_pair", name: "Spikes — per pair", category: "supplies", pricingModel: "accessory", kits: [ancKit("pair", 23.75, 22.56)] },
  { key: "anc_hand_sprayer", name: "0.5 Ga Hand Sprayer", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 11.65, 11.07)] },
  { key: "anc_horsehair_14", name: "14\" Horsehair Brush Replacement (Brush ONLY)", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 35.57, 33.79)] },
  { key: "anc_vacuum_head_14", name: "14\" Vacuum Head Frame with Horsehair Brush (TOOL)", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 123.39, 117.22)] },
  { key: "anc_horsehair_16", name: "16\" Horsehair Brush Replacement (Brush ONLY)", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 52.62, 49.99)] },
  { key: "anc_vacuum_hose", name: "2\" X 25\" Crush Proof Vacuum Hose", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 109.07, 103.62)] },
  { key: "anc_trowel", name: "11\"x4.5\" Trowel", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 14.28, 13.57)] },
  { key: "anc_bona_coater", name: "12\" Bona Lightweight T-Bar Floor Coater", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 32.55, 30.92)] },
  { key: "anc_scraper_14", name: "14\" Wide Floor Scraper & Stripper", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 40, 38)] },
  { key: "anc_big_ben_frame", name: "18\" Big Ben Roller Frame — sold each", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 11.37, 10.8)] },
  { key: "anc_bigfoot_heavy", name: "18\" Big Foot Floor Coater Heavyweight", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 50.46, 47.94)] },
  { key: "anc_bigfoot_light", name: "18\" Big Foot Floor Coater Lightweight", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 43.78, 41.59)] },
  { key: "anc_broom_head_23", name: "23\" Blue Soft Broom Head", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 26.34, 25.02)] },
  { key: "anc_flat_squeegee", name: "24\" Flat Squeegee", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 29.98, 28.48)] },
  { key: "anc_speed_squeegee_quarter", name: "24\" Speed Squeegee 1/4\" Notched", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 39.31, 37.34)] },
  { key: "anc_speed_squeegee_316", name: "24\" Speed Squeegee 3/16\" Notched", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 39.31, 37.34)] },
  { key: "anc_broom_29", name: "29\" Blue Soft Broom", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 31.12, 29.56)] },
  { key: "anc_weenie_frame", name: "4.5\" Roller Frame — Weenie Roller", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 4.56, 4.33)] },
  { key: "anc_measuring_bucket", name: "5 Qt Measuring Bucket — Quart", category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 2.59, 2.46)] },
  { key: "anc_bucket_buster", name: "Bucket Buster", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 53.34, 50.67)] },
  { key: "anc_extension_pole", name: "Extension Pole 4-8'", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 20.45, 19.43)] },
  { key: "anc_broom_handle", name: "Steel Broom Handle", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 13.88, 13.19)] },
  { key: "anc_wooster_9_frame", name: "Wooster 9\" Roller Frame", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 5, 4.75)] },
  { key: "anc_bigmouth_bucket", name: "2 Ga Bigmouth Bucket (4)", category: "supplies", pricingModel: "accessory", kits: [ancKit("4/box", 47.43, 45.06)] },
  { key: "anc_wooster_sherlock", name: "Wooster 18\" Sherlock Wide Boy Frame", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 21.48, 20.41)] },
  { key: "anc_wooster_pro_dooz_18", name: "Wooster Pro Doo Z 18\" 3/4\" Nap Roller Cover", category: "tools", pricingModel: "accessory", kits: [ancKit("6/box", 65.45, 62.18)] },
  { key: "anc_wooster_super_doo_18", name: "Wooster Super Doo 18\" 3/8\" Nap Roller Cover", category: "tools", pricingModel: "accessory", kits: [ancKit("6/box", 43.5, 41.33)] },
  { key: "anc_wooster_super_dooz_9_34", name: "Wooster Super Doo Z 9\" 3/4\" Nap Roller cover", category: "tools", pricingModel: "accessory", kits: [ancKit("12/box", 47.14, 44.78)] },
  { key: "anc_wooster_super_dooz_9_38", name: "Wooster Super Doo Z 9\" 3/8\" Nap Roller Cover", category: "tools", pricingModel: "accessory", kits: [ancKit("12/box", 34.18, 32.47)] },
  { key: "anc_purdy_frame", name: "Purdy 18\" Revolution Roller Frame", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 49.37, 47.24)] },
  { key: "anc_trash_bags_42", name: "HD Contractor Trash Bags — 42 Gallon (Box of 22)", category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 15.25, 14.59)] },
  { key: "anc_helix_paddle_1", name: "1 Gal Helix Mixing Paddle", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 10.52, 9.27)] },
  { key: "anc_helix_paddle_5", name: "5 Gal Helix Mixing Paddle", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 11.77, 10.37)] },
  { key: "anc_weenie_frame_12", name: "12\" Roller Frame — Weenie Roller", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 4.17, 3.99)] },
  { key: "anc_weenie_frame_16", name: "16\" Roller Frame — Weenie Roller", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 6.39, 6.12)] },
  { key: "anc_weenie_covers_6", name: "6\" Weenie Roller Covers — 6 pack (1/2\" nap)", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 7.41, 7.09)] },
  { key: "anc_roller_cover_18", name: "18\" Contractor Woven Roller Cover, 3/8\" Nap", category: "tools", pricingModel: "accessory", kits: [ancKit("ea", 12.37, 11.84)] },
  { key: "silica_sand", name: "Dry Silica Sand — 50 lb Bag", category: "supplies", pricingModel: "accessory", kits: [ancKit("ea", 15.83, 12.38, { lbs: 50 })] },
];

function cloneKits(kits) {
  return kits.map((k) => ({ ...k, tierPrices: k.tierPrices ? { ...k.tierPrices } : undefined }));
}

function buildProductsObject() {
  const PRODUCTS = {};
  for (const def of CATALOG) {
    const { key, name, category, pricingModel, kits } = def;
    PRODUCTS[key] = {
      name,
      materialCategory: category,
      ...(pricingModel ? { pricingModel } : {}),
      kits: cloneKits(kits),
    };
  }

  // Calculator / legacy aliases (same kits, stable keys for SYSTEMS layer logic)
  PRODUCTS.hyperbond = { ...PRODUCTS.hyperbond_clear, name: "HyperBOND (Clear)" };
  PRODUCTS.dt454_turbo = { ...PRODUCTS.dt454_clear, name: "DT 454 (Clear) — Turbo" };
  PRODUCTS.aspartic85 = { ...PRODUCTS.aspartic85_slow_low, name: "Aspartic 85 Slow Go (Low Odor)" };
  PRODUCTS.marblemax = { ...PRODUCTS.hyperflow, name: "MarbleMax" };
  PRODUCTS.wearmax_3lb = { ...PRODUCTS.wearmax, name: "WearMax — 3 lb jar", kits: [{ ...PRODUCTS.wearmax.kits[0], size: "3 lb jar", lbs: 3 }] };
  PRODUCTS.flake_14 = { ...PRODUCTS.flake_vinyl_quarter, name: 'Decorative Flake 1/4"' };
  PRODUCTS.tool_spike_shoes = { ...PRODUCTS.spike_shoes_medium, name: "Spike Shoes (pair)" };

  return PRODUCTS;
}

const epolyRetail = {
  Black: 39.8,
  "Metal Gray": 40.2,
  "Medium Gray": 40.9,
  "Sable Gray": 44.3,
  White: 52.6,
  "Dover Beige": 44.5,
  Tan: 43.2,
};

const products = buildProductsObject();

const file = `/** FGP Midwest MSRP kit catalog — master price sheet pages 1–4 (Apr 2026). */
/** Generated by scripts/build-products-catalog.mjs — do not hand-edit PRODUCT entries. */

export const EPOLY_PIGMENT_RETAIL_32OZ_USD = ${JSON.stringify(epolyRetail, null, 2)};

const _BASE_PRODUCTS = ${JSON.stringify(
  Object.fromEntries(
    CATALOG.map((d) => [
      d.key,
      {
        name: d.name,
        materialCategory: d.category,
        ...(d.pricingModel ? { pricingModel: d.pricingModel } : {}),
        kits: d.kits,
      },
    ])
  ),
  null,
  2
)};

function _alias(targetKey, name, kitOverrides) {
  const base = _BASE_PRODUCTS[targetKey];
  if (!base) return null;
  const kits = kitOverrides
    ? base.kits.map((k, i) => (i === 0 ? { ...k, ...kitOverrides } : { ...k }))
    : base.kits.map((k) => ({ ...k, tierPrices: k.tierPrices ? { ...k.tierPrices } : undefined }));
  return { ...base, name, kits };
}

export const PRODUCTS = {
  ..._BASE_PRODUCTS,
  hyperbond: _alias("hyperbond_clear", "HyperBOND (Clear)"),
  dt454_turbo: _alias("dt454_clear", "DT 454 (Clear) — Turbo"),
  aspartic85: _alias("aspartic85_slow_low", "Aspartic 85 Slow Go (Low Odor)"),
  marblemax: _alias("hyperflow", "MarbleMax"),
  wearmax_3lb: _alias("wearmax", "WearMax — 3 lb jar", { size: "3 lb jar", lbs: 3 }),
  flake_14: _alias("flake_vinyl_quarter", 'Decorative Flake 1/4"'),
  tool_spike_shoes: _alias("spike_shoes_medium", "Spike Shoes (pair)"),
};

export function resolveEpolyProductKey(baseCoatColor) {
  const c = baseCoatColor || "Black";
  const slug = c.toLowerCase().replace(/\\s+/g, "_");
  const key = \`epoly_pigment_\${slug}\`;
  if (PRODUCTS[key]) return key;
  return "epoly_pigment_nonstock";
}

export function resolveLayerProductKey(layer, answers) {
  if (layer.key !== "epoly_pigment") return layer.key;
  return resolveEpolyProductKey(answers?.baseCoatColor || answers?.color);
}
`;

writeFileSync(outPath, file, "utf8");
console.log(`Wrote ${outPath} with ${CATALOG.length} base products + aliases`);
