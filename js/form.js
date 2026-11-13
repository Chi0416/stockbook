
const Form = (() => {
  const dlg = document.getElementById('form-sheet');
  const titleEl = dlg.querySelector('.sheet-title');
  const closeBtn = dlg.querySelector('[data-act="close"]');
  const saveBtn = dlg.querySelector('[data-act="save"]');
  const delBtn = dlg.querySelector('[data-act="delete"]');
  const bodyEl = dlg.querySelector('.sheet-body');
  const statusEl = dlg.querySelector('.sheet-status');
  const fieldsEl = dlg.querySelector('.fields');

  let ctx = null;
  let inputs = [];
  let chipBoxes = [];
  let noteEls = [];
  let initial = [];
  let lastCode = [];
  let combos = [];
  let captions = [];
  let calcked = [];
  let announceEl = null;
  let announced = [];

  const manageEl = document.createElement('div');
  manageEl.className = 'manage';
  manageEl.hidden = true;
  delBtn.before(manageEl);
  let hooks = { toast() {}, onChanged() {} };


  const isEnter = e => e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;
  const editValue = v => (v == null ? '' : String(v));
  const defaultValue = f => (f.type === 'member' ? Store.defaultMember() : editValue(f.default ?? f.initial));

  function init(h) {
    hooks = h;

    if (typeof Candles !== 'undefined' && Candles.onChange) {
      Candles.onChange(() => { if (dlg.open) renderNotes(); });
    }

    dlg.addEventListener('close', () => hooks.onClosed?.());

    if (typeof Announced !== 'undefined' && Announced.onChange) {
      Announced.onChange(() => { if (dlg.open) renderAnnounce(); });
    }
  }




  function expandFields(fields) {
    const members = Store.members();
    return fields.filter(f => !f.auto).flatMap(f => (f.type !== 'perMember' ? [f] : members.map((m, j) => ({
      ...f,
      type: 'number',
      key: `${f.key}.${m.id}`,
      group: f.key,
      memberId: m.id,
      label: members.length > 1 ? `${f.label}（${m.name}）` : f.label,
      hint: j === members.length - 1 ? f.hint : '',
    }))));
  }


  function open(tableKey, id, preset = {}) {
    const schema = SCHEMAS[tableKey];
    const rec = id ? Store.list(tableKey, 'all').find(r => r.id === id) : null;
    if (id && !rec) return;
    ctx = { tableKey, schema, id, count: 0, fields: expandFields(schema.fields) };
    titleEl.textContent = `${id ? '編輯' : '新增'}${schema.formTitle || schema.title}`;
    closeBtn.textContent = '取消';
    delBtn.textContent = schema.remove?.label || '刪除這筆';
    delBtn.hidden = !id;
    dlg.dataset.table = tableKey;
    statusEl.hidden = true;
    buildFields(rec, preset);
    renderManage();
    dlg.showModal();
    bodyEl.scrollTop = 0;
  }

  const fieldIndex = key => ctx.fields.findIndex(f => f.key === key);

  function buildFields(rec, preset = {}) {
    const fields = ctx.fields;
    fieldsEl.innerHTML = '';
    chipBoxes = fields.map(() => null);
    noteEls = fields.map(() => null);
    captions = fields.map(() => null);
    combos = [];
    const wraps = [];
    inputs = fields.map((f, i) => {
      const wrap = document.createElement('div');
      wrap.className = `field${f.full ? ' full' : ''}`;
      const inp = f.type === 'member' ? memberSelect() : document.createElement('input');
      inp.id = `fld-${f.key}`;
      if (f.type !== 'member') {
        inp.type = f.type === 'date' ? 'date' : 'text';
        if (f.type === 'number') inp.inputMode = 'decimal';
        if (f.caps) inp.setAttribute('autocapitalize', 'characters');
        if (f.toggle) inp.type = 'hidden';
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        inp.setAttribute('enterkeyhint', i === fields.length - 1 ? 'done' : 'next');
      } else if (Store.members().length < 2) {
        wrap.hidden = true;
      }
      inp.value = rec ? editValue(f.group ? rec[f.group]?.[f.memberId] : rec[f.key])
        : f.key in preset ? editValue(preset[f.key]) : defaultValue(f);
      if (rec && f.when && !inp.value) inp.value = defaultValue(f);

      const label = document.createElement('label');
      label.htmlFor = inp.id;
      label.textContent = f.label;
      wrap.append(label, inp);
      if (f.toggle) {
        label.removeAttribute('for');
        const seg = document.createElement('div');
        seg.className = 'seg toggle';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', f.label);
        seg.innerHTML = f.toggle.map(o => `<button type="button" class="${U.esc(o.tone)}" data-toggle="${i}"` +
          ` data-v="${U.esc(o.value)}" aria-pressed="false">${U.esc(o.label)}</button>`).join('');
        wrap.appendChild(seg);
      } else if (f.suggest) {
        chipBoxes[i] = document.createElement('div');
        chipBoxes[i].className = 'chips';
        wrap.appendChild(chipBoxes[i]);
      }
      if (f.hint) {
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = f.hint;
        wrap.appendChild(hint);
      }
      if (f.note) {
        noteEls[i] = document.createElement('div');
        noteEls[i].className = 'note';
        wrap.appendChild(noteEls[i]);
      }
      const err = document.createElement('div');
      err.className = 'err';
      wrap.appendChild(err);
      fieldsEl.appendChild(wrap);
      wraps.push(wrap);
      return inp;
    });

    fields.forEach((f, i) => {
      if (!f.pair) return;
      const group = document.createElement('div');
      group.className = 'chips-group';
      group.innerHTML = '<div class="chips-caption">最近記過的股票，點一下帶入（不代表目前持有）</div>';
      chipBoxes[i] = document.createElement('div');
      chipBoxes[i].className = 'chips';
      group.appendChild(chipBoxes[i]);
      captions[i] = group.querySelector('.chips-caption');
      wraps[Math.max(i, fieldIndex(f.pair))].after(group);
      if (typeof StockSearch !== 'undefined') buildCombo(i);
    });

    announceEl = null;
    const p = fields.findIndex(f => f.pair);
    const after = p >= 0 ? inputs[fieldIndex(fields[p].pair) + 1] : null;
    if (ctx.schema.announce && !rec && after && typeof Announced !== 'undefined') {
      announceEl = document.createElement('div');
      announceEl.className = 'field full announce';
      announceEl.dataset.pair = p;
      announceEl.innerHTML = '<div class="chips-caption"></div><div class="chips"></div>';
      after.parentElement.before(announceEl);
    }

    calcked = fields.map(f => {
      const c = f.calc ? f.calc(formValues()) : null;
      return c !== null && U.parseNum(inputs[fieldIndex(f.key)].value) === c ? c : null;
    });
    renderAllChips();
    renderToggles();
    renderNotes();
    initial = inputs.map(inp => inp.value);
    lastCode = inputs.map(inp => inp.value);
  }


  function renderToggles() {
    ctx.fields.forEach((f, i) => {
      if (!f.toggle) return;
      const v = inputs[i].value.trim();
      inputs[i].parentElement.querySelectorAll('[data-toggle]').forEach(b => {
        const o = f.toggle.find(x => x.value === b.dataset.v);
        b.setAttribute('aria-pressed', String(!!v && o.match.test(v)));
      });
    });
  }






  const comboOf = k => combos.find(c => !c.split && (c.i === k || c.n === k));
  const ownStocks = c => pairSuggestions(ctx.fields[c.i]);

  const canPick = p => ctx.tableKey === 'watch' || !U.isIndex(p.code);

  const typing = c => c.editing && c.text.value.trim() !== inputs[c.n].value.trim();

  function buildCombo(i) {
    const n = fieldIndex(ctx.fields[i].pair);
    const wrap = document.createElement('div');
    wrap.className = 'field full stock-field';
    wrap.innerHTML = `
      <label for="fld-stock-${i}">股票</label>
      <div class="stock-box">
        <span class="stock-code"></span>
        <input id="fld-stock-${i}" type="text" autocomplete="off" spellcheck="false" enterkeyhint="next"
          autocapitalize="characters" placeholder="打代號或名稱，例如 2330、台積">
        <button type="button" class="stock-clear" aria-label="清除，重新選股票">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>
        </button>
      </div>
      <div class="err"></div>`;
    const c = { i, n, wrap, text: wrap.querySelector('input'), codeEl: wrap.querySelector('.stock-code'), editing: false, split: false, open: false };

    c.group = captions[i].parentElement;
    wrap.querySelector('.stock-box').appendChild(c.group);
    chipBoxes[i].id = `stock-list-${i}`;
    chipBoxes[i].setAttribute('role', 'listbox');
    c.text.setAttribute('role', 'combobox');
    c.text.setAttribute('aria-autocomplete', 'list');
    c.text.setAttribute('aria-controls', chipBoxes[i].id);

    if (noteEls[i]) wrap.querySelector('.err').before(noteEls[i]);
    inputs[i].parentElement.before(wrap);
    inputs[i].parentElement.hidden = true;
    inputs[n].parentElement.hidden = true;


    c.text.addEventListener('focus', () => {
      c.editing = true;
      c.open = true;
      renderCombo(c);
      renderChips(c.i);

      if (matchMedia('(pointer: coarse)').matches) {
        setTimeout(() => { if (c.open) c.wrap.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 300);
      }
      const before = c.text.value;
      if (before) setTimeout(() => { if (c.text.value === before) c.text.select(); }, 0);
    });

    const onType = () => {
      c.editing = true;
      setComboError(c, '');
      renderCombo(c);
      renderChips(c.i);
    };
    c.text.addEventListener('input', e => { if (!e.isComposing) onType(); });
    c.text.addEventListener('compositionend', onType);

    c.text.addEventListener('blur', () => setTimeout(() => {
      if (document.activeElement === c.text) return;
      c.open = false;
      if (c.editing) commitCombo(c);
      renderChips(c.i);
      renderNotes();
    }, 150));

    c.text.addEventListener('keydown', e => {
      if (e.key === 'Escape' && c.open) {

        e.preventDefault();
        e.stopPropagation();
        c.open = false;
        commitCombo(c);
        renderChips(c.i);
        return;
      }
      if (!isEnter(e)) return;
      e.preventDefault();
      c.open = false;
      if (!commitCombo(c)) {
        const first = StockSearch.search(c.text.value, ownStocks(c)).filter(canPick)[0];
        if (!first) {
          setComboError(c, comboError(c));
          return;
        }
        pickStock(c, first.code, first.name);
      }
      renderChips(c.i);
      renderNotes();
      focusField(c.n + 1);
    });
    wrap.querySelector('.stock-clear').addEventListener('click', () => {
      pickStock(c, '', '');
      c.text.focus();
    });
    combos.push(c);
    renderCombo(c);
  }


  function renderCombo(c) {
    const code = inputs[c.i].value.trim();
    const name = inputs[c.n].value.trim();
    if (!c.editing) c.text.value = name || code;
    c.text.setAttribute('aria-expanded', String(c.open && !c.group.hidden));
    c.codeEl.textContent = !typing(c) && code && name ? code : '';
    c.wrap.classList.toggle('picked', !c.editing && !!code);
  }

  function pickStock(c, code, name) {
    inputs[c.i].value = code;
    inputs[c.n].value = name;
    lastCode[c.i] = code;
    c.editing = false;
    setComboError(c, '');
    renderCombo(c);
  }


  function commitCombo(c) {
    const t = c.text.value.trim();
    if (!t) pickStock(c, '', '');
    else if (!typing(c)) {
      c.editing = false;
      renderCombo(c);
    } else {
      const hit = StockSearch.resolve(t, ownStocks(c));
      if (!hit || !canPick(hit)) return false;
      pickStock(c, hit.code, hit.name);
    }
    return true;
  }

  const comboError = c => (typing(c)
    ? `認不出「${c.text.value.trim()}」是哪一檔：請點下方的股票，或打「代號 名稱」，例如 00999Z 新ETF`
    : '請選一檔股票');

  function setComboError(c, msg) {
    c.wrap.classList.toggle('invalid', !!msg);
    c.wrap.querySelector('.err').textContent = msg;
  }


  function splitCombo(c) {
    const t = c.text.value.trim();
    if (typing(c)) {
      const asCode = /^\d/.test(U.toHalf(t));
      inputs[c.i].value = asCode ? t : '';
      inputs[c.n].value = asCode ? '' : t;
    }
    c.split = true;
    c.open = false;
    c.wrap.hidden = true;
    inputs[c.n].parentElement.after(c.group);
    inputs[c.i].parentElement.hidden = false;
    inputs[c.n].parentElement.hidden = false;
    if (noteEls[c.i]) inputs[c.i].parentElement.querySelector('.err').before(noteEls[c.i]);
    lastCode[c.i] = inputs[c.i].value;
    renderChips(c.i);
    renderNotes();
    inputs[inputs[c.i].value ? c.n : c.i].focus();
  }


  function focusField(k) {
    const c = comboOf(k);
    const toggle = ctx.fields[k]?.toggle && inputs[k].parentElement.querySelector('[data-toggle]');
    (c ? c.text : toggle || inputs[k])?.focus();
  }


  const formValues = () => Object.fromEntries(ctx.fields.map((f, i) => {
    const raw = inputs[i].value.trim();
    return [f.key, f.type === 'date' ? U.parseDate(raw) || '' : raw];
  }));


  function recalc() {
    ctx.fields.forEach((f, i) => {
      if (!f.calc) return;
      const c = f.calc(formValues());
      const cur = inputs[i].value.trim();
      if (cur && U.parseNum(cur) !== calcked[i]) return;
      inputs[i].value = c === null ? '' : String(c);
      calcked[i] = c;
      if (c !== null) setError(i, '');
    });
  }


  function renderNotes() {
    recalc();
    const values = formValues();
    ctx.fields.forEach((f, i) => { if (f.when) inputs[i].parentElement.hidden = !f.when(values); });
    if (!noteEls.some(Boolean)) return;
    noteEls.forEach((el, i) => {
      const f = ctx.fields[i];
      if (el) el.textContent = (!f.when || f.when(values)) ? f.note(values, ctx.id) || '' : '';
    });
  }


  function memberSelect() {
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="">選擇成員</option>' +
      Store.members().map(m => `<option value="${U.esc(m.id)}">${U.esc(m.name)}</option>`).join('');
    return sel;
  }



  function recentRecords(f) {
    const tables = [...(ctx.schema.unique ? [] : [ctx.tableKey]), ...(f.suggestFrom || [])];
    return tables.flatMap(t => Store.list(t, 'all').slice().reverse());
  }

  function suggestions(f) {
    const seen = new Set();
    recentRecords(f).forEach(r => { if (r[f.key]) seen.add(String(r[f.key])); });
    f.suggest.forEach(v => seen.add(v));
    return [...seen].slice(0, 12);
  }


  function pairSuggestions(f) {
    const byCode = new Map();
    const taken = new Set(ctx.schema.unique ? Store.list(ctx.tableKey, 'all').map(r => String(r[f.key] ?? '').trim()) : []);
    recentRecords(f).forEach(r => {
      const c = String(r[f.key] ?? '').trim();
      if (c && !byCode.has(c) && !taken.has(c)) byCode.set(c, String(r[f.pair] ?? ''));
    });
    return [...byCode].map(([code, name]) => ({ code, name }));
  }

  const chipHTML = (i, value, text, on, pairValue) =>
    `<button type="button" class="chip${on ? ' on' : ''}" data-i="${i}" data-v="${U.esc(value)}"` +
    `${pairValue == null ? '' : ` data-pair="${U.esc(pairValue)}"`}>${U.esc(text)}</button>`;





  const ANNOUNCE_KEYS = ['exDate', 'payDate', 'cash', 'stock'];

  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));

  const pending = r => r.cash == null;
  const announceText = r => (pending(r)
    ? `${md(r.exDate)} 除息、${md(r.payDate)} 發放（金額待公告）`
    : `${md(r.exDate)} ${r.stock ? '除權息' : '除息'}、${md(r.payDate)} 發放、每股 ${U.fmtNum(r.cash)}` +
      (r.stock ? `、配股 ${U.fmtNum(r.stock)}` : ''));
  const announceKeys = r => (pending(r) ? ['exDate', 'payDate'] : ANNOUNCE_KEYS);

  function renderAnnounce() {
    if (!announceEl) return;
    const at = Announced.updated();
    const state = Announced.state ? Announced.state() : 'ready';
    announceEl.querySelector('.chips-caption').textContent =
      `公告的除權息，按一下帶入日期和金額${at ? `（資料 ${U.fmtDate(at).slice(5)} 更新）` : ''}`;
    if (state !== 'ready') {
      announced = [];
      announceEl.querySelector('.chips').innerHTML = state === 'loading'
        ? '<span class="announce-empty">公告資料下載中…</span>'
        : '<span class="announce-empty">公告資料下載不了，請確認網路；或照股利通知書填</span>';
      return;
    }
    const code = inputs[+announceEl.dataset.pair].value.trim();
    const all = code ? Announced.forCode(code) : [];
    announced = code ? Announced.forCode(code, Store.list('dividends', 'all')) : [];

    const now = ANNOUNCE_KEYS.map(k => inputs[fieldIndex(k)]?.value.trim() ?? '');
    const on = r => announceKeys(r).every(k => {
      const v = now[ANNOUNCE_KEYS.indexOf(k)];
      return (/Date$/.test(k) ? U.parseDate(v) : U.parseNum(v)) === r[k];
    });
    announceEl.querySelector('.chips').innerHTML = !code ? '<span class="announce-empty">先選股票</span>'
      : !all.length ? '<span class="announce-empty">公告裡沒有這檔，請照股利通知書填</span>'

      : !announced.length ? `<span class="announce-empty">公告的除權息都記過了（最近一次 ${U.esc(md(all[0].exDate))} 除息）</span>`
      : announced.slice(0, 6).map((r, k) =>
        `<button type="button" class="chip${on(r) ? ' on' : ''}" data-announce="${k}">${U.esc(announceText(r))}</button>`).join('');
  }

  function renderChips(i) {
    const f = ctx.fields[i];
    const box = chipBoxes[i];
    if (!box) return;

    if (f.pair) {
      renderAnnounce();
      const code = inputs[i].value.trim();
      const name = inputs[fieldIndex(f.pair)].value.trim();
      const all = pairSuggestions(f);
      const picked = p => p.code === code && p.name === name;
      const c = comboOf(i);
      if (c) {

        const q = typing(c) ? c.text.value.trim() : '';
        const list = q ? StockSearch.search(q, all).filter(canPick) : all.slice(0, 8);
        box.innerHTML = list.map(p => `
          <button type="button" class="chip${picked(p) ? ' on' : ''}" role="option" aria-selected="${picked(p)}"
            data-i="${i}" data-v="${U.esc(p.code)}" data-pair="${U.esc(p.name)}">
            <span class="opt-code">${U.esc(p.code)}</span><span class="opt-name">${U.esc(p.name)}</span>
          </button>`).join('') +
          (q && !list.length ? `<button type="button" class="chips-split" data-split="${i}">分開填代號和名稱</button>` : '');
        if (captions[i]) {
          captions[i].textContent = !q ? '最近記過的股票，點一下帶入（不代表目前持有）'
            : list.length ? `符合「${q}」的股票，點一下帶入`
            : `股票清單裡找不到「${q}」：可以打「代號 名稱」，例如 00999Z 新ETF，或分開填`;
        }
        box.parentElement.hidden = !c.open || (!q && !list.length);
        c.text.setAttribute('aria-expanded', String(!box.parentElement.hidden));
        return;
      }
      if (captions[i]) captions[i].textContent = '最近記過的股票，點一下帶入（不代表目前持有）';

      const q = (code || name).toLowerCase();
      const list = !q || all.some(picked)
        ? all
        : all.filter(p => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
      box.innerHTML = list.slice(0, 8).map(p => chipHTML(i, p.code, `${p.code} ${p.name}`, picked(p), p.name)).join('');
      box.parentElement.hidden = !list.length;
      return;
    }

    const all = suggestions(f);
    const q = inputs[i].value.trim();

    const list = !q || all.includes(q) ? all : all.filter(v => v.includes(q));
    box.innerHTML = list.slice(0, 8).map(v => chipHTML(i, v, v, v === q)).join('');
  }

  function renderAllChips() {
    inputs.forEach((_, i) => renderChips(i));
  }



  function knownName(f, code) {
    const c = U.toHalf(code).trim().toUpperCase();
    if (!c) return '';
    const own = pairSuggestions(f).find(p => p.code.toUpperCase() === c);
    if (own?.name) return own.name;
    return (typeof STOCK_LIST !== 'undefined' && STOCK_LIST.names[c]) || '';
  }



  function autofillPair(i) {
    const f = ctx.fields[i];
    if (!f.pair) return;
    const n = fieldIndex(f.pair);
    const prev = knownName(f, lastCode[i] ?? '');
    lastCode[i] = inputs[i].value;
    const cur = inputs[n].value.trim();
    if (cur && cur !== prev) return;
    const name = knownName(f, inputs[i].value);
    if (name === cur) return;
    inputs[n].value = name;
    setError(n, '');
  }


  function setError(i, msg) {
    const wrap = inputs[i].parentElement;
    wrap.classList.toggle('invalid', !!msg);
    wrap.querySelector('.err').textContent = msg;
  }

  function collect() {
    const rec = {};
    let firstBad = null;
    const values = formValues();
    ctx.fields.forEach((f, i) => {

      if (f.when && !f.when(values)) {
        setError(i, '');
        rec[f.key] = null;
        return;
      }
      const raw = inputs[i].value.trim();
      let v = raw;
      let msg = '';
      if (!raw) {
        if (f.optional && !f.when) v = null;
        else msg = f.type === 'member' ? '請選擇成員' : f.toggle ? `請選${f.toggle.map(o => o.label).join('或')}` : '必填';
      } else if (f.type === 'number' && (v = U.parseNum(raw)) === null) msg = '請輸入數字';
      else if (f.type === 'date' && (v = U.parseDate(raw)) === null) msg = '日期格式如 2025/06/05';
      else if (f.check) msg = f.check(v);
      const c = comboOf(i);
      if (!c) {
        setError(i, msg);
        if (msg && !firstBad) firstBad = f.toggle ? inputs[i].parentElement.querySelector('[data-toggle]') : inputs[i];
      } else if (i === c.i) {
        const bad = typing(c) || !raw || !inputs[c.n].value.trim() ? comboError(c) : '';
        setComboError(c, bad);
        if (bad && !firstBad) firstBad = c.text;
      }
      if (f.group) {

        rec[f.group] = rec[f.group] || {};
        if (v !== null) rec[f.group][f.memberId] = v;
      } else {
        rec[f.key] = v;
      }
    });
    return { rec, firstBad };
  }


  const memberOf = rec => (rec.member && Store.members().length > 1 ? Store.memberName(rec.member) : '');



  function summary(rec) {
    const { code, title, badge, primary } = ctx.schema.card;
    const pf = primary && ctx.fields.find(f => f.key === primary);
    const amount = pf ? U.display(pf, rec[primary]) : '';
    return [memberOf(rec), badge && rec[badge], code && rec[code], rec[title], pf && (pf.public ? amount : Privacy.num(amount))]
      .filter(Boolean).join(' ');
  }


  function duplicateOf(rec) {
    const keys = ctx.schema.unique;
    if (!keys) return null;
    const norm = v => U.toHalf(v ?? '').trim().toUpperCase();
    return Store.list(ctx.tableKey, 'all').find(r => r.id !== ctx.id && keys.every(k => norm(r[k]) === norm(rec[k]))) || null;
  }


  function save() {
    combos.forEach(c => { if (c.editing) commitCombo(c); });
    const { rec: filled, firstBad } = collect();
    if (firstBad) {
      firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
      firstBad.focus({ preventScroll: true });
      return;
    }

    const rec = ctx.schema.beforeSave ? ctx.schema.beforeSave(filled) : filled;

    const dup = duplicateOf(rec);
    if (dup) {
      const i = fieldIndex(ctx.schema.unique[0]);
      const c = comboOf(i);
      const msg = ctx.schema.uniqueMsg?.(dup) || `${ctx.schema.title}裡已經有 ${[dup.code, dup.name].filter(Boolean).join(' ')} 了`;
      if (c) setComboError(c, msg);
      else setError(i, msg);
      document.activeElement?.blur();
      return;
    }

    if (ctx.id) {
      Store.update(ctx.tableKey, ctx.id, rec);
      dlg.close();
      hooks.onChanged(ctx.tableKey, { ...rec, id: ctx.id });

      const moved = rec.member && !Store.shown().includes(rec.member);
      hooks.toast(moved ? `已儲存到「${memberOf(rec)}」` : '已儲存');
      return;
    }


    const saved = Store.add(ctx.tableKey, rec);
    ctx.count++;
    hooks.onChanged(ctx.tableKey, saved);
    if (ctx.schema.closeOnAdd) {
      dlg.close();
      hooks.toast('已儲存');
      return;
    }
    inputs.forEach((inp, i) => {
      const f = ctx.fields[i];
      if (!f.keep) inp.value = defaultValue(f);
    });
    calcked = ctx.fields.map(() => null);
    renderAllChips();
    renderNotes();
    renderManage();
    initial = inputs.map(inp => inp.value);
    lastCode = inputs.map(inp => inp.value);
    combos.forEach(c => { c.editing = false; c.open = false; setComboError(c, ''); renderCombo(c); renderChips(c.i); });
    renderToggles();
    closeBtn.textContent = '完成';
    statusEl.textContent = `已新增：${summary(saved)}（本次共 ${ctx.count} 筆）`;
    statusEl.hidden = false;
    bodyEl.scrollTop = 0;

    if (matchMedia('(pointer: fine)').matches) {
      focusField(Math.max(ctx.fields.findIndex(f => !f.keep), 0));
    } else if (document.activeElement) {
      document.activeElement.blur();
    }
  }





  const ordered = () => ctx.tableKey === 'watch' && typeof WatchOrder !== 'undefined';
  const codeKey = c => U.toHalf(c ?? '').trim().toUpperCase();
  const GRIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h14"/></svg>';
  function renderManage() {
    const m = ctx.schema.manage;
    manageEl.hidden = !m || !!ctx.id;
    if (manageEl.hidden) {
      manageEl.innerHTML = '';
      return;
    }
    const all = Store.list(ctx.tableKey, 'all');
    const order = ordered();
    const rows = order ? WatchOrder.sort(all)
      : all.slice().sort((a, b) => (String(a.code) < String(b.code) ? -1 : String(a.code) > String(b.code) ? 1 : 0));
    manageEl.innerHTML = `<h3 class="section-head">${U.esc(m.title)}（${rows.length} 檔）</h3>` + (rows.length
      ? (order && rows.length > 1 ? '<p class="note muted order-note">按住 ≡ 上下拖調整順序（只記在這台裝置）</p>' : '') +
        `<ul class="member-list${order ? ' order-list' : ''}">${rows.map(r => `
          <li data-code="${U.esc(codeKey(r.code))}">
            <span class="member-info"><b><span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</b></span>
            ${order ? '<button type="button" class="text-btn order-top" data-top>置頂</button>' : ''}
            <button type="button" class="text-btn danger" data-remove="${U.esc(r.id)}">移除</button>
            ${order ? `<button type="button" class="drag-grip" data-grip aria-label="調整 ${U.esc(r.name || r.code)} 的順序：按住上下拖，或按上下鍵">${GRIP}</button>` : ''}
          </li>`).join('')}</ul>`
      : `<p class="note muted">${U.esc(m.empty)}</p>`);
  }


  function saveOrder(li) {
    WatchOrder.set([...manageEl.querySelectorAll('.order-list li[data-code]')].map(x => x.dataset.code));
    li.classList.remove('flash');
    void li.offsetWidth;
    li.classList.add('flash');
  }

  manageEl.addEventListener('click', e => {
    const top = e.target.closest('[data-top]');
    if (top) {
      const li = top.closest('li');
      li.parentElement.prepend(li);
      saveOrder(li);
      hooks.toast('已置頂');
      return;
    }
    const btn = e.target.closest('[data-remove]');
    const rec = btn && Store.get(ctx.tableKey, btn.dataset.remove);
    if (!rec) return;
    if (!confirm(`確定${ctx.schema.remove.label}：${[rec.code, rec.name].filter(Boolean).join(' ')}？`)) return;
    Store.remove(ctx.tableKey, rec.id);
    hooks.onChanged(ctx.tableKey, null);
    renderManage();
    renderAllChips();
    hooks.toast(ctx.schema.remove.done);
  });



  let drag = null;
  function follow() {
    const { li, list } = drag;
    const want = drag.y - drag.grab - list.getBoundingClientRect().top;
    for (;;) {
      const prev = li.previousElementSibling;
      const next = li.nextElementSibling;
      if (prev && want < prev.offsetTop + prev.offsetHeight / 2) list.insertBefore(li, prev);
      else if (next && want + li.offsetHeight > next.offsetTop + next.offsetHeight / 2) list.insertBefore(next, li);
      else break;
    }
    const y = Math.max(0, Math.min(want, list.clientHeight - li.offsetHeight));
    li.style.transform = `translateY(${y - li.offsetTop}px)`;
  }
  function scrollTick() {
    if (!drag) return;
    const r = bodyEl.getBoundingClientRect();
    const EDGE = 56;
    const speed = drag.y < r.top + EDGE ? -Math.ceil((r.top + EDGE - drag.y) / 4)
      : drag.y > r.bottom - EDGE ? Math.ceil((drag.y - (r.bottom - EDGE)) / 4) : 0;
    if (speed) {
      bodyEl.scrollTop += Math.max(-14, Math.min(14, speed));
      follow();
    }
    drag.raf = requestAnimationFrame(scrollTick);
  }
  function endDrag() {
    if (!drag) return;
    const { li, before } = drag;
    cancelAnimationFrame(drag.raf);
    drag = null;
    li.classList.remove('dragging');
    li.style.transform = '';
    if (li.isConnected && before !== li.nextElementSibling) saveOrder(li);
  }
  manageEl.addEventListener('pointerdown', e => {
    const grip = e.target.closest('[data-grip]');
    if (!grip || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const li = grip.closest('li');
    try { grip.setPointerCapture(e.pointerId); } catch (_) {}
    drag = { li, list: li.parentElement, id: e.pointerId, y: e.clientY, grab: e.clientY - li.getBoundingClientRect().top, before: li.nextElementSibling };
    li.classList.add('dragging');
    drag.raf = requestAnimationFrame(scrollTick);
  });
  manageEl.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.y = e.clientY;
    follow();
  });
  manageEl.addEventListener('pointerup', e => { if (drag && e.pointerId === drag.id) endDrag(); });
  manageEl.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) endDrag(); });
  manageEl.addEventListener('keydown', e => {
    const grip = e.target.closest('[data-grip]');
    if (!grip || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    const li = grip.closest('li');
    const to = e.key === 'ArrowUp' ? li.previousElementSibling : li.nextElementSibling;
    if (!to) return;
    if (e.key === 'ArrowUp') to.before(li);
    else to.after(li);
    grip.focus();
    saveOrder(li);
  });


  function remove() {
    const rec = Store.get(ctx.tableKey, ctx.id);
    const what = ctx.schema.remove
      ? `${ctx.schema.remove.label}：${[rec?.code, rec?.name].filter(Boolean).join(' ')}`
      : `刪除這筆${ctx.schema.title}`;
    if (!confirm(`確定${what}？`)) return;
    Store.remove(ctx.tableKey, ctx.id);
    dlg.close();
    hooks.onChanged(ctx.tableKey, null);
    hooks.toast(ctx.schema.remove?.done || '已刪除');
  }

  function isDirty() {
    return inputs.some((inp, i) => inp.value !== initial[i] && (ctx.id || !ctx.fields[i].keep)) || combos.some(typing);
  }

  function requestClose() {
    if (isDirty() && !confirm('有尚未儲存的內容，確定離開？')) return;
    dlg.close();
  }


  saveBtn.addEventListener('click', save);
  closeBtn.addEventListener('click', requestClose);
  delBtn.addEventListener('click', remove);
  dlg.addEventListener('cancel', e => { e.preventDefault(); requestClose(); });

  fieldsEl.addEventListener('click', e => {

    const ann = e.target.closest('[data-announce]');
    if (ann) {
      const r = announced[+ann.dataset.announce];
      announceKeys(r).forEach(k => {
        const i = fieldIndex(k);
        if (i < 0) return;
        inputs[i].value = String(r[k]);
        setError(i, '');
      });
      renderAllChips();
      renderNotes();
      if (pending(r)) inputs[fieldIndex('cash')]?.focus();
      return;
    }

    const tog = e.target.closest('[data-toggle]');
    if (tog) {
      const i = +tog.dataset.toggle;
      const o = ctx.fields[i].toggle.find(x => x.value === tog.dataset.v);
      if (!o.match.test(inputs[i].value)) inputs[i].value = o.value;
      setError(i, '');
      renderToggles();
      renderNotes();
      return;
    }
    const split = e.target.closest('[data-split]');
    if (split) {
      const c = combos.find(x => x.i === +split.dataset.split);
      if (c) splitCombo(c);
      return;
    }
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const i = +chip.dataset.i;
    inputs[i].value = chip.dataset.v;
    setError(i, '');
    const pair = ctx.fields[i].pair;
    if (pair && chip.dataset.pair != null) {
      inputs[fieldIndex(pair)].value = chip.dataset.pair;
      setError(fieldIndex(pair), '');
      lastCode[i] = chip.dataset.v;
      const c = comboOf(i);
      if (c) {
        c.open = false;
        pickStock(c, chip.dataset.v, chip.dataset.pair);
        c.text.blur();
      }
    }
    renderAllChips();
    renderNotes();
  });

  fieldsEl.addEventListener('mousedown', e => {
    if (e.target.closest('.chips-group') && combos.some(c => c.editing)) e.preventDefault();
  });

  fieldsEl.addEventListener('input', e => {
    const i = inputs.indexOf(e.target);
    if (i < 0) return;
    setError(i, '');
    autofillPair(i);
    renderAllChips();
    renderNotes();
  });

  fieldsEl.addEventListener('change', renderNotes);



  fieldsEl.addEventListener('keydown', e => {
    const i = inputs.indexOf(e.target);
    if (i < 0 || !isEnter(e)) return;
    e.preventDefault();
    if (i < inputs.length - 1) focusField(i + 1);
    else e.target.blur();
  });

  return { init, open };
})();
