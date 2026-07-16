/** Subtle navy/red upgrade prompts — Amazon-style, not aggressive. */
export default function UpgradeUpsell({ variant, onUpgrade, btnSmStyle = {} }) {
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
        <div style={titleStyle}>Unlock Tier 2 features</div>
        <ul style={{ margin: "0 0 8px 0", padding: 0, listStyle: "none" }}>
          <li style={bulletStyle}>• Build your own custom systems</li>
          <li style={bulletStyle}>• Generate POs to ANY vendor (not just FGP)</li>
          <li style={bulletStyle}>• Send Customized Client Estimates</li>
        </ul>
        <button type="button" style={ctaBtn} onClick={onUpgrade}>
          → Upgrade to Tier 2 for $149/mo
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
          Tier 1 limit: 50 POs/year. Upgrade to Tier 2 for unlimited.
        </div>
        <button type="button" style={{ ...ctaBtn, borderColor: "#eab308" }} onClick={onUpgrade}>
          → Upgrade to Tier 2
        </button>
      </div>
    );
  }

  if (variant === "material-order") {
    return (
      <div style={{ ...cardBase, marginBottom: 14 }}>
        <div style={{ ...titleStyle, fontSize: 11, color: "#9bb2d1", marginBottom: 4 }}>Pro tip</div>
        <div style={bodyStyle}>
          Tier 2+ can name custom systems + generate vendor POs — you've already saved yourself $149 at least this month putting together orders!
        </div>
        <button type="button" style={ctaBtn} onClick={onUpgrade}>
          → Upgrade now
        </button>
      </div>
    );
  }

  return null;
}
