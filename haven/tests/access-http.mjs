import assert from 'node:assert/strict';

const base = process.argv[2] || 'http://127.0.0.1:8088';
async function request(path, method='GET', body, cookie) {
 const headers = {'Content-Type':'application/json',Origin:base};
 if (cookie) headers.Cookie = cookie;
 return fetch(base+path, {method,headers,...(body?{body:JSON.stringify(body)}:{})});
}
async function login(role, email, code, status=200) {
 const response = await request(`/api/${role}/session`,'POST',{email,code});
 assert.equal(response.status,status);
 return {cookie:response.headers.get('set-cookie')?.split(';')[0],actor:await response.json()};
}
async function state(role, cookie) {
 const response = await request(`/api/${role}/state`,'GET',undefined,cookie);
 assert.equal(response.status,200);
 return response.json();
}
async function action(role, cookie, command, status=200) {
 const {revision} = await state(role,cookie);
 const response = await request(`/api/${role}/action`,'POST',{revision,command},cookie);
 const result = await response.json();
 assert.equal(response.status,status,JSON.stringify(result));
 return result;
}
const {cookie:admin} = await login('operator','alex.morgan@example.com','operator-demo');
const {cookie:resident} = await login('resident','emily.chen@example.com','resident-demo');
const {cookie:other} = await login('resident','oliver.j@example.com','resident-demo');
const {cookie:arriving} = await login('resident','lucas.w@example.com','resident-demo');
const initial = (await state('resident',resident)).data;
const room = initial.doors.find(d=>d.kind==='room');
const privateDoor = (await state('resident',other)).data.doors.find(d=>d.kind==='room');
const entry = (doorId) => ({action:'door-access',doorId,direction:'entry'});
assert.equal(room.room,'A-201');
assert.equal(initial.doors.some(d=>d.id===privateDoor.id),false);
assert.equal(initial.doors.some(d=>d.id==='facility:f7'),false);
await action('resident',resident,entry(privateDoor.id),403);
await action('resident',arriving,entry('entrance'),403);
await action('resident',resident,entry('facility:f4'),403);
await action('resident',resident,entry('entrance'));
await action('resident',resident,entry(room.id));
await action('resident',other,{action:'door-access',doorId:'entrance',direction:'lock'},403);
assert.ok((await state('operator',admin)).data.doors.find(d=>d.id==='entrance').unlockedUntil>Date.now());
await action('resident',resident,{action:'door-access',doorId:'entrance',direction:'lock'});
assert.equal((await state('operator',admin)).data.doors.find(d=>d.id==='entrance').unlockedUntil,0);

await action('resident',resident,{action:'activate',facilityId:'f4'});
await action('resident',resident,entry('facility:f4'));
const activated = (await state('resident',resident)).data.facilityUsage.find(u=>u.facilityId==='f4'&&u.status==='active');
await action('resident',resident,{action:'release',facilityId:'f4',usageId:activated.id});
await action('resident',resident,entry('facility:f4'),403);
await action('resident',resident,{action:'door-access',doorId:'facility:f4',direction:'exit'});
const adminView = (await state('operator',admin)).data;
assert.ok(adminView.doorEvents.some(e=>e.doorId===room.id&&e.residentName==='Emily Chen'));
assert.ok(adminView.doorEvents.some(e=>e.doorId==='facility:f4'&&e.action==='exit'));
assert.equal((await state('resident',other)).data.doorEvents.some(e=>e.residentId==='r1'),false);
assert.equal('staff' in initial,false);
assert.equal('doorUnlocks' in adminView,false);
assert.equal(adminView.staff.some(a=>'codeHash' in a),false);

// Verify new staff can do on-site work without finance, account changes or private door records.
const email = `access-qa-${Date.now()}@example.com`;
const account = {action:'staff-save',name:'Access QA',email,permission:'staff',enabled:true};
const {accessCode} = await action('operator',admin,account);
assert.ok(accessCode.length>=32);
await login('operator',email,'operator-demo',401);
const {cookie:staff,actor} = await login('operator',email,accessCode);
assert.equal(actor.permission,'staff');
const staffState = await state('operator',staff);
for (const key of ['staff','contracts','invoices','mail','rooms']) assert.equal(key in staffState.data,false);
assert.ok(staffState.data.residents.every(r=>!('email' in r)));
assert.ok(staffState.data.facilityUsage.every(u=>!('accessCode' in u)));
assert.ok(staffState.data.doors.every(d=>d.kind!=='room'));
assert.ok(staffState.data.doorEvents.every(e=>e.doorKind!=='room'));
assert.ok(staffState.data.doorEvents.some(e=>e.doorId==='facility:f4'&&e.action==='exit'));
assert.equal((await request('/api/operator/state','PUT',staffState,staff)).status,403);
await action('operator',staff,account,403);
await action('operator',staff,{action:'demo-reset'},403);
await action('operator',staff,{action:'advance',facilityId:'f4'});
const ticket = staffState.data.tickets[0];
await action('operator',staff,{action:'ticket-progress',ticketId:ticket.id,status:'resolved',assetStatus:'good'});
assert.equal((await state('operator',admin)).data.tickets.find(t=>t.id===ticket.id).status,'resolved');

const oldAdmin = await state('operator',admin);
const forged = structuredClone(oldAdmin);
forged.data.staff = [];
forged.data.doorEvents = [];
forged.data.doorUnlocks = {entrance:{until:Date.now()+60_000,by:'r2'}};
assert.equal((await request('/api/operator/state','PUT',forged,admin)).status,200);
assert.deepEqual((await state('operator',admin)).data.doorEvents,oldAdmin.data.doorEvents);
assert.equal((await state('operator',admin)).data.doors.find(d=>d.id==='entrance').unlockedUntil,0);

const staffId = oldAdmin.data.staff.find(a=>a.email===email).id;
const update = {...account,staffId};
await action('operator',admin,{...update,enabled:false});
assert.equal((await request('/api/operator/state','GET',undefined,staff)).status,401);
await login('operator',email,accessCode,401);
await action('operator',admin,update);
assert.equal((await request('/api/operator/session','GET',undefined,staff)).status,401);
const {accessCode:newCode} = await action('operator',admin,{...update,permission:'admin',rotateCode:true});
await login('operator',email,accessCode,401);
const {cookie:manager,actor:promoted} = await login('operator',email,newCode);
assert.equal(promoted.permission,'admin');
assert.ok((await state('operator',manager)).data.invoices.length);
await action('operator',manager,{...update,enabled:false},403);
await action('operator',admin,{...update,enabled:false});
console.log('Door access and staff permission checks passed:',base);
