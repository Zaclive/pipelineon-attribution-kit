// Strong indicators only. Ad blocking, missing plugins/languages, screen size,
// touch support and short visits are never bot blockers.
export function browserBotReason(userAgent, webdriver, verifiedBot, botScore) {
  if (webdriver === true) return "browser_webdriver";
  if (verifiedBot === true) return "verified_bot";
  if (typeof botScore === "number" && Number.isFinite(botScore) && botScore >= 1 && botScore < 30) return "low_bot_score";
  if (typeof userAgent !== "string" || !userAgent.trim()) return "empty_user_agent";
  if (/bot|crawl|crawler|spider|slurp|headless|phantom|selenium|playwright|puppeteer|monitor|uptime|preview|facebookexternalhit|linkedinbot|twitterbot|whatsapp|discordbot/i.test(userAgent)) return "bot_user_agent";
  return null;
}

export function adBlockStatus(value) {
  return ["detected", "not_detected", "unknown"].includes(value) ? value : "unknown";
}
