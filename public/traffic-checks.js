let revision = 0;
const status = document.getElementById("traffic-checks-status");
const summary = document.getElementById("traffic-checks-summary");
window.addEventListener("open-attribution:report", async event => {
  const current = ++revision;
  summary.textContent = "";
  status.textContent = "Loading traffic checks...";
  try {
    const params = new URLSearchParams({ from: event.detail.from, to: event.detail.to });
    const response = await fetch("/v1/traffic-checks?" + params);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "Could not load traffic checks.");
    if (current !== revision) return;
    status.textContent = `${data.accepted} accepted ${data.accepted === 1 ? "visit" : "visits"} checked · ${data.filtered} bot ${data.filtered === 1 ? "request" : "requests"} filtered`;
    summary.textContent = `Ad-like element hidden: ${data.adBlock.detected}. Not observed: ${data.adBlock.not_detected}. Unknown: ${data.adBlock.unknown}.`;
  } catch (error) { if (current === revision) status.textContent = error.message; }
});
window.addEventListener("open-attribution:signout", () => {
  revision++;
  status.textContent = "";
  summary.textContent = "";
});
