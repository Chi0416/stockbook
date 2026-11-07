// 一檔股票的詳細資料：選股的每一頁（K 線、KD、ETF 持有、殖利率、EPS、★ 星星）、股利、即將除權息點一檔都打開這一頁（從底部彈出，和新增表單一樣）
//   只放誰打開都一樣的資料；個人的股數、成本、損益在「未實現損益」（帳務的庫存點一檔，見 mine.js）
//   記帳的畫面（總覽、股利、帳務）不打開這一頁，這一頁也不連回記帳；只讀持股，標「持有」（持有、觀察那一排也是）
//   最上面：上一檔、下一檔（照點進來那一頁的列表順序，捲下去也一直在最上面）
//     持有、星星（達標的條件，見 stars.js）；星星右邊是觀察清單的開關，加入、移除都在這個位置（和 K 線的大圖、收起一樣）
//       還沒在觀察清單：「＋ 加入觀察清單」，點了直接加；已經在了：「✓ 觀察中」，點了問一次再移除（觀察清單全家共用）
//       持有、又不在觀察清單的不顯示：選股的「觀察」本來就包含持股，不用再加
//       開關已經寫「觀察中」，上面的標籤就不再標「觀察」
//     有裝到價通知的程式時，下面多一排：這一檔的到價（點了修改，見 alerts.js）和「＋ 到價」
//   下面一次滑完，順序：技術面 → 籌碼面 → 基本面（不另外加一行分區的標題，免得變長；只在殖利率的標題前面寫「基本面」，同一行，不多佔高度）
//     K 線 → KD → ETF 持有 → 殖利率 → EPS → 股利預估
//   從哪一頁點進來就停在那一段（SECTION），翻上一檔、下一檔也停在那一段
//     K 線是第一段，停在最上面（星星、持有標籤看得到）；★ 星星本來就在最上面
//   每一段同一個樣子：標題只寫名稱，右邊「說明」點了跳出小泡泡（head，見 note.js）
//     → 一張卡片，一排格子，第一格是選股那一頁的主要數字（粗字）→ 最多一行說明（lineHTML）
//     第二行以後（moreHTML），和怎麼算、單位、資料從哪來這些固定的說明，都收進「說明」
//   K 線：平常是一張小圖和一行收盤價、月線的方向、扣低幾天（用最新收盤價算，和選股的 K 線頁一樣），點了在原地展開大圖（月線扣抵）
//     展開、收起在同一個位置：標題右邊（說明的左邊）小圖時寫「大圖」、大圖時寫「收起」，箭頭跟著翻過來；小圖整張也可以點開
//     從 K 線頁點進來直接展開，翻上一檔、下一檔也照樣展開；殖利率不在最上面了，收盤價寫在小圖那一行
//     大圖：自己輸入今天的價格（一開始帶入最新收盤價、點了全選），下面跟著算：扣抵值｜月線｜變化（上彎紅、下彎綠），前一天的月線、5 日線
//       圖（見 MA.chartHTML）：點 K 棒看那天的收開高低；最下面一排之後 4 天的扣抵值（比輸入的價格低紅、高綠）
//       打字時只重畫結果（outHTML），輸入框不會失去焦點；換一檔、收起、重新打開時清掉輸入的價格
//     K 線資料比較大，打開詳細頁才下載（見 candles.js），下載好了只重畫這一段（app.js 叫 refreshKLine）
//   殖利率：一排四格（殖利率、暴力年化、近一年每股、配息）；收盤價不另外一格（K 線那一行有），
//     寫在下面那行「10/16 收盤 2,420.00」；下面股利預估的預估殖利率好對照
//   ETF 持有：收了的 ETF 裡有幾檔持有、權重加總、最多的那一檔，下面每一檔一個小框（代號和權重，權重大的在前）；ETF 本身不顯示
//     ETF 成分股打開詳細頁才下載（見 etf.js），下載好了 app.js 重畫
//   EPS 下面多一排近 5 年每一年的 EPS（今年還不到第 4 季的寫到第幾季）；ETF、興櫃沒有 EPS，EPS 和股利預估都不顯示
//   股利預估：用 EPS 算的，接在 EPS 後面；預估配、預估殖利率、配息率、用哪個 EPS 估，下面列出算配息率的那幾年（新的在上面），算法見 eps.js
//   歷史股利：殖利率標題右邊點了打開，疊在上面，關掉回到這裡；每一檔都有，只列公告的，都是每股金額
//   和選股頁同樣的算法（YIELD_PAGE、KD_PAGE、EPS_PAGE），達到星星條件的數字旁邊標 ★
const Detail = (() => {
  const dlg = document.getElementById('stock-sheet');
  // 瀏覽器還拿著舊版 index.html（沒有這個 sheet）時什麼都不做
  if (!dlg) return { init() {}, open() {}, refresh() {}, refreshKLine() {} };
  const titleEl = dlg.querySelector('.sheet-title');
  const bodyEl = dlg.querySelector('.sheet-body');
  // 從哪一頁點進來時停在哪一段（data-sec）；沒寫的、沒有那一段的（例如 ETF 沒有 EPS）停在最上面
  const SECTION = { kline: 'kline', kd: 'kd', etfs: 'etf', yield: 'yield', eps: 'eps' };
  const TURN = { 1: ['up', '↑ 上彎', '上彎'], '-1': ['down', '↓ 下彎', '下彎'], 0: ['', '持平', '持平'] };
  let code = null;
  let codes = [];     // 上一檔、下一檔的順序
  let from = '';      // 從哪一頁點進來（app.js 的頁名）
  let klPrice = null; // K 線那一段用的價格（最新收盤價）
  let big = false;    // K 線那一段展開成大圖
  let typed = null;   // 大圖裡輸入的價格（字串）；重畫時留著
  let hooks = { toast() {}, onChanged() {} };

  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
  const mmdd = d => U.esc(U.fmtDate(d).slice(5)); // 只用在畫面上（HTML）
  const pct = n => (typeof n === 'number' ? `${U.fmtNum(U.round(n * 100, 2), 2)}%` : '—');
  const fmt = v => (typeof v === 'number' ? U.fmtNum(v, 2) : '—');
  const ma2 = v => U.fmtNum(U.round(v, 2), 2);
  const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;

  // 一段的標題：只寫名稱；group 是前面同一行的組名（「基本面」）；右邊「說明」點了跳出 tip（HTML），extra 放在「說明」左邊（K 線的「大圖」「收起」）
  function head(sec, title, tip = '', { group = '', extra = '' } = {}) {
    return `<h3 class="section-head" data-sec="${sec}">${group ? `<b class="sec-group">${group}</b>` : ''}` +
      `<span class="sec-name">${title}</span>${extra}${tip ? Note.btn(title, tip) : ''}</h3>`;
  }
  // 卡片最下面只寫第一行說明；第二行以後放進「說明」泡泡（寫在固定的說明前面）
  const lineHTML = lines => (lines[0] ? `<span class="card-note">${U.esc(lines[0])}</span>` : '');
  const moreHTML = lines => lines.slice(1).map(n => `<p>${U.esc(n)}</p>`).join('');

  function init(h) {
    hooks = h;
  }

  // c：哪一檔；list：上一檔、下一檔的順序（點進來那一頁的列表），沒有就不顯示；at：從哪一頁點進來
  function open(c, { list = [], at = '' } = {}) {
    codes = list.map(key);
    from = at;
    big = at === 'kline';
    show(c);
    if (!dlg.open) dlg.showModal();
    toSection(); // 要先打開才量得到位置
  }

  // 翻到上一檔、下一檔
  function go(c) {
    show(c);
    toSection();
  }

  function show(c) {
    code = key(c);
    typed = null;
    MA.resetChart();
    Candles.need();
    Etf.need();
    render();
  }

  // 停在點進來那一頁的那一段：標題剛好在上一檔、下一檔那一排下面；第一段（K 線）停在最上面
  function toSection() {
    bodyEl.scrollTop = 0;
    const sec = SECTION[from] && bodyEl.querySelector(`[data-sec="${SECTION[from]}"]`);
    if (!sec || sec === bodyEl.querySelector('.section-head')) return;
    const nav = bodyEl.querySelector('.detail-nav');
    bodyEl.scrollTop = sec.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top - (nav ? nav.offsetHeight : 0) - 4;
  }

  // 歷史股利：疊在詳細資料上面，關掉回到詳細資料；只列公告的（誰打開都一樣），不算領到多少
  const evDlg = document.getElementById('events-sheet');
  const EVENTS_TIP = '<p>金額都是<b>每股</b>多少元</p>' +
    '<p>合計 = 現金股利 + 股票股利；股票股利是照面額算的價值，是股票不是現金</p>' +
    '<p>公告資料只抓近 13 個月，一年配一次的通常只有一行</p>';
  function renderEvents() {
    evDlg.querySelector('.sheet-title').textContent = titleEl.textContent;
    evDlg.querySelector('.sheet-body').innerHTML = head('events', '歷史股利', EVENTS_TIP) +
      Events.tableHTML(Events.list(code, []), '公告資料裡沒有這檔的配息');
  }
  function openEvents() {
    if (!evDlg) return; // 瀏覽器還拿著舊版 index.html
    renderEvents();
    evDlg.showModal();
    evDlg.querySelector('.sheet-body').scrollTop = 0;
  }

  // 資料變了（同步、觀察清單、收盤價、ETF 成分股下載好）：開著的話重畫；正在大圖打價格時不動，免得輸入框不見
  //   重畫前記下畫面最上面那一段標題的位置，重畫後補回去：例如 ETF 持有那一段晚一點才出現，停在殖利率時才不會被往下擠
  const typing = () => !!document.activeElement?.matches?.('#stock-sheet [data-ma]');
  function refresh() {
    if (!dlg.open || typing()) return;
    if (evDlg?.open) renderEvents();
    const top = bodyEl.getBoundingClientRect().top + (bodyEl.querySelector('.detail-nav')?.offsetHeight || 0);
    const at = [...bodyEl.querySelectorAll('.section-head[data-sec]')].find(h => h.getBoundingClientRect().bottom > top);
    const before = at?.getBoundingClientRect().top;
    render();
    const now = at && bodyEl.querySelector(`.section-head[data-sec="${at.dataset.sec}"]`);
    if (now && bodyEl.scrollTop > 0) bodyEl.scrollTop += now.getBoundingClientRect().top - before;
  }

  // EPS：達成率、今年到第幾季、去年全年、預估全年 EPS，進度條和一行說明，最下面近 5 年每一年的 EPS（新的在左邊）
  //   標題右邊寫最新一季財報哪一天公布（知道的才寫）
  //   EPS 還沒下載好時寫原因；下載好了、這檔沒有 EPS（ETF、興櫃）時整段不顯示
  function epsHTML(r) {
    const { e } = r;
    if (!e) {
      const why = Eps.waiting();
      return why ? `${head('eps', 'EPS')}<p class="note muted">${U.esc(why)}</p>` : '';
    }
    const tone = EPS_PAGE.tone(e);
    const lines = EPS_PAGE.notes(e);
    const at = EPS_PAGE.atText(e);
    const tip = moreHTML(lines) +
      '<p>達成率 = 今年累計 EPS ÷ 去年全年 EPS；長條上的刻度是進度（每過一季 25%），超過進度紅色、落後綠色</p>' +
      (at ? '<p>標題右邊的公布日期是每天晚上更新資料時第一次抓到的那天</p>' : '') +
      '<p>最下面一排是近 5 年每一年的 EPS，新的在左邊</p>';
    // 一排五年：上面年份、下面 EPS，新的在左邊；還不到第 4 季的在數字下面寫到第幾季；虧損綠色
    const years = [...e.years].reverse().map(y => cell(`${y.year}`, `${fmt(y.eps)}${y.q < 4 ? `<small>到第 ${y.q} 季</small>` : ''}`, y.eps < 0 ? 'down' : '')).join('');
    return `
      ${head('eps', 'EPS', tip, { extra: at ? `<span class="sec-meta">${U.esc(at)}</span>` : '' })}
      <div class="card static detail-card eps-card">
        <span class="card-grid">
          ${cell(`達成率${Stars.mark(r, 'eps')}`, e.pct === null ? '—' : `${e.pct}%`, `strong ${tone}`)}
          ${EPS_PAGE.cellsHTML(e)}
        </span>
        ${EPS_PAGE.barHTML(e)}
        ${lineHTML(lines)}
        <span class="card-grid eps-years">${years}</span>
      </div>`;
  }

  // 股利預估：上面四格照計算的順序：預估全年 EPS × 配息率 = 預估配，÷ 收盤價 = 預估殖利率；中間每一年怎麼算的，下面一行算式
  //   今年整年都決議了：寫已決議配多少，不用估；估不出來時只寫原因
  function fcHTML(r) {
    const { e } = r;
    const f = e?.fc;
    if (!f) return '';
    const P = EPS_PAGE;
    const name = P.yearName(e.year);
    // 估不出來、今年虧損、從來不配：只寫原因；配息率太高不估的，照樣列出每一年，看得到為什麼
    if (!f.done && (f.payout === null || e.est <= 0 || f.cash === 0)) {
      return `${head('fc', '股利預估')}<p class="note muted">${U.esc(P.fcText(r))}</p>`;
    }
    // 每一年一列，新的在上面
    const rows = [...f.years].reverse().map(y => `
      <span>${y.year}</span><span>${fmt(y.eps)}</span><span>${P.money(y.cash)} 元</span><span>${U.fmtNum(Math.round(y.ratio * 100))}%</span>`).join('');
    const lines = [];
    if (f.done) {
      lines.push(`${name}賺的錢已經決議每股配 ${P.money(f.decided)} 元，不用估了`);
    } else if (f.wild) {
      lines.push(P.fcText(r));
    } else {
      // 上面四格已經照順序寫了預估全年 EPS、配息率、預估每股配，算式只寫數字，一行放得下
      lines.push(`預估每股配 = ${fmt(f.base)} × ${U.fmtNum(Math.round(f.payout * 100))}% ≈ ${P.money(f.cash)} 元`);
      if (f.decided !== null) lines.push(`已經決議 ${P.money(f.decided)} 元（${f.decidedQ === 2 ? '上半年' : `到第 ${f.decidedQ} 季`}），預估的是全年`);
      if (P.fcWarn(r)) lines.push(P.fcWarn(r));
    }
    const tip = moreHTML(lines) +
      (f.years.length ? `<p>配息率 = 近 ${f.years.length} 年現金股利加起來 ÷ EPS 加起來</p>` : '') +
      '<p>只是推算，不一定照這樣配；年配的通常隔年夏天除息</p>';
    return `
      ${head('fc', '股利預估', tip)}
      <div class="card static detail-card eps-card">
        <span class="card-grid">
          ${cell(e.q === 4 ? `${name}全年 EPS` : '預估全年 EPS', fmt(f.base))}
          ${f.payout === null ? '' : cell('配息率', `${U.fmtNum(Math.round(f.payout * 100))}%`)}
          ${cell(f.done ? '已決議每股配' : '預估每股配', f.done ? `${P.money(f.decided)} 元` : f.cash === null ? '—' : `${P.money(f.cash)} 元`, 'strong')}
          ${cell(f.done ? '殖利率' : '預估殖利率', r.fy === null ? '—' : P.pct(r.fy), 'strong')}
        </span>
        ${rows ? `<span class="fc-years"><small>年度</small><small>EPS</small><small>每股配現金</small><small>配息率</small>${rows}</span>` : ''}
        ${lineHTML(lines)}
      </div>`;
  }

  // K 線：包在 .kl-sec 裡，K 線資料下載好、展開、收起時只換這一段（refreshKLine）
  function klHTML(price) {
    klPrice = price;
    return `<div class="kl-sec">${klSecHTML()}</div>`;
  }

  function klSecHTML() {
    const tip = big
      ? '<p>自己打今天的價格，下面跟著算：價格比扣抵值高，月線往上彎（紅）；比較低，往下彎（綠）</p>' +
        `<p>點一根 K 棒看那天的收開高低；虛線是價格一直是你打的數字時，月線（藍）、5 日線（黃）接下來 ${MA.DAYS} 天怎麼走</p>` +
        `<p>最下面是之後 ${MA.DAYS - 1} 天依序要扣的收盤價：比你打的價格低（紅）是扣低，價格不變月線就往上彎；高（綠）是扣高</p>`
      : '<p>小圖是最近 20 天的 K 棒和月線（藍線），虛線是價格不變時月線怎麼走</p>' +
        `<p>扣低：接下來 ${MA.DAYS} 天要扣的收盤價有幾天比最新收盤價低，越多月線越會往上彎；月線的上彎、下彎也用最新收盤價算</p>` +
        '<p>點小圖展開大圖，可以自己打價格看月線怎麼走</p>';
    // 展開、收起都在標題右邊同一個位置；小圖畫不出來（沒有 K 線資料、沒有收盤價）時不能展開，沒有按鈕
    //   箭頭和總覽即將除權息的「還有 N 筆」一樣，收起時翻過來（CSS 看 aria-expanded）
    const chevron = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
    const toggle = big
      ? `<button type="button" class="sec-btn" data-act="fold" aria-expanded="true">收起${chevron}</button>`
      : `<button type="button" class="sec-btn" data-act="kline" aria-expanded="false" aria-label="展開 K 線大圖、月線扣抵">大圖${chevron}</button>`;
    const h = head('kline', 'K 線', tip, { extra: toggle });
    const plain = head('kline', 'K 線', tip);
    if (big) {
      const v = typed ?? (klPrice ? String(klPrice) : '');
      const r = MA.calc(code, U.parseNum(v));
      if (r.why) return `${h}<p class="note muted">${U.esc(r.why)}</p>`;
      return `${h}
        <div class="card static detail-card ma-card">
          <label class="ma-price"><span>${MA.dayName(r.last)}的價格</span><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${U.esc(v)}" data-ma></label>
          <div class="ma-out">${outHTML(r)}</div>
        </div>`;
    }
    const r = MA.calc(code, klPrice);
    if (r.why) return `${plain}<p class="note muted">${U.esc(r.why)}</p>`;
    if (r.price === null) return `${plain}<p class="note muted">沒有收盤價，算不出月線往哪裡彎</p>`;
    const [cls, text] = TURN[r.dir];
    return `${h}
      <button type="button" class="card detail-card kl-entry" data-act="kline" aria-label="展開 K 線大圖、月線扣抵">
        <span class="kl-mini">${MA.miniHTML(r)}</span>
        <span class="kl-line"><span>收盤 <b>${U.fmtNum(r.price, 2)}</b></span><span>月線 <b class="${cls}">${text}</b></span><span>扣低 ${r.low}/${MA.DAYS}</span></span>
      </button>`;
  }

  // 大圖下面算出來的：扣抵值｜月線｜變化，一行前一天的月線、5 日線，K 線圖，之後 4 天的扣抵值
  function outHTML(r) {
    const tone = d => (d > 0 ? 'up' : d < 0 ? 'down' : '');
    const diff = r.ma === null ? 0 : U.round(r.ma - r.prev, 4);
    const change = r.ma === null ? '—' : `${diff > 0 ? '+' : ''}${U.fmtNum(diff, 2)}<small>${TURN[r.dir][2]}</small>`;
    const prevDir = r.prevDir === null ? '' : `，${TURN[r.prevDir][2]}`;
    const week = r.ma5 === null ? '' : `；5 日線 ${ma2(r.ma5)}，${TURN[r.dir5][2]}`;
    // 收盤價照原本的小數位寫（2,385、35.47）：一排四格，補成 2,385.00 會擠成兩行
    const next = r.next.map(x => cell(mmdd(x.date), U.fmtNum(x.close), r.price === null ? '' : tone(r.price - x.close))).join('');
    return `
      <span class="card-grid">
        ${cell(`扣抵值 ${mmdd(r.deduct.date)}`, U.fmtNum(r.deduct.close), r.price === null ? '' : tone(r.price - r.deduct.close))}
        ${cell('月線', r.ma === null ? '—' : ma2(r.ma), 'strong')}
        ${cell('變化', change, `strong ${tone(r.dir)}`)}
      </span>
      <span class="card-note">前一天（${mmdd(r.last)}）的月線 ${ma2(r.prev)}${prevDir}${week}</span>
      <div class="kc">${MA.chartHTML(r)}</div>
      <span class="card-grid ma-next">${next}</span>`;
  }

  // K 線資料下載好了、展開、收起：只重畫 K 線那一段
  //   這一段已經捲到上面看不到（從殖利率、EPS 點進來）時，下面的 KD 標題被推下去多少就往下捲多少，正在看的那一段才不會被擠走
  //     量 KD 標題實際移動多少（不是這一段變高多少）：電腦版 Chrome 自己也會補，兩邊都補會捲過頭
  function refreshKLine() {
    const sec = dlg.open && bodyEl.querySelector('.kl-sec');
    if (!sec || typing()) return;
    const next = sec.nextElementSibling;
    const above = sec.getBoundingClientRect().bottom <= bodyEl.getBoundingClientRect().top + 60;
    const top = next?.getBoundingClientRect().top;
    sec.innerHTML = klSecHTML();
    if (above && next) bodyEl.scrollTop += next.getBoundingClientRect().top - top;
  }

  // ETF 持有：幾檔持有（粗字）、權重加總、權重最大的那一檔，下面每一檔一個小框；名稱、資料日期收進「說明」
  //   ETF 本身（代號 00 開頭）、ETF 成分股還沒下載好的不顯示
  function etfHTML() {
    if (/^00/.test(code) || !Etf.ready()) return '';
    const all = Etf.list();
    const by = Etf.holders(code);
    const dates = [...new Set(all.map(e => e.date))].sort();
    const tip = '<p>只算收了的 ETF（受益人數最多的指數型）：' + U.esc(all.map(e => `${e.code} ${e.name}`).join('、')) + '</p>' +
      '<p>權重是這一檔佔那一檔 ETF 的比例；權重加總是把每一檔加起來，越高代表 ETF 買得越多</p>' +
      `<p>成分股從投信網站抄的，${dates.length === 1 ? `都是 ${U.esc(U.fmtDate(dates[0]))}` : `最舊的 ${U.esc(U.fmtDate(dates[0]))}`} 公布，ETF 調整成分股時才更新</p>`;
    const sec = head('etf', 'ETF 持有', tip);
    if (!by.length) return `${sec}<p class="note muted">收的 ${all.length} 檔 ETF 都沒有持有這一檔</p>`;
    const w = v => `${U.fmtNum(U.round(v, 2), 2)}%`;
    return `${sec}
      <div class="card static detail-card etf-card">
        <span class="card-grid">
          ${cell('ETF 持有', `${by.length} 檔<small>/ ${all.length}</small>`, 'strong')}
          ${cell('權重加總', w(by.reduce((s, x) => s + x.weight, 0)))}
          ${cell('權重最大', `${U.esc(by[0].code)}<small>${w(by[0].weight)}</small>`)}
        </span>
        <span class="etf-by full">${by.map(x => `<span>${U.esc(x.code)}<small>${w(x.weight)}</small></span>`).join('')}</span>
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
    const close = Market.get(code);
    // 殖利率卡片下面那一行：殖利率是用哪一天的收盤價算的（價格不另外一格，K 線那一行也有；K 線還在下載時這裡照樣看得到）
    //   算不出殖利率時（公告資料裡沒有這檔、還在下載）先寫原因
    const priceLine = !r.price ? (Market.waiting() || '沒有收盤價，算不出殖利率') : `${md(close.date)} 收盤 ${U.fmtNum(r.price, 2)}`;
    const yLines = info ? [priceLine, ...YIELD_PAGE.notes(r)] : [...YIELD_PAGE.notes(r), priceLine];
    const total = Stars.on().length;
    const eventsBtn = '<button type="button" class="sec-btn" data-act="events">歷史股利<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>';

    titleEl.textContent = `${code} ${name}`.trim();
    const tag = holdTagsHTML({ ...r, watched: false }); // 觀察中寫在右邊的開關上
    // 觀察清單的開關：加入、移除都在星星右邊同一個位置；持有、又不在觀察清單的不用加
    const watchBtn = watchRec
      ? '<button type="button" class="detail-add on" data-act="unwatch" aria-label="觀察中，點了從觀察清單移除">✓ 觀察中</button>'
      : pos ? '' : '<button type="button" class="detail-add" data-act="watch">＋ 加入觀察清單</button>';
    // 上一檔、下一檔：捲下去也一直在最上面
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
        ${watchBtn}
        <span class="detail-met">${!total ? '星星條件都沒有打勾' : r.n ? `達標：${r.stars.map(x => x.short).join('、')}` : '沒有達標的條件'}</span>
        ${Alerts.detailHTML(code)}
      </div>

      ${klHTML(r.price)}

      ${head('kd', 'KD', `<p>日 KD（9 日）：K 值低於 ${KD.low} 是綠色、高於 ${KD.high} 是紅色（在設定的「KD 標記」調整）</p>` +
        '<p>黃金交叉（紅）是 K 由下往上穿過 D，死亡交叉（綠）是由上往下，旁邊的小字是在低檔、中間還是高檔交叉</p>' +
        '<p>每個交易日收盤後更新，盤中不會變</p>')}
      <div class="card static detail-card kd-card">
        <span class="card-grid">
          ${cell(`K 值${Stars.mark(r, 'kdLow')}`, fmt(r.k), kz ? `strong ${kz}` : 'strong')}
          ${cell('D 值', fmt(m?.d), dz)}
          ${cell(`交叉${Stars.mark(r, 'golden')}`, cross[1], cross[0])}
        </span>
        ${lineHTML([KD_PAGE.note(r, { close: true })])}
      </div>

      ${etfHTML()}

      ${head('yield', '殖利率', moreHTML(yLines) +
        '<p>殖利率 = 近一年每股現金股利 ÷ 收盤價</p>' +
        '<p>暴力年化 = 最近一次 × 一年配幾次 ÷ 收盤價：紅色是最近一次配得比近一年平均多，綠色是比較少</p>', { group: '基本面', extra: eventsBtn })}
      <div class="card static detail-card yield-card">
        <span class="card-grid">
          ${cell(`殖利率${Stars.mark(r, 'yield')}`, pct(r.y), 'strong')}
          ${cell(`暴力年化${Stars.mark(r, 'trend')}`, pct(r.ya), `strong${r.ya === null ? '' : info.trend > 0 ? ' up' : info.trend < 0 ? ' down' : ''}`)}
          ${cell('近一年每股', info?.count ? `${U.fmtNum(U.round(info.sum, 3))} 元` : '—')}
          ${cell('配息', info ? info.freq : '—')}
        </span>
        ${lineHTML(yLines)}
      </div>

      ${epsHTML(r)}
      ${fcHTML(r)}`;
  }

  evDlg?.querySelector('[data-act="close"]').addEventListener('click', () => evDlg.close());
  evDlg?.addEventListener('click', e => { if (e.target === evDlg) evDlg.close(); }); // 點背景關閉
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // 點背景關閉
  bodyEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    const act = btn?.dataset.act;
    const i = codes.indexOf(code);
    if (act === 'prev' && i > 0) {
      go(codes[i - 1]);
    } else if (act === 'next' && i >= 0 && i < codes.length - 1) {
      go(codes[i + 1]);
    } else if (act === 'kline' || act === 'fold') {
      // 展開、收起：輸入的價格回到最新收盤價，圖回到最新那一根；iPhone 點按鈕時輸入框還留著焦點，先收起鍵盤
      big = act === 'kline';
      typed = null;
      MA.resetChart();
      if (typing()) document.activeElement.blur();
      refreshKLine();
    } else if (act === 'events') {
      openEvents();
    } else if (act === 'alert') {
      Form.open('alerts', btn.dataset.id || null, { code, name: titleEl.textContent.slice(code.length).trim() });
    } else if (act === 'watch') {
      const rec = Store.add('watch', { code, name: titleEl.textContent.slice(code.length).trim() });
      hooks.onChanged('watch', rec);
      render();
      // 整頁重畫後焦點放回同一個位置的開關（用鍵盤、VoiceOver 的才不會迷路）
      bodyEl.querySelector('.detail-add')?.focus({ preventScroll: true });
      hooks.toast('已加入觀察清單');
    } else if (act === 'unwatch') {
      const rec = Store.list('watch').find(r => key(r.code) === code);
      if (!rec || !confirm(`確定從觀察清單移除：${titleEl.textContent}？`)) return;
      Store.remove('watch', rec.id);
      hooks.onChanged('watch', null);
      render();
      bodyEl.querySelector('.detail-add')?.focus({ preventScroll: true }); // 持有的移除後沒有按鈕，就不動
      hooks.toast('已從觀察清單移除');
    }
  });
  // 大圖的輸入框：打字時只重畫結果，輸入框不會失去焦點；點了全選，直接打新的價格；按 Enter 收起鍵盤
  bodyEl.addEventListener('input', e => {
    if (!e.target.matches('[data-ma]')) return;
    typed = e.target.value;
    const out = bodyEl.querySelector('.ma-out');
    if (out) out.innerHTML = outHTML(MA.calc(code, U.parseNum(typed)));
  });
  bodyEl.addEventListener('focusin', e => { if (e.target.matches('[data-ma]')) e.target.select(); });
  bodyEl.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-ma]')) e.target.blur(); });
  MA.bindChart(bodyEl); // 大圖：點哪一根看哪一天

  return { init, open, refresh, refreshKLine };
})();
