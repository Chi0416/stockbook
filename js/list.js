// 列表：依日期分組的卡片；點卡片開啟編輯表單
// schema.rows 存在時為推算頁面（資料由其他資料表算出）
// schema.stats 存在時，合計卡片下方有「明細｜統計」切換（統計畫面見 stats.js）；每次打開 App 都先顯示明細
// schema.top 存在時，列表最上面另外畫一段（除權息頁的「即將除權息」，見 upcoming.js），搜尋框有打字時不畫
//   top.html()：畫出來；top.act(名稱, 值)：裡面的按鈕，回傳 { redraw } 重畫、{ added, msg } 新增了一筆（onChanged、toast）
// schema.table 存在時，明細預設畫成表格（見 table.js）：一筆一列，欄位名稱只寫在表頭，不分日期標題；點表頭排序，再點一次反過來
//   設定裡打開「詳細卡片」時換回卡片（見 table.js 的 Cards）
//   每一欄：{ label: [上, 下], keys: [上, 下] } 一到兩個值上下疊；{ date: 欄位 } 寫「月/日」、下面小字寫年
//     cell(r, v)：自己決定上下兩個值（v(欄位) 是畫好的值）；sort：依哪個欄位排序（預設是第一個值）
//     value(r)：排序用的值不是欄位、要另外算時（例如庫存快照的損益）
//     strong：主要的金額（粗體）；tone(r)：'up' 紅、'down' 綠
//   最左邊固定是證券、下面一行代號（看兩位以上成員時加成員），狀態標籤（待除權息、待發放）、買賣接在代號後面
//     schema.name 有給時最左邊改寫別的（帳戶紀錄寫日期，見 schema.js），點表頭依日期排序
function createList(tableKey, schema, { openForm, onChanged = () => {}, toast = () => {} }) {
  const fields = schema.fields;
  const byKey = Object.fromEntries(fields.map(f => [f.key, f]));
  const periodKey = schema.period.key;
  const { code, title, badge, primary, note } = schema.card;
  // 成員不放在卡片下方，看兩位以上成員時改成卡片名稱上面的標籤
  const gridFields = fields.filter(f => f.type !== 'member' && !f.auto && ![periodKey, code, title, badge, primary].includes(f.key));
  // 最左邊一欄（表格）、卡片的標題：[粗體, 下面小字]
  const nameOf = r => (schema.name ? schema.name.cell(r) : [r[title], code ? r[code] ?? '' : '']);
  const nameSort = schema.name ? periodKey : code;
  const getRows = schema.rows || (() => Store.list(tableKey));
  // mode：'list' 明細、'stats' 統計；statsAll：排行已經點開「其他 N 檔」；statsOpen：排行裡展開了每一次配息的代號
  // sort／desc：表格依哪一欄排序（預設日期新到舊）
  const table = schema.table;
  const initial = () => ({ period: null, keyword: '', flashId: null, mode: 'list', statsAll: false, statsOpen: new Set(), sort: periodKey, desc: true });
  const state = initial();
  const asTable = () => table && !Cards.on;

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
  // 隱藏金額時（見 privacy.js）自己的數字顯示成 ***；公開資訊（public 欄位，例如每股股利）照常
  //   基準日股數這類每人一格的欄位，全部空白時顯示「自動計算」，不用藏
  const personal = (f, v) => !f.public && (f.type === 'number'
    || (f.type === 'perMember' && Object.values(v || {}).some(n => typeof n === 'number')));
  const show = (f, v) => {
    const s = U.display(f, v);
    return U.esc(personal(f, v) ? Privacy.num(s) : s) || '—';
  };
  // 卡片上寫的欄位名稱：有 cardLabel 用 cardLabel（例如「每股現金」，看得出不是合計）；試算表的欄位名稱照 label，不能改
  const cardLabel = f => f.cardLabel || f.label;
  // 交易別含「買」「賣」時標上顏色，方便一眼辨識
  const tone = v => /買/.test(v) ? 'buy' : /賣/.test(v) ? 'sell' : '';
  const showMember = () => Store.shown().length > 1;
  // 狀態標籤（schema.status，例如「待除權息」「待發放」）；pending 的列金額變淡、合計另外列出
  const statusOf = r => (schema.status ? schema.status(r) : null);
  const isPending = r => !!statusOf(r)?.pending;
  // schema.annotate 的補充說明（例如庫存快照的核對結果）：分組標題下方一段、卡片最下方一行
  //   sum 是分組的合計（庫存快照這一期的成本、市值、損益），寫在最下面，核對不符時也不用紅字
  const groupNoteHTML = n => (n
    ? `<p class="group-note${n.warn ? ' warn' : ''}">${U.esc(n.text)}${(n.lines || []).map(l => `<span>${U.esc(Privacy.text(l))}</span>`).join('')}` +
      `${n.sum ? `<span class="group-sum">${U.esc(n.sum)}</span>` : ''}</p>`
    : '');
  const cardNoteHTML = n => (n ? `<span class="card-note${n.warn ? ' warn' : ''}">${U.esc(Privacy.text(n.text))}</span>` : '');
  const introHTML = schema.intro ? Note.line(U.esc(schema.intro.line), schema.title, schema.intro.body) : '';
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
      <input class="f-keyword" type="search" placeholder="${U.esc(schema.search || '搜尋代號或證券')}" autocomplete="off" enterkeyhint="search">
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
    const card = e.target.closest('.card, .trow[data-id]');
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
    const top = schema.top?.act(name, value);
    if (top) {
      if (top.added) onChanged(tableKey, top.added);
      else if (top.redraw) renderList();
      if (top.msg) toast(top.msg);
      return;
    }
    if (name === 'period') {
      state.period = state.period === value ? value.slice(0, 4) : value;
      refresh(); // 上方的年月選單也跟著變
      return;
    }
    if (name === 'sort') {
      // 換一欄時：代號小到大，其他大到小（日期新到舊）
      state.desc = state.sort === value ? !state.desc : value !== code;
      state.sort = value;
    } else if (name === 'mode') state.mode = value;
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
      `<span class="cell"><small>${cardLabel(f)}</small><span>${show(f, r[f.key])}</span></span>`).join('') +
      (schema.card.calc || []).map(c =>
        `<span class="cell${c.tone && c.tone(r) ? ` ${c.tone(r)}` : ''}"><small>${U.esc(c.label)}</small><span>${c.value(r)}</span></span>`).join('');
    // 標籤：有 badge 欄位用欄位的值；沒有時用狀態標籤（例如「待除權息」虛線、「待發放」實心）
    const st = statusOf(r);
    const tag = badge
      ? r[badge] && { label: r[badge], cls: tone(r[badge]) }
      : st;
    // 標籤自己一行放在名稱上面，和右邊的小字標題對齊；名稱有整行可以用
    const tags = (withMember && r.member ? `<span class="badge member">${U.esc(Store.memberName(r.member))}</span>` : '') +
      (tag ? `<span class="badge ${tag.cls}">${U.esc(tag.label)}</span>` : '');
    return `
      <button type="button" class="card${r.id === state.flashId ? ' flash' : ''}${st?.pending ? ' pending' : ''}" data-id="${U.esc(r.id)}">
        <span class="card-top">
          <span class="card-title">${tags ? `<span class="card-tags">${tags}</span>` : ''}${code && r[code] ? `<span class="card-code">${U.esc(r[code])}</span>` : ''}${U.esc(schema.name ? schema.name.card(r) : r[title])}</span>
          <span class="card-primary"><small>${cardLabel(pf)}</small><b>${show(pf, r[primary])}</b></span>
        </span>
        ${grid ? `<span class="card-grid">${grid}</span>` : ''}
        ${note && r[note] ? `<span class="card-note${r.missing ? ' warn' : ''}">${U.esc(Privacy.text(r[note]))}</span>` : ''}
        ${cardNoteHTML(extra)}
      </button>`;
  }

  // ---------- 表格 ----------
  const sortKey = c => c.sort || c.date || c.keys[0];
  const dirOf = k => (state.sort === k ? (state.desc ? 'desc' : 'asc') : '');

  function rowHTML(r, withMember, extra, shownCols) {
    const st = statusOf(r);
    // 買進、賣出接在代號後面；庫存快照的「現股」每筆都一樣，不寫（卡片上有）
    const tag = badge ? r[badge] && tone(r[badge]) && { label: r[badge], cls: tone(r[badge]) } : st;
    const sub = (withMember && r.member ? ` · ${U.esc(Store.memberName(r.member))}` : '') +
      (tag ? ` <span class="badge ${tag.cls}">${U.esc(tag.label)}</span>` : '');
    const v = k => show(byKey[k], r[k]);
    const cells = shownCols.map(c => {
      if (c.date) return Table.date(String(r[c.date] ?? ''));
      const [a, b = ''] = c.cell ? c.cell(r, v) : c.keys.map(v);
      return Table.cell(a, b, [c.strong ? 'strong' : '', c.tone ? c.tone(r) : ''].filter(Boolean).join(' '));
    });
    // 紅字（算不出來的原因、庫存快照核對不符）整列寬寫在下面；「股數依某天的快照」這種說明不寫，看詳細卡片
    const warn = note && r.missing && r[note] ? Privacy.text(r[note]) : extra?.warn ? Privacy.text(extra.text) : '';
    return Table.row({
      attrs: `data-id="${U.esc(r.id)}"`,
      cls: [r.id === state.flashId ? 'flash' : '', st?.pending ? 'pending' : ''].filter(Boolean).join(' '),
      cells: [Table.name(...nameOf(r), sub), ...cells],
      note: warn,
    });
  }

  function tableHTML(rows, withMember) {
    const notes = schema.annotate ? schema.annotate(rows) : null;
    // 分組的說明（庫存快照的核對結果）放在表格上面；看好幾期時前面寫日期
    const groups = Object.entries(notes?.groups || {}).sort(([a], [b]) => (a < b ? 1 : -1));
    const dated = (g, n) => (n.text ? { ...n, text: `${U.fmtDate(g)} ${n.text}` } : { ...n, sum: `${U.fmtDate(g)} ${n.sum}` });
    const groupNotes = groups.map(([g, n]) => groupNoteHTML(groups.length > 1 ? dated(g, n) : n)).join('');
    const valueCol = table.find(c => c.value && sortKey(c) === state.sort);
    const byField = state.sort === code ? r => U.toHalf(r[code] ?? '').toUpperCase()
      : valueCol ? valueCol.value : r => r[state.sort];
    // 只看一期庫存快照時，每一列的快照日都一樣，不寫（上面的選單就是那一天）
    const oneDay = schema.period.unit === 'day' && rows.every(r => r[periodKey] === rows[0][periodKey]);
    const shownCols = table.filter(c => !(oneDay && c.date === periodKey));
    const cols = [
      { label: schema.name ? schema.name.label : ['證券', '代號'], sort: nameSort, dir: dirOf(nameSort) },
      ...shownCols.map(c => ({ label: c.label, sort: sortKey(c), dir: dirOf(sortKey(c)) })),
    ];
    return groupNotes + Table.html(cols, Table.sort(rows, byField, state.desc).map(r => rowHTML(r, withMember, notes?.cards?.[r.id], shownCols)));
  }

  // 合計目前篩選範圍內的數字；有 pending（例如還沒入帳）時並列「已入帳 / 待入帳」兩個一樣大的數字；
  // 算不出來的列不計入並提示
  function summaryHTML(rows) {
    const { key, label } = schema.total;
    const isNum = r => typeof r[key] === 'number';
    const total = list => U.round(list.reduce((s, r) => s + r[key], 0));
    const counted = rows.filter(r => !isPending(r) && isNum(r));
    const pending = rows.filter(r => isPending(r) && isNum(r));
    const who = Store.scopeLabel();
    const scope = [who, state.period && periodLabel(state.period)].filter(Boolean).join(' · ') || '全部';
    const missing = rows.length - counted.length - pending.length;
    return `
      <div class="summary">
        <small>${U.esc(scope)} ${label}合計</small>
        <b>${Privacy.num(U.fmtNum(total(counted)))}${pending.length
          ? `<span class="summary-sep"> / </span><span class="summary-pend">${Privacy.num(U.fmtNum(total(pending)))}</span>` : ''}</b>
        ${pending.length ? `<span class="summary-pending">已入帳 / 待入帳</span>` : ''}
        ${missing ? `<span class="summary-note">另有 ${missing} 筆算不出來，未計入</span>` : ''}
      </div>`;
  }

  const topHTML = () => (schema.top && !state.keyword.trim() ? schema.top.html() : '');

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
      listEl.innerHTML = topHTML() + (all.length
        ? `${introHTML}<p class="empty">沒有符合條件的資料</p>`
        : `<p class="empty">${schema.empty || '還沒有資料<br>點右上角「＋ 新增」開始記錄'}</p>`);
    } else {
      // 分組標題的說明；日期在今天之後時改用 futureSuffix（例如「發放」→「預計發放」）
      const { groupSuffix, futureSuffix } = schema.period;
      const today = U.today();
      const suffixOf = g => {
        const s = futureSuffix && g > today ? futureSuffix : groupSuffix;
        return s ? ` · ${s}` : '';
      };
      let html = topHTML() + introHTML + (schema.total ? summaryHTML(rows) : '');
      const withMember = showMember();
      if (stats) html += modeHTML();
      if (stats && state.mode === 'stats') {
        // 每月圖列出整年，所以另外給只套用搜尋（成員已經在 getRows 套用）的列
        html += Stats.html(stats, {
          rows, context: kw ? all.filter(matchKeyword) : all, period: state.period || '', isPending, status: statusOf,
          periodLabel: state.period ? periodLabel(state.period) : '',
          expanded: state.statsAll, open: state.statsOpen, members: Store.members(), showMembers: withMember,
        });
      } else if (asTable()) {
        html += tableHTML(rows, withMember);
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
    Object.assign(state, initial());
    keywordInput.value = '';
    refresh();
  }

  return { el, refresh, changed, reset };
}
