// KD：行情的一頁（列表、「全部｜持有｜觀察」、搜尋見 market.js），每一檔最近一個交易日的日 KD（9、3、3）
//   K、D 是 GitHub 每個工作天收盤後算好的（資料見 market.js，算法見 tools/kd.mjs），盤中不會跟著變
//   K 值低於下限：綠色、標「低檔」；高於上限：紅色、標「高檔」；D 值也照同樣的上下限上色
//     上下限在設定裡選（預設 25、75），只記在這台裝置
//   黃金交叉：前一個交易日 K ≤ D、今天 K > D（K 由下往上穿過 D），紅色；死亡交叉：前一天 K ≥ D、今天 K < D，綠色
//   紅綠照台股的習慣（漲紅跌綠），和總覽的損益一樣；熟了看顏色就好
//   交叉右邊的灰色小字寫在哪裡交叉：低檔、中間、高檔（照上下限分，看交叉時的 D 值），不熟的照著字讀
//     同樣是黃金交叉，在低檔和在高檔意思不一樣（使用說明有寫），所以一定寫出位置
//   排序：K 值低到高（預設，找低檔的）、K 值高到低、依代號；算不出 KD 的放最後
//   K 值低於下限、今天黃金交叉達到星星條件時，旁邊標 ★（見 stars.js）
const KD = (() => {
  const KEY = 'stockbook.kdMarks';
  const LOWS = [10, 15, 20, 25, 30, 35, 40];
  const HIGHS = [60, 65, 70, 75, 80, 85, 90];
  const listeners = [];
  let marks = { low: 25, high: 75 };
  try {
    const m = JSON.parse(localStorage.getItem(KEY));
    if (LOWS.includes(m?.low) && HIGHS.includes(m?.high)) marks = { low: m.low, high: m.high };
  } catch (_) {}

  function set(low, high) {
    if (!LOWS.includes(low) || !HIGHS.includes(high)) return;
    marks = { low, high };
    try { localStorage.setItem(KEY, JSON.stringify(marks)); } catch (_) {}
    listeners.forEach(fn => fn(marks));
  }

  // 'low'：低於下限、'high'：高於上限、''：中間或算不出來
  const zone = v => (typeof v !== 'number' ? '' : v < marks.low ? 'low' : v > marks.high ? 'high' : '');

  // 'golden'：黃金交叉、'dead'：死亡交叉、''：沒有交叉或算不出來（m 是 Market.get 的結果）
  function cross(m) {
    if (!m || [m.k, m.d, m.pk, m.pd].some(v => typeof v !== 'number')) return '';
    if (m.pk <= m.pd && m.k > m.d) return 'golden';
    if (m.pk >= m.pd && m.k < m.d) return 'dead';
    return '';
  }

  // 在哪裡交叉：'low' 低檔、'mid' 中間、'high' 高檔；沒有交叉是 ''
  //   看交叉時的 D 值：交叉的那一刻 K、D 差不多高，D 動得比較慢，比較能代表在哪裡交叉的
  const crossAt = m => (cross(m) ? zone(m.d) || 'mid' : '');

  return {
    LOWS, HIGHS, set, zone, cross, crossAt,
    get low() { return marks.low; },
    get high() { return marks.high; },
    // 改了上下限時通知（app.js 重畫 KD 頁）
    onChange: fn => listeners.push(fn),
  };
})();

// KD 這一頁（列表見 market.js 的 createMarket）
const KD_PAGE = (() => {
  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
  const fmt = v => (typeof v === 'number' ? U.fmtNum(v, 2) : '—');
  const ZONE = { low: ['sell', '低檔'], high: ['buy', '高檔'] };
  const CROSS = { golden: ['up', '黃金交叉'], dead: ['down', '死亡交叉'] };
  const AT = { low: '低檔', mid: '中間', high: '高檔' };
  // 交叉那一格：[class, 內容]；顏色分黃金、死亡，右邊灰色小字寫在哪裡交叉（詳細頁 detail.js 也用）
  function crossCell(m) {
    const c = CROSS[KD.cross(m)];
    return c ? [`strong ${c[0]}`, `${c[1]}<small>${AT[KD.crossAt(m)]}</small>`] : ['', '—'];
  }
  // 算不出 KD 的放最後
  const byK = dir => (a, b) => (a.k === null) - (b.k === null) || (a.k === null ? 0 : (a.k - b.k) * dir);

  function enrich(r) {
    const m = Market.get(r.code);
    return { ...r, m, k: typeof m?.k === 'number' ? m.k : null };
  }

  // 卡片下面的說明：收盤價是哪一天的、前一個交易日的 KD，或算不出來的原因
  //   close：連收盤價一起寫（詳細頁沒有收盤價那一格：一排四格太窄，交叉旁邊的小字會被擠到下一行）
  function note({ m }, { close = false } = {}) {
    if (!m) return Market.waiting() || '沒有這檔的收盤資料（興櫃、還沒開始交易的沒有）';
    const day = `${md(m.date)} 收盤${close ? ` ${U.fmtNum(m.close, 2)}` : ''}`;
    if (m.k === null) return `${day}；成交不到 9 天，還算不出 KD`;
    const prev = typeof m.pk === 'number' ? `；前一個交易日 K ${fmt(m.pk)}、D ${fmt(m.pd)}` : '';
    return `${day}${m.date !== Market.date() ? '（之後沒有成交）' : ''}${prev}`;
  }

  function cardHTML(r) {
    const { m } = r;
    const kz = KD.zone(m?.k);
    const dz = KD.zone(m?.d);
    const [crossCls, crossText] = crossCell(m);
    const tags = [r.held ? '<span class="badge member">持有</span>' : r.watched ? '<span class="badge">觀察</span>' : ''];
    if (kz) tags.push(`<span class="badge ${ZONE[kz][0]}">${ZONE[kz][1]}</span>`);
    const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
    return `
      <div class="card kd-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tags.join('') ? `<span class="card-tags">${tags.join('')}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>K 值${Stars.mark(r, 'kdLow')}</small><b class="kd-k ${kz}">${fmt(m?.k)}</b></span>
        </span>
        <span class="card-grid">
          ${cell('收盤價', m ? U.fmtNum(m.close, 2) : '—')}
          ${cell('D 值', fmt(m?.d), dz)}
          ${cell(`交叉${Stars.mark(r, 'golden')}`, crossText, crossCls)}
        </span>
        <span class="card-note">${U.esc(note(r))}</span>
      </div>`;
  }

  // 列表上面的說明：顏色的意思（上下限可以調整）、資料是哪一天的
  function introHTML() {
    const day = Market.date();
    const data = Market.waiting() || `依 ${md(day)} 收盤計算，每個交易日收盤後更新`;
    return `<p class="list-intro">日 KD（9 日）：K 值低於 ${KD.low} 是綠色、高於 ${KD.high} 是紅色` +
      '（<button type="button" class="link-btn" data-act="kd-marks">調整</button>）。' +
      '黃金交叉（紅）是 K 由下往上穿過 D，死亡交叉（綠）是由上往下，旁邊的小字是在低檔、中間還是高檔交叉。' +
      `<br>${U.esc(data)}</p>`;
  }

  return {
    title: 'KD',
    sorts: [['low', 'K 值低到高', byK(1)], ['high', 'K 值高到低', byK(-1)], ['code', '依代號', null]],
    enrich, cardHTML, introHTML,
    note, crossCell, // 詳細頁（detail.js）也用
  };
})();
