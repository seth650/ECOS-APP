/**
 * Professional Estimate scaffold (Calculator tier).
 * PDF via print dialog; JPG via canvas capture of the estimate surface.
 * Template layout polish is post-MVP — core export ships here.
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function usd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

/**
 * @param {object} opts
 * @param {object} opts.profile — logo_url, brand colors, company
 * @param {object} opts.job — job details
 * @param {array} opts.materials — line items
 * @param {object} opts.totals — materials, labor, total, margin (margin contractor-only)
 * @param {boolean} [opts.includeMargin=true] — false for customer-facing PDF
 */
export function buildProfessionalEstimateHtml({
  profile = {},
  job = {},
  materials = [],
  totals = {},
  includeMargin = false,
} = {}) {
  const primary = profile.brand_color_primary || "#113a72";
  const secondary = profile.brand_color_secondary || "#e33433";
  const company =
    profile.company_name ||
    [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
    "Contractor";
  const logo = profile.logo_url || "";
  const materialRows = (materials || [])
    .map(
      (m) => `<tr>
      <td>${escapeHtml(m.layer || m.label || "Material")}</td>
      <td>${escapeHtml(m.product || m.productName || "")}</td>
      <td style="text-align:right">${escapeHtml(String(m.qty ?? m.totalNeeded ?? "—"))}</td>
      <td style="text-align:right">${usd(m.lineTotal ?? m.tierPrice ?? m.msrp)}</td>
    </tr>`
    )
    .join("");

  const marginBlock = includeMargin
    ? `<div class="margin-box">
        <div><strong>Contractor margin (internal)</strong></div>
        <div>Labor estimate: ${usd(totals.labor)}</div>
        <div>Material: ${usd(totals.materials)}</div>
        <div>Total: ${usd(totals.total)}</div>
        <div>Est. margin: ${usd(totals.margin)} (${escapeHtml(String(totals.marginPct ?? "—"))}%)</div>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Professional Estimate — ${escapeHtml(job.jobName || "Job")}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #111; background: #f7f7f7; }
    .sheet {
      max-width: 800px; margin: 24px auto; background: #fff;
      border: 1px solid #ddd; overflow: hidden;
    }
    .splash-top {
      height: 14px;
      background: linear-gradient(90deg, ${escapeHtml(primary)} 0%, ${escapeHtml(secondary)} 100%);
    }
    .splash-side {
      position: absolute; left: 0; top: 0; bottom: 0; width: 8px;
      background: ${escapeHtml(primary)};
    }
    .inner { position: relative; padding: 28px 36px 36px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand img { max-height: 56px; max-width: 160px; object-fit: contain; }
    .company { font-size: 22px; font-weight: 700; color: ${escapeHtml(primary)}; letter-spacing: 0.02em; }
    .eyebrow { font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: ${escapeHtml(secondary)}; font-weight: 700; }
    h1 { font-size: 26px; margin: 0 0 4px; color: #111; }
    .meta { font-size: 13px; color: #444; line-height: 1.55; }
    table { width: 100%; border-collapse: collapse; margin: 18px 0; font-size: 13px; }
    th { text-align: left; border-bottom: 2px solid ${escapeHtml(primary)}; padding: 8px 6px; color: ${escapeHtml(primary)}; }
    td { border-bottom: 1px solid #e5e7eb; padding: 8px 6px; }
    .totals { margin-top: 12px; text-align: right; font-size: 14px; line-height: 1.7; }
    .totals .grand { font-size: 18px; font-weight: 700; color: ${escapeHtml(primary)}; }
    .margin-box {
      margin-top: 20px; padding: 12px 14px; background: #fafafa;
      border-left: 4px solid ${escapeHtml(secondary)}; font-size: 12px; color: #333;
    }
    .footer {
      margin-top: 28px; padding-top: 12px; border-top: 1px solid #e5e7eb;
      font-size: 10px; color: #888; display: flex; justify-content: space-between;
    }
    .accent-bar {
      height: 6px; margin-top: 8px;
      background: linear-gradient(90deg, ${escapeHtml(secondary)} 0%, ${escapeHtml(primary)} 70%, transparent 100%);
    }
    @media print {
      body { background: #fff; }
      .sheet { margin: 0; border: none; box-shadow: none; max-width: none; }
    }
  </style>
</head>
<body>
  <div class="sheet" id="ecos-estimate-sheet">
    <div class="splash-top"></div>
    <div class="inner">
      <div class="splash-side"></div>
      <div class="header">
        <div class="brand">
          ${logo ? `<img src="${escapeHtml(logo)}" alt="Logo" />` : ""}
          <div>
            <div class="eyebrow">Professional Estimate</div>
            <div class="company">${escapeHtml(company)}</div>
          </div>
        </div>
        <div class="meta" style="text-align:right">
          <div>${escapeHtml(new Date().toLocaleDateString())}</div>
          <div>${escapeHtml(profile.email || "")}</div>
        </div>
      </div>
      <h1>${escapeHtml(job.jobName || "Job Estimate")}</h1>
      <div class="accent-bar"></div>
      <div class="meta" style="margin-top:12px">
        <div><strong>Location:</strong> ${escapeHtml(job.address || "—")}</div>
        <div><strong>System:</strong> ${escapeHtml(job.systemLabel || job.systemCode || "—")}</div>
        <div><strong>Square footage:</strong> ${escapeHtml(String(job.sqFt ?? "—"))}</div>
      </div>
      <table>
        <thead>
          <tr><th>Layer</th><th>Product</th><th style="text-align:right">Qty / Need</th><th style="text-align:right">Amount</th></tr>
        </thead>
        <tbody>
          ${materialRows || `<tr><td colspan="4">No materials listed</td></tr>`}
        </tbody>
      </table>
      <div class="totals">
        <div>Materials: ${usd(totals.materials)}</div>
        <div>Labor estimate: ${usd(totals.labor)}</div>
        <div class="grand">Total: ${usd(totals.total)}</div>
      </div>
      ${marginBlock}
      <div class="footer">
        <span>Prepared with ECOS</span>
        <span style="color:${escapeHtml(secondary)}">${escapeHtml(company)}</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/** Open print dialog (user can Save as PDF). */
export function openProfessionalEstimatePrint(opts) {
  const html = buildProfessionalEstimateHtml({ ...opts, includeMargin: false });
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=1100");
  if (!w) {
    window.alert("Pop-up blocked — allow pop-ups to download the estimate PDF.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => {
    try {
      w.print();
    } catch {
      /* ignore */
    }
  }, 400);
}

/**
 * Render estimate off-screen and export as JPG (works on mobile for camera roll save via download).
 */
export async function downloadProfessionalEstimateJpg(opts) {
  const html = buildProfessionalEstimateHtml({ ...opts, includeMargin: false });
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;left:-9999px;top:0;width:800px;height:1100px;opacity:0;pointer-events:none";
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();
    await new Promise((r) => setTimeout(r, 500));
    const sheet = doc.getElementById("ecos-estimate-sheet");
    if (!sheet) throw new Error("Estimate sheet missing.");

    // Dynamic import-free canvas path via foreignObject SVG
    const width = 800;
    const height = Math.max(1100, sheet.scrollHeight || 1100);
    const serializer = new XMLSerializer();
    const cloned = sheet.cloneNode(true);
    const wrap = doc.createElement("div");
    wrap.appendChild(cloned);
    const markup = serializer.serializeToString(wrap);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml">${markup.replace(/xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, "")}</div>
      </foreignObject>
    </svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width * 2;
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);

    const jpgUrl = canvas.toDataURL("image/jpeg", 0.92);
    const a = document.createElement("a");
    a.href = jpgUrl;
    a.download = `ECOS-Estimate-${String(opts?.job?.jobName || "job").replace(/[^\w-]+/g, "_")}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    iframe.remove();
  }
}

/** Contractor-only view with margin (screen preview / internal print). */
export function openContractorEstimateWithMargin(opts) {
  const html = buildProfessionalEstimateHtml({ ...opts, includeMargin: true });
  const w = window.open("", "_blank", "noopener,noreferrer,width=900,height=1100");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}
