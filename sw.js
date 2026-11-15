/* ScanDoc Offline — service worker: abre sem internet e envia a fila quando o sinal volta */
const CACHE = "scandoc-offline-v2";
const ENDPOINT = "https://script.google.com/macros/s/AKfycbxN8gZ7ao6p8Gu0CW9M-T9Lv7sDyKbESxeERpjCdS2p_HnXMaoijpxtgs4loJrnPviriA/exec";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(ASSETS.map(u =>
    fetch(u, { mode: u.startsWith("http") ? "cors" : "same-origin", cache: "reload" })
      .then(r => r.ok ? c.put(u, r) : null).catch(() => null)))));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put("./index.html", cp)); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
    if (r.ok && (req.url.startsWith(self.location.origin) || req.url.includes("cdnjs.cloudflare.com"))) {
      const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp));
    }
    return r;
  })));
});

/* ---- fila (mesmo banco do app) ---- */
function idb() { return new Promise((res, rej) => { const r = indexedDB.open("scandoc", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("fila", { keyPath: "id" });
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function filaAll() { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction("fila").objectStore("fila").getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); }); }
async function filaDel(id) { const db = await idb(); return new Promise(res => { const tx = db.transaction("fila", "readwrite"); tx.objectStore("fila").delete(id); tx.oncomplete = res; tx.onerror = res; }); }
async function flushSW() {
  const items = await filaAll();
  for (const it of items) {
    const r = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ pdf: it.pdf, nome: it.nome, tipo: it.tipo }) });
    const j = await r.json();
    if (!j || !j.ok) throw new Error("falha");
    await filaDel(it.id);
  }
  const cs = await self.clients.matchAll(); cs.forEach(c => c.postMessage("fila-atualizada"));
}
self.addEventListener("sync", e => { if (e.tag === "envio") e.waitUntil(flushSW()); });
