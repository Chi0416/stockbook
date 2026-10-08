// 收盤價和日 KD（shared/prices.json，由 tools/update-prices.mjs 產生）的格式：node --test tests/*.test.mjs
//   GitHub 每天自動更新時也會先跑這個，格式不對就不存（見 .github/workflows/update-prices.yml）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { date, rows } = JSON.parse(readFileSync(new URL('../shared/prices.json', import.meta.url), 'utf8'));
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isKD = v => v === null || (typeof v === 'number' && v >= 0 && v <= 100);

test('上市、上櫃的股票和 ETF 都有，權證不收', () => {
  assert.ok(isDate(date));
  const codes = Object.keys(rows);
  assert.ok(codes.length > 2000, `${codes.length} 檔`);
  for (const code of ['2330', '0050', '00878', '6488', '00679B']) assert.ok(rows[code], code);
  assert.ok(!codes.some(c => /^7\d{4}[0-9A-Z]$/.test(c)), '不應該有上櫃的權證');
});

test('每一檔：[收盤價, K, D, 前一天的 K, 前一天的 D]，最近一天沒成交的多一個日期', () => {
  for (const [code, r] of Object.entries(rows)) {
    assert.match(code, /^[0-9A-Z]{4,6}$/, code);
    assert.ok(r.length === 5 || r.length === 6, code);
    assert.ok(typeof r[0] === 'number' && r[0] > 0, code);
    assert.ok(r.slice(1, 5).every(isKD), code);
    assert.ok((r[1] === null) === (r[2] === null), code);
    if (r.length === 6) assert.ok(isDate(r[5]) && r[5] < date, code);
  }
});

test('大部分的股票都算得出 KD', () => {
  const all = Object.values(rows);
  assert.ok(all.filter(r => r[1] !== null).length > all.length * 0.95);
});
