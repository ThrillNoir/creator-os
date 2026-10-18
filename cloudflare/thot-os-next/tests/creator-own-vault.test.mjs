import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import test from 'node:test';
import Database from 'better-sqlite3';
import {authorizeCreatorScope} from '../src/lib/authorization.ts';
const source=await readFile(new URL('../src/app/actions.ts',import.meta.url),'utf8');
const code=stripTypeScriptTypes(source.slice(source.indexOf('export async function createFanslyVaultJobsAction('),source.indexOf('export async function openFanslyVaultAction(')).replaceAll('export async function','async function'));
const dbSource=await readFile(new URL('../src/lib/creator-db.ts',import.meta.url),'utf8');
const creatorPrepare=new Function(stripTypeScriptTypes(dbSource.replace('import "server-only";','').replaceAll('export function','function'))+';return creatorPrepare')();
function fixture(creator='one',role='creator') {
 const sqlite=new Database(':memory:');
 sqlite.exec(`CREATE TABLE assets(id TEXT PRIMARY KEY,creator_id TEXT,extension TEXT,source_available INTEGER);
 CREATE TABLE asset_classifications(asset_id TEXT,creator_id TEXT,is_multi INTEGER);
 CREATE TABLE asset_destinations(asset_id TEXT,creator_id TEXT,destination TEXT);
 CREATE TABLE asset_people(asset_id TEXT,creator_id TEXT,person_id TEXT);
 CREATE TABLE asset_paid_consent_attestations(asset_id TEXT,creator_id TEXT,person_id TEXT,revoked_at TEXT);
 CREATE TABLE operational_accounts(id TEXT,creator_id TEXT,platform TEXT,label TEXT,is_active INTEGER);
 CREATE TABLE vault_upload_jobs(id TEXT PRIMARY KEY,creator_id TEXT,account_id TEXT,asset_id TEXT,platform TEXT,status TEXT,approved_by TEXT,UNIQUE(creator_id,asset_id));
 CREATE TABLE vault_upload_events(id TEXT,job_id TEXT,creator_id TEXT,actor TEXT,actor_role TEXT,event_type TEXT,detail TEXT);`);
 for(const id of ['one','two']) {
  sqlite.prepare('INSERT INTO assets VALUES(?,?,?,1)').run(id+'-asset',id,'jpg');
  sqlite.prepare('INSERT INTO asset_classifications VALUES(?,?,0)').run(id+'-asset',id);
  sqlite.prepare('INSERT INTO asset_destinations VALUES(?,?,?)').run(id+'-asset',id,'subscription');
  sqlite.prepare('INSERT INTO operational_accounts VALUES(?,?,?,?,1)').run(id+'-account',id,'fansly',id);
 }
 const DB={prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)??null},async all(){return {results:sqlite.prepare(sql).all(...args)}},async run(){return {meta:{changes:sqlite.prepare(sql).run(...args).changes}}}}}}}};
 const auth=async(permission)=>{
  const decision=authorizeCreatorScope([{creator_id:creator,role}],permission,null,'two');
  if(!decision.ok)throw Error('denied');
  return {creator:decision.membership,email:creator+'@example.test'};
 };
 const actions=new Function('requireCreatorContext','cloudflareEnv','creatorPrepare','values','revalidatePath','redirect',code+';return {own:createOwnFanslyVaultJobAction,staff:createFanslyVaultJobsAction}')(auth,()=>({DB}),creatorPrepare,(form,key)=>form.getAll(key).map(String).map(v=>v.trim()).filter(Boolean),()=>{},location=>{throw Error(location)});
 return {sqlite,...actions};
}
function form(...assets){const f=new FormData();for(const id of assets)f.append('assetId',id);for(const key of ['creatorId','accountId','profileId'])f.set(key,'two');return f}
test('both creator logins queue only their own asset and account despite forged IDs and selector cookie',async()=>{
 for(const creator of ['one','two']){const f=fixture(creator);try{
  await assert.rejects(f.own(form(creator+'-asset')),/saved=vault_queued/);
  assert.deepEqual(f.sqlite.prepare('SELECT creator_id,account_id,asset_id,status FROM vault_upload_jobs').get(),{creator_id:creator,account_id:creator+'-account',asset_id:creator+'-asset',status:'approved'});
  assert.deepEqual(f.sqlite.prepare('SELECT creator_id,actor_role,event_type FROM vault_upload_events').get(),{creator_id:creator,actor_role:'creator',event_type:'upload_approved'});
 }finally{f.sqlite.close()}}
});
test('foreign asset and multiple selection fail with zero mutations',async()=>{
 for(const assets of [['two-asset'],['one-asset','two-asset'],[]]){const f=fixture();try{
 await assert.rejects(f.own(form(...assets)),/Every selected asset|exactly one/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM vault_upload_jobs').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM vault_upload_events').get().n,0);
 }finally{f.sqlite.close()}}
});
test('inactive account, missing source, destination, consent and unsupported media fail closed',async()=>{
 for(const sql of ["UPDATE operational_accounts SET is_active=0 WHERE creator_id='one'","UPDATE assets SET source_available=0 WHERE creator_id='one'","DELETE FROM asset_destinations WHERE creator_id='one'","INSERT INTO asset_people VALUES('one-asset','one','person')","UPDATE assets SET extension='txt' WHERE creator_id='one'"]){const f=fixture();try{
 f.sqlite.exec(sql);await assert.rejects(f.own(form('one-asset')));
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM vault_upload_jobs').get().n,0);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM vault_upload_events').get().n,0);
 }finally{f.sqlite.close()}}
});
test('creator cannot call staff action; viewer and staff cannot call creator action',async()=>{
 for(const role of ['creator','viewer','operator','agency_admin']){const f=fixture('one',role);try{
 if(role==='creator')await assert.rejects(f.staff(form('one-asset')),/denied/);
 else await assert.rejects(f.own(form('one-asset')),/denied|creator login/);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM vault_upload_jobs').get().n,0);
 }finally{f.sqlite.close()}}
});

test('existing scoped vault queries hide foreign jobs, receipts, and browser assignment',async()=>{
 const operations=await readFile(new URL('../src/lib/operations.ts',import.meta.url),'utf8');
 const vault=operations.slice(operations.indexOf('export async function getVaultOperations('),operations.indexOf('export async function getRedditSchedulerStatus('));
 const jobSql=vault.match(/DB\.prepare\(`(\s*SELECT j\.id[\s\S]*?)`\)/)[1];
 const profileSql=vault.match(/DB\.prepare\(`(SELECT bc\.status[\s\S]*?)`\)/)[1];
 const assignmentSql=vault.match(/DB\.prepare\(`(SELECT bp\.label[\s\S]*?)`\)/)[1];
 const db=new Database(':memory:');
 try{
 db.exec(`CREATE TABLE assets(id TEXT,creator_id TEXT,basename TEXT,bytes INTEGER);
 CREATE TABLE vault_upload_jobs(id TEXT,creator_id TEXT,platform TEXT,status TEXT,asset_id TEXT,error TEXT,receipt TEXT,approved_at TEXT,claimed_at TEXT,completed_at TEXT,created_at TEXT);
 CREATE TABLE bridge_credentials(creator_id TEXT,account_id TEXT,profile_id TEXT,platform TEXT,status TEXT,expires_at TEXT,last_seen_at TEXT,created_at TEXT);
 CREATE TABLE account_browser_profiles(creator_id TEXT,account_id TEXT,profile_id TEXT,verified_at TEXT);
 CREATE TABLE browser_profiles(id TEXT,creator_id TEXT,label TEXT,status TEXT);
 CREATE TABLE operational_accounts(id TEXT,creator_id TEXT,platform TEXT,is_active INTEGER,label TEXT);`);
 for(const id of ['one','two']){
 db.prepare('INSERT INTO assets VALUES(?,?,?,1)').run(id+'-asset',id,id+'-private');
 db.prepare("INSERT INTO vault_upload_jobs VALUES(?,?,'fansly','verified',?,NULL,?,NULL,NULL,NULL,'2026-01-01')").run(id+'-job',id,id+'-asset',JSON.stringify({mediaId:id+'-receipt'}));
 db.prepare("INSERT INTO bridge_credentials VALUES(?,?,?,'fansly','active','2999-01-01',?,'2026-01-01')").run(id,id+'-account',id+'-profile',id+'-last-seen');
 db.prepare('INSERT INTO account_browser_profiles VALUES(?,?,?,?)').run(id,id+'-account',id+'-profile',id+'-verified');
 db.prepare("INSERT INTO browser_profiles VALUES(?,?,?,'paired')").run(id+'-profile',id,id+' Chrome');
 db.prepare("INSERT INTO operational_accounts VALUES(?,?,'fansly',1,?)").run(id+'-account',id,id+' Fansly');
 }
 db.exec(`INSERT INTO operational_accounts VALUES('one-other-account','one','fansly',1,'zzz second Fansly');
 INSERT INTO browser_profiles VALUES('one-other-profile','one','Other Chrome','paired');
 INSERT INTO account_browser_profiles VALUES('one','one-other-account','one-other-profile','one-other-verified');
 INSERT INTO bridge_credentials VALUES('one','one-other-account','one-other-profile','fansly','active','2999-01-01','one-other-last-seen','2026-02-01');`);
 for(const id of ['one','two']){
 const jobs=db.prepare(jobSql).all(id);
 assert.equal(jobs.length,1);assert.equal(jobs[0].id,id+'-job');assert.equal(JSON.parse(jobs[0].receipt).mediaId,id+'-receipt');
 const profile=db.prepare(profileSql).get(id,id);assert.equal(profile.last_seen_at,id+'-last-seen');assert.equal(profile.verified_at,id+'-verified');
 const assignment=db.prepare(assignmentSql).get(id,id);assert.equal(assignment.label,id+' Chrome');
 }
 assert.deepEqual(db.prepare(jobSql).all('foreign'),[]);assert.equal(db.prepare(profileSql).get('foreign','foreign'),undefined);assert.equal(db.prepare(assignmentSql).get('foreign','foreign'),undefined);
 }finally{db.close()}
});

test('duplicate own-vault requests retain one job and one audit event',async()=>{
 const f=fixture();try{
  await assert.rejects(f.own(form('one-asset')),/saved=vault_queued/);
  await assert.rejects(f.own(form('one-asset')),/saved=already_queued/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM vault_upload_jobs').get().n,1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) n FROM vault_upload_events').get().n,1);
 }finally{f.sqlite.close()}
});
