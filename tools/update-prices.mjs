// 產生 shared/prices.json：每一檔最近一個交易日的收盤價和日 KD，行情頁的 KD、抓不到即時現價時的收盤價用（見 js/market.js）
//   上市：證交所「每日收盤行情」https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX（全部，不含權證、牛熊證）
//   上櫃：櫃買中心「上櫃股票每日收盤行情」https://www.tpex.org.tw/www/zh-tw/afterTrading/otc（所有證券，不含權證、牛熊證）
//     不用「上櫃股票行情」（afterTrading/dailyQuotes）：一定連權證一起回來，一天 2 MB 多，從 GitHub 抓要十幾分鐘
//   一次抓一天的全市場，從今天往回抓到湊滿 60 個交易日，每次都從頭算 KD（算法見 kd.mjs）
//     不用記上一次的結果：哪天沒更新到，下一次會自己補回來
//     KD 一天接一天算，第一天要假設前一天是 50；算了 50 天以上，和券商從上市第一天算起的已經一樣
//   GitHub 每個工作天收盤後自動執行，有變才存進 repo（見 .github/workflows/update-prices.yml）；App 打開時自己下載，不用改版本號
//     要馬上更新：GitHub 的 Actions →「更新收盤價和 KD」→ Run workflow（或 gh workflow run update-prices.yml）
//     本機也可以執行（node tools/update-prices.mjs，大約 4 分鐘），但不要自己推這個檔案，免得和 GitHub 推的衝突
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { kd } from './kd.mjs';

const OUT = new URL('../shared/prices.json', import.meta.url);
const DAYS = 60;
const DAY = 86400000;
const UA = { 'User-Agent': 'Mozilla/5.0' };
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
const wait = ms => new Promise(r => setTimeout(r, ms));
// 「1,215.00」→ 1215；沒有成交是「--」「---」→ null
const num = s => (/\d/.test(s ?? '') ? Number(String(s).replace(/[,\s]/g, '')) : null);

// 偶爾會有一次連線卡住、或回傳的不是 JSON（查太快被擋）：等一下再試，最多 3 次
async function getJSON(url, label) {
  for (let k = 1; ; k++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return JSON.parse(await res.text());
    } catch (e) {
      if (k >= 3) throw new Error(`${label}：${e.cause?.code || e.message}`);
      console.log(`${label} 失敗（${e.cause?.code || e.message}），20 秒後再試（第 ${k} 次）`);
      await wait(20000);
    }
  }
}

// 表格的欄位名稱 → 第幾欄（櫃買中心的欄位名稱前後有空白）；找不到就是網站改了格式
function columns(fields, names, label) {
  const at = names.map(n => fields.findIndex(f => String(f).trim() === n));
  if (at.some(i => i < 0)) throw new Error(`${label}：找不到「${names[at.findIndex(i => i < 0)]}」欄，網站格式可能改了`);
  return at;
}

// 一天的資料：[{ code, high, low, close }]；休市、資料還沒出來時回傳 null
async function twse(date) {
  const label = `證交所 ${date}`;
  const j = await getJSON(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${date.replace(/-/g, '')}&type=ALLBUT0999&response=json`, label);
  if (j.stat !== 'OK') return null; // 「很抱歉，沒有符合條件的資料!」
  const t = (j.tables || []).find(x => /每日收盤行情/.test(x.title || ''));
  if (!t) throw new Error(`${label}：找不到每日收盤行情，網站格式可能改了`);
  const [c, h, l, p] = columns(t.fields, ['證券代號', '最高價', '最低價', '收盤價'], label);
  return t.data.map(r => ({ code: String(r[c]).trim().toUpperCase(), high: num(r[h]), low: num(r[l]), close: num(r[p]) }));
}

// type=EW：不含權證、牛熊證；萬一又混進來，7 開頭的六碼（例如 710001、71234P）也不收
async function tpex(date) {
  const label = `櫃買中心 ${date}`;
  const j = await getJSON(`https://www.tpex.org.tw/www/zh-tw/afterTrading/otc?date=${date.replace(/-/g, '%2F')}&type=EW&response=json`, label);
  const t = (j.tables || [])[0];
  if (!t || !Array.isArray(t.data)) throw new Error(`${label}：找不到上櫃股票每日收盤行情，網站格式可能改了`);
  if (!t.data.length) return null; // 休市、資料還沒出來：0 筆
  const [c, h, l, p] = columns(t.fields, ['代號', '最高', '最低', '收盤'], label);
  return t.data
    .map(r => ({ code: String(r[c]).trim().toUpperCase(), high: num(r[h]), low: num(r[l]), close: num(r[p]) }))
    .filter(r => !/^7\d{4}[0-9A-Z]$/.test(r.code));
}

// ---------- 往回抓 60 個交易日（週末不抓；證交所查太快會被擋，每天之間停 3 秒） ----------
const bars = new Map(); // 代號 → 有成交的每一天，日期新的在前
const counts = [];      // 每個交易日：[日期, 上市幾檔, 上櫃幾檔]
for (let t = Date.parse(today), n = 0; counts.length < DAYS; t -= DAY) {
  if (++n > 120) throw new Error(`往回 120 天只找到 ${counts.length} 個交易日`);
  const date = new Date(t).toISOString().slice(0, 10);
  if ([0, 6].includes(new Date(t).getUTCDay())) continue;
  const [a, b] = await Promise.all([twse(date), tpex(date)]);
  await wait(3000);
  if (!a && !b) continue;
  const day = [...(a || []), ...(b || [])].filter(r => r.code && r.close !== null && r.high !== null && r.low !== null);
  day.forEach(r => {
    if (!bars.has(r.code)) bars.set(r.code, []);
    bars.get(r.code).push({ date, high: r.high, low: r.low, close: r.close });
  });
  counts.push([date, a ? a.length : 0, b ? b.length : 0]);
}
const latest = counts[0][0];
console.log(`${counts[counts.length - 1][0]} ～ ${latest} 共 ${counts.length} 個交易日`);
// 上市、上櫃各自最近有資料的那一天（下午執行時，櫃買中心的資料可能還沒出來）
[['上市', 1, 1000], ['上櫃', 2, 700]].forEach(([what, i, min]) => {
  const day = counts.find(c => c[i] > 0);
  console.log(`${what}：${day ? `${day[0]} ${day[i]} 檔` : '沒有資料'}`);
  if (!day || day[i] < min) throw new Error(`${what}只有 ${day ? day[i] : 0} 檔，太少了，可能沒抓完整`);
});

// ---------- 每一檔：最近一次成交的收盤價、今天和前一個交易日的 K、D ----------
const r2 = v => (v === null ? null : Math.round(v * 100) / 100);
const rows = [...bars.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([code, list]) => {
  const days = list.slice().reverse();
  const s = kd(days);
  const last = s.length - 1;
  const prev = s[last - 1] || { k: null, d: null };
  const row = [days[last].close, r2(s[last].k), r2(s[last].d), r2(prev.k), r2(prev.d)];
  if (days[last].date !== latest) row.push(days[last].date); // 最近一天沒有成交（暫停交易、櫃買中心的資料還沒出來）
  return [code, row];
});
for (const code of ['2330', '0050', '00878', '6488', '00679B']) {
  if (!rows.some(([c]) => c === code)) throw new Error(`資料裡沒有 ${code}，可能有問題`);
}

// 上一份：比這次多很多時不存（可能是網站出問題、只抓到一部分）
let prev = null;
try { prev = JSON.parse(readFileSync(OUT, 'utf8')); } catch (_) {}
const before = prev?.rows ? Object.keys(prev.rows).length : 0;
if (before && rows.length < before * 0.9) {
  throw new Error(`這次只有 ${rows.length} 檔，上一份有 ${before} 檔，少太多了，可能沒抓完整，先不存`);
}

mkdirSync(new URL('./', OUT), { recursive: true });
writeFileSync(OUT, `{
  "note": "收盤價和日 KD（9、3、3）：證交所每日收盤行情、櫃買中心上櫃股票行情，最近 ${DAYS} 個交易日算出來的。由 tools/update-prices.mjs 產生，GitHub 每個工作天收盤後自動更新，不要手動修改。每一檔：[收盤價, K, D, 前一個交易日的 K, 前一個交易日的 D]，成交不到 9 天的 K、D 是 null；date 那天沒有成交的，最後多一個最近一次成交的日期",
  "date": "${latest}",
  "rows": {
${rows.map(([c, r]) => `    ${JSON.stringify(c)}: ${JSON.stringify(r)}`).join(',\n')}
  }
}
`);
console.log(`共 ${rows.length} 檔，已寫入 shared/prices.json`);
