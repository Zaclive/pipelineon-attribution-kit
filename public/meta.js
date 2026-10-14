import { metaStatusLabel, metaReasonMessage } from "/meta-status.js";
const byId = id => document.getElementById(id);
const element = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value; if (className) node.className = className; return node; };
let revision = 0;
async function refresh() {
  const current = ++revision;
  const list = byId("meta-deliveries"), status = byId("meta-connection");
  list.replaceChildren(); status.textContent = "Loading delivery status…";
  byId("meta-refresh").disabled = true;
  try {
    const response = await fetch("/v1/meta");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Could not load delivery status.");
    if (current !== revision) return;
    status.textContent = data.connection.configured ? `Dataset ${data.connection.datasetId} · ${data.connection.mode === "disabled" ? "Paused" : data.connection.mode === "test" ? "Test mode" : "Live mode"}` : "Meta is not connected. Configure your server to start.";
    if (!data.deliveries.length) list.append(element("p", "No requested deliveries yet. Add the Meta fields to an outcome import to begin.", "small"));
    for (const row of data.deliveries) {
      const card = element("article", "", "meta-card");
      const title = element("div", "", "section-heading");
      title.append(element("strong", `${row.eventName ?? "Outcome"}${row.mode ? ` · ${row.mode}` : ""}`), element("span", metaStatusLabel(row.status), "badge"));
      card.append(title, element("p", metaReasonMessage(row.reason), "small"));
      if (row.sourceChanged) card.append(element("p", "The source changed after an attempt. The original receipt is retained; this does not retract or correct an event at Meta.", "small"));
      card.append(element("code", row.eventId ?? row.id, "meta-id"), element("p", `${row.attempts} attempts${row.status === "retry" && row.nextAttemptAt ? ` · Next: ${new Date(row.nextAttemptAt).toLocaleString()}` : ""}`, "small"));
      if (row.history.length) {
        const details = element("details", ""); details.append(element("summary", "Delivery receipts"));
        for (const attempt of row.history) {
          details.append(element("p", `Attempt ${attempt.attempt} · ${new Date(attempt.startedAt).toLocaleString()} · ${attempt.receipt ? metaReasonMessage(attempt.receipt.reason) : "Result pending"}${attempt.receipt?.httpStatus ? ` · HTTP ${attempt.receipt.httpStatus}` : ""}${attempt.receipt?.errorCode ? ` · Error ${attempt.receipt.errorCode}` : ""}`, "small"));
          if (attempt.receipt?.traceId) details.append(element("code", `Receipt: ${attempt.receipt.traceId}`, "meta-id"));
        }
        card.append(details);
      }
      list.append(card);
    }
    if (data.limited) list.append(element("p", "Showing the latest 50 deliveries.", "small"));
  } catch (error) { if (current === revision) status.textContent = error.message; }
  finally { if (current === revision) byId("meta-refresh").disabled = false; }
}
byId("meta-refresh").addEventListener("click", refresh);
window.addEventListener("open-attribution:dashboard", refresh);
window.addEventListener("open-attribution:signout", () => { revision++; byId("meta-deliveries").replaceChildren(); byId("meta-connection").textContent = ""; });
if (!byId("workspace").hidden) refresh();
