import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { getApiBase } from "./stripeClient.js";
import {
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_GROUPS,
  listCatalogProducts,
  getProductLineLabel,
} from "./materialOrderCatalog.js";
import {
  buildMaterialLine,
  summarizeMaterialLines,
  getMaterialOrderPricingTierKey,
  getMaterialOrderTierLabel,
} from "./materialOrderPricing.js";

const usd = (n) => `$${Number(n || 0).toFixed(2)}`;

export default function MaterialOrderForm({ styles: S, userProfile, session, onOrderSaved }) {
  const tierKey = useMemo(() => getMaterialOrderPricingTierKey(userProfile || {}), [userProfile]);
  const tierLabel = getMaterialOrderTierLabel(tierKey);

  const [categoryId, setCategoryId] = useState(MATERIAL_CATEGORIES[0].id);
  const [productKey, setProductKey] = useState("");
  const [kitIndex, setKitIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const [lines, setLines] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  const category = MATERIAL_CATEGORIES.find((c) => c.id === categoryId);
  const products = useMemo(() => listCatalogProducts(categoryId), [categoryId]);
  const selectedProduct = products.find((p) => p.productKey === productKey);
  const kits = selectedProduct?.kits || [];

  useEffect(() => {
    if (!products.length) {
      setProductKey("");
      return;
    }
    if (!products.some((p) => p.productKey === productKey)) {
      setProductKey(products[0].productKey);
      setKitIndex(0);
    }
  }, [categoryId, products, productKey]);

  const totals = useMemo(() => summarizeMaterialLines(lines), [lines]);

  function onCategoryChange(nextId) {
    setCategoryId(nextId);
    const nextProducts = listCatalogProducts(nextId);
    const first = nextProducts[0];
    setProductKey(first?.productKey || "");
    setKitIndex(0);
    setQty(1);
  }

  function addLine() {
    if (!productKey || !category) return;
    const line = buildMaterialLine({
      productKey,
      kitIndex,
      categoryId,
      categoryLabel: category.label,
      qty,
      tierKey,
    });
    setLines((prev) => [...prev, { ...line, id: `${Date.now()}-${prev.length}` }]);
    setMessage("");
  }

  function removeLine(id) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  async function submitOrder() {
    if (!session?.user?.id || lines.length === 0) {
      setMessage("Add at least one line item before submitting.");
      return;
    }
    setSubmitting(true);
    setMessage("Submitting material order…");
    const items = lines.map(({ id: _id, ...rest }) => rest);
    const record = {
      user_id: session.user.id,
      items,
      total_msrp: totals.totalMsrp,
      total_discount: totals.totalDiscount,
      total_price: totals.totalPrice,
      pricing_tier_key: tierKey,
      status: "submitted",
      created_at: new Date().toISOString(),
    };
    try {
      const { data: inserted, error } = await supabase.from("material_orders").insert(record).select().single();
      if (error) throw error;

      const apiBase = getApiBase();
      const emailRes = await fetch(`${apiBase}/api/send-po-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order: inserted,
          profile: userProfile,
          tierLabel,
        }),
      });
      if (!emailRes.ok) {
        const errJson = await emailRes.json().catch(() => ({}));
        throw new Error(errJson?.error || "Order saved but email to FGP failed.");
      }

      setLines([]);
      setMessage("Material order submitted. Gary has been emailed a copy.");
      onOrderSaved?.(inserted);
    } catch (e) {
      setMessage(e?.message || "Could not submit material order.");
    } finally {
      setSubmitting(false);
    }
  }

  const mainCats = MATERIAL_CATEGORIES.filter((c) => c.group === "main");
  const ancCats = MATERIAL_CATEGORIES.filter((c) => c.group === "ancillary");

  return (
    <div style={{ ...S.card, marginTop: 12, border: "1px solid #113a72" }}>
      <div style={{ fontSize: 13, color: "#fff", fontFamily: "'Montserrat', sans-serif", fontWeight: 900, marginBottom: 6 }}>
        Material Order Form
      </div>
      <div style={{ fontSize: 10, color: "#9bb2d1", lineHeight: 1.5, marginBottom: 12 }}>
        FGP Midwest price list · Your pricing: <span style={{ color: "#f5d676" }}>{tierLabel}</span>
        {" · "}
        Main products: {tierKey === "small" ? "5%" : tierKey === "tier2" ? "10%" : tierKey === "preferred" ? "15%" : "0%"} off MSRP
        {" · "}
        Ancillaries: {tierKey === "preferred" ? "5% off MSRP" : "MSRP"}
      </div>

      <div style={{ fontSize: 9, color: "#e33433", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
        {MATERIAL_CATEGORY_GROUPS.main}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {mainCats.map((c) => (
          <button
            key={c.id}
            type="button"
            style={{
              ...S.btnSm,
              borderColor: categoryId === c.id ? "#e33433" : "#113a72",
              background: categoryId === c.id ? "#113a72" : "#000",
            }}
            onClick={() => onCategoryChange(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 9, color: "#eab308", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 6 }}>
        {MATERIAL_CATEGORY_GROUPS.ancillary}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
        {ancCats.map((c) => (
          <button
            key={c.id}
            type="button"
            style={{
              ...S.btnSm,
              borderColor: categoryId === c.id ? "#eab308" : "#113a72",
              background: categoryId === c.id ? "rgba(234,179,8,0.15)" : "#000",
            }}
            onClick={() => onCategoryChange(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <label style={{ fontSize: 10, color: "#9bb2d1" }}>
          Product
          <select
            style={{ ...S.input, marginTop: 4, width: "100%" }}
            value={productKey}
            onChange={(e) => {
              setProductKey(e.target.value);
              setKitIndex(0);
            }}
          >
            {products.length === 0 && <option value="">—</option>}
            {products.map((p) => (
              <option key={p.productKey} value={p.productKey}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 10, color: "#9bb2d1" }}>
          Kit / size
          <select
            style={{ ...S.input, marginTop: 4, width: "100%" }}
            value={kitIndex}
            onChange={(e) => setKitIndex(Number(e.target.value))}
            disabled={kits.length <= 1}
          >
            {kits.map((k, i) => (
              <option key={i} value={i}>
                {k.size} — MSRP {usd(k.msrp)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 10, color: "#9bb2d1" }}>
          Qty
          <input
            type="number"
            min={1}
            style={{ ...S.input, marginTop: 4, width: "100%" }}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
        </label>
      </div>

      <button type="button" style={{ ...S.btnSm, marginTop: 10 }} onClick={addLine} disabled={!productKey}>
        + Add line
      </button>

      {lines.length > 0 && (
        <div style={{ marginTop: 14, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ ...S.table, minWidth: 520 }}>
            <thead>
              <tr>
                <th style={S.th}>Product</th>
                <th style={S.th}>Qty</th>
                <th style={S.th}>MSRP ea</th>
                <th style={S.th}>Your price</th>
                <th style={S.th}>Savings</th>
                <th style={S.th} />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td style={S.td}>
                    {getProductLineLabel(line.productKey, line.kitIndex)}
                    <div style={{ fontSize: 9, color: "#9bb2d1" }}>{line.categoryLabel}</div>
                  </td>
                  <td style={S.td}>{line.qty}</td>
                  <td style={S.td}>{usd(line.unitMsrp)}</td>
                  <td style={S.td}>{usd(line.unitPrice)}</td>
                  <td style={S.td}>{usd(line.savings)}</td>
                  <td style={S.td}>
                    <button type="button" style={S.btnSm} onClick={() => removeLine(line.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lines.length > 0 && (
        <div style={{ marginTop: 14, padding: 12, background: "#000", borderRadius: 8, border: "1px solid #113a72" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#d2def1", marginBottom: 6 }}>
            <span>Total MSRP</span>
            <span>{usd(totals.totalMsrp)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#f5d676", marginBottom: 6 }}>
            <span>Total discount</span>
            <span>−{usd(totals.totalDiscount)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#fff", fontWeight: 900, fontFamily: "'Montserrat', sans-serif" }}>
            <span>Final PO total</span>
            <span>{usd(totals.totalPrice)}</span>
          </div>
        </div>
      )}

      <button
        type="button"
        style={{ ...S.btn, width: "100%", marginTop: 12, opacity: submitting || lines.length === 0 ? 0.6 : 1 }}
        disabled={submitting || lines.length === 0}
        onClick={submitOrder}
      >
        {submitting ? "Submitting…" : "Submit material PO"}
      </button>

      {message && (
        <div style={{ marginTop: 10, fontSize: 11, color: message.includes("submitted") ? "#86efac" : "#fca5a5" }}>{message}</div>
      )}
    </div>
  );
}
