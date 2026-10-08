// EPS：行情的一頁（列表、「全部｜持有｜觀察｜全市場」、搜尋見 market.js），每一家公司今年的 EPS 跟去年全年比
//   資料：shared/eps.json（公開資訊觀測站的財報，由 tools/update-eps.mjs 產生），GitHub 每個工作天晚上自動更新，不用改版本號
//     App 打開時下載（load），從背景切回來、網路恢復時，距離上次超過 30 分鐘再檢查一次（refresh），和收盤價一樣（見 market.js）
//   達成率 = 今年累計 EPS ÷ 去年全年 EPS；進度 = 每過一季 25%（財報公布到第 2 季就是 50%）
//     達成率超過進度：今年賺得比去年快，紅色；落後：綠色（台股的習慣，和總覽的損益一樣）
//     達成率取到整數 %，超前幾 % = 達成率 − 進度（畫面上的數字直接相減，星星也照這個算，看到的和算的一樣）
//     例：去年全年 10 元，今年第 1 季 4 元 → 達成率 40%，進度 25%，超前 15%
//   照這速度全年 = 今年累計 ÷ 季數 × 4（之後的股利預估也用這個）
//   去年同期：去年累計到同一季的 EPS；旺季在下半年的公司，前幾季的達成率會一直落後，看這個分得出來
//   「今年」是有財報的最新一年：1～5 月今年第 1 季還沒公布時，還是去年（到第 3、4 季）跟前年比，卡片上寫出年份
//   只公布半年報的公司（第 1、3 季沒有），季數照最後一個有數字的季算
//   去年全年虧損（≤ 0）、沒有去年全年的（今年才上市、上櫃）：算不出達成率，不給星星
//   去年全年賺不到 0.5 元：基期很低，今年多賺一點達成率就上千 %，照算、照給星星，說明裡提醒參考就好
//   ETF、興櫃沒有 EPS，這一頁不列（列表上面寫出有幾檔沒列）
//   排序：超前多的在前（預設）、同期成長多的在前、依代號；算不出來的放最後
//   達成率超過進度、達到星星條件時，旁邊標 ★（見 stars.js）
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
  //     est: 照這速度全年, growth: 比去年同期多幾成（0.68 是多 68%）,
  //     years: [{ year, eps, q }] 每一年最後一個有數字的季，舊的在前 }
  //   last、same 沒有是 null；去年全年 ≤ 0 時 pct、ahead、rate 是 null；去年同期 ≤ 0 時 growth 是 null
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
    return {
      year, q, now, last, same, pct, pace, rate,
      ahead: pct === null ? null : pct - pace,
      est: U.round(now / q * 4, 2),
      growth: same > 0 ? now / same - 1 : null,
      years,
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

  function enrich(r) {
    return { ...r, e: Eps.info(r.code) };
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
  // 今年到第幾季、去年全年、照這速度全年（詳細頁也用）
  const cellsHTML = e => [
    cell(`${yearName(e.year)}到第 ${e.q} 季`, fmt(e.now)),
    cell(`${yearName(e.year - 1)}全年`, fmt(e.last)),
    cell('照這速度全年', fmt(e.est)),
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
      </div>`;
  }

  // 列表上面的說明：怎麼算、財報公布到哪一季、沒列出的有幾檔
  //   skipped：持股和觀察清單裡沒有 EPS 的（ETF、興櫃）；全市場不一檔一檔數
  function introHTML(all, wide, skipped = 0) {
    const how = '達成率 = 今年累計 EPS ÷ 去年全年 EPS。每過一季進度 25%，達成率超過進度是紅色（今年賺得比去年快），落後是綠色；長條上的刻度是進度。';
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
      ['code', '依代號', null],
    ],
    enrich, keep, cardHTML, introHTML, skippedHTML,
    barHTML, notes, cellsHTML, tone, // 詳細頁（detail.js）也用
  };
})();
