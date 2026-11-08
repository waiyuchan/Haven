export const money = n => new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(n/100);
export const today = () => new Date().toLocaleDateString('en-CA',{timeZone:'Europe/London'});
export function seedState(){
 return {
  settings:{name:'Haven House',city:'Manchester',address:'18 Oxford Road, Manchester M1 7ED',email:'hello@haven.example',phone:'+44 161 000 0123',beds:12},
  residents:[
   {id:'r1',name:'Emily Chen',email:'emily.chen@example.com',room:'A-201',university:'University of Manchester',status:'in-house'},
   {id:'r2',name:'Oliver James',email:'oliver.j@example.com',room:'A-202',university:'Manchester Metropolitan',status:'in-house'},
   {id:'r3',name:'Aisha Khan',email:'aisha.k@example.com',room:'A-203',university:'University of Manchester',status:'in-house'},
   {id:'r4',name:'Lucas Wang',email:'lucas.w@example.com',room:'B-301',university:'University of Manchester',status:'arriving'},
   {id:'r5',name:'Sofia Rossi',email:'sofia.r@example.com',room:'B-302',university:'Manchester Metropolitan',status:'in-house'},
   {id:'r6',name:'Arjun Patel',email:'arjun.p@example.com',room:'B-303',university:'University of Manchester',status:'in-house'}],
  plans:[
   {id:'p1',name:'En-suite · Academic year',unit:'weekly',price:24900,term:44,deposit:25000,bills:['Utilities & heating','High-speed Wi-Fi','Shared facilities'],template:'PBSA fixed-term agreement',payment:'Three instalments',description:'A private bathroom and shared kitchen for the full academic year.'},
   {id:'p2',name:'Studio · Flexible monthly',unit:'monthly',price:109000,term:6,deposit:40000,bills:['Utilities & heating','High-speed Wi-Fi','Shared facilities'],template:'Monthly accommodation agreement',payment:'Monthly payments',description:'A private kitchen and bathroom with flexible monthly terms.'},
   {id:'p3',name:'Classic · Weekly',unit:'weekly',price:19500,term:51,deposit:20000,bills:['High-speed Wi-Fi','Shared facilities'],template:'PBSA fixed-term agreement',payment:'Three instalments',description:'A private bedroom with a shared lounge and kitchen, plus optional extras.'}],
  contracts:[{id:'CTR-2026-001',residentId:'r1',planId:'p1',title:'En-suite academic-year agreement',start:'2026-09-12',end:'2027-07-17',status:'signed',createdAt:'2026-08-20T10:00:00Z',signedAt:'2026-08-21T09:30:00Z',snapshot:{name:'En-suite · Academic year',unit:'weekly',price:24900,term:44,deposit:25000,bills:['Utilities & heating','High-speed Wi-Fi','Shared facilities'],template:'PBSA fixed-term agreement',payment:'Three instalments',total:1095600}}],
  invoices:[
   {id:'INV-2026-001',residentId:'r1',title:'November accommodation payment',items:[{description:'Rent instalment · November',quantity:1,unitPrice:109000}],total:109000,due:'2026-11-10',status:'issued',createdAt:'2026-11-01T10:00:00Z'},
   {id:'INV-2026-002',residentId:'r2',title:'Weekly accommodation',items:[{description:'En-suite · 1 week',quantity:1,unitPrice:24900}],total:24900,due:'2026-11-08',status:'issued',createdAt:'2026-11-01T10:00:00Z'},
   {id:'INV-2026-003',residentId:'r3',title:'October accommodation',items:[{description:'Studio · 1 month',quantity:1,unitPrice:109000}],total:109000,due:'2026-10-10',status:'paid',createdAt:'2026-10-01T10:00:00Z'}],
  tickets:[
   {id:'WO-1042',residentId:'r1',title:'Bathroom tap keeps dripping',category:'Plumbing & bathroom',priority:'normal',status:'in-progress',description:'The cold tap keeps dripping when turned off. I am available for a visit after 2 pm.',access:true,assetId:'a2',createdAt:'2026-11-05T09:25:00Z'},
   {id:'WO-1043',residentId:'r3',title:'Bedroom radiator stays cold',category:'Heating & electrical',priority:'urgent',status:'open',description:'The radiator has been cold since last night. I checked the thermostat. Please arrange a visit before entering.',access:false,assetId:'',createdAt:'2026-11-06T08:10:00Z'}],
  assets:[
   {id:'a1',name:'Cinema projector',location:'Ground floor · Cinema',category:'Electronics',cost:180000,quantity:1,purchased:'2025-09-01',life:5,salvage:10000,status:'good'},
   {id:'a2',name:'En-suite tap set',location:'A-201 · Bathroom',category:'Bathroom fittings',cost:12000,quantity:1,purchased:'2025-08-15',life:5,salvage:0,status:'repair'},
   {id:'a3',name:'Shared lounge sofa',location:'Ground floor · Lounge',category:'Furniture',cost:65000,quantity:3,purchased:'2024-09-01',life:6,salvage:5000,status:'good'},
   {id:'a4',name:'Gym treadmill',location:'First floor · Gym',category:'Fitness equipment',cost:120000,quantity:2,purchased:'2025-09-01',life:5,salvage:10000,status:'good'}],
  facilities:[
   {id:'f1',name:'The Picture House',kind:'cinema',capacity:12,location:'Ground floor',hours:'10:00–22:00',description:'Book the screening room for a film night with your neighbours. It has a 4K projector and surround sound.'},
   {id:'f2',name:'The Living Room',kind:'lounge',capacity:20,location:'Ground floor',hours:'08:00–23:00',description:'A shared living room for coffee, conversation and board games.'},
   {id:'f3',name:'Move Studio',kind:'gym',capacity:8,location:'First floor',hours:'07:00–22:00',description:'Book a session to use the cardio equipment and free weights.'}],
  reservations:[],
  posts:[
   {id:'post1',author:'Haven team',role:'operator',type:'announcement',title:'Saturday heating checks',body:'We will check the heating in shared areas this Saturday from 10 am to noon. Bedrooms are unaffected. Contact the maintenance team through the portal if you have questions.',createdAt:'2026-11-05T15:00:00Z',likes:[],comments:[]},
   {id:'post2',author:'Sofia Rossi',role:'resident',type:'volunteer',title:'Volunteer at the food bank this Sunday',body:'Meet at reception at 9:30 am on Sunday to volunteer at the local food bank. First-time volunteers are welcome!',createdAt:'2026-11-04T11:30:00Z',likes:['r1','r3'],comments:[{author:'Emily Chen',body:'Count me in. See you there!',createdAt:'2026-11-04T12:00:00Z'}]},
   {id:'post3',author:'Oliver James',role:'resident',type:'discussion',title:'Anyone up for a film night?',body:'I am planning to book the cinema for Friday evening. What would everyone like to watch?',createdAt:'2026-11-03T17:00:00Z',likes:['r2'],comments:[]}],
  messages:[{id:'msg1',author:'Haven team',role:'operator',body:'Welcome to Haven House! Meet your neighbours and share what is happening in the community.',createdAt:'2026-11-05T09:00:00Z'},{id:'msg2',author:'Emily Chen',role:'resident',body:'I just moved to Manchester. Any favourite cafés nearby? ☕',createdAt:'2026-11-05T09:10:00Z'}],
  mail:[{id:'mail1',to:'emily.chen@example.com',subject:'Haven House · Your November invoice',body:'Hi Emily,\nYour November invoice INV-2026-001 is now available in your resident portal.\nAmount due: £1,090.00\nDue date: 10 November 2026\n\nThis is a demonstration email preview. No email has been sent.',documentId:'INV-2026-001',createdAt:'2026-11-01T10:00:00Z',status:'preview'}]
 };
}
export function assetValue(a,asOf=new Date()){
 const elapsed=Math.max(0,(asOf-new Date(a.purchased+'T00:00:00Z'))/(365.25*86400000));
 return Math.round(Math.max(a.salvage,a.cost-(a.cost-a.salvage)*Math.min(1,elapsed/a.life)))*a.quantity;
}
export function validateState(s){
 const lists=['residents','plans','contracts','invoices','tickets','assets','facilities','reservations','posts','messages','mail'];
 if(!s||!s.settings||lists.some(k=>!Array.isArray(s[k])||s[k].length>2000))return 'The record is incomplete or exceeds the demo capacity.';
 for(const k of lists){if(s[k].some(x=>!x.id)||new Set(s[k].map(x=>x.id)).size!==s[k].length)return 'Record IDs must be present and unique.';}
 const amount=n=>Number.isSafeInteger(n)&&n>=0&&n<=100000000;
 const residents=new Set(s.residents.map(r=>r.id));
 for(const p of s.plans)if(!amount(p.price)||p.price===0||!amount(p.deposit)||!Number.isInteger(p.term)||p.term<1||p.term>520||!['weekly','monthly'].includes(p.unit))return 'Enter a valid plan price, term and pricing basis.';
 for(const p of s.plans)if((p.payment==='Weekly payments'&&p.unit!=='weekly')||(p.payment==='Monthly payments'&&p.unit!=='monthly'))return 'Match the payment schedule to the pricing basis, or choose instalments or payment in full.';
 for(const c of s.contracts)if(!residents.has(c.residentId)||!c.snapshot||!amount(c.snapshot.total)||c.snapshot.total!==c.snapshot.price*c.snapshot.term||!c.start||c.start>=c.end)return 'The agreement has invalid dates, amounts or resident details.';
 for(const i of s.invoices)if(!residents.has(i.residentId)||!Array.isArray(i.items)||!i.items.length||i.items.some(l=>!amount(l.unitPrice)||!Number.isInteger(l.quantity)||l.quantity<1)||!amount(i.total)||i.total!==i.items.reduce((sum,l)=>sum+l.quantity*l.unitPrice,0))return 'The invoice total does not match the line items.';
 for(const a of s.assets)if(!amount(a.cost)||!amount(a.salvage)||a.salvage>a.cost||!(a.life>0&&a.life<=100)||!Number.isInteger(a.quantity)||a.quantity<1||!/^\d{4}-\d{2}-\d{2}$/.test(a.purchased))return 'Enter a valid asset value, quantity and useful life.';
 for(const t of s.tickets)if(!residents.has(t.residentId))return 'The repair is not linked to a valid resident.';
 for(const b of s.reservations){
  const f=s.facilities.find(f=>f.id===b.facilityId);
  if(!f||!residents.has(b.residentId)||!Number.isInteger(b.attendees)||b.attendees<1||b.attendees>f.capacity||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||!/^\d{2}:\d{2}$/.test(b.start)||!/^\d{2}:\d{2}$/.test(b.end)||b.start>=b.end)return 'The facility booking is invalid.';
  if(!s.schemaVersion&&b.status!=='cancelled'&&s.reservations.some(x=>x.id!==b.id&&x.status!=='cancelled'&&x.facilityId===b.facilityId&&x.date===b.date&&x.start<b.end&&x.end>b.start))return 'That slot is already booked. Choose another time.';
 }
 for(const f of s.facilities)if(!Number.isInteger(f.capacity)||f.capacity<1||f.capacity>500)return 'Enter a valid facility capacity.';
 return '';
}

export function rentSchedule(plan,start,end){
 const count=plan.payment==='Pay in full'?1:plan.payment==='Three instalments'?3:plan.term;
 const total=plan.price*plan.term,base=Math.floor(total/count);
 const from=new Date(start+'T12:00:00Z'),until=new Date(end+'T12:00:00Z');
 return Array.from({length:count},(_,index)=>{
  const due=new Date(from);
  if(plan.payment==='Three instalments')due.setUTCDate(due.getUTCDate()+Math.floor((until-from)/86400000*index/3));
  else if(count>1&&plan.unit==='weekly')due.setUTCDate(due.getUTCDate()+7*index);
  else if(count>1){const day=due.getUTCDate();due.setUTCDate(1);due.setUTCMonth(due.getUTCMonth()+index);due.setUTCDate(Math.min(day,new Date(Date.UTC(due.getUTCFullYear(),due.getUTCMonth()+1,0)).getUTCDate()));}
  return {number:index+1,due:due.toISOString().slice(0,10),amount:index===count-1?total-base*(count-1):base};
 });
}
