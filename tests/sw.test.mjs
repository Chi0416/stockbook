// 離線用的 service worker（sw.js）：存的檔案、版本號
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// 在 GitHub Pages 上的樣子：https://帳號.github.io/repo/sw.js?v=版本號
function load(v = '2026.10.08.1') {
  const ctx = vm.createContext({
    self: { addEventListener() {} },
    location: { href: `https://example.github.io/stocks/sw.js?v=${v}` },
    URL,
  });
  vm.runInContext(read('sw.js'), ctx, { filename: 'sw.js' });
  return vm.runInContext('({ VERSION, CACHE, ROOT, PAGES, DATA, refs })', ctx);
}

test('存的那份跟著版本號：換版本就是新的一份', () => {
  const sw = load('2026.10.08.7');
  assert.equal(sw.VERSION, '2026.10.08.7');
  assert.equal(sw.CACHE, 'stockbook-2026.10.08.7');
  assert.equal(sw.ROOT, 'https://example.github.io/stocks/');
});

test('首頁載入的每個 css、js、manifest、圖示都會存起來（新增 js 不用改 sw.js）', () => {
  const sw = load();
  const html = read('index.html');
  const saved = new Set(sw.refs(html));
  const local = [...html.matchAll(/(?:src|href)="((?:js\/|css\/|icons\/|manifest\.json)[^"]*)"/g)].map(m => m[1]);
  assert.ok(local.length > 10);
  for (const f of local) assert.ok(saved.has(f), f);
  // 外站（Google 登入、字型）不存
  assert.ok([...saved].every(f => !f.includes('//')));
});

test('使用說明、隱私權政策和它們用的 css 也存起來', () => {
  const sw = load();
  assert.deepEqual([...sw.PAGES], ['./', 'help.html', 'privacy.html']);
  for (const page of ['help.html', 'privacy.html']) {
    const css = [...read(page).matchAll(/href="(css\/[^"]+)"/g)].map(m => m[1]);
    assert.ok(css.length > 0, page);
    for (const f of css) assert.ok(sw.refs(read(page)).includes(f), `${page}: ${f}`);
  }
});

test('除權息公告、EPS、股價三個資料檔都會存（沒網路時用上次抓到的）', () => {
  const sw = load();
  for (const f of sw.DATA) assert.ok(readFileSync(new URL(`../${f}`, import.meta.url)).length > 0, f);
  assert.deepEqual([...sw.DATA].sort(), ['shared/dividends.json', 'shared/eps.json', 'shared/prices.json']);
});

test('app.js 登記 service worker 時帶著自己網址上的版本號', () => {
  const app = read('js/app.js');
  assert.match(app, /serviceWorker\.register\(`sw\.js\?v=\$\{encodeURIComponent\(v\)\}`\)/);
  assert.match(app, /document\.currentScript\?\.src/);
});
