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
  $("coverage").textContent = r.coverage.limited ? "Outcome coverage is incomplete. Choose a shorter period before making decisions." : `All saved activities are included. ${r.partialHistories} have incomplete visit history, so their attribution may be incomplete.`;
  const metrics = [["Conversions", String(r.totals.conversions), "Received or completed forms, calls, bookings and payments"], ["Connected conversions", String(r.linkedConversions), `${r.unlinkedConversions} still unattributed`], ["Payment revenue", monies(r.totals.revenueByCurrency), `${r.totals.payments} completed payments`], ["Stage changes", String(r.totals.stageChanges), "CRM activity, separate from conversions"]];
  $("metrics").replaceChildren(...metrics.map(([label, value, hint]) => { const box = el("article", "", "metric"); box.append(el("span", label, "label"), el("strong", value), el("span", hint, "hint")); return box; }));
  const journeys = $("journeys"); journeys.replaceChildren(); journeys.hidden = !r.journeys?.length;
  const people = $("people"); people.replaceChildren(); people.hidden = !data.people?.length;
  if (data.people?.length) {
    people.append(el("h2", "People and campaign history"), el("p", "Our person IDs connect verified browsers to CRM contacts. Snapshots stop at each person's latest activity in this report; changing credit models preserves history.", "small"));
    for (const person of data.people.slice(0,12)) {
      const item = el("article", "", "panel"); item.append(el("strong", `PipelineOn person: ${person.id}`), el("p", `${person.browserCount} verified browsers · ${person.activities} saved activities · ${person.status.replaceAll("_", " ")}`, "small"));
      const link = el("a", "Open HubSpot contact"); link.href = `https://app.hubspot.com/contacts/${encodeURIComponent(person.accountId)}/record/0-1/${encodeURIComponent(person.contactId)}`; link.target = "_blank"; link.rel = "noreferrer"; item.append(link);
      if (person.status === "ambiguous") item.append(el("p", "A browser has claims from different contacts. Identities have not been merged and campaign credit is withheld.", "notice"));
      const touches = person.touches?.timeline ?? [];
      const detail = el("details", ""); detail.append(el("summary", `View observed campaign touches (${touches.length})`));
      const history = el("ol", "");
      for (const touch of touches.slice(0,50)) {
        const p = touch.normalizedParameters ?? touch.parameters;
        const row = el("li", `${new Date(touch.occurredAt).toLocaleString()} · ${p.utm_source || touch.sourceLabel} · ${p.utm_campaign || "No campaign recorded"}`);
        for (const key of ["gad_campaignid", "hsa_cam", "gc_id", "campaign_id", "utm_id"]) if (p[key]) row.append(el("p", `${key}: ${p[key]}`, "small"));
        history.append(row);
      }
      detail.append(history); item.append(detail);
      if (touches.length > 50 || person.touches?.historyLimited) item.append(el("p", "Displayed or retained history is limited.", "small"));
      people.append(item);
    }
    if (data.people.length >= 12) people.append(el("p", "Showing up to 12 people. Export includes up to 100 snapshots.", "small"));
  }
  if (r.journeys?.length) {
    journeys.append(el("h2", "First and returning campaigns"), el("p", "The credit selector changes the report, not the saved history. Direct and last non-direct touches stay separate. Counts describe activities, not unique people.", "small"));
    for (const journey of r.journeys.slice(0,12)) {
      const row = el("article", "", "journey-row");
      for (const [label,touch] of [["First recorded touch",journey.first],["Latest non-direct touch",journey.lastNonDirect],["Latest touch",journey.last]]) {
        const column = el("div", ""); column.append(el("strong",label),el("p",touch ? `${touch.source} · ${touch.campaign || "No campaign recorded"}` : "Not recorded")); row.append(column);
      }
      row.append(el("p",`${journey.conversions} ${journey.conversions === 1 ? "conversion" : "conversions"} · ${journey.activities} ${journey.activities === 1 ? "activity" : "activities"}`,"journey-count")); journeys.append(row);
    }
    if (r.journeys.length > 12 || r.journeysLimited) journeys.append(el("p","Showing 12 summaries. Export includes up to 100; source totals include all selected activities.","small"));
  }
  $("report-summary").textContent = `${r.totals.outcomes} saved activities across the full period: ${r.totals.conversions} conversions, ${r.totals.stageChanges} stage changes and ${r.totals.otherActivities} other. ${r.totals.calls} calls · ${r.totals.forms} forms · ${r.totals.qualifiedOutcomes} source-qualified activities. Revenue uses completed payments only.`;
  const table = $("source-table"); table.replaceChildren();
  if (!r.groups.length) table.append(el("p", "Your first report starts with a recorded outcome. Install the pixel and import a form, call or payment.", "empty"));
  else {
    const heading = el("div", "", "source-row table-head"); heading.append(el("div", "Source / campaign"), el("div", "Conv.", "count"), el("div", "Stages", "count"), el("div", "Revenue", "money")); table.append(heading);
    for (const group of r.groups) {
      const row = el("div", "", "source-row"); const label = el("div", group.source);
      label.append(el("span", group.campaign || "No campaign recorded", "campaign"));
      for (const [field, value] of Object.entries(group.campaignIds)) label.append(el("span", `${field}: ${value}`, "campaign"));
      if (group.campaignConflict) label.append(el("span", "Campaign ID conflict", "campaign-conflict"));
      if (group.otherActivities) label.append(el("span", `${group.otherActivities} other activities`, "campaign"));
      row.append(label, el("div", String(group.conversions), "count"), el("div", String(group.stageChanges), "count"), el("div", monies(group.revenueByCurrency), "money")); table.append(row);
    }
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
  $("journeys").replaceChildren(); $("journeys").hidden = true;
  $("people").replaceChildren(); $("people").hidden = true;
  $("report-summary").textContent = "";
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
