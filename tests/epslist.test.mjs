// EPS 和股利（shared/eps.json，由 tools/update-eps.mjs 產生）的格式：node --test tests/*.test.mjs
//   GitHub 每天自動更新時也會先跑這個，格式不對就不存（見 .github/workflows/update-eps.yml）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { updated, rows } = JSON.parse(readFileSync(new URL('../shared/eps.json', import.meta.url), 'utf8'));
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const all = Object.values(rows);
const years = [...new Set(all.flatMap(r => Object.keys(r.eps)))].sort();

test('上市、上櫃的公司都有，ETF 沒有', () => {
  assert.match(updated, /^\d{4}-\d{2}-\d{2}$/);
  const codes = Object.keys(rows);
  assert.ok(codes.length > 1700, `${codes.length} 家`);
  for (const code of ['2330', '2412', '2884', '6488']) assert.ok(rows[code], code);
  assert.ok(!codes.some(c => /^00/.test(c)), '不應該有 ETF');
});

test('最多 5 年，連續的', () => {
  assert.ok(years.length >= 2 && years.length <= 5, years.join());
  years.forEach((y, i) => assert.equal(Number(y), Number(years[0]) + i));
});

test('eps：每一年累計到第 1～4 季，最後一季一定有數字', () => {
  for (const [code, r] of Object.entries(rows)) {
    assert.match(code, /^[0-9A-Z]{4,6}$/, code);
    assert.ok(Object.keys(r.eps).length, code);
    for (const [y, list] of Object.entries(r.eps)) {
      assert.ok(years.includes(y), code);
      assert.ok(list.length >= 1 && list.length <= 4, `${code} ${y}`);
      assert.ok(list.every(v => v === null || isNum(v)), `${code} ${y}`);
      assert.ok(isNum(list[list.length - 1]), `${code} ${y}`);
    }
  }
});

test('div：每一年度 [現金股利, 股票股利, 涵蓋幾季]', () => {
  for (const [code, r] of Object.entries(rows)) {
    for (const [y, d] of Object.entries(r.div)) {
      assert.ok(years.includes(y), `${code} ${y}`);
      assert.equal(d.length, 3, `${code} ${y}`);
      assert.ok(isNum(d[0]) && d[0] >= 0 && isNum(d[1]) && d[1] >= 0, `${code} ${y}`);
      assert.ok(Number.isInteger(d[2]) && d[2] >= 1, `${code} ${y}`);
    }
  }
});

// 股利看再前一年：年中剛有新一年的第 1 季時，前一年度的股利還有一些公司沒決議
test('大部分的公司都有前一年的全年 EPS、再前一年整年度的股利', () => {
  const y = years[years.length - 2];
  const y2 = years[years.length - 3];
  assert.ok(all.filter(r => r.eps[y]?.length === 4).length > all.length * 0.9, y);
  assert.ok(all.filter(r => r.div[y2]?.[2] >= 4).length > all.length * 0.8, y2);
});
