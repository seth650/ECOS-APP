/** Sitewide minimal footer with Terms / Privacy links. */
export default function SiteFooter({ onNavigateLegal }) {
  const linkStyle = {
    background: "none",
    border: "none",
    color: "#9bb2d1",
    textDecoration: "underline",
    cursor: "pointer",
    padding: 0,
    font: "inherit",
    fontSize: 11,
  };

  return (
    <footer
      style={{
        marginTop: 28,
        paddingTop: 16,
        paddingBottom: 8,
        borderTop: "1px solid rgba(155, 178, 209, 0.2)",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 11, color: "#9bb2d1", marginBottom: 6 }}>© 2026 ECOS by Epoxy Twins</div>
      <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center", flexWrap: "wrap", fontSize: 11, color: "#9bb2d1" }}>
        <button
          type="button"
          style={linkStyle}
          onClick={() => {
            if (onNavigateLegal) onNavigateLegal("terms");
            else window.location.assign("/terms");
          }}
        >
          Terms of Service
        </button>
        <span aria-hidden="true">|</span>
        <button
          type="button"
          style={linkStyle}
          onClick={() => {
            if (onNavigateLegal) onNavigateLegal("privacy");
            else window.location.assign("/privacy");
          }}
        >
          Privacy Policy
        </button>
      </div>
    </footer>
  );
}
