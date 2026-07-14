/**
 * Phase 3 — Job Card checklist helpers + print HTML.
 * Kit pull qty already computed on quote lines (rounded up to whole kits).
 */

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Clean "2.60 gal" / "0.85 kit…" for card display. */
export function formatNeededForJobCard(totalNeeded = "") {
  const raw = String(totalNeeded || "").trim();
  if (!raw || raw === "—") return "—";
  const kitMatch = raw.match(/^([\d.]+)\s*kit\b/i);
  if (kitMatch) return `${kitMatch[1]} kit`;
  const simple = raw.match(/^([\d.]+)\s*(gal|lbs|oz|lb)\b/i);
  if (simple) return `${simple[1]} ${simple[2].toLowerCase()}`;
  // Fall back: strip trailing “job calc → …” noise
  return raw.split("→")[0].trim() || raw;
}

/**
 * Group quote lines into checklist rows.
 * Example: ☐ Basecoat — 2.6 gal needed → Pull: 1×3 gal kit
 */
export function buildJobCardChecklistItems(orderLines = []) {
  const groups = new Map();
  for (const line of orderLines || []) {
    const label = line.layer || line.product || "Material";
    const key = `${label}||${line.product || ""}`;
    if (!groups.has(key)) {
      groups.set(key, {
        label,
        product: line.product || "",
        needed: formatNeededForJobCard(line.totalNeeded),
        pulls: [],
      });
    }
    const g = groups.get(key);
    if (line.totalNeeded && g.needed === "—") {
      g.needed = formatNeededForJobCard(line.totalNeeded);
    }
    const size = String(line.kitSize || "kit").trim();
    const qty = Math.max(1, Math.floor(Number(line.qty) || 1));
    // "40lb box" / "pair" already have a unit; "3 gal" → "1×3 gal kit"
    const hasUnitWord = /\b(kit|box|bag|jar|pair|each|pack)\b/i.test(size);
    const kitWord = qty === 1 ? "kit" : "kits";
    g.pulls.push(hasUnitWord ? `${qty}×${size}` : `${qty}×${size} ${kitWord}`);
  }

  return [...groups.values()].map((g) => {
    const pullText = g.pulls.join(" + ");
    return {
      label: g.label,
      product: g.product,
      needed: g.needed,
      pullText,
      lineText: `☐ ${g.label} — ${g.needed} needed → Pull: ${pullText}`,
    };
  });
}

function renderJobCardHtml(job, orderRecord, index, total) {
  const jobName = job.jobNamePo || orderRecord.job_name || orderRecord.jobNamePo || "Untitled Job / PO";
  const company =
    orderRecord.customer_name ||
    orderRecord.company_name ||
    [orderRecord.first_name, orderRecord.last_name].filter(Boolean).join(" ") ||
    "";
  // Quote field is "Job Name / PO #" — use as customer when no separate company.
  const customer = company && company !== jobName ? company : jobName;
  const jobNumber = jobName;
  const system = job.systemCode || orderRecord.system_code || orderRecord.systemCode || "—";
  const sqFt = Number(job.sqFt ?? job.sf ?? orderRecord.sq_footage ?? orderRecord.sqFt ?? 0);
  const dateStr = new Date(orderRecord.created_at || orderRecord.submittedAt || Date.now()).toLocaleDateString();
  const address = job.address || orderRecord.address || "";
  const items = buildJobCardChecklistItems(job.orderLines || orderRecord.order_lines || []);
  const checklist = items
    .map(
      (item) =>
        `<div class="check-row"><span class="box">☐</span><span class="check-text"><strong>${escapeHtml(item.label)}</strong> — ${escapeHtml(item.needed)} needed → <span class="pull">Pull: ${escapeHtml(item.pullText)}</span></span></div>`
    )
    .join("");

  return `
    <section class="card">
      <header class="card-header">
        <div class="brand-row">
          <div class="brand">ECOS · Epoxy Twins</div>
          <div class="tag">JOB CARD ${total > 1 ? `${index + 1}/${total}` : ""}</div>
        </div>
        <h1>${escapeHtml(jobNumber)}</h1>
        <div class="meta-grid">
          <div><span class="k">Customer</span><span class="v">${escapeHtml(customer)}</span></div>
          <div><span class="k">Job # / PO</span><span class="v">${escapeHtml(jobNumber)}</span></div>
          <div><span class="k">Date</span><span class="v">${escapeHtml(dateStr)}</span></div>
          <div><span class="k">Total sq ft</span><span class="v">${sqFt.toLocaleString()} ft²</span></div>
          <div><span class="k">System</span><span class="v">${escapeHtml(system)}</span></div>
          ${address ? `<div class="full"><span class="k">Address</span><span class="v">${escapeHtml(address)}</span></div>` : ""}
        </div>
      </header>
      <div class="section-label">Materials checklist — pull kits</div>
      <div class="checklist">
        ${checklist || `<div class="check-row"><span class="box">☐</span><span class="check-text">No materials on this quote.</span></div>`}
      </div>
      <footer class="card-footer">
        <div class="blank"><span class="k">Special notes</span><div class="lines"></div></div>
        <div class="sign-row">
          <div class="blank half"><span class="k">Staged by (initials)</span><div class="line"></div></div>
          <div class="blank half"><span class="k">Date</span><div class="line"></div></div>
        </div>
        <div class="no-price">Technician use only — no pricing</div>
      </footer>
    </section>
  `;
}

/** Full print document: landscape letter, 2 job cards per page. */
export function buildJobCardPrintDocument(orderRecord) {
  const jobs =
    Array.isArray(orderRecord?.jobs) && orderRecord.jobs.length
      ? orderRecord.jobs
      : [
          {
            jobNamePo: orderRecord?.job_name || orderRecord?.jobNamePo,
            systemCode: orderRecord?.system_code || orderRecord?.systemCode,
            sqFt: orderRecord?.sq_footage || orderRecord?.sqFt,
            address: orderRecord?.address,
            orderLines: orderRecord?.order_lines || orderRecord?.orderLines || [],
          },
        ];

  const pages = [];
  for (let i = 0; i < jobs.length; i += 2) {
    const pair = jobs.slice(i, i + 2);
    const cards = pair.map((job, idx) => renderJobCardHtml(job, orderRecord || {}, i + idx, jobs.length)).join("");
    pages.push(`<div class="page"><div class="grid cols-${pair.length}">${cards}</div></div>`);
  }

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>ECOS Job Card</title>
    <style>
      @page { size: letter landscape; margin: 0.35in; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #0a1830;
        font-family: "Open Sans", Arial, Helvetica, sans-serif;
        background: #fff;
      }
      .page { page-break-after: always; }
      .page:last-child { page-break-after: auto; }
      .grid {
        display: grid;
        gap: 12px;
        height: 7.8in;
        align-items: stretch;
      }
      .grid.cols-2 { grid-template-columns: 1fr 1fr; }
      .grid.cols-1 { grid-template-columns: 1fr; max-width: 50%; }
      .card {
        border: 2px solid #113a72;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
        background: #fff;
      }
      .card-header {
        background: linear-gradient(180deg, #0a1830 0%, #113a72 100%);
        color: #fff;
        padding: 8px 10px 10px;
        border-bottom: 3px solid #e33433;
      }
      .brand-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
      .brand {
        font-family: "Encode Sans Expanded", Arial, sans-serif;
        font-size: 8px;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: #9bb2d1;
      }
      .tag {
        font-family: Montserrat, Arial, sans-serif;
        font-weight: 900;
        font-size: 9px;
        letter-spacing: 0.08em;
        color: #f5d676;
      }
      h1 {
        margin: 0 0 6px;
        font-family: Montserrat, Arial, sans-serif;
        font-weight: 900;
        font-size: 15px;
        line-height: 1.15;
        color: #fff;
      }
      .meta-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3px 10px;
        font-size: 9.5px;
      }
      .meta-grid .full { grid-column: 1 / -1; }
      .meta-grid .k {
        display: block;
        font-size: 7.5px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #9bb2d1;
      }
      .meta-grid .v { color: #fff; font-weight: 700; }
      .section-label {
        padding: 5px 10px;
        font-family: "Encode Sans Expanded", Arial, sans-serif;
        font-size: 8px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #e33433;
        background: #f5f7fa;
        border-bottom: 1px solid #d5deea;
      }
      .checklist {
        flex: 1;
        padding: 6px 10px;
        overflow: hidden;
        font-size: 10px;
        line-height: 1.3;
      }
      .check-row {
        display: flex;
        gap: 6px;
        align-items: flex-start;
        padding: 3px 0;
        border-bottom: 1px dotted #c9d4e3;
      }
      .box {
        font-size: 12px;
        line-height: 1.2;
        color: #113a72;
        flex-shrink: 0;
      }
      .check-text { color: #0a1830; }
      .pull { color: #113a72; font-weight: 700; }
      .card-footer {
        margin-top: auto;
        padding: 8px 10px 10px;
        border-top: 1px solid #113a72;
        background: #f8fafc;
      }
      .blank .k {
        display: block;
        font-size: 7.5px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6b7f99;
        margin-bottom: 3px;
      }
      .lines {
        height: 28px;
        border-bottom: 1px solid #9bb2d1;
        margin-bottom: 4px;
      }
      .lines::after {
        content: "";
        display: block;
        height: 14px;
        border-bottom: 1px solid #9bb2d1;
        margin-top: 12px;
      }
      .sign-row { display: flex; gap: 12px; margin-top: 6px; }
      .half { flex: 1; }
      .line {
        height: 18px;
        border-bottom: 1px solid #9bb2d1;
      }
      .no-price {
        margin-top: 6px;
        font-size: 7.5px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: #9bb2d1;
        text-align: right;
      }
    </style>
  </head>
  <body>
    ${pages.join("")}
    <script>window.print();</script>
  </body>
</html>`;
}

export function openJobCardPrint(orderRecord) {
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) return false;
  win.document.write(buildJobCardPrintDocument(orderRecord));
  win.document.close();
  return true;
}
