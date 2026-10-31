// 離線也打得開：把 App 的畫面和程式存一份在手機裡（service worker，由 app.js 登記）
//   頁面（首頁、使用說明、隱私權政策）：有網路先抓最新的；沒網路、或 4 秒內沒回應，才用存的那份，不會卡在舊版
//   css、js、圖示：網址帶版本號，同一版直接用存的；換版本就是新網址，會抓新的
//   shared/*.json（除權息公告、EPS、股價、K 線）：先抓最新的，抓不到、或 4 秒內沒回應才用存的；K 線比較大，安裝時不先存，打開詳細頁用到時才存
//   Google 登入、試算表、字型等其他網站：不經過這裡
//   版本號跟著 index.html 的 ?v=（app.js 登記成 sw.js?v=版本號）：換版本時重新存一份，舊的刪掉
//   安裝時照各頁面列出的檔案存（以後新增 js 不用改這裡）
//   萬一出問題：把這個檔案換成只做 self.registration.unregister() 的版本，手機下次打開就會移除
const VERSION = new URL(location.href).searchParams.get('v') || 'dev';
const CACHE = `stockbook-${VERSION}`;
const ROOT = new URL('./', location.href).href;
const PAGES = ['./', 'help.html', 'privacy.html'];
const DATA = ['shared/dividends.json', 'shared/eps.json', 'shared/prices.json'];
const TIMEOUT = 4000;

// 頁面裡用到的本站檔案（css、js、圖示、manifest）；外站的網址有「:」，不算
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
    // 資料檔抓不到不影響安裝（App 會顯示資料還沒載入）
    await Promise.all(DATA.map(f => fetch(f, { cache: 'no-cache' })
      .then(res => res.ok && cache.put(new URL(f, ROOT).href, res)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('stockbook-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(ROOT)) return;
  if (req.mode === 'navigate') e.respondWith(page(e));
  else if (bare(req.url).startsWith(`${ROOT}shared/`)) e.respondWith(data(e));
  else e.respondWith(file(e));
});

// 頁面：先抓最新的；沒網路或太久沒回應才用存的（首頁另有 index.html 的寫法，找不到時用 ./ 那份）
//   太久沒回應時先給存的那份，網路後來回應了照樣存起來，下次打開就是新的
function page(e) {
  const key = bare(e.request.url).replace(/index\.html$/, '');
  const net = fetch(e.request);
  e.waitUntil(net.then(res => {
    if (!res.ok || res.type !== 'basic') return null;
    const copy = res.clone(); // 要在頁面讀走內容之前複製
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

// css、js、圖示：存過就用存的，沒有才抓（抓到的也存起來）
async function file(e) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(e.request);
  if (hit) return hit;
  const res = await fetch(e.request);
  if (res.ok && res.type === 'basic') e.waitUntil(cache.put(e.request, res.clone()));
  return res;
}

// 資料檔：先抓最新的，抓不到才用存的
//   網路太慢（4 秒內沒回應）而手機裡有存的那份時，先給存的，收盤價、公告不用等到網路斷掉才出來
//   網路很快回錯誤（503、部署中的 404）時也用存的
//   網路後來回應了照樣存起來；內容和先給的不一樣時通知那個頁面（見 app.js），頁面再讀一次就是新的
//     一樣就不通知：網路一直很慢時，不會讀了又通知、通知了又讀，繞不完
//     通知之後頁面馬上來讀：剛存好的那份直接給，不用再等 4 秒，也不再比對、通知（網路照樣再抓一次、存起來）
const justSaved = new Map(); // 資料檔 → 網路慢、後來才回應而剛存起來的時間
async function data(e) {
  const key = bare(e.request.url);
  const cache = await caches.open(CACHE);
  const net = fetch(e.request);
  let served = null; // 沒等網路、先給頁面的那份（複本，等網路回應了比對有沒有變）
  e.waitUntil(net.then(async res => {
    if (!res.ok) return;
    await cache.put(key, res.clone()); // 要在頁面讀走內容之前複製
    if (served && (await served.text()) !== (await res.text())) {
      justSaved.set(key, Date.now());
      await tell(e.clientId, key);
    }
  }).catch(() => {}));
  const hit = await cache.match(key);
  if (!hit) return net; // 還沒存過：網路再慢也等它
  const fresh = Date.now() - (justSaved.get(key) || 0) < 60000;
  justSaved.delete(key);
  if (fresh) return hit;
  const ok = net.then(res => (res.ok ? res : Promise.reject(res)));
  const res = await Promise.race([ok, new Promise((_, no) => setTimeout(no, TIMEOUT))]).catch(() => null);
  if (res) return res;
  served = hit.clone();
  return hit;
}

// 通知發出請求的那個頁面：哪一個資料檔有新的了（{ fresh: 'shared/prices.json' }）
async function tell(clientId, key) {
  const client = clientId && await self.clients.get(clientId);
  if (client) client.postMessage({ fresh: key.slice(ROOT.length) });
}
