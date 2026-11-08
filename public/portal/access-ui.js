export function accessViews({esc,icon,btn,tag}) {
 const doorName = d => {
  switch (d.kind || d.doorKind) {
   case 'entrance': return 'Main entrance';
   case 'room': return 'Room' + ' ' + d.room;
   default: return d.name;
  }
 };
 const kindName = kind => ({
  entrance:'Building entrance',
  room:'Bedroom door',
  facility:'Shared space',
 })[kind];
 const doorIcon = d => d.kind === 'facility' ? 'cinema' : d.kind === 'room' ? 'key' : 'home';
 const lockStatus = door => {
  const open = door.unlockedUntil > Date.now();
  return `<span class="pill ${open?'amber':'gray'}" data-lock-until="${Number(door.unlockedUntil)||0}"
   data-locked-label="Locked" data-unlocked-label="Unlocked">${open?'Unlocked':'Locked'}</span>`;
 };
 const permissionLabel = permission => permission === 'admin' ? 'Administrator' : 'Staff';
 const doorHint = d => {
  if (d.mayEnter) return 'Access available';
  if (d.mayExit) return 'Exit available';
  return d.kind === 'facility'
   ? 'Activate a session to enter'
   : 'Available after check-in';
 };
 const clock = time => new Intl.DateTimeFormat('en-GB',{
  month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Europe/London',
 }).format(new Date(time));
 const directionLabel = action => ({
  entry:'Simulated entry',
  exit:'Simulated exit',
  lock:'Relocked manually',
 })[action];
 function events(list, operator) {
  return list.length ? `<ul class="access-activity">${list.slice().reverse().map(event=>`<li>
   <span class="access-direction ${esc(event.action)}">${icon(event.action==='lock'?'lock':event.action==='entry'?'arrow':'back')}</span>
   <div><strong data-user-content>${esc(operator?event.residentName:doorName(event))}</strong>
   ${operator?`<small data-user-content>${esc(doorName(event))}</small>`:''}</div>
   <span class="access-event-direction">${directionLabel(event.action)}</span>
   <time datetime="${esc(event.createdAt)}">${clock(event.createdAt)}</time>
  </li>`).join('')}</ul>` : `<p class="empty">Simulated passages and relocks will appear here.</p>`;
 }
 function doorCard(door, operator) {
  return `<article class="door-card">
   <div class="door-symbol">${icon(doorIcon(door))}</div>
   <div class="door-card-name"><h3 data-user-content>${esc(doorName(door))}</h3>
   <small>${operator?kindName(door.kind):doorHint(door)}</small></div>${lockStatus(door)}
   ${operator?'':door.mayEnter||door.mayExit||door.mayLock
    ? btn('Door controls','door-control',`data-id="${esc(door.id)}"`,'door-action')
    : door.kind==='facility'
     ? btn('Booking & activation','activation',`data-id="${esc(door.facilityId)}"`,'door-action')
     : ''}
  </article>`;
 }
 function doorsPage(state, operator, filter) {
  const doors = state.doors.filter(d => filter === 'all' || d.kind === filter);
  const unlocked = state.doors.filter(d => d.unlockedUntil > Date.now()).length;
  const filters = [['all','All doors'],['entrance','Entrances'],['facility','Shared spaces'],['room','Bedrooms']]
   .filter(([kind]) => kind==='all' || state.doors.some(d=>d.kind===kind));
  const visibleEvents = state.doorEvents.filter(event=>!operator || filter==='all' || event.doorKind===filter);
  return `<div class="page-head between"><div><h1>${operator?'Doors & access activity':'My keys'}</h1>
   <p>${operator?'Review door lock states and simulated passage history.':'Use your phone for the entrance, your bedroom and activated shared spaces.'}</p></div>
   <div class="page-actions">${btn(icon('refresh')+'Refresh','refresh')}</div></div>
   <section class="access-strip"><div class="access-strip-icon">${icon('key')}</div><div><strong>Door access demo</strong>
   <p>${operator?'Demo actions generate the access log. Times are shown in UK local time.':'Doors relock after 15 seconds, or you can relock them sooner.'}</p></div>
   ${operator?`<div class="access-totals"><div><strong>${state.doors.length}</strong><small>Doors</small></div>
   <div><strong data-unlocked-count>${unlocked}</strong><small>Unlocked</small></div></div>`:''}</section>
   ${operator?`<div class="filterbar"><div class="tabs">${filters.map(([key,label])=>`<button class="${filter===key?'selected':''}" data-action="filter" data-filter="${key}">${label}</button>`).join('')}</div></div>`:''}
   <div class="door-grid">${doors.map(d=>doorCard(d,operator)).join('')}</div>
   <section class="panel section-gap"><div class="panel-head between"><div><h2>${operator?'Passages & lock actions':'My access activity'}</h2>
   <p class="small">The property keeps the last 500 demo events.</p></div></div>${events(visibleEvents,operator)}</section>`;
 }
 function homeKeys(state) {
  const main = state.doors.find(d=>d.kind==='entrance');
  return `<section class="home-keys"><div class="door-symbol">${icon('key')}</div><div><h2>My keys</h2>
   <p>Entrance, my room and shared spaces</p></div>
   <div class="home-keys-actions">${main?.mayEnter?btn('Open entrance','door-control','data-id="entrance"','primary'):''}
   ${btn('View keys','nav','data-tab="access"')}</div></section>`;
 }
 function controls(door) {
  return `<div class="door-control-title"><div class="door-symbol">${icon(doorIcon(door))}</div><div><strong>${kindName(door.kind)}</strong>
   <p class="small">Simulated unlock for 15 seconds</p></div>${lockStatus(door)}</div>
   <div class="door-control-actions">
    ${door.mayEnter?btn(icon('key')+'Unlock for entry','door-command',`data-id="${esc(door.id)}" data-direction="entry"`,'primary'):''}
    ${door.mayExit?btn('Unlock for exit','door-command',`data-id="${esc(door.id)}" data-direction="exit"`):''}
    ${door.mayLock?btn(icon('lock')+'Relock now','door-command',`data-id="${esc(door.id)}" data-direction="lock" data-lock-button-until="${Number(door.unlockedUntil)||0}"`):''}
   </div>`;
 }
 function teamPage(state, actor) {
  return `<div class="page-head between"><div><h1>Property team</h1><p>Add accounts, assign permissions or suspend access.</p></div>
   <div class="page-actions">${btn(icon('plus')+'Add team member','staff-edit','','primary')}</div></div>
   <div class="team-permissions">
    <section class="panel"><div class="door-symbol">${icon('lock')}</div><h2>${permissionLabel('admin')}</h2><p>Manage staff, residents, agreements, billing and spaces. See all doors and access events.</p></section>
    <section class="panel"><div class="door-symbol">${icon('wrench')}</div><h2>${permissionLabel('staff')}</h2><p>Update repairs, manage bookings and queues, and see entrance and shared-space activity.</p></section>
   </div>
   <section class="panel section-gap"><div class="panel-head between"><h2>Team accounts</h2><span class="small">${state.staff.length} accounts</span></div>
   <ul class="team-accounts">${state.staff.map(a=>`<li><div class="door-symbol">${icon(a.permission==='admin'?'lock':'users')}</div>
   <div class="team-identity"><strong data-user-content>${esc(a.name)}</strong><small data-user-content>${esc(a.email)}</small></div>
   <div class="team-role">${permissionLabel(a.permission)} ${tag(a.enabled?'Active':'Suspended',a.enabled?'':'gray')}</div>
   ${a.id==='admin'||a.id===actor.staffId?`<small>${a.id===actor.staffId?'Current account':'Built-in demo account'}</small>`:btn('Manage','staff-edit',`data-id="${esc(a.id)}"`,'small-btn')}
   </li>`).join('')}</ul></section>`;
 }
 return {doorsPage,doorName,homeKeys,controls,permissionLabel,teamPage};
}
