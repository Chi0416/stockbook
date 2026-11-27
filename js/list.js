










function createList(tableKey, schema, { openForm, openStock }) {
  const fields = schema.fields;
  const byKey = Object.fromEntries(fields.map(f => [f.key, f]));
  const periodKey = schema.period.key;
  const { code, title, badge, primary, note } = schema.card;

  const gridFields = fields.filter(f => f.type !== 'member' && !f.auto && ![periodKey, code, title, badge, primary].includes(f.key));

  const nameOf = r => (schema.name ? schema.name.cell(r) : [r[title], code ? r[code] ?? '' : '']);
  const nameSort = schema.name ? periodKey : code;
  const getRows = schema.rows || (() => Store.list(tableKey));


  const table = schema.table;


  const STEP = 200;

  const initial = () => ({ period: null, keyword: '', flashId: null, mode: 'list', statsAll: false, statsOpen: new Set(), sort: periodKey, desc: true, limit: STEP });
  const state = initial();
  const asTable = () => table && !Cards.on;

  const codeAttr = r => (openStock && code && r[code] ? ` data-code="${U.esc(r[code])}"` : '');

  const periodOf = r => {
    const d = String(r[periodKey] ?? '');
    return schema.period.unit === 'month' ? d.slice(0, 7) : d;
  };

  const inPeriod = r => {
    if (!state.period) return true;
    const p = periodOf(r);
    return p === state.period || p.startsWith(`${state.period}-`);
  };
  const periodLabel = p => (p.length === 4 ? `${p} 年` : U.fmtDate(p));

  const matchKeyword = r =>
    `${code ? r[code] ?? '' : ''} ${r[title] ?? ''} ${r.member ? Store.memberName(r.member) : ''}`
      .toLowerCase().includes(state.keyword.trim().toLowerCase());


  const personal = (f, v) => !f.public && (f.type === 'number'
    || (f.type === 'perMember' && Object.values(v || {}).some(n => typeof n === 'number')));
  const show = (f, v) => {
    const s = U.display(f, v);
    return U.esc(personal(f, v) ? Privacy.num(s) : s) || '—';
  };

  const cardLabel = f => f.cardLabel || f.label;

  const tone = v => /買/.test(v) ? 'buy' : /賣/.test(v) ? 'sell' : '';
  const showMember = () => Store.shown().length > 1;

  const statusOf = r => (schema.status ? schema.status(r) : null);
  const isPending = r => !!statusOf(r)?.pending;


  const groupNoteHTML = n => (n
    ? `<p class="group-note${n.warn ? ' warn' : ''}">${U.esc(n.text)}${(n.lines || []).map(l => `<span>${U.esc(Privacy.text(l))}</span>`).join('')}` +
      `${n.sum ? `<span class="group-sum">${U.esc(n.sum)}</span>` : ''}</p>`
    : '');
  const cardNoteHTML = n => (n ? `<span class="card-note${n.warn ? ' warn' : ''}">${U.esc(Privacy.text(n.text))}</span>` : '');
  const introHTML = schema.intro ? Note.line(U.esc(schema.intro.line), schema.title, schema.intro.body) : '';

  const stats = schema.stats && { ...schema.stats, amount: schema.total.key, date: periodKey, code, name: title };
  const modeHTML = () => `
    <div class="seg" role="group" aria-label="檢視方式">
      ${[['list', '明細'], ['stats', '統計']].map(([m, label]) =>
        `<button type="button" data-act="mode" data-value="${m}" aria-pressed="${state.mode === m}">${label}</button>`).join('')}
    </div>`;


  const el = document.createElement('section');
  el.className = 'panel';
  el.hidden = true;
  el.innerHTML = `
    <div class="filterbar">
      <select class="f-period" aria-label="${schema.period.label}"></select>
      <input class="f-keyword" type="search" placeholder="${U.esc(schema.search || '搜尋代號或證券')}" autocomplete="off" enterkeyhint="search">
      <span class="count"></span>
    </div>
    <div class="list"></div>`;

  const periodSel = el.querySelector('.f-period');
  const keywordInput = el.querySelector('.f-keyword');
  const countEl = el.querySelector('.count');
  const listEl = el.querySelector('.list');

  periodSel.addEventListener('change', () => { state.period = periodSel.value; state.limit = STEP; renderList(); });

  const onKeyword = () => { state.keyword = keywordInput.value; state.limit = STEP; renderList(); };
  keywordInput.addEventListener('input', e => { if (!(e.isComposing && U.zhuyinPending(keywordInput.value))) onKeyword(); });
  keywordInput.addEventListener('compositionend', onKeyword);
  listEl.addEventListener('click', e => {
    const card = e.target.closest('.card, .trow[data-id]');
    if (card) {
      if (openStock) openStock(card.dataset.code);
      else openForm(card.dataset.id);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (btn) act(btn.dataset.act, btn.dataset.value);
  });




  function act(name, value) {
    if (name === 'period') {
      state.period = state.period === value ? value.slice(0, 4) : value;
      state.limit = STEP;
      refresh();
      return;
    }
    if (name === 'rows') {
      const from = state.limit;
      state.limit += STEP;
      renderList();
      listEl.querySelectorAll('[data-id]')[from]?.focus({ preventScroll: true });
      return;
    }
    if (name === 'sort') {
      state.limit = STEP;

      state.desc = state.sort === value ? !state.desc : value !== code;
      state.sort = value;
    } else if (name === 'mode') {
      state.mode = value;
      state.limit = STEP;
    }
    else if (name === 'more') state.statsAll = true;
    else if (name === 'code') {
      if (!state.statsOpen.delete(value)) state.statsOpen.add(value);
    } else return;
    renderList();
  }


  function renderPeriods() {

    const periods = [...new Set([...getRows().map(periodOf), ...(schema.extraPeriods ? schema.extraPeriods() : [])].filter(Boolean))].sort().reverse();
    const years = schema.period.unit === 'month' ? [...new Set(periods.map(p => p.slice(0, 4)))] : [];
    if (state.period === null || (state.period && ![...years, ...periods].includes(state.period))) {
      state.period = schema.defaultLatest ? (periods[0] || '') : '';
    }
    const opts = list => list.map(p => `<option value="${U.esc(p)}">${U.esc(periodLabel(p))}</option>`).join('');
    periodSel.innerHTML = `<option value="">全部${schema.period.label}</option>` +
      (years.length ? `<optgroup label="年">${opts(years)}</optgroup><optgroup label="月">${opts(periods)}</optgroup>` : opts(periods));
    periodSel.value = state.period;
  }

  function cardHTML(r, withMember, extra) {
    const pf = byKey[primary];
    const grid = gridFields.map(f =>
      `<span class="cell"><small>${cardLabel(f)}</small><span>${show(f, r[f.key])}</span></span>`).join('') +
      (schema.card.calc || []).filter(c => !c.when || c.when(r)).map(c =>
        `<span class="cell${c.tone && c.tone(r) ? ` ${c.tone(r)}` : ''}"><small>${U.esc(c.label)}</small><span>${c.value(r)}</span></span>`).join('');

    const st = statusOf(r);
    const tag = badge
      ? r[badge] && { label: r[badge], cls: tone(r[badge]) }
      : st;

    const tags = (withMember && r.member ? `<span class="badge member">${U.esc(Store.memberName(r.member))}</span>` : '') +
      (tag ? `<span class="badge ${tag.cls}">${U.esc(tag.label)}</span>` : '');
    return `
      <button type="button" class="card${r.id === state.flashId ? ' flash' : ''}${st?.pending ? ' pending' : ''}" data-id="${U.esc(r.id)}"${codeAttr(r)}>
        <span class="card-top">
          <span class="card-title">${tags ? `<span class="card-tags">${tags}</span>` : ''}${code && r[code] ? `<span class="card-code">${U.esc(r[code])}</span>` : ''}${U.esc(schema.name ? schema.name.card(r) : r[title])}</span>
          <span class="card-primary"><small>${cardLabel(pf)}</small><b>${show(pf, r[primary])}</b></span>
        </span>
        ${grid ? `<span class="card-grid">${grid}</span>` : ''}
        ${note && r[note] ? `<span class="card-note${r.missing ? ' warn' : ''}">${U.esc(Privacy.text(r[note]))}</span>` : ''}
        ${cardNoteHTML(extra)}
      </button>`;
  }


  const sortKey = c => c.sort || c.date || c.keys[0];
  const dirOf = k => (state.sort === k ? (state.desc ? 'desc' : 'asc') : '');

  function rowHTML(r, withMember, extra, shownCols) {
    const st = statusOf(r);

    const tag = badge ? r[badge] && tone(r[badge]) && { label: r[badge], cls: tone(r[badge]) } : st;
    const sub = (withMember && r.member ? ` · ${U.esc(Store.memberName(r.member))}` : '') +
      (tag ? ` <span class="badge ${tag.cls}">${U.esc(tag.label)}</span>` : '');
    const v = k => show(byKey[k], r[k]);
    const cells = shownCols.map(c => {
      if (c.date) return Table.date(String(r[c.date] ?? ''));
      const [a, b = ''] = c.cell ? c.cell(r, v) : c.keys.map(v);
      return Table.cell(a, b, [c.strong ? 'strong' : '', c.tone ? c.tone(r) : ''].filter(Boolean).join(' '));
    });

    const warn = note && r.missing && r[note] ? Privacy.text(r[note]) : extra?.warn ? Privacy.text(extra.text) : '';
    return Table.row({
      attrs: `data-id="${U.esc(r.id)}"${codeAttr(r)}`,
      cls: [r.id === state.flashId ? 'flash' : '', st?.pending ? 'pending' : ''].filter(Boolean).join(' '),
      cells: [Table.name(...nameOf(r), sub), ...cells],
      note: warn,
    });
  }

  function tableHTML(rows, withMember) {
    const notes = schema.annotate ? schema.annotate(rows) : null;

    const groups = Object.entries(notes?.groups || {}).sort(([a], [b]) => (a < b ? 1 : -1));
    const dated = (g, n) => (n.text ? { ...n, text: `${U.fmtDate(g)} ${n.text}` } : { ...n, sum: `${U.fmtDate(g)} ${n.sum}` });
    const groupNotes = groups.map(([g, n]) => groupNoteHTML(groups.length > 1 ? dated(g, n) : n)).join('');
    const valueCol = table.find(c => c.value && sortKey(c) === state.sort);
    const byField = state.sort === code ? r => U.toHalf(r[code] ?? '').toUpperCase()
      : valueCol ? valueCol.value : r => r[state.sort];

    const oneDay = schema.period.unit === 'day' && rows.every(r => r[periodKey] === rows[0][periodKey]);
    const shownCols = table.filter(c => !(oneDay && c.date === periodKey));
    const cols = [
      { label: schema.name ? schema.name.label : ['證券', '代號'], sort: nameSort, dir: dirOf(nameSort) },
      ...shownCols.map(c => ({ label: c.label, sort: sortKey(c), dir: dirOf(sortKey(c)) })),
    ];
    const sorted = Table.sort(rows, byField, state.desc);
    return groupNotes + Table.html(cols, limited(sorted).map(r => rowHTML(r, withMember, notes?.cards?.[r.id], shownCols))) + moreRowsHTML(sorted.length);
  }


  function limited(list) {
    const i = state.flashId ? list.findIndex(r => r.id === state.flashId) : -1;
    if (i >= state.limit) state.limit = (Math.floor(i / STEP) + 1) * STEP;
    return list.slice(0, state.limit);
  }
  const moreRowsHTML = total => (total > state.limit
    ? `<button type="button" class="wide-btn more-btn" data-act="rows">再顯示 ${U.fmtNum(Math.min(STEP, total - state.limit))} 筆（還有 ${U.fmtNum(total - state.limit)} 筆）</button>`
    : '');





  function summaryHTML(rows) {
    const { key, label, base, signed } = schema.total;
    const isNum = r => typeof r[key] === 'number';
    const total = list => U.round(list.reduce((s, r) => s + r[key], 0));
    const counted = rows.filter(r => !isPending(r) && isNum(r));
    const pending = rows.filter(r => isPending(r) && isNum(r));
    const who = Store.scopeLabel();
    const scope = [who, state.period && periodLabel(state.period)].filter(Boolean).join(' · ') || '全部';
    const missing = rows.length - counted.length - pending.length;
    const sum = total(counted);
    const tone = signed && !Privacy.hidden && sum ? (sum > 0 ? ' class="up"' : ' class="down"') : '';
    const baseSum = base ? counted.reduce((s, r) => s + (Number(r[base]) || 0), 0) : 0;
    const rate = baseSum > 0 ? `<span class="summary-rate">（${Privacy.num(`${U.fmtNum(U.round(sum / baseSum * 100, 2), 2)}%`)}）</span>` : '';
    return `
      <div class="summary">
        <small>${U.esc(scope)} ${label}合計</small>
        <b${tone}>${Privacy.num(U.fmtNum(sum))}${rate}${pending.length
          ? `<span class="summary-sep"> / </span><span class="summary-pend">${Privacy.num(U.fmtNum(total(pending)))}</span>` : ''}</b>
        ${pending.length ? `<span class="summary-pending">已入帳 / 待入帳</span>` : ''}
        ${missing ? `<span class="summary-note">另有 ${missing} 筆算不出來，未計入</span>` : ''}
        ${schema.total.more ? schema.total.more(state.period || '', state.keyword.trim()) : ''}
      </div>`;
  }

  function renderList() {
    const all = getRows();
    const kw = state.keyword.trim();

    const rows = all
      .filter(r => inPeriod(r) && (!kw || matchKeyword(r)))
      .sort((a, b) => {
        const x = String(a[periodKey] ?? ''), y = String(b[periodKey] ?? '');
        return x < y ? 1 : x > y ? -1 : 0;
      });

    countEl.textContent = rows.length === all.length ? `${all.length} 筆` : `${rows.length}／${all.length} 筆`;


    const always = !!schema.total?.more;
    const emptyHTML = () => (all.length ? `<p class="empty">${schema.none || '沒有符合條件的資料'}</p>`
      : `<p class="empty">${schema.empty || '還沒有資料<br>點右上角「＋ 新增」開始記錄'}</p>`);
    if (!rows.length && !always) {
      listEl.innerHTML = (all.length ? introHTML : '') + emptyHTML();
    } else {

      const { groupSuffix, futureSuffix } = schema.period;
      const today = U.today();
      const suffixOf = g => {
        const s = futureSuffix && g > today ? futureSuffix : groupSuffix;
        return s ? ` · ${s}` : '';
      };
      let html = introHTML + (schema.total ? summaryHTML(rows) : '');
      const withMember = showMember();
      if (stats) html += modeHTML();
      if (stats && state.mode === 'stats') {

        if (stats.before) html += stats.before(state.period || '', kw);
        html += rows.length ? Stats.html(stats, {
          rows, context: kw ? all.filter(matchKeyword) : all, period: state.period || '', isPending, status: statusOf,
          periodLabel: state.period ? periodLabel(state.period) : '',
          expanded: state.statsAll, open: state.statsOpen, members: Store.members(), showMembers: withMember,
        }) : emptyHTML();
      } else if (!rows.length) {
        html += emptyHTML();
      } else if (asTable()) {
        html += tableHTML(rows, withMember);
      } else {
        const notes = schema.annotate ? schema.annotate(rows) : null;
        let group = null;
        limited(rows).forEach(r => {
          const g = String(r[periodKey] ?? '');
          if (g !== group) {
            group = g;
            html += `<h3 class="group-head">${U.esc(U.fmtDate(g))} ${U.weekday(g)}${suffixOf(g)}</h3>`;
            html += groupNoteHTML(notes?.groups?.[g]);
          }
          html += cardHTML(r, withMember, notes?.cards?.[r.id]);
        });
        html += moreRowsHTML(rows.length);
      }
      listEl.innerHTML = html;
    }
    state.flashId = null;
  }


  let stale = false;
  function refresh() {
    if (el.hidden) {
      stale = true;
      return;
    }
    stale = false;
    renderPeriods();
    renderList();
  }
  function shown() {
    if (stale) refresh();
  }



  function changed(rec, later = false) {
    if (rec) {
      if (!inPeriod(rec)) state.period = periodOf(rec);
      if (state.keyword && !matchKeyword(rec)) {
        state.keyword = '';
        keywordInput.value = '';
      }
      state.flashId = rec.id;
    }
    if (later) stale = true;
    else refresh();
  }

  function reset() {
    Object.assign(state, initial());
    keywordInput.value = '';
    refresh();
  }


  const codes = () => [...new Set([...listEl.querySelectorAll('[data-code]')].map(n => n.dataset.code))];

  return { el, refresh, changed, defer: rec => changed(rec, true), reset, shown, codes };
}
