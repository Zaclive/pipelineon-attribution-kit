import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
export function buildSetup(args) {
  const values = {};
  for (let i=0;i<args.length;i++) {
    if (args[i] === "--") continue;
    if (!["--site","--url","--name"].includes(args[i]) || !args[i+1] || args[i+1].startsWith("--")) throw new Error("Use --site WEBSITE_ORIGIN --url COLLECTOR_ORIGIN [--name WEBSITE_NAME].");
    if (values[args[i]]) throw new Error("Repeated setup option.");
    values[args[i]]=args[++i];
  }
  const origin = (raw,label) => {
    const value=new URL(raw);
    if (value.username || value.password || value.pathname !== "/" || value.search || value.hash ||
        !(value.protocol === "https:" || value.protocol === "http:" && ["localhost","127.0.0.1","[::1]"].includes(value.hostname))) throw new Error(label+" must be an HTTPS origin, or HTTP localhost for development.");
    return value.origin;
  };
  const site=origin(values["--site"],"Website"),url=origin(values["--url"],"Collector");
  const name=values["--name"] || new URL(site).hostname;
  if (/[\r\n\x00-\x1f]/.test(name) || name.length>120) throw new Error("Use a short single-line name.");
  const siteId=randomUUID();
  const env={ KIT_SITE_ID:siteId,KIT_SITE_NAME:name,KIT_PUBLIC_URL:url,KIT_ALLOWED_ORIGINS:site,
    KIT_DATABASE:"data/attribution.sqlite",KIT_READ_TOKEN:randomBytes(32).toString("base64url"),KIT_WRITE_TOKEN:randomBytes(32).toString("base64url"),
    HOST:"127.0.0.1",PORT:"4310",KIT_META_MODE:"disabled",KIT_GOOGLE_MODE:"disabled" };
  return { env:Object.entries(env).map(([key,value])=>key+"="+JSON.stringify(value)).join("\n")+"\n",
    snippet:`<script defer src="${url}/pixel.js" data-site="${siteId}"></script>`,site,url,siteId };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result=buildSetup(process.argv.slice(2));
    writeFileSync(".env",result.env,{flag:"wx",mode:0o600});
    console.log("Created private .env; no credentials were printed. Existing files are never overwritten.\n"+
      "Next: provision persistent hosting and HTTPS, start with pnpm start or Docker, then check /health.\n"+
      "Install this single script on the website:\n"+result.snippet+"\n"+
      "Connect consent: window.OpenAttribution.sites["+JSON.stringify(result.siteId)+"].consent(true) only after tracking consent. Use consent(false) on withdrawal.\n"+
      "Follow docs/setup.md for CRM mapping and end-to-end verification. Advertising delivery is disabled.");
  } catch(error) { console.error("Setup failed: "+error.message);process.exitCode=1; }
}
