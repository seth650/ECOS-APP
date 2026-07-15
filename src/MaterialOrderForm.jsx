import { useEffect, useMemo, useRef, useState } from "react";
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
import { getPoCounterLabel } from "./poLimits.js";

const usd = (n) => `$${Number(n || 0).toFixed(2)}`;

export default function MaterialOrderForm({
  styles: S,
  userProfile,
  session,
  poUsage,
  onUpgrade,
  onOrderSaved,
  onSubmitSuccess,
}) {
  const tierKey = useMemo(() => getMaterialOrderPricingTierKey(userProfile || {}), [userProfile]);
  const tierLabel = getMaterialOrderTierLabel(tierKey);
  const poCounterLabel = poUsage ? getPoCounterLabel(poUsage) : "";
  const poBlocked = !!poUsage?.atLimit;

  const [categoryId, setCategoryId] = useState(MATERIAL_CATEGORIES[0].id);
  const [productKey, setProductKey] = useState("");
  const [kitIndex, setKitIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const [lines, setLines] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [successToast, setSuccessToast] = useState("");
  const successToastTimerRef = useRef(null);
  /** Sync lock — React state alone cannot stop double-clicks before re-render. */
  const submitLockRef = useRef(false);

  // Clear any stuck lock if parent remounts after Testing Mode profile saves.
  useEffect(() => {
    submitLockRef.current = false;
    setSubmitting(false);
  }, []);

  useEffect(() => {
    return () => {
      if (successToastTimerRef.current) clearTimeout(successToastTimerRef.current);
    };
  }, []);

  function showSuccessToast() {
    const text =
      "✅ Order submitted! We'll send you an invoice to pay shortly. Questions? Call 502-640-2394";
    if (successToastTimerRef.current) clearTimeout(successToastTimerRef.current);
    setSuccessToast(text);
    setMessage(text);
    // Prefer app-level toast so auth remounts / key changes cannot wipe confirmation.
    if (typeof onSubmitSuccess === "function") {
      onSubmitSuccess(text);
    }
    successToastTimerRef.current = setTimeout(() => {
      setSuccessToast("");
      successToastTimerRef.current = null;
    }, 8000);
  }

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

  /**
   * Submit goes ONLY through /api/send-po-email.
   * The API inserts with the service role (bypasses RLS), then emails Gary.
   * Client never inserts directly — that was the failed-insert + still-email failure mode.
   */
  async function submitOrder() {
    // Keep this as the very first statement so we always know the handler fired.
    console.log("[material-order] submitOrder START", {
      linesCount: lines.length,
      userId: session?.user?.id,
      submitting,
      locked: submitLockRef.current,
      tierKey,
      membership: userProfile?.membership_tier,
      isFgpCustomer: userProfile?.isFgpCustomer,
      assignedPricingTierKey: userProfile?.assignedPricingTierKey,
    });

    if (lines.length === 0) {
      console.log("[material-order] blocked: no line items");
      setMessage("Add at least one line with “+ Add line” before submitting.");
      return;
    }
    if (poBlocked) {
      setMessage("PO limit reached — upgrade to Tier 2 for unlimited submissions.");
      return;
    }
    if (!session?.user?.id) {
      console.log("[material-order] blocked: no session user id");
      setMessage("Session expired — log out and log back in, then try again.");
      return;
    }
    if (submitLockRef.current) {
      console.log("[material-order] submit blocked (already in flight)");
      setMessage("Submit already in progress — wait a moment, or refresh if this is stuck.");
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setMessage("Submitting material order…");

    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), 30000)
      : null;

    try {
      const items = lines.map(({ id: _id, ...rest }) => rest);
      const requestId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `mo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const orderPayload = {
        items,
        total_msrp: totals.totalMsrp,
        total_discount: totals.totalDiscount,
        total_price: totals.totalPrice,
        pricing_tier_key: tierKey,
        status: "submitted",
      };

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        throw new Error("Session expired — log out and log back in, then try again.");
      }

      const apiBase = getApiBase();
      const emailUrl = `${apiBase}/api/send-po-email`;
      console.log("[material-order] BEFORE API submit (server inserts + emails)", {
        emailUrl,
        requestId,
        itemCount: items.length,
        tierKey,
      });

      const emailRes = await fetch(emailUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          requestId,
          order: orderPayload,
          profile: userProfile,
          tierLabel,
        }),
        signal: controller?.signal,
      });
      const emailBody = await emailRes.json().catch(() => ({}));
      console.log("[material-order] API RESPONSE", {
        status: emailRes.status,
        ok: emailRes.ok,
        body: emailBody,
      });

      if (!emailRes.ok) {
        // 502 can mean "saved but email failed" — still surface confirmation if a row came back.
        if (emailBody?.order?.id) {
          setLines([]);
          showSuccessToast();
          try {
            onOrderSaved?.(emailBody.order, { annual_po_count: emailBody.annual_po_count });
          } catch (cbErr) {
            console.error("[material-order] onOrderSaved callback error", cbErr);
          }
        }
        throw new Error(emailBody?.error || "Could not submit material order.");
      }

      const saved = emailBody?.order;
      if (!saved?.id) {
        console.warn("[material-order] ok response missing order.id — still confirming to user", emailBody);
        showSuccessToast();
        setLines([]);
        return;
      }

      // Toast first so parent remount / history reload cannot swallow confirmation.
      if (emailBody.duplicate) {
        setMessage("Material order already submitted (duplicate click blocked).");
      } else {
        showSuccessToast();
        if (emailBody.emailed === false) {
          setMessage("Material order saved, but email to Gary may not have sent. Check with FGP.");
        }
      }
      setLines([]);
      try {
        onOrderSaved?.(saved, { annual_po_count: emailBody.annual_po_count });
      } catch (cbErr) {
        console.error("[material-order] onOrderSaved callback error", cbErr);
      }
    } catch (e) {
      console.error("[material-order] submitOrder FAILED", e);
      const aborted = e?.name === "AbortError";
      setMessage(
        aborted
          ? "Submit timed out after 30s — check your connection and try again."
          : e?.message || "Could not submit material order."
      );
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      setSubmitting(false);
      submitLockRef.current = false;
      console.log("[material-order] submitOrder DONE (lock cleared)");
    }
  }

  const mainCats = MATERIAL_CATEGORIES.filter((c) => c.group === "main");
  const ancCats = MATERIAL_CATEGORIES.filter((c) => c.group === "ancillary");

  return (
    <div style={{ ...S.card, marginTop: 12, border: "1px solid #113a72" }}>
      {successToast && (
        <div
          role="status"
          style={{
            position: "fixed",
            top: 18,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10050,
            maxWidth: "min(520px, calc(100vw - 24px))",
            background: "#166534",
            color: "#ffffff",
            padding: "14px 18px",
            borderRadius: 8,
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 800,
            fontSize: 13,
            lineHeight: 1.4,
            textAlign: "center",
            boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
            border: "1px solid #86efac",
          }}
        >
          {successToast}
        </div>
      )}
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
          {poCounterLabel && (
            <div
              style={{
                fontSize: 11,
                color: poUsage?.atLimit ? "#fca5a5" : poUsage?.atWarning ? "#f5d676" : "#9bb2d1",
                marginBottom: 10,
                fontWeight: 700,
              }}
            >
              {poCounterLabel}
            </div>
          )}
          {poUsage?.atWarning && !poUsage?.atLimit && (
            <div style={{ fontSize: 11, color: "#f5d676", marginBottom: 10 }}>
              {poUsage.count} of {poUsage.limit} POs used this year
            </div>
          )}
          {poUsage?.atLimit && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#fca5a5", fontWeight: 900, marginBottom: 6 }}>PO limit reached</div>
              <button type="button" style={{ ...S.btnSm, borderColor: "#e33433", color: "#fff" }} onClick={() => onUpgrade?.()}>
                Upgrade to Tier 2 for unlimited
              </button>
            </div>
          )}
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

      {lines.length === 0 && (
        <div style={{ marginTop: 10, fontSize: 10, color: "#9bb2d1" }}>
          Pick a product, set qty, then tap <strong style={{ color: "#fff" }}>+ Add line</strong> before submitting.
        </div>
      )}

      <button
        type="button"
        disabled={submitting || poBlocked}
        style={{
          ...S.btn,
          width: "100%",
          marginTop: 12,
          opacity: submitting || poBlocked ? 0.7 : lines.length === 0 ? 0.85 : 1,
          cursor: submitting || poBlocked ? "not-allowed" : "pointer",
          pointerEvents: "auto",
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          console.log("[material-order] Submit button CLICKED", {
            linesCount: lines.length,
            submitting,
            locked: submitLockRef.current,
          });
          void submitOrder();
        }}
      >
        {submitting ? "Submitting…" : poBlocked ? "PO limit reached" : "Submit material PO"}
      </button>

      {message && (
        <div
          style={{
            marginTop: 10,
            fontSize: 11,
            color: /submitted|invoice/i.test(message) ? "#86efac" : "#fca5a5",
            lineHeight: 1.45,
          }}
        >
          {message}
        </div>
      )}
    </div>
  );
}
