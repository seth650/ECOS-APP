/** Custom floor system helpers — coverage math + calculator adapters. */

export const CUSTOM_SYSTEM_PREFIX = "CUSTOM-";
export const CUSTOM_LAYER_PRODUCT_PREFIX = "custom_layer_";

export const SYSTEM_LOCATIONS = [
  { id: "indoor", label: "Indoor" },
  { id: "outdoor", label: "Outdoor" },
];

export const SYSTEM_TYPES = [
  { id: "flake", label: "Flake" },
  { id: "solid", label: "Solid Color" },
  { id: "solid_texture", label: "Solid+Texture/Grip" },
  { id: "metallic", label: "Metallic" },
  { id: "quartz", label: "Quartz" },
  { id: "grind_seal", label: "Grind & Seal" },
];

export const LAYER_TYPES = [
  { id: "liquid", label: "Liquid" },
  { id: "broadcast", label: "Broadcast Media" },
  { id: "pigment", label: "Pigments" },
];

export const DEFAULT_FGP_VENDOR = {
  name: "FGP Midwest",
  email: "orders@fgpmidwest.com",
};

/** Broadcast / flake style colors from ECOS stock. */
export const ECOS_BROADCAST_COLORS = [
  "Creekbed",
  "Yorkshire",
  "Gravel",
  "Domino",
  "Nightfall",
  "Tidal Wave",
  "Shoreline",
  "Cabin Fever",
  "Woodland",
  "Custom Flake Blend",
];

/** Pigment / solid / metallic color options. */
export const ECOS_PIGMENT_COLORS = [
  "Black",
  "Metal Gray",
  "Medium Gray",
  "Sable Gray",
  "Tile Brown",
  "Mocha",
  "Tan",
  "Dover Beige",
  "Ford Blue",
  "Safety Red",
  "Safety Yellow",
  "White",
  "Americana",
  "Avocado",
  "Azure",
  "Bamboo",
  "Banana",
  "Bikini",
  "Cabana",
  "Cannon",
  "Caribbean",
  "Caviar",
  "Coral",
  "Curacao",
  "Daydream",
  "Dolphin",
  "Driftwood",
  "Ginger",
  "Great White",
  "Guava",
  "Hammock",
  "Kona",
  "Lager",
  "Manatee",
  "Mandarin",
  "Mango",
  "Margarita",
  "Maui",
  "Ocean",
  "Overcast",
  "Palapa",
  "Palm",
  "Papaya",
  "Pearl",
  "Pier",
  "Reef",
  "Rum",
  "Sandal",
  "Sandbar",
  "Sangria",
  "Seaweed",
  "Shipwreck",
  "Starfish",
  "Sunset",
  "Tiki",
  "Whale",
];

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

export function suggestSystemName(firstName) {
  const n = String(firstName || "").trim();
  return n ? `${n}'s Premium Metallic` : "My Premium Metallic";
}

export function emptyLayer() {
  return {
    id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: "",
    type: "liquid", // liquid | broadcast | pigment
    colorName: "",
    colorCustom: false,
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

export function needsColorField(type) {
  return type === "broadcast" || type === "pigment";
}

export function validateLayer(layer, index = 0) {
  const errors = [];
  if (!String(layer.name || "").trim()) errors.push("Layer name required");
  if (!(Number(layer.coverageRate) > 0)) errors.push("Coverage rate required");
  if (!(Number(layer.kitSize) > 0)) errors.push("Kit size required");
  if (!(Number(layer.pricePerKit) >= 0)) errors.push("Price per kit required");
  if (layer.unitType !== "gallons" && layer.unitType !== "lbs") errors.push("Unit type required");
  if (needsColorField(layer.type) && !String(layer.colorName || "").trim()) {
    errors.push("Color name required for broadcast media / pigments");
  }
  return errors;
}

/**
 * Validate system metadata + layers.
 * Min 1 layer (2-layer liquid systems allowed). Broadcast/pigment cannot be first without a prior liquid.
 */
export function validateSystem({ name, location, systemType, layers }) {
  const errors = [];
  if (!String(name || "").trim()) errors.push("System name required");
  if (location !== "indoor" && location !== "outdoor") errors.push("Select Indoor or Outdoor");
  if (!SYSTEM_TYPES.some((t) => t.id === systemType)) errors.push("Select a system type");
  if (!Array.isArray(layers) || layers.length === 0) errors.push("Add at least one layer");

  const list = layers || [];
  for (let i = 0; i < list.length; i++) {
    const l = list[i];
    if (needsColorField(l.type)) {
      const hasLiquidBefore = list.slice(0, i).some((x) => x.type === "liquid");
      if (!hasLiquidBefore) {
        errors.push("A liquid base coat is required before broadcast media/pigments");
        break;
      }
    }
  }

  list.forEach((l, i) => {
    validateLayer(l, i).forEach((e) => errors.push(`Layer ${i + 1}: ${e}`));
  });
  return errors;
}

function typeLabel(type) {
  if (type === "broadcast") return "Broadcast Media";
  if (type === "pigment") return "Pigments";
  return "Liquid";
}

/**
 * Scale a saved custom system into calculator layer items for buildOrderList.
 */
export function customSystemLayersForSqFt(savedSystem, sf) {
  const area = Math.max(0, Number(sf) || 0);
  return (savedSystem?.layers || []).map((layer) => {
    const rate = Number(layer.coverageRate) || 1;
    const needed = area / rate;
    const colorBit = layer.colorName ? ` · ${layer.colorName}` : "";
    const base = {
      key: "custom_layer",
      custom: true,
      label: layer.name || "Layer",
      notes: `${typeLabel(layer.type)}${colorBit} · ${rate} sq ft/${layer.unitType === "lbs" ? "lb" : "gal"}`,
      kitSizeNum: Number(layer.kitSize) || 1,
      unitType: layer.unitType === "lbs" ? "lbs" : "gallons",
      pricePerKit: Number(layer.pricePerKit) || 0,
      vendorId: layer.vendorId || "",
      layerType: layer.type || "liquid",
      colorName: layer.colorName || "",
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
    location: saved.location || null,
    systemType: saved.system_type || saved.systemType || null,
    cutawayImage: saved.cutaway_url || null,
    diagramStatus: saved.diagram_status || null,
    layers: (sf) => customSystemLayersForSqFt(saved, sf),
  };
}

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
      product: layer.colorName ? `${layer.label} — ${layer.colorName}` : layer.label,
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

/**
 * Flatten unique custom layers into Manual PO catalog products.
 * Keyed by stable layer id when present.
 */
export function buildCustomLayerProducts(systems = []) {
  const products = {};
  for (const sys of systems || []) {
    for (const layer of sys.layers || []) {
      const id = layer.id || `${sys.id}-${layer.name}`;
      const key = `${CUSTOM_LAYER_PRODUCT_PREFIX}${id}`;
      if (products[key]) continue;
      const isLbs = layer.unitType === "lbs";
      const kitSize = Number(layer.kitSize) || 1;
      const msrp = Number(layer.pricePerKit) || 0;
      const colorBit = layer.colorName ? ` — ${layer.colorName}` : "";
      const category =
        layer.type === "pigment"
          ? "custom_pigments"
          : layer.type === "broadcast"
            ? "custom_broadcast"
            : "custom_liquids";
      products[key] = {
        name: `${layer.name || "Custom layer"}${colorBit}`,
        materialCategory: category,
        pricingModel: layer.type === "liquid" ? undefined : "accessory",
        kits: [
          {
            size: `${kitSize} ${isLbs ? "lb" : "gal"}`,
            msrp,
            tierPrices: {
              small: +(msrp * 0.95).toFixed(2),
              tier2: +(msrp * 0.9).toFixed(2),
              preferred: +(msrp * 0.85).toFixed(2),
            },
            ...(isLbs ? { lbs: kitSize } : { gals: kitSize }),
          },
        ],
        _fromCustomSystem: sys.name,
        _vendorId: layer.vendorId || "",
      };
    }
  }
  return products;
}

/** Deduplicate vendors by email (case-insensitive), preferring earliest created. */
export function dedupeVendorsByEmail(vendors = []) {
  const seen = new Map();
  const sorted = [...(vendors || [])].sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return ta - tb;
  });
  for (const v of sorted) {
    const key = String(v.email || "").trim().toLowerCase();
    if (!key) {
      seen.set(`id:${v.id}`, v);
      continue;
    }
    if (!seen.has(key)) seen.set(key, v);
  }
  return [...seen.values()].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""))
  );
}

const fgpEnsureLocks = new Map();

/**
 * Ensure FGP Midwest exists once per contractor.
 * Uses limit(1) (not maybeSingle) so duplicate rows don't look like "missing".
 * Concurrent calls for the same user share one in-flight promise.
 */
export async function ensureDefaultFgpVendor(supabase, userId) {
  if (!userId || !supabase) return null;
  if (fgpEnsureLocks.has(userId)) return fgpEnsureLocks.get(userId);

  const job = (async () => {
    try {
      const { data: rows, error: selErr } = await supabase
        .from("contractor_vendors")
        .select("id, name, email, created_at")
        .eq("user_id", userId)
        .ilike("email", DEFAULT_FGP_VENDOR.email)
        .order("created_at", { ascending: true })
        .limit(5);

      if (selErr) {
        console.warn("[ECOS] ensureDefaultFgpVendor select", selErr);
      }

      const existing = Array.isArray(rows) ? rows : [];
      if (existing.length > 0) {
        // Soft-clean extras so dropdown stops growing.
        const keepId = existing[0].id;
        const extraIds = existing.slice(1).map((r) => r.id).filter(Boolean);
        if (extraIds.length) {
          await supabase
            .from("contractor_vendors")
            .delete()
            .eq("user_id", userId)
            .in("id", extraIds);
        }
        return existing[0];
      }

      const { data, error } = await supabase
        .from("contractor_vendors")
        .insert({
          user_id: userId,
          name: DEFAULT_FGP_VENDOR.name,
          email: DEFAULT_FGP_VENDOR.email,
        })
        .select()
        .maybeSingle();

      // Unique-violation race: another insert won — re-read.
      if (error) {
        console.warn("[ECOS] ensureDefaultFgpVendor insert", error);
        const { data: again } = await supabase
          .from("contractor_vendors")
          .select("id, name, email")
          .eq("user_id", userId)
          .ilike("email", DEFAULT_FGP_VENDOR.email)
          .order("created_at", { ascending: true })
          .limit(1);
        return again?.[0] || null;
      }
      return data;
    } finally {
      fgpEnsureLocks.delete(userId);
    }
  })();

  fgpEnsureLocks.set(userId, job);
  return job;
}

/** Delete duplicate vendor rows for a user (same email), keep oldest. Remap layer vendorIds. */
export async function cleanupDuplicateVendors(supabase, userId, vendors = []) {
  if (!userId || !supabase) return dedupeVendorsByEmail(vendors || []);
  const byEmail = new Map();
  for (const v of vendors || []) {
    const key = String(v.email || "").trim().toLowerCase();
    if (!key) continue;
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(v);
  }
  const deleteIds = [];
  const idRemap = new Map();
  for (const list of byEmail.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort(
      (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
    );
    const keepId = sorted[0].id;
    for (const extra of sorted.slice(1)) {
      if (extra.id) {
        deleteIds.push(extra.id);
        idRemap.set(extra.id, keepId);
      }
    }
  }
  if (deleteIds.length) {
    if (idRemap.size) {
      const { data: systems } = await supabase
        .from("custom_floor_systems")
        .select("id, layers")
        .eq("user_id", userId);
      for (const sys of systems || []) {
        let changed = false;
        const layers = (sys.layers || []).map((l) => {
          if (l.vendorId && idRemap.has(l.vendorId)) {
            changed = true;
            return { ...l, vendorId: idRemap.get(l.vendorId) };
          }
          return l;
        });
        if (changed) {
          await supabase.from("custom_floor_systems").update({ layers }).eq("id", sys.id).eq("user_id", userId);
        }
      }
    }
    await supabase.from("contractor_vendors").delete().eq("user_id", userId).in("id", deleteIds);
  }
  return dedupeVendorsByEmail((vendors || []).filter((v) => !deleteIds.includes(v.id)));
}

export function groupLinesByVendor(lines, vendors = []) {
  const uniqueVendors = dedupeVendorsByEmail(vendors);
  const byId = Object.fromEntries(uniqueVendors.map((v) => [v.id, v]));
  const groups = new Map();
  for (const line of lines || []) {
    let vid = line.vendorId || "";
    let v = byId[vid];
    // Orphaned id after dedupe — fall back to FGP Midwest if present.
    if (vid && !v) {
      v = uniqueVendors.find((x) => String(x.email || "").toLowerCase() === DEFAULT_FGP_VENDOR.email.toLowerCase());
      vid = v?.id || vid;
    }
    if (!groups.has(vid)) {
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
