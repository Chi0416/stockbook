// 列表：依日期分組的卡片；點卡片開啟編輯表單
// schema.rows 存在時為推算頁面（資料由其他資料表算出）
// schema.stats 存在時，合計卡片下方有「明細｜統計」切換（統計畫面見 stats.js）；每次打開 App 都先顯示明細
function createList(tableKey, schema, { openForm }) {
  const fields = schema.fields;
  const byKey = Object.fromEntries(fields.map(f => [f.key, f]));
  const periodKey = schema.period.key;
  const { code, title, badge, primary, note } = schema.card;
  // 成員不放在卡片下方，全家檢視時改成卡片左上角的標籤
  const gridFields = fields.filter(f => f.type !== 'member' && ![periodKey, code, title, badge, primary].includes(f.key));
  const getRows = schema.rows || (() => Store.list(tableKey));
  // mode：'list' 明細、'stats' 統計；statsAll：排行已經點開「其他 N 檔」；statsOpen：排行裡展開了每一次配息的代號
  const state = { period: null, keyword: '', flashId: null, mode: 'list', statsAll: false, statsOpen: new Set() };

  const periodOf = r => {
    const d = String(r[periodKey] ?? '');
    return schema.period.unit === 'month' ? d.slice(0, 7) : d;
  };
  // 篩選值可以是年（2025）、年月（2025-08）或單日（2025-06-30）
  const inPeriod = r => {
    if (!state.period) return true;
    const p = periodOf(r);
    return p === state.period || p.startsWith(`${state.period}-`);
  };
  const periodLabel = p => (p.length === 4 ? `${p} 年` : U.fmtDate(p));
  // 代號、證券名稱或成員名稱包含關鍵字
  const matchKeyword = r =>
    `${code ? r[code] ?? '' : ''} ${r[title] ?? ''} ${r.member ? Store.memberName(r.member) : ''}`
      .toLowerCase().includes(state.keyword.trim().toLowerCase());
  const show = (f, v) => U.esc(U.display(f, v)) || '—';
  // 交易別含「買」「賣」時標上顏色，方便一眼辨識
  const tone = v => /買/.test(v) ? 'buy' : /賣/.test(v) ? 'sell' : '';
  const showMember = () => Store.scope === 'all' && Store.members().length > 1;
  // 狀態標籤（schema.status，例如「待除權息」「待發放」）；pending 的列金額變淡、合計另外列出
  const statusOf = r => (schema.status ? schema.status(r) : null);
  const isPending = r => !!statusOf(r)?.pending;
  // schema.annotate 的補充說明（例如庫存快照的核對結果）：分組標題下方一段、卡片最下方一行
  const groupNoteHTML = n => (n
    ? `<p class="group-note${n.warn ? ' warn' : ''}">${U.esc(n.text)}${(n.lines || []).map(l => `<span>${U.esc(l)}</span>`).join('')}</p>`
    : '');
  const cardNoteHTML = n => (n ? `<span class="card-note${n.warn ? ' warn' : ''}">${U.esc(n.text)}</span>` : '');
  const introHTML = schema.intro ? `<p class="list-intro">${U.esc(schema.intro)}</p>` : '';
  // 統計用的欄位：金額是合計的欄位、日期是分組的欄位，代號和名稱同卡片
  const stats = schema.stats && { ...schema.stats, amount: schema.total.key, date: periodKey, code, name: title };
  const modeHTML = () => `
    <div class="seg" role="group" aria-label="檢視方式">
      ${[['list', '明細'], ['stats', '統計']].map(([m, label]) =>
        `<button type="button" data-act="mode" data-value="${m}" aria-pressed="${state.mode === m}">${label}</button>`).join('')}
    </div>`;

  // ---------- DOM ----------
  const el = document.createElement('section');
  el.className = 'panel';
  el.hidden = true;
  el.innerHTML = `
    <div class="filterbar">
      <select class="f-period" aria-label="${schema.period.label}"></select>
      <input class="f-keyword" type="search" placeholder="搜尋代號或證券" autocomplete="off" enterkeyhint="search">
      <span class="count"></span>
    </div>
    <div class="list"></div>`;

  const periodSel = el.querySelector('.f-period');
  const keywordInput = el.querySelector('.f-keyword');
  const countEl = el.querySelector('.count');
  const listEl = el.querySelector('.list');

  periodSel.addEventListener('change', () => { state.period = periodSel.value; renderList(); });
  keywordInput.addEventListener('input', () => { state.keyword = keywordInput.value; renderList(); });
  listEl.addEventListener('click', e => {
    const card = e.target.closest('.card');
    if (card) {
      openForm(card.dataset.id);
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (btn) act(btn.dataset.act, btn.dataset.value);
  });

  // 明細｜統計切換，以及統計畫面上的點擊（都留在統計）
  //   點某個月（或某一年）：整頁改看那個月；再點一次選中的那個月，回到那一整年
  //   點排行的某一檔：在下面展開每一次配息，再點一次收起來
  function act(name, value) {
    if (name === 'period') {
      state.period = state.period === value ? value.slice(0, 4) : value;
      refresh(); // 上方的年月選單也跟著變
      return;
    }
    if (name === 'mode') state.mode = value;
    else if (name === 'more') state.statsAll = true;
    else if (name === 'code') {
      if (!state.statsOpen.delete(value)) state.statsOpen.add(value);
    } else return;
    renderList();
  }

  // ---------- 畫面 ----------
  function renderPeriods() {
    const periods = [...new Set(getRows().map(periodOf).filter(Boolean))].sort().reverse();
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
      `<span class="cell"><small>${f.label}</small><span>${show(f, r[f.key])}</span></span>`).join('');
    // 標籤：有 badge 欄位用欄位的值；沒有時用狀態標籤（例如「待除權息」虛線、「待發放」實心）
    const st = statusOf(r);
    const tag = badge
      ? r[badge] && { label: r[badge], cls: tone(r[badge]) }
      : st;
    // 標籤放在名稱開頭（同一段文字裡），名稱太長換行時標籤留在第一行
    const tags = (withMember && r.member ? `<span class="badge member">${U.esc(Store.memberName(r.member))}</span>` : '') +
      (tag ? `<span class="badge ${tag.cls}">${U.esc(tag.label)}</span>` : '');
    return `
      <button type="button" class="card${r.id === state.flashId ? ' flash' : ''}${st?.pending ? ' pending' : ''}" data-id="${U.esc(r.id)}">
        <span class="card-top">
          <span class="card-title">${tags}${code && r[code] ? `<span class="card-code">${U.esc(r[code])}</span>` : ''}${U.esc(r[title])}</span>
          <span class="card-primary"><small>${pf.label}</small><b>${show(pf, r[primary])}</b></span>
        </span>
        ${grid ? `<span class="card-grid">${grid}</span>` : ''}
        ${note && r[note] ? `<span class="card-note${r.missing ? ' warn' : ''}">${U.esc(r[note])}</span>` : ''}
        ${cardNoteHTML(extra)}
      </button>`;
  }

  // 合計目前篩選範圍內的數字；有 pending（例如還沒入帳）時並列「已入帳 / 待入帳」兩個一樣大的數字；
  // 算不出來的列不計入並提示
  function summaryHTML(rows) {
    const { key, label } = schema.total;
    const isNum = r => typeof r[key] === 'number';
    const total = list => U.round(list.reduce((s, r) => s + r[key], 0));
    const counted = rows.filter(r => !isPending(r) && isNum(r));
    const pending = rows.filter(r => isPending(r) && isNum(r));
    const who = Store.members().length < 2 ? '' : Store.scope === 'all' ? '全家' : Store.memberName(Store.scope);
    const scope = [who, state.period && periodLabel(state.period)].filter(Boolean).join(' · ') || '全部';
    const missing = rows.length - counted.length - pending.length;
    return `
      <div class="summary">
        <small>${U.esc(scope)} ${label}合計</small>
        <b>${U.fmtNum(total(counted))}${pending.length
          ? `<span class="summary-sep"> / </span><span class="summary-pend">${U.fmtNum(total(pending))}</span>` : ''}</b>
        ${pending.length ? `<span class="summary-pending">已入帳 / 待入帳</span>` : ''}
        ${missing ? `<span class="summary-note">另有 ${missing} 筆算不出來，未計入</span>` : ''}
      </div>`;
  }

  function renderList() {
    const all = getRows();
    const kw = state.keyword.trim();
    // 日期新到舊；同一天維持輸入順序（sort 為穩定排序）
    const rows = all
      .filter(r => inPeriod(r) && (!kw || matchKeyword(r)))
      .sort((a, b) => {
        const x = String(a[periodKey] ?? ''), y = String(b[periodKey] ?? '');
        return x < y ? 1 : x > y ? -1 : 0;
      });

    countEl.textContent = rows.length === all.length ? `${all.length} 筆` : `${rows.length}／${all.length} 筆`;

    if (!rows.length) {
      listEl.innerHTML = all.length
        ? `${introHTML}<p class="empty">沒有符合條件的資料</p>`
        : `<p class="empty">${schema.empty || '還沒有資料<br>點右上角「＋ 新增」開始記錄'}</p>`;
    } else {
      // 分組標題的說明；日期在今天之後時改用 futureSuffix（例如「發放」→「預計發放」）
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
        // 每月圖列出整年，所以另外給只套用搜尋（成員已經在 getRows 套用）的列
        html += Stats.html(stats, {
          rows, context: kw ? all.filter(matchKeyword) : all, period: state.period || '', isPending, status: statusOf,
          periodLabel: state.period ? periodLabel(state.period) : '',
          expanded: state.statsAll, open: state.statsOpen, members: Store.members(), showMembers: withMember,
        });
      } else {
        const notes = schema.annotate ? schema.annotate(rows) : null;
        let group = null;
        rows.forEach(r => {
          const g = String(r[periodKey] ?? '');
          if (g !== group) {
            group = g;
            html += `<h3 class="group-head">${U.esc(U.fmtDate(g))} ${U.weekday(g)}${suffixOf(g)}</h3>`;
            html += groupNoteHTML(notes?.groups?.[g]);
          }
          html += cardHTML(r, withMember, notes?.cards?.[r.id]);
        });
      }
      listEl.innerHTML = html;
    }
    state.flashId = null;
  }

  function refresh() {
    renderPeriods();
    renderList();
  }

  // 新增或修改後呼叫：確保那筆在目前篩選條件下看得到，並短暫標亮
  function changed(rec) {
    if (rec) {
      if (!inPeriod(rec)) state.period = periodOf(rec);
      if (state.keyword && !matchKeyword(rec)) {
        state.keyword = '';
        keywordInput.value = '';
      }
      state.flashId = rec.id;
    }
    refresh();
  }

  function reset() {
    Object.assign(state, { period: null, keyword: '', flashId: null, mode: 'list', statsAll: false, statsOpen: new Set() });
    keywordInput.value = '';
    refresh();
  }

  // 從其他頁面直接打開統計（總覽的「今年現金股利」）：period 是年份；沒有那一年的資料時改看全部
  function showStats(period) {
    Object.assign(state, { period, keyword: '', flashId: null, mode: 'stats', statsAll: false, statsOpen: new Set() });
    keywordInput.value = '';
    refresh();
  }

  return { el, refresh, changed, reset, showStats };
}
