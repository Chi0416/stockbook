// 收盤價和日 KD（shared/prices.json）、K 線（shared/candles.json），都由 tools/update-prices.mjs 產生，的格式：node --test tests/*.test.mjs
//   GitHub 每天自動更新時也會先跑這個，格式不對就不存（見 .github/workflows/update-prices.yml）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { date, complete, rows, months } = JSON.parse(readFileSync(new URL('../shared/prices.json', import.meta.url), 'utf8'));
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isKD = v => v === null || (typeof v === 'number' && v >= 0 && v <= 100);

test('上市、上櫃的股票和 ETF 都有，權證不收', () => {
  assert.ok(isDate(date));
  assert.equal(typeof complete, 'boolean');
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

test('最近兩個月的月底收盤價（庫存快照用）：{ 日期: { 代號: 收盤價 } }，日期在 date 之前、新的在前', () => {
  const dates = Object.keys(months);
  assert.equal(dates.length, 2);
  assert.ok(dates.every(d => isDate(d) && d < date), dates.join());
  assert.ok(dates[0] > dates[1] && dates[0].slice(0, 7) !== dates[1].slice(0, 7), dates.join());
  for (const d of dates) {
    const list = Object.entries(months[d]);
    assert.ok(list.length > 2000, `${d} ${list.length} 檔`);
    assert.ok(list.every(([c, v]) => /^[0-9A-Z]{4,6}$/.test(c) && typeof v === 'number' && v > 0), d);
    for (const code of ['2330', '0050']) assert.ok(months[d][code], `${d} ${code}`);
  }
});

test('K 線（月線扣抵用）：days 新的在前；每一檔照 days 的順序，最近 20 個有成交的是 [開, 高, 低, 收]，再往前 19 個只有收盤價', () => {
  const k = JSON.parse(readFileSync(new URL('../shared/candles.json', import.meta.url), 'utf8'));
  assert.equal(k.date, date);
  assert.equal(k.days.length, 60);
  assert.equal(k.days[0], date);
  assert.ok(k.days.every((d, i) => isDate(d) && (i === 0 || d < k.days[i - 1])), k.days.join());
  const list = Object.entries(k.rows);
  assert.ok(list.length > 2000, `${list.length} 檔`);
  const ok = v => typeof v === 'number' && v > 0;
  for (const [code, r] of list) {
    assert.match(code, /^[0-9A-Z]{4,6}$/, code);
    assert.ok(r.length > 0 && r.length <= k.days.length, code);
    assert.notEqual(r[r.length - 1], null, code);
    const traded = r.filter(v => v !== null);
    assert.ok(traded.length <= 39, code); // 湊滿就停
    traded.forEach((v, i) => {
      if (i < 20) {
        assert.ok(Array.isArray(v) && v.length === 4 && v.every(ok), `${code} 第 ${i + 1} 天`);
        assert.ok(v[1] >= Math.max(v[0], v[3]) && v[2] <= Math.min(v[0], v[3]), `${code} 第 ${i + 1} 天：最高、最低不對`);
      } else assert.ok(ok(v), `${code} 第 ${i + 1} 天`);
    });
  }
  // 最近一天有成交的，收盤價和 prices.json 一樣
  for (const code of ['2330', '0050']) assert.equal(k.rows[code][0][3], rows[code][0], code);
  // 大部分的股票都算得出月線（20 天有成交）
  assert.ok(list.filter(([, r]) => r.filter(v => v !== null).length >= 20).length > list.length * 0.95);
});
