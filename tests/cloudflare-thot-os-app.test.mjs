import assert from "node:assert/strict";
import test from "node:test";
import worker from "../cloudflare/thot-os-app/src/index.ts";

function environment(){
  const rows={
    "SELECT COUNT(*) AS count FROM creators":{count:1},
    "SELECT COUNT(*) AS count FROM assets WHERE source_available=1":{count:195},
    "SELECT COUNT(*) AS count FROM asset_classifications":{count:195},
    "SELECT COUNT(*) AS count FROM asset_destinations":{count:212},
  };
  return {
    STAGING_ADMIN_TOKEN:"secret",
    MEDIA:{head:async()=>null,get:async()=>null},
    PREVIEWS:{
      head:async()=>null,
      get:async()=>({body:new Blob(["preview"]).stream(),etag:"preview-etag",httpMetadata:{contentType:"image/jpeg"}}),
    },
    DB:{prepare(query){
      const normalised=query.trim();
      let bound=[];
      return {
        bind(...values){bound=values;return this;},
        async first(){
          if(normalised.startsWith("SELECT id FROM assets WHERE creator_id="))return bound[0]==="adelaide"?{id:"asset-1"}:null;
          return rows[normalised]??null;
        },
        async all(){
          if(normalised.includes("FROM creators c LEFT JOIN assets"))return {success:true,results:[{id:"adelaide",name:"Adelaide",status:"active",assets:195,sfw:10,nsfw:20,needs_review:165}]};
          if(normalised.startsWith("SELECT destination,COUNT(*)"))return {success:true,results:[{destination:"reddit",count:12}]};
          if(normalised.includes("FROM assets a LEFT JOIN asset_classifications"))return {success:true,results:[{id:"asset-1",creator_id:"adelaide",basename:"example.jpg",extension:"jpg",bytes:120000,modified_at:"2026-08-09",classification_safety:"sfw",destinations:"reddit",preview_r2_key:`creators/adelaide/assets/${"a".repeat(64)}/preview.jpg`}]};
          return {success:true,results:[]};
        },
      };
    }},
  };
}

test("THOT OS staging landing page reports the migrated counts",async()=>{
  const response=await worker.fetch(new Request("https://example.test/"),environment());
  assert.equal(response.status,200);
  const body=await response.text();
  assert.match(body,/THOT OS/);
  assert.match(body,/195/);
});

test("library metadata remains protected",async()=>{
  const blocked=await worker.fetch(new Request("https://example.test/api/library?creator=adelaide"),environment());
  assert.equal(blocked.status,401);
  const allowed=await worker.fetch(new Request("https://example.test/api/library?creator=adelaide",{headers:{authorization:"Bearer secret"}}),environment());
  assert.equal(allowed.status,200);
  assert.equal((await allowed.json()).assets.length,1);
});

test("authenticated library renders creator-scoped private previews",async()=>{
  const response=await worker.fetch(new Request("https://example.test/library"),environment());
  assert.equal(response.status,200);
  const body=await response.text();
  assert.match(body,new RegExp(`/preview/${"a".repeat(64)}`));
  assert.match(body,/example\.jpg/);
});

test("library orders ready previews before Dropbox placeholders",async()=>{
  const source=await import("node:fs/promises").then(({readFile})=>readFile(new URL("../cloudflare/thot-os-app/src/index.ts",import.meta.url),"utf8"));
  assert.match(source,/ORDER BY \(a\.preview_r2_key IS NULL\) ASC,a\.modified_at DESC/);
  assert.match(source,/Waiting for Dropbox download/);
});

test("preview delivery checks D1 before reading private R2",async()=>{
  const response=await worker.fetch(new Request(`https://example.test/preview/${"a".repeat(64)}`),environment());
  assert.equal(response.status,200);
  assert.equal(response.headers.get("cache-control"),"private, max-age=86400");
  assert.equal(await response.text(),"preview");
});

test("production Access settings reject requests without an Access JWT",async()=>{
  const env={...environment(),ACCESS_AUD:"aud",ACCESS_JWKS_URL:"https://access.example.test/certs",ACCESS_ALLOWED_EMAIL:"connect@thrillnoir.com"};
  const response=await worker.fetch(new Request("https://example.test/"),env);
  assert.equal(response.status,401);
});
