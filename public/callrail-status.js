const byId = id => document.getElementById(id);
const element = (tag, text, className) => { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; };
let revision = 0;
async function refresh() {
  const current = ++revision;
  const list = byId("callrail-calls"), status = byId("callrail-connection");
  list.replaceChildren(); status.textContent = "Loading CallRail receipts…";
  byId("callrail-refresh").disabled = true;
  try {
    const response = await fetch("/v1/callrail");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Could not load CallRail receipts.");
    if (current !== revision) return;
    status.textContent = data.configured ? `Company ${data.companyId} · ${data.deliveryOwner === "self" ? "Owns Meta delivery" : "Attribution only"} · Capture ${data.cookieName} and ${data.cookieName}_ads` : "CallRail is not connected. Follow CALLRAIL.md and set the server configuration.";
    if (!data.calls.length) list.append(element("p", "No CallRail calls received yet. Test the website number pool and captured cookies.", "small"));
    for (const row of data.calls) {
      const card = element("article", "", "meta-card");
      const title = element("div", "", "section-heading");
      title.append(element("code", row.callId, "meta-id"), element("span", row.status, "badge"));
      card.append(title, element("p", row.reason === "imported_linked" ? "Imported with a website session" : row.reason === "imported_unlinked" ? "Imported without a matching website session" : row.reason, "small"),
        element("p", `${row.attempts} refresh attempts · ${new Date(row.updatedAt).toLocaleString()}${row.nextAt ? ` · Next: ${new Date(row.nextAt).toLocaleString()}` : ""}`, "small"), element("code", `Receipt: ${row.id}`, "meta-id"));
      list.append(card);
    }
  } catch (error) { if (current === revision) status.textContent = error.message; }
  finally { if (current === revision) byId("callrail-refresh").disabled = false; }
}
byId("callrail-refresh").addEventListener("click", refresh);
window.addEventListener("open-attribution:dashboard", refresh);
window.addEventListener("open-attribution:signout", () => { revision++; byId("callrail-calls").replaceChildren(); byId("callrail-connection").textContent = ""; });
if (!byId("workspace").hidden) refresh();
