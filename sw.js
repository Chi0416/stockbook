









const VERSION = new URL(location.href).searchParams.get('v') || 'dev';
const SITE = new URL(location.href).searchParams.get('site') || 'stockbook';
const CACHE = `${SITE}-${VERSION}`;
const ROOT = new URL('./', location.href).href;
const PAGES = ['./', 'help.html', 'privacy.html'];

const DATA_ROOT = new URL(new URL(location.href).searchParams.get('data') || 'shared/', ROOT).href;
const DATA = ['dividends', 'prices'];
if (SITE === 'stockbook') DATA.push('yield');
else DATA.push('eps', 'kd');
const dataUrl = name => `${DATA_ROOT}${name}.json`;
const TIMEOUT = 4000;


const refs = html => [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:css|js|png|json)(?:\?[^"#]*)?)"/g)].map(m => m[1]);
const bare = url => url.split(/[?#]/)[0];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const files = new Set();
    for (const page of PAGES) {
      const res = await fetch(page, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${page} ${res.status}`);
      refs(await res.clone().text()).forEach(f => files.add(f));
      await cache.put(new URL(page, ROOT).href, res);
    }
    await cache.addAll([...files]);

    await Promise.all(DATA.map(dataUrl).map(url => fetch(url, { cache: 'no-cache' })
      .then(res => res.ok && cache.put(url, res)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(`${SITE}-`) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  if (bare(req.url).startsWith(DATA_ROOT)) return e.respondWith(data(e));
  if (!req.url.startsWith(ROOT)) return;
  if (req.mode === 'navigate') e.respondWith(page(e));
  else e.respondWith(file(e));
});



function page(e) {
  const key = bare(e.request.url).replace(/index\.html$/, '');
  const net = fetch(e.request);
  e.waitUntil(net.then(res => {
    if (!res.ok || res.type !== 'basic') return null;
    const copy = res.clone();
    return caches.open(CACHE).then(cache => cache.put(key, copy));
  }).catch(() => {}));
  return (async () => {
    try {
      return await Promise.race([net, new Promise((_, no) => setTimeout(no, TIMEOUT))]);
    } catch (_) {
      const cache = await caches.open(CACHE);
      return (await cache.match(key)) || (await cache.match(ROOT)) || net;
    }
  })();
}


async function file(e) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(e.request);
  if (hit) return hit;
  const res = await fetch(e.request);
  if (res.ok && res.type === 'basic') e.waitUntil(cache.put(e.request, res.clone()));
  return res;
}







const justSaved = new Map();
async function data(e) {
  const key = bare(e.request.url);
  const cache = await caches.open(CACHE);
  const net = fetch(e.request);
  let served = null;
  e.waitUntil(net.then(async res => {
    if (!res.ok) return;
    await cache.put(key, res.clone());
    if (served && (await served.text()) !== (await res.text())) {
      justSaved.set(key, Date.now());
      await tell(e.clientId, key);
    }
  }).catch(() => {}));
  const hit = await cache.match(key);
  if (!hit) return net;
  const fresh = Date.now() - (justSaved.get(key) || 0) < 60000;
  justSaved.delete(key);
  if (fresh) return hit;
  const ok = net.then(res => (res.ok ? res : Promise.reject(res)));
  const res = await Promise.race([ok, new Promise((_, no) => setTimeout(no, TIMEOUT))]).catch(() => null);
  if (res) return res;
  served = hit.clone();
  return hit;
}


async function tell(clientId, key) {
  const client = clientId && await self.clients.get(clientId);
  if (client) client.postMessage({ fresh: key.slice(DATA_ROOT.length).replace(/\.json$/, '') });
}
