export const SCHEMA_VERSION = 3;
const administrator = {id:'admin',name:'Alex Morgan',email:'alex.morgan@example.com',permission:'admin',enabled:true};
const demoStaff = {id:'demo-staff',name:'Jamie Taylor',email:'jamie.taylor@example.com',permission:'staff',enabled:true,version:1,codeHash:''};
const lockDuration = 15_000;
const historyLimit = 500;
const operatorOnly = ['staff-save','ticket-progress','demo-reset'];
const staffFacilityActions = ['advance','release','queue-cancel','cancel-booking'];

export function migrateAccess(state) {
 if (state.schemaVersion < SCHEMA_VERSION) {
  state.staff = [{...demoStaff}];
  state.doorUnlocks = {};
  state.doorEvents = [];
  state.schemaVersion = SCHEMA_VERSION;
 }
 return state;
}

export const isAdmin = actor => actor.role === 'operator' && actor.permission === 'admin';
export const publicStaff = ({id,name,email,permission,enabled}) => ({id,name,email,permission,enabled});
export const operatorAccounts = state => [administrator,...state.staff];
export const demoOperators = state => operatorAccounts(state)
 .filter(account => account.id === 'admin' || (account.id === demoStaff.id && account.enabled && !account.codeHash))
 .map(publicStaff);
export const operatorSessionKey = account => account.id === 'admin' ? '' : account.id + ':' + account.version;
export const operatorActor = account => ({role:'operator',residentId:'',staffId:account.id,name:account.name,permission:account.permission});

export async function authenticateOperator(state, email, code, digest) {
 const account = operatorAccounts(state).find(a => a.enabled && a.email === email);
 if (!account || typeof code !== 'string' || code.length > 128) return null;
 if (account.id === 'admin') return code === 'operator-demo' ? account : null;
 if (account.codeHash) return await digest(code) === account.codeHash ? account : null;
 return account.id === demoStaff.id && code === 'staff-demo' ? account : null;
}

export function canAction(actor, action) {
 if (actor.role === 'resident') return !operatorOnly.includes(action) && action !== 'advance';
 if (isAdmin(actor)) return action !== 'door-access';
 return action === 'ticket-progress' || staffFacilityActions.includes(action);
}

function allDoors(state) {
 const rooms = state.rooms.map(r => ({id:'room:'+r.id,kind:'room',room:r.number}));
 const registered = new Set(rooms.map(r => r.room));
 for (const r of state.residents) if (r.room && !registered.has(r.room)) {
  rooms.push({id:'assigned-room:'+r.room,kind:'room',room:r.room});
  registered.add(r.room);
 }
 return [
  {id:'entrance',kind:'entrance'},
  ...rooms,
  ...state.facilities.filter(f => f.resourceType === 'space').map(f => ({
   id:'facility:'+f.id,kind:'facility',facilityId:f.id,name:f.name,
  })),
 ];
}
function eligible(state, resident, door, now) {
 if (resident?.status !== 'in-house') return false;
 if (door.kind === 'entrance') return true;
 if (door.kind === 'room') return resident.room === door.room;
 const facility = state.facilities.find(f => f.id === door.facilityId);
 return facility?.enabled && state.facilityUsage.some(u => u.facilityId === door.facilityId &&
  u.residentId === resident.id && u.status === 'active' && Date.parse(u.expiresAt) > now);
}
function lastPassage(state, residentId, doorId) {
 return state.doorEvents.findLast(e => e.residentId === residentId && e.doorId === doorId && e.action !== 'lock');
}
function doorPermissions(state, resident, door, now) {
 const mayEnter = eligible(state, resident, door, now);
 const mayExit = mayEnter || (door.kind === 'facility' && lastPassage(state,resident?.id,door.id)?.action === 'entry');
 const unlock = state.doorUnlocks[door.id];
 const unlockedUntil = unlock?.until > now ? unlock.until : 0;
 return {mayEnter,mayExit,unlockedUntil,mayLock:unlockedUntil > 0 && unlock.by === resident?.id};
}

export function projectAccess(state, copy, actor) {
 const admin = isAdmin(actor);
 const resident = state.residents.find(r => r.id === actor.residentId);
 const now = Date.now();
 delete copy.doorUnlocks;
 delete copy.staff;
 if (admin) copy.staff = operatorAccounts(state).map(publicStaff);
 copy.doors = allDoors(state).filter(d => actor.role === 'resident'
  ? (d.kind !== 'room' || d.room === resident?.room) && (d.kind !== 'facility' || state.facilities.find(f => f.id === d.facilityId)?.enabled || lastPassage(state,resident?.id,d.id)?.action === 'entry')
  : admin || d.kind !== 'room').map(d => ({
   ...d,
   ...(actor.role === 'resident'
    ? doorPermissions(state,resident,d,now)
    : {unlockedUntil:state.doorUnlocks[d.id]?.until > now ? state.doorUnlocks[d.id].until : 0}),
  }));
 copy.doorEvents = state.doorEvents.filter(e => admin || (actor.role === 'resident'
  ? e.residentId === actor.residentId
  : e.doorKind !== 'room'));
 return copy;
}

export function projectStaff(state, actor) {
 const view = Object.fromEntries(['settings','facilities','reservations','queueEntries','facilityUsage','tickets'].map(k => [k,structuredClone(state[k])]));
 view.residents = state.residents.map(({id,name,room,status}) => ({id,name,room,status}));
 const linked = new Set(state.tickets.map(t => t.assetId));
 view.assets = state.assets.filter(a => linked.has(a.id)).map(({id,name,status}) => ({id,name,status}));
 view.facilityUsage = view.facilityUsage.map(({accessCode,...use}) => use);
 return projectAccess(state,view,actor);
}

export function preserveAccess(current, proposal) {
 const next = {...proposal,schemaVersion:current.schemaVersion};
 for (const key of ['staff','doorUnlocks','doorEvents','accessEvents']) next[key] = current[key];
 delete next.doors;
 return next;
}

function useDoor(state, actor, command) {
 const door = allDoors(state).find(d => d.id === command.doorId);
 const resident = state.residents.find(r => r.id === actor.residentId);
 const action = command.direction;
 const now = Date.now();
 if (!door || !resident) throw Error('Access denied');
 const {mayEnter,mayExit,mayLock} = doorPermissions(state,resident,door,now);
 if (!(action === 'entry' && mayEnter || action === 'exit' && mayExit || action === 'lock' && mayLock)) throw Error('Access denied');
 for (const [id,unlock] of Object.entries(state.doorUnlocks)) if (unlock.until <= now) delete state.doorUnlocks[id];
 if (action === 'lock') delete state.doorUnlocks[door.id];
 else state.doorUnlocks[door.id] = {until:now + lockDuration,by:resident.id};
 state.doorEvents.push({
  id:crypto.randomUUID(),doorId:door.id,doorKind:door.kind,room:door.room,
  name:door.name,residentId:resident.id,residentName:resident.name,
  action,createdAt:new Date(now).toISOString(),
 });
 state.doorEvents = state.doorEvents.slice(-historyLimit);
}

function updateTicket(state, command) {
 const ticket = state.tickets.find(t => t.id === command.ticketId);
 if (!ticket || !['open','in-progress','resolved'].includes(command.status)) throw Error('Invalid repair status');
 const asset = state.assets.find(a => a.id === ticket.assetId);
 if (asset) {
  if (!['good','repair'].includes(command.assetStatus)) throw Error('Invalid asset status');
  asset.status = command.assetStatus;
 }
 ticket.status = command.status;
 ticket.updatedAt = new Date().toISOString();
}

async function saveStaff(state, command, digest) {
 const existing = state.staff.find(a => a.id === command.staffId);
 if (command.staffId && !existing) throw Error('Staff account not found');
 const name = typeof command.name === 'string' ? command.name.trim() : '';
 const email = typeof command.email === 'string' ? command.email.trim().toLowerCase() : '';
 const {permission,enabled} = command;
 if (!name || name.length > 80 || email.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
     !['admin','staff'].includes(permission) || typeof enabled !== 'boolean') throw Error('Invalid staff details');
 if (operatorAccounts(state).some(a => a.id !== existing?.id && a.email === email)) throw Error('Email already in use');
 if (!existing && state.staff.length >= 100) throw Error('Staff limit reached');
 const changedIdentity = existing?.email !== email || existing?.permission !== permission;
 const issueCode = !existing || command.rotateCode === true || (!existing.codeHash && changedIdentity);
 const accessCode = issueCode ? crypto.randomUUID().replaceAll('-','') : '';
 const codeHash = issueCode ? await digest(accessCode) : existing.codeHash;
 const changed = issueCode || changedIdentity || existing.enabled !== enabled;
 const next = {id:existing?.id || crypto.randomUUID(),name,email,permission,enabled,codeHash,version:(existing?.version || 0)+(changed ? 1 : 0)};
 if (existing) Object.assign(existing,next);
 else state.staff.push(next);
 return accessCode;
}

export async function accessAction(current, actor, command, digest) {
 if (!canAction(actor,command?.action)) throw Error('Access denied');
 if (!['door-access','ticket-progress','staff-save'].includes(command?.action)) return null;
 const data = structuredClone(current);
 let accessCode = '';
 switch (command.action) {
 case 'door-access': useDoor(data,actor,command); break;
 case 'ticket-progress': updateTicket(data,command); break;
 case 'staff-save':
  if (command.staffId && command.staffId === actor.staffId) throw Error('Access denied');
  accessCode = await saveStaff(data,command,digest); break;
 }
 return {data,accessCode};
}
