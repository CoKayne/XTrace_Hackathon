import type { SourceRef } from "../contracts/domain";

interface ReportEmailOpportunity {
  companyName: string;
  confidence: "medium" | "high";
  whyNow: string;
  previousContext: string;
  implications: { positive: string[]; negative: string[] };
  nextStep: string;
  sources: SourceRef[];
}

export interface ReportEmailInput {
  title: string;
  marketSummary: string;
  reportUrl: string;
  opportunities: ReportEmailOpportunity[];
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderReportEmail(input: ReportEmailInput) {
  const opportunities = input.opportunities.map((opportunity, index) => {
    const sources = opportunity.sources.map((source) => {
      const title = escapeHtml(source.title);
      const href = source.url && source.page
        ? `${source.url}#page=${source.page}`
        : source.url;
      return source.url
        ? `<li><a href="${escapeHtml(href!)}">${title}</a></li>`
        : `<li>${title}</li>`;
    }).join("");
    const positive = opportunity.implications.positive
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    const negative = opportunity.implications.negative
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    return `
      <section style="border-top:1px solid #dedede;padding:20px 0">
        <p style="margin:0 0 6px;color:#6b6b6b;font-size:12px">#${index + 1} · ${opportunity.confidence.toUpperCase()} CONFIDENCE</p>
        <h2 style="margin:0 0 12px">${escapeHtml(opportunity.companyName)}</h2>
        <p><strong>Why now:</strong> ${escapeHtml(opportunity.whyNow)}</p>
        <p><strong>Previous context:</strong> ${escapeHtml(opportunity.previousContext)}</p>
        ${positive ? `<p><strong>Potential positive effects</strong></p><ul>${positive}</ul>` : ""}
        ${negative ? `<p><strong>Potential negative effects</strong></p><ul>${negative}</ul>` : ""}
        <p><strong>Next step:</strong> ${escapeHtml(opportunity.nextStep)}</p>
        <p><strong>Sources</strong></p>
        <ul>${sources}</ul>
      </section>`;
  }).join("");

  return `<!doctype html>
  <html lang="en">
    <body style="font-family:Arial,sans-serif;color:#171717;line-height:1.5;max-width:680px;margin:auto;padding:32px">
      <p style="color:#7057ff;font-weight:700">VSEE · DEAL INTELLIGENCE</p>
      <h1>${escapeHtml(input.title)}</h1>
      <h2>Market summary</h2>
      <p>${escapeHtml(input.marketSummary)}</p>
      ${opportunities || "<p>No medium- or high-confidence Deal overlap was found.</p>"}
      <p><a href="${escapeHtml(input.reportUrl)}">Open the complete report</a></p>
    </body>
  </html>`;
}

export function renderOutreachEmail(input: {
  founderName: string;
  companyName: string;
  body: string;
}) {
  return `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;line-height:1.5">
    <p>Hi ${escapeHtml(input.founderName)},</p>
    <p>${escapeHtml(input.body)}</p>
    <p>Best,<br>VSee Demo Fund</p>
    <p style="color:#777;font-size:12px">Regarding ${escapeHtml(input.companyName)}</p>
  </body></html>`;
}
