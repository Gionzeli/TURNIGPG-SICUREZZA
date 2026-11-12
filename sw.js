/* Turni GPG/sicurezza - service worker. Cambia VERSION a ogni nuova versione dell'app. */
const VERSION="tg-2026-11-10-7";
const ASSETS=["./","index.html","favicon.ico","manifest.webmanifest","updates.json","favicon-32.png","icon-192.png","icon-512.png","icon.svg"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==VERSION).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=="GET"||u.origin!==location.origin)return;
  const save=res=>{if(res&&res.ok){const c=res.clone();caches.open(VERSION).then(x=>x.put(r,c))}return res};
  if(u.pathname.endsWith("updates.json")){e.respondWith(fetch(r).then(save).catch(()=>caches.match(r)));return}
  e.respondWith(caches.match(r).then(hit=>{const net=fetch(r).then(save).catch(()=>hit);return hit||net}));
});
