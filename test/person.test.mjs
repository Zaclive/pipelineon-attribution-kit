import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createKitServer } from "../server/app.mjs";
import { resolvePersonSessions } from "../core/index.mjs";

test("v0.3.7 upgrade moves the HubSpot reference onto people and preserves UUIDs", async () => {
  const dir=mkdtempSync(join(tmpdir(),"person-upgrade-")), filename=join(dir,"db.sqlite"), person=randomUUID();
  const legacy=new DatabaseSync(filename);
  legacy.exec(`CREATE TABLE people(id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
    CREATE TABLE person_contacts(provider TEXT NOT NULL,account_id TEXT NOT NULL,contact_id TEXT NOT NULL,person_id TEXT NOT NULL REFERENCES people(id),PRIMARY KEY(provider,account_id,contact_id));`);
  legacy.prepare("INSERT INTO people VALUES(?,?)").run(person,"2026-10-01T00:00:00Z");
  legacy.prepare("INSERT INTO person_contacts VALUES('hubspot','123','101',?)").run(person);legacy.close();
  const config={database:filename,siteId:"example",writeToken:"w".repeat(40),readToken:"r".repeat(40),publicUrl:"http://localhost:4310",origins:["https://example.com"]};
  try {
    const app=createKitServer(config);app.store.close();
    const upgraded=new DatabaseSync(filename);
    try {
      assert.deepEqual({...upgraded.prepare("SELECT * FROM people").get()},{id:person,created_at:"2026-10-01T00:00:00Z",hubspot_account_id:"123",hubspot_contact_id:"101"});
      assert.equal(upgraded.prepare("SELECT name FROM sqlite_master WHERE name='person_contacts'").get(),undefined);
      assert.equal(upgraded.prepare("SELECT COUNT(*) AS n FROM person_claims").get().n,0);
      assert.equal(upgraded.prepare("SELECT COUNT(*) AS n FROM audit WHERE action='person_schema_simplified'").get().n,1);
    } finally { upgraded.close(); }
    const restarted=createKitServer(config);restarted.store.close();
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("legacy multiple-contact references fail reviewably and roll the upgrade back", () => {
  const dir=mkdtempSync(join(tmpdir(),"person-upgrade-conflict-")), filename=join(dir,"db.sqlite");
  const legacy=new DatabaseSync(filename);
  legacy.exec(`CREATE TABLE people(id TEXT PRIMARY KEY,created_at TEXT NOT NULL);
    CREATE TABLE person_contacts(provider TEXT NOT NULL,account_id TEXT NOT NULL,contact_id TEXT NOT NULL,person_id TEXT NOT NULL REFERENCES people(id),PRIMARY KEY(provider,account_id,contact_id));
    INSERT INTO people VALUES('person','2026-10-01T00:00:00Z');
    INSERT INTO person_contacts VALUES('hubspot','123','101','person'),('hubspot','123','202','person');`);legacy.close();
  try {
    assert.throws(()=>createKitServer({database:filename,siteId:"example",writeToken:"w".repeat(40),readToken:"r".repeat(40),publicUrl:"http://localhost:4310",origins:["https://example.com"]}),{code:"IDENTITY_CONFLICT"});
    const retained=new DatabaseSync(filename);
    try { assert.equal(retained.prepare("SELECT COUNT(*) AS n FROM person_contacts").get().n,2);
      assert.equal(retained.prepare("PRAGMA table_info(people)").all().length,2);
    } finally { retained.close(); }
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("person resolution keeps identity separate from campaigns, future evidence and shared browsers", () => {
  const claims = [{personId:"p1",visitorSessionId:"a",occurredAt:"2026-10-01T00:00:00Z"}, {personId:"p1",visitorSessionId:"b",occurredAt:"2026-10-03T00:00:00Z"}];
  assert.deepEqual(resolvePersonSessions("p1", claims, "2026-10-02T00:00:00Z").sessionIds, ["a"]);
  assert.deepEqual(resolvePersonSessions("p1", claims, "2026-10-04T00:00:00Z").sessionIds, ["a","b"]);
  assert.equal(resolvePersonSessions("p1", [...claims,{personId:"p2",visitorSessionId:"a",occurredAt:"2026-10-05T00:00:00Z"}], "2026-10-04T00:00:00Z").status,"ambiguous");
});

test("HTTP person ID survives restart, joins verified browsers, preserves campaigns and refuses unverified or shared identity", async () => {
  const dir = mkdtempSync(join(tmpdir(), "person-kit-"));
  const config = { database: join(dir,"db.sqlite"), siteId:"example", writeToken:"w".repeat(40), readToken:"r".repeat(40), publicUrl:"http://localhost:4310", origins:["https://example.com"] };
  let app = createKitServer(config), base;
  const start = async () => { await new Promise(r=>app.server.listen(0,"127.0.0.1",r)); base=`http://127.0.0.1:${app.server.address().port}`; };
  await start();
  const at = hours => new Date(Date.now()+hours*3600000).toISOString();
  const time = [-5,-4,-3,-2,-1,0].map(at);
  const post = async (path,data,token) => {const r=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json",...(token?{authorization:`Bearer ${token}`}:{Origin:"https://example.com"})},body:JSON.stringify(data)});return {status:r.status,body:await r.json()};};
  const collect = async (visitorId,t,url) => (await post("/v1/collect",{siteId:"example",visitorId,eventId:randomUUID(),occurredAt:t,url,referrer:null},null)).body.visitorSessionId;
  const form = (id,session,t,contact) => ({source:"hubspot",externalId:id,eventType:"form",occurredAt:t,sourceUpdatedAt:t,outcome:"received",visitorSessionId:session,contactIds:[contact]});
  const link = (id,contact,accountId) => ({source:"hubspot",externalId:id,contactId:contact,accountId});
  const report = async model => {const r=await fetch(base+"/v1/report?"+new URLSearchParams({from:at(-24),to:at(0),model}),{headers:{authorization:`Bearer ${config.readToken}`}});assert.equal(r.status,200);return r.json();};
  try {
    const browser = randomUUID();
    const sessionA = await collect(browser,time[0],"https://example.com/?utm_source=Google%20Ads&utm_medium=PPC&utm_campaign=first&gad_campaignid=111&hsa_cam=999");
    await collect(browser,time[1],"https://example.com/?utm_source=facebook&utm_medium=Paid-Social&utm_campaign=returning&campaign_id=222");
    const f1=form("f1",sessionA,time[2],"101"); await post("/v1/outcomes",f1,config.writeToken);
    assert.equal((await post("/v1/identities/hubspot",link("f1","101","123"),config.readToken)).status,401);
    assert.equal((await post("/v1/identities/hubspot",link("missing","101","123"),config.writeToken)).status,422);
    const first=await post("/v1/identities/hubspot",link("f1","101","123"),config.writeToken);assert.equal(first.status,200);
    const personId=first.body.personId;
    assert.equal((await post("/v1/identities/hubspot",link("f1","101","123"),config.writeToken)).body.duplicate,true);
    assert.equal((await post("/v1/identities/hubspot",link("f1","101","456"),config.writeToken)).status,409);
    const sessionB=await collect(randomUUID(),time[3],"https://example.com/?utm_source=google&utm_medium=cpc&utm_campaign=second-browser&gad_campaignid=333&hsa_cam=333");
    await post("/v1/outcomes",form("f2",sessionB,time[4],"101"),config.writeToken);
    assert.equal((await post("/v1/identities/hubspot",link("f2","101","123"),config.writeToken)).body.personId,personId);
    const firstCredit=await report("first_touch"),lastCredit=await report("last_touch");
    assert.equal(firstCredit.people[0].id,personId);assert.equal(firstCredit.people[0].browserCount,2);
    assert.deepEqual(firstCredit.people,lastCredit.people);
    assert.equal(firstCredit.people[0].touches.firstTouch.parameters.utm_campaign,"first");
    assert.equal(firstCredit.people[0].touches.lastTouch.parameters.utm_campaign,"second-browser");
    assert.equal(firstCredit.people[0].touches.timeline.length,3);
    assert.equal(firstCredit.report.campaignConflictActivities,2);
    assert.equal(lastCredit.report.groups.some(g=>g.campaign==="returning"),true);
    await app.close();app=createKitServer(config);await start();
    assert.equal((await report("last_touch")).people[0].id,personId);
    // A different contact claiming the same browser does not merge their people.
    await post("/v1/outcomes",form("shared",sessionA,time[4],"202"),config.writeToken);
    const beforeBackfill=await report("first_touch");
    assert.equal(beforeBackfill.people.find(p=>p.id===personId).status,"ambiguous");
    assert.equal(beforeBackfill.report.linkedOutcomes,0);
    const second=await post("/v1/identities/hubspot",link("shared","202","123"),config.writeToken);
    assert.notEqual(second.body.personId,personId);
    const ambiguous=await report("first_touch");assert.equal(ambiguous.people.every(p=>p.status==="ambiguous"),true);
    assert.equal(ambiguous.report.linkedOutcomes,0);
    // Corrected/removed enquiry evidence no longer joins that shared browser.
    await post("/v1/outcomes",{...form("shared",sessionA,time[4],"202"),deleted:true,sourceUpdatedAt:time[5]},config.writeToken);
    assert.equal((await report("first_touch")).people.find(p=>p.id===personId).status,"linked");
  } finally { await app.close(); rmSync(dir,{recursive:true,force:true}); }
});
