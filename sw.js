// Baby Day Book — service worker (sans cache).
// Rôle : afficher une notification pour chaque chrono en cours (allaitement, sommeil)
// avec des boutons d'action utilisables sans ouvrir l'app.

const DBN = 'bdb', ST = 'kv', TAG = 'bdb-run-';
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DBN, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(ST);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const kvGet = async (k) => {
  const db = await idb();
  return new Promise((res, rej) => {
    const q = db.transaction(ST).objectStore(ST).get(k);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

const hm = (ms) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const mins = (sec) => { const m = Math.floor(sec / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
function secs(e, now) {
  now = now || Date.now();
  let l = e.left_sec || 0, r = e.right_sec || 0;
  if (e.active_side && e.active_since) {
    const d = Math.max(0, Math.floor((now - Date.parse(e.active_since)) / 1000));
    if (e.active_side === 'left') l += d; else r += d;
  }
  return { l, r, t: l + r };
}
const granted = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';

function actionsFor(e) {
  const max = (typeof Notification !== 'undefined' && Notification.maxActions) || 2;
  if (e.type === 'sommeil') return [{ action: 'finish', title: '☀️ Réveil' }];
  const list = [{ action: 'finish', title: '⏹ Terminer' }];
  if (e.active_side) {
    list.push({ action: 'switch', title: e.active_side === 'left' ? '➡ Passer à droite' : '⬅ Passer à gauche' });
    list.push({ action: 'pause', title: '⏸ Pause' });
  } else {
    list.push({ action: 'left', title: '▶ Gauche' }, { action: 'right', title: '▶ Droite' });
  }
  return list.slice(0, max);
}

async function show(e, child) {
  if (!granted()) return;
  const tag = TAG + e.id;
  const sig = [e.id, e.active_side || '', e.left_sec, e.right_sec, e.ended_at || ''].join('|');
  const ex = await self.registration.getNotifications({ tag });
  if (ex.some((n) => n.data && n.data.sig === sig)) return;
  const started = Date.parse(e.started_at);
  let title, body;
  if (e.type === 'allaitement') {
    const c = secs(e);
    const side = e.active_side === 'left' ? 'sein gauche' : e.active_side === 'right' ? 'sein droit' : 'en pause';
    title = e.active_side ? '🤱 Allaitement en cours' : '🤱 Allaitement en pause';
    body = `${child ? child + ' · ' : ''}${side} · G ${mins(c.l)} · D ${mins(c.r)} (à ${hm(Date.now())})`;
  } else {
    title = `🌙 ${child || 'Bébé'} dort`;
    body = `Endormi à ${hm(started)}`;
  }
  await self.registration.showNotification(title, {
    body, tag, icon: 'icon-192.png', badge: 'badge.png', timestamp: started,
    silent: true, renotify: false, requireInteraction: true,
    actions: actionsFor(e), data: { id: e.id, type: e.type, child: child || '', sig }
  });
}

async function syncAll(events, child) {
  const keep = new Set();
  for (const ev of events) { keep.add(TAG + ev.id); await show(ev, child); }
  for (const n of await self.registration.getNotifications()) {
    if (n.tag && n.tag.startsWith(TAG) && !keep.has(n.tag)) n.close();
  }
}
async function closeAll() {
  for (const n of await self.registration.getNotifications()) if (n.tag && n.tag.startsWith(TAG)) n.close();
}

self.addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.type === 'sync') e.waitUntil(syncAll(m.events || [], m.child));
  else if (m.type === 'clear') e.waitUntil(closeAll());
});

// Applique l'action directement en base (session synchronisée par la page).
// Renvoie false si ce n'est pas possible (jeton expiré, réseau…) : l'app s'ouvre alors et s'en charge.
async function apply(d, act) {
  const a = await kvGet('auth');
  if (!a || !a.access_token || (a.expires_at || 0) * 1000 < Date.now() + 15000) return false;
  const H = { apikey: a.key, Authorization: 'Bearer ' + a.access_token, 'Content-Type': 'application/json' };
  const url = `${a.url}/rest/v1/babydaybook_events?id=eq.${encodeURIComponent(d.id)}`;
  const r = await fetch(url + '&select=*', { headers: H });
  if (!r.ok) return false;
  const e = (await r.json())[0];
  if (!e) return true;
  const now = new Date(), c = secs(e, now.getTime()), patch = {};
  if (act === 'finish') {
    patch.ended_at = now.toISOString();
    if (e.type === 'allaitement') { patch.left_sec = c.l; patch.right_sec = c.r; patch.active_side = null; patch.active_since = null; }
  } else if (e.type === 'allaitement') {
    patch.left_sec = c.l; patch.right_sec = c.r;
    const side = act === 'switch' ? (e.active_side === 'left' ? 'right' : 'left') : (act === 'pause' ? null : act);
    if (side === null || side === e.active_side) { patch.active_side = null; patch.active_since = null; }
    else { patch.active_side = side; patch.active_since = now.toISOString(); patch.ended_at = null; }
  } else return true;
  const u = await fetch(url, { method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!u.ok) return false;
  const ne = (await u.json())[0];
  if (ne && !ne.ended_at) await show(ne, d.child);
  return true;
}

async function openApp(query, msg) {
  const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of cs) {
    if (c.url.startsWith(self.registration.scope)) { await c.focus(); if (msg) c.postMessage(msg); return; }
  }
  await self.clients.openWindow(self.registration.scope + (query || ''));
}

self.addEventListener('notificationclick', (e) => {
  const n = e.notification, d = n.data || {}, act = e.action;
  n.close();
  e.waitUntil((async () => {
    if (!act) return openApp('');
    let ok = false;
    try { ok = await apply(d, act); } catch (_) {}
    if (!ok) await openApp(`?act=${act}&id=${encodeURIComponent(d.id)}`, { type: 'act', act, id: d.id });
  })());
});
