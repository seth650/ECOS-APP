/** Custom floor system helpers — coverage math + calculator adapters. */

export const CUSTOM_SYSTEM_PREFIX = "CUSTOM-";

export function customSystemKey(id) {
  return `${CUSTOM_SYSTEM_PREFIX}${id}`;
}

export function isCustomSystemKey(key) {
  return typeof key === "string" && key.startsWith(CUSTOM_SYSTEM_PREFIX);
}

export function parseCustomSystemId(key) {
  if (!isCustomSystemKey(key)) return null;
  return key.slice(CUSTOM_SYSTEM_PREFIX.length);
}

export function emptyLayer() {
  return {
    id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    type: "liquid", // liquid | broadcast
    coverageRate: "",
    kitSize: "",
    unitType: "gallons", // gallons | lbs
    pricePerKit: "",
    pricePerUnit: "",
    vendorId: "",
  };
}

/** Keep kit price ↔ unit price in sync. */
export function syncLayerPrices(layer, changedField) {
  const kitSize = Number(layer.kitSize);
  const next = { ...layer };
  if (!Number.isFinite(kitSize) || kitSize <= 0) return next;
  if (changedField === "pricePerKit") {
    const kit = Number(layer.pricePerKit);
    next.pricePerUnit = Number.isFinite(kit) ? +(kit / kitSize).toFixed(4) : "";
  } else if (changedField === "pricePerUnit") {
    const unit = Number(layer.pricePerUnit);
    next.pricePerKit = Number.isFinite(unit) ? +(unit * kitSize).toFixed(2) : "";
  } else if (changedField === "kitSize") {
    const kit = Number(layer.pricePerKit);
    if (Number.isFinite(kit)) next.pricePerUnit = +(kit / kitSize).toFixed(4);
  }
  return next;
}

export function validateLayer(layer) {
  const errors = [];
  if (!String(layer.name || "").trim()) errors.push("Layer name required");
  if (!(Number(layer.coverageRate) > 0)) errors.push("Coverage rate required");
  if (!(Number(layer.kitSize) > 0)) errors.push("Kit size required");
  if (!(Number(layer.pricePerKit) >= 0)) errors.push("Price per kit required");
  if (layer.unitType !== "gallons" && layer.unitType !== "lbs") errors.push("Unit type required");
  return errors;
}

export function validateSystem(name, layers) {
  const errors = [];
  if (!String(name || "").trim()) errors.push("System name required");
  if (!Array.isArray(layers) || layers.length === 0) errors.push("Add at least one layer");
  (layers || []).forEach((l, i) => {
    validateLayer(l).forEach((e) => errors.push(`Layer ${i + 1}: ${e}`));
  });
  return errors;
}

/**
 * Scale a saved custom system into calculator layer items for buildOrderList.
 * Coverage rate = sq ft per gal OR sq ft per lb (depending on unitType).
 */
export function customSystemLayersForSqFt(savedSystem, sf) {
  const area = Math.max(0, Number(sf) || 0);
  return (savedSystem?.layers || []).map((layer) => {
    const rate = Number(layer.coverageRate) || 1;
    const needed = area / rate;
    const base = {
      key: "custom_layer",
      custom: true,
      label: layer.name || "Layer",
      notes: `${layer.type === "broadcast" ? "Broadcast / Additive" : "Liquid"} · ${rate} sq ft/${layer.unitType === "lbs" ? "lb" : "gal"}`,
      kitSizeNum: Number(layer.kitSize) || 1,
      unitType: layer.unitType === "lbs" ? "lbs" : "gallons",
      pricePerKit: Number(layer.pricePerKit) || 0,
      vendorId: layer.vendorId || "",
      layerType: layer.type || "liquid",
    };
    if (base.unitType === "lbs") {
      return { ...base, lbs: needed, gals: undefined };
    }
    return { ...base, gals: needed, lbs: undefined };
  });
}

/** Adapter shaped like SYSTEMS entries for the calculator. */
export function toCalculatorSystem(saved) {
  if (!saved?.id) return null;
  return {
    label: saved.name,
    code: customSystemKey(saved.id),
    priceRange: "Custom",
    warnings: [],
    isCustom: true,
    customId: saved.id,
    cutawayImage: null,
    layers: (sf) => customSystemLayersForSqFt(saved, sf),
  };
}

/**
 * Build PO lines for custom layers (no PRODUCTS catalog lookup).
 * Applies optional contractor tier multiplier to entered kit prices when requested.
 */
export function buildCustomOrderLines(layers, tierMult = 1) {
  const lines = [];
  const mult = Number(tierMult) > 0 ? Number(tierMult) : 1;
  for (const layer of layers || []) {
    if (!layer?.custom) continue;
    const kitSize = Number(layer.kitSizeNum) || 1;
    const isLbs = layer.unitType === "lbs";
    const needed = isLbs ? Number(layer.lbs) || 0 : Number(layer.gals) || 0;
    const buffered = needed * 1.1;
    const qty = Math.max(1, Math.ceil(buffered / kitSize));
    const msrpEa = Number(layer.pricePerKit) || 0;
    const tierEa = +(msrpEa * mult).toFixed(2);
    const unitLabel = isLbs ? "lbs" : "gal";
    const kitSizeLabel = `${kitSize} ${isLbs ? "lb" : "gal"}`;
    lines.push({
      product: layer.label,
      layer: layer.label,
      notes: layer.notes || "",
      kitSize: kitSizeLabel,
      qty,
      totalNeeded: `${needed.toFixed(2)} ${unitLabel}`,
      msrpEa,
      tierEa,
      lineMsrp: +(msrpEa * qty).toFixed(2),
      lineTier: +(tierEa * qty).toFixed(2),
      vendorId: layer.vendorId || "",
      custom: true,
    });
  }
  return lines;
}

export function groupLinesByVendor(lines, vendors = []) {
  const byId = Object.fromEntries((vendors || []).map((v) => [v.id, v]));
  const groups = new Map();
  for (const line of lines || []) {
    const vid = line.vendorId || "";
    if (!groups.has(vid)) {
      const v = byId[vid];
      groups.set(vid, {
        vendorId: vid,
        vendorName: v?.name || (vid ? "Unknown vendor" : "No vendor assigned"),
        vendorEmail: v?.email || "",
        lines: [],
      });
    }
    groups.get(vid).lines.push(line);
  }
  return [...groups.values()];
}
