const el = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };
const labels = { queued: "Queued", processing: "Checking", submitted: "Google processing", validated: "Validation passed; not sent live", accepted: "Google processed", retry: "Retry scheduled", blocked: "Setup needed", failed: "Delivery failed", review: "Review needed", skipped: "Not sent" };
let revision = 0;
async function refresh() {
  const version = ++revision, root = document.getElementById("google-deliveries"), status = document.getElementById("google-connection");
  root.replaceChildren(); status.textContent = "Loading Google delivery status…";
  try {
    const response = await fetch("/v1/google"), data = await response.json();
    if (!response.ok) throw new Error("Could not read Google delivery status.");
    if (version !== revision) return;
    status.textContent = data.connection.configured ? `Google Ads ${data.connection.accountId} · ${data.connection.mode}` : "Google Ads is not connected. Configure the server to begin.";
    if (!data.deliveries.length) root.append(el("p", "No Google deliveries requested yet."));
    for (const row of data.deliveries) {
      const card = el("article", ""); card.className = "meta-card";
      card.append(el("strong", `${row.businessEvent ?? "Outcome"} · ${labels[row.status] ?? "Unknown"}`), el("p", row.reason),
        el("code", row.transactionId ?? row.id), el("p", `${row.attempts} uploads · ${row.polls} processing checks`));
      if (row.requestId) card.append(el("code", `Request: ${row.requestId}`));
      if (row.sourceChanged) card.append(el("p", "The source changed after an attempt. Review separately; this does not retract an event at Google."));
      root.append(card);
    }
    if (data.limited) root.append(el("p", "Showing the latest 50 Google deliveries."));
  } catch (error) { if (version === revision) status.textContent = error.message; }
}
document.getElementById("google-refresh").addEventListener("click", refresh);
window.addEventListener("open-attribution:dashboard", refresh);
window.addEventListener("open-attribution:signout", () => { revision++; document.getElementById("google-deliveries").replaceChildren(); document.getElementById("google-connection").textContent = ""; });
if (!document.getElementById("workspace").hidden) refresh();
