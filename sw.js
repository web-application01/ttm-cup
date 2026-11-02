'use strict';
/* Service Worker ของแอปเปลือก (PWA) — สร้างอัตโนมัติจากหน้า Admin (ห้ามแก้ด้วยมือ)
 * เวอร์ชัน 2.2.1-083a8180
 * - เก็บเฉพาะไฟล์ของแอปเปลือก (หน้าเปิดแอป ไอคอน หน้าออฟไลน์) ไม่เก็บข้อมูลผู้รับบริการ
 * - ไม่ยุ่งกับคำขอที่ไปยัง Google (ข้อมูลทั้งหมดวิ่งตรงระหว่างเครื่องกับ Google Apps Script)
 */
const VERSION = "2.2.1-083a8180";
const CACHE = 'ttm-shell-' + VERSION;
const SCOPE = self.registration.scope;
const ASSETS = ['./', 'index.html', 'offline.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-32.png'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(ASSETS.map(u => cache.add(new Request(u, { cache: 'reload' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.indexOf('ttm-shell-') === 0 && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;
  if (url.searchParams.has('__probe')) return; // ตรวจการเชื่อมต่อ: ส่งตรงถึงเซิร์ฟเวอร์
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) { event.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') { event.respondWith(openPage(req)); return; }
  event.respondWith(asset(event, req));
});

function indexUrl() { return new URL('index.html', SCOPE).href; }
function isAppPage(u) {
  const p = new URL(u).pathname, s = new URL(SCOPE).pathname;
  return p === s || p === s + 'index.html';
}
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
async function openPage(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req), 6000);
    if (res && res.ok && isAppPage(req.url)) await cache.put(indexUrl(), res.clone());
    return res;
  } catch (e) {
    if (isAppPage(req.url)) {
      const hit = (await cache.match(indexUrl())) || (await cache.match(SCOPE));
      if (hit) return hit;
    }
    return (await cache.match(new URL('offline.html', SCOPE).href)) ||
      new Response('<meta charset="utf-8"><p style="font:16px system-ui;padding:24px">ไม่มีการเชื่อมต่ออินเทอร์เน็ต</p>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}
async function asset(event, req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  const net = fetch(req).then(res => {
    if (res && res.ok && res.type === 'basic') return cache.put(req, res.clone()).then(() => res);
    return res;
  }).catch(() => null);
  if (hit) { event.waitUntil(net); return hit; }
  return (await net) || new Response('', { status: 504 });
}
async function receiveShare(req) {
  try {
    const form = await req.formData();
    const files = form.getAll('files').filter(f => f && typeof f === 'object' && typeof f.size === 'number' && f.size > 0).slice(0, 10);
    await idbPut({ at: Date.now(), title: String(form.get('title') || ''), text: String(form.get('text') || ''), url: String(form.get('url') || ''), files: files });
  } catch (e) { /* แชร์ไม่สำเร็จ — เปิดแอปตามปกติ */ }
  return Response.redirect(new URL('./?share=1', SCOPE).href, 303);
}
function idbPut(value) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('ttm-share', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('q');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('q', 'readwrite');
      tx.objectStore('q').put(value, 'last');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
