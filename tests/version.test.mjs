// 版本號：選單裡顯示的版本號，要和 index.html 裡 css、js 網址後面的 ?v= 一樣
//   瀏覽器（特別是 iPhone）會暫存舊的 css、js；改了版本號才會重新下載，不會新舊程式混在一起
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('每個 css、js 都帶著和畫面上一樣的版本號', () => {
  const shown = html.match(/版本 ([\d.]+)/)[1];
  const local = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)].map(m => m[1]);
  assert.ok(local.length > 0);
  for (const url of local) assert.equal(url.split('?v=')[1], shown, url);
});

test('js 資料夾裡的每個檔案都有載入', () => {
  const loaded = new Set([...html.matchAll(/src="js\/([^"?]+)/g)].map(m => m[1]));
  for (const f of readdirSync(new URL('../js/', import.meta.url))) assert.ok(loaded.has(f), `index.html 沒有載入 js/${f}`);
});
