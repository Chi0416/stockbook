// 產生 js/dividendlist.js：公告的除權息（近 13 個月和之後已經公告的），新增除權息時一鍵帶入（見 announced.js）
//   ETF：證交所 ETF 配息 https://www.twse.com.tw/zh/ETFortune/dividendList（只有上市 ETF，網頁表格）
//   個股：公開資訊觀測站「除權息公告」https://mopsov.twse.com.tw/mops/web/t108sb27（上市、上櫃，依公告的月份查）
//   用法：node tools/update-dividends.mjs（大約 2 分鐘，公開資訊觀測站每次查詢之間要等一下）
//   更新後要改 index.html 的版本號（見 tests/version.test.mjs），手機上才會重新下載
//   ETF 常常先公告日期、除息前幾天才公告金額：還沒除息、金額待公告的也收（金額是 null，表單上只帶入日期）
//   不收：只配股沒有現金的（公告裡沒有發放日）
import { writeFileSync } from 'node:fs';

const OUT = new URL('../js/dividendlist.js', import.meta.url);
const UA = { 'User-Agent': 'Mozilla/5.0' };
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
const [y, m] = today.split('-').map(Number);
const iso = (yy, mm, dd = 1) => `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
// 除權息日在這一天以後的才收（13 個月前）
const since = iso(m === 1 ? y - 2 : y - 1, m === 1 ? 12 : m - 1, Number(today.slice(8)));
const wait = ms => new Promise(r => setTimeout(r, ms));
const text = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[\s　]+/g, ' ').trim();
const cells = tr => [...tr.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(c => text(c[1]));
const num = s => Number(String(s).replace(/,/g, '')) || 0;

// 偶爾會有一次連線卡住：等一下再試，最多 3 次
async function get(url, opts = {}, label = url) {
  for (let k = 1; ; k++) {
    try {
      const res = await fetch(url, { ...opts, headers: { ...UA, ...opts.headers }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (k >= 3) throw new Error(`${label}：${e.cause?.code || e.message}`);
      console.log(`${label} 連線失敗，10 秒後再試（第 ${k} 次）`);
      await wait(10000);
    }
  }
}

// 民國年的日期：「115年10月22日」「115/10/22」→ 2026-10-22
function roc(s) {
  const d = String(s).match(/(\d{2,3})\D+(\d{1,2})\D+(\d{1,2})/);
  return d ? iso(Number(d[1]) + 1911, Number(d[2]), Number(d[3])) : '';
}

// ---------- ETF：去年和今年 ----------
async function etf() {
  const html = await get(`https://www.twse.com.tw/zh/ETFortune/dividendList?stkNo=&startDate=${y - 1}&endDate=${y}`, {}, 'ETF 配息');
  const rows = [];
  for (const [, tr] of html.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)) {
    // 證券代號、證券簡稱、除息交易日、收益分配基準日、收益分配發放日、收益分配金額、收益分配金標準、公告年度
    const c = cells(tr);
    if (c.length < 8 || !/^[0-9A-Z]{4,6}$/.test(c[0])) continue;
    // 金額空白是還沒公告（null）；0 的不收
    const cash = c[5] === '' ? null : num(c[5]);
    if (cash === null || cash > 0) rows.push({ code: c[0], name: c[1], exDate: roc(c[2]), payDate: roc(c[4]), cash, stock: 0, at: '' });
  }
  if (rows.length < 300) throw new Error(`ETF 配息只讀到 ${rows.length} 筆，網頁格式可能改了`);
  console.log(`ETF ${rows.length} 筆`);
  return rows;
}

// ---------- 個股：近 15 個月的公告（除權息日通常在公告後一、兩個月） ----------
//   每一列：代號、名稱、股利所屬期間、權利分派基準日、盈餘轉增資配股、公積轉增資配股、除權交易日、
//           盈餘分配之現金股利、公積發放之現金、特別股現金股利、除息交易日、現金股利發放日、……、公告日期、公告時間、面額
async function mops(typek, yy, mm) {
  const body = `encodeURIComponent=1&step=1&firstin=1&off=1&TYPEK=${typek}&year=${yy - 1911}&month=${mm}&b_date=&e_date=&type=`;
  const html = await get('https://mopsov.twse.com.tw/mops/web/ajax_t108sb27', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  }, `公開資訊觀測站 ${typek === 'sii' ? '上市' : '上櫃'} ${yy}/${mm}`);
  if (/查詢過於頻繁|頻繁/.test(html)) throw new Error('公開資訊觀測站說查詢太頻繁，等一下再執行');
  return [...html.matchAll(/<tr class='(?:even|odd)'>(.*?)<\/tr>/gs)].map(([, tr]) => cells(tr)).filter(c => c.length >= 19)
    .map(c => ({
      code: c[0].toUpperCase(), name: c[1],
      exDate: roc(c[10]), payDate: roc(c[11]),
      cash: Math.round((num(c[7]) + num(c[8])) * 1e6) / 1e6,
      stock: Math.round((num(c[4]) + num(c[5])) * 1e6) / 1e6,
      at: `${roc(c[16])} ${c[17]}`,
    }));
}

async function stocks() {
  const rows = [];
  for (let k = 14; k >= 0; k--) {
    const d = new Date(y, m - 1 - k, 1);
    for (const typek of ['sii', 'otc']) {
      rows.push(...await mops(typek, d.getFullYear(), d.getMonth() + 1));
      await wait(3000);
    }
  }
  const usable = rows.filter(r => r.cash > 0 && r.exDate && r.payDate);
  if (usable.length < 500) throw new Error(`個股只讀到 ${usable.length} 筆，網頁格式可能改了`);
  console.log(`個股 ${usable.length} 筆（全部公告 ${rows.length} 筆）`);
  return usable;
}

// 同一檔同一天除權息出現好幾次（更正公告）時，用最新的那一次
const byEvent = new Map();
for (const r of [...await etf(), ...await stocks()]) {
  if (!r.exDate || !r.payDate || r.exDate < since) continue;
  if (r.cash === null && r.exDate < today) continue; // 已經除息還沒有金額的不收
  const key = `${r.code} ${r.exDate}`;
  if (!byEvent.has(key) || r.at >= byEvent.get(key).at) byEvent.set(key, r);
}
for (const code of ['0056', '2330']) {
  if (![...byEvent.values()].some(r => r.code === code)) throw new Error(`資料裡沒有 ${code}，可能有問題`);
}

const list = [...byEvent.values()].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.exDate < b.exDate ? 1 : -1));
const lines = list.map(r => `    ${JSON.stringify([r.code, r.name, r.exDate, r.payDate, r.cash, r.stock])},`);
writeFileSync(OUT, `// 公告的除權息：證交所 ETF 配息、公開資訊觀測站除權息公告（除權息日在 ${since} 以後）
//   由 tools/update-dividends.mjs 產生，不要手動修改；新增除權息時一鍵帶入（見 announced.js）
//   每一筆：[代號, 名稱, 除權息日, 發放日, 每股現金股利（還沒公告時是 null）, 每股股票股利（元）]
const DIVIDEND_LIST = {
  updated: '${today}',
  rows: [
${lines.join('\n')}
  ],
};
`);
console.log(`共 ${list.length} 筆（金額待公告 ${list.filter(r => r.cash === null).length} 筆），已寫入 js/dividendlist.js`);
