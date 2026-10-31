// 進入點：分頁、列表、表單、Google 雲端硬碟同步、訊息匣、家庭成員、資料備份
//   底部 4 格：總覽｜選股｜股利｜記帳（總覽、選股和券商 App 同一格，記帳在最右邊、像帳務）；選股、股利、記帳一格裡有好幾頁，在標題下面左右切換（見 GROUPS）
(() => {
  const TAB_KEY = 'stockbook.tab';
  const PAGES_KEY = 'stockbook.pages'; // 股利、選股各自上次看的那一頁：{ income: 'cash', market: 'kd' }
  const LOGOUT_KEY = 'stockbook.loggedOut'; // 登出後重新載入頁面時顯示「已登出」（sessionStorage，登出清資料時不會被清掉）
  const $ = id => document.getElementById(id);

  // 標題的字型（index.html 的 Google Fonts）：載入好才套用，不擋住畫面
  //   原本寫在 link 的 onload，安全規則（Content-Security-Policy）不允許寫在頁面裡的程式
  const fontCss = document.querySelector('link[rel="stylesheet"][media="print"]');
  if (fontCss) {
    if (fontCss.sheet) fontCss.media = 'all';
    else fontCss.addEventListener('load', () => { fontCss.media = 'all'; });
  }

  // ---------- 提示訊息（有開啟的 sheet 時顯示在 sheet 上層） ----------
  const toastEl = $('toast');
  let toastTimer;
  function toast(msg, kind = '') {
    (document.querySelector('dialog[open]') || document.body).appendChild(toastEl);
    toastEl.textContent = msg;
    toastEl.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = ''; }, kind === 'error' ? 3500 : 1800);
  }

  // ---------- 列表與表單 ----------
  // 持股總覽、資料表與推算頁面都有列表
  //   點一列：記帳裡是修改（打開那一筆的表單），其他地方（總覽、股利、選股）都是打開那一檔的詳細資料（見 detail.js）
  //     上一檔、下一檔照那一頁列出來的順序；詳細頁停在點進來那一頁的那一段（從 K 線頁點進來的，K 線那一段直接展開成大圖）
  const PAGES = { overview: OVERVIEW, ...SCHEMAS, ...VIEWS, upcoming: UPCOMING_PAGE, cash: CASH_PAGE, yield: YIELD_PAGE, kd: KD_PAGE, eps: EPS_PAGE, kline: KLINE_PAGE, etfs: ETF_PAGE, stars: STARS_PAGE };
  const lists = {};
  let current = 'overview';
  const openStock = page => code => Detail.open(code, { list: lists[page].codes(), at: page });

  lists.overview = createOverview({ openStock: openStock('overview') });
  $('panels').appendChild(lists.overview.el);
  Object.entries({ ...SCHEMAS, ...VIEWS }).forEach(([key, page]) => {
    if (page.noList) return; // 觀察清單畫在選股的每一頁（見 market.js）
    const formKey = page.source || key;
    lists[key] = createList(key, page, page.stock ? { openStock: openStock(key) } : { openForm: id => Form.open(formKey, id) });
    $('panels').appendChild(lists[key].el);
  });
  // 即將除權息（股利的第二頁，見 upcoming.js）：「記下來」加一筆除權息
  lists.upcoming = Upcoming.createPage({ onChanged: (k, rec) => onChanged(k, rec), toast, openStock: openStock('upcoming') });
  $('panels').appendChild(lists.upcoming.el);
  // 現金單（股利的第三頁，見 cash.js）：點設定打開現金單的表單
  lists.cash = createCash({ openForm: (id, preset) => Form.open('cashPools', id, preset) });
  $('panels').appendChild(lists.cash.el);

  // 看股票的頁（見 market.js）：選股那一格的 K 線、KD、ETF 持有、殖利率、EPS、★ 星星；每一頁點一檔都打開詳細頁
  const MARKET = ['kline', 'kd', 'etfs', 'stars', 'yield', 'eps'];
  lists.yield = createMarket(YIELD_PAGE, { openStock: openStock('yield') });
  lists.kd = createMarket(KD_PAGE, { openStock: openStock('kd') });
  lists.eps = createMarket(EPS_PAGE, { openStock: openStock('eps') });
  lists.kline = createMarket(KLINE_PAGE, { openStock: openStock('kline') });
  lists.etfs = createMarket(ETF_PAGE, { openStock: openStock('etfs') }); // 被幾檔 ETF 持有（見 etf.js）
  lists.stars = createMarket(STARS_PAGE, { openStock: openStock('stars') });
  $('panels').append(lists.yield.el, lists.kd.el, lists.eps.el, lists.kline.el, lists.etfs.el, lists.stars.el);
  const refreshMarket = () => MARKET.forEach(k => lists[k].refresh());

  // 表單開著時（新增後表單不關，方便連續輸入），被表單蓋住的那一頁先不畫，關掉表單時才畫（見 Form.init 的 onClosed）
  const changePage = (k, rec) => (lists[k].defer && $('form-sheet').open ? lists[k].defer(rec) : lists[k].changed(rec));

  // 新增、修改、刪除之後（表單、詳細頁的加入觀察清單）：相關的頁面重畫
  function onChanged(key, rec) {
    // 觀察清單：正在看選股的話，剛加的那一檔閃一下；總覽和股利的即將除權息也有觀察清單
    //   從詳細資料加入、移除都留在原本那一頁，不換頁（新增觀察的表單只在選股打得開）
    if (key === 'watch') {
      MARKET.forEach(k => (k === current ? lists[k].changed(rec) : lists[k].refresh()));
      lists.overview.refresh();
      lists.upcoming.refresh();
      return;
    }
    // 現金單的設定：只有現金單頁用到
    if (key === 'cashPools') {
      lists.cash.changed(rec);
      return;
    }
    changePage(key, rec);
    // 推算頁面跟著重算；正在看的那頁順便標亮剛改的那筆
    Object.entries(VIEWS).forEach(([v, view]) => {
      if (view.source === key && current === v) changePage(v, rec);
      else lists[v].refresh();
    });
    // 其他頁也都重算：持股（總覽、選股、現金單、即將除權息）、庫存快照的核對（看交易和配股）都可能變
    //   看不到的頁只記著要重畫，切過去時才畫（見 list.js 的 refresh），所以不花時間
    Object.keys(lists).forEach(k => { if (k !== key && !VIEWS[k]) lists[k].refresh(); });
  }
  Form.init({ toast, onChanged, onClosed: () => lists[current].shown?.() });
  Detail.init({ toast, onChanged });
  // ETF 成分股（見 etf.js）：第一次切到選股的「成分股」、ETF 持有頁、打開詳細頁才下載，下載好了選股每一頁和詳細頁重畫
  Etf.onChange(() => {
    refreshMarket();
    Detail.refresh();
  });
  window.addEventListener('online', () => { if (Etf.failed()) Etf.need(); }); // 下載失敗過的，連上網路再試
  // K 線資料（見 candles.js）：打開 K 線頁、詳細頁時才下載，下載好了重畫用到的地方
  Candles.onChange(() => {
    lists.kline.refresh();
    Detail.refreshKLine();
  });

  // ---------- 分頁 ----------
  // 底部的每一格（key）和裡面的頁（pages：[頁面, 上方切換的名稱]）；只有一頁的不顯示上方切換
  //   點底部的另一格時：remember 的格子（股利、選股）回到上次看的那一頁（這台裝置記住，關掉再打開也一樣）
  //     其他的先顯示第一頁（記帳先顯示交易明細，免得把交易記成快照）；點目前這一格只捲回最上面
  //   股利只看自己的錢、不改資料：領到的 → 快除息的 → 現金單（工具，放最後）
  //   記帳是自己打的資料，點一筆就是修改：交易明細 → 除權息（這兩個會改持股）→ 庫存快照（照券商核對）→ 帳戶紀錄
  //   選股＝上面有「持有｜觀察｜全市場｜成分股」那一排的頁，和詳細頁同一個順序：技術面 → 籌碼面 → 基本面
  //     K 線 → KD → ETF 持有 → 殖利率 → EPS → ★ 星星（把前面各頁的條件加起來，一定最後）
  const GROUPS = [
    { key: 'overview', label: '總覽', pages: [['overview', '總覽']] },
    // 選股以前叫「行情」，key 照舊用 market（這台裝置記的上次那一頁不會不見）
    { key: 'market', label: '選股', remember: true, pages: [['kline', 'K 線'], ['kd', 'KD'], ['etfs', 'ETF 持有'], ['yield', '殖利率'], ['eps', 'EPS'], ['stars', '★ 星星']] },
    { key: 'income', label: '股利', remember: true, pages: [['cashDividends', '股利'], ['upcoming', '即將除權息'], ['cash', '現金單']] },
    { key: 'book', label: '記帳', pages: [['trades', '交易明細'], ['dividends', '除權息'], ['snapshots', '庫存快照'], ['history', '帳戶紀錄']] },
  ];
  let lastPages = {};
  try { lastPages = JSON.parse(localStorage.getItem(PAGES_KEY)) || {}; } catch (_) {}
  // 以前的頁面（殖利率分成庫存、觀察兩頁）：記在這台裝置的上次那一頁換成新的
  const OLD = { yieldHeld: 'yield', yieldWatch: 'yield' };
  const groupOf = key => GROUPS.find(g => g.key === key || g.pages.some(([k]) => k === key));
  // 新增按鈕：這一頁新增到哪張表、按鈕上寫什麼（手機上也寫出來）；總覽沒有新增按鈕
  const ADD = {
    trades: ['trades', '交易'], snapshots: ['snapshots', '快照'], history: ['history', '紀錄'],
    dividends: ['dividends', '除權息'],
    yield: ['watch', '觀察'], kd: ['watch', '觀察'], eps: ['watch', '觀察'], kline: ['watch', '觀察'], etfs: ['watch', '觀察'], stars: ['watch', '觀察'],
  };
  const tabBtns = [...document.querySelectorAll('.tabbar [data-tab]')];
  const subtabsEl = $('subtabs');
  const addBtn = $('btn-add');
  const addWhat = addBtn.querySelector('.add-what');

  // 標題後面的小字（頁面有 subtitle() 才顯示，例如持股總覽的今天日期）
  function renderSubtitle() {
    const subEl = $('page-sub');
    if (!subEl) return; // 瀏覽器還拿著舊版 index.html 時不要讓整個頁面壞掉
    const sub = PAGES[current].subtitle ? PAGES[current].subtitle() : '';
    subEl.textContent = sub;
    subEl.hidden = !sub;
  }

  // key：底部的一格（book）或其中一頁（snapshots）；訊息匣也會直接指定某一頁
  //   有兩頁的格子：標題寫格子的名稱（記帳），下面切換是哪一頁
  function showTab(key) {
    key = OLD[key] || key;
    const group = groupOf(key) || GROUPS[0];
    if (group.key === key) {
      // 記住的那一頁改名或拿掉了，就回到第一頁
      const last = group.remember && lastPages[group.key];
      key = group.pages.some(([k]) => k === last) ? last : group.pages[0][0];
    }
    if (!lists[key]) key = 'overview';
    current = key;
    if (group.remember) lastPages[group.key] = key;
    $('page-title').textContent = group.pages.length > 1 ? group.label : PAGES[key].title;
    renderSubtitle();
    if (subtabsEl) { // 瀏覽器還拿著舊版 index.html 時沒有這一塊
      subtabsEl.hidden = group.pages.length < 2;
      subtabsEl.innerHTML = group.pages.length < 2 ? '' : group.pages.map(([k, label]) =>
        `<button type="button" role="tab" data-page="${k}" aria-selected="${k === key}">${label}</button>`).join('');
    }
    const add = ADD[key];
    addBtn.disabled = !add;
    if (add) {
      addWhat.textContent = add[1];
      addBtn.setAttribute('aria-label', `新增${add[1]}`);
    }
    tabBtns.forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === group.key)));
    Object.entries(lists).forEach(([k, l]) => { l.el.hidden = k !== key; });
    lists[key].shown?.(); // 看不到時資料變了沒有重畫（見 list.js 的 refresh），切過來時才畫
    if (key === 'kline') Candles.need(); // K 線資料用到時才下載
    if (key === 'etfs') Etf.need(); // ETF 成分股也是
    try {
      localStorage.setItem(TAB_KEY, key);
      localStorage.setItem(PAGES_KEY, JSON.stringify(lastPages));
    } catch (_) {}
  }

  tabBtns.forEach(b => b.addEventListener('click', () => {
    if (groupOf(current).key !== b.dataset.tab) showTab(b.dataset.tab);
    window.scrollTo(0, 0);
  }));
  subtabsEl?.addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.dataset.page === current) return;
    showTab(btn.dataset.page);
    window.scrollTo(0, 0);
  });
  addBtn.addEventListener('click', () => { if (ADD[current]) Form.open(ADD[current][0], null); });

  const refreshAll = () => {
    Object.values(lists).forEach(l => l.refresh());
    Detail.refresh();
    Trend.refresh();
  };

  // ---------- 看哪些成員：在設定的「家庭成員」勾選（見 storage.js 的檢視範圍） ----------
  //   沒有勾全家時，標題下面一條提示「只顯示 爸爸、小明 ›」，點一下打開設定的家庭成員
  const scopeBar = $('scope-bar');

  function renderScopeBar() {
    scopeBar.hidden = Store.scope === 'all';
    scopeBar.querySelector('.scope-names').textContent = Store.shown().map(id => Store.memberName(id)).join('、');
  }

  scopeBar.addEventListener('click', () => openMenu('members'));

  // ---------- 家庭成員管理 ----------
  //   兩位以上成員時每一位前面有勾選框，最上面一列是「全家」；只有一位成員時不用勾
  const memberListEl = $('member-list');

  function renderMembers() {
    const members = Store.members();
    const many = members.length > 1;
    const shown = Store.shown();
    const box = (id, on) => (many ? `<input type="checkbox" data-show="${U.esc(id)}"${on ? ' checked' : ''}>` : '');
    const all = many ? `
        <li>
          <label class="member-pick">${box('all', Store.scope === 'all')}
            <span class="member-info"><b>全家</b><small>打勾的成員才會顯示在各頁</small></span></label>
        </li>` : '';
    memberListEl.innerHTML = all + members.map(m => {
      const counts = Object.entries(Store.memberCounts(m.id))
        .map(([t, n]) => `${SCHEMAS[t].title} ${n}`).join(' · ');
      return `
        <li>
          <label class="member-pick">${box(m.id, shown.includes(m.id))}
            <span class="member-info"><b>${U.esc(m.name)}</b><small>${U.esc(counts)}</small></span></label>
          <button type="button" class="text-btn" data-act="rename" data-id="${U.esc(m.id)}">改名</button>
          ${many ? `<button type="button" class="text-btn danger" data-act="remove" data-id="${U.esc(m.id)}">刪除</button>` : ''}
        </li>`;
    }).join('');
  }

  // 勾選：勾全家就每個人都勾；每個人都勾了自動變成全家（見 storage.js）；至少要留一位
  memberListEl.addEventListener('change', e => {
    const box = e.target.closest('[data-show]');
    if (!box) return;
    const id = box.dataset.show;
    const ids = new Set(Store.shown());
    if (id === 'all' && !box.checked) {
      box.checked = true;
      toast('要隱藏某位成員，取消勾選那一位就好');
      return;
    }
    if (id !== 'all') {
      if (box.checked) ids.add(id);
      else ids.delete(id);
      if (!ids.size) {
        box.checked = true;
        toast('至少要勾一位成員', 'error');
        return;
      }
    }
    Store.setScope(id === 'all' ? 'all' : [...ids]);
    renderMembers();
    renderScopeBar();
    refreshAll();
  });

  // 問名字：空白時回傳 null；和其他成員重複、不合規則（見 schema.js）時寫出原因再問一次
  function askName(message, current = '', exceptId = null) {
    let ask = message;
    let value = current;
    for (;;) {
      const name = (prompt(ask, value) ?? '').trim();
      if (!name) return null;
      const error = memberNameError(name)
        || (Store.members().some(m => m.name === name && m.id !== exceptId) ? `已經有「${name}」了` : '');
      if (!error) return name;
      ask = `${error}\n\n${message}`;
      value = name;
    }
  }

  function membersChanged() {
    renderMembers();
    renderScopeBar();
    renderBackupInfo();
    refreshAll();
  }

  $('btn-add-member').addEventListener('click', () => {
    const name = askName('新成員的名字（例如：爸爸、媽媽）');
    if (!name) return;
    Store.addMember(name);
    membersChanged();
    toast(`已新增「${name}」`);
  });

  memberListEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const old = Store.memberName(id);

    if (btn.dataset.act === 'rename') {
      const name = askName('新的名字', old, id);
      if (!name || name === old) return;
      Store.renameMember(id, name);
      membersChanged();
      toast('已改名');
      return;
    }

    const counts = Object.entries(Store.memberCounts(id)).filter(([, n]) => n > 0);
    const detail = counts.length
      ? `\n\n會一併刪除${counts.map(([t, n]) => ` ${n} 筆${SCHEMAS[t].title}`).join('、')}，無法復原，建議先匯出備份。`
      : '';
    if (!confirm(`確定刪除成員「${old}」？${detail}`)) return;
    Store.removeMember(id);
    membersChanged();
    toast(`已刪除「${old}」`);
  });

  // ---------- 資料備份 ----------
  const menu = $('menu-sheet');

  function renderBackupInfo() {
    $('stats').innerHTML = Object.entries(SCHEMAS).map(([k, s]) =>
      `<div><dt>${s.title}</dt><dd>${Store.list(k, 'all').length}</dd></div>`).join('');
    const t = Store.lastExportAt();
    $('last-export').textContent = t ? `上次匯出：${U.fmtDateTime(t)}` : '尚未匯出過備份';
  }

  // section：打開後直接捲到哪一段（'members' 家庭成員、'kd' KD 標記、'stars' 星星條件）
  function openMenu(section) {
    Google.load(); // 還沒連結的：「連結 Google 帳號」在這裡，先把登入元件載好（見 google.js）
    renderMembers();
    renderKdMarks();
    renderStars();
    renderBackupInfo();
    if (!menu.open) menu.showModal();
    const head = { members: 'members-head', kd: 'kd-head', stars: 'stars-head' }[section];
    if (head && $(head)) $(head).scrollIntoView({ block: 'start' });
  }

  $('btn-menu').addEventListener('click', () => openMenu());
  menu.querySelector('[data-act="close"]').addEventListener('click', () => menu.close());
  menu.addEventListener('click', e => { if (e.target === menu) menu.close(); }); // 點背景關閉

  // ---------- KD 標記（見 kd.js）：K 值低於下限綠色、高於上限紅色；KD 頁「說明」泡泡裡的「調整」打開這一段 ----------
  const kdLow = $('kd-low');
  const kdHigh = $('kd-high');
  function renderKdMarks() {
    if (!kdLow || !kdHigh) return; // 瀏覽器還拿著舊版 index.html
    const opts = (list, v) => list.map(n => `<option value="${n}"${n === v ? ' selected' : ''}>${n}</option>`).join('');
    kdLow.innerHTML = opts(KD.LOWS, KD.low);
    kdHigh.innerHTML = opts(KD.HIGHS, KD.high);
  }
  [kdLow, kdHigh].forEach(sel => sel?.addEventListener('change', () => KD.set(+kdLow.value, +kdHigh.value)));
  // 下限也是星星條件（低檔），星星跟著變
  KD.onChange(m => {
    refreshMarket();
    Detail.refresh();
    renderStars();
    toast(`KD：低於 ${m.low} 綠色、高於 ${m.high} 紅色`);
  });
  $('panels').addEventListener('click', e => { if (e.target.closest('[data-act="kd-marks"]')) openMenu('kd'); });
  // 總覽「即將除權息」最下面的「看全部」：切到股利 → 即將除權息（見 upcoming.js）
  $('panels').addEventListener('click', e => {
    if (!e.target.closest('[data-act="upcoming-all"]')) return;
    showTab('upcoming');
    window.scrollTo(0, 0);
  });
  // 帳戶走勢（總覽的庫存總市值卡片點了打開）最下面：切到記帳 → 帳戶紀錄
  Trend.init({ showHistory: () => { showTab('history'); window.scrollTo(0, 0); } });

  // ---------- 星星條件（見 stars.js）：打勾的條件達標就給一顆 ★；★ 星星頁「說明」泡泡裡的「調整」打開這一段 ----------
  const starsSet = document.querySelector('.stars-set');
  const starYield = $('star-yield');
  const starCross = $('star-cross');
  const starEps = $('star-eps');
  function renderStars() {
    if (!starsSet || !starYield || !starCross || !starEps) return; // 瀏覽器還拿著舊版 index.html
    starsSet.querySelectorAll('[data-star]').forEach(box => { box.checked = Stars.isOn(box.dataset.star); });
    starYield.innerHTML = Stars.YIELDS.map(n => `<option value="${n}"${n === Stars.yieldMin ? ' selected' : ''}>${n}%</option>`).join('');
    starYield.disabled = !Stars.isOn('yield');
    starCross.innerHTML = Stars.CROSS_AT.map(([v, label]) => `<option value="${v}"${v === Stars.crossAt ? ' selected' : ''}>${label}</option>`).join('');
    starCross.disabled = !Stars.isOn('golden');
    starEps.innerHTML = Stars.EPS_AHEADS.map(n => `<option value="${n}"${n === Stars.epsAhead ? ' selected' : ''}>${n ? `${n}% 以上` : '超過就算'}</option>`).join('');
    starEps.disabled = !Stars.isOn('eps');
  }
  starsSet?.addEventListener('change', () => {
    const off = [...starsSet.querySelectorAll('[data-star]')].filter(box => !box.checked).map(box => box.dataset.star);
    Stars.set({ off, yieldMin: +starYield.value, crossAt: starCross.value, epsAhead: +starEps.value });
  });
  Stars.onChange(() => {
    refreshMarket();
    Detail.refresh();
    renderStars();
    const on = Stars.on();
    toast(on.length ? `星星條件：${on.map(x => x.short).join('、')}` : '星星條件都沒有打勾');
  });
  $('panels').addEventListener('click', e => { if (e.target.closest('[data-act="stars-set"]')) openMenu('stars'); });
  // 「說明」泡泡（見 market.js 的 Note）裡的「調整」：先關掉泡泡再打開設定
  Note.el?.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act !== 'kd-marks' && act !== 'stars-set') return;
    Note.close();
    openMenu(act === 'kd-marks' ? 'kd' : 'stars');
  });

  // ---------- 隱藏金額（見 privacy.js）：設定選單的開關；總覽的眼睛在 overview.js ----------
  const hideSwitch = $('hide-amounts');
  if (hideSwitch) {
    hideSwitch.checked = Privacy.hidden;
    hideSwitch.addEventListener('change', () => Privacy.set(hideSwitch.checked));
  }
  Privacy.onChange(hidden => {
    if (hideSwitch) hideSwitch.checked = hidden;
    refreshAll();
    toast(hidden ? '已隱藏金額' : '已顯示金額');
  });

  // ---------- 詳細卡片（見 table.js 的 Cards）：設定選單的開關，全部頁面一起換 ----------
  const cardsSwitch = $('show-cards');
  if (cardsSwitch) {
    cardsSwitch.checked = Cards.on;
    cardsSwitch.addEventListener('change', () => Cards.set(cardsSwitch.checked));
  }
  Cards.onChange(on => {
    if (cardsSwitch) cardsSwitch.checked = on;
    refreshAll();
    toast(on ? '已換成詳細卡片' : '已換成精簡表格');
  });

  function download(file) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('btn-export').addEventListener('click', async () => {
    const json = JSON.stringify(Store.exportPayload(), null, 2);
    const file = new File([json], 'data.json', { type: 'application/json' });
    // 手機優先用分享選單（可「儲存到檔案」或傳到雲端），不支援時改成直接下載
    const touch = matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
      } catch (e) {
        if (e.name === 'AbortError') return;
        download(file);
      }
    } else {
      download(file);
    }
    Store.markExported();
    renderBackupInfo();
    toast('已匯出 data.json');
  });

  const fileInput = $('file-import');
  $('btn-import').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;

    let obj;
    try {
      obj = JSON.parse(await file.text());
    } catch (e) {
      toast('無法讀取：不是有效的 JSON 檔', 'error');
      return;
    }
    const parsed = Store.parseImport(obj);
    if (!parsed) {
      toast('檔案內容不是記錄簿的備份格式', 'error');
      return;
    }

    const bad = Store.badDates(obj);
    const lines = [
      `家庭成員：${Store.members().length} → ${parsed.members.length} 位（${parsed.members.map(m => m.name).join('、')}）`,
      ...Object.entries(SCHEMAS).map(([k, s]) => `${s.title}：${Store.list(k, 'all').length} → ${parsed[k].length} 筆`),
      ...(bad.length ? [`\n有 ${bad.length} 個日期看不懂（例如「${bad[0].slice(0, 20)}」），匯入後會變成沒填日期，要到記帳裡補上`] : []),
    ];
    // 連結了試算表時，同步會整份改寫試算表：其他裝置或試算表裡新增、還沒同步到這台的資料也會不見
    const cloudNote = Sync.state().linked
      ? '\n\nGoogle 試算表也會整份換成這個檔案的內容。其他裝置或試算表裡新增、還沒同步到這台的資料也會不見。' : '';
    if (!confirm(`匯入「${file.name}」會取代目前所有資料。${cloudNote}\n\n${lines.join('\n')}\n\n確定匯入？`)) return;

    Store.replaceAll(parsed);
    renderScopeBar();
    Object.values(lists).forEach(l => l.reset());
    renderMembers();
    renderBackupInfo();
    toast('匯入完成');
  });

  // ---------- Google 雲端硬碟（同步的流程見 sync.js） ----------
  const cloudEl = $('cloud');
  const syncBar = $('sync-bar');
  const syncText = syncBar.querySelector('.sync-text');
  const syncBtn = syncBar.querySelector('.sync-btn');
  let syncAction = null;

  // 「3 小時前」；超過這麼久沒同步、登入又過期時，上方提示列提醒按「同步」
  const STALE = 60 * 60000;
  function ago(iso) {
    const min = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 60000));
    if (min < 60) return `${min} 分鐘前`;
    const h = Math.floor(min / 60);
    return h < 24 ? `${h} 小時前` : `${Math.floor(h / 24)} 天前`;
  }

  // 登入過期時連上網路也不會自動同步，要按「同步」重新登入
  const offlineText = st => {
    if (st.needLogin) return st.pending ? `目前沒有網路，${st.pending} 筆資料還沒同步，連上網路後請按「同步」` : '目前沒有網路';
    return st.pending ? `目前沒有網路，${st.pending} 筆資料會在連上網路後自動同步` : '目前沒有網路，連上後會自動同步';
  };

  function syncStatusText(st) {
    if (st.running) return '同步中…';
    if (st.offline) return offlineText(st);
    if (st.error) return `同步失敗：${st.error}`;
    if (st.pending && st.needLogin) return `有 ${st.pending} 筆還沒同步，請按「同步」`;
    if (st.needLogin) return '登入已過期，按「同步」可以抓試算表的最新資料';
    if (st.pending) return `有 ${st.pending} 筆等待同步`;
    return '已是最新';
  }

  const redirectNote = '<p class="note muted">登入視窗打不開時，可以'
    + '<button type="button" class="link-btn" data-act="redirect">改用整頁登入</button>。</p>';

  function renderCloud(st) {
    if (!st.linked) {
      cloudEl.innerHTML = `
        <p class="note muted cloud-intro">連結後，資料會存到你自己的 Google 雲端硬碟（一份試算表）。手機和電腦登入同一個帳號，就能看到同一份資料，也可以直接用 Google 試算表查看、修改。</p>
        <button type="button" class="wide-btn primary" data-act="link" ${st.running ? 'disabled' : ''}>${st.running ? '連結中…' : '連結 Google 帳號'}</button>
        ${redirectNote}`;
      return;
    }
    cloudEl.innerHTML = `
      <ul class="member-list cloud-info">
        <li><span class="member-info"><small>帳號</small><b>${U.esc(st.email)}</b></span></li>
        <li><span class="member-info"><small>上次同步</small><b>${st.lastSyncAt ? U.fmtDateTime(st.lastSyncAt) : '—'}</b></span></li>
        <li><span class="member-info"><small>狀態</small><b class="${st.error ? 'warn' : ''}">${U.esc(syncStatusText(st))}</b></span></li>
      </ul>
      ${st.problems.length ? `
        <p class="note warn-text">試算表裡有 ${st.problems.length} 個地方看不懂，這幾筆可能會算錯。
          哪一列、哪一格請看<button type="button" class="link-btn" data-act="inbox">訊息</button>。</p>` : ''}
      <button type="button" class="wide-btn primary" data-act="sync" ${st.running ? 'disabled' : ''}>${st.running ? '同步中…' : '同步'}</button>
      ${st.url ? `<a class="wide-btn" href="${U.esc(st.url)}" target="_blank" rel="noopener">開啟試算表</a>` : ''}
      ${redirectNote}
      <button type="button" class="text-btn danger cloud-logout" data-act="logout" ${st.running || st.loggingOut ? 'disabled' : ''}>${st.loggingOut ? '登出中…' : '登出'}</button>
      <p class="note muted cloud-logout-note">登出會清除這台裝置上的資料，資料都還在試算表裡。要換別的 Google 帳號（例如幫家人記帳）時先登出。</p>`;
  }

  // 「同步」要在點擊的當下呼叫（登入過期時會跳出 Google 視窗）
  cloudEl.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'link') Sync.startLink();
    else if (act === 'sync') Sync.syncNow();
    else if (act === 'redirect') Sync.loginByRedirect();
    else if (act === 'logout') Sync.logout();
    else if (act === 'inbox') {
      menu.close();
      Inbox.open();
    }
  });

  // 畫面上方的提示列：只在需要使用者處理時出現；自動同步進行中不出現，免得一直閃
  function renderSyncBar(st) {
    let text = '';
    let btn = '';
    syncAction = null;
    if (!st.linked) {
      text = '';
    } else if (st.running) {
      if (syncBar.hidden) return;
      text = '同步中…';
    } else if (st.offline) {
      text = offlineText(st);
    } else if (st.error) {
      text = `同步失敗：${st.error}`;
      btn = '重試';
      syncAction = Sync.syncNow;
    } else if (st.pending && st.needLogin) {
      text = `有 ${st.pending} 筆還沒同步`;
      btn = '同步';
      syncAction = Sync.syncNow;
    } else if (st.liveStopped) {
      // 開盤時間登入過期：現價不會每 5 分鐘自動更新（見 sync.js 的 livePrices），按「同步」重新登入
      text = '登入過期，現價不會自動更新';
      btn = '同步';
      syncAction = Sync.syncNow;
    } else if (st.needLogin && (!st.lastSyncAt || Date.now() - Date.parse(st.lastSyncAt) > STALE)) {
      // 登入過期就不會自動同步：試算表或其他裝置改過的資料，要按「同步」才看得到
      text = st.lastSyncAt ? `上次同步是 ${ago(st.lastSyncAt)}` : '還沒有同步過';
      btn = '同步';
      syncAction = Sync.syncNow;
    }
    syncBar.hidden = !text;
    syncText.textContent = text;
    syncBtn.hidden = !btn;
    syncBtn.textContent = btn;
  }

  syncBtn.addEventListener('click', () => { if (syncAction) syncAction(); });

  // ---------- 啟動 ----------
  if (!Store.available) {
    const banner = $('banner');
    banner.textContent = '這個瀏覽器目前不允許儲存資料（可能是無痕模式或隱私設定），輸入的資料關掉頁面後就會消失。';
    banner.hidden = false;
  }
  // 請瀏覽器盡量不要自動清掉這個網站的資料
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  renderScopeBar();
  refreshAll();
  // 換日後回到這個頁面（例如手機隔天從背景切回來）時全部重算：今天的日期、已入帳／待入帳都跟著變
  let renderedDay = U.today();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || U.today() === renderedDay) return;
    renderedDay = U.today();
    refreshAll();
    renderSubtitle();
  });
  let savedTab = 'overview';
  try { savedTab = localStorage.getItem(TAB_KEY) || 'overview'; } catch (_) {}
  showTab(savedTab);
  try {
    if (sessionStorage.getItem(LOGOUT_KEY)) {
      sessionStorage.removeItem(LOGOUT_KEY);
      toast('已登出，這台裝置上的資料已清除');
    }
  } catch (_) {}

  // ---------- 訊息匣（見 inbox.js） ----------
  // 點訊息：打開那一筆資料、打開試算表、切到相關頁面或同步
  Inbox.init({
    onAction(a) {
      if (a.type === 'record') {
        if (!Store.get(a.table, a.id)) {
          toast('這筆資料已經不在了');
          return;
        }
        showTab(a.table);
        Form.open(a.table, a.id);
      } else if (a.type === 'tab') {
        showTab(a.tab);
        window.scrollTo(0, 0);
      } else if (a.type === 'sheet') {
        const url = Sync.state().url;
        if (url) window.open(url, '_blank', 'noopener');
        else toast('還沒有連結 Google 試算表');
      } else if (a.type === 'sync') {
        Sync.syncNow();
      } else if (a.type === 'announce-apply') {
        // 除權息和公告不一樣：改成公告的數字（會照常同步到試算表）
        if (!Store.get('dividends', a.id)) {
          toast('這筆資料已經不在了');
          return;
        }
        Store.update('dividends', a.id, a.values);
        clearTimeout(checkTimer); // 當下就重新核對，這則訊息馬上變成已解決（和加入一樣）
        Inbox.checkData();
        refreshAll();
        toast('已改成公告的數字');
      } else if (a.type === 'announce-keep') {
        // 保留我的、勾選的不用記：記在這台裝置，之後不再問（見 announced.js）
        Announced.keep(a.keys);
        Inbox.checkData();
        toast(a.skip ? `這 ${a.keys.length} 筆不用記，之後不再提醒` : '好，保留你記的');
      } else if (a.type === 'announce-add') {
        // 還沒記的除權息：加入勾選的（基準日股數自動推算）；一次加完，只存一次
        //   當下就重新核對（不等延後的那次）：這則訊息馬上變成已解決、按鈕不見，連點兩下不會加兩次
        Store.addMany('dividends', a.rows.map(r =>
          ({ code: r.code, name: r.name, exDate: r.exDate, payDate: r.payDate, cash: r.cash, stock: r.stock, baseShares: {} })));
        clearTimeout(checkTimer);
        Inbox.checkData();
        refreshAll();
        toast(`已加入 ${a.rows.length} 筆除權息`);
      }
    },
  });
  // 資料有變動就重新核對（庫存快照對不上、股利算不出來、沒填代號）
  //   等這次點擊的畫面先出來再核對，連續改好幾筆只核對一次；核對只看交易、快照、除權息和成員，
  //   改觀察清單、現金單、帳戶紀錄不用重新核對
  Inbox.checkData();
  let checkTimer = null;
  Store.onChange(table => {
    if (['watch', 'cashPools', 'history'].includes(table)) return;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => Inbox.checkData(), 100);
  });

  // 公告的除權息（見 announced.js）：打開時下載，從背景切回來、網路恢復時再檢查；下載到新的就重畫、比對公告
  if (typeof Announced !== 'undefined' && Announced.load) {
    //   用到公告的只有總覽（即將除權息卡片）、即將除權息、殖利率、★ 星星、詳細頁，其他頁（交易明細、帳戶紀錄這種長清單）不用重畫
    Announced.onChange(() => {
      ['overview', 'upcoming', 'yield', 'stars'].forEach(k => lists[k].refresh());
      Detail.refresh();
      Inbox.checkData();
    });
    Announced.load();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) Announced.refresh(); });
    window.addEventListener('online', () => Announced.refresh());
  }

  // App 自己補資料（快照的收盤價、帳戶紀錄）的時機：收盤資料下載好、試算表的資料讀回來時
  //   連結 Google 時，這次打開 App 要先從試算表讀回最新的資料才補（免得用這台裝置舊的那份蓋掉別台改過的）；
  //   登入過期時不補（修改資料會跳出 Google 登入視窗，不是使用者點的不能跳）
  function canAutoSave() {
    if (!Market.ready()) return false;
    const st = Sync.state();
    return !st.linked || (st.problemsAt > 0 && !st.needLogin);
  }

  // 庫存快照的收盤價：還沒有、收盤資料裡有快照日期那一天的，自動補上（見 market.js 的 closeOn），之後就是存下來的數字，不會再變
  //   自己填過的不動
  function fillPrices() {
    if (!canAutoSave()) return;
    const changes = Store.list('snapshots', 'all')
      .filter(r => typeof r.price !== 'number')
      .map(r => ({ id: r.id, values: { price: Market.closeOn(r.code, r.date) } }))
      .filter(c => c.values.price !== null);
    if (!changes.length) return;
    Store.updateMany('snapshots', changes);
    lists.snapshots.refresh();
  }

  // 帳戶紀錄：收盤資料裡有收盤價的日子，每位成員記一筆付出成本和市值（見 history.js）；和收盤價一樣的時機、一樣的條件
  //   盤中先記的，收盤資料有那一天了就換成收盤價
  function recordHistory() {
    if (!canAutoSave()) return;
    const due = History.due();
    const settle = History.settle();
    if (!due.length && !settle.length) return;
    if (due.length) Store.addMany('history', due);
    if (settle.length) Store.updateMany('history', settle);
    lists.history.refresh();
    Trend.refresh();
  }

  // 收盤價和 KD（見 market.js）：和公告的除權息一樣，打開時下載，從背景切回來、網路恢復時再檢查；下載到新的就重畫總覽和選股
  //   股利的即將除權息也有「約佔現價幾 %」
  Market.onChange(() => {
    lists.overview.refresh();
    lists.upcoming.refresh();
    lists.cash.refresh();
    refreshMarket();
    Detail.refresh();
    fillPrices();
    recordHistory();
  });
  Market.load();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Market.refresh(); });
  window.addEventListener('online', () => Market.refresh());

  // EPS（見 eps.js）：和收盤價一樣，打開時下載，從背景切回來、網路恢復時再檢查；下載到新的就重畫選股（EPS 頁、星星）
  Eps.onChange(() => {
    refreshMarket();
    Detail.refresh();
  });
  Eps.load();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Eps.refresh(); });
  window.addEventListener('online', () => Eps.refresh());

  // 試算表的資料讀回來之後，全部重畫；和這台裝置的一樣（changed 是 false）時不用重畫、重新核對
  //   這次打開 App 第一次讀回來（包括剛連結）照樣重畫：寫著「連結 Google 帳號後…」的地方要換掉
  let synced = false;
  Sync.init({
    toast,
    notify: Inbox.add,
    onData(changed = true) {
      renderScopeBar();
      if (changed || !synced) {
        refreshAll();
        Inbox.checkData();
      }
      synced = true;
      fillPrices();
      recordHistory();
      if (menu.open) {
        renderMembers();
        renderBackupInfo();
      }
    },
    onStatus(st) {
      renderSyncBar(st);
      renderCloud(st);
      Inbox.syncStatus(st);
    },
    // 讀回新的股價：持股總覽、殖利率、EPS（預估殖利率）、K 線（月線往哪裡彎、扣低）、星星（殖利率的星星）、股利的即將除權息（約幾 %）、現金單重畫
    //   KD 頁只用收盤價，不用重畫；詳細頁 K 線大圖正在打價格時不重畫（見 detail.js 的 refresh）
    onPrices() {
      lists.overview.refresh();
      lists.cash.refresh();
      lists.yield.refresh();
      lists.eps.refresh();
      lists.kline.refresh();
      lists.stars.refresh();
      lists.upcoming.refresh();
      Detail.refresh();
    },
    // 登出：這台裝置的資料已經清掉，重新載入頁面，畫面和記在記憶體裡的東西全部從空白開始
    //   手機裡存的畫面和程式也一起清掉（見 sw.js），重新載入時從網站重抓：萬一被同網址的其他網頁動過手腳，登出後不會還留著
    async onLogout() {
      try { sessionStorage.setItem(LOGOUT_KEY, '1'); } catch (_) {}
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('stockbook-')).map(k => caches.delete(k)));
        await (await navigator.serviceWorker?.getRegistration())?.unregister();
      } catch (_) {}
      location.reload();
    },
  });

  // 離線也打得開（見 sw.js）：版本號跟著這個檔案網址後面的 ?v=，換版本時存在手機裡的那份也一起換
  if ('serviceWorker' in navigator) {
    const v = new URL(document.currentScript?.src || location.href).searchParams.get('v') || '';
    navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(v)}`).catch(() => {});
    // 資料檔網路太慢、先用了手機裡存的那份時，網路後來回應、內容不一樣，sw.js 會通知：重新讀一次，有新的就重畫
    const DATA = { 'shared/prices.json': Market, 'shared/eps.json': Eps, 'shared/dividends.json': Announced, 'shared/candles.json': Candles, 'shared/etf.json': Etf };
    navigator.serviceWorker.addEventListener('message', e => DATA[e.data?.fresh]?.load(true));
  }
})();
