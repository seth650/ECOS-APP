import { PRODUCTS } from "./products.js";
import { buildCustomLayerProducts } from "./customFloorSystems.js";

/** Main vs ancillary — drives Phase 7 discount rules. */
export const MATERIAL_CATEGORY_GROUPS = {
  main: "Main Products",
  ancillary: "Ancillaries",
  my_layers: "My Custom Layers",
};

export const MATERIAL_CATEGORIES = [
  { id: "epoxy", label: "EPOXY", group: "main" },
  { id: "polyaspartic", label: "POLYASPARTIC", group: "main" },
  { id: "polyurea", label: "POLYUREA", group: "main" },
  { id: "urethane", label: "URETHANE", group: "main" },
  { id: "repair", label: "REPAIR", group: "main" },
  { id: "flake", label: "FLAKE", group: "main" },
  { id: "custom_liquids", label: "MY LIQUIDS", group: "my_layers" },
  { id: "custom_broadcast", label: "MY BROADCAST", group: "my_layers" },
  { id: "custom_pigments", label: "MY PIGMENTS", group: "my_layers" },
  { id: "epoly_pigment", label: "E-POLY PIGMENT", group: "ancillary" },
  { id: "metallic_pigment", label: "METALLIC PIGMENT", group: "ancillary" },
  { id: "quartz", label: "QUARTZ", group: "ancillary" },
  { id: "spike_shoes", label: "SPIKE SHOES", group: "ancillary" },
  { id: "supplies", label: "SUPPLIES", group: "ancillary" },
  { id: "tools", label: "TOOLS", group: "ancillary" },
];

/** Keys that are calculator aliases — hide from manual PO picker (base SKU shown instead). */
const HIDDEN_CATALOG_KEYS = new Set([
  "hyperbond",
  "dt454_turbo",
  "aspartic85",
  "marblemax",
  "wearmax_3lb",
  "flake_14",
  "tool_spike_shoes",
  "epoly_pigment_nonstock",
]);

/** Merge FGP catalog + contractor custom layers for Manual PO. */
export function getMergedProducts(customSystems = []) {
  return {
    ...PRODUCTS,
    ...buildCustomLayerProducts(customSystems),
  };
}

export function getCategoryProductKeys(categoryId, customSystems = []) {
  const catalog = getMergedProducts(customSystems);
  return Object.entries(catalog)
    .filter(([key, p]) => p.materialCategory === categoryId && !HIDDEN_CATALOG_KEYS.has(key))
    .map(([key]) => key)
    .sort((a, b) => (catalog[a]?.name || a).localeCompare(catalog[b]?.name || b));
}

export function isAncillaryCategory(categoryId) {
  const cat = MATERIAL_CATEGORIES.find((c) => c.id === categoryId);
  return cat?.group === "ancillary" || cat?.group === "my_layers";
}

export function listCatalogProducts(categoryId, customSystems = []) {
  const category = MATERIAL_CATEGORIES.find((c) => c.id === categoryId);
  if (!category) return [];
  const catalog = getMergedProducts(customSystems);
  return getCategoryProductKeys(categoryId, customSystems)
    .filter((key) => catalog[key])
    .map((key) => ({
      productKey: key,
      name: catalog[key].name,
      kits: catalog[key].kits || [],
      pricingModel: catalog[key].pricingModel,
      fromCustomSystem: catalog[key]._fromCustomSystem,
    }));
}

export function getProductLineLabel(productKey, kitIndex = 0, customSystems = []) {
  const catalog = getMergedProducts(customSystems);
  const p = catalog[productKey];
  if (!p) return productKey;
  const kit = p.kits?.[kitIndex];
  return kit?.size ? `${p.name} (${kit.size})` : p.name;
}
