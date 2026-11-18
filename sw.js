/* ScanDoc Offline — service worker: abre sem internet e envia a fila quando o sinal volta */
const CACHE = "scandoc-offline-v12";
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
  if (req.method === "POST" && new URL(req.url).pathname.endsWith("/share-target")) {
    e.respondWith((async () => {
      try {
        const fd = await req.formData(), files = fd.getAll("files").filter(f => f && f.size);
        const c = await caches.open("scandoc-shared"); for (const k of await c.keys()) await c.delete(k);
        let i = 0; for (const f of files) await c.put(new Request("./shared/" + (i++)), new Response(f, { headers: { "Content-Type": f.type || "application/octet-stream", "X-Name": encodeURIComponent(f.name || "documento") } }));
      } catch (err) {}
      return Response.redirect("./?shared=1", 303);
    })());
    return;
  }

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

/* ---- fila e histórico (mesmo banco do app) ---- */
function idb() { return new Promise((res, rej) => { const r = indexedDB.open("scandoc", 2);
  r.onupgradeneeded = () => { const d = r.result;
    if (!d.objectStoreNames.contains("fila")) d.createObjectStore("fila", { keyPath: "id" });
    if (!d.objectStoreNames.contains("log")) d.createObjectStore("log", { keyPath: "id" }); };
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function st(name, mode, fn) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction(name, mode); const q = fn(tx.objectStore(name)); let out;
  if (q) q.onsuccess = () => { out = q.result; }; tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); }); }
async function avisa() { const cs = await self.clients.matchAll(); cs.forEach(c => c.postMessage("fila-atualizada")); }
async function flushSW() {
  const items = ((await st("fila", "readonly", s => s.getAll())) || []).sort((a, b) => a.at - b.at);
  for (const it of items) {
    const r = await fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ pdf: it.pdf, nome: it.nome, tipo: it.tipo }) });
    const j = await r.json();
    if (!j || !j.ok) throw new Error("falha");
    const now = Date.now();
    await st("log", "readwrite", s => { s.put({ id: it.id, nome: it.nome, tipo: it.tipo, at: it.at, sentAt: now, offline: (now - it.at) > 60000 }); });
    await st("fila", "readwrite", s => { s.delete(it.id); });
    await avisa();
  }
}
self.addEventListener("sync", e => { if (e.tag === "envio") e.waitUntil(flushSW()); });
