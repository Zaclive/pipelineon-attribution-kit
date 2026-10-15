import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeBrowserSignature, compareBrowserSignatures, evaluateBrowserContinuity } from "../core/browser-continuity.mjs";
import { collectBrowserSignature } from "../core/browser-signature.mjs";
import { openStore } from "../server/store.mjs";
const digest = value=>createHash("sha256").update(value).digest("hex");
const signature = salt=>({ version:1, components:Object.fromEntries(["environment","screen","locale","capabilities","canvas","webgl"].map(key=>[key,digest(key+salt)])) });
test("component matching tolerates a browser update but rejects common settings and missing rendering",()=>{
 const a=signature("a"), b=signature("a"); b.components.environment=digest("updated");
 assert.equal(compareBrowserSignatures(a,b).qualifies,true);
 b.components.canvas=digest("other"); assert.equal(compareBrowserSignatures(a,b).qualifies,false);
 delete b.components.webgl; assert.equal(compareBrowserSignatures(a,b).qualifies,false);
 assert.equal(normalizeBrowserSignature({ version:2,components:a.components }),null);
 assert.equal(normalizeBrowserSignature({ version:1,components:{ canvas:"raw image" } }),null);
 assert.deepEqual(Object.keys(normalizeBrowserSignature({ ...a,components:{...a.components,email:digest("private")} }).components),Object.keys(a.components));
});
test("similar devices remain ambiguous, history limits prevent picking a winner",()=>{
 const a=signature("a"), rows=[1,2].map(n=>({visitorSessionId:String(n),lastSeenAt:"2026-10-15T00:00:00Z",signature:a}));
 assert.equal(evaluateBrowserContinuity(a,rows,false).status,"ambiguous");
 assert.equal(evaluateBrowserContinuity(a,rows.slice(0,1),false).status,"possible_return");
 assert.equal(evaluateBrowserContinuity(a,rows,true).status,"history_limited");
});
test("collector performs no probes when collection is not permitted",async()=>{
 assert.equal(await collectBrowserSignature(()=>false),null);
});
test("browser collector sends component digests, releases WebGL and cancels on withdrawal during hashing",async()=>{
 let allowed=true,probes=0,released=0;
 const gl={MAX_TEXTURE_SIZE:1,MAX_VERTEX_ATTRIBS:2,getParameter:key=>key===3?"Example GPU vendor":key===4?"Example renderer":16,
  getExtension:name=>name==="WEBGL_debug_renderer_info"?{UNMASKED_VENDOR_WEBGL:3,UNMASKED_RENDERER_WEBGL:4}:{loseContext:()=>released++}};
 const globals={navigator:{userAgent:"Example browser",platform:"Example OS",language:"en",hardwareConcurrency:8,maxTouchPoints:0},
  window:{screen:{width:1920,height:1080,colorDepth:24},devicePixelRatio:1},Intl,TextEncoder,Uint8Array,setTimeout,clearTimeout,
  document:{createElement:()=>{probes++;return{getContext:kind=>kind==="webgl"?gl:{fillRect(){},fillText(){}},toDataURL:()=>"raw drawing pixels"};}},crypto:webcrypto};
 const collect=runInNewContext("("+collectBrowserSignature.toString()+")",globals);
 const result=await collect(()=>allowed);
 assert.equal(Object.keys(result.components).length,6);assert.equal(released,1);
 assert.equal(JSON.stringify(result).includes("Example GPU"),false);assert.equal(JSON.stringify(result).includes("raw drawing"),false);
 assert.ok(Object.values(result.components).every(value=>/^[a-f0-9]{64}$/.test(value)));
 const before=probes;globals.navigator.globalPrivacyControl=true;assert.equal(await collect(()=>true),null);assert.equal(probes,before);
 globals.navigator.globalPrivacyControl=false;
 const waiting=[];globals.crypto={subtle:{digest:()=>new Promise(resolve=>waiting.push(resolve))}};
 const pending=collect(()=>allowed);allowed=false;for(const finish of waiting)finish(new Uint8Array(32).buffer);
 assert.equal(await pending,null);
});
test("cookie reset candidates persist across restart without merging history or advertising delivery",()=>{
 const directory=mkdtempSync(join(tmpdir(),"continuity-")),filename=join(directory,"test.sqlite");
 let store=openStore(filename,"example",null,null,null);
 const at="2026-10-15T01:00:00.000Z", later="2026-10-15T01:01:00.000Z";
 const visit=(browser,when,sig)=>({siteId:"example",visitorId:browser,eventId:randomUUID(),occurredAt:when,url:"https://example.com/?utm_source=qa",referrer:null,browserSignature:sig});
 const range={from:"2026-10-14T00:00:00Z",to:"2026-10-16T00:00:00Z",model:"first_touch"};
 try {
  const a=store.collect(visit(randomUUID(),at,signature("a")),"https://example.com",at);
  const browserB=randomUUID(), second=visit(browserB,later,signature("a"));
  const b=store.collect(second,"https://example.com",later); assert.notEqual(a.visitorSessionId,b.visitorSessionId);
  assert.equal(store.collect(second,"https://example.com",later).duplicate,true);
  assert.equal(store.continuity.report(range,later).counts.possible_return,1);
  store.close();store=openStore(filename,"example",null,null,null);
  const evidence=store.continuity.report(range,later);
  assert.equal(evidence.counts.possible_return,1); assert.equal(evidence.observations[0].evidence.candidates[0].visitorSessionId,a.visitorSessionId);
  assert.equal(JSON.stringify(evidence).includes(signature("a").components.canvas),false);
  store.collect(visit(browserB,later,signature("a")),"https://example.com",later);
  assert.equal(store.continuity.report(range,later).counts.possible_return,1);
  const third=store.collect(visit(randomUUID(),later,signature("a")),"https://example.com",later);
  assert.notEqual(third.visitorSessionId,b.visitorSessionId);
  assert.equal(store.continuity.report(range,later).counts.ambiguous,1);
  store.importOutcome({externalId:"payment",source:"crm",eventType:"payment",occurredAt:later,sourceUpdatedAt:later,
    outcome:"completed",qualification:"unknown",visitorSessionId:b.visitorSessionId,amountMinor:12300,currency:"USD"},later);
  assert.equal(store.report(range,later).report.totals.payments,1);
  assert.equal(store.report(range,later).people.length,0);
  store.collect({...visit(randomUUID(),later,signature("a")),gpc:true},"https://example.com",later);
  assert.equal(store.continuity.report(range,later).observations.length,3);
  assert.equal(store.report(range,"2026-12-15T00:00:00Z").continuity.observations.length,0);
 } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});
