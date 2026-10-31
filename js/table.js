// 表格（照券商 App 的累積現金股利、綜合損益、對帳單）：一筆一列，欄位名稱只寫在表頭，一欄上下疊兩個值，點表頭排序
//   記帳、股利（list.js）、總覽的持股（overview.js）、選股（market.js）共用
//   設定裡打開「詳細卡片」時換回原本的卡片（見 Cards）
const Table = (() => {
  // 排序的上下兩個小三角形：dir 是 'asc'（小到大）、'desc'（大到小），沒有用這一欄排序時是空白
  const icon = dir => '<svg class="sort-ind" viewBox="0 0 8 13" aria-hidden="true">' +
    `<path class="${dir === 'asc' ? 'on' : ''}" d="M4 0 8 5H0Z"/><path class="${dir === 'desc' ? 'on' : ''}" d="M0 8h8l-4 5Z"/></svg>`;
  const two = ([a, b = '']) => `${U.esc(a)}${b ? `<br>${U.esc(b)}` : ''}`;

  // 整張表：cols 的第一欄是證券／代號，其他是數字；rows 是 row() 畫好的每一列
  //   每一欄 { label: [上, 下], sort: 點下去送出的值（data-act="sort"，沒有就不能點）, dir: 目前用這一欄排序的方向 }
  function html(cols, rows) {
    const th = (c, i) => {
      const cls = `tcell th${i ? '' : ' tname'}`;
      return c.sort
        ? `<button type="button" class="${cls}" data-act="sort" data-value="${U.esc(c.sort)}" aria-label="依${U.esc(c.label.join(''))}排序">${icon(c.dir)}<span>${two(c.label)}</span></button>`
        : `<span class="${cls}"><span>${two(c.label)}</span></span>`;
    };
    return `<div class="table" style="--tn:${cols.length - 1}"><div class="trow thead">${cols.map(th).join('')}</div>${rows.join('')}</div>`;
  }

  // 一列：attrs 是點下去要用的 data-id 或 data-code（沒有時不能點）；cells 是 name()、cell()、date() 畫好的格子；note 是整列寬的紅字
  const row = ({ attrs = '', cls = '', cells, note = '' }) => {
    const inner = `${cells.join('')}${note ? `<span class="trow-note">${U.esc(note)}</span>` : ''}`;
    return attrs
      ? `<button type="button" class="trow${cls ? ` ${cls}` : ''}" ${attrs}>${inner}</button>`
      : `<div class="trow static${cls ? ` ${cls}` : ''}">${inner}</div>`;
  };
  // 第一格：名稱粗體，下面一行代號；sub 接在代號後面（成員、標籤，已經是 HTML）
  const name = (title, code, sub = '') =>
    `<span class="tcell tname"><b>${U.esc(title)}</b><small>${U.esc(code)}${sub}</small></span>`;
  // 一格：上下兩個值（已經是 HTML，例如 Privacy 處理過的數字）；cls：strong 主要的數字、up 紅、down 綠，也可以是 KD 的 low、high
  const cell = (top, bottom = '', cls = '') =>
    `<span class="tcell${cls ? ` ${cls}` : ''}">${top}${bottom === '' ? '' : `<small>${bottom}</small>`}</span>`;
  // 日期：「月/日」，下面小字是年
  const date = d => (d ? `<span class="tcell">${U.esc(U.fmtDate(d).slice(5))}<small class="year">${U.esc(d.slice(0, 4))}</small></span>` : cell('—'));

  // 依 val(r) 排序，空白的放最後；一樣的時候照原本的順序（sort 是穩定排序）
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

// 詳細卡片：設定裡的開關（和隱藏金額一樣），全部頁面一起換；只記在這台裝置，預設關（精簡的表格）
//   打開時清單改回原本的卡片，每一筆的資料都寫出來
const Cards = (() => {
  const KEY = 'stockbook.cards';
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
    // 切換時通知（app.js 重畫每一頁）
    onChange: fn => listeners.push(fn),
  };
})();
