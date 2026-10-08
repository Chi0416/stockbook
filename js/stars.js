// 星星：每個指標的條件達標就給一顆 ★，找出最符合自己條件的股票
//   條件在設定的「星星條件」打勾、選數字（只記在這台裝置）：
//     殖利率頁：殖利率至少幾 %（預設 5%）、暴力年化是紅色（最近一次配得比近一年平均多，見 yield.js）
//     KD 頁：K 值低於 KD 標記的下限（低檔，見 kd.js）、今天黃金交叉
//       黃金交叉算哪個位置的自己選（預設只算低檔）：低檔和高檔交叉的意思不一樣，位置照 KD.crossAt
//     EPS 頁：達成率超過進度（今年賺得比去年快，見 eps.js）；可以選要超前幾 % 以上（預設超過就算）
//       以前存的設定沒有這一項：照預設，打勾、超過就算
//   殖利率、KD、EPS 頁上達標的那個數字旁邊標 ★；★ 星星頁把一檔的星星加起來，由多排到少（見 STARS_PAGE）
//   以後加新的指標：在 LIST 加條件，星星頁自動算進去
const Stars = (() => {
  const KEY = 'stockbook.stars';
  const YIELDS = [3, 4, 5, 6, 7, 8, 9, 10];
  // 黃金交叉算哪個位置的
  const CROSS_AT = [['low', '只算低檔'], ['mid', '低檔和中間'], ['any', '任何位置']];
  // EPS 達成率要超前進度幾 %（0：超過就算）
  const EPS_AHEADS = [0, 5, 10, 15, 20, 25, 30];
  const listeners = [];
  let cfg = { yieldMin: 5, crossAt: 'low', epsAhead: 0, off: [] };
  const crossOk = r => {
    const at = KD.crossAt(r.m);
    return cfg.crossAt === 'any' || at === 'low' || (cfg.crossAt === 'mid' && at === 'mid');
  };

  // r 是行情頁 enrich 過的一檔：y 殖利率、ya 暴力年化、info（Yield.info）、k、m（Market.get）、e（Eps.info）
  const LIST = [
    { key: 'yield', short: '殖利率', label: () => `殖利率至少 ${cfg.yieldMin}%`,
      test: r => typeof r.y === 'number' && r.y * 100 >= cfg.yieldMin - 1e-9 },
    { key: 'trend', short: '暴力年化', label: () => '暴力年化是紅色（最近一次配得比近一年平均多）',
      test: r => typeof r.ya === 'number' && r.info?.trend > 0 },
    { key: 'kdLow', short: '低檔', label: () => `K 值低於 ${KD.low}（低檔）`,
      test: r => KD.zone(r.k) === 'low' },
    { key: 'golden',
      get short() { return cfg.crossAt === 'low' ? '低檔黃金交叉' : '黃金交叉'; },
      label: () => `今天黃金交叉（${{ low: '只算低檔', mid: '低檔和中間', any: '任何位置' }[cfg.crossAt]}）`,
      test: r => KD.cross(r.m) === 'golden' && crossOk(r) },
    { key: 'eps', short: 'EPS 超前',
      label: () => (cfg.epsAhead ? `EPS 達成率超前進度 ${cfg.epsAhead}% 以上` : 'EPS 達成率超過進度（今年賺得比去年快）'),
      test: r => typeof r.e?.ahead === 'number' && (cfg.epsAhead ? r.e.ahead >= cfg.epsAhead : r.e.ahead > 0) },
  ];

  try {
    const c = JSON.parse(localStorage.getItem(KEY));
    if (YIELDS.includes(c?.yieldMin) && Array.isArray(c.off)) {
      cfg = {
        yieldMin: c.yieldMin,
        crossAt: CROSS_AT.some(([v]) => v === c.crossAt) ? c.crossAt : 'low',
        epsAhead: EPS_AHEADS.includes(c.epsAhead) ? c.epsAhead : 0,
        off: c.off.filter(k => LIST.some(x => x.key === k)),
      };
    }
  } catch (_) {}

  function set(next) {
    const c = { ...cfg, ...next };
    if (!YIELDS.includes(c.yieldMin) || !CROSS_AT.some(([v]) => v === c.crossAt) || !EPS_AHEADS.includes(c.epsAhead)) return;
    cfg = { yieldMin: c.yieldMin, crossAt: c.crossAt, epsAhead: c.epsAhead, off: LIST.map(x => x.key).filter(k => c.off.includes(k)) };
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) {}
    listeners.forEach(fn => fn(cfg));
  }

  const isOn = k => !cfg.off.includes(k);
  // 打勾的條件
  const on = () => LIST.filter(x => isOn(x.key));
  // 這一檔達標的條件（只算打勾的）
  const of = r => on().filter(x => x.test(r));
  // 這個條件有打勾、而且達標
  const has = (r, k) => isOn(k) && LIST.find(x => x.key === k).test(r);
  // 數字旁邊的星星（沒達標是空的）
  const mark = (r, k) => (has(r, k) ? ' <span class="star" title="達標">★</span>' : '');

  return {
    LIST, YIELDS, CROSS_AT, EPS_AHEADS, set, isOn, on, of, has, mark,
    get yieldMin() { return cfg.yieldMin; },
    get crossAt() { return cfg.crossAt; },
    get epsAhead() { return cfg.epsAhead; },
    // 改了條件時通知（app.js 重畫行情）
    onChange: fn => listeners.push(fn),
  };
})();

// ★ 星星這一頁（列表見 market.js 的 createMarket）：一檔的星星加起來，由多排到少；一樣多時殖利率高的在前
//   卡片下面一排是每個條件看的數字：殖利率、暴力年化、K 值、EPS 達成率（一排四格，手機上剛好放得下，所以沒有現價）
const STARS_PAGE = (() => {
  const fmt = v => (typeof v === 'number' ? U.fmtNum(v, 2) : '—');
  const pct = n => (typeof n === 'number' ? `${U.fmtNum(U.round(n * 100, 2), 2)}%` : '—');

  // 殖利率、KD、EPS 三頁的數字都要
  function enrich(r) {
    const row = { ...YIELD_PAGE.enrich(r), ...KD_PAGE.enrich(r), ...EPS_PAGE.enrich(r) };
    row.stars = Stars.of(row);
    row.n = row.stars.length;
    return row;
  }

  // ★★★☆：達標幾顆、打勾的條件一共幾顆
  const starsText = n => '★'.repeat(n) + '☆'.repeat(Math.max(0, Stars.on().length - n));

  function cardHTML(r) {
    const tag = holdTagsHTML(r);
    const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
    const kz = KD.zone(r.k);
    return `
      <div class="card stars-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tag ? `<span class="card-tags">${tag}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>星星</small><b class="stars-n${r.n ? '' : ' none'}">${starsText(r.n)}</b></span>
        </span>
        <span class="card-grid">
          ${cell('殖利率', pct(r.y))}
          ${cell('暴力年化', pct(r.ya), r.ya === null ? '' : r.info?.trend > 0 ? 'up' : r.info?.trend < 0 ? 'down' : '')}
          ${cell('K 值', fmt(r.k), kz)}
          ${cell('EPS 達成率', r.e?.pct == null ? '—' : `${r.e.pct}%`, EPS_PAGE.tone(r.e))}
        </span>
        <span class="card-note">${r.n ? `達標：${r.stars.map(x => x.short).join('、')}` : '沒有達標的條件'}</span>
      </div>`;
  }

  function introHTML() {
    const list = Stars.on();
    const how = list.length
      ? `每個條件達標就給一顆 ★：${list.map(x => x.label()).join('、')}`
      : '星星條件都沒有打勾';
    return `<p class="list-intro">${U.esc(how)}（<button type="button" class="link-btn" data-act="stars-set">調整</button>）。` +
      '星星一樣多時，殖利率高的在前。點一檔看詳細資料。</p>';
  }

  return {
    title: '★ 星星',
    sorts: [
      ['stars', '依星星', (a, b) => b.n - a.n || (b.y ?? -1) - (a.y ?? -1)],
      ['code', '依代號', null],
    ],
    enrich, cardHTML, introHTML,
  };
})();
