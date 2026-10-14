"use strict";
const $ = id => document.getElementById(id);
let current = null;
let loadRevision = 0;
const isoDate = date => date.toISOString().slice(0, 10);
const end = new Date();
const start = new Date(end.getTime() - 6 * 86400000);
$("from").value = isoDate(start);
$("to").value = isoDate(end);
function message(value) { $("message").textContent = value; $("message").hidden = !value; }
async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error?.message || "Request failed."); error.status = response.status; throw error; }
  return data;
}
function el(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function money(amount, currency) {
  try { const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency }); return formatter.format(amount / (10 ** formatter.resolvedOptions().maximumFractionDigits)); }
  catch (_) { return amount + " minor units (" + currency + ")"; }
}
function monies(values) { return Object.entries(values).map(([currency, amount]) => money(amount, currency)).join(" · ") || "—"; }
function render(data) {
  current = data;
  const r = data.report;
  $("coverage").hidden = !r.coverage.limited && !r.partialHistories;
  $("coverage").textContent = r.coverage.limited ? "This report reached a data limit. Totals are a sample; narrow the date range before making decisions." : `${r.partialHistories} outcomes have incomplete visit history. First-touch attribution may be incomplete.`;
  const metrics = [["Recorded outcomes", String(r.totals.outcomes), `${r.totals.calls} calls · ${r.totals.forms} forms`], ["Connected to a visit", String(r.linkedOutcomes), `${r.unlinkedOutcomes} still unattributed`], ["Payment revenue", monies(r.totals.revenueByCurrency), `${r.totals.payments} completed payments`], ["Qualified outcomes", String(r.totals.qualifiedOutcomes), "Qualification supplied by your source"]];
  $("metrics").replaceChildren(...metrics.map(([label, value, hint]) => { const box = el("article", "", "metric"); box.append(el("span", label, "label"), el("strong", value), el("span", hint, "hint")); return box; }));
  const table = $("source-table"); table.replaceChildren();
  if (!r.groups.length) table.append(el("p", "Your first report starts with a recorded outcome. Install the pixel and import a form, call or payment.", "empty"));
  else {
    const heading = el("div", "", "source-row table-head"); heading.append(el("div", "Source / campaign"), el("div", "Events", "count"), el("div", "Revenue", "money")); table.append(heading);
    for (const group of r.groups) { const row = el("div", "", "source-row"); const label = el("div", group.source); label.append(el("span", group.campaign || "No campaign recorded", "campaign")); row.append(label, el("div", String(group.outcomes), "count"), el("div", monies(group.revenueByCurrency), "money")); table.append(row); }
  }
  $("checks").replaceChildren(...data.doctor.checks.map(check => {
    const row = el("div", "", `check ${check.status}`); const detail = el("div", ""); detail.append(el("strong", check.title), el("p", check.detail));
    if (check.status !== "pass") { const more = el("details", ""); more.append(el("summary", "What to check"), el("p", check.action)); detail.append(more); }
    row.append(el("span", check.status === "pass" ? "✓" : check.status === "action" ? "!" : "?", "dot"), detail); return row;
  }));
}
async function load() {
  const revision = ++loadRevision;
  current = null;
  $("metrics").replaceChildren();
  $("source-table").replaceChildren(el("p", "Loading report…", "empty"));
  $("checks").replaceChildren();
  $("coverage").hidden = true;
  $("export").disabled = true;
  message("");
  $("filters").querySelector("button").disabled = true;
  try {
    const to = new Date($("to").value + "T00:00:00Z"); to.setUTCDate(to.getUTCDate() + 1);
    const until = new Date(Math.min(to.getTime(), Date.now()));
    const query = new URLSearchParams({ from: $("from").value + "T00:00:00Z", to: until.toISOString(), model: $("model").value });
    const data = await api("/v1/report?" + query, {});
    if (revision === loadRevision) { render(data); $("export").disabled = false; }
  } catch (error) { if (revision === loadRevision) { current = null; $("source-table").replaceChildren(); message(error.message); if (error.status === 401) showLogin(); } }
  finally { if (revision === loadRevision) $("filters").querySelector("button").disabled = false; }
}
function showLogin() { $("workspace").hidden = true; $("login").hidden = false; $("sign-out").hidden = true; current = null; window.dispatchEvent(new Event("open-attribution:signout")); }
async function enter() {
  const config = await api("/v1/config", {});
  $("site-name").textContent = config.name;
  $("snippet").textContent = `<script defer src="${config.publicUrl}/pixel.js" data-site="${config.siteId}"></script>\n\n// After consent:\nOpenAttribution.sites[${JSON.stringify(config.siteId)}].consent(true);\n\n// Add to forms:\ndata-attribution-site="${config.siteId}"`;
  $("login").hidden = true; $("workspace").hidden = false; $("sign-out").hidden = false;
  window.dispatchEvent(new Event("open-attribution:dashboard"));
  await load();
}
$("login-form").addEventListener("submit", async event => {
  event.preventDefault(); message(""); const button = event.currentTarget.querySelector("button"); button.disabled = true;
  try { await api("/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: $("token").value }) }); $("token").value = ""; await enter(); }
  catch (error) { message(error.message); } finally { button.disabled = false; }
});
$("filters").addEventListener("submit", event => { event.preventDefault(); load(); });
$("sign-out").addEventListener("click", async () => { try { await api("/session", { method: "DELETE" }); loadRevision++; showLogin(); message(""); } catch (error) { message(error.message); } });
$("export").addEventListener("click", () => {
  if (!current) { message("Load a report before exporting."); return; }
  const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "attribution-report.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
enter().catch(error => { showLogin(); if (error.status !== 401) message(error.message); });
