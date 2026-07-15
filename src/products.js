/** FGP Midwest MSRP kit catalog (Apr 2026 export). Shared by calculator + material orders. */

export const EPOLY_PIGMENT_RETAIL_32OZ_USD = {
  Black: 39.8,
  "Metal Gray": 40.2,
  "Medium Gray": 40.9,
  "Sable Gray": 44.3,
  White: 52.6,
  "Dover Beige": 44.5,
  Tan: 43.2,
};

export function buildEpolyPigmentProductMap() {
  const m = {};
  for (const [color, msrp] of Object.entries(EPOLY_PIGMENT_RETAIL_32OZ_USD)) {
    const slug = color.toLowerCase().replace(/\s+/g, "_");
    m[`epoly_pigment_${slug}`] = {
      name: `E-Poly Pigment — ${color}`,
      pricingModel: "accessory",
      kits: [{ size: "32oz", gals: 0.25, msrp }],
    };
  }
  m.epoly_pigment_nonstock = {
    name: "E-Poly Pigment (specialty tint)",
    pricingModel: "accessory",
    kits: [{ size: "32oz", gals: 0.25, msrp: 39.8 }],
  };
  return m;
}

export const PRODUCTS = {
  dt454_clear: { name: "DT-454 Clear", kits: [{ size: "3 gal", gals: 3, msrp: 210 }, { size: "15 gal", gals: 15, msrp: 975 }] },
  dt454_turbo: { name: "DT-454 Clear (Turbo)", kits: [{ size: "3 gal", gals: 3, msrp: 210 }, { size: "15 gal", gals: 15, msrp: 975 }] },
  hyperbond: { name: "HyperBond (Clear)", kits: [{ size: "3 gal", gals: 3, msrp: 195 }, { size: "15 gal", gals: 15, msrp: 870 }] },
  mv2112: { name: "MV 2112 (MVB)", kits: [{ size: "3 gal", gals: 3, msrp: 360 }, { size: "15 gal", gals: 15, msrp: 1575 }] },
  hyperprime_mvb: {
    name: "HyperPrime MVB (Clear)",
    kits: [
      { size: "3 gal", gals: 3, msrp: 177, tierPrices: { small: 168.15, tier2: 159.3, preferred: 150.45 } },
      { size: "15 gal", gals: 15, msrp: 855, tierPrices: { small: 812.25, tier2: 769.5, preferred: 726.75 } },
    ],
  },
  polyurea_slow: { name: "Polyurea Basecoat (Slow)", kits: [{ size: "3 gal", gals: 3, msrp: 156 }, { size: "15 gal", gals: 15, msrp: 750 }] },
  polyurea_med: { name: "Polyurea Basecoat (Medium)", kits: [{ size: "3 gal", gals: 3, msrp: 156 }, { size: "15 gal", gals: 15, msrp: 750 }] },
  polyurea_fast: { name: "Polyurea Basecoat (Fast)", kits: [{ size: "3 gal", gals: 3, msrp: 156 }, { size: "15 gal", gals: 15, msrp: 750 }] },
  aspartic85: { name: "Aspartic 85 Slow Go (Low Odor)", kits: [{ size: "3 gal", gals: 3, msrp: 300 }, { size: "15 gal", gals: 15, msrp: 1475 }] },
  ez_top_85: {
    name: "EZ Top 85 (MCU 85 mfg) — with WearMax",
    kits: [{ size: "1 gal", gals: 1, msrp: 158.8, tierPrices: { small: 130.77, tier2: 121.43, preferred: 112.09 } }],
  },
  hydroprime: { name: "HydroPrime (ET)", kits: [{ size: "3 gal", gals: 3, msrp: 156 }, { size: "15 gal", gals: 15, msrp: 750 }] },
  hydroprime_40: { name: "HydroPrime 40 (Bond / primer — 1040 BondKoat PL)", kits: [{ size: "2 gal", gals: 2, msrp: 165 }, { size: "10 gal", gals: 10, msrp: 924.68 }] },
  marblemax: {
    name: "MarbleMax (Metallic Artistic Layer)",
    kits: [
      { size: "3 gal", gals: 3, msrp: 282.97, tierPrices: { small: 268.82, tier2: 254.67, preferred: 240.52 } },
      { size: "15 gal", gals: 15, msrp: 1113.14, tierPrices: { small: 1057.48, tier2: 1001.83, preferred: 946.14 } },
    ],
  },
  maxx_flow: { name: "Maxx Flow (Metallic)", kits: [{ size: "3 gal", gals: 3, msrp: 360 }, { size: "15 gal", gals: 15, msrp: 1550 }] },
  hyperflow: { name: "HyperFLOW (Metallic Artistic Layer)", kits: [{ size: "3 gal", gals: 3, msrp: 360 }, { size: "15 gal", gals: 15, msrp: 1550 }] },
  hyperprime_mvb_pig: {
    name: "HyperPRIME MVB (Pigmented)",
    kits: [
      { size: "3 gal", gals: 3, msrp: 195, tierPrices: { small: 185.25, tier2: 175.5, preferred: 165.75 } },
      { size: "15 gal", gals: 15, msrp: 960, tierPrices: { small: 912, tier2: 864, preferred: 816 } },
    ],
  },
  metallic_mica_4oz: {
    name: "Metallic Pigment (Mica) — 4oz jar",
    pricingModel: "accessory",
    kits: [{ size: "4 oz jar", gals: 0, qtyUnit: "jar", msrp: 12.5, tierPrices: { small: 12.5, tier2: 12.5, preferred: 11.88 } }],
  },
  wearmax_3lb: {
    name: "WearMax — 3 lb jar",
    pricingModel: "accessory",
    kits: [{ size: "3 lb jar", lbs: 3, msrp: 26.74, tierPrices: { small: 22.02, tier2: 20.45, preferred: 18.88 } }],
  },
  ...buildEpolyPigmentProductMap(),
  patch_pro_10x: { name: "Patch Pro 10X (ET)", kits: [{ size: "2 gal", gals: 2, msrp: 146.07 }] },
  hypercure: { name: "HyperCURE", kits: [{ size: "0.5 gal", gals: 0.5, msrp: 100.1 }] },
  flake_14: { name: 'Decorative Flake 1/4"', kits: [{ size: "40lb box", gals: 0, lbs: 40, msrp: 95 }] },
  quartz_agg: { name: "Colored Quartz Aggregate", pricingModel: "accessory", kits: [{ size: "50lb bag", gals: 0, lbs: 50, msrp: 25 }] },
  silica_sand: { name: "20/40 Mesh Silica Sand", pricingModel: "accessory", kits: [{ size: "50lb bag", gals: 0, lbs: 50, msrp: 18 }] },
  tool_spike_shoes: { name: "Spike Shoes (pair)", pricingModel: "accessory", kits: [{ size: "pair", msrp: 42 }] },
  accessory_mixing_stick: { name: "Mixing Stick — 5 gal", pricingModel: "accessory", kits: [{ size: "each", msrp: 6.5 }] },
  accessory_notched_squeegee: { name: 'Notched Squeegee — 24"', pricingModel: "accessory", kits: [{ size: "each", msrp: 34 }] },
  accessory_roller_kit: { name: "Roller Cover Kit (3-pack)", pricingModel: "accessory", kits: [{ size: "kit", msrp: 22 }] },
  accessory_gloves: { name: "Nitrile Gloves (box of 100)", pricingModel: "accessory", kits: [{ size: "box", msrp: 18 }] },
};

export function resolveEpolyProductKey(baseCoatColor) {
  const c = baseCoatColor || "Black";
  if (EPOLY_PIGMENT_RETAIL_32OZ_USD[c] != null) {
    return `epoly_pigment_${c.toLowerCase().replace(/\s+/g, "_")}`;
  }
  return "epoly_pigment_nonstock";
}

export function resolveLayerProductKey(layer, answers) {
  if (layer.key !== "epoly_pigment") return layer.key;
  return resolveEpolyProductKey(answers?.baseCoatColor || answers?.color);
}
