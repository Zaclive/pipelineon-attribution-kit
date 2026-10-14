import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeUtmParameters, campaignIdEvidence, buildTouches, hubspotAttributionProperties, buildReport } from "../core/index.mjs";
const observation = (minute, query) => ({ url: "https://example.com/?" + query, visitorId: "browser", referrer: null, occurredAt: new Date(Date.UTC(2026,9,12,10,minute)).toISOString() });
const rows = [observation(0,"UTM_SOURCE=Google%20Ads&utm_medium=PPC&utm_campaign=Roofing%20A&gad_campaignid=111&hsa_cam=111"),
  observation(1,"utm_source=google&utm_medium=cpc&utm_campaign=Roofing%20A&gad_campaignid=111&hsa_cam=111"),
  observation(10,"utm_source=facebook&utm_medium=Paid-Social&utm_campaign=Roofing%20B&campaign_id=120213456789012345"), observation(60,"")];
const cutoff="2026-10-12T12:00:00Z";
test("normalization preserves raw evidence, IDs, campaign case and privacy filters", () => {
  const raw={UTM_SOURCE:" Google Ads ",utm_medium:" PPC ",utm_campaign:"Roofing A",campaign_id:"120213456789012345",utm_term:"roof+repair",utm_email:"private@example.com",utm_content:"{creative}"};
  assert.deepEqual(normalizeUtmParameters(raw),{utm_source:"google",utm_medium:"cpc",utm_campaign:"Roofing A",campaign_id:"120213456789012345",utm_term:"roof+repair"});
  assert.equal(raw.UTM_SOURCE," Google Ads ");
});
test("taxonomy IDs and numeric campaign names are separate from conflicting platform IDs", () => {
  assert.equal(campaignIdEvidence({gad_campaignid:"111",hsa_cam:"111",utm_id:"internal-123",utm_campaign:"222"}).campaignConflict,false);
  assert.equal(campaignIdEvidence({gad_campaignid:"111",hsa_cam:"222"}).campaignConflict,true);
  assert.equal(campaignIdEvidence({gad_campaignid:"111",hsa_cam:"222"}).campaignId,null);
});
test("source variants retain one touch, changed campaign and direct return retain separate touches", () => {
  const touches=buildTouches(rows,cutoff);
  assert.equal(touches.timeline.length,3);
  assert.equal(touches.firstTouch.parameters.utm_source,"Google Ads");
  assert.equal(touches.firstTouch.normalizedParameters.utm_source,"google");
  assert.equal(touches.lastNonDirectTouch.parameters.utm_campaign,"Roofing B");
  assert.equal(touches.lastTouch.sourceLabel,"Direct");
  const fact={source:"crm",externalId:"test",eventType:"form",outcome:"received",occurredAt:cutoff,sourceUpdatedAt:cutoff,deleted:false,attribution:{status:"linked",touches}};
  for(const [model,source] of [["first_touch","Google Ads"],["last_touch","Direct"],["last_non_direct","facebook"]]){
    const r=buildReport([fact],{from:"2026-10-12T00:00:00Z",to:"2026-10-13T00:00:00Z",model},{limited:false,inspected:1,limit:100});
    assert.equal(r.groups[0].source,source);assert.equal(r.campaignConflictActivities,0);
    assert.equal(r.journeys[0].first.campaign,"Roofing A");assert.equal(r.journeys[0].lastNonDirect.campaign,"Roofing B");
  }
});
test("CRM properties retain original campaign through B and direct return, and skip stale submissions", () => {
  const a=hubspotAttributionProperties(buildTouches(rows.slice(0,1),cutoff),{},"session");
  const b=hubspotAttributionProperties(buildTouches(rows.slice(0,3),cutoff),a,"session");
  assert.equal(b.po_first_utm_campaign,undefined);assert.equal(b.po_last_utm_campaign,"Roofing B");
  const saved={...a,...b};
  const direct=hubspotAttributionProperties(buildTouches(rows,cutoff),saved,"session");
  assert.equal(direct.po_last_utm_campaign,"");assert.equal(direct.po_last_utm_source,"Direct");
  const evidence=JSON.parse(direct.po_attribution);
  assert.equal(evidence.first.utms.utm_campaign,"Roofing A");assert.equal(evidence.lastNonDirect.utms.utm_campaign,"Roofing B");
  assert.equal(evidence.timeline.length,3);
  assert.deepEqual(hubspotAttributionProperties(buildTouches(rows.slice(0,1),cutoff),{...saved,...direct},"session"),{});
  assert.throws(()=>hubspotAttributionProperties(buildTouches(rows,cutoff),{po_first_utm_campaign:"Older"},"session"),{code:"CRM_ATTRIBUTION_PARTIAL"});
});
test("CRM snapshot excludes click IDs and source URLs, and does not choose a conflicting campaign ID", () => {
  const t=buildTouches([observation(0,"utm_source=google&gad_campaignid=111&hsa_cam=222&gclid=private-click")],cutoff);
  const properties=hubspotAttributionProperties(t,{},"session");
  assert.equal(properties.po_first_campaign_id,"");
  assert.equal(JSON.parse(properties.po_attribution).first.campaignConflict,true);
  assert.equal(properties.po_attribution.includes("private-click"),false);
  assert.equal(properties.po_attribution.includes("https://"),false);
});
test("an explicitly direct source stays out of non-direct credit and equal-time changed evidence is refused", () => {
  const touches=buildTouches([rows[0],observation(60,"utm_source=%28direct%29")],cutoff);
  assert.equal(touches.lastTouch.sourceLabel,"Direct");
  assert.equal(touches.lastNonDirectTouch.parameters.utm_campaign,"Roofing A");
  const existing=hubspotAttributionProperties(buildTouches(rows.slice(0,1),cutoff),{},"session");
  const changed=buildTouches([observation(0,"utm_source=google&utm_campaign=Different")],cutoff);
  assert.throws(()=>hubspotAttributionProperties(changed,existing,"session"),{code:"CRM_ATTRIBUTION_CONFLICT"});
});
