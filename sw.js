/* Turni GPG/sicurezza - service worker. Gli asset AI sono preinstallati e verificati. */
const VERSION="tg-v3.177";
const ASSETS=["./","index.html","favicon.ico","manifest.webmanifest","updates.json","local-ai-assets.json","local-reader.js","local-qwen.js","local-ai-bootstrap.js","local-learning.js","src/ui/legacy-migration-page.js?v=1","src/ui/dsm-canonical-account-bridge.js","src/ui/dsm-canonical-account-bootstrap.js","src/ui/dsm-membership-invite-page.js","src/adapters/firebase/firebase-auth-adapter.js","src/core/legacy/legacy-read-adapter.js","favicon-32.png","icon-192.png","icon-512.png","icon.svg"];
const REQUIRED_ROLES=["pdfjs-browser","pdfjs-worker","tesseract-browser","tesseract-worker","tesseract-core","tesseract-ita","tesseract-eng","paddle-wrapper","paddle-model","onnxruntime-wasm","transformers-runtime","qwen-model"];
const APP_SCOPE=new URL("./",self.registration.scope);

async function installLocalAIAssets(cache){
  const response=await fetch(new URL("local-ai-assets.json",APP_SCOPE),{cache:"no-store",credentials:"same-origin"});
  if(!response.ok)throw new Error("Manifest asset AI locale non leggibile");
  const manifest=await response.json();
  if(manifest?.schemaVersion!==1||!Array.isArray(manifest.assets)||typeof manifest.enabled!=="boolean"){
    throw new Error("Manifest asset AI locale non valido");
  }
  if(!manifest.enabled){
    if(manifest.assets.length)throw new Error("Manifest AI disabilitato ma contiene asset");
    return;
  }
  const roles=new Set(manifest.assets.map(item=>item?.role));
  const missing=REQUIRED_ROLES.filter(role=>!roles.has(role));
  if(missing.length)throw new Error("Pacchetto AI incompleto: "+missing.join(", "));
  const seen=new Set();
  for(const item of manifest.assets){
    if(!item||typeof item.path!=="string"||! /^(vendor|models)\/[a-zA-Z0-9._/-]+$/.test(item.path)||item.path.split("/").includes("..")){
      throw new Error("Percorso asset AI non valido");
    }
    const url=new URL(item.path,APP_SCOPE);
    if(url.origin!==self.location.origin||!url.pathname.startsWith(APP_SCOPE.pathname)){
      throw new Error("Asset AI fuori dall'origine locale");
    }
    if(seen.has(url.href))throw new Error("Asset AI duplicato");
    seen.add(url.href);
    if(!Number.isSafeInteger(item.sizeBytes)||item.sizeBytes<1||!/^[a-f0-9]{64}$/i.test(item.sha256||"")||!item.version||!item.license||!item.source){
      throw new Error("Dimensione o SHA-256 mancante per "+item.path);
    }
    const assetResponse=await fetch(url.href,{cache:"no-store",credentials:"same-origin"});
    if(!assetResponse.ok)throw new Error("Asset AI mancante: "+item.path);
    const bytes=await assetResponse.arrayBuffer();
    if(bytes.byteLength!==item.sizeBytes)throw new Error("Dimensione errata: "+item.path);
    const digest=await crypto.subtle.digest("SHA-256",bytes);
    const hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
    if(hash.toLowerCase()!==item.sha256.toLowerCase())throw new Error("SHA-256 non valido: "+item.path);
    const headers=new Headers(assetResponse.headers);
    headers.set("X-Local-AI-SHA256",hash);
    await cache.put(url.href,new Response(bytes,{status:200,statusText:"OK",headers}));
  }
}

self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(VERSION);
    await cache.addAll(ASSETS);
    await installLocalAIAssets(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(key=>key!==VERSION).map(key=>caches.delete(key))
  )).then(()=>self.clients.claim()));
});

self.addEventListener("fetch",event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=="GET"||url.origin!==self.location.origin)return;
  const appAssetPath=url.pathname.startsWith(APP_SCOPE.pathname);
  const relativePath=appAssetPath?url.pathname.slice(APP_SCOPE.pathname.length):"";
  const isBundledAI=relativePath.startsWith("vendor/")||relativePath.startsWith("models/");
  if(isBundledAI){
    event.respondWith(caches.match(request).then(hit=>hit||new Response("Asset AI locale non installato o non verificato.",{
      status:503,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}
    })));
    return;
  }
  const save=response=>{
    if(response&&response.ok){const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(request,copy))}
    return response;
  };
  if(request.mode==="navigate"){
    event.respondWith(fetch(request,{cache:"no-store"}).then(save).catch(()=>caches.match(request).then(hit=>hit||caches.match(new URL("index.html",APP_SCOPE).href))));
    return;
  }
  if(url.pathname.endsWith("/updates.json")){
    event.respondWith(fetch(request,{cache:"no-store"}).then(save).catch(()=>caches.match(request)));
    return;
  }
  event.respondWith(caches.match(request).then(hit=>hit||fetch(request).then(save)));
});
