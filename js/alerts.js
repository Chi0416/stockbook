// 到價通知：底部第 5 格「到價」的清單，和詳細資料上方那一排
//   盤中碰到條件就寄 Gmail 的是裝在試算表裡的 Apps Script（tools/price-alert.gs），App 關著也照樣通知；App 只管清單（schema.js 的 alerts）
//     那支程式每分鐘把檢查的時間寫進 _meta 分頁（Sync.alertCheck 讀回來），這裡寫出「上次檢查」，看得出它有沒有在跑
//   條件：漲到、跌到（自己打的價格），新高、新低（1～2 個月，門檻每天照收盤資料算），量增（高於 N 日均量幾 %）；都是響一次就關
//   試算表回報過、或清單裡有東西才看得到這個功能（enabled）：家人沒裝程式就不顯示，底部還是四格
//   一列：證券／代號 | 門檻／條件 | 現價／差距 | 狀態／通知時間（今天的寫幾點幾分，之前的寫日期）；預設離得近的在上面，通知過的放最後
//   點一列打開詳細資料（和選股一樣），在詳細資料點那個到價才是修改

// ===== 門檻（開始）：js/alerts.js 和 tools/price-alert.gs 各有一份，要一模一樣（tests/alerts.test.mjs 會檢查） =====
// 一檔的新高、新低、成交量：row、days 是 candles.json 的 rows[代號]、days（新的在前），今天和之後的不算
//   最近 20 天有最高最低，再往前只有收盤，高低都當收盤；一個月算 20 個交易日，不到 15 天資料的算不出來（null），剛上市的才不會一直創新高
//   價格要還原那天之後的除權息（events：[除權息日, 現金, 股票]，現金還沒公告的跳過），不然除息當天會誤判新低
function alertLevels(row, days, events, today) {
  const known = events.filter(e => typeof e[1] === 'number' && e[0] <= today).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const bars = [];
  (row || []).forEach((x, i) => {
    if (x === null || x === undefined || !days[i] || days[i] >= today) return;
    const adj = p => Math.round(known.filter(e => e[0] > days[i]).reduce((v, e) => (v - e[1]) / (1 + (e[2] || 0) / 10), p) * 100) / 100;
    bars.push(Array.isArray(x) ? { high: adj(x[1]), low: adj(x[2]), vol: x[4] } : { high: adj(x), low: adj(x), vol: null });
  });
  const extreme = (pick, key, months) => {
    const list = bars.slice(0, months * 20);
    return list.length >= months * 15 ? pick(...list.map(b => b[key])) : null;
  };
  return {
    high: { 1: extreme(Math.max, 'high', 1), 2: extreme(Math.max, 'high', 2) },
    low: { 1: extreme(Math.min, 'low', 1), 2: extreme(Math.min, 'low', 2) },
    vols: bars.slice(0, 20).map(b => b.vol).filter(v => typeof v === 'number'),
  };
}

// 這一筆的門檻：新高、新低是價格，量增是張數（前 N 天平均再加幾 %）；算不出來是 null
function alertLevel(lv, a) {
  if (!lv) return null;
  if (a.dir === '新高') return lv.high[a.months] ?? null;
  if (a.dir === '新低') return lv.low[a.months] ?? null;
  const vols = lv.vols.slice(0, a.days);
  if (!a.days || vols.length < a.days) return null;
  return Math.round(vols.reduce((s, v) => s + v, 0) / vols.length * (1 + a.pct / 100));
}
// ===== 門檻（結束） =====

const Alerts = (() => {
  const DONE = '已通知'; // 和 tools/price-alert.gs 寫回試算表的字一樣
  const SCRIPT = 2;      // 通知程式要第幾版才看得懂現在的條件（tools/price-alert.gs 的 SCRIPT_VERSION）
  const TW = 8 * 3600e3; // 台灣時間（UTC+8，沒有日光節約）
  const STOPPED_AFTER = 10 * 60000;
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const all = () => Store.list('alerts', 'all');
  const isDone = r => r.status === DONE;
  const isPrice = d => d === '漲到' || d === '跌到';
  const isWindow = d => d === '新高' || d === '新低';
  const isVolume = d => d === '量增';
  const isUp = d => d !== '跌到' && d !== '新低';

  const enabled = () => !!Sync.alertCheck() || all().length > 0;
  function label(r) {
    if (isWindow(r.dir)) return `${r.months} 個月${r.dir}`;
    if (isVolume(r.dir)) return `${r.days} 日均量 +${U.fmtNum(r.pct)}%`;
    return `${r.dir} ${U.fmtNum(r.price)}`;
  }
  // 清單那一格的小字：門檻寫在上面，這裡只寫條件
  function shortLabel(r) {
    if (isWindow(r.dir)) return `${r.months}個月${r.dir}`;
    if (isVolume(r.dir)) return `${r.days}日量+${U.fmtNum(r.pct)}%`;
    return r.dir;
  }
  // 存檔的時間，那支程式用來分辨「設定之前碰到的不算」：寫台灣時間，試算表上看得懂
  const stamp = (now = Date.now()) => `${new Date(now + TW).toISOString().slice(0, 19)}+08:00`;
  // 那支程式寫的是 2026-11-03 10:32
  const hitText = r => String(r.hitAt ?? '').slice(5).replace('-', '/');
  const hitShort = (r, today = U.today()) => {
    const [d, t = ''] = String(r.hitAt ?? '').split(' ');
    return d === today ? t : d.slice(5).replace('-', '/');
  };
  const statusText = r => r.status || '等待中';
  // 查不到、資料不夠、寄信失敗：那支程式寫的問題，紅字
  const statusBad = r => !!r.status && !isDone(r);

  // 這一筆的門檻：漲到、跌到是自己打的價格，其他照收盤資料算（和那支程式同一個算法）；K 線資料還沒下載好、算不出來是 null
  function levelOf(r) {
    if (isPrice(r.dir)) return r.price;
    const raw = Candles.raw(r.code);
    if (!raw) return null;
    const events = Announced.forCode(r.code).map(e => [e.exDate, e.cash, e.stock]);
    return alertLevel(alertLevels(raw.row, raw.days, events, U.today()), r);
  }

  // 價格那一格下面：現價（延遲 10:55、11/04 收盤）；已經超過時先說
  function priceNote(v) {
    const { price: now } = v.code ? Market.quote(v.code) : {};
    if (!now) return '';
    const price = U.parseNum(v.price ?? '');
    const text = `現價 ${U.fmtNum(now)}（${Market.tag(v.code)}）`;
    if (price === null) return text;
    if (isUp(v.dir) && now >= price) return `${text}，已經超過這個價格，可能很快就會通知`;
    if (!isUp(v.dir) && now <= price) return `${text}，已經低於這個價格，可能很快就會通知`;
    return text;
  }

  // 新高、新低、量增的表單下面：照目前填的內容，門檻現在是多少
  function levelNote(v) {
    if (!v.code) return '';
    Candles.need();
    const wait = Candles.waiting();
    if (wait) return wait;
    const a = { code: v.code, dir: v.dir, months: U.parseNum(v.months ?? ''), days: U.parseNum(v.days ?? ''), pct: U.parseNum(v.pct ?? '') };
    if (isVolume(a.dir) && (a.days === null || a.pct === null)) return '';
    const level = levelOf(a);
    if (level === null) return `這一檔的資料不夠，算不出${isVolume(a.dir) ? ` ${a.days} 日均量` : ` ${a.months} 個月${a.dir}`}`;
    if (isVolume(a.dir)) return `前 ${a.days} 日均量 ${U.fmtNum(Math.round(level / (1 + a.pct / 100)))} 張，今天累積到 ${U.fmtNum(level)} 張就通知`;
    const { price: now } = Market.quote(a.code);
    return `目前的 ${a.months} 個月${a.dir}是 ${U.fmtNum(level)}${now ? `（現價 ${U.fmtNum(now)}，${Market.tag(a.code)}）` : ''}`;
  }

  // 盤中（開盤 10 分鐘後）：這時候那支程式應該每分鐘都有回報
  function inSession(ms) {
    const t = new Date(ms + TW);
    const min = t.getUTCHours() * 60 + t.getUTCMinutes();
    return t.getUTCDay() >= 1 && t.getUTCDay() <= 5 && min >= 9 * 60 + 10 && min < 13 * 60 + 30;
  }
  // 今天的只寫時間
  function clock(ms) {
    const t = new Date(ms + TW).toISOString();
    return t.slice(0, 10) === new Date(Date.now() + TW).toISOString().slice(0, 10)
      ? t.slice(11, 16) : `${t.slice(5, 10).replace('-', '/')} ${t.slice(11, 16)}`;
  }
  // 上次檢查：看的是同步那時候讀到的時間，所以和同步的時間比；登入過期、很久沒同步時不會誤報
  //   舊版的通知程式看不懂新高、新低、量增，不會通知：先說這個
  function checkLine(at = Sync.alertCheck(), synced = Date.parse(Sync.state().lastSyncAt), script = Sync.alertScript()) {
    if (!at) return { text: '通知程式還沒有回報，確認有沒有裝好', warn: true };
    if (script < SCRIPT && all().some(r => !isPrice(r.dir))) return { text: '通知程式是舊版，新高、新低、量增不會通知，要重新貼上', warn: true };
    if (inSession(synced) && synced - at > STOPPED_AFTER) return { text: `通知程式停在 ${clock(at)}，可能沒有在跑`, warn: true };
    return { text: `上次檢查 ${clock(at)}`, warn: false };
  }

  // 一列要用的數字：門檻、現價、離門檻多遠（gap，已經超過是 0；通知過的、量增沒有，排在最後）
  //   今天的成交量盤中 App 拿不到，量增不算差距
  function rowOf(r) {
    const { price: now } = Market.quote(r.code);
    const level = levelOf(r);
    const known = !!now && level !== null && !isVolume(r.dir);
    const past = known && (isUp(r.dir) ? now >= level : now <= level);
    const gap = isDone(r) || !known ? null : past ? 0 : Math.abs(level - now) / now;
    return { ...r, now, level, past, gap };
  }
  function gapText(r) {
    if (r.gap === null) return '';
    if (r.past) return '已過';
    return `${U.fmtNum(U.round(r.gap * 100, 1), 1)}%`;
  }

  // 詳細資料上方那一排：這一檔的到價（點了修改）和「＋ 到價」
  function detailHTML(code) {
    if (!enabled()) return '';
    const chip = r => `<button type="button" class="detail-alert${isDone(r) ? ' done' : ''}" data-act="alert" data-id="${U.esc(r.id)}">` +
      `<b class="${isUp(r.dir) ? 'up' : 'down'}">${U.esc(label(r))}</b> ${U.esc(statusText(r))}${isDone(r) && r.hitAt ? ` ${U.esc(hitText(r))}` : ''}</button>`;
    return `<div class="detail-alerts">${all().filter(r => key(r.code) === key(code)).map(chip).join('')}` +
      '<button type="button" class="detail-add" data-act="alert">＋ 到價</button></div>';
  }

  const NOTE = '<p>盤中每分鐘檢查一次，碰到條件就寄一封 Gmail 給你；手機裝 Gmail App、打開通知就會跳出來。App 關著也照樣檢查</p>' +
    '<p>價格看當天最高、最低，兩次檢查之間碰到又彈回來也算；設定之前碰到的不算</p>' +
    '<p>新高、新低：和前 1 或 2 個月比（一個月算 20 個交易日），門檻每天照收盤資料算，已還原除權息；第 2 個月的資料只有收盤價，減資、分割沒有處理</p>' +
    '<p>量增：今天累積的成交量和前幾日平均比，通常要到下午才碰得到</p>' +
    '<p>通知過一次就不再通知。要再通知：點那一列打開詳細資料，點那個到價按儲存</p>' +
    '<p>新增、修改要同步到試算表才生效。通常晚 1 分鐘左右，Google 偶爾會更晚</p>' +
    '<p>這裡的現價只是對照，可能延遲；檢查用的是證交所的盤中資料</p>';

  // 底部「到價」那一頁（app.js）：hooks.openStock(代號)；和其他頁一樣，看不到的時候資料變了先記著，切過來時才畫
  function createPage(hooks) {
    const el = document.createElement('section');
    el.className = 'panel';
    el.hidden = true;
    el.innerHTML = '<div class="list"></div>';
    const listEl = el.querySelector('.list');
    const state = { sort: 'gap', desc: false, flashId: null };
    let stale = false;

    const SORTS = { code: r => key(r.code), price: r => r.level, gap: r => r.gap, status: r => r.hitAt || '' };
    const COLS = [['price', ['門檻', '條件']], ['gap', ['現價', '差距']], ['status', ['狀態', '時間']]];
    const dirOf = k => (state.sort === k ? (state.desc ? 'desc' : 'asc') : '');

    // 這次畫的列表是不是兩種價格都有：是的話用收盤價的那幾列標「收」
    let mixed = false;
    function rowHTML(r) {
      const status = U.esc(statusText(r));
      return Table.row({
        attrs: `data-id="${U.esc(r.id)}" data-code="${U.esc(r.code)}"`,
        cls: [r.id === state.flashId ? 'flash' : '', isDone(r) ? 'pending' : ''].filter(Boolean).join(' '),
        cells: [
          Table.name(r.name, r.code),
          Table.cell(r.level === null ? '—' : U.fmtNum(r.level), U.esc(shortLabel(r)), `strong ${isDone(r) ? '' : isUp(r.dir) ? 'up' : 'down'}`.trim()),
          Table.cell(r.now ? `${mixed ? Market.closeTag(r.code) : ''}${U.fmtNum(r.now)}` : '—', gapText(r)),
          Table.cell(statusBad(r) ? `<span class="warn-text">${status}</span>` : status, isDone(r) ? U.esc(hitShort(r)) : ''),
        ],
      });
    }

    function pageHTML() {
      const { text, warn } = checkLine();
      const rows = all().map(rowOf);
      const codes = rows.map(r => r.code);
      mixed = Market.mixed(codes);
      const check = warn ? `<span class="warn-text">${U.esc(text)}</span>` : U.esc(text);
      const note = Market.priceNote(codes);
      const line = Note.line(codes.length ? `${check}・${Market.priceLine(codes)}` : check, '到價通知', NOTE + (note ? `<p class="muted">${U.esc(note)}</p>` : ''));
      if (!rows.length) return `${line}<p class="empty">還沒有到價通知<br>點右上角「＋ 新增到價」，或在詳細資料點「＋ 到價」</p>`;
      const cols = [
        { label: ['證券', '代號'], sort: 'code', dir: dirOf('code') },
        ...COLS.map(([sort, lab]) => ({ label: lab, sort, dir: dirOf(sort) })),
      ];
      return line + Table.html(cols, Table.sort(rows, SORTS[state.sort], state.desc).map(rowHTML));
    }

    function refresh() {
      if (el.hidden) {
        stale = true;
        return;
      }
      stale = false;
      listEl.innerHTML = pageHTML();
      state.flashId = null;
    }

    listEl.addEventListener('click', e => {
      const sort = e.target.closest('[data-act="sort"]');
      if (sort) {
        const v = sort.dataset.value;
        // 換一欄時：代號、差距小到大（離得近的在上面），門檻、通知時間大到小
        state.desc = state.sort === v ? !state.desc : v === 'price' || v === 'status';
        state.sort = v;
        refresh();
        return;
      }
      const row = e.target.closest('.trow[data-code]');
      if (row) hooks.openStock(row.dataset.code);
    });

    function changed(rec) {
      if (rec) state.flashId = rec.id;
      refresh();
    }
    // 上一檔、下一檔：照列出來的順序，同一檔只算一次
    const codes = () => [...new Set([...listEl.querySelectorAll('.trow[data-code]')].map(n => n.dataset.code))];
    return { el, refresh, changed, reset: refresh, shown: () => { if (stale) refresh(); }, codes };
  }

  return { SCRIPT, enabled, label, shortLabel, stamp, priceNote, levelNote, levelOf, checkLine, detailHTML, createPage, rowOf, gapText, hitShort, isPrice, isWindow, isVolume };
})();
