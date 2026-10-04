// 新增／編輯表單：從底部彈出的 sheet，各資料表共用
const Form = (() => {
  const dlg = document.getElementById('form-sheet');
  const titleEl = dlg.querySelector('.sheet-title');
  const closeBtn = dlg.querySelector('[data-act="close"]');
  const saveBtn = dlg.querySelector('[data-act="save"]');
  const delBtn = dlg.querySelector('[data-act="delete"]');
  const bodyEl = dlg.querySelector('.sheet-body');
  const statusEl = dlg.querySelector('.sheet-status');
  const fieldsEl = dlg.querySelector('.fields');

  let ctx = null;     // { tableKey, schema, id, count, fields }
  let inputs = [];
  let chipBoxes = []; // 各欄位的快選按鈕容器（沒有快選的欄位為 null）
  let noteEls = [];   // 各欄位的提醒（schema 的 note；沒有的欄位為 null）
  let initial = [];   // 開啟或連續新增後的欄位值，用來判斷是否有未儲存的內容
  let hooks = { toast() {}, onChanged() {} };

  // 注音等輸入法選字時按的 Enter 不算
  const isEnter = e => e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;
  const editValue = v => (v == null ? '' : String(v));
  const defaultValue = f => (f.type === 'member' ? Store.defaultMember() : editValue(f.default));

  function init(h) {
    hooks = h;
  }

  // perMember 欄位（例如基準日股數）展開成每位成員各一格數字欄位；
  // 儲存時再合併成 { 成員 id: 數字 } 放回原本的 key（group）
  function expandFields(fields) {
    const members = Store.members();
    return fields.flatMap(f => (f.type !== 'perMember' ? [f] : members.map((m, j) => ({
      ...f,
      type: 'number',
      key: `${f.key}.${m.id}`,
      group: f.key,
      memberId: m.id,
      label: members.length > 1 ? `${f.label}（${m.name}）` : f.label,
      hint: j === members.length - 1 ? f.hint : '',
    }))));
  }

  function open(tableKey, id) {
    const schema = SCHEMAS[tableKey];
    const rec = id ? Store.list(tableKey, 'all').find(r => r.id === id) : null;
    if (id && !rec) return;
    ctx = { tableKey, schema, id, count: 0, fields: expandFields(schema.fields) };
    titleEl.textContent = `${id ? '編輯' : '新增'}${schema.title}`;
    closeBtn.textContent = '取消';
    delBtn.hidden = !id;
    statusEl.hidden = true;
    buildFields(rec);
    dlg.showModal();
    bodyEl.scrollTop = 0;
  }

  const fieldIndex = key => ctx.fields.findIndex(f => f.key === key);

  function buildFields(rec) {
    const fields = ctx.fields;
    fieldsEl.innerHTML = '';
    chipBoxes = fields.map(() => null);
    noteEls = fields.map(() => null);
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
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        inp.setAttribute('enterkeyhint', i === fields.length - 1 ? 'done' : 'next');
      } else if (Store.members().length < 2) {
        wrap.hidden = true; // 只有一位成員時不用選
      }
      inp.value = rec ? editValue(f.group ? rec[f.group]?.[f.memberId] : rec[f.key]) : defaultValue(f);

      const label = document.createElement('label');
      label.htmlFor = inp.id;
      label.textContent = f.label;
      wrap.append(label, inp);
      if (f.suggest) {
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
    // 成對的快選按鈕放在兩個欄位下方，佔滿整列
    fields.forEach((f, i) => {
      if (!f.pair) return;
      chipBoxes[i] = document.createElement('div');
      chipBoxes[i].className = 'chips chips-row';
      wraps[Math.max(i, fieldIndex(f.pair))].after(chipBoxes[i]);
    });
    renderAllChips();
    renderNotes();
    initial = inputs.map(inp => inp.value);
  }

  // 欄位下方的提醒，依目前填的內容重新產生（例如成交日期已經算在庫存快照裡）
  function renderNotes() {
    if (!noteEls.some(Boolean)) return;
    const values = Object.fromEntries(ctx.fields.map((f, i) => {
      const raw = inputs[i].value.trim();
      return [f.key, f.type === 'date' ? U.parseDate(raw) || '' : raw];
    }));
    noteEls.forEach((el, i) => { if (el) el.textContent = ctx.fields[i].note(values) || ''; });
  }

  // 成員下拉選單；全家檢視時預設空白，要選了才能儲存
  function memberSelect() {
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="">選擇成員</option>' +
      Store.members().map(m => `<option value="${U.esc(m.id)}">${U.esc(m.name)}</option>`).join('');
    return sel;
  }

  // ---------- 快選按鈕：本表最近輸入過的在前，再補上 suggestFrom 的資料表與預設值（含全家的資料） ----------
  function recentRecords(f) {
    return [ctx.tableKey, ...(f.suggestFrom || [])].flatMap(t => Store.list(t, 'all').slice().reverse());
  }

  function suggestions(f) {
    const seen = new Set();
    recentRecords(f).forEach(r => { if (r[f.key]) seen.add(String(r[f.key])); });
    f.suggest.forEach(v => seen.add(v));
    return [...seen].slice(0, 12);
  }

  // 代號＋證券：依代號去重，名稱取最近一次輸入的
  function pairSuggestions(f) {
    const byCode = new Map();
    recentRecords(f).forEach(r => {
      const c = String(r[f.key] ?? '').trim();
      if (c && !byCode.has(c)) byCode.set(c, String(r[f.pair] ?? ''));
    });
    return [...byCode].map(([code, name]) => ({ code, name }));
  }

  const chipHTML = (i, value, text, on, pairValue) =>
    `<button type="button" class="chip${on ? ' on' : ''}" data-i="${i}" data-v="${U.esc(value)}"` +
    `${pairValue == null ? '' : ` data-pair="${U.esc(pairValue)}"`}>${U.esc(text)}</button>`;

  function renderChips(i) {
    const f = ctx.fields[i];
    const box = chipBoxes[i];
    if (!box) return;

    if (f.pair) {
      const code = inputs[i].value.trim();
      const name = inputs[fieldIndex(f.pair)].value.trim();
      const all = pairSuggestions(f);
      const picked = p => p.code === code && p.name === name;
      // 有輸入代號就用代號篩選，否則用證券名稱篩選
      const q = (code || name).toLowerCase();
      const list = !q || all.some(picked)
        ? all
        : all.filter(p => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
      box.innerHTML = list.slice(0, 8).map(p => chipHTML(i, p.code, `${p.code} ${p.name}`, picked(p), p.name)).join('');
      return;
    }

    const all = suggestions(f);
    const q = inputs[i].value.trim();
    // 空白或剛好選中某個值時列出全部，打字時只列出包含該文字的
    const list = !q || all.includes(q) ? all : all.filter(v => v.includes(q));
    box.innerHTML = list.slice(0, 8).map(v => chipHTML(i, v, v, v === q)).join('');
  }

  function renderAllChips() {
    inputs.forEach((_, i) => renderChips(i));
  }

  // 輸入已知代號時，證券名稱還空著就自動帶入
  function autofillPair(i) {
    const f = ctx.fields[i];
    if (!f.pair) return;
    const nameInp = inputs[fieldIndex(f.pair)];
    if (nameInp.value.trim()) return;
    const code = inputs[i].value.trim().toUpperCase();
    const hit = pairSuggestions(f).find(p => p.code.toUpperCase() === code);
    if (hit) {
      nameInp.value = hit.name;
      setError(fieldIndex(f.pair), '');
    }
  }

  // ---------- 讀取欄位：只擋空白（optional 除外）、非數字、日期格式 ----------
  function setError(i, msg) {
    const wrap = inputs[i].parentElement;
    wrap.classList.toggle('invalid', !!msg);
    wrap.querySelector('.err').textContent = msg;
  }

  function collect() {
    const rec = {};
    let firstBad = null;
    ctx.fields.forEach((f, i) => {
      const raw = inputs[i].value.trim();
      let v = raw;
      let msg = '';
      if (!raw) {
        if (f.optional) v = null;
        else msg = f.type === 'member' ? '請選擇成員' : '必填';
      } else if (f.type === 'number' && (v = U.parseNum(raw)) === null) msg = '請輸入數字';
      else if (f.type === 'date' && (v = U.parseDate(raw)) === null) msg = '日期格式如 2025/06/05';
      setError(i, msg);
      if (msg && !firstBad) firstBad = inputs[i];
      if (f.group) {
        // 每位成員一格的欄位合併成 { 成員 id: 數字 }；空白的不存（全部清空時存成 {}，才蓋得掉舊值）
        rec[f.group] = rec[f.group] || {};
        if (v !== null) rec[f.group][f.memberId] = v;
      } else {
        rec[f.key] = v;
      }
    });
    return { rec, firstBad };
  }

  // 有多位成員時，加上這筆屬於誰
  const memberOf = rec => (rec.member && Store.members().length > 1 ? Store.memberName(rec.member) : '');

  function summary(rec) {
    const { code, title, badge, primary } = ctx.schema.card;
    const pf = ctx.fields.find(f => f.key === primary);
    return [memberOf(rec), badge && rec[badge], code && rec[code], rec[title], U.display(pf, rec[primary])]
      .filter(Boolean).join(' ');
  }

  // ---------- 動作 ----------
  function save() {
    const { rec, firstBad } = collect();
    if (firstBad) {
      firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
      firstBad.focus({ preventScroll: true });
      return;
    }

    if (ctx.id) {
      Store.update(ctx.tableKey, ctx.id, rec);
      dlg.close();
      hooks.onChanged(ctx.tableKey, { ...rec, id: ctx.id });
      // 改到目前沒在看的成員時，這筆會從列表上消失，提示一下去了哪裡
      const moved = rec.member && Store.scope !== 'all' && rec.member !== Store.scope;
      hooks.toast(moved ? `已儲存到「${memberOf(rec)}」` : '已儲存');
      return;
    }

    // 新增後表單不關閉，保留 keep 欄位，方便連續輸入整個月的明細
    const saved = Store.add(ctx.tableKey, rec);
    ctx.count++;
    hooks.onChanged(ctx.tableKey, saved);
    inputs.forEach((inp, i) => {
      const f = ctx.fields[i];
      if (!f.keep) inp.value = defaultValue(f);
    });
    renderAllChips();
    renderNotes();
    initial = inputs.map(inp => inp.value);
    closeBtn.textContent = '完成';
    statusEl.textContent = `已新增：${summary(saved)}（本次共 ${ctx.count} 筆）`;
    statusEl.hidden = false;
    bodyEl.scrollTop = 0;
    // 手機上收起鍵盤；電腦上直接跳到下一筆的第一個要填的欄位
    if (matchMedia('(pointer: fine)').matches) {
      const next = inputs[ctx.fields.findIndex(f => !f.keep)] || inputs[0];
      next.focus();
    } else if (document.activeElement) {
      document.activeElement.blur();
    }
  }

  function remove() {
    if (!confirm(`確定刪除這筆${ctx.schema.title}？`)) return;
    Store.remove(ctx.tableKey, ctx.id);
    dlg.close();
    hooks.onChanged(ctx.tableKey, null);
    hooks.toast('已刪除');
  }

  function isDirty() {
    return inputs.some((inp, i) => inp.value !== initial[i] && (ctx.id || !ctx.fields[i].keep));
  }

  function requestClose() {
    if (isDirty() && !confirm('有尚未儲存的內容，確定離開？')) return;
    dlg.close();
  }

  // ---------- 事件 ----------
  saveBtn.addEventListener('click', save);
  closeBtn.addEventListener('click', requestClose);
  delBtn.addEventListener('click', remove);
  dlg.addEventListener('cancel', e => { e.preventDefault(); requestClose(); });

  fieldsEl.addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const i = +chip.dataset.i;
    inputs[i].value = chip.dataset.v;
    setError(i, '');
    const pair = ctx.fields[i].pair;
    if (pair && chip.dataset.pair != null) {
      inputs[fieldIndex(pair)].value = chip.dataset.pair;
      setError(fieldIndex(pair), '');
    }
    renderAllChips();
  });

  fieldsEl.addEventListener('input', e => {
    const i = inputs.indexOf(e.target);
    if (i < 0) return;
    setError(i, '');
    autofillPair(i);
    renderAllChips();
    renderNotes();
  });
  // 日期、下拉選單有些瀏覽器只送 change
  fieldsEl.addEventListener('change', renderNotes);

  // Enter（手機鍵盤的「下一項」）跳下一格，最後一格直接儲存
  fieldsEl.addEventListener('keydown', e => {
    const i = inputs.indexOf(e.target);
    if (i < 0 || !isEnter(e)) return;
    e.preventDefault();
    if (i < inputs.length - 1) inputs[i + 1].focus();
    else save();
  });

  return { init, open };
})();
