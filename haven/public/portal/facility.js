import {migrateAccess,projectAccess,projectStaff} from './access.js';
import {seedState,today} from './domain.js';
export function migrateState(input){
 const s=structuredClone(input||seedState());
 if((s.schemaVersion||0)<2){
  s.rooms=Array.from({length:12},(_,i)=>({id:'room-'+i,number:(i<6?'A-20':'B-30')+(i%6+1),floor:i<6?'2':'3',type:'bedroom',status:'available'}));
  for(const f of s.facilities)Object.assign(f,{resourceType:'space',bookingMode:f.id==='f1'?'exclusive':'shared',enabled:true,activationMinutes:60});
  const additions=[
   {id:'f4',name:'The Meeting Room',kind:'meeting',capacity:8,location:'First floor',bookingMode:'exclusive',description:'Book the room for group projects, video calls or society meetings.'},
   {id:'f5',name:'The Study Library',kind:'study',capacity:16,location:'Second floor',bookingMode:'shared',description:'A quiet shared space for reading and study. Join the queue if all seats are taken.'},
   {id:'f6',name:'The Shared Kitchen',kind:'kitchen',capacity:6,location:'Ground floor',bookingMode:'shared',description:'Cook with your neighbours. Share the kitchen and book each oven separately.'},
   {id:'f7',name:'Kitchen Oven 01',kind:'oven',capacity:1,location:'Ground floor · Kitchen',bookingMode:'exclusive',resourceType:'equipment',parentId:'f6',description:'Book the first oven, scan to activate and release it when you finish.'},
   {id:'f8',name:'Kitchen Oven 02',kind:'oven',capacity:1,location:'Ground floor · Kitchen',bookingMode:'exclusive',resourceType:'equipment',parentId:'f6',description:'Book this second oven independently of the kitchen and other equipment.'}];
  for(const f of additions)if(!s.facilities.some(x=>x.id===f.id))s.facilities.push({hours:'07:00–23:00',resourceType:'space',enabled:true,activationMinutes:60,...f});
  s.queueEntries=[];s.facilityUsage=[];s.accessEvents=[];s.settings.facilityTime='19:00';s.schemaVersion=2;
 }
 return migrateAccess(s);
}
const live=u=>u.status==='active'&&Date.parse(u.expiresAt)>Date.now();
export const clock=s=>({date:today(),time:s.settings.facilityTime||'19:00'});
export function usage(s,fid){return (s.facilityUsage||[]).filter(u=>u.facilityId===fid&&live(u));}
export function queue(s,fid){return (s.queueEntries||[]).filter(q=>q.facilityId===fid&&['waiting','ready'].includes(q.status)).sort((a,b)=>(a.sequence||0)-(b.sequence||0)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));}
export function occupied(s,f){const a=s.usageSummary?.find(x=>x.facilityId===f.id);return a?a.used:usage(s,f.id).reduce((n,u)=>n+(f.bookingMode==='exclusive'?f.capacity:u.attendees),0);}
export function queueCount(s,fid){return s.queueSummary?.find(x=>x.facilityId===fid)?.count??queue(s,fid).length;}
export function validateFacilities(s){
 if(!s.rooms||!s.queueEntries||!s.facilityUsage)return '';
 if(new Set(s.rooms.map(r=>r.number.toLowerCase())).size!==s.rooms.length)return 'Room numbers must be unique';
 for(const f of s.facilities)if(!['space','equipment'].includes(f.resourceType)||!['exclusive','shared'].includes(f.bookingMode)||!Number.isInteger(f.activationMinutes)||f.activationMinutes<5||f.activationMinutes>240)return 'Invalid facility configuration';
 const accepted=new Set(['confirmed','active','completed','cancelled']);
 for(const f of s.facilities){
  const rows=s.reservations.filter(b=>b.facilityId===f.id&&['confirmed','active'].includes(b.status));
  if(rows.some(b=>!accepted.has(b.status)))return 'Invalid booking status';
  const days=[...new Set(rows.map(x=>x.date))];
  for(const day of days){const events=[];for(const b of rows.filter(x=>x.date===day)){const n=f.bookingMode==='exclusive'?f.capacity:b.attendees;events.push([b.start,n],[b.end,-n]);}events.sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]);let n=0;for(const [,delta]of events){n+=delta;if(n>f.capacity)return 'This time is fully booked. Please choose another slot.';}}
  const active=usage(s,f.id);if(active.reduce((n,u)=>n+(f.bookingMode==='exclusive'?f.capacity:u.attendees),0)>f.capacity)return 'Facility capacity exceeded';
 }
 const residents=new Set(s.residents.map(r=>r.id)),ids=new Set();
 for(const q of s.queueEntries){if(ids.has(q.id)||!residents.has(q.residentId)||!s.facilities.some(f=>f.id===q.facilityId)||!['waiting','ready','served','cancelled','expired'].includes(q.status))return 'Invalid queue entry';ids.add(q.id);}
 for(const u of s.facilityUsage)if(!residents.has(u.residentId)||!s.facilities.some(f=>f.id===u.facilityId)||!Number.isInteger(u.attendees)||u.attendees<1||!['active','released','expired'].includes(u.status))return 'Invalid usage record';
 return '';
}
function reconcile(s){
 for(const u of s.facilityUsage){if(u.status==='active'&&!live(u))u.status='expired';}
 for(const f of s.facilities){
  for(const q of queue(s,f.id))if(q.status==='ready'&&Date.parse(q.readyUntil)<=Date.now())q.status='expired';
  const c=clock(s);let available=f.capacity-usage(s,f.id).reduce((n,u)=>n+(f.bookingMode==='exclusive'?f.capacity:u.attendees),0)-s.reservations.filter(b=>b.facilityId===f.id&&b.status==='confirmed'&&b.date===c.date&&b.start<=c.time&&b.end>c.time).reduce((n,b)=>n+(f.bookingMode==='exclusive'?f.capacity:b.attendees),0);
  for(const q of queue(s,f.id)){const cost=f.bookingMode==='exclusive'?f.capacity:q.attendees;if(cost>available)break;available-=cost;if(q.status==='waiting'){q.status='ready';q.readyUntil=new Date(Date.now()+5*60000).toISOString();}}
 }
}
const newID=p=>p+'-'+crypto.randomUUID();
export function facilityAction(original,actor,command){
 const s=structuredClone(original);reconcile(s);const {action,facilityId}=command;
 const f=s.facilities.find(x=>x.id===facilityId);if(!f)throw Error('Facility not found');
 const rid=actor.role==='operator'?(command.residentId||''):actor.residentId;
 if(action==='release'){
  const u=s.facilityUsage.find(x=>x.id===command.usageId&&x.facilityId===f.id);
  if(!u||(actor.role!=='operator'&&u.residentId!==rid))throw Error('Access denied');
  u.status='released';u.releasedAt=new Date().toISOString();
  const b=s.reservations.find(x=>x.id===u.reservationId);if(b)b.status='completed';
 }else if(action==='queue-cancel'){
  const q=s.queueEntries.find(q=>q.id===command.queueId&&q.facilityId===f.id);
  if(!q||(actor.role!=='operator'&&q.residentId!==rid))throw Error('Access denied');q.status='cancelled';
 }else if(action==='cancel-booking'){
  const b=s.reservations.find(b=>b.id===command.bookingId&&b.facilityId===f.id);
  if(!b||(actor.role!=='operator'&&b.residentId!==rid))throw Error('Access denied');
  if(b.status==='active')throw Error('End the active session first');b.status='cancelled';
 }else if(action==='advance'){
  if(actor.role!=='operator')throw Error('Access denied');
 }else{
  if(!s.residents.some(r=>r.id===rid))throw Error('Resident not found');
  if(!f.enabled)throw Error('This facility is unavailable');
  const attendees=Number(command.attendees||1);if(!Number.isInteger(attendees)||attendees<1||attendees>f.capacity)throw Error('Invalid group size');
  if(action==='book'){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(command.date)||command.date<today()||!/^\d{2}:\d{2}$/.test(command.start)||!/^\d{2}:\d{2}$/.test(command.end)||command.start>=command.end)throw Error('Invalid booking time');
   const [open,close]=f.hours.split(/[–-]/);if(command.start<open||command.end>close)throw Error('Please choose a time within opening hours');
   s.reservations.push({id:newID('booking'),residentId:rid,facilityId:f.id,date:command.date,start:command.start,end:command.end,attendees,status:'confirmed',createdAt:new Date().toISOString()});
  }else if(action==='queue'){
   if(usage(s,f.id).some(u=>u.residentId===rid)||queue(s,f.id).some(q=>q.residentId===rid))throw Error('You already have an active session or queue entry');
   s.queueEntries.push({id:newID('queue'),facilityId:f.id,residentId:rid,attendees,status:'waiting',sequence:Math.max(0,...s.queueEntries.map(q=>q.sequence||0))+1,createdAt:new Date().toISOString()});
  }else if(action==='activate'){
   const c=clock(s),[open,close]=f.hours.split(/[–-]/);if(c.time<open||c.time>=close)throw Error('This facility is closed');
   if(usage(s,f.id).some(u=>u.residentId===rid))throw Error('You already have an active session');
   const ownBooking=s.reservations.find(b=>b.facilityId===f.id&&b.residentId===rid&&b.date===c.date&&b.status==='confirmed'&&b.start<=c.time&&b.end>c.time);
   const head=queue(s,f.id)[0];if(head&&head.residentId!==rid&&!ownBooking)throw Error('Please join the queue and wait for your turn');
   const group=ownBooking?.attendees||attendees;
   const active=usage(s,f.id).reduce((n,u)=>n+(f.bookingMode==='exclusive'?f.capacity:u.attendees),0);
   const reserved=s.reservations.filter(b=>b.facilityId===f.id&&b.residentId!==rid&&b.status==='confirmed'&&b.date===c.date&&b.start<=c.time&&b.end>c.time).reduce((n,b)=>n+(f.bookingMode==='exclusive'?f.capacity:b.attendees),0);
   const cost=f.bookingMode==='exclusive'?f.capacity:group;if(active+reserved+cost>f.capacity)throw Error('This facility is full. Join the queue.');
   const u={id:newID('use'),residentId:rid,facilityId:f.id,attendees:group,status:'active',startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+f.activationMinutes*60000).toISOString(),accessCode:crypto.randomUUID().slice(0,8).toUpperCase(),reservationId:ownBooking?.id||''};
   s.facilityUsage.push(u);if(ownBooking)ownBooking.status='active';
   for(const q of queue(s,f.id))if(q.residentId===rid)q.status='served';
   s.accessEvents.push({id:newID('access'),facilityId:f.id,residentId:rid,usageId:u.id,method:'qr-demo',createdAt:u.startedAt});
  }else throw Error('Unknown action');
 }
 reconcile(s);const error=validateFacilities(s);if(error)throw Error(error);return s;
}
export function projectState(s,actor){
 if(actor.role==='operator')return actor.permission==='staff'?projectStaff(s,actor):projectAccess(s,structuredClone(s),actor);
 const rid=actor.residentId,own=s.residents.find(r=>r.id===rid),copy=structuredClone(s);
 copy.residents=copy.residents.filter(r=>r.id===rid);copy.rooms=copy.rooms.filter(r=>r.number===own?.room);
 for(const k of ['contracts','invoices','tickets','reservations','queueEntries','facilityUsage','accessEvents'])copy[k]=copy[k].filter(r=>r.residentId===rid);
 copy.assets=copy.assets.filter(a=>!/^A-|^B-/.test(a.location)||a.location.startsWith(own?.room+' '));
 copy.mail=copy.mail.filter(m=>m.to===own?.email);
 copy.availability=s.reservations.filter(b=>['confirmed','active'].includes(b.status)).map(b=>({facilityId:b.facilityId,date:b.date,start:b.start,end:b.end,attendees:b.attendees,own:b.residentId===rid}));
 copy.usageSummary=s.facilities.map(f=>({facilityId:f.id,used:usage(s,f.id).reduce((n,u)=>n+(f.bookingMode==='exclusive'?f.capacity:u.attendees),0)}));
 copy.queueSummary=s.facilities.map(f=>({facilityId:f.id,count:queue(s,f.id).length}));
 for(const q of copy.queueEntries)q.position=queue(s,q.facilityId).findIndex(x=>x.id===q.id)+1;
 return projectAccess(s,copy,actor);
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function mergeResidentState(current,proposed,actor){
 const s=structuredClone(current),rid=actor.residentId,r=s.residents.find(r=>r.id===rid);if(!r)throw Error('Access denied');
 const view=projectState(current,actor);
 for(const key of ['settings','residents','plans','invoices','rooms','facilities','reservations','queueEntries','facilityUsage','mail'])if(!same(proposed[key],view[key]))throw Error('This change requires operator access');
 for(const c of proposed.contracts){const old=s.contracts.find(x=>x.id===c.id&&x.residentId===rid);if(!old)throw Error('Access denied');const allowed={...old};if(old.status!=='signed'&&c.status==='signed'){allowed.status='signed';allowed.signedName=r.name;allowed.signedAt=c.signedAt;}if(!same(c,allowed))throw Error('Contract terms cannot be changed');Object.assign(old,allowed);}
 for(const t of proposed.tickets){const old=s.tickets.find(x=>x.id===t.id);if(old){if(old.residentId!==rid||!same(old,t))throw Error('Access denied');}else{if(t.residentId!==rid||t.status!=='open')throw Error('Invalid ticket');s.tickets.push(t);const a=s.assets.find(a=>a.id===t.assetId);if(a)a.status='repair';}}
 for(const p of proposed.posts){const old=s.posts.find(x=>x.id===p.id);if(old){const candidate={...old,likes:p.likes,comments:p.comments};if(!same(p,candidate)||old.comments.some((c,i)=>!same(c,p.comments[i])))throw Error('Invalid community update');const others=old.likes.filter(x=>x!==rid);if(!same(p.likes.filter(x=>x!==rid),others))throw Error('Invalid reaction');for(const c of p.comments.slice(old.comments.length))if(c.author!==r.name)throw Error('Invalid author');Object.assign(old,candidate);}else{if(p.author!==r.name||p.role!=='resident'||!['discussion','volunteer'].includes(p.type))throw Error('Invalid post');s.posts.unshift(p);}}
 for(const m of proposed.messages){const old=s.messages.find(x=>x.id===m.id);if(old){if(!same(old,m))throw Error('Messages cannot be edited');}else{if(m.author!==r.name||m.role!=='resident'||!m.body.trim())throw Error('Invalid message');s.messages.push(m);}}
 return s;
}
