// ETF 成分股（shared/etf.json，從投信網站抄下來的，見 js/etf.js）的格式：node --test tests/
//   手動更新時跑一次，免得少抄、抄錯格式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { etfs } = JSON.parse(readFileSync(new URL('../shared/etf.json', import.meta.url), 'utf8'));
const prices = JSON.parse(readFileSync(new URL('../shared/prices.json', import.meta.url), 'utf8')).rows;

test('每一檔 ETF：名稱、哪家投信、公布日期、網址、成分股', () => {
  assert.ok(Object.keys(etfs).length > 0);
  for (const [code, e] of Object.entries(etfs)) {
    assert.match(code, /^\d{4,6}[A-Z]?$/, code);
    assert.ok(e.name && /投信$/.test(e.source), code);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, code);
    assert.match(e.url, /^https:\/\//, code);
    assert.ok(Array.isArray(e.holdings) && e.holdings.length >= 10, `${code} 只有 ${e.holdings?.length} 檔`);
  }
});

test('成分股：[代號, 權重]，權重大的在前，加起來不超過 100%，同一檔不重複', () => {
  for (const [code, e] of Object.entries(etfs)) {
    const codes = e.holdings.map(h => h[0]);
    assert.equal(new Set(codes).size, codes.length, `${code} 有重複的成分股`);
    e.holdings.forEach(([c, w], i) => {
      assert.match(c, /^\d{4,6}[A-Z]?$/, `${code} ${c}`);
      assert.ok(typeof w === 'number' && w > 0 && w <= 100, `${code} ${c} ${w}`);
      if (i) assert.ok(w <= e.holdings[i - 1][1], `${code} ${c} 沒有照權重排`);
    });
    const sum = e.holdings.reduce((s, h) => s + h[1], 0);
    assert.ok(sum > 80 && sum <= 100.5, `${code} 權重加起來 ${sum}`);
  }
});

test('成分股都在收盤資料裡（代號抄錯、已經下市的會被抓出來）', () => {
  for (const [code, e] of Object.entries(etfs)) {
    const missing = e.holdings.map(h => h[0]).filter(c => !prices[c]);
    assert.deepEqual(missing, [], `${code} 收盤資料裡沒有：${missing.join('、')}`);
  }
});
