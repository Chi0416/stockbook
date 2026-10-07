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
  let lastCode = [];  // 代號欄位上一次的值，用來判斷證券名稱是不是自動帶入的（見 autofillPair）
  let combos = [];    // 股票欄（代號和證券合成一格，見 buildCombo）
  let captions = [];  // 代號＋證券快選按鈕上方的那行小字
  let calcked = [];   // 各欄位上次自動算出來的數字（schema 的 calc）；欄位還是這個數字時才跟著重算
  let announceEl = null; // 公告的除權息（新增除權息時，見 renderAnnounce）
  let announced = [];    // 目前列出的公告
  let hooks = { toast() {}, onChanged() {} };

  // 注音等輸入法選字時按的 Enter 不算
  const isEnter = e => e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;
  const editValue = v => (v == null ? '' : String(v));
  const defaultValue = f => (f.type === 'member' ? Store.defaultMember() : editValue(f.default));

  function init(h) {
    hooks = h;
    // 公告資料下載好（或換了新的）時，表單開著就重列公告
    if (typeof Announced !== 'undefined' && Announced.onChange) {
      Announced.onChange(() => { if (dlg.open) renderAnnounce(); });
    }
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
    titleEl.textContent = `${id ? '編輯' : '新增'}${schema.formTitle || schema.title}`;
    closeBtn.textContent = '取消';
    delBtn.textContent = schema.remove?.label || '刪除這筆';
    delBtn.hidden = !id;
    dlg.dataset.table = tableKey; // 只有股票一格的表單（觀察清單）要留位置給下拉選單（見 style.css）
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
        if (f.toggle) inp.type = 'hidden'; // 值放在藏起來的欄位，畫面上是左右切換的按鈕（見 renderToggles）
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
    // 成對的快選按鈕放在兩個欄位下方，佔滿整列；上面一行小字說明是記過的股票，不是目前的庫存（賣光的也會出現）
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
      if (typeof StockSearch !== 'undefined') buildCombo(i); // 瀏覽器還拿著舊版程式時維持兩格
    });
    // 新增除權息（schema 的 announce）：股票欄和除權息日之間列出公告的除權息
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
    // 修改舊資料：存的數字和算出來的一樣，就當作是自動算的，改了數量、單價會跟著重算；不一樣的是自己填的，不動
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

  // 左右切換的按鈕（交易別的買進｜賣出）：值認得是哪一邊就亮哪一邊
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

  // ---------- 股票欄：代號和證券合成一格（搜尋見 stocksearch.js） ----------
  //   打代號或名稱都可以，下面列出符合的股票，點一下帶入；選好之後只顯示名稱，代號是前面的灰色小字（和列表卡片一樣）
  //   資料還是分成代號、證券兩欄存：原本的兩格藏起來，選好的值放在裡面，儲存、連續新增、提醒都照舊
  //   打完沒點按鈕時（離開這格、按 Enter、儲存），打的是完整代號、完整名稱或「代號 名稱」就認得出來
  //   清單裡找不到時，可以打「代號 名稱」（剛上市的 ETF、已經下市的股票），或按「分開填代號和名稱」改回兩格
  const comboOf = k => combos.find(c => !c.split && (c.i === k || c.n === k));
  const ownStocks = c => pairSuggestions(ctx.fields[c.i]);
  // 正在打字、還沒選好：打的字和選好的名稱不一樣
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
    // 候選放進下拉選單，蓋在下面的欄位上，表單不會跟著變長變短
    c.group = captions[i].parentElement;
    wrap.querySelector('.stock-box').appendChild(c.group);
    chipBoxes[i].id = `stock-list-${i}`;
    chipBoxes[i].setAttribute('role', 'listbox');
    c.text.setAttribute('role', 'combobox');
    c.text.setAttribute('aria-autocomplete', 'list');
    c.text.setAttribute('aria-controls', chipBoxes[i].id);
    // 代號查不到的提醒（schema 的 note）搬到這一格；原本的兩格藏起來
    if (noteEls[i]) wrap.querySelector('.err').before(noteEls[i]);
    inputs[i].parentElement.before(wrap);
    inputs[i].parentElement.hidden = true;
    inputs[n].parentElement.hidden = true;

    // 已經選好時全選，直接打字就會取代原本的名稱（點下去之後已經開始打字的話不選）
    c.text.addEventListener('focus', () => {
      c.editing = true;
      c.open = true;
      renderCombo(c);
      renderChips(c.i);
      // 手機上把這一格捲到表單上方，下拉選單才不會被鍵盤擋住
      if (matchMedia('(pointer: coarse)').matches) {
        setTimeout(() => { if (c.open) c.wrap.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 300);
      }
      const before = c.text.value;
      if (before) setTimeout(() => { if (c.text.value === before) c.text.select(); }, 0);
    });
    // 注音選字途中（ㄊㄞˊ）先不搜尋，選好字才搜尋
    const onType = () => {
      c.editing = true;
      setComboError(c, '');
      renderCombo(c);
      renderChips(c.i);
    };
    c.text.addEventListener('input', e => { if (!e.isComposing) onType(); });
    c.text.addEventListener('compositionend', onType);
    // 離開這格時認認看；稍等一下，點快選按鈕的話先讓按鈕帶入
    c.text.addEventListener('blur', () => setTimeout(() => {
      if (document.activeElement === c.text) return;
      c.open = false;
      if (c.editing) commitCombo(c);
      renderChips(c.i);
      renderNotes();
    }, 150));
    // Enter（手機鍵盤的「下一項」）：認得出來就跳下一格；認不出來時選第一個候選
    c.text.addEventListener('keydown', e => {
      if (e.key === 'Escape' && c.open) {
        // Esc 收起下拉選單（不要連表單一起關掉）
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
        const first = StockSearch.search(c.text.value, ownStocks(c))[0];
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

  // 選好之後顯示名稱，代號是前面的灰色小字；打字時只顯示打的字
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

  // 打完：清空就清掉；和選好的名稱一樣就不動；認得出來就帶入。認不出來回傳 false（字留著，儲存時再提醒）
  function commitCombo(c) {
    const t = c.text.value.trim();
    if (!t) pickStock(c, '', '');
    else if (!typing(c)) {
      c.editing = false;
      renderCombo(c);
    } else {
      const hit = StockSearch.resolve(t, ownStocks(c));
      if (!hit) return false;
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

  // 改回分開的兩格：打的字像代號（數字開頭）就放進代號、否則放進證券，另一格清空，免得和之前選的股票湊在一起
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
    inputs[c.n].parentElement.after(c.group); // 快選按鈕放回兩格下方
    inputs[c.i].parentElement.hidden = false;
    inputs[c.n].parentElement.hidden = false;
    if (noteEls[c.i]) inputs[c.i].parentElement.querySelector('.err').before(noteEls[c.i]);
    lastCode[c.i] = inputs[c.i].value;
    renderChips(c.i);
    renderNotes();
    inputs[inputs[c.i].value ? c.n : c.i].focus();
  }

  // 第 k 個欄位：合成股票欄的代號、證券改成股票欄那一格
  function focusField(k) {
    const c = comboOf(k);
    const toggle = ctx.fields[k]?.toggle && inputs[k].parentElement.querySelector('[data-toggle]');
    (c ? c.text : toggle || inputs[k])?.focus();
  }

  // 各欄位目前填的內容（日期轉成 2025-06-05，看不懂時是空字串）
  const formValues = () => Object.fromEntries(ctx.fields.map((f, i) => {
    const raw = inputs[i].value.trim();
    return [f.key, f.type === 'date' ? U.parseDate(raw) || '' : raw];
  }));

  // 自動算的欄位（例如應收付金額）：空白、或還是上次算的數字時，換成這次算的；算不出來時清掉上次算的
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

  // 欄位下方的提醒，依目前填的內容重新產生（例如成交日期已經算在庫存快照裡）；自動算的欄位先算好
  function renderNotes() {
    recalc();
    if (!noteEls.some(Boolean)) return;
    const values = formValues();
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
  //   不能重複的表（觀察清單）不列本表的：已經加過的不用再加一次
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

  // 代號＋證券：依代號去重，名稱取最近一次輸入的；不能重複的表（觀察清單）不列已經加過的
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

  // ---------- 公告的除權息（見 announced.js）：新增除權息時，選好股票就列出這一檔公告的除權息 ----------
  //   按一下帶入除權息日、發放日、現金股利、股票股利，自己再按儲存；已經記過的那一次不列
  //   固定一行（左右滑），還沒選股票、公告裡沒有、公告的都記過了時寫一句話，表單不會跟著變長變短
  //   公告資料是 App 打開時才下載的：還沒下載好、下載失敗時也寫一句話，下載好了再重列（見 init）
  const ANNOUNCE_KEYS = ['exDate', 'payDate', 'cash', 'stock'];
  // 今年的日期只寫月/日
  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
  // 金額還沒公告（ETF 常常除息前幾天才公告）：只帶入日期，金額自己填
  const pending = r => r.cash == null;
  const announceText = r => (pending(r)
    ? `${md(r.exDate)} 除息、${md(r.payDate)} 發放（金額待公告）`
    : `${md(r.exDate)} ${r.stock ? '除權息' : '除息'}、${md(r.payDate)} 發放、每股 ${U.fmtNum(r.cash)}` +
      (r.stock ? `、配股 ${U.fmtNum(r.stock)}` : ''));
  const announceKeys = r => (pending(r) ? ['exDate', 'payDate'] : ANNOUNCE_KEYS);

  function renderAnnounce() {
    if (!announceEl) return;
    const at = Announced.updated();
    const state = Announced.state ? Announced.state() : 'ready'; // 瀏覽器還拿著舊版程式時一定有資料
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
    // 表單上的日期和金額剛好是這一筆時標起來
    const now = ANNOUNCE_KEYS.map(k => inputs[fieldIndex(k)]?.value.trim() ?? '');
    const on = r => announceKeys(r).every(k => {
      const v = now[ANNOUNCE_KEYS.indexOf(k)];
      return (/Date$/.test(k) ? U.parseDate(v) : U.parseNum(v)) === r[k];
    });
    announceEl.querySelector('.chips').innerHTML = !code ? '<span class="announce-empty">先選股票</span>'
      : !all.length ? '<span class="announce-empty">公告裡沒有這檔，請照股利通知書填</span>'
      // 公告的都記過了（例如一年配一次的個股）：寫出最近一次，才不會以為公告裡沒有
      : !announced.length ? `<span class="announce-empty">公告的除權息都記過了（最近一次 ${U.esc(md(all[0].exDate))} 除息）</span>`
      : announced.slice(0, 6).map((r, k) =>
        `<button type="button" class="chip${on(r) ? ' on' : ''}" data-announce="${k}">${U.esc(announceText(r))}</button>`).join('');
  }

  function renderChips(i) {
    const f = ctx.fields[i];
    const box = chipBoxes[i];
    if (!box) return;

    if (f.pair) {
      renderAnnounce(); // 股票換了，公告跟著換
      const code = inputs[i].value.trim();
      const name = inputs[fieldIndex(f.pair)].value.trim();
      const all = pairSuggestions(f);
      const picked = p => p.code === code && p.name === name;
      const c = comboOf(i);
      if (c) {
        // 股票欄的下拉選單：打字時搜尋自己記過的和股票清單；沒在打字時列出最近記過的；只在這一格有焦點時打開
        const q = typing(c) ? c.text.value.trim() : '';
        const list = q ? StockSearch.search(q, all) : all.slice(0, 8);
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
      // 有輸入代號就用代號篩選，否則用證券名稱篩選
      const q = (code || name).toLowerCase();
      const list = !q || all.some(picked)
        ? all
        : all.filter(p => p.code.toLowerCase().includes(q) || p.name.toLowerCase().includes(q));
      box.innerHTML = list.slice(0, 8).map(p => chipHTML(i, p.code, `${p.code} ${p.name}`, picked(p), p.name)).join('');
      box.parentElement.hidden = !list.length; // 沒有按鈕時連說明一起藏起來
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

  // 代號對應的證券名稱：先找自己記過的（沿用自己的寫法），再找股票清單（stocklist.js）
  //   瀏覽器還拿著舊版程式、沒有清單時只找自己記過的
  function knownName(f, code) {
    const c = U.toHalf(code).trim().toUpperCase();
    if (!c) return '';
    const own = pairSuggestions(f).find(p => p.code.toUpperCase() === c);
    if (own?.name) return own.name;
    return (typeof STOCK_LIST !== 'undefined' && STOCK_LIST.names[c]) || '';
  }

  // 輸入代號時帶入證券名稱：名稱空著，或還是上一個代號帶入的名稱時才換（代號改了，名稱跟著改）
  //   自己打的名稱不會被蓋掉；lastCode 是各欄位上一次的代號
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
        else msg = f.type === 'member' ? '請選擇成員' : f.toggle ? `請選${f.toggle.map(o => o.label).join('或')}` : '必填';
      } else if (f.type === 'number' && (v = U.parseNum(raw)) === null) msg = '請輸入數字';
      else if (f.type === 'date' && (v = U.parseDate(raw)) === null) msg = '日期格式如 2025/06/05';
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

  // 儲存後的提示；隱藏金額時（見 privacy.js）金額顯示成 ***，表單裡的欄位照常顯示
  //   沒有主要數字的表（觀察清單）只寫代號和名稱
  function summary(rec) {
    const { code, title, badge, primary } = ctx.schema.card;
    const pf = primary && ctx.fields.find(f => f.key === primary);
    const amount = pf ? U.display(pf, rec[primary]) : '';
    return [memberOf(rec), badge && rec[badge], code && rec[code], rec[title], pf && (pf.public ? amount : Privacy.num(amount))]
      .filter(Boolean).join(' ');
  }

  // schema.unique 的欄位和別筆一樣（觀察清單裡已經有這一檔）時，回傳那一筆
  function duplicateOf(rec) {
    const keys = ctx.schema.unique;
    if (!keys) return null;
    const norm = v => U.toHalf(v ?? '').trim().toUpperCase();
    return Store.list(ctx.tableKey, 'all').find(r => r.id !== ctx.id && keys.every(k => norm(r[k]) === norm(rec[k]))) || null;
  }

  // ---------- 動作 ----------
  function save() {
    combos.forEach(c => { if (c.editing) commitCombo(c); });
    const { rec, firstBad } = collect();
    if (firstBad) {
      firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
      firstBad.focus({ preventScroll: true });
      return;
    }
    // 已經有了（觀察清單的同一檔股票）：寫在那一格下面，不存
    const dup = duplicateOf(rec);
    if (dup) {
      const i = fieldIndex(ctx.schema.unique[0]);
      const c = comboOf(i);
      const msg = `${ctx.schema.title}裡已經有 ${[dup.code, dup.name].filter(Boolean).join(' ')} 了`;
      if (c) setComboError(c, msg);
      else setError(i, msg);
      document.activeElement?.blur(); // 不把焦點放回股票欄：下拉選單會打開，蓋住這句提醒
      return;
    }

    if (ctx.id) {
      Store.update(ctx.tableKey, ctx.id, rec);
      dlg.close();
      hooks.onChanged(ctx.tableKey, { ...rec, id: ctx.id });
      // 改到目前沒勾選的成員時，這筆會從列表上消失，提示一下去了哪裡
      const moved = rec.member && !Store.shown().includes(rec.member);
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
    calcked = ctx.fields.map(() => null);
    renderAllChips();
    renderNotes();
    initial = inputs.map(inp => inp.value);
    lastCode = inputs.map(inp => inp.value);
    combos.forEach(c => { c.editing = false; c.open = false; setComboError(c, ''); renderCombo(c); renderChips(c.i); });
    renderToggles();
    closeBtn.textContent = '完成';
    statusEl.textContent = `已新增：${summary(saved)}（本次共 ${ctx.count} 筆）`;
    statusEl.hidden = false;
    bodyEl.scrollTop = 0;
    // 手機上收起鍵盤；電腦上直接跳到下一筆的第一個要填的欄位
    if (matchMedia('(pointer: fine)').matches) {
      focusField(Math.max(ctx.fields.findIndex(f => !f.keep), 0));
    } else if (document.activeElement) {
      document.activeElement.blur();
    }
  }

  // 觀察清單寫「確定從觀察清單移除：0056 元大高股息？」（schema 的 remove）
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

  // ---------- 事件 ----------
  saveBtn.addEventListener('click', save);
  closeBtn.addEventListener('click', requestClose);
  delBtn.addEventListener('click', remove);
  dlg.addEventListener('cancel', e => { e.preventDefault(); requestClose(); });

  fieldsEl.addEventListener('click', e => {
    // 公告的除權息：帶入日期和金額
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
      if (pending(r)) inputs[fieldIndex('cash')]?.focus(); // 金額待公告：接著填金額
      return;
    }
    // 左右切換（交易別）：已經是這一邊（例如試算表手打的「融資買進」）就保留原本的字
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
        c.text.blur(); // 選好了，手機上收起鍵盤
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
  // 日期、下拉選單有些瀏覽器只送 change
  fieldsEl.addEventListener('change', renderNotes);

  // Enter（手機鍵盤的「下一項」）跳下一格；最後一格（鍵盤上是「完成」）只收起鍵盤，不會儲存
  //   一定要按右上角的「儲存」才存：按「完成」多半只是想收鍵盤，直接存起來會嚇一跳
  fieldsEl.addEventListener('keydown', e => {
    const i = inputs.indexOf(e.target);
    if (i < 0 || !isEnter(e)) return;
    e.preventDefault();
    if (i < inputs.length - 1) focusField(i + 1);
    else e.target.blur();
  });

  return { init, open };
})();
