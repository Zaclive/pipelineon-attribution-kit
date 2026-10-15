import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import proxy from '../examples/cloudflare-pixel-proxy.mjs';
import { createKitServer } from '../server/app.mjs';

const tag = readFileSync(new URL('../examples/gtm-kit-tag.html', import.meta.url), 'utf8').replace(/^<script>\s*/, '').replace(/\s*<\/script>\s*$/, '');
function tagHarness(gpc) {
  const scripts = [], calls = [];
  const context = { window: {}, navigator: { globalPrivacyControl: gpc }, document: {
    createElement() { return { setAttribute(key, value) { this[key] = value; } }; },
    head: { appendChild(script) { scripts.push(script); } },
  }};
  return { scripts, calls, context,
    run(allowed) { runInNewContext(tag.replace('{{DLV - po_attribution_allowed}}', JSON.stringify(allowed)), context); },
    load(index) { context.window.OpenAttribution = { sites: { 'your-website': { consent(value) { calls.push(value); } } } }; scripts[index].onload(); }
  };
}

test('GTM recipe handles consent grant, duplicate update, withdrawal during loading and later regrant', () => {
  const h = tagHarness(false);
  h.run(false); assert.equal(h.scripts.length, 0);
  h.run(true); h.run(true); assert.equal(h.scripts.length, 1);
  assert.equal(h.scripts[0]['data-site'], 'your-website');
  h.run(false); h.load(0); assert.deepEqual(h.calls, [false]);
  h.run(true); h.run(true); assert.deepEqual(h.calls, [false, true]);
  h.run(false); assert.deepEqual(h.calls, [false, true, false]);
  assert.equal(h.scripts.length, 1);
});

test('GTM recipe respects GPC, fails closed for non-booleans and can retry a failed load', () => {
  const gpc = tagHarness(true); gpc.run(true); assert.equal(gpc.scripts.length, 0);
  const h = tagHarness(false); h.run('true'); assert.equal(h.scripts.length, 0);
  h.run(true); h.scripts[0].onerror(); h.run(true); assert.equal(h.scripts.length, 2);
  h.load(1); assert.deepEqual(h.calls, [true]);
  h.context.navigator.globalPrivacyControl = true; h.run(true); assert.deepEqual(h.calls, [true, false]);
});

test('Worker recipe pins public routes, strips credentials, blocks redirects and reports origin failures', async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async request => { seen.push(request); return new Response('pixel', {headers: {'set-cookie':'private=value', 'Access-Control-Allow-Origin':'https://example.com'}}); };
  const env = { KIT_ORIGIN: 'https://kit.example.com' };
  try {
    for (const path of ['/v1/outcomes','/v1/export','/session','/webhooks/callrail'])
      assert.equal((await proxy.fetch(new Request('https://track.example.com'+path), env)).status, 404);
    assert.equal((await proxy.fetch(new Request('https://track.example.com/pixel.js', {method:'POST'}), env)).status, 404);
    for (const origin of ['http://kit.example.com','https://kit.example.com/path','https://user:password@kit.example.com','https://track.example.com','bad'])
      assert.equal((await proxy.fetch(new Request('https://track.example.com/pixel.js'),{KIT_ORIGIN:origin})).status,500);
    assert.equal(seen.length,0);
    const response = await proxy.fetch(new Request('https://track.example.com/pixel.js?url=https://evil.example', {headers:{Authorization:'Bearer private',Cookie:'private=1'}}),env);
    assert.equal(seen[0].url,'https://kit.example.com/pixel.js');
    assert.equal(seen[0].headers.get('authorization'),null); assert.equal(seen[0].headers.get('cookie'),null);
    assert.equal(response.headers.get('set-cookie'),null); assert.equal(response.headers.get('Cache-Control'),'no-store');
    globalThis.fetch = async () => new Response(null,{status:302,headers:{Location:'https://evil.example'}});
    assert.equal((await proxy.fetch(new Request('https://track.example.com/pixel.js'),env)).status,502);
    globalThis.fetch = async () => { throw new Error('synthetic failure'); };
    assert.equal((await proxy.fetch(new Request('https://track.example.com/pixel.js'),env)).status,502);
  } finally { globalThis.fetch=originalFetch; }
});

test('Worker recipe forwards CORS preflight and tagged visits to the real local kit collector', async () => {
  const directory=mkdtempSync(join(tmpdir(),'attribution-proxy-docs-'));
  const app=createKitServer({database:join(directory,'qa.sqlite'),siteId:'example',name:'Proxy QA',writeToken:'w'.repeat(40),readToken:'r'.repeat(40),publicUrl:'https://kit.example.com',origins:['https://example.com']});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${app.server.address().port}`;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=(request,options)=>originalFetch(new Request(base+new URL(request.url).pathname,request),options);
  const env={KIT_ORIGIN:'https://kit.example.com'};
  try {
    const preflight=await proxy.fetch(new Request('https://track.example.com/v1/collect',{method:'OPTIONS',headers:{Origin:'https://example.com','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}}),env);
    assert.equal(preflight.status,204); assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'https://example.com');
    const body={siteId:'example',visitorId:randomUUID(),eventId:randomUUID(),occurredAt:new Date().toISOString(),url:'https://example.com/?utm_source=google&utm_campaign=worker-test',referrer:null};
    const collect=origin=>proxy.fetch(new Request('https://track.example.com/v1/collect',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
    const accepted=await collect('https://example.com'); assert.equal(accepted.status,200); assert.match((await accepted.json()).visitorSessionId,/^[a-f0-9-]{36}$/);
    assert.equal((await collect('https://evil.example')).status,403);
  } finally { globalThis.fetch=originalFetch; await app.close(); }
});


test('pixel and GTM accept site IDs matching object prototype names without duplicate initialization', () => {
  const pixel = readFileSync(new URL('../public/pixel.js', import.meta.url), 'utf8');
  for (const site of ['__proto__', 'constructor', 'toString']) {
    const scripts = [], events = [];
    const context = { URL, navigator: { globalPrivacyControl: false }, window: {
      OpenAttribution: { sites: {} }, __poKitGtm: {},
      addEventListener(name) { events.push(name); },
    }, document: {
      currentScript: { src: 'https://kit.example.com/pixel.js', dataset: { site } },
      addEventListener(name) { events.push(name); },
      createElement() { return { setAttribute(key, value) { this[key] = value; } }; },
      head: { appendChild(script) { scripts.push(script); } },
    }};
    const source = tag.replace("'your-website'", JSON.stringify(site)).replace('{{DLV - po_attribution_allowed}}', 'true');
    // No tracker yet: an inherited name must not count as a loaded tracker.
    runInNewContext(source, context);
    assert.equal(scripts.length, 1, site);
    context.window.OpenAttribution = { sites: {} };
    runInNewContext(pixel, context);
    const tracker = context.window.OpenAttribution.sites[site];
    assert.equal(typeof tracker.consent, 'function', site);
    assert.equal(tracker.getTrackingContext(), null);
    runInNewContext(pixel, context);
    assert.equal(context.window.OpenAttribution.sites[site], tracker);
    // Navigation observation is installed only after consent is granted.
    assert.deepEqual(events, ['submit']);
    assert.equal(Object.getPrototypeOf(context.window.OpenAttribution.sites), null);
    assert.equal(Object.getPrototypeOf(context.window.__poKitGtm), null);
  }
});
