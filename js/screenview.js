












const Screener = (() => {
  const KEY = U.key('screens');
  const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '');
  const num = (v, d = 2) => U.fmtNum(U.round(Math.abs(v), d), d);
  const pct = v => `${num(v)}%`;
  const signed = v => `${sign(v)}${num(v)}%`;
  const signedOf = d => v => `${sign(v)}${num(v, d)}%`;
  const upDown = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const at = (list, unit) => list.map(n => [`>=${n}`, `${n}${unit}以上`]);
  const CONDS = [
    { key: 'v5', label: '5 日均量', short: '均量', sortName: '5 日均量', range: true, opts: at([100, 300, 500, 1000, 3000], ' 張'), fmt: v => U.fmtNum(v) },
    { key: 'y', label: '殖利率', short: '殖利率', opts: at([2, 3, 4, 5, 6, 7, 8, 10], '% '), fmt: pct },
    { key: 'ya', label: '暴力年化', short: '暴力年化', opts: at([5, 6, 8, 10, 12, 15], '% '), fmt: pct },
    { key: 'fy', label: '預估殖利率', short: '預估殖利', opts: at([2, 3, 4, 5, 6, 7, 8, 10], '% '), fmt: pct },
    { key: 'ahead', label: 'EPS 達成率', short: 'EPS 超前',
      opts: [['>0', '超過進度'], ...[5, 10, 20, 30].map(n => [`>=${n}`, `超前 ${n}% 以上`])], fmt: signedOf(0), tone: upDown },
    { key: 'growth', label: 'EPS 年增率', note: '和去年同期比', short: 'EPS 年增',
      opts: [['>0', '有成長'], ...[10, 20, 30, 50].map(n => [`>=${n}`, `多 ${n}% 以上`])], fmt: signedOf(1), tone: upDown },
    { key: 'yrs', label: '近 5 年賺錢', short: '賺錢年', sortName: '賺錢年數', count: true, opts: [['>=3', '3 年以上'], ['>=4', '4 年以上'], ['>=5', '5 年都賺']], fmt: v => `${v} 年` },
    { key: 'dir', label: '月線', short: '月線', opts: [['=1', '上彎'], ['=-1', '下彎']],
      fmt: v => (v > 0 ? '上彎' : v < 0 ? '下彎' : '持平'), tone: upDown },
    { key: 'gap', label: '收盤價和月線', short: '離月線',
      opts: [['>0', '站上月線'], ['>=3', '高 3% 以上'], ['>=5', '高 5% 以上'], ['<0', '跌破月線'], ['<=-3', '低 3% 以上'], ['<=-5', '低 5% 以上']],
      fmt: signed, tone: upDown },
    { key: 'lowd', label: '月線扣低', short: '扣低', sortName: '扣低天數', count: true, opts: [['>=3', '3 天以上'], ['>=4', '4 天以上'], ['>=5', '5 天都扣低']], fmt: v => `${v}/5` },
    { key: 'k', label: 'K 值', short: 'K', sortName: 'K 值',
      opts: [...[20, 25, 30].map(n => [`<${n}`, `低於 ${n}`]), ...[70, 75, 80].map(n => [`>${n}`, `高於 ${n}`])],
      fmt: v => num(v), tone: v => KD.zone(v) },
    { key: 'cross', label: 'KD 交叉', short: '交叉', alone: true, opts: [['=1', '金叉'], ['=-1', '死叉']],
      fmt: v => (v > 0 ? '金叉' : v < 0 ? '死叉' : '—'), tone: upDown },
    { key: 'volr', label: '量比', note: '和前 5 天平均比', short: '量比', opts: at([1.5, 2, 3, 5], ' 倍'), fmt: v => num(v) },
    { key: 'r5', label: '近 5 日漲跌', short: '5 日',
      opts: [...[5, 10].map(n => [`>=${n}`, `漲 ${n}% 以上`]), ...[5, 10].map(n => [`<=-${n}`, `跌 ${n}% 以上`])], fmt: signed, tone: upDown },
    { key: 'r20', label: '近 20 日漲跌', short: '20 日',
      opts: [...[10, 20].map(n => [`>=${n}`, `漲 ${n}% 以上`]), ...[10, 20].map(n => [`<=-${n}`, `跌 ${n}% 以上`])], fmt: signed, tone: upDown },
  ];
  const BY = Object.fromEntries(CONDS.map(c => [c.key, c]));
  const KINDS = [['0', '個股'], ['1', 'ETF'], ['all', '全部']];
  const NAME_MAX = 10;
  const listeners = [];


  const parse = t => {
    const m = /^(>=|<=|>|<|=)(-?\d+(?:\.\d+)?)$/.exec(t || '');
    return m ? [m[1], Number(m[2])] : null;
  };
  const passes = (v, t) => {
    const [op, x] = parse(t);
    if (typeof v !== 'number') return false;
    return op === '>=' ? v >= x : op === '<=' ? v <= x : op === '>' ? v > x : op === '<' ? v < x : v === x;
  };

  const natural = t => {
    const op = parse(t)?.[0];
    return op === '<' || op === '<=' ? 1 : op === '=' ? 0 : -1;
  };


  const blank = (id, name) => ({ id, name, kind: '0', conds: {}, sort: '' });
  let store = { sets: [blank('s1', '選股 1')], cur: 's1' };
  const clean = s => {
    const conds = {};
    Object.entries(s?.conds || {}).forEach(([k, t]) => { if (BY[k]?.opts.some(([v]) => v === t)) conds[k] = t; });
    return {
      id: String(s.id),
      name: String(s.name || '').trim().slice(0, NAME_MAX) || '選股',
      kind: KINDS.some(([v]) => v === s.kind) ? s.kind : '0',
      conds,
      sort: typeof s.sort === 'string' && /^(code|chg|[a-z\d]+:-?1)$/.test(s.sort) ? s.sort : '',
    };
  };
  try {
    const got = JSON.parse(localStorage.getItem(KEY));
    const sets = Array.isArray(got?.sets) ? got.sets.filter(s => s?.id).map(clean) : [];
    if (sets.length) store = { sets, cur: sets.some(s => s.id === got.cur) ? got.cur : sets[0].id };
  } catch (_) {}
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (_) {}
  };
  const changed = () => {
    save();
    listeners.forEach(fn => fn());
  };

  const sets = () => store.sets;
  const current = () => store.sets.find(s => s.id === store.cur) || store.sets[0];
  function select(id) {
    if (!store.sets.some(s => s.id === id) || id === store.cur) return;
    store.cur = id;
    changed();
  }

  function update(patch, { quiet = false } = {}) {
    const i = store.sets.findIndex(s => s.id === store.cur);
    store.sets[i] = clean({ ...store.sets[i], ...patch, id: store.sets[i].id });
    if (quiet) save();
    else changed();
  }

  function add() {
    let n = store.sets.length + 1;
    while (store.sets.some(s => s.name === `選股 ${n}`)) n += 1;
    const id = `s${Date.now().toString(36)}`;
    store.sets.push(blank(id, `選股 ${n}`));
    store.cur = id;
    changed();
  }

  function remove() {
    if (store.sets.length < 2) return;
    store.sets = store.sets.filter(s => s.id !== store.cur);
    store.cur = store.sets[0].id;
    changed();
  }


  const active = set => CONDS.filter(c => set.conds[c.key]).map(c => ({ ...c, t: set.conds[c.key] }));

  function test(set, s) {
    if (!s) return false;
    if (set.kind !== 'all' && String(s.kind) !== set.kind) return false;
    return active(set).every(c => passes(s[c.key], c.t));
  }

  function sortOf(set) {
    const list = active(set);
    const [k] = set.sort.split(':');
    if (set.sort === 'code' || (set.sort && (k === 'chg' || list.some(c => c.key === k)))) return set.sort;
    const first = list.find(c => natural(c.t) && !c.range) || list.find(c => natural(c.t));
    return first ? `${first.key}:${natural(first.t)}` : 'code';
  }

  function shown(set) {
    const list = [...active(set).filter(c => !c.range), ...active(set).filter(c => c.range)];
    const [k] = sortOf(set).split(':');
    const i = list.findIndex(c => c.key === k);
    if (i > 0) list.unshift(...list.splice(i, 1));
    return list.slice(0, 4);
  }

  const describe = set => [KINDS.find(([v]) => v === set.kind)[1],
    ...active(set).map(c => `${c.alone ? '' : `${c.short} `}${c.opts.find(([v]) => v === c.t)[1]}`)].join('・');

  return {
    CONDS, BY, KINDS, NAME_MAX, sets, current, select, update, add, remove, active, test, sortOf, shown, describe, natural,
    onChange: fn => listeners.push(fn),
  };
})();

const SCREEN_VIEW = {
  noIndex: true,
  sorts: [['code', '依代號']],
  shows: () => Screener.sets().map(s => [s.id, s.name]),

  flip: Object.fromEntries(['chg', ...Screener.CONDS.map(c => c.key)].flatMap(k => [[`${k}:-1`, `${k}:1`], [`${k}:1`, `${k}:-1`]])),
  empty: '',
  make({ tagsHTML, state }) {
    const md = d => U.fmtDate(d).slice(5);
    const px = v => U.fmtNum(U.round(v, 2), 2);
    const abs = v => U.fmtNum(U.round(Math.abs(v), 2), 2);
    const tone = v => (typeof v !== 'number' || v === 0 ? '' : v > 0 ? 'up' : 'down');
    const value = (c, v) => {
      if (v === null || v === undefined) return '—';
      const cls = c.tone?.(v);
      return cls ? `<span class="${cls}">${c.fmt(v)}</span>` : c.fmt(v);
    };


    function sync() {
      const set = Screener.current();
      state.show = set.id;
      state.sort = Screener.sortOf(set);
    }
    sync();
    const picked = id => Screener.select(id);
    const sorted = s => Screener.update({ sort: s }, { quiet: true });

    function enrich(r) {
      return { ...r, s: Screens.get(r.code) };
    }


    const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
    const by = (k, dir) => (a, b) => {
      const x = a.s?.[k] ?? null;
      const y = b.s?.[k] ?? null;
      return (x === null) - (y === null) || (x === null ? 0 : (x - y) * dir) || byCode(a, b);
    };
    const compare = { code: byCode };
    ['chg', ...Screener.CONDS.map(c => c.key)].forEach(k => {
      compare[`${k}:1`] = by(k, 1);
      compare[`${k}:-1`] = by(k, -1);
    });

    function show() {
      const set = Screener.current();
      const any = Screener.active(set).length > 0;
      return { market: true, keep: r => any && Screener.test(set, r.s) };
    }

    const editBtn = (label = '調整') => `<button type="button" class="link-btn" data-act="screen-edit">${label}</button>`;
    const closeLine = () => (Screens.date() ? `${md(Screens.date())} 收盤` : '');

    function noneText() {
      const wait = Screens.waiting() || Market.waiting();
      if (wait) return U.esc(wait);
      const set = Screener.current();
      if (!Screener.active(set).length) {
        return `還沒選條件<br>選幾個條件，全市場同時符合的會列在這裡<br><button type="button" class="wide-btn primary screen-start" data-act="screen-edit">選條件</button>`;
      }
      return `${U.esc(Screener.describe(set))}<br>目前沒有符合的股票（${editBtn()}）`;
    }

    function tableHTML(rows, search) {
      const set = Screener.current();
      const fields = Screener.shown(set);
      const cur = state.sort;
      const dir = k => (cur === `${k}:-1` ? 'desc' : cur === `${k}:1` ? 'asc' : '');
      const pairs = [fields.slice(0, 2), fields.slice(2, 4)].filter(p => p.length);
      const cols = [
        { label: ['證券', '代號'], sort: 'code', dir: cur === 'code' ? 'asc' : '' },
        { label: ['收盤價', '漲跌幅'], sort: 'chg:-1', dir: dir('chg') },
        ...pairs.map(([a, b]) => {
          const n = Screener.natural(a.t);
          return { label: b ? [a.short, b.short] : [a.short], sort: n ? `${a.key}:${n}` : '', dir: dir(a.key) };
        }),
      ];
      return Table.html(cols, rows.map(r => {
        const s = r.s || {};
        const stale = r.date && r.date !== Market.date() ? `<small class="px-close">${U.esc(md(r.date))}</small>` : '';
        const t = tone(s.chg);
        return Table.row({
          attrs: `data-code="${U.esc(r.code)}"`,
          cells: [
            Table.name(r.name, r.code, tagsHTML(r, search)),
            typeof s.close !== 'number' ? Table.cell('—')
              : Table.cell(`${stale}${px(s.close)}`, typeof s.chg === 'number' ? `${s.chg > 0 ? '+' : s.chg < 0 ? '−' : ''}${abs(s.chg)}%` : '—', `quote-price${t ? ` ${t}` : ''}`),
            ...pairs.map(([a, b]) => Table.cell(value(a, s[a.key]), b ? value(b, s[b.key]) : '', 'strong')),
          ],
        });
      }));
    }


    function cardHTML(r, search) {
      const s = r.s || {};
      const t = tone(s.chg);
      const cell = (label, v) => `<span class="cell"><small>${label}</small><span>${v}</span></span>`;
      const tags = tagsHTML(r, search);
      const list = Screener.active(Screener.current());
      return `
      <div class="card screen-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tags ? `<span class="card-tags">${tags}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>${typeof s.chg === 'number' ? `${s.chg > 0 ? '+' : s.chg < 0 ? '−' : ''}${abs(s.chg)}%` : '收盤價'}</small><b class="${t}">${typeof s.close === 'number' ? px(s.close) : '—'}</b></span>
        </span>
        <span class="card-grid">${list.map(c => cell(c.short, value(c, s[c.key]))).join('')}</span>
      </div>`;
    }


    function introHTML() {
      const set = Screener.current();
      return Note.line(`${U.esc([closeLine(), Screener.describe(set)].filter(Boolean).join('・'))} ${editBtn()}`, '篩選怎麼看',
        '<p>選幾個條件，全市場同時符合的才列出來；算不出來的（例如 ETF 沒有 EPS、剛上市的還沒有月線）算不符合。</p>' +
        '<p>條件可以存好幾組，上面的選單換一組就照那一組列出來，「調整」可以改條件、改名字、新增一組。條件只記在這台裝置。</p>' +
        '<p>預設照第一個條件排序，點表頭換，再點一次反過來。點一檔看 K 線和 KD，上面可以再打開 EPS、股利。</p>' +
        '<p>近 5 日、20 日的漲跌是和那天的收盤價比，沒有扣掉除權息，剛除息的會看起來跌比較多。</p>' +
        `<p class="muted">${U.esc(closeLine() ? `數字是 ${closeLine()}後算好的` : Market.closeNote())}</p>`);
    }

    return { enrich, compare, show, noneText, tableHTML, cardHTML, introHTML, sync, picked, sorted };
  },
};
