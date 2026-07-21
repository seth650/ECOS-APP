/**
 * Static Terms / Privacy document view (placeholder drafts pending attorney review).
 */
export default function LegalDocumentPage({
  styles: S,
  title,
  effectiveDate,
  sections = [],
  onBack,
}) {
  return (
    <div style={{ paddingBottom: 24 }}>
      <div
        style={{
          ...S.card,
          border: "1px solid #113a72",
          background: "linear-gradient(180deg, rgba(17,58,114,0.35) 0%, rgba(8,16,32,0.95) 120px)",
          padding: "20px 18px 28px",
        }}
      >
        <div
          style={{
            fontSize: 22,
            color: "#fff",
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 900,
            marginBottom: 6,
            lineHeight: 1.25,
          }}
        >
          {title}
        </div>
        <div style={{ fontSize: 12, color: "#e33433", fontWeight: 800, marginBottom: 8 }}>
          Effective Date: {effectiveDate}
        </div>
        <div style={{ fontSize: 10, color: "#9bb2d1", marginBottom: 18, lineHeight: 1.45 }}>
          Placeholder draft pending attorney review. Structure and routes stay the same when final copy is swapped in.
        </div>

        {sections.map((sec) => (
          <section key={sec.title} style={{ marginBottom: 20 }}>
            <h2
              style={{
                margin: "0 0 8px",
                fontSize: 14,
                color: "#e33433",
                fontFamily: "'Montserrat', sans-serif",
                fontWeight: 900,
                letterSpacing: "0.02em",
              }}
            >
              {sec.title}
            </h2>
            <div
              style={{
                fontSize: 13,
                color: "#d2def1",
                lineHeight: 1.65,
                whiteSpace: "pre-wrap",
              }}
            >
              {sec.body}
            </div>
          </section>
        ))}

        <button type="button" style={{ ...S.btnSm, width: "100%", marginTop: 8 }} onClick={onBack}>
          ← Back
        </button>
      </div>
    </div>
  );
}
