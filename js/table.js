


const Table = (() => {

  const icon = dir => '<svg class="sort-ind" viewBox="0 0 8 13" aria-hidden="true">' +
    `<path class="${dir === 'asc' ? 'on' : ''}" d="M4 0 8 5H0Z"/><path class="${dir === 'desc' ? 'on' : ''}" d="M0 8h8l-4 5Z"/></svg>`;
  const two = ([a, b = '']) => `${U.esc(a)}${b ? `<br>${U.esc(b)}` : ''}`;



  function html(cols, rows) {
    const th = (c, i) => {
      const cls = `tcell th${i ? '' : ' tname'}`;
      return c.sort
        ? `<button type="button" class="${cls}" data-act="sort" data-value="${U.esc(c.sort)}" aria-label="依${U.esc(c.label.join(''))}排序">${icon(c.dir)}<span>${two(c.label)}</span></button>`
        : `<span class="${cls}"><span>${two(c.label)}</span></span>`;
    };
    return `<div class="table" style="--tn:${cols.length - 1}"><div class="trow thead">${cols.map(th).join('')}</div>${rows.join('')}</div>`;
  }


  const row = ({ attrs = '', cls = '', cells, note = '' }) => {
    const inner = `${cells.join('')}${note ? `<span class="trow-note">${U.esc(note)}</span>` : ''}`;
    return attrs
      ? `<button type="button" class="trow${cls ? ` ${cls}` : ''}" ${attrs}>${inner}</button>`
      : `<div class="trow static${cls ? ` ${cls}` : ''}">${inner}</div>`;
  };

  const name = (title, code, sub = '') =>
    `<span class="tcell tname"><b>${U.esc(title)}</b><small>${U.esc(code)}${sub}</small></span>`;

  const cell = (top, bottom = '', cls = '') =>
    `<span class="tcell${cls ? ` ${cls}` : ''}">${top}${bottom === '' ? '' : `<small>${bottom}</small>`}</span>`;

  const date = d => (d ? `<span class="tcell">${U.esc(U.fmtDate(d).slice(5))}<small class="year">${U.esc(d.slice(0, 4))}</small></span>` : cell('—'));


  function sort(rows, val, desc) {
    const empty = v => v === null || v === undefined || v === '';
    return rows.sort((a, b) => {
      const x = val(a), y = val(b);
      if (empty(x) || empty(y)) return empty(x) === empty(y) ? 0 : empty(x) ? 1 : -1;
      return x === y ? 0 : (x < y ? -1 : 1) * (desc ? -1 : 1);
    });
  }

  return { html, row, name, cell, date, sort };
})();



const Cards = (() => {
  const KEY = U.key('cards');
  const listeners = [];
  let on = false;
  try { on = localStorage.getItem(KEY) === '1'; } catch (_) {}

  function set(v) {
    on = !!v;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (_) {}
    listeners.forEach(fn => fn(on));
  }

  return {
    get on() { return on; },
    set,

    onChange: fn => listeners.push(fn),
  };
})();
