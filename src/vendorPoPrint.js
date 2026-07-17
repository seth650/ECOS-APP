/**
 * Vendor PO printable HTML — contractor name front & center, ECOS branding in footer.
 * User can Print → Save as PDF.
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function usd(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export function buildVendorPoText({
  contractorName,
  companyName,
  vendorName,
  vendorEmail,
  jobName,
  address,
  systemName,
  sqFt,
  lines,
  sentAt,
}) {
  const who = companyName || contractorName || "Contractor";
  const rows = (lines || [])
    .map(
      (l) =>
        `${l.product || l.layer} | ${l.kitSize} x${l.qty} | needs ${l.totalNeeded} | ${usd(l.tierEa)} ea | line ${usd(l.lineTier)}`
    )
    .join("\n");
  const total = (lines || []).reduce((s, l) => s + Number(l.lineTier || 0), 0);
  return [
    `PO — ${who}`,
    `Order submitted via ECOS by ${who}`,
    "",
    `Vendor: ${vendorName || "—"}${vendorEmail ? ` <${vendorEmail}>` : ""}`,
    `Job / PO #: ${jobName || "—"}`,
    `Address: ${address || "—"}`,
    `System: ${systemName || "Custom"}`,
    `Area: ${Number(sqFt || 0).toLocaleString()} ft²`,
    sentAt ? `Sent: ${new Date(sentAt).toLocaleString()}` : "",
    "",
    "=== MATERIALS ===",
    rows || "(no lines)",
    "",
    `TOTAL: ${usd(total)}`,
    "",
    "---",
    "Generated with ECOS · An Epoxy Twins Product · epoxyquoting.com",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function openVendorPoPrint(payload) {
  const {
    contractorName,
    companyName,
    vendorName,
    vendorEmail,
    jobName,
    address,
    systemName,
    sqFt,
    lines,
    sentAt,
  } = payload || {};
  const who = companyName || contractorName || "Contractor";
  const total = (lines || []).reduce((s, l) => s + Number(l.lineTier || 0), 0);
  const rowsHtml = (lines || [])
    .map(
      (l) => `
      <tr>
        <td>${escapeHtml(l.layer || l.product)}</td>
        <td>${escapeHtml(l.totalNeeded)}</td>
        <td>${escapeHtml(l.kitSize)}</td>
        <td style="text-align:right">${escapeHtml(String(l.qty))}</td>
        <td style="text-align:right">${escapeHtml(usd(l.tierEa))}</td>
        <td style="text-align:right">${escapeHtml(usd(l.lineTier))}</td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>PO — ${escapeHtml(who)}</title>
  <style>
    body { font-family: Arial, Helvetica, sans-serif; color: #0a1830; margin: 32px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .sub { color: #334155; font-size: 13px; margin-bottom: 18px; }
    .meta { font-size: 13px; line-height: 1.55; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border-bottom: 1px solid #cbd5e1; padding: 8px 6px; text-align: left; }
    th { color: #64748b; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }
    .total { margin-top: 16px; font-size: 16px; font-weight: 700; }
    .footer { margin-top: 36px; padding-top: 12px; border-top: 2px solid #113a72; font-size: 11px; color: #64748b; }
    .brand { color: #e33433; font-weight: 700; }
    @media print { body { margin: 16px; } }
  </style>
</head>
<body>
  <h1>PO — ${escapeHtml(who)}</h1>
  <div class="sub">Order submitted via ECOS by ${escapeHtml(who)}</div>
  <div class="meta">
    <div><strong>Vendor:</strong> ${escapeHtml(vendorName || "—")}${vendorEmail ? ` &lt;${escapeHtml(vendorEmail)}&gt;` : ""}</div>
    <div><strong>Job / PO #:</strong> ${escapeHtml(jobName || "—")}</div>
    <div><strong>Address:</strong> ${escapeHtml(address || "—")}</div>
    <div><strong>System:</strong> ${escapeHtml(systemName || "Custom")}</div>
    <div><strong>Area:</strong> ${escapeHtml(Number(sqFt || 0).toLocaleString())} ft²</div>
    ${sentAt ? `<div><strong>Sent:</strong> ${escapeHtml(new Date(sentAt).toLocaleString())}</div>` : ""}
  </div>
  <table>
    <thead>
      <tr>
        <th>Layer</th>
        <th>Coverage needed</th>
        <th>Kit size</th>
        <th style="text-align:right">Qty</th>
        <th style="text-align:right">Price / kit</th>
        <th style="text-align:right">Line total</th>
      </tr>
    </thead>
    <tbody>${rowsHtml || "<tr><td colspan='6'>No materials</td></tr>"}</tbody>
  </table>
  <div class="total">TOTAL: ${escapeHtml(usd(total))}</div>
  <div class="footer">
    <span class="brand">ECOS</span> · An Epoxy Twins Product · epoxyquoting.com
  </div>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`;

  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
  if (!w) {
    window.alert("Pop-up blocked — allow pop-ups to download / print the PO PDF.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}
