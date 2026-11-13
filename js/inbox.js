









const Inbox = (() => {
  const KEY = U.key('inbox');
  const MAX = 100;
  const $ = id => document.getElementById(id);

  let items = load();
  let els = null;
  let hooks = { onAction() {} };

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY));
      return Array.isArray(v) ? v : [];
    } catch (_) {
      return [];
    }
  }


  const done = m => m.read && (m.kind === 'event' || m.resolved);



  function trim() {
    if (items.length <= MAX) return;
    const oldest = [...items].sort((a, b) => a.at - b.at);
    const drop = new Set();
    for (const pass of [done, m => m.kind === 'event' || m.resolved]) {
      for (const m of oldest) {
        if (items.length - drop.size <= MAX) break;
        if (pass(m)) drop.add(m);
      }
    }
    items = items.filter(m => !drop.has(m));
  }

  function save() {
    trim();
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (_) {}
    render();
  }



  function add({ title, body = '', action = null }) {
    items.push({
      key: `event:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
      kind: 'event', title, body, action, at: Date.now(), read: false,
    });
    save();
  }




  function reconcile(prefix, list) {
    const now = Date.now();
    const current = new Set(list.map(i => i.key));
    const extra = i => ({ action: i.action || null, buttons: i.buttons || null, list: i.list || null });
    const same = (m, i) => m.title === i.title && m.body === (i.body || '') &&
      JSON.stringify([m.buttons || null, m.list || null]) === JSON.stringify([i.buttons || null, i.list || null]);
    let changed = false;
    list.forEach(i => {
      const m = items.find(x => x.key === i.key);
      if (!m) {
        items.push({ key: i.key, kind: 'issue', title: i.title, body: i.body || '', ...extra(i), at: now, read: false, resolved: false });
        changed = true;
      } else if (m.resolved || !same(m, i)) {
        Object.assign(m, { title: i.title, body: i.body || '', ...extra(i), at: now, read: false, resolved: false });
        changed = true;
      }
    });
    items.forEach(m => {
      if (m.kind === 'issue' && m.key.startsWith(prefix) && !m.resolved && !current.has(m.key)) {
        m.resolved = true;
        changed = true;
      }
    });
    if (changed) save();
  }


  const who = id => (id && Store.members().length > 1 ? `${Store.memberName(id)} ` : '');

  function checkData() {
    reconcile('check:', Holdings.check('all').filter(c => c.status === 'diff').map(c => ({
      key: `check:${c.member}:${c.date}:${c.code}`,
      title: '庫存快照和交易紀錄對不上',
      body: `${who(c.member)}${c.code} ${c.name}（${U.fmtDate(c.date)} 快照）：推算 ${U.fmtNum(c.expected)} 股（${c.formula}），`
        + (c.recId ? `快照是 ${U.fmtNum(c.actual)} 股` : '但這一期快照裡沒有'),
      action: c.recId ? { type: 'record', table: 'snapshots', id: c.recId } : { type: 'tab', tab: 'snapshots' },
    })));

    reconcile('dividend:', VIEWS.cashDividends.rows('all').filter(r => r.missing).map(r => ({
      key: `dividend:${r.id}:${r.member || ''}`,
      title: '股利算不出來',
      body: `${who(r.member)}${r.code} ${r.name}（${U.fmtDate(r.payDate)} 發放）：${r.basis}`,
      action: { type: 'record', table: 'dividends', id: r.id },
    })));


    reconcile('nocode:', ['trades', 'snapshots'].flatMap(t => Store.list(t, 'all')
      .filter(r => !Holdings.codeOf(r))
      .map(r => ({
        key: `nocode:${t}:${r.id}`,
        title: `${SCHEMAS[t].title}沒填代號`,
        body: `${who(r.member)}${U.fmtDate(r.date)} ${r.name || '（沒有證券名稱）'}：沒有代號就沒辦法算進持股和股利`,
        action: { type: 'record', table: t, id: r.id },
      }))));

    checkAnnounced();
  }






  const md = d => (String(d).startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
  const LABEL = { exDate: '除權息日', payDate: '發放日', cash: '每股現金股利', stock: '股票股利' };
  const show = (k, v) => (/Date$/.test(k) ? U.fmtDate(v) : U.fmtNum(Number(v) || 0));

  function usedName(code, fallback) {
    for (const t of ['dividends', 'trades', 'snapshots']) {
      const r = Store.list(t, 'all').slice().reverse().find(x => Holdings.codeOf(x) === code && x.name);
      if (r) return r.name;
    }
    return fallback;
  }

  function checkAnnounced() {


    if (typeof Announced === 'undefined' || (Announced.ready && !Announced.ready())) return;
    const recorded = Store.list('dividends', 'all');
    reconcile('announce-diff:', Announced.diffs(recorded).map(x => ({
      key: `announce-${x.key}`,
      title: '除權息和公告不一樣',
      body: `${x.record.code} ${x.record.name}（${U.fmtDate(x.record.exDate)} 除權息）\n` +
        x.fields.map(k => `${LABEL[k]}：你記的 ${show(k, x.record[k])}，公告是 ${show(k, x.announced[k])}`).join('\n'),
      buttons: [
        { label: '改成公告的', action: { type: 'announce-apply', id: x.record.id,
          values: { exDate: x.announced.exDate, payDate: x.announced.payDate, cash: x.announced.cash, stock: x.announced.stock } } },
        { label: '保留我的', action: { type: 'announce-keep', keys: [x.key] } },
      ],
    })));

    const members = Store.members();
    const codes = ['trades', 'snapshots'].flatMap(t => Store.list(t, 'all').map(Holdings.codeOf)).filter(Boolean);
    const held = (code, exDate) => members.some(m => Holdings.position(m.id, code, exDate, false).shares > 0);
    const miss = Announced.missing({ recorded, codes: [...new Set(codes)], held, today: U.today() });
    reconcile('announce-missing', miss.length ? [{
      key: 'announce-missing',
      title: `有 ${miss.length} 筆除權息可以帶入`,
      body: '公告裡有、家裡當時持有，還沒記在「除權息」。勾選要加入的：',
      list: miss.map(r => ({ id: `${r.code}:${r.exDate}`, code: r.code, name: usedName(r.code, r.name),
        exDate: r.exDate, payDate: r.payDate, cash: r.cash, stock: r.stock })),
    }] : []);
  }




  let seenOkAt = 0;
  let seenProblemsAt = 0;

  function syncStatus(st) {
    if (!st.linked) {
      reconcile('sync:', []);
      reconcile('sheet:', []);
      return;
    }
    if (st.error && !st.running) {
      reconcile('sync:', [{ key: 'sync:error', title: '同步失敗', body: st.error, action: { type: 'sync' } }]);
    } else if (st.okAt && st.okAt !== seenOkAt) {
      seenOkAt = st.okAt;
      reconcile('sync:', []);
    }
    if (st.problemsAt && st.problemsAt !== seenProblemsAt) {
      seenProblemsAt = st.problemsAt;
      const byTab = new Map();
      st.problems.forEach(p => byTab.set(p.tab, [...(byTab.get(p.tab) || []), p]));
      reconcile('sheet:', [...byTab].map(([tab, list]) => ({
        key: `sheet:${tab}`,
        title: `試算表「${tab}」有 ${list.length} 個地方看不懂`,
        body: list.slice(0, 5).map(p => `${p.row ? `第 ${p.row} 列：` : ''}${p.msg}`).join('\n')
          + (list.length > 5 ? `\n…還有 ${list.length - 5} 個` : ''),
        action: { type: 'sheet' },
      })));
    }
  }


  const unread = () => items.filter(m => !m.read).length;

  function markAllRead() {
    if (!unread()) return;
    items.forEach(m => { m.read = true; });
    save();
  }


  function clearRead() {
    items = items.filter(m => !done(m));
    save();
  }


  function timeText(ms) {
    const d = new Date(ms);
    const hm = `${U.pad2(d.getHours())}:${U.pad2(d.getMinutes())}`;
    const day = `${d.getFullYear()}-${U.pad2(d.getMonth() + 1)}-${U.pad2(d.getDate())}`;
    return day === U.today() ? `今天 ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
  }


  const personal = m => /^(check|dividend):/.test(m.key);


  const listHTML = m => `
    <span class="msg-list">${m.list.map(r => `
      <label class="msg-check"><input type="checkbox" checked data-row="${U.esc(r.id)}">
        <span><b>${U.esc(r.code)} ${U.esc(r.name)}</b><small>${U.esc(md(r.exDate))} 除息、${U.esc(md(r.payDate))} 發放、每股 ${U.fmtNum(r.cash)}${
          r.stock ? `、配股 ${U.fmtNum(r.stock)}` : ''}</small></span>
      </label>`).join('')}
    </span>
    <span class="msg-actions">
      <button type="button" class="msg-btn primary" data-key="${U.esc(m.key)}" data-list="add">加入勾選的</button>
      <button type="button" class="msg-btn" data-key="${U.esc(m.key)}" data-list="skip">勾選的不用記</button>
    </span>`;
  const buttonsHTML = m => `
    <span class="msg-actions">${m.buttons.map((b, j) =>
      `<button type="button" class="msg-btn${j ? '' : ' primary'}" data-key="${U.esc(m.key)}" data-btn="${j}">${U.esc(b.label)}</button>`).join('')}
    </span>`;

  function msgHTML(m) {

    const choices = !m.resolved && (m.buttons || m.list);
    const go = !choices && m.action && !m.resolved;
    const tag = go ? 'button' : 'div';
    const body = personal(m) ? Privacy.text(m.body) : m.body;
    return `
      <li>
        <${tag}${go ? ' type="button"' : ''} class="msg${m.read ? '' : ' unread'}${m.resolved ? ' resolved' : ''}" data-key="${U.esc(m.key)}">
          <span class="msg-head"><b>${U.esc(m.title)}</b><time>${timeText(m.at)}</time></span>
          ${body ? `<span class="msg-body">${U.esc(body)}</span>` : ''}
          ${choices && m.list ? listHTML(m) : ''}
          ${choices && m.buttons ? buttonsHTML(m) : ''}
          ${m.resolved ? '<span class="msg-tag">已解決</span>' : ''}
          ${go ? '<span class="msg-go" aria-hidden="true">›</span>' : ''}
        </${tag}>
      </li>`;
  }

  function render() {
    if (!els) return;
    const n = unread();
    els.count.textContent = n > 99 ? '99+' : String(n);
    els.count.hidden = !n;
    els.bell.setAttribute('aria-label', n ? `訊息（${n} 則未讀）` : '訊息');
    els.clear.disabled = !items.some(done);
    els.list.innerHTML = [...items].sort((a, b) => b.at - a.at).map(msgHTML).join('');
    els.empty.hidden = items.length > 0;
  }


  function open() {
    render();
    const wide = matchMedia('(min-width: 700px)').matches;
    const r = els.bell.getBoundingClientRect();
    els.dlg.style.marginTop = wide ? `${Math.round(r.bottom + 8)}px` : '';
    els.dlg.style.marginRight = wide ? `${Math.max(16, Math.round(innerWidth - r.right))}px` : '';
    if (!els.dlg.open) els.dlg.showModal();
  }

  function init(h) {
    hooks = { ...hooks, ...h };
    els = {
      bell: $('btn-inbox'),
      count: $('inbox-count'),
      dlg: $('inbox-sheet'),
      list: $('inbox-list'),
      empty: $('inbox-empty'),
      clear: $('inbox-clear'),
    };
    els.bell.addEventListener('click', open);
    els.dlg.querySelector('[data-act="close"]').addEventListener('click', () => els.dlg.close());
    els.dlg.addEventListener('click', e => { if (e.target === els.dlg) els.dlg.close(); });
    els.dlg.addEventListener('close', markAllRead);
    els.clear.addEventListener('click', clearRead);

    els.list.addEventListener('click', e => {

      const choice = e.target.closest('[data-btn], [data-list]');
      if (choice) {
        const m = items.find(x => x.key === choice.dataset.key);
        if (!m) return;
        if (choice.dataset.btn != null) {
          hooks.onAction(m.buttons[+choice.dataset.btn].action);
          return;
        }
        const picked = [...choice.closest('.msg').querySelectorAll('input[data-row]:checked')]
          .map(x => m.list.find(r => r.id === x.dataset.row)).filter(Boolean);
        if (!picked.length) return;
        hooks.onAction(choice.dataset.list === 'add'
          ? { type: 'announce-add', rows: picked }
          : { type: 'announce-keep', keys: picked.map(r => `missing:${r.code}:${r.exDate}`), skip: true });
        return;
      }
      const btn = e.target.closest('button[data-key]');
      const m = btn && items.find(x => x.key === btn.dataset.key);
      if (!m?.action) return;
      els.dlg.close();
      hooks.onAction(m.action);
    });
    render();
  }

  return { init, open, render, add, reconcile, checkData, syncStatus, unread, markAllRead, clearRead, list: () => items };
})();
