import assert from 'node:assert/strict';
const base=process.argv[2]||'http://127.0.0.1:8088';
async function request(path,method='GET',body,cookie=''){return fetch(base+path,{method,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),Origin:base},...(body?{body:JSON.stringify(body)}:{})});}
async function login(role,email){const response=await request(`/api/${role}/session`,'POST',{email,code:role+'-demo'});assert.equal(response.status,200,await response.text());return response.headers.get('set-cookie').split(';')[0];}
assert.equal((await request('/api/state')).status,401);
assert.equal((await request('/api/operator/state')).status,401);
const op=await login('operator','alex.morgan@example.com'),r1=await login('resident','emily.chen@example.com'),r2=await login('resident','oliver.j@example.com');
assert.equal((await request('/api/operator/state','GET',null,r1)).status,401);
const get=async(role,cookie)=>(await request(`/api/${role}/state`,'GET',null,cookie)).json();
let own=await get('resident',r1);assert.deepEqual(own.data.residents.map(r=>r.id),['r1']);assert.ok(own.data.invoices.every(i=>i.residentId==='r1'));assert.ok(own.data.contracts.every(c=>c.residentId==='r1'));
const bad=structuredClone(own);bad.data.invoices[0].total++;assert.ok([403,422].includes((await request('/api/resident/state','PUT',bad,r1)).status));
const unchanged=await request('/api/resident/state','PUT',own,r1);assert.equal(unchanged.status,200,await unchanged.text());
async function action(role,cookie,command){const current=await get(role,cookie);const response=await request(`/api/${role}/action`,'POST',{revision:current.revision,command},cookie);const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));}
let all=await get('operator',op);for(const u of all.data.facilityUsage.filter(u=>u.facilityId==='f8'&&u.status==='active'))await action('operator',op,{action:'release',facilityId:'f8',usageId:u.id});
await action('resident',r1,{action:'activate',facilityId:'f8',attendees:1});
await action('resident',r2,{action:'queue',facilityId:'f8',attendees:1});
own=await get('resident',r1);let use=own.data.facilityUsage.find(u=>u.facilityId==='f8'&&u.status==='active');
let other=await get('resident',r2);let denied=await request('/api/resident/action','POST',{revision:other.revision,command:{action:'release',facilityId:'f8',usageId:use.id}},r2);assert.ok(denied.status>=400);
await action('resident',r1,{action:'release',facilityId:'f8',usageId:use.id});
other=await get('resident',r2);assert.equal(other.data.queueEntries.find(q=>q.facilityId==='f8'&&q.status==='ready').position,1);
await action('resident',r2,{action:'activate',facilityId:'f8',attendees:1});
other=await get('resident',r2);use=other.data.facilityUsage.find(u=>u.facilityId==='f8'&&u.status==='active');assert.ok(use.accessCode);await action('resident',r2,{action:'release',facilityId:'f8',usageId:use.id});
await request('/api/resident/session','DELETE',null,r1);assert.equal((await request('/api/resident/state','GET',null,r1)).status,401);assert.equal((await request('/api/operator/state','GET',null,op)).status,200);
console.log('Portal HTTP checks passed:',base,'independent sessions, private records, protected finance, queue and access lifecycle.');
