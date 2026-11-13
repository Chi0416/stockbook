


(() => {
  const TAB_KEY = U.key('tab');
  const PAGES_KEY = U.key('pages');
  const LOGOUT_KEY = U.key('loggedOut');
  const $ = id => document.getElementById(id);



  const fontCss = document.querySelector('link[rel="stylesheet"][media="print"]');
  if (fontCss) {
    if (fontCss.sheet) fontCss.media = 'all';
    else fontCss.addEventListener('load', () => { fontCss.media = 'all'; });
  }


  const toastEl = $('toast');
  let toastTimer;
  function toast(msg, kind = '') {
    (document.querySelector('dialog[open]') || document.body).appendChild(toastEl);
    toastEl.textContent = msg;
    toastEl.className = `show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = ''; }, kind === 'error' ? 3500 : 1800);
  }





  const PAGES = { overview: OVERVIEW, inventory: INVENTORY, ...SCHEMAS, ...VIEWS, upcoming: UPCOMING_PAGE, cash: CASH_PAGE, quoteHeld: { title: '庫存' }, quoteWatch: { title: '自選' }, quoteYield: { title: '殖利率' }, quoteScreen: { title: '篩選' }, quoteDeduct: { title: '扣抵' }, quoteKd: { title: 'KD' }, quoteEps: { title: 'EPS' }, quoteForecast: { title: '股利預估' }, alerts: { title: '到價' } };
  const lists = {};
  let current = 'overview';
  const openStock = (page, plan) => code => StockSheet.open(code, { list: lists[page].codes(), plan });
  const openMine = page => code => Mine.open(code, { list: lists[page].codes() });

  lists.overview = createOverview({ openStock: (code, list) => Mine.open(code, { list }), openTaiex: () => Taiex.open() });
  lists.inventory = createInventory({ openStock: code => Mine.open(code, { list: lists.inventory.codes(), full: true }) });
  $('panels').append(lists.overview.el, lists.inventory.el);
  Object.entries({ ...SCHEMAS, ...VIEWS }).forEach(([key, page]) => {
    if (page.noList) return;
    const formKey = page.source || key;
    lists[key] = createList(key, page, page.stock ? { openStock: openMine(key) } : { openForm: id => Form.open(formKey, id) });
    $('panels').appendChild(lists[key].el);
  });

  lists.upcoming = Upcoming.createPage({ onChanged: (k, rec) => onChanged(k, rec), toast, openStock: openMine('upcoming') });
  $('panels').appendChild(lists.upcoming.el);

  lists.cash = createCash({ openForm: (id, preset) => Form.open('cashPools', id, preset) });
  $('panels').appendChild(lists.cash.el);


  const MARKET = ['quoteHeld', 'quoteWatch', 'quoteYield', 'quoteScreen', 'quoteDeduct', 'quoteForecast', 'quoteKd', 'quoteEps'];
  lists.quoteHeld = createQuoteList('held', { openStock: openStock('quoteHeld') });
  lists.quoteWatch = createQuoteList('watch', { openStock: openStock('quoteWatch') });
  lists.quoteYield = createQuoteList('yield', { openStock: openMine('quoteYield'), view: YIELD_VIEW });
  $('panels').append(lists.quoteHeld.el, lists.quoteWatch.el, lists.quoteYield.el);


  const epsLink = { label: 'EPS、股利', open: code => { EpsDetails.need(); Mine.open(code, { extra: EPS_SHEET }); } };
  lists.quoteScreen = createQuoteList('screen', { openStock: code => StockSheet.open(code, { list: lists.quoteScreen.codes(), link: epsLink }), view: SCREEN_VIEW });
  lists.quoteDeduct = createQuoteList('deduct', { openStock: openStock('quoteDeduct', DEDUCT_PLAN), view: DEDUCT_VIEW });

  const openEps = from => code => {
    EpsDetails.need();
    Mine.open(code, { list: lists[from].codes(), extra: EPS_SHEET });
  };
  lists.quoteForecast = createQuoteList('forecast', { openStock: openEps('quoteForecast'), view: FORECAST_VIEW });

  lists.quoteEps = createQuoteList('eps', { openStock: openEps('quoteEps'), view: EPS_VIEW });

  lists.quoteKd = createQuoteList('kd', { openStock: openStock('quoteKd'), view: KD_VIEW });
  $('panels').append(lists.quoteScreen.el, lists.quoteDeduct.el, lists.quoteKd.el, lists.quoteEps.el, lists.quoteForecast.el);

  lists.alerts = Alerts.createPage({ openStock: code => StockSheet.open(code, { list: lists.alerts.codes(), menu: true }) });
  $('panels').appendChild(lists.alerts.el);
  const refreshMarket = () => MARKET.forEach(k => lists[k].refresh());


  const changePage = (k, rec) => (lists[k].defer && $('form-sheet').open ? lists[k].defer(rec) : lists[k].changed(rec));


  function onChanged(key, rec) {


    if (key === 'watch') {
      MARKET.forEach(k => (k === current ? lists[k].changed(rec) : lists[k].refresh()));
      return;
    }

    if (key === 'cashPools') {
      lists.cash.changed(rec);
      return;
    }

    if (key === 'alerts') {
      lists.alerts.changed(rec);
      StockSheet.refresh();
      renderAlertTab();
      return;
    }
    changePage(key, rec);

    Object.entries(VIEWS).forEach(([v, view]) => {
      if (view.source === key && current === v) changePage(v, rec);
      else lists[v].refresh();
    });


    Object.keys(lists).forEach(k => { if (k !== key && !VIEWS[k]) lists[k].refresh(); });
  }
  Form.init({ toast, onChanged, onClosed: () => lists[current].shown?.() });
  StockSheet.init({ toast, onChanged });

  Candles.onChange(() => {
    refreshMarket();
    lists.alerts.refresh();
    StockSheet.refresh();
  });










  const GROUPS = [
    { key: 'overview', label: '總覽', pages: [['overview', '總覽']] },

    { key: 'market', label: '行情', remember: true, pages: [['quoteHeld', '庫存'], ['quoteWatch', '自選'], ['quoteYield', '殖利率']] },
    { key: 'income', label: '股利', remember: true, pages: [['cashDividends', '股利'], ['upcoming', '即將除權息'], ['cash', '現金單']] },
    { key: 'book', label: '帳務', pages: [['inventory', '庫存'], ['realized', '損益'], ['trades', '交易紀錄'], ['dividends', '除權息'], ['history', '帳戶紀錄'], ['snapshots', '庫存快照']] },
    { key: 'picks', label: '選股', remember: true, pages: [['quoteScreen', '篩選'], ['quoteDeduct', '扣抵'], ['quoteKd', 'KD'], ['quoteEps', 'EPS'], ['quoteForecast', '股利預估'], ['alerts', '到價']] },
  ];
  let lastPages = {};
  try { lastPages = JSON.parse(localStorage.getItem(PAGES_KEY)) || {}; } catch (_) {}

  const OLD = Object.fromEntries(['yieldHeld', 'yieldWatch', 'yield', 'kd', 'eps', 'kline', 'etfs', 'stars'].map(k => [k, 'market']));
  const groupOf = key => GROUPS.find(g => g.key === key || g.pages.some(([k]) => k === key));

  const ADD = {
    inventory: ['trades', '交易'], realized: ['trades', '交易'], trades: ['trades', '交易'], snapshots: ['snapshots', '快照'], history: ['history', '紀錄'],
    dividends: ['dividends', '除權息'],
    quoteHeld: ['watch', '自選'], quoteWatch: ['watch', '自選'], quoteYield: ['watch', '自選'], quoteScreen: ['watch', '自選'], quoteDeduct: ['watch', '自選'], quoteForecast: ['watch', '自選'], quoteEps: ['watch', '自選'], quoteKd: ['watch', '自選'],
    alerts: ['alerts', '到價'],
  };
  const tabBtns = [...document.querySelectorAll('.tabbar [data-tab]')];
  const subtabsEl = $('subtabs');
  const addBtn = $('btn-add');
  const addWhat = addBtn.querySelector('.add-what');


  function renderSubtitle() {
    const subEl = $('page-sub');
    if (!subEl) return;
    const sub = PAGES[current].subtitle ? PAGES[current].subtitle() : '';
    subEl.textContent = sub;
    subEl.hidden = !sub;
  }



  function showTab(key) {
    key = OLD[key] || key;
    const group = groupOf(key) || GROUPS[0];
    if (group.key === key) {

      const last = group.remember && lastPages[group.key];
      key = group.pages.some(([k]) => k === last) ? last : group.pages[0][0];
    }
    if (!lists[key]) key = 'overview';
    current = key;
    if (group.remember) lastPages[group.key] = key;
    $('page-title').textContent = group.pages.length > 1 ? group.label : PAGES[key].title;
    renderSubtitle();
    if (subtabsEl) {
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
    lists[key].shown?.();
    if (key === 'quoteDeduct') Deducts.need();
    if (key === 'quoteForecast') Forecasts.need();
    if (key === 'quoteEps') EpsDetails.need();
    if (key === 'quoteScreen') Screens.need();
    if (key === 'quoteHeld' || key === 'quoteWatch' || key === 'quoteDeduct' || key === 'quoteKd' || key === 'alerts') Candles.need();
    try {
      localStorage.setItem(TAB_KEY, key);
      localStorage.setItem(PAGES_KEY, JSON.stringify(lastPages));
    } catch (_) {}
  }


  let alertCheckShown = null;
  function renderAlertTab() {
    const btn = tabBtns.find(b => b.dataset.tab === 'picks');
    if (!btn) return;
    btn.hidden = !Alerts.enabled();
    if (btn.hidden && groupOf(current).key === 'picks') showTab('overview');
    if (Sync.alertCheck() !== alertCheckShown) {
      alertCheckShown = Sync.alertCheck();
      lists.alerts.refresh();
    }
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
    StockSheet.refresh();
    Mine.refresh();
    Trend.refresh();
  };



  const scopeBar = $('scope-bar');

  function renderScopeBar() {
    scopeBar.hidden = Store.scope === 'all';
    scopeBar.querySelector('.scope-names').textContent = Store.shown().map(id => Store.memberName(id)).join('、');
  }

  scopeBar.addEventListener('click', () => openMenu('members'));



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


  const menu = $('menu-sheet');

  function renderBackupInfo() {
    $('stats').innerHTML = Object.entries(SCHEMAS).map(([k, s]) =>
      `<div><dt>${s.title}</dt><dd>${Store.list(k, 'all').length}</dd></div>`).join('');
    const t = Store.lastExportAt();
    $('last-export').textContent = t ? `上次匯出：${U.fmtDateTime(t)}` : '尚未匯出過備份';
  }


  function openMenu(section) {
    Google.load();
    renderMembers();
    renderKdMarks();
    renderBackupInfo();
    if (!menu.open) menu.showModal();
    const head = { members: 'members-head', kd: 'kd-head' }[section];
    if (head && $(head)) $(head).scrollIntoView({ block: 'start' });
  }

  $('btn-menu').addEventListener('click', () => openMenu());
  menu.querySelector('[data-act="close"]').addEventListener('click', () => menu.close());
  menu.addEventListener('click', e => { if (e.target === menu) menu.close(); });


  const kdLow = $('kd-low');
  const kdHigh = $('kd-high');
  function renderKdMarks() {
    if (!kdLow || !kdHigh) return;
    const opts = (list, v) => list.map(n => `<option value="${n}"${n === v ? ' selected' : ''}>${n}</option>`).join('');
    kdLow.innerHTML = opts(KD.LOWS, KD.low);
    kdHigh.innerHTML = opts(KD.HIGHS, KD.high);
  }
  [kdLow, kdHigh].forEach(sel => sel?.addEventListener('change', () => KD.set(+kdLow.value, +kdHigh.value)));
  KD.onChange(m => {
    StockSheet.refresh();
    lists.quoteKd.refresh();
    lists.quoteScreen.refresh();
    toast(`KD：低於 ${m.low} 綠色、高於 ${m.high} 紅色`);
  });
  $('panels').addEventListener('click', e => { if (e.target.closest('[data-act="kd-marks"]')) openMenu('kd'); });

  $('panels').addEventListener('click', e => { if (e.target.closest('[data-act="screen-edit"]')) ScreenSheet.open(); });

  $('panels').addEventListener('click', e => {
    if (!e.target.closest('[data-act="upcoming-all"]')) return;
    showTab('upcoming');
    window.scrollTo(0, 0);
  });

  Trend.init({ showHistory: () => { showTab('history'); window.scrollTo(0, 0); } });

  Taiex.init();


  Note.el?.addEventListener('click', e => {
    if (e.target.closest('[data-act]')?.dataset.act !== 'kd-marks') return;
    Note.close();
    openMenu('kd');
  });


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
      ...(bad.length ? [`\n有 ${bad.length} 個日期看不懂（例如「${bad[0].slice(0, 20)}」），匯入後會變成沒填日期，要到帳務裡補上`] : []),
    ];

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


  const cloudEl = $('cloud');
  const syncBar = $('sync-bar');
  const syncText = syncBar.querySelector('.sync-text');
  const syncBtn = syncBar.querySelector('.sync-btn');
  let syncAction = null;


  const STALE = 60 * 60000;
  function ago(iso) {
    const min = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 60000));
    if (min < 60) return `${min} 分鐘前`;
    const h = Math.floor(min / 60);
    return h < 24 ? `${h} 小時前` : `${Math.floor(h / 24)} 天前`;
  }


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

      text = '登入過期，現價不會自動更新';
      btn = '同步';
      syncAction = Sync.syncNow;
    } else if (st.needLogin && (!st.lastSyncAt || Date.now() - Date.parse(st.lastSyncAt) > STALE)) {

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


  if (!Store.available) {
    const banner = $('banner');
    banner.textContent = '這個瀏覽器目前不允許儲存資料（可能是無痕模式或隱私設定），輸入的資料關掉頁面後就會消失。';
    banner.hidden = false;
  }

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  renderScopeBar();
  refreshAll();

  let renderedDay = U.today();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || U.today() === renderedDay) return;
    renderedDay = U.today();
    refreshAll();
    renderSubtitle();
  });
  let savedTab = 'overview';
  try { savedTab = localStorage.getItem(TAB_KEY) || 'overview'; } catch (_) {}

  const linked = location.hash.slice(1);
  if (GROUPS.some(g => g.key === linked)) {
    savedTab = linked;
    history.replaceState(null, '', location.pathname + location.search);
  }
  showTab(savedTab);
  try {
    if (sessionStorage.getItem(LOGOUT_KEY)) {
      sessionStorage.removeItem(LOGOUT_KEY);
      toast('已登出，這台裝置上的資料已清除');
    }
  } catch (_) {}



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

        if (!Store.get('dividends', a.id)) {
          toast('這筆資料已經不在了');
          return;
        }
        Store.update('dividends', a.id, a.values);
        clearTimeout(checkTimer);
        Inbox.checkData();
        refreshAll();
        toast('已改成公告的數字');
      } else if (a.type === 'announce-keep') {

        Announced.keep(a.keys);
        Inbox.checkData();
        toast(a.skip ? `這 ${a.keys.length} 筆不用記，之後不再提醒` : '好，保留你記的');
      } else if (a.type === 'announce-add') {


        Store.addMany('dividends', a.rows.map(r =>
          ({ code: r.code, name: r.name, exDate: r.exDate, payDate: r.payDate, cash: r.cash, stock: r.stock, baseShares: {} })));
        clearTimeout(checkTimer);
        Inbox.checkData();
        refreshAll();
        toast(`已加入 ${a.rows.length} 筆除權息`);
      }
    },
  });



  Inbox.checkData();
  let checkTimer = null;
  Store.onChange(table => {
    if (['watch', 'cashPools', 'history', 'alerts'].includes(table)) return;
    clearTimeout(checkTimer);
    checkTimer = setTimeout(() => Inbox.checkData(), 100);
  });


  if (typeof Announced !== 'undefined' && Announced.load) {

    Announced.onChange(() => {
      ['overview', 'upcoming', 'quoteYield'].forEach(k => lists[k].refresh());
      Mine.refresh();
      Inbox.checkData();
    });
    Announced.load();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) Announced.refresh(); });
    window.addEventListener('online', () => Announced.refresh());
  }




  function canAutoSave() {
    if (!Market.ready()) return false;
    const st = Sync.state();
    return !st.linked || (st.problemsAt > 0 && !st.needLogin);
  }



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



  function recordHistory() {
    if (!canAutoSave()) return;
    const due = History.due();
    const settle = History.settle();
    if (!due.length && !settle.length) return;
    if (due.length) Store.addMany('history', due);
    if (settle.length) Store.updateMany('history', settle);
    lists.history.refresh();
    lists.realized.refresh();
    Trend.refresh();
  }


  Market.onChange(() => {
    lists.overview.refresh();
    lists.inventory.refresh();
    lists.realized.refresh();
    lists.cash.refresh();
    lists.alerts.refresh();
    refreshMarket();
    Mine.refresh();
    fillPrices();
    recordHistory();
  });
  Market.load();

  Deducts.onChange(() => {
    lists.quoteDeduct.refresh();
    StockSheet.refresh();
  });
  Forecasts.onChange(() => lists.quoteForecast.refresh());
  Screens.onChange(() => {
    lists.quoteScreen.refresh();
    ScreenSheet.refresh();
  });
  Screener.onChange(() => lists.quoteScreen.refresh());
  EpsDetails.onChange(() => {
    lists.quoteEps.refresh();
    Mine.refresh();
  });
  Yields.onChange(() => {
    lists.quoteYield.refresh();
    lists.quoteForecast.refresh();
    Mine.refresh();
  });
  Yields.load();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Yields.refresh(); });
  window.addEventListener('online', () => Yields.refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) Market.refresh(); });
  window.addEventListener('online', () => Market.refresh());



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
      renderAlertTab();
    },

    onPrices() {
      lists.inventory.refresh();
      lists.alerts.refresh();
      lists.cash.refresh();
      Mine.refresh();
    },


    async onLogout() {
      try { sessionStorage.setItem(LOGOUT_KEY, '1'); } catch (_) {}
      try {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith(`${U.site}-`)).map(k => caches.delete(k)));
        await (await navigator.serviceWorker?.getRegistration())?.unregister();
      } catch (_) {}
      location.reload();
    },
  });


  if ('serviceWorker' in navigator) {
    const v = new URL(document.currentScript?.src || location.href).searchParams.get('v') || '';
    navigator.serviceWorker.register(`sw.js?v=${encodeURIComponent(v)}&site=${U.site}&data=${encodeURIComponent(U.DATA_BASE)}`).catch(() => {});


    const DATA = { prices: Market, dividends: Announced, candles: Candles, taiex: Taiex, yield: Yields, ma: Deducts, forecast: Forecasts, epsdetail: EpsDetails, screen: Screens };
    navigator.serviceWorker.addEventListener('message', e => (Object.hasOwn(DATA, e.data?.fresh) ? DATA[e.data.fresh].load(true) : null));
  }
})();
