// 統計（累積現金股利的「統計」畫面）的測試：node --test tests/
//   用瀏覽器載入的同一份程式（util.js、stats.js 都是全域變數），放進同一個 vm 環境執行
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({});
for (const f of ['util', 'stats']) {
  const src = readFileSync(new URL(`../js/${f}.js`, import.meta.url), 'utf8');
  vm.runInContext(src, ctx, { filename: `${f}.js` });
}
const { Stats } = vm.runInContext('({ Stats })', ctx);

// vm 裡建立的物件和這裡的原型不同，比較前先轉成一般物件
const plain = v => JSON.parse(JSON.stringify(v));

// 累積現金股利頁的列（views.js 算出來的樣子）；pending 代表待發放或待除權息
const row = (code, name, payDate, net, extra = {}) => ({ id: `${code}-${payDate}`, code, name, payDate, net, member: 'm1', ...extra });
const keys = { amount: 'net', date: 'payDate', code: 'code', name: 'name', isPending: r => !!r.pending };
const cfg = { label: '股息', ranking: '股息來源排行', ...keys };
const members = [{ id: 'm1', name: '爸爸' }, { id: 'm2', name: '媽媽' }];

test('每月：選了年份時列出 1～12 月，已入帳和待入帳分開加總，算不出來的不計入', () => {
  const rows = [
    row('0056', '元大高股息', '2026-08-12', 3000),
    row('2884', '玉山金', '2026-08-20', 1200),
    row('00878', '國泰永續高股息', '2026-11-18', 900, { pending: true }),
    row('2330', '台積電', '2026-10-09', null),
    row('0056', '元大高股息', '2025-10-15', 2500),
  ];
  const t = plain(Stats.timeline(rows, { ...keys, period: '2026' }));
  assert.equal(t.unit, 'month');
  assert.equal(t.year, '2026');
  assert.equal(t.buckets.length, 12);
  assert.deepEqual(t.buckets[7], { key: '2026-08', label: '8月', done: 4200, pending: 0 });
  assert.deepEqual(t.buckets[10], { key: '2026-11', label: '11月', done: 0, pending: 900 });
  assert.equal(t.buckets[9].done + t.buckets[9].pending, 0); // 10 月那筆算不出來
});

test('每月：選了某個月時還是列出那一整年', () => {
  const rows = [row('0056', '元大高股息', '2026-08-12', 3000), row('0056', '元大高股息', '2026-11-12', 2000)];
  const t = plain(Stats.timeline(rows, { ...keys, period: '2026-08' }));
  assert.equal(t.unit, 'month');
  assert.equal(t.buckets[10].done, 2000);
});

test('每月：全部年月時只有一年的資料就列那一年的月份，兩年以上改成每年一行（中間沒有股利的年份也列出）', () => {
  const one = plain(Stats.timeline([row('0056', '元大高股息', '2026-08-12', 3000)], { ...keys, period: '' }));
  assert.equal(one.unit, 'month');
  assert.equal(one.year, '2026');

  const rows = [
    row('0056', '元大高股息', '2023-08-12', 1000),
    row('0056', '元大高股息', '2025-08-12', 2000),
    row('0056', '元大高股息', '2025-11-12', 500, { pending: true }),
  ];
  const t = plain(Stats.timeline(rows, { ...keys, period: '' }));
  assert.equal(t.unit, 'year');
  assert.deepEqual(t.buckets.map(b => [b.key, b.done, b.pending]), [['2023', 1000, 0], ['2024', 0, 0], ['2025', 2000, 500]]);
});

test('每月：沒有算得出來的金額時回傳 null', () => {
  assert.equal(Stats.timeline([row('2330', '台積電', '2026-10-09', null)], { ...keys, period: '' }), null);
  assert.equal(Stats.timeline([], { ...keys, period: '2026' }), null);
});

test('排行：依代號合計（不分大小寫、全家加在一起），由大到小；名稱用最新的一筆；0 元的不列出', () => {
  const rows = [
    row('0056', '元大高股息', '2026-08-12', 3000, { member: 'm1' }),
    row('0056', '元大高股息', '2026-08-12', 1000, { member: 'm2' }),
    row('00679b', '元大美債20年', '2026-07-15', 800),
    row('00679B', '元大美債20年(新名稱)', '2026-10-15', 700, { pending: true }),
    row('2884', '玉山金', '2026-08-20', 0),
    row('2330', '台積電', '2026-10-09', null),
  ];
  const list = plain(Stats.ranking(rows, keys));
  assert.deepEqual(list.map(e => [e.code, e.name, e.done, e.pending, e.total]), [
    ['0056', '元大高股息', 4000, 0, 4000],
    ['00679B', '元大美債20年(新名稱)', 800, 700, 1500],
  ]);
  assert.deepEqual(list[0].members, [['m1', 3000], ['m2', 1000]]);
});

test('點開某一檔：每一次配息一行，新的在上面；全家時同一次除權息的各成員加在一起', () => {
  const status = r => (r.pending ? { label: '待除權息', cls: 'pending', pending: true } : null);
  const rows = [
    row('0056', '元大高股息', '2026-05-14', 36000),
    row('0056', '元大高股息', '2026-11-11', 72240, { pending: true }),
    { ...row('0056', '元大高股息', '2026-08-10', 30000, { member: 'm1' }), id: 'd8' },
    { ...row('0056', '元大高股息', '2026-08-10', 24000, { member: 'm2' }), id: 'd8' },
    row('2884', '玉山金', '2026-08-20', 1200),
    row('0056', '元大高股息', '2026-12-01', null),
  ];
  const list = plain(Stats.payouts(rows, '0056', { ...keys, status }));
  assert.deepEqual(list.map(p => [p.date, p.amount, p.status?.label ?? '']), [
    ['2026-11-11', 72240, '待除權息'],
    ['2026-08-10', 54000, ''],
    ['2026-05-14', 36000, ''],
  ]);

  const closed = Stats.html(cfg, { rows, context: rows, period: '2026', expanded: false, members, showMembers: false, status, ...keys });
  assert.match(closed, /data-value="0056" aria-expanded="false"/);
  assert.doesNotMatch(closed, /rank-items/);
  const open = Stats.html(cfg, { rows, context: rows, period: '2026', expanded: false, open: new Set(['0056']), members, showMembers: false, status, ...keys });
  assert.match(open, /data-value="0056" aria-expanded="true"/);
  assert.match(open, /2026\/11\/11[\s\S]*待除權息[\s\S]*72,240[\s\S]*2026\/08\/10[\s\S]*54,000[\s\S]*2026\/05\/14/);
  assert.equal((open.match(/class="rank-item(?: pending)?"/g) || []).length, 3);
});

test('佔比：四捨五入到整數，太小的寫「<1%」', () => {
  assert.equal(Stats.pct(1, 3), '33%');
  assert.equal(Stats.pct(1, 300), '<1%');
  assert.equal(Stats.pct(0, 300), '0%');
});

test('畫面：前 3 檔佔比、圖例只在有待入帳時出現、超過 11 檔時其餘合成「其他 N 檔」', () => {
  const rows = Array.from({ length: 13 }, (_, i) =>
    row(String(1000 + i), `股票${i}`, '2026-08-12', (13 - i) * 100, { pending: i === 0 }));
  const html = Stats.html(cfg, { rows, context: rows, period: '2026', expanded: false, members, showMembers: false, ...keys });
  assert.match(html, /2026 年每月股息/);
  assert.match(html, /共 13 檔，前 3 檔佔 40%/); // (1300 + 1200 + 1100) ÷ 9100 = 39.6%
  assert.match(html, /已入帳.*待入帳/);
  assert.match(html, /其他 3 檔/);
  assert.equal((html.match(/data-act="code"/g) || []).length, 10);

  const all = Stats.html(cfg, { rows, context: rows, period: '2026', expanded: true, members, showMembers: false, ...keys });
  assert.doesNotMatch(all, /其他/);
  assert.equal((all.match(/data-act="code"/g) || []).length, 13);

  const paid = rows.map(r => ({ ...r, pending: false }));
  assert.doesNotMatch(Stats.html(cfg, { rows: paid, context: paid, period: '2026', expanded: false, members, showMembers: false, ...keys }), /待入帳/);
});

test('畫面：選了某個月時標出那個月；全家時列出每人各多少；全部算不出來時顯示說明', () => {
  const rows = [
    row('0056', '元大高股息', '2026-08-12', 3000, { member: 'm1' }),
    row('0056', '元大高股息', '2026-08-12', 1000, { member: 'm2' }),
  ];
  const html = Stats.html(cfg, { rows, context: rows, period: '2026-08', periodLabel: '2026/08', expanded: false, members, showMembers: true, ...keys });
  assert.match(html, /class="bar-row on" data-act="period" data-value="2026-08"/);
  assert.match(html, /2026\/08 · 共 1 檔/);
  assert.match(html, /爸爸 3,000 · 媽媽 1,000/);

  const none = [row('2330', '台積電', '2026-10-09', null)];
  assert.match(Stats.html(cfg, { rows: none, context: none, period: '', expanded: false, members, showMembers: false, ...keys }), /沒有算得出金額的股息/);
});
