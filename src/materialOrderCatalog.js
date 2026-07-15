import { PRODUCTS } from "./products.js";

/** Main vs ancillary — drives Phase 7 discount rules. */
export const MATERIAL_CATEGORY_GROUPS = {
  main: "Main Products",
  ancillary: "Ancillaries",
};

export const MATERIAL_CATEGORIES = [
  { id: "epoxy", label: "EPOXY", group: "main", productKeys: ["dt454_clear", "dt454_turbo", "hyperbond", "mv2112", "hyperprime_mvb", "hyperprime_mvb_pig", "hydroprime", "hydroprime_40", "marblemax", "maxx_flow", "hyperflow"] },
  { id: "polyaspartic", label: "POLYASPARTIC", group: "main", productKeys: ["aspartic85"] },
  { id: "polyurea", label: "POLYUREA", group: "main", productKeys: ["polyurea_slow", "polyurea_med", "polyurea_fast"] },
  { id: "urethane", label: "URETHANE", group: "main", productKeys: ["ez_top_85"] },
  { id: "flake", label: "FLAKE", group: "main", productKeys: ["flake_14"] },
  { id: "repair", label: "REPAIR", group: "main", productKeys: ["patch_pro_10x", "hypercure"] },
  {
    id: "epoly_pigment",
    label: "E-POLY PIGMENT",
    group: "ancillary",
    productKeys: () => Object.keys(PRODUCTS).filter((k) => k.startsWith("epoly_pigment_")),
  },
  { id: "quartz", label: "QUARTZ", group: "ancillary", productKeys: ["quartz_agg"] },
  { id: "spike_shoes", label: "SPIKE SHOES", group: "ancillary", productKeys: ["tool_spike_shoes"] },
  {
    id: "supplies",
    label: "SUPPLIES",
    group: "ancillary",
    productKeys: ["silica_sand", "wearmax_3lb", "metallic_mica_4oz"],
  },
  {
    id: "tools",
    label: "TOOLS",
    group: "ancillary",
    productKeys: ["accessory_mixing_stick", "accessory_notched_squeegee", "accessory_roller_kit", "accessory_gloves"],
  },
];

export function getCategoryProductKeys(category) {
  const keys = category.productKeys;
  return typeof keys === "function" ? keys() : keys;
}

export function isAncillaryCategory(categoryId) {
  const cat = MATERIAL_CATEGORIES.find((c) => c.id === categoryId);
  return cat?.group === "ancillary";
}

export function listCatalogProducts(categoryId) {
  const category = MATERIAL_CATEGORIES.find((c) => c.id === categoryId);
  if (!category) return [];
  return getCategoryProductKeys(category)
    .filter((key) => PRODUCTS[key])
    .map((key) => ({
      productKey: key,
      name: PRODUCTS[key].name,
      kits: PRODUCTS[key].kits || [],
      pricingModel: PRODUCTS[key].pricingModel,
    }));
}

export function getProductLineLabel(productKey, kitIndex = 0) {
  const p = PRODUCTS[productKey];
  if (!p) return productKey;
  const kit = p.kits?.[kitIndex];
  return kit?.size ? `${p.name} (${kit.size})` : p.name;
}
