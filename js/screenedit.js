




const ScreenSheet = (() => {
  const dlg = document.getElementById('screen-sheet');

  if (!dlg) return { open() {} };
  const bodyEl = dlg.querySelector('.sheet-body');
  const opt = (v, label, on) => `<option value="${U.esc(v)}"${on ? ' selected' : ''}>${U.esc(label)}</option>`;
  const md = d => U.fmtDate(d).slice(5);


  function countText() {
    const wait = Screens.waiting() || Market.waiting();
    if (wait) return wait;
    const set = Screener.current();
    if (!Screener.active(set).length) return '還沒選條件';
    const n = Market.codes().filter(c => !U.isIndex(c) && Screener.test(set, Screens.get(c))).length;
    return `符合 ${U.fmtNum(n)} 檔${Screens.date() ? `・${md(Screens.date())} 收盤` : ''}`;
  }


  function sortHTML(set) {
    const cur = Screener.sortOf(set);
    const list = [['code', '依代號'], ['chg:-1', '漲幅大的在前'], ['chg:1', '跌幅大的在前']];
    Screener.active(set).filter(c => Screener.natural(c.t)).forEach(c => {
      const name = c.sortName || c.short;
      list.push([`${c.key}:-1`, `${name}${c.count ? '多到少' : '高到低'}`], [`${c.key}:1`, `${name}${c.count ? '少到多' : '低到高'}`]);
    });
    return list.map(([v, label]) => opt(v, label, v === cur)).join('');
  }

  function render() {
    const set = Screener.current();
    const row = (id, label, control, on = false, note = '') =>
      `<li${on ? ' class="on"' : ''}><label class="member-info" for="${id}"><b>${label}</b>${note ? `<small>${U.esc(note)}</small>` : ''}</label>${control}</li>`;
    bodyEl.innerHTML = `
      <p class="screen-count" role="status">${U.esc(countText())}</p>
      <ul class="member-list kd-marks screen-conds">
        ${row('sc-name', '名稱', `<input id="sc-name" type="text" maxlength="${Screener.NAME_MAX}" value="${U.esc(set.name)}" autocomplete="off" enterkeyhint="done">`)}
        ${row('sc-kind', '種類', `<select id="sc-kind" data-k="kind">${Screener.KINDS.map(([v, label]) => opt(v, label, v === set.kind)).join('')}</select>`)}
        ${row('sc-sort', '排序', `<select id="sc-sort" data-k="sort">${sortHTML(set)}</select>`)}
      </ul>
      <ul class="member-list kd-marks screen-conds">
        ${Screener.CONDS.map(c => row(`sc-${c.key}`, U.esc(c.label),
          `<select id="sc-${c.key}" data-cond="${c.key}">${opt('', '不限', !set.conds[c.key])}${c.opts.map(([v, label]) => opt(v, label, v === set.conds[c.key])).join('')}</select>`,
          !!set.conds[c.key], c.note)).join('')}
      </ul>
      <button type="button" class="wide-btn" data-act="add">新增一組</button>
      ${Screener.sets().length > 1 ? '<button type="button" class="wide-btn danger" data-act="remove">刪除這一組</button>' : ''}
      <p class="note muted">條件只記在這台裝置。算不出來的數字（例如 ETF 沒有 EPS）算不符合。</p>`;
  }


  function after() {
    const set = Screener.current();
    bodyEl.querySelector('.screen-count').textContent = countText();
    bodyEl.querySelector('#sc-sort').innerHTML = sortHTML(set);
  }

  bodyEl.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.cond) {
      const conds = { ...Screener.current().conds };
      if (el.value) conds[el.dataset.cond] = el.value;
      else delete conds[el.dataset.cond];
      Screener.update({ conds });
      el.closest('li').classList.toggle('on', !!el.value);
      after();
    } else if (el.dataset.k === 'kind') {
      Screener.update({ kind: el.value });
      after();
    } else if (el.dataset.k === 'sort') {
      Screener.update({ sort: el.value });
    }
  });
  bodyEl.addEventListener('input', e => {
    if (e.target.id === 'sc-name' && e.target.value.trim()) Screener.update({ name: e.target.value });
  });
  bodyEl.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'sc-name') e.target.blur(); });
  bodyEl.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'add') {
      Screener.add();
      render();
      bodyEl.scrollTop = 0;
    } else if (act === 'remove' && confirm(`刪除「${Screener.current().name}」這一組條件？`)) {
      Screener.remove();
      render();
      bodyEl.scrollTop = 0;
    }
  });
  dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });

  dlg.addEventListener('close', () => {
    const input = bodyEl.querySelector('#sc-name');
    if (input && !input.value.trim()) input.value = Screener.current().name;
  });

  function open() {
    render();
    if (!dlg.open) dlg.showModal();
    bodyEl.scrollTop = 0;
  }


  function refresh() {
    if (dlg.open) bodyEl.querySelector('.screen-count').textContent = countText();
  }

  return { open, refresh };
})();
