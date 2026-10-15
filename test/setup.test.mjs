import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSetup } from "../server/setup.mjs";
import { mkdtempSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
test("setup creates independent secrets and consent-gated one-script instructions",()=>{
 const result=buildSetup(["--site","https://example.com","--url","https://track.example.com","--name","Example site"]);
 assert.match(result.snippet,/data-site="[a-f0-9-]{36}"/);
 assert.equal(result.snippet.includes("consent=\"granted"),false);
 assert.match(result.env,/KIT_META_MODE="disabled"/);
 const read=/KIT_READ_TOKEN="([^"]+)"/.exec(result.env)[1],write=/KIT_WRITE_TOKEN="([^"]+)"/.exec(result.env)[1];
 assert.notEqual(read,write);assert.ok(read.length>=32);assert.ok(write.length>=32);
 assert.throws(()=>buildSetup(["--site","https://example.com/path","--url","https://track.example.com"]));
 assert.throws(()=>buildSetup(["--site","https://example.com","--url","https://track.example.com","--name","injected\nSECRET=value"]));
 assert.throws(()=>buildSetup(["--site","https://example.com","--url","http://public.example.com"]));
});
test("setup command writes a usable private env and refuses to replace it",()=>{
 const directory=mkdtempSync(join(tmpdir(),"kit-setup-"));
 try {
  const args=[fileURLToPath(new URL("../server/setup.mjs",import.meta.url)),"--site","https://example.com","--url","http://localhost:4310","--name","Example site"];
  const first=spawnSync(process.execPath,args,{cwd:directory,encoding:"utf8"});
  assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/<script defer/);
  const env=readFileSync(join(directory,".env"),"utf8");
  const token=/KIT_WRITE_TOKEN="([^"]+)"/.exec(env)[1];assert.equal(first.stdout.includes(token),false);
  const parse=spawnSync(process.execPath,["--env-file=.env","-e","process.stdout.write(process.env.KIT_SITE_NAME)"],{cwd:directory,encoding:"utf8"});
  assert.equal(parse.status,0);assert.equal(parse.stdout,"Example site");
  assert.notEqual(spawnSync(process.execPath,args,{cwd:directory,encoding:"utf8"}).status,0);
  assert.equal(readFileSync(join(directory,".env"),"utf8"),env);
 } finally {rmSync(directory,{recursive:true,force:true});}
});
