/**
 * Subtle navy/red upgrade prompts — Amazon-style, not aggressive.
 * Reframed for Free / Estimator ($49) / Calculator ($149). No vendor-PO or unshipped estimate promos.
 */
import { useState } from "react";

const MATERIAL_ORDER_SNOOZE_KEY = "ecos_upsell_material_order_snooze_until";
const SNOOZE_DAYS = 14;

function readSnoozeUntil() {
  try {
    const raw = window.localStorage.getItem(MATERIAL_ORDER_SNOOZE_KEY);
    if (!raw) return 0;
    const ts = Number(raw);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function isMaterialOrderSnoozed() {
  return Date.now() < readSnoozeUntil();
}

function snoozeMaterialOrderUpsell() {
  const until = Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000;
  try {
    window.localStorage.setItem(MATERIAL_ORDER_SNOOZE_KEY, String(until));
  } catch {
    /* ignore */
  }
  return until;
}

export default function UpgradeUpsell({ variant, onUpgrade, btnSmStyle = {} }) {
  const [snoozed, setSnoozed] = useState(() =>
    variant === "material-order" ? isMaterialOrderSnoozed() : false
  );

  const cardBase = {
    borderRadius: 8,
    padding: "12px 14px",
    marginBottom: 12,
    border: "1px solid #113a72",
    background: "rgba(10, 24, 48, 0.92)",
    borderLeft: "4px solid #e33433",
  };

  const titleStyle = {
    fontSize: 12,
    color: "#ffffff",
    fontFamily: "'Montserrat', sans-serif",
    fontWeight: 900,
    marginBottom: 6,
  };

  const bodyStyle = { fontSize: 11, color: "#b8c9e0", lineHeight: 1.55, marginBottom: 8 };
  const bulletStyle = { fontSize: 11, color: "#d2def1", lineHeight: 1.55, margin: "0 0 4px 14px", padding: 0 };

  const ctaBtn = {
    ...btnSmStyle,
    borderColor: "#e33433",
    color: "#fff",
    fontSize: 11,
    marginTop: 2,
  };

  if (variant === "calculator-submit") {
    return (
      <div style={cardBase}>
        <div style={titleStyle}>Unlock Estimator</div>
        <ul style={{ margin: "0 0 8px 0", padding: 0, listStyle: "none" }}>
          <li style={bulletStyle}>• All 8 ET flooring systems</li>
          <li style={bulletStyle}>• Custom systems builder</li>
          <li style={bulletStyle}>• Full My Orders + 50 POs/year</li>
          <li style={bulletStyle}>• Apply for contractor pricing</li>
        </ul>
        <button type="button" style={ctaBtn} onClick={onUpgrade}>
          → Upgrade to Estimator — $49/mo
        </button>
      </div>
    );
  }

  if (variant === "po-warning") {
    return (
      <div
        style={{
          ...cardBase,
          border: "1px solid rgba(234, 179, 8, 0.45)",
          background: "rgba(234, 179, 8, 0.07)",
          borderLeft: "4px solid #eab308",
        }}
      >
        <div style={{ ...bodyStyle, color: "#e8d48a", marginBottom: 10 }}>
          Estimator limit: 50 POs/year. Upgrade to Calculator for unlimited POs + Professional Estimates.
        </div>
        <button type="button" style={{ ...ctaBtn, borderColor: "#eab308" }} onClick={onUpgrade}>
          → Upgrade to Calculator — $149/mo
        </button>
      </div>
    );
  }

  if (variant === "material-order") {
    if (snoozed) return null;
    return (
      <div style={{ ...cardBase, marginBottom: 14 }}>
        <div style={{ ...titleStyle, fontSize: 11, color: "#9bb2d1", marginBottom: 4 }}>Pro tip</div>
        <div style={bodyStyle}>
          Estimator unlocks all 8 systems, custom builders, and full order history — you&apos;re already building smarter material lists.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <button type="button" style={ctaBtn} onClick={onUpgrade}>
            → Upgrade to Estimator
          </button>
          <button
            type="button"
            style={{
              ...btnSmStyle,
              borderColor: "#113a72",
              color: "#9bb2d1",
              fontSize: 11,
              marginTop: 2,
            }}
            onClick={() => {
              snoozeMaterialOrderUpsell();
              setSnoozed(true);
            }}
          >
            Remind me later
          </button>
        </div>
      </div>
    );
  }

  return null;
}
