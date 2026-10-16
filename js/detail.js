// 一檔股票的詳細資料：看股票的頁（股利的殖利率、EPS，行情的每一頁）點一檔打開（從底部彈出，和新增表單一樣）
//   最上面：上一檔、下一檔（照點進來那一頁的列表順序，捲下去也一直在最上面；從總覽、除權息點進來的沒有）
//     持有或觀察、星星（達標的條件，見 stars.js）；還沒在觀察清單的，星星右邊有「加入觀察清單」，一打開就看得到
//   下面一次滑完，順序：技術面 → 籌碼面 → 基本面（不另外加「技術面」這種分區的標題，免得變長）
//     K 線 → KD → 殖利率 → EPS → 股利預估 → 我的 → 配息紀錄
//     從殖利率、EPS 點進來直接捲到那一段，翻上一檔、下一檔也停在那一段；從 K 線、KD、星星點進來停在最上面
//     K 線：一張小圖（最近 20 天和月線，見 MA.miniHTML）和現價、月線的方向、扣低幾天（用現價算），點了打開大圖（月線扣抵，見 kline.js）
//       殖利率不在最上面了，現價寫在這一行，一打開就看得到
//       K 線資料比較大，打開詳細頁才下載（見 candles.js），下載好了只重畫這一段（app.js 叫 refreshKLine）
//     殖利率：現在買殖利率多少；下面股利預估的預估殖利率好對照
//     EPS 下面多一排近 5 年每一年的 EPS（今年還不到第 4 季的寫到第幾季）；ETF、興櫃沒有 EPS，EPS 和股利預估都不顯示
//     股利預估：用 EPS 算的，接在 EPS 後面；預估配、預估殖利率、配息率、用哪個 EPS 估，下面列出算配息率的那幾年（新的在上面），算法見 eps.js
//     我的：目前持股（跟著設定裡勾的成員，好幾位時寫出每人的股數）、市值、損益試算、領到的股利；隱藏金額時顯示 ***
//       放在配息紀錄正上面：領到多少和每次配多少上下並排，好對照
//     配息紀錄：公告的除權息加上自己記的（Yield.events），新的在前；一長串，放最下面
//   和行情頁同樣的算法（YIELD_PAGE、KD_PAGE、EPS_PAGE），達到星星條件的數字旁邊標 ★
//   已經在觀察清單的，最下面可以從觀察清單移除（放最下面，免得誤按；觀察清單全家共用）
const Detail = (() => {
  const dlg = document.getElementById('stock-sheet');
  // 瀏覽器還拿著舊版 index.html（沒有這個 sheet）時什麼都不做
  if (!dlg) return { init() {}, open() {}, refresh() {}, refreshKLine() {} };
  const titleEl = dlg.querySelector('.sheet-title');
  const bodyEl = dlg.querySelector('.sheet-body');
  // 從哪一頁點進來時捲到哪一段（data-sec）；沒寫的停在最上面
  const SECTION = { yield: 'yield', eps: 'eps', etfs: 'etf' };
  let code = null;
  let codes = [];   // 上一檔、下一檔的順序
  let from = '';    // 從哪一頁點進來（app.js 的頁名）
  let klPrice = null; // K 線那一段用的現價
  let hooks = { toast() {}, onChanged() {} };

  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
  const pct = n => (typeof n === 'number' ? `${U.fmtNum(U.round(n * 100, 2), 2)}%` : '—');
  const fmt = v => (typeof v === 'number' ? U.fmtNum(v, 2) : '—');
  const money = n => Privacy.num(U.fmtNum(Math.round(n)));
  const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
  const notesHTML = list => list.map(n => `<span class="card-note">${U.esc(n)}</span>`).join('');

  function init(h) {
    hooks = h;
  }

  // c：哪一檔；list：上一檔、下一檔的順序（點進來那一頁的列表），沒有就不顯示；at：從哪一頁點進來
  function open(c, { list = [], at = '' } = {}) {
    codes = list.map(key);
    from = at;
    code = key(c);
    Candles.need();
    render();
    if (!dlg.open) dlg.showModal();
    toSection(); // 要先打開才量得到位置
  }

  // 翻到上一檔、下一檔
  function go(c) {
    code = key(c);
    render();
    toSection();
  }

  // 捲到點進來那一頁的那一段，標題剛好在上一檔、下一檔那一排下面；沒有那一段（例如 ETF 沒有 EPS）就回到最上面
  function toSection() {
    const sec = SECTION[from] && bodyEl.querySelector(`[data-sec="${SECTION[from]}"]`);
    const nav = bodyEl.querySelector('.detail-nav');
    bodyEl.scrollTop = 0;
    if (sec) bodyEl.scrollTop = sec.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top - (nav ? nav.offsetHeight : 0) - 4;
  }

  // 資料變了（同步、隱藏金額、觀察清單）：開著的話重畫
  function refresh() {
    if (dlg.open) render();
  }

  // 我的：持股和領到的股利；都沒有時只寫一句
  function mineHTML(pos, price) {
    const today = U.today();
    const divs = VIEWS.cashDividends.rows().filter(r => key(r.code) === code && r.net !== null);
    const paid = divs.filter(r => r.payDate && r.payDate <= today);
    const thisYear = paid.filter(r => r.payDate.startsWith(today.slice(0, 4)));
    const pending = divs.filter(r => r.payDate > today);
    const sum = rows => rows.reduce((s, r) => s + r.net, 0);
    if (!pos && !divs.length) return '<p class="note muted">目前沒有持有，也還沒有領過股利</p>';

    let html = '';
    if (pos) {
      const value = price ? pos.shares * price : null;
      const pl = value === null ? null : Math.round(value) - Math.round(pos.cost);
      const tone = Privacy.hidden || !pl ? '' : pl > 0 ? 'up' : 'down';
      const rate = pl !== null && pos.cost > 0 ? Privacy.num(`${U.fmtNum(U.round(pl / pos.cost * 100, 2), 2)}%`) : '—';
      const each = pos.parts && Store.members().length > 1
        ? pos.parts.map(x => `${Store.memberName(x.member)} ${Privacy.num(U.fmtNum(x.shares))} 股`).join(' · ') : '';
      html += `
        <span class="card-grid">
          ${cell('股數', Privacy.num(U.fmtNum(pos.shares)))}
          ${cell('成本均價', Privacy.num(U.fmtNum(U.round(pos.cost / pos.shares, 2), 2)))}
          ${cell('付出成本', money(pos.cost))}
          ${cell('市值', value === null ? '—' : money(value))}
          ${cell('損益試算', pl === null ? '—' : Privacy.num(U.fmtNum(pl)), tone)}
          ${cell('報酬率', rate, tone)}
        </span>
        ${each ? `<span class="card-note">${U.esc(each)}</span>` : ''}`;
    } else {
      html += '<span class="card-note">目前沒有持有</span>';
    }
    if (divs.length) {
      html += `
        <span class="card-grid">
          ${cell('今年領到', `${money(sum(thisYear))} 元`)}
          ${cell('一共領到', `${money(sum(paid))} 元`)}
          ${pending.length ? cell('還沒入帳', `${money(sum(pending))} 元`) : ''}
        </span>`;
    }
    return html;
  }

  // EPS：達成率、今年到第幾季、去年全年、預估全年 EPS，進度條和說明，最下面近 5 年每一年的 EPS（新的在左邊）
  //   EPS 還沒下載好時寫原因；下載好了、這檔沒有 EPS（ETF、興櫃）時整段不顯示
  function epsHTML(r) {
    const { e } = r;
    if (!e) {
      const why = Eps.waiting();
      return why ? `<h3 class="section-head" data-sec="eps">EPS</h3><p class="note muted">${U.esc(why)}</p>` : '';
    }
    const tone = EPS_PAGE.tone(e);
    // 一排五年：上面年份、下面 EPS，新的在左邊；還不到第 4 季的在數字下面寫到第幾季；虧損綠色
    const years = [...e.years].reverse().map(y => cell(`${y.year}`, `${fmt(y.eps)}${y.q < 4 ? `<small>到第 ${y.q} 季</small>` : ''}`, y.eps < 0 ? 'down' : '')).join('');
    return `
      <h3 class="section-head" data-sec="eps">EPS</h3>
      <div class="card static detail-card eps-card">
        <span class="card-grid">
          ${cell(`達成率${Stars.mark(r, 'eps')}`, e.pct === null ? '—' : `${e.pct}%`, `strong ${tone}`)}
          ${EPS_PAGE.cellsHTML(e)}
        </span>
        ${EPS_PAGE.barHTML(e)}
        ${notesHTML(EPS_PAGE.notes(e))}
        <span class="card-grid eps-years">${years}</span>
      </div>`;
  }

  // 股利預估：上面四格照計算的順序：預估全年 EPS × 配息率 = 預估配，÷ 現價 = 預估殖利率；中間每一年怎麼算的，下面說明
  //   今年整年都決議了：寫已決議配多少，不用估；估不出來時只寫原因
  function fcHTML(r) {
    const { e } = r;
    const f = e?.fc;
    if (!f) return '';
    const P = EPS_PAGE;
    const name = P.yearName(e.year);
    const head = '<h3 class="section-head">股利預估</h3>';
    // 估不出來、今年虧損、從來不配：只寫原因；配息率太高不估的，照樣列出每一年，看得到為什麼
    if (!f.done && (f.payout === null || e.est <= 0 || f.cash === 0)) {
      return `${head}<p class="note muted">${U.esc(P.fcText(r))}</p>`;
    }
    // 每一年一列，新的在上面
    const rows = [...f.years].reverse().map(y => `
      <span>${y.year}</span><span>${fmt(y.eps)}</span><span>${P.money(y.cash)} 元</span><span>${U.fmtNum(Math.round(y.ratio * 100))}%</span>`).join('');
    const notes = [];
    if (f.done) {
      notes.push(`${name}賺的錢已經決議每股配 ${P.money(f.decided)} 元，不用估了`);
    } else if (f.wild) {
      notes.push(P.fcText(r));
    } else {
      // 上面四格已經照順序寫了預估全年 EPS、配息率、預估每股配，算式只寫數字，一行放得下
      notes.push(`預估每股配 = ${fmt(f.base)} × ${U.fmtNum(Math.round(f.payout * 100))}% ≈ ${P.money(f.cash)} 元`);
      if (f.decided !== null) notes.push(`已經決議 ${P.money(f.decided)} 元（${f.decidedQ === 2 ? '上半年' : `到第 ${f.decidedQ} 季`}），預估的是全年`);
      if (P.fcWarn(r)) notes.push(P.fcWarn(r));
    }
    if (f.years.length) notes.push(`配息率 = 近 ${f.years.length} 年配的現金股利加起來 ÷ EPS 加起來（虧損、還沒決議的年不算，配股不算）`);
    notes.push(`${name}賺的錢，年配的通常隔年夏天除息；只是照過去的配息習慣推算，公司不一定照這樣配`);
    return `
      ${head}
      <div class="card static detail-card eps-card">
        <span class="card-grid">
          ${cell(e.q === 4 ? `${name}全年 EPS` : '預估全年 EPS', fmt(f.base))}
          ${f.payout === null ? '' : cell('配息率', `${U.fmtNum(Math.round(f.payout * 100))}%`)}
          ${cell(f.done ? '已決議每股配' : '預估每股配', f.done ? `${P.money(f.decided)} 元` : f.cash === null ? '—' : `${P.money(f.cash)} 元`, 'strong')}
          ${cell(f.done ? '殖利率' : '預估殖利率', r.fy === null ? '—' : P.pct(r.fy), 'strong')}
        </span>
        ${rows ? `<span class="fc-years"><small>年度</small><small>EPS</small><small>每股配現金</small><small>配息率</small>${rows}</span>` : ''}
        ${notesHTML(notes)}
      </div>`;
  }

  // K 線：小圖和一行現價、月線的方向、扣低幾天（用現價算，和行情的 K 線頁一樣），整張可以點，打開大圖自己打價格
  //   包在 .kl-sec 裡：K 線資料下載好時只換這一段（refreshKLine）
  function klHTML(price) {
    klPrice = price;
    return `<div class="kl-sec">${klSecHTML()}</div>`;
  }

  function klSecHTML() {
    const head = '<h3 class="section-head">K 線</h3>';
    const r = MA.calc(code, klPrice);
    if (r.why) return `${head}<p class="note muted">${U.esc(r.why)}</p>`;
    if (r.price === null) return `${head}<p class="note muted">沒有現價，算不出月線往哪裡彎</p>`;
    const TURN = { 1: ['up', '↑ 上彎'], '-1': ['down', '↓ 下彎'], 0: ['', '持平'] };
    const [cls, text] = TURN[r.dir];
    return `
      ${head}
      <button type="button" class="card detail-card kl-entry" data-act="kline" aria-label="看 K 線大圖、月線扣抵">
        <span class="kl-mini">${MA.miniHTML(r)}</span>
        <span class="kl-line"><span>現價 <b>${U.fmtNum(r.price, 2)}</b></span><span>月線 <b class="${cls}">${text}</b></span><span>扣低 ${r.low}/${MA.DAYS}</span><span class="kl-go">大圖 ›</span></span>
      </button>`;
  }

  // K 線資料下載好了：開著的話只重畫 K 線那一段
  //   這一段已經捲到上面看不到（從殖利率、EPS 點進來）時，下面的 KD 標題被推下去多少就往下捲多少，正在看的那一段才不會被擠走
  //     量 KD 標題實際移動多少（不是這一段變高多少）：電腦版 Chrome 自己也會補，兩邊都補會捲過頭
  function refreshKLine() {
    const sec = dlg.open && bodyEl.querySelector('.kl-sec');
    if (!sec) return;
    const next = sec.nextElementSibling;
    const above = sec.getBoundingClientRect().bottom <= bodyEl.getBoundingClientRect().top + 60;
    const top = next?.getBoundingClientRect().top;
    sec.innerHTML = klSecHTML();
    if (above && next) bodyEl.scrollTop += next.getBoundingClientRect().top - top;
  }

  // 配息紀錄：公告的加上自己記的，新的在前；一張表，一次一行：除權息日｜發放｜現金｜配股｜合計（都是每股、元）
  //   合計 = 現金 + 配股（配股是照面額算的價值，不是現金）；沒配股的配股欄寫「—」
  //   還沒除息的在日期下面寫「預計」，金額還沒公告的現金寫「待公告」、合計「—」，金額用自己記的在現金下面寫「你記的」
  //   發放日只寫月/日，手機上才放得下
  //   表格下面一行小字：公告資料只抓近 13 個月（年配的只會有一行，免得以為只配過一次），更早的只列自己記過的
  function eventsHTML() {
    const today = U.today();
    const list = Yield.events(code, Store.list('dividends', 'all'));
    if (!list.length) return '<p class="note muted">公告資料裡沒有這檔的配息，也還沒有記過</p>';
    const num = v => (v ? U.fmtNum(v) : '—');
    const rows = list.map(r => {
      const cash = typeof r.cash === 'number';
      return `
        <tr>
          <td>${U.esc(U.fmtDate(r.exDate))}${r.exDate > today ? '<small>預計</small>' : ''}</td>
          <td class="ev-pay">${r.payDate ? U.esc(U.fmtDate(r.payDate).slice(5)) : '—'}</td>
          <td class="num">${cash ? U.fmtNum(r.cash) : '待公告'}${r.own ? '<small>你記的</small>' : ''}</td>
          <td class="num">${num(r.stock)}</td>
          <td class="num total">${cash ? U.fmtNum(U.round(r.cash + (r.stock || 0), 4)) : '—'}</td>
        </tr>`;
    }).join('');
    return `
      <div class="card static detail-card">
        <table class="ev-table">
          <thead><tr><th>除權息日</th><th>發放</th><th class="num">現金</th><th class="num">配股</th><th class="num">合計</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <span class="card-note">公告資料只有近 13 個月，更早的只列你記過的</span>
      </div>`;
  }

  function render() {
    const today = U.today();
    const h = Holdings.all(today);
    const pos = (h ? h.positions : []).find(p => key(p.code) === code && p.shares > 0) || null;
    const watchRec = Store.list('watch').find(r => key(r.code) === code) || null;
    const names = typeof STOCK_LIST !== 'undefined' ? STOCK_LIST.names : {};
    const name = pos?.name || watchRec?.name || names[code] || Announced.forCode(code)[0]?.name || '';
    const r = STARS_PAGE.enrich({ code, name, held: !!pos, watched: !!watchRec });
    const { info, m } = r;
    const kz = KD.zone(r.k);
    const dz = KD.zone(m?.d);
    const cross = KD_PAGE.crossCell(m);
    const q = Market.quote(code);
    const priceFrom = !q.price ? '' : q.close ? `${md(q.close)} 收盤價` : '即時價格，可能延遲 20 分鐘';
    const total = Stars.on().length;

    titleEl.textContent = `${code} ${name}`.trim();
    const tag = holdTagsHTML(r);
    // 上一檔、下一檔：和 K 線大圖同一個樣子（見 kline.js）
    const i = codes.indexOf(code);
    const nav = codes.length > 1 && i >= 0 ? `
      <div class="kl-nav detail-nav">
        <button type="button" class="text-btn" data-act="prev"${i === 0 ? ' disabled' : ''}>‹ 上一檔</button>
        <span>${i + 1} / ${codes.length}</span>
        <button type="button" class="text-btn" data-act="next"${i === codes.length - 1 ? ' disabled' : ''}>下一檔 ›</button>
      </div>` : '';
    bodyEl.innerHTML = `${nav}
      <div class="detail-top">
        ${tag}
        <span class="detail-stars${r.n ? '' : ' none'}">${'★'.repeat(r.n)}${'☆'.repeat(Math.max(0, total - r.n))}</span>
        ${watchRec ? '' : '<button type="button" class="detail-add" data-act="watch">＋ 加入觀察清單</button>'}
        <span class="detail-met">${!total ? '星星條件都沒有打勾' : r.n ? `達標：${r.stars.map(x => x.short).join('、')}` : '沒有達標的條件'}</span>
      </div>

      ${klHTML(r.price)}

      <h3 class="section-head">KD（日 KD，9 日）</h3>
      <div class="card static detail-card kd-card">
        <span class="card-grid">
          ${cell(`K 值${Stars.mark(r, 'kdLow')}`, fmt(r.k), kz ? `strong ${kz}` : 'strong')}
          ${cell('D 值', fmt(m?.d), dz)}
          ${cell(`交叉${Stars.mark(r, 'golden')}`, cross[1], cross[0])}
        </span>
        ${notesHTML([KD_PAGE.note(r, { close: true })])}
      </div>

      <h3 class="section-head" data-sec="yield">殖利率</h3>
      <div class="card static detail-card yield-card">
        <span class="card-grid">
          ${cell('現價', r.price ? U.fmtNum(r.price, 2) : '—')}
          ${cell(`殖利率${Stars.mark(r, 'yield')}`, pct(r.y), 'strong')}
          ${cell(`暴力年化${Stars.mark(r, 'trend')}`, pct(r.ya), `strong${r.ya === null ? '' : info.trend > 0 ? ' up' : info.trend < 0 ? ' down' : ''}`)}
          ${cell('近一年每股', info?.count ? `${U.fmtNum(U.round(info.sum, 3))} 元` : '—')}
          ${cell('配息', info ? info.freq : '—')}
        </span>
        ${priceFrom ? `<span class="card-note">現價：${U.esc(priceFrom)}</span>` : ''}
        ${notesHTML(YIELD_PAGE.notes(r))}
      </div>

      ${epsHTML(r)}
      ${fcHTML(r)}

      <h3 class="section-head">我的</h3>
      <div class="card static detail-card">${mineHTML(pos, r.price)}</div>

      <h3 class="section-head">配息紀錄（每股，元）</h3>
      ${eventsHTML()}

      ${watchRec ? '<button type="button" class="wide-btn danger" data-act="unwatch">從觀察清單移除</button>' : ''}`;
  }

  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // 點背景關閉
  bodyEl.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    const i = codes.indexOf(code);
    if (act === 'prev' && i > 0) {
      go(codes[i - 1]);
    } else if (act === 'next' && i >= 0 && i < codes.length - 1) {
      go(codes[i + 1]);
    } else if (act === 'kline') {
      KLine.open(code);
    } else if (act === 'watch') {
      const rec = Store.add('watch', { code, name: titleEl.textContent.slice(code.length).trim() });
      hooks.onChanged('watch', rec);
      render();
      hooks.toast('已加入觀察清單');
    } else if (act === 'unwatch') {
      const rec = Store.list('watch').find(r => key(r.code) === code);
      if (!rec || !confirm(`確定從觀察清單移除：${titleEl.textContent}？`)) return;
      Store.remove('watch', rec.id);
      hooks.onChanged('watch', null);
      render();
      hooks.toast('已移除');
    }
  });

  return { init, open, refresh, refreshKLine };
})();
