// 大盤（加權指數，只有上市）：總覽的指數卡片點了，從底部彈出（和帳戶走勢一樣的 sheet）
//   資料是 shared/taiex.json（由 tools/update-taiex.mjs 產生），打開時才下載；之後用瀏覽器存的，隔 30 分鐘才再檢查有沒有新的
//     和收盤價一樣，GitHub 每個工作天收盤後更新，不用改版本號；沒有網路時用存的上一份
//   由上往下：
//     當日走勢：最近一個交易日 09:00～13:30 每分鐘一點；比前一天收盤高的那段畫紅色、低的畫綠色，前一天收盤畫一條虛線
//       下面一條是每分鐘的成交金額（累積的相減），柱子比前一分鐘漲紅、跌綠
//     日 K 線：最近 20 天，5 日線黃色、月線藍色（和選股的 K 線一樣），下面一條是每天的成交金額（億）
//     三大法人買賣超（億）：每天一根柱子，買超紅、賣超綠；上面切換 合計｜外資｜投信｜自營商（每次打開是合計）
//       點到哪一天，讀數寫那天的四個數字（切到的那個粗體）
//     融資融券：上面切換 融資｜融券｜維持率；線是餘額（融資億元、融券張），下面一條是每天的增減，增加紅、減少綠
//       點到哪一天，讀數寫那天融資、融券的餘額和增減
//       維持率：大盤融資維持率（民間算法，見 tools/update-taiex.mjs），130%（追繳）、140%（警戒）、166%（買進當下）畫虛線
//         讀數寫融資股平均再跌多少碰到 130%，和假設跟大盤同步跌時大約是加權幾點
//     日 K 線、三大法人、融資融券的橫軸是同樣的 20 天，上下對得起來；還沒公布的那天沒有柱子、讀數寫還沒公布
//     融資成本推估：最近 60 個交易日的融資餘額增減 × 當天加權收盤，用 4 種假設算這段期間新增融資的平均成本（見 cost）
//       表格：假設｜平均成本｜維持率（166.67% × 現在指數 ÷ 平均成本）｜130% 線（平均成本 × 0.78）
//     個股追繳價試算：打買進價，算上市（融資 6 成，× 0.78）、上櫃（5 成，× 0.65）碰到 130% 的價格；打的價格只留在畫面上
//   兩張圖都可以點：上面一行讀數平常是最新的，手指（滑鼠）點到、滑到哪裡就換成那一分鐘、那一天；鍵盤左右鍵也可以換
//   數字都是公開的，隱藏金額時照常顯示
const Taiex = (() => {
  const FILE = 'shared/taiex.json';
  const AGAIN = 30 * 60000;
  const W = 1000; // 圖的座標寬、高（畫面上照框的大小縮放，線的粗細不變）
  const H = 400;
  const VH = 90;   // 成交金額那一條的高（座標）
  const VTOP = 26; // 成交金額那一條上面留一行寫金額
  const BARS = 20;
  const dlg = typeof document !== 'undefined' ? document.getElementById('taiex-sheet') : null;

  // 測試時直接放一份全域的 TAIEX_DATA，不用下載
  let data = typeof TAIEX_DATA !== 'undefined' ? TAIEX_DATA : null;
  let state = data ? 'ready' : 'idle';
  let text = '';
  let lastTry = 0;
  let pending = null;
  const charts = {}; // 每張圖的格子（點的時候用）：{ day、k、chips、margin: { pts, latest } }
  const sels = {};   // 每張圖點到第幾格（null 是最新的）：切換合計／外資、融資／融券重畫時留著；每次打開回到最新
  const KINDS = {
    chips: [['total', '合計'], ['foreign', '外資'], ['trust', '投信'], ['dealer', '自營商']],
    margin: [['loan', '融資'], ['short', '融券'], ['ratio', '維持率']],
  };
  const kinds = { chips: 'total', margin: 'loan' }; // 目前切到哪一個（每次打開回到合計、融資）

  // 下載：有新的資料、或第一次就下載失敗時重畫；下載失敗、格式不對時留著原本的資料
  //   again：正在下載時等這次下載完再下載一次（sw.js 通知有新的那時候，正在讀的可能是舊的那份，見 app.js）
  function load(again = false) {
    if (pending) return again ? pending.then(() => load()) : pending;
    lastTry = Date.now();
    if (state === 'idle') state = 'loading';
    const get = async mode => {
      try {
        const res = await fetch(FILE, { cache: mode });
        return res.ok ? await res.text() : null;
      } catch (_) {
        return null;
      }
    };
    pending = (async () => {
      const got = (await get('no-cache')) ?? (await get('force-cache'));
      let changed = false;
      if (got !== null && got !== text) {
        try {
          const next = JSON.parse(got);
          if (Array.isArray(next.days) && next.days.length) {
            data = next;
            text = got;
            state = 'ready';
            changed = true;
          }
        } catch (_) {}
      }
      if (!data && state !== 'failed') {
        state = 'failed';
        changed = true;
      }
      pending = null;
      if (changed) refresh();
      return changed;
    })();
    return pending;
  }
  const need = () => (state !== 'ready' || Date.now() - lastTry >= AGAIN ? load() : Promise.resolve(false));

  // ---------- 資料整理（測試也用） ----------
  // 日 K：舊的在左，[{ date, open, high, low, close, amount（億）, ma5, ma20, prev（前一天收盤）}]，最多 20 天
  function bars(d = data) {
    if (!d) return [];
    const all = d.days.map(r => ({ date: r[0], open: r[1], high: r[2], low: r[3], close: r[4], amount: r[5] }));
    const avg = (i, n) => (i + n <= all.length ? all.slice(i, i + n).reduce((s, b) => s + b.close, 0) / n : null);
    return all.slice(0, BARS).map((b, i) => ({ ...b, ma5: avg(i, 5), ma20: avg(i, 20), prev: all[i + 1]?.close ?? null })).reverse();
  }
  // 當日走勢：{ date, prev, pts: [{ time: '09:00', value, amount（累積，億）, minute（這一分鐘，億）}] }；沒有時回傳 null
  function minutes(d = data) {
    const it = d?.intraday;
    if (!it || !Array.isArray(it.points) || !it.points.length) return null;
    const pts = it.points.map(([value, cum], i) => {
      const m = 9 * 60 + i;
      return { time: `${U.pad2(Math.floor(m / 60))}:${U.pad2(m % 60)}`, value, amount: cum / 100, minute: (cum - (i ? it.points[i - 1][1] : 0)) / 100 };
    });
    return { date: it.date, prev: it.prev, pts };
  }

  // 三大法人：新的在前 [{ date, foreign, trust, dealer, total }]（億）；舊的資料沒有時是 []
  function chips(d = data) {
    return (Array.isArray(d?.chips) ? d.chips : []).map(r => ({ date: r[0], foreign: r[1], trust: r[2], dealer: r[3], total: r[4] }));
  }
  // 融資融券：新的在前 [{ date, loan: 融資餘額（億）, loanChg, short: 融券餘額（張）, shortChg }]
  // 大盤融資維持率：新的在前 [{ date, ratio（%）}]；舊的資料沒有時是 []
  function ratios(d = data) {
    return (Array.isArray(d?.ratio) ? d.ratio : []).map(r => ({ date: r[0], ratio: r[1] }));
  }
  // ---------- 融資成本推估 ----------
  //   每天的融資淨增減 = 今天的融資餘額 − 前一天的（融資餘額是借的錢，不會跟著股價變），當成那天用收盤的加權指數借進來或還掉
  //   起點是 n 天裡最早那一天（那天的餘額當起點，不知道成本，不算），之後每一天的增減照順序放進去
  //   減少的那幾天看不出是誰還的，4 種假設各算一次：
  //     只看加碼日：只平均增加的那幾天，不管減少
  //     平均成本法：增加的照金額加權平均，減少只減金額、均價不變（減到 0 就從頭算）
  //     後進先出：減少時先扣最近借的（最近追高的先出場）
  //     先進先出：減少時先扣最早借的
  //   維持率 ≈ 166.67%（上市融資 6 成買進當下）× 現在指數 ÷ 平均成本；130% 線 = 平均成本 × 130 ÷ 166.67（≈ 0.78）
  //   回傳 { from, to, start, end, added, reduced, now, rows: [{ key, name, cost, ratio, line }] }；資料不夠是 null
  //   全部還掉了（剩 0）的那一種 cost、ratio、line 是 null
  const COSTS = [['avg', '平均成本法'], ['adds', '只看加碼日'], ['lifo', '後進先出'], ['fifo', '先進先出']];
  function cost(d = data, n = 60) {
    if (!d || !Array.isArray(d.margin) || !Array.isArray(d.days)) return null;
    const close = new Map(d.days.map(r => [r[0], r[4]]));
    const inside = new Set(d.days.slice(0, n).map(r => r[0]));
    const list = d.margin.filter(r => inside.has(r[0]) && close.has(r[0])).map(r => ({ date: r[0], bal: r[1] })).reverse();
    if (list.length < 2) return null;
    let adds = 0;
    let addsValue = 0;
    let reduced = 0;
    let avg = { amt: 0, cost: 0 };
    const lifo = [];
    const fifo = [];
    const take = (lots, amt, fromEnd) => {
      while (amt > 1e-9 && lots.length) {
        const lot = fromEnd ? lots[lots.length - 1] : lots[0];
        const used = Math.min(lot.amt, amt);
        lot.amt -= used;
        amt -= used;
        if (lot.amt <= 1e-9) (fromEnd ? lots.pop() : lots.shift());
      }
    };
    for (let i = 1; i < list.length; i++) {
      const delta = list[i].bal - list[i - 1].bal;
      const p = close.get(list[i].date);
      if (delta > 0) {
        adds += delta;
        addsValue += delta * p;
        avg = { amt: avg.amt + delta, cost: (avg.amt * avg.cost + delta * p) / (avg.amt + delta) };
        lifo.push({ amt: delta, p });
        fifo.push({ amt: delta, p });
      } else if (delta < 0) {
        reduced -= delta;
        avg = { amt: Math.max(0, avg.amt + delta), cost: avg.amt + delta > 0 ? avg.cost : 0 };
        take(lifo, -delta, true);
        take(fifo, -delta, false);
      }
    }
    const lotsCost = lots => {
      const amt = lots.reduce((s, l) => s + l.amt, 0);
      return amt > 1e-9 ? lots.reduce((s, l) => s + l.amt * l.p, 0) / amt : null;
    };
    const now = close.get(list.at(-1).date);
    const costs = { avg: avg.amt > 1e-9 ? avg.cost : null, adds: adds > 0 ? addsValue / adds : null, lifo: lotsCost(lifo), fifo: lotsCost(fifo) };
    return {
      from: list[0].date,
      to: list.at(-1).date,
      start: list[0].bal,
      end: list.at(-1).bal,
      added: adds,
      reduced,
      now,
      rows: COSTS.map(([key, name]) => {
        const c = costs[key];
        return { key, name, cost: c, ratio: c ? 166.67 * now / c : null, line: c ? c * 130 / 166.67 : null };
      }),
    };
  }

  // 個股追繳價：買進價 × 融資成數 × 1.3（上市 6 成 → × 0.78、上櫃 5 成 → × 0.65）；跌幅是追繳價比買進價低多少（%）
  const CALLS = [['上市', 0.6], ['上櫃', 0.5]];
  const callPrices = price => CALLS.map(([market, rate]) => ({ market, rate, price: price * rate * 1.3, drop: (1 - rate * 1.3) * 100 }));
  let callInput = ''; // 打的買進價（重畫時留著；關掉、重新打開大盤就清掉）

  // 維持率 r 時，融資股平均再跌多少（%）會碰到 130%；已經低於 130% 是 0
  const room = r => Math.max(0, (1 - 130 / r) * 100);
  function margin(d = data) {
    return (Array.isArray(d?.margin) ? d.margin : []).map(r => ({ date: r[0], loan: r[1], loanChg: r[2], short: r[3], shortChg: r[4] }));
  }

  // ---------- 畫圖 ----------
  const f = v => U.round(v, 1);
  const pct = (v, size) => `${U.round(v / size * 100, 3)}%`;
  const idx = v => U.fmtNum(U.round(v, 2), 2);
  const yi = v => `${U.fmtNum(U.round(v, 0))} 億`;
  const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${idx(Math.abs(n))}`;
  const toneOf = (a, b) => (typeof b !== 'number' || a === b ? 'flat' : a > b ? 'up' : 'down');
  const md = d => `${U.fmtDate(d).slice(5)} ${U.weekday(d)}`;
  // 漲跌：「−1,873.08 −4.51%」，比前一天高紅、低綠
  const change = (v, prev) => {
    if (typeof prev !== 'number' || !(prev > 0)) return '';
    const c = v - prev;
    return `<span class="${toneOf(v, prev).replace('flat', '')}">${signed(c)} ${signed(c / prev * 100)}%</span>`;
  };
  // 縱軸的範圍：上下各留 6%
  function scale(vals, h) {
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = (hi - lo || hi || 1) * 0.06;
    lo -= pad;
    hi += pad;
    return { lo, hi, y: v => h - (v - lo) / (hi - lo) * h };
  }
  const gridSVG = (grid, y) => grid.map(v => `<line class="kc-grid" x1="0" x2="${W}" y1="${f(y(v))}" y2="${f(y(v))}" vector-effect="non-scaling-stroke"/>`).join('');
  const tickHTML = (grid, y) => grid.map(v => `<span class="kc-tick" style="top:${pct(y(v), H)}">${U.fmtNum(v)}</span>`).join('');
  // 成交金額那一條：每一格一根柱子，最高的頂到這一條的上面（留一行寫金額）
  //   cap：柱子最高算到多少（當日走勢的開盤、收盤那一分鐘特別大，照它們的話其他柱子都看不到，超過的頂到上面）
  function volSVG(list, x, slot, cap = Infinity) {
    const vmax = Math.max(1, ...list.map(v => Math.min(v.amount || 0, cap)));
    const vy = v => H - Math.min(v, vmax) / vmax * (VH - VTOP);
    return `<line class="kc-vbase" x1="0" x2="${W}" y1="${H - VH}" y2="${H - VH}" vector-effect="non-scaling-stroke"/>` +
      list.map((v, i) => (typeof v.amount !== 'number' ? '' :
        `<rect class="kc-vol ${v.tone}" x="${f(x(i) - slot * 0.31)}" y="${f(vy(v.amount))}" width="${f(slot * 0.62)}" height="${f(Math.max(H - vy(v.amount), v.amount ? 1 : 0))}"/>`)).join('');
  }
  // 一張圖的外框：讀數、圖（svg＋格線數字＋點到的那一格）、橫軸
  //   two：讀數兩行（日 K、法人、融資融券）；small：矮一點的圖（法人、融資融券）
  function plotHTML(key, label, svg, ticks, axis, { two = false, small = false } = {}) {
    const c = charts[key];
    const cur = sels[key] != null && sels[key] < c.pts.length ? sels[key] : c.latest;
    return `
      <div class="kc-read${two ? ' tx-two' : ''}" aria-live="polite">${c.pts[cur].html}</div>
      <div class="kc-plot tx-plot${small ? ' small' : ''}" tabindex="0" data-chart="${key}" data-i="${cur}" role="img" aria-label="${U.esc(label)}；左右鍵換${key === 'day' ? '時間' : '日期'}">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${svg}</svg>
        ${ticks}
        <span class="kc-mark">${markHTML(key, cur)}</span>
      </div>
      <div class="kc-axis">${axis}</div>`;
  }

  // 當日走勢：09:00 那一點還沒有成交（是前一天的收盤），不畫、不能點，線從 09:01 開始；橫軸照樣從 09:00 算起
  function dayHTML(m) {
    const n = m.pts.length;
    const live = m.pts.map((p, i) => ({ ...p, i })).slice(1);
    const top = H - VH;
    const { lo, hi, y } = scale([...live.map(p => p.value), m.prev], top);
    const x = i => (i + 0.5) / n * W;
    const slot = W / n;
    const line = live.map((p, k) => `${k ? 'L' : 'M'}${f(x(p.i))} ${f(y(p.value))}`).join('');
    const yp = f(y(m.prev));
    const grid = U.ticks(lo, hi).filter(v => y(v) > top * 0.08);
    charts.day = {
      pts: live.map(p => ({
        x: x(p.i),
        y: y(p.value),
        html: `<span class="kc-date">${p.time}</span><span><b>${idx(p.value)}</b></span>${change(p.value, m.prev)}<span>成交 ${yi(p.amount)}</span>`,
        vol: `這一分鐘 <b>${U.fmtNum(U.round(p.minute, 1), 1)}</b> 億`,
      })),
      latest: live.length - 1,
    };
    const vols = m.pts.map((p, i) => ({ amount: i ? p.minute : null, tone: toneOf(p.value, m.pts[i - 1]?.value) }));
    // 柱子的高度照 09:02 到 13:29 最大的那一分鐘：09:01（開盤）、13:30（收盤集合競價）超過的頂到上面
    const cap = Math.max(...m.pts.slice(2, -1).map(p => p.minute), 0) || Infinity;
    const at = t => m.pts.findIndex(p => p.time === t);
    const axis = [['09:00', 'first'], ['10:00', ''], ['11:00', ''], ['12:00', ''], ['13:30', 'last']]
      .filter(([t]) => at(t) >= 0)
      .map(([t, cls]) => (cls === 'last' ? `<span class="last">${t}</span>` : `<span${cls ? ` class="${cls}"` : ''} style="left:${pct(cls ? 0 : x(at(t)), W)}">${t}</span>`)).join('');
    const svg = `
      <defs>
        <clipPath id="tx-up"><rect x="0" y="0" width="${W}" height="${yp}"/></clipPath>
        <clipPath id="tx-down"><rect x="0" y="${yp}" width="${W}" height="${f(H - yp)}"/></clipPath>
      </defs>
      ${gridSVG(grid, y)}
      <line class="kc-level" x1="0" x2="${W}" y1="${yp}" y2="${yp}" vector-effect="non-scaling-stroke"/>
      ${volSVG(vols, x, slot, cap)}
      <path class="tx-line up" d="${line}" clip-path="url(#tx-up)" vector-effect="non-scaling-stroke"/>
      <path class="tx-line down" d="${line}" clip-path="url(#tx-down)" vector-effect="non-scaling-stroke"/>`;
    return plotHTML('day', `加權指數 ${U.fmtDate(m.date)} 當日走勢，虛線是前一天收盤 ${idx(m.prev)}，下面是每分鐘的成交金額`, svg, tickHTML(grid, y), axis);
  }

  // 日 K 線
  function kHTML(list) {
    const n = list.length;
    const top = H - VH;
    const { lo, hi, y } = scale([...list.flatMap(b => [b.high, b.low]), ...list.flatMap(b => [b.ma5, b.ma20]).filter(v => v !== null)], top);
    const x = i => (i + 0.5) / n * W;
    const slot = W / n;
    const bw = slot * 0.62;
    const grid = U.ticks(lo, hi).filter(v => y(v) > top * 0.08);
    const tone = b => toneOf(b.close, b.open);
    const candles = list.map((b, i) => {
      const t = y(Math.max(b.open, b.close));
      const bh = Math.max(y(Math.min(b.open, b.close)) - t, 2);
      return `<line class="kc-wick ${tone(b)}" x1="${f(x(i))}" x2="${f(x(i))}" y1="${f(y(b.high))}" y2="${f(y(b.low))}" vector-effect="non-scaling-stroke"/>` +
        `<rect class="kc-body ${tone(b)}" x="${f(x(i) - bw / 2)}" y="${f(t)}" width="${f(bw)}" height="${f(bh)}"/>`;
    }).join('');
    const ma = (k, cls) => {
      const d = list.reduce((s, b, i) => (b[k] === null ? s : `${s}${s && list[i - 1]?.[k] != null ? 'L' : 'M'}${f(x(i))} ${f(y(b[k]))}`), '');
      return d ? `<path class="kc-ma ${cls}" d="${d}" vector-effect="non-scaling-stroke"/>` : '';
    };
    charts.k = {
      pts: list.map((b, i) => ({
        x: x(i),
        y: b.ma20 === null ? null : y(b.ma20),
        html: `<span class="kc-date">${U.esc(md(b.date))}</span><span>收 <b class="${toneOf(b.close, b.prev).replace('flat', '')}">${idx(b.close)}</b></span>${change(b.close, b.prev)}` +
          `<i class="tx-br"></i><span>開 ${idx(b.open)}</span><span>高 ${idx(b.high)}</span><span>低 ${idx(b.low)}</span>`,
        vol: typeof b.amount === 'number' ? `成交 <b>${U.fmtNum(U.round(b.amount, 0))}</b> 億` : '成交金額',
      })),
      latest: n - 1,
    };
    const vols = list.map(b => ({ amount: b.amount, tone: tone(b) }));
    const axis = `<span class="first" style="left:${pct(x(0) - slot * 0.31, W)}">${U.esc(U.fmtDate(list[0].date).slice(5))}</span>` +
      `<span class="last">${U.esc(U.fmtDate(list[n - 1].date).slice(5))}</span>`;
    const svg = `${gridSVG(grid, y)}${volSVG(vols, x, slot)}${candles}${ma('ma5', 'm5')}${ma('ma20', 'm20')}`;
    return `<div class="kc-legend"><span><i class="kc-key m5"></i>5 日線</span><span><i class="kc-key"></i>月線</span></div>` +
      plotHTML('k', `加權指數日 K 線，${U.fmtDate(list[0].date)} 到 ${U.fmtDate(list[n - 1].date)}，共 ${n} 天，黃線是 5 日線、藍線是月線，下面是每天的成交金額`, svg, tickHTML(grid, y), axis, { two: true });
  }

  // 第 i 格的直線、點和成交金額那一條左上角的字
  function markHTML(key, i) {
    const p = charts[key].pts[i];
    return `<span class="kc-cross" style="left:${pct(p.x, W)}"></span>` +
      (p.y === null ? '' : `<span class="kc-mdot${key === 'day' ? ' tx-dot' : ''}" style="left:${pct(p.x, W)};top:${pct(p.y, H)}"></span>`) +
      (p.vol ? `<span class="kc-vlabel" style="top:${pct(H - VH, H)}">${p.vol}</span>` : '');
  }
  function select(plot, i) {
    const c = charts[plot.dataset.chart];
    if (!c) return;
    i = Math.max(0, Math.min(c.pts.length - 1, i));
    sels[plot.dataset.chart] = i === c.latest ? null : i;
    if (String(i) === plot.dataset.i) return;
    plot.dataset.i = i;
    plot.querySelector('.kc-mark').innerHTML = markHTML(plot.dataset.chart, i);
    plot.previousElementSibling.innerHTML = c.pts[i].html;
  }

  const DAY_NOTE = '<p>最近一個交易日 9:00 到 13:30，每分鐘一點。比前一天收盤（虛線）高的那段是紅色、低的是綠色。</p>' +
    '<p>下面是每一分鐘的成交金額，讀數的「成交」是到那一分鐘為止的累計。這是 13:30 以前的整股成交，比日 K 線的成交金額少一點（沒有盤後定價、零股、鉅額交易）。</p>' +
    '<p>每個工作天收盤後更新，盤中不會跟著跳。</p>';
  const K_NOTE = '<p>最近 20 個交易日的加權指數，紅色是收盤比開盤高、綠色是比較低；黃線是 5 日線、藍線是月線（20 日均線）。</p>' +
    '<p>下面是每天的成交金額（全天，含盤後定價、零股、鉅額交易），和券商 App 的大盤成交值一樣。</p>' +
    '<p>資料來源是證交所，每個工作天收盤後更新。</p>';
  const CHIPS_NOTE = '<p>上市的三大法人每天的買賣超（買進減賣出），單位是億元；紅色是買超、綠色是賣超。</p>' +
    '<p>上面切換看合計、外資、投信或自營商；點到哪一天，上面寫那天的四個數字。外資含外資自營商，自營商含自行買賣和避險，和券商 App 一樣。</p>' +
    '<p>橫軸和日 K 線是同樣的 20 天，可以上下對照。證交所每個工作天收盤後公布。</p>';
  const MARGIN_NOTE = '<p>上市的融資、融券：線是餘額（融資是億元、融券是張），下面是每天比前一個交易日增減多少，增加紅、減少綠。</p>' +
    '<p>融資是借錢買股票，融券是借股票來賣。點到哪一天，上面寫那天融資、融券的餘額和增減。</p>' +
    '<p>證交所公布得比較晚，當天的可能要晚上或隔天才有。</p>' +
    '<p><b>維持率</b>是大盤融資維持率（民間算法，和 CMoney、財經M平方一樣）：每一檔融資股的融資餘額 × 收盤價加起來，除以融資金額。上市融資買進當下約 166%，低於 130% 券商會追繳；民間算法到 140% 附近，通常被當成警戒區。</p>' +
    '<p>「再跌」是融資股平均再跌多少會碰到 130%；「約加權」假設融資股和大盤跌得一樣多，實際上融資股（中小型股、題材股、槓桿 ETF）通常跌得比較兇。證交所的整戶維持率（融資、融券合併計算）沒有公開，數字通常比這個高。只算上市。</p>';
  const COST_NOTE = '<p>用最近 60 個交易日上市的融資餘額，推估這段期間新增融資的平均成本：每天融資增加多少，就當成那天用加權指數的收盤借進來。</p>' +
    '<p>融資減少的日子看不出是誰還的，所以用 4 種假設各算一次：平均成本法（減少不改變均價）、只看加碼日（不管減少）、後進先出（最近追高的先出場）、先進先出（最早進場的先出場）。</p>' +
    '<p>維持率 ≈ 166.67%（上市融資買進當下）× 現在加權 ÷ 平均成本；130% 線是平均成本 × 0.78，加權跌到這裡，這批融資平均會碰到追繳。</p>' +
    '<p>這段期間融資減少的比增加的多（淨減）時，平均成本法、後進先出、先進先出會把新增的都扣光，寫「這段期間新增的都還掉了」，只剩只看加碼日有數字。</p>' +
    '<p>只是推估：用加權指數代替融資股的成本，融資股通常跌得比大盤兇；用收盤代表當天的買進價；融資餘額是淨額，同一天有人斷頭也有人加碼；只算上市。實際的維持率看上面「融資融券」的維持率。</p>';
  const CALL_NOTE = '<p>融資買進後，股價跌到「追繳價」維持率就是 130%，券商會在收盤後通知，2 個營業日內要補繳，不然 T+3 處分（斷頭）。</p>' +
    '<p>上市融資 6 成：追繳價 = 買進價 × 0.78（跌約 22%）；上櫃融資 5 成：追繳價 = 買進價 × 0.65（跌約 35%）。也可以用 融資金額 × 1.3 ÷ 股數 算。</p>' +
    '<p>券商實際是看整戶擔保維持率（融資、融券合併，不同股票的盈虧可以互抵），這裡只算單一檔。打的價格不會存起來。</p>';
  const head = (title, note) => `<h3 class="section-head"><span class="sec-name">${title}</span>${Note.btn(title, note)}</h3>`;
  // 切換：合計｜外資｜投信｜自營商、融資｜融券
  const segHTML = (list, label) => `<div class="seg tx-seg n${KINDS[list].length}" role="group" aria-label="${label}">` +
    KINDS[list].map(([k, t]) => `<button type="button" data-act="kind" data-list="${list}" data-value="${k}" aria-pressed="${kinds[list] === k}">${t}</button>`).join('') + '</div>';
  const toneCls = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const tone = v => (toneCls(v) ? ` ${toneCls(v)}` : '');
  const int = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${U.fmtNum(Math.abs(n))}`;
  // 讀數裡的一個數字：切到的那個粗體
  const readNum = (on, text, v) => (on ? `<b class="${toneCls(v)}">${text}</b>` : `<span class="${toneCls(v)}">${text}</span>`);
  // 最新一個交易日的還沒公布：圖上面寫一行（融資融券常常比較晚）
  const lateNote = rows => (rows.length && rows[0].date < data.date ? `<p class="trend-note">${U.esc(md(data.date))} 的還沒公布，公布後會補上</p>` : '');
  // 法人、融資融券的橫軸：和日 K 線同樣的 20 天（list 是 bars()，舊的在左），x 也一樣
  const axisOf = (list, x, slot) => `<span class="first" style="left:${pct(x(0) - slot * 0.31, W)}">${U.esc(U.fmtDate(list[0].date).slice(5))}</span>` +
    `<span class="last">${U.esc(U.fmtDate(list.at(-1).date).slice(5))}</span>`;
  const zeroSVG = y0 => `<line class="tx-zero" x1="0" x2="${W}" y1="${f(y0)}" y2="${f(y0)}" vector-effect="non-scaling-stroke"/>`;
  // 從 y0（零）到 y1 的柱子
  const barSVG = (cx, w, y0, y1, cls) => `<rect class="tx-bar${cls}" x="${f(cx - w / 2)}" y="${f(Math.min(y0, y1))}" width="${f(w)}" height="${f(Math.max(Math.abs(y1 - y0), 1))}"/>`;

  // 三大法人：每天一根柱子（切到的那一個），零在中間；點到哪一天讀數寫四個數字
  function chipsHTML(list) {
    const rows = chips();
    const title = head('三大法人買賣超（億）', CHIPS_NOTE);
    if (!rows.length || !list.length) return `${title}<p class="trend-note">還沒有三大法人的資料</p>`;
    const by = new Map(rows.map(r => [r.date, r]));
    const k = kinds.chips;
    const n = list.length;
    const x = i => (i + 0.5) / n * W;
    const slot = W / n;
    const vals = list.map(b => by.get(b.date)?.[k] ?? null);
    const nums = vals.filter(v => v !== null);
    let lo = Math.min(0, ...nums);
    let hi = Math.max(0, ...nums);
    const pad = (hi - lo || 1) * 0.08;
    lo -= pad;
    hi += pad;
    const y = v => H - (v - lo) / (hi - lo) * H;
    const grid = U.ticks(lo, hi).filter(v => v !== 0 && y(v) > H * 0.08);
    const read = (b, r) => (!r ? `<span class="kc-date">${U.esc(md(b.date))}</span><span>還沒公布</span>` :
      `<span class="kc-date">${U.esc(md(b.date))}</span><span>合計 ${readNum(k === 'total', signed(r.total), r.total)}</span><i class="tx-br"></i>` +
      KINDS.chips.slice(1).map(([key, t]) => `<span>${t} ${readNum(k === key, signed(r[key]), r[key])}</span>`).join(''));
    charts.chips = { pts: list.map((b, i) => ({ x: x(i), y: null, html: read(b, by.get(b.date)), vol: null })), latest: n - 1 };
    const svg = `${gridSVG(grid, y)}${zeroSVG(y(0))}${vals.map((v, i) => (v === null ? '' : barSVG(x(i), slot * 0.62, y(0), y(v), tone(v)))).join('')}`;
    const name = KINDS.chips.find(([key]) => key === k)[1];
    return `${title}${segHTML('chips', '三大法人')}${lateNote(rows)}` +
      plotHTML('chips', `三大法人${name}買賣超，${U.fmtDate(list[0].date)} 到 ${U.fmtDate(list.at(-1).date)}，紅色買超、綠色賣超`, svg, tickHTML(grid, y), axisOf(list, x, slot), { two: true, small: true });
  }

  // 融資融券：線是餘額，下面一條是每天的增減（零在那一條的中間）
  // 維持率：一條線，130%、140%、166% 畫虛線；縱軸一定看得到 130% 和 166%，離追繳多遠一眼看得出來
  function ratioHTML(list, title) {
    const rows = ratios();
    const top = `${title}${segHTML('margin', '融資融券')}`;
    if (!rows.length || !list.length) return `${top}<p class="trend-note">還沒有維持率的資料</p>`;
    const by = new Map(rows.map(r => [r.date, r.ratio]));
    const close = new Map(list.map(b => [b.date, b.close]));
    const n = list.length;
    const x = i => (i + 0.5) / n * W;
    const slot = W / n;
    const vals = list.map(b => by.get(b.date) ?? null);
    const nums = vals.filter(v => v !== null);
    let lo = Math.min(125, ...nums);
    let hi = Math.max(170, ...nums);
    const pad = (hi - lo) * 0.06;
    lo -= pad;
    hi += pad;
    const y = v => H - (v - lo) / (hi - lo) * H;
    const line = vals.reduce((d, v, i) => (v === null ? d : `${d}${d && vals[i - 1] !== null ? 'L' : 'M'}${f(x(i))} ${f(y(v))}`), '');
    const LEVELS = [[130, '130% 追繳', ' warn'], [140, '140% 警戒', ''], [166.67, '166% 買進', '']];
    const levels = LEVELS.map(([v, , cls]) => `<line class="tx-level${cls}" x1="0" x2="${W}" y1="${f(y(v))}" y2="${f(y(v))}" vector-effect="non-scaling-stroke"/>`).join('');
    const labels = LEVELS.map(([v, t]) => `<span class="kc-tick" style="top:${pct(y(v), H)}">${t}</span>`).join('');
    const read = (b, i) => {
      const r = vals[i];
      if (r === null) return `<span class="kc-date">${U.esc(md(b.date))}</span><span>還沒公布</span>`;
      const prev = vals.slice(0, i).reverse().find(v => v !== null);
      const chg = typeof prev === 'number' ? ` <span class="${toneCls(r - prev)}">${signed(r - prev)}</span>` : '';
      const left = room(r);
      return `<span class="kc-date">${U.esc(md(b.date))}</span><span>維持率 <b>${U.fmtNum(U.round(r, 1), 1)}%</b>${chg}</span><i class="tx-br"></i>` +
        (left > 0 ? `<span>再跌 <b>${U.fmtNum(U.round(left, 1), 1)}%</b> 碰 130%</span><span>約加權 ${U.fmtNum(Math.round(close.get(b.date) * 130 / r))}</span>`
          : '<span><b class="down">已經低於 130%</b></span>');
    };
    charts.margin = { pts: list.map((b, i) => ({ x: x(i), y: vals[i] === null ? null : y(vals[i]), html: read(b, i), vol: null })), latest: n - 1 };
    const svg = `${levels}<path class="tx-bal" d="${line}" vector-effect="non-scaling-stroke"/>`;
    return `${top}${lateNote(rows)}` +
      plotHTML('margin', `大盤融資維持率，${U.fmtDate(list[0].date)} 到 ${U.fmtDate(list.at(-1).date)}，虛線是 130%、140%、166%`, svg, labels, axisOf(list, x, slot), { two: true, small: true });
  }

  // 融資成本推估：上面一行寫期間和加碼、減少多少，下面一張表 4 種假設
  function costHTML() {
    const c = cost();
    const title = head('融資成本推估', COST_NOTE);
    if (!c) return `${title}<p class="trend-note">融資餘額的資料還不夠</p>`;
    const n0 = v => (v === null ? '—' : U.fmtNum(Math.round(v)));
    const yi1 = v => U.fmtNum(U.round(v, 1), 1);
    const net = c.end - c.start;
    return `${title}
      <p class="tx-sub">${U.esc(U.fmtDate(c.from).slice(5))}～${U.esc(U.fmtDate(c.to).slice(5))} 融資加碼 ${yi1(c.added)} 億、減少 ${yi1(c.reduced)} 億，淨${net >= 0 ? '增' : '減'} ${yi1(Math.abs(net))} 億；加權 ${idx(c.now)}</p>
      <table class="ev-table tx-table">
        <thead><tr><th>假設</th><th class="num">平均成本</th><th class="num">維持率</th><th class="num">130% 線</th></tr></thead>
        <tbody>${c.rows.map(r => `<tr><td>${r.name}</td>${r.cost === null ? '<td colspan="3" class="num tx-empty">這段期間新增的都還掉了</td>'
          : `<td class="num">${n0(r.cost)}</td><td class="num">${U.fmtNum(Math.round(r.ratio))}%</td><td class="num">${n0(r.line)}</td>`}</tr>`).join('')}</tbody>
      </table>`;
  }

  // 個股追繳價試算：打買進價，下面一張表 上市｜上櫃 的追繳價和跌幅
  function callRows() {
    const price = U.parseNum(callInput);
    if (!(price > 0)) return '<tr><td colspan="3" class="tx-empty">打買進價，算出碰到 130% 的價格</td></tr>';
    return callPrices(price).map(r => `<tr><td>${r.market}（融資 ${r.rate * 10} 成）</td><td class="num total">${U.fmtNum(U.round(r.price, 2), 2)}</td><td class="num">跌 ${U.fmtNum(Math.round(r.drop))}%</td></tr>`).join('');
  }
  function callHTML() {
    return `${head('個股追繳價試算', CALL_NOTE)}
      <label class="ma-price tx-call"><span>融資買進價</span><input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done" value="${U.esc(callInput)}" data-act="call-price" aria-label="融資買進價"></label>
      <table class="ev-table tx-table">
        <thead><tr><th>市場</th><th class="num">追繳價</th><th class="num">跌幅</th></tr></thead>
        <tbody class="tx-call-out">${callRows()}</tbody>
      </table>`;
  }

  function marginHTML(list) {
    const title = head('融資融券', MARGIN_NOTE);
    if (kinds.margin === 'ratio') return ratioHTML(list, title);
    const rows = margin();
    if (!rows.length || !list.length) return `${title}<p class="trend-note">還沒有融資融券的資料</p>`;
    const by = new Map(rows.map(r => [r.date, r]));
    const loan = kinds.margin === 'loan';
    const [vk, ck] = loan ? ['loan', 'loanChg'] : ['short', 'shortChg'];
    const fmtC = v => (loan ? signed(v) : int(v));
    const unit = loan ? '億' : '張';
    const n = list.length;
    const x = i => (i + 0.5) / n * W;
    const slot = W / n;
    const top = H - VH;
    const vals = list.map(b => by.get(b.date)?.[vk] ?? null);
    const chgs = list.map(b => by.get(b.date)?.[ck] ?? null);
    const { lo, hi, y } = scale(vals.filter(v => v !== null), top);
    const grid = U.ticks(lo, hi).filter(v => y(v) > top * 0.08);
    const line = vals.reduce((d, v, i) => (v === null ? d : `${d}${d && vals[i - 1] !== null ? 'L' : 'M'}${f(x(i))} ${f(y(v))}`), '');
    const amax = Math.max(1, ...chgs.filter(v => v !== null).map(Math.abs));
    const mid = H - (VH - VTOP) / 2;
    const cy = v => mid - v / amax * (VH - VTOP) / 2;
    const read = (b, r) => (!r ? `<span class="kc-date">${U.esc(md(b.date))}</span><span>還沒公布</span>` :
      `<span class="kc-date">${U.esc(md(b.date))}</span><span>融資 ${readNum(loan, idx(r.loan), 0)} 億 <span class="${toneCls(r.loanChg)}">${signed(r.loanChg)}</span></span><i class="tx-br"></i>` +
      `<span>融券 ${readNum(!loan, U.fmtNum(r.short), 0)} 張 <span class="${toneCls(r.shortChg)}">${int(r.shortChg)}</span></span>`);
    charts.margin = {
      pts: list.map((b, i) => ({
        x: x(i),
        y: vals[i] === null ? null : y(vals[i]),
        html: read(b, by.get(b.date)),
        vol: chgs[i] === null ? '增減' : `增減 <b>${fmtC(chgs[i])}</b> ${unit}`,
      })),
      latest: n - 1,
    };
    const svg = `${gridSVG(grid, y)}
      <line class="kc-vbase" x1="0" x2="${W}" y1="${top}" y2="${top}" vector-effect="non-scaling-stroke"/>
      ${zeroSVG(mid)}
      ${chgs.map((v, i) => (v === null ? '' : barSVG(x(i), slot * 0.62, mid, cy(v), tone(v)))).join('')}
      <path class="tx-bal" d="${line}" vector-effect="non-scaling-stroke"/>`;
    const ticks = tickHTML(grid, y);
    return `${title}${segHTML('margin', '融資融券')}${lateNote(rows)}` +
      plotHTML('margin', `${loan ? '融資' : '融券'}餘額（${unit}），${U.fmtDate(list[0].date)} 到 ${U.fmtDate(list.at(-1).date)}，下面是每天的增減`, svg, ticks, axisOf(list, x, slot), { two: true, small: true });
  }

  function render() {
    if (!dlg?.open) return;
    const body = dlg.querySelector('.sheet-body');
    if (state !== 'ready') {
      body.innerHTML = `<p class="sheet-status">${state === 'failed' ? '下載不了大盤資料（連上網路後會再試）' : '大盤資料下載中…'}</p>`;
      return;
    }
    const m = minutes();
    const list = bars();
    body.innerHTML = `
      ${head(m ? `當日走勢 ${U.esc(md(m.date))}` : '當日走勢', DAY_NOTE)}
      ${m ? dayHTML(m) : `<p class="trend-note">${U.esc(md(data.date))} 的走勢還沒出來，晚上會更新</p>`}
      ${head(`日 K 線（${list.length} 天）`, K_NOTE)}
      ${kHTML(list)}
      ${chipsHTML(list)}
      ${marginHTML(list)}
      ${costHTML()}
      ${callHTML()}`;
  }

  function init() {
    if (!dlg) return; // 瀏覽器還拿著舊版 index.html（沒有這個 sheet）
    const body = dlg.querySelector('.sheet-body');
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // 點背景關閉
    // 手指、滑鼠移到的地方換成最近的那一格；滑鼠離開時回到最新的（手指放開後停在那裡）
    const nearest = (plot, clientX) => {
      const r = plot.getBoundingClientRect();
      const at = (clientX - r.left) / r.width * W;
      const { pts } = charts[plot.dataset.chart];
      return pts.reduce((best, p, i) => (Math.abs(p.x - at) < Math.abs(pts[best].x - at) ? i : best), 0);
    };
    const follow = e => {
      const plot = e.target.closest('.tx-plot');
      if (plot && charts[plot.dataset.chart]) select(plot, nearest(plot, e.clientX));
    };
    // 切換合計｜外資｜投信｜自營商、融資｜融券：點到的那一天留著；焦點放回新的按鈕
    body.addEventListener('click', e => {
      const btn = e.target.closest('[data-act="kind"]');
      if (!btn) return;
      kinds[btn.dataset.list] = btn.dataset.value;
      render();
      body.querySelector(`[data-act="kind"][data-list="${btn.dataset.list}"][data-value="${btn.dataset.value}"]`)?.focus({ preventScroll: true });
    });
    // 個股追繳價試算：打字時只換下面那張表，不重畫整個大盤（輸入框才不會跳掉）
    body.addEventListener('input', e => {
      if (!e.target.matches('[data-act="call-price"]')) return;
      callInput = e.target.value;
      const out = body.querySelector('.tx-call-out');
      if (out) out.innerHTML = callRows();
    });
    body.addEventListener('pointermove', follow);
    body.addEventListener('pointerdown', follow);
    body.addEventListener('pointerout', e => {
      const plot = e.target.closest('.tx-plot');
      if (plot && !plot.contains(e.relatedTarget) && e.pointerType === 'mouse') select(plot, charts[plot.dataset.chart].latest);
    });
    body.addEventListener('keydown', e => {
      const plot = e.target.closest('.tx-plot');
      if (!plot || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      select(plot, Number(plot.dataset.i) + (e.key === 'ArrowLeft' ? -1 : 1));
    });
  }

  function open() {
    if (!dlg) return;
    kinds.chips = 'total';
    kinds.margin = 'loan';
    callInput = '';
    Object.keys(sels).forEach(k => { sels[k] = null; });
    need();
    if (!dlg.open) dlg.showModal();
    render();
  }

  // 下載到新的資料：開著的話重畫
  function refresh() {
    render();
  }

  return { init, open, load, need, refresh, bars, minutes, chips, margin, ratios, room, cost, callPrices };
})();
