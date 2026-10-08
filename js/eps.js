// EPS：行情的一頁（列表、「全部｜持有｜觀察｜全市場」、搜尋見 market.js），每一家公司今年的 EPS 跟去年全年比
//   資料：shared/eps.json（公開資訊觀測站的財報，由 tools/update-eps.mjs 產生），GitHub 每個工作天晚上自動更新，不用改版本號
//     App 打開時下載（load），從背景切回來、網路恢復時，距離上次超過 30 分鐘再檢查一次（refresh），和收盤價一樣（見 market.js）
//   達成率 = 今年累計 EPS ÷ 去年全年 EPS；進度 = 每過一季 25%（財報公布到第 2 季就是 50%）
//     達成率超過進度：今年賺得比去年快，紅色；落後：綠色（台股的習慣，和總覽的損益一樣）
//     達成率取到整數 %，超前幾 % = 達成率 − 進度（畫面上的數字直接相減，星星也照這個算，看到的和算的一樣）
//     例：去年全年 10 元，今年第 1 季 4 元 → 達成率 40%，進度 25%，超前 15%
//   預估全年 EPS = 今年累計 ÷ 季數 × 4（股利預估也用這個；畫面上一定寫出「EPS」，不然看不出是什麼）
//   去年同期：去年累計到同一季的 EPS；旺季在下半年的公司，前幾季的達成率會一直落後，看這個分得出來
//   「今年」是有財報的最新一年：1～5 月今年第 1 季還沒公布時，還是去年（到第 3、4 季）跟前年比，卡片上寫出年份
//   只公布半年報的公司（第 1、3 季沒有），季數照最後一個有數字的季算
//   去年全年虧損（≤ 0）、沒有去年全年的（今年才上市、上櫃）：算不出達成率，不給星星
//   去年全年賺不到 0.5 元：基期很低，今年多賺一點達成率就上千 %，照算、照給星星，說明裡提醒參考就好
//   ETF、興櫃沒有 EPS，這一頁不列（列表上面寫出有幾檔沒列）
//   排序：超前多的在前（預設）、同期成長多的在前、依代號；算不出來的放最後
//   達成率超過進度、達到星星條件時，旁邊標 ★（見 stars.js）
//
// 股利預估：用今年的 EPS 推算今年賺的錢會配多少現金股利（年配的通常隔年發），提前佈局
//   預估配 = 預估全年 EPS × 近 3 年配息率；預估殖利率 = 預估配 ÷ 現價
//   配息率 = 近 3 年配的現金股利加起來 ÷ 近 3 年 EPS 加起來（股利照所屬年度，季配、半年配的加成一整年）
//     不直接把三年的比率平均：某一年 EPS 很低時（賺 0.05 配 1 元，那年 2000%），平均會被拉得很誇張
//     「近 3 年」：今年以前、全年 EPS 是正的、那一年度的股利都決議了的，最近 3 年；虧損、還沒決議的年往前找，不夠 3 年就用有的
//     只算現金股利，配股不算
//     配息率超過 150%：配的比賺的多很多（多半是拿公積、以前的盈餘來配，跟 EPS 沒什麼關係），估了也不準，不估、寫原因
//       例：三圓近幾年只有 2024 年能算，EPS 0.1 元配 1 元，配息率 1000%，照算會變成預估配 77 元
//   今年的股利已經決議了一部分（季配、半年配）：寫出已決議多少，預估的還是全年
//   今年的股利整年都決議了（年配的隔年 3～5 月董事會決議後）：不用估，直接寫已決議多少
//   卡片上只寫一行結果；怎麼算的（每一年的 EPS、配多少、配息率）在詳細頁（見 detail.js）
//   預估殖利率 15% 以上：多半是今年 EPS 衝很高（可能有一次性的收入，例如賣土地），× 4 之後被放大，照算、加一句參考就好
const Eps = (() => {
  const FILE = 'shared/eps.json';
  const AGAIN = 30 * 60000;
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();

  // 測試時直接放一份全域的 EPS_LIST，不用下載
  let data = typeof EPS_LIST !== 'undefined' ? EPS_LIST : null;
  let state = data ? 'ready' : 'loading';
  let text = '';      // 上次下載到的內容，一樣的就不通知
  let lastTry = 0;
  let pending = null; // 下載中（同時只下載一次）
  let cache = null;   // 這一份資料公布到第幾季（latest）
  const listeners = [];

  // 下載 EPS：有新的資料、或第一次就下載失敗時通知 onChange；下載失敗、格式不對時留著原本的資料
  function load() {
    if (pending) return pending;
    lastTry = Date.now();
    const get = async mode => {
      try {
        const res = await fetch(FILE, { cache: mode });
        return res.ok ? await res.text() : null;
      } catch (_) {
        return null;
      }
    };
    pending = (async () => {
      const got = (await get('no-cache')) ?? (await get('force-cache'));
      let changed = false;
      if (got !== null && got !== text) {
        try {
          const next = JSON.parse(got);
          if (typeof next.updated === 'string' && next.rows && typeof next.rows === 'object') {
            data = next;
            cache = null;
            text = got;
            state = 'ready';
            changed = true;
          }
        } catch (_) {}
      }
      if (!data && state !== 'failed') {
        state = 'failed';
        changed = true;
      }
      pending = null;
      if (changed) listeners.forEach(fn => fn());
      return changed;
    })();
    return pending;
  }

  // 從背景切回來、網路恢復時：還沒下載成功的馬上再試，下載過的隔 30 分鐘才再檢查
  const refresh = () => (state !== 'ready' || Date.now() - lastTry >= AGAIN ? load() : Promise.resolve(false));

  // 最後一個有數字的季：[EPS, 第幾季]；一個都沒有是 null
  function lastOf(list) {
    for (let i = (list || []).length - 1; i >= 0; i--) if (typeof list[i] === 'number') return [list[i], i + 1];
    return null;
  }

  // 一家公司的 EPS：資料裡沒有（ETF、興櫃）時回傳 null
  //   { year: 今年（有財報的最新一年）, q: 公布到第幾季, now: 今年累計, last: 去年全年, same: 去年同期,
  //     pct: 達成率（整數 %）, pace: 進度 %, ahead: 超前幾 %（落後是負的）, rate: 達成率（沒取整數，排序用）,
  //     est: 預估全年 EPS, growth: 比去年同期多幾成（0.68 是多 68%）,
  //     years: [{ year, eps, q }] 每一年最後一個有數字的季，舊的在前 }
  //   last、same 沒有是 null；去年全年 ≤ 0 時 pct、ahead、rate 是 null；去年同期 ≤ 0 時 growth 是 null
  //   fc：股利預估（見 forecast）
  function info(code) {
    const r = data?.rows[key(code)];
    if (!r) return null;
    const years = Object.keys(r.eps).map(Number).sort((a, b) => a - b)
      .map(y => {
        const l = lastOf(r.eps[y]);
        return l && { year: y, eps: l[0], q: l[1] };
      })
      .filter(Boolean);
    if (!years.length) return null;
    const { year, eps: now, q } = years[years.length - 1];
    const prev = r.eps[year - 1] || [];
    const last = prev.length === 4 && typeof prev[3] === 'number' ? prev[3] : null;
    const same = typeof prev[q - 1] === 'number' ? prev[q - 1] : null;
    const rate = last > 0 ? now / last : null;
    const pct = rate === null ? null : Math.round(rate * 100);
    const pace = q * 25;
    const est = U.round(now / q * 4, 2);
    return {
      year, q, now, last, same, pct, pace, rate, est,
      ahead: pct === null ? null : pct - pace,
      growth: same > 0 ? now / same - 1 : null,
      years,
      fc: forecast(r, year, est),
    };
  }

  // 股利預估：{ years: 算配息率用的那幾年 [{ year, eps, cash, ratio }]（舊的在前）, payout: 配息率（沒有能算的年是 null）,
  //   base: 用哪個 EPS 估（預估全年 EPS；第 4 季公布了就是全年）, cash: 預估配多少（估不出來是 null；今年虧損是 0）,
  //   wild: 配息率超過 150%，不估（cash 是 null）,
  //   decided: 今年已決議的現金股利（還沒決議是 null）, decidedQ: 已決議的涵蓋幾季, done: 整年都決議了 }
  const MAX_PAYOUT = 1.5;
  function forecast(r, year, base) {
    const years = Object.keys(r.eps).map(Number).sort((a, b) => a - b)
      .filter(y => y < year && r.eps[y].length === 4 && r.eps[y][3] > 0 && r.div[y]?.[2] >= 4)
      .slice(-3)
      .map(y => ({ year: y, eps: r.eps[y][3], cash: r.div[y][0], ratio: r.div[y][0] / r.eps[y][3] }));
    const sumEps = years.reduce((s, y) => s + y.eps, 0);
    const payout = years.length ? years.reduce((s, y) => s + y.cash, 0) / sumEps : null;
    const d = r.div[year];
    const wild = payout !== null && payout > MAX_PAYOUT;
    return {
      years, payout, base, wild,
      cash: payout === null || wild ? null : U.round(Math.max(0, base) * payout, 2),
      decided: d ? d[0] : null,
      decidedQ: d ? d[2] : 0,
      done: !!d && d[2] >= 4,
    };
  }

  // 財報公布到哪一季：{ year, q: 九成的公司公布到第幾季, more: 有公司已經公布了下一季 }
  //   公司是陸續公布的：一季的期限前幾週，早公布的公司已經有資料了
  function latest() {
    if (cache || !data) return cache;
    const all = Object.values(data.rows);
    const year = Math.max(...all.flatMap(r => Object.keys(r.eps).map(Number)));
    const qs = all.map(r => lastOf(r.eps[year])?.[1] || 0).filter(Boolean).sort((a, b) => b - a);
    const q = qs[Math.floor(qs.length * 0.9)] || qs[qs.length - 1] || 0;
    cache = { year, q, more: qs[0] > q };
    return cache;
  }

  // EPS 還沒下載好、下載不了時的說明（下載好了是 ''）
  const waiting = () => (state === 'ready' ? '' : state === 'failed' ? '下載不了 EPS（連上網路後會再試）' : 'EPS 還在下載');

  return {
    info, latest, waiting, load, refresh,
    updated: () => (data ? data.updated : ''),
    state: () => state,
    ready: () => state === 'ready',
    onChange: fn => listeners.push(fn),
  };
})();

// EPS 這一頁（列表見 market.js 的 createMarket）
const EPS_PAGE = (() => {
  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
  const fmt = v => (typeof v === 'number' ? U.fmtNum(v, 2) : '—');
  // 今年、去年寫「今年」「去年」，其他的寫年份（1～5 月看的還是去年跟前年比）
  const yearName = y => {
    const now = Number(U.today().slice(0, 4));
    return y === now ? '今年' : y === now - 1 ? '去年' : `${y} 年`;
  };
  // 超前紅色、落後綠色；剛好跟上、算不出來不上色
  const tone = e => (e?.ahead > 0 ? 'up' : e?.ahead < 0 ? 'down' : '');
  // 大的在前，算不出來（null）的放最後
  const desc = f => (a, b) => {
    const x = f(a);
    const y = f(b);
    return (x === null) - (y === null) || (x === null ? 0 : y - x);
  };

  // 股利：小數點後最多兩位（5.51、36.5）；殖利率：兩位小數的 %（和殖利率頁一樣）
  const money = v => U.fmtNum(U.round(v, 2));
  const pct = n => `${U.fmtNum(U.round(n * 100, 2), 2)}%`;

  // e：Eps.info；fy：預估殖利率（今年整年都決議了就用決議的；沒有現價、估不出來是 null）
  function enrich(r) {
    const e = Eps.info(r.code);
    const f = e?.fc;
    const cash = !f ? null : f.done ? f.decided : f.cash;
    const { price } = Market.quote(r.code);
    return { ...r, e, fy: cash !== null && price > 0 ? cash / price : null };
  }

  // 預估殖利率到這麼高，加一句提醒（還沒決議的才提醒；決議了的就是真的）
  const HIGH_YIELD = 0.15;
  const fcWarn = r => (r.fy >= HIGH_YIELD && !r.e?.fc?.done
    ? '預估殖利率特別高：多半是今年 EPS 衝很高（可能有一次性的收入），參考就好' : '');

  // 股利預估那一行（卡片最下面、詳細頁）：「預估配 5.51 元・預估殖利率 4.80%」；估不出來時寫原因
  function fcText(r) {
    const f = r.e?.fc;
    if (!f) return '';
    const name = yearName(r.e.year);
    const yld = r.fy === null ? '' : `・${f.done ? '殖利率' : '預估殖利率'} ${pct(r.fy)}${f.done ? '（以現價算）' : ''}`;
    const part = f.decided === null ? '' : `已決議 ${money(f.decided)} 元`;
    if (f.done) return `${name}賺的已決議配 ${money(f.decided)} 元${yld}`;
    if (f.payout === null) return `估不出股利（近幾年沒有賺錢又決議配息的資料）${part ? `；${part}` : ''}`;
    if (f.wild) return `近 ${f.years.length} 年配的比賺的多很多（配息率 ${U.fmtNum(Math.round(f.payout * 100))}%，多半是拿公積來配），估不準，不估${part ? `；${part}` : ''}`;
    if (r.e.est <= 0) return `${name}到目前虧損，照這樣估不會配現金${part ? `；${part}` : ''}`;
    if (!f.cash) return `近 ${f.years.length} 年都沒配現金股利`;
    return `預估${part ? '全年' : ''}配 ${money(f.cash)} 元${part ? `（${part}）` : ''}${yld}`;
  }

  // 這一頁只列有 EPS 的（EPS 還沒下載好時先全部列，卡片上寫還在下載）
  const keep = r => !Eps.ready() || !!r.e;

  // 去年全年賺不到這麼多：基期很低，達成率容易很誇張
  const LOW_BASE = 0.5;

  // 進度條：長條是達成率（超過 100% 畫滿），刻度是進度
  function barHTML(e) {
    if (!e || e.pct === null) return '';
    const w = Math.max(0, Math.min(100, e.pct));
    return `<span class="eps-bar ${tone(e)}" aria-hidden="true"><span class="eps-fill" style="width:${w}%"></span><span class="eps-pace" style="left:${e.pace}%"></span></span>`;
  }

  // 卡片下面的說明：進度、超前或落後幾 %，去年同期；算不出達成率的原因
  function notes(e) {
    if (!e) return [Eps.waiting() || '沒有 EPS（ETF、興櫃沒有）'];
    const out = [];
    const upTo = `到第 ${e.q} 季`;
    const prevName = yearName(e.year - 1);
    if (e.last === null) {
      out.push(`沒有${prevName}全年的 EPS（${e.year} 年才上市、上櫃的常這樣），算不出達成率`);
    } else if (e.last <= 0) {
      out.push(`${prevName}全年虧損（${fmt(e.last)}），算不出達成率${e.now > 0 ? `；${yearName(e.year)}${upTo}已經賺 ${fmt(e.now)}` : ''}`);
    } else {
      const how = e.ahead > 0 ? `超前 ${e.ahead}%` : e.ahead < 0 ? `落後 ${-e.ahead}%` : '剛好跟上';
      out.push(`進度 ${e.pace}%（${upTo}，每季 25%），${how}${e.pct > 100 ? '；已經超過' + prevName + '全年' : ''}`);
      if (e.last < LOW_BASE) out.push(`${prevName}全年只賺 ${fmt(e.last)}，基期很低，達成率容易很誇張，參考就好`);
    }
    if (e.same !== null) {
      const g = e.growth === null ? (e.same < 0 ? '（虧損）' : '')
        : `，${yearName(e.year)}${e.growth >= 0 ? '多' : '少'} ${U.fmtNum(Math.abs(Math.round(e.growth * 100)))}%`;
      out.push(`${prevName}同期（${upTo}）${fmt(e.same)}${g}`);
    }
    return out;
  }

  const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
  // 今年到第幾季、去年全年、預估全年 EPS（詳細頁也用）
  const cellsHTML = e => [
    cell(`${yearName(e.year)}到第 ${e.q} 季`, fmt(e.now)),
    cell(`${yearName(e.year - 1)}全年`, fmt(e.last)),
    cell('預估全年 EPS', fmt(e.est)),
  ].join('');

  function cardHTML(r) {
    const { e } = r;
    const tag = holdTagsHTML(r);
    return `
      <div class="card eps-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tag ? `<span class="card-tags">${tag}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>達成率${Stars.mark(r, 'eps')}</small><b class="eps-pct ${tone(e)}">${e?.pct == null ? '—' : `${e.pct}%`}</b></span>
        </span>
        ${barHTML(e)}
        ${e ? `<span class="card-grid">${cellsHTML(e)}</span>` : ''}
        ${notes(e).map(n => `<span class="card-note">${U.esc(n)}</span>`).join('')}
        ${e ? `<span class="card-note fc">${U.esc(fcText(r))}</span>` : ''}
        ${fcWarn(r) ? `<span class="card-note">${fcWarn(r)}</span>` : ''}
      </div>`;
  }

  // 列表上面的說明：怎麼算、財報公布到哪一季、沒列出的有幾檔
  //   skipped：持股和觀察清單裡沒有 EPS 的（ETF、興櫃）；全市場不一檔一檔數
  function introHTML(all, wide, skipped = 0) {
    const how = '達成率 = 今年累計 EPS ÷ 去年全年 EPS，超過進度（每季 25%，長條上的刻度）紅色、落後綠色。' +
      '預估配 = 預估全年 EPS × 近 3 年配息率，點一檔看怎麼算的。';
    const parts = [];
    const l = Eps.latest();
    if (!Eps.ready()) parts.push(Eps.waiting());
    else if (l) {
      // 下一季什麼時候公布（一般公司的期限，金融業有些晚一點）；已經有公司公布了寫「陸續」
      const next = l.q === 4 ? `${l.year + 1} 年第 1 季 5/15` : l.q === 3 ? `全年 ${l.year + 1}/3/31` : `第 ${l.q + 1} 季 ${['', '8/14', '11/14'][l.q]}`;
      parts.push(`財報公布到 ${l.year} 年第 ${l.q} 季，${next} 前${l.more ? '陸續' : ''}公布`);
      if (Eps.updated()) parts.push(`${md(Eps.updated())} 更新`);
    }
    if (wide) parts.push('全市場只列有 EPS 的公司');
    else if (skipped) parts.push(`另有 ${skipped} 檔沒有 EPS（ETF、興櫃），沒有列出`);
    return `<p class="list-intro">${how}${parts.length ? `<br>${U.esc(parts.join('；'))}` : ''}</p>`;
  }

  // 列出來的都沒有 EPS 時（持股和觀察清單都是 ETF、搜尋到的都是 ETF），列表上的那句話
  const skippedHTML = (n, wide) => (wide ? `符合的 ${n} 檔都沒有 EPS（ETF、興櫃沒有）`
    : `這裡的 ${n} 檔都沒有 EPS（ETF、興櫃沒有）<br>可以切到「全市場」看上市、上櫃的公司`);

  return {
    title: 'EPS',
    sorts: [
      ['ahead', '依超前進度', desc(r => (r.e?.rate == null ? null : r.e.rate * 100 - r.e.pace))],
      ['growth', '依同期成長', desc(r => r.e?.growth ?? null)],
      ['fyield', '依預估殖利率', desc(r => r.fy)],
      ['code', '依代號', null],
    ],
    enrich, keep, cardHTML, introHTML, skippedHTML,
    barHTML, notes, cellsHTML, tone, fcText, fcWarn, money, pct, yearName, // 詳細頁（detail.js）也用
  };
})();
