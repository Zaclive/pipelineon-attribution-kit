// Optional public pixel proxy for the standalone kit. Not a CRM relay or database.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowed = (url.pathname === "/pixel.js" && request.method === "GET") ||
      (url.pathname === "/v1/collect" && ["POST", "OPTIONS"].includes(request.method));
    if (!allowed) return new Response("Not found", { status: 404 });
    let origin;
    try {
      origin = new URL(env.KIT_ORIGIN);
      if (origin.protocol !== "https:" || origin.username || origin.password ||
          origin.pathname !== "/" || origin.search || origin.hash || origin.host === url.host)
        return new Response("Invalid origin configuration", { status: 500 });
    } catch { return new Response("Missing origin configuration", { status: 500 }); }
    const upstream = new Request(new URL(url.pathname, origin), request);
    // Never forward private browser credentials through this public endpoint.
    upstream.headers.delete("authorization");
    upstream.headers.delete("cookie");
    try {
      const result = await fetch(upstream, { redirect: "manual" });
      if (result.status >= 300 && result.status < 400)
        return new Response("Unexpected origin redirect", { status: 502 });
      const response = new Response(result.body, result);
      response.headers.delete("set-cookie");
      response.headers.set("Cache-Control", "no-store");
      return response;
    } catch { return new Response("Origin unavailable", { status: 502 }); }
  }
};
