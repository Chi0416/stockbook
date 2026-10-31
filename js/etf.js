// ETF 成分股（shared/etf.json）：選股每一頁上面的「成分股」用（見 market.js），選一檔 ETF，列表換成它的成分股
//   反過來，選股的「ETF」頁（ETF_PAGE，在下面）看一檔股票被哪幾檔 ETF 持有
//   資料是從各投信網站的持股權重、申購買回清單抄下來的，不是每天自動更新：ETF 調整成分股時（一年幾次）再手動更新
//     所以畫面上一定寫哪家投信、哪一天公布的，免得以為是今天的
//   檔案很小，第一次切到「成分股」才下載，之後這次打開 App 都用同一份；沒有網路時用瀏覽器存的上一份
//   上次選的是哪一檔記在這台裝置
const Etf = (() => {
  const FILE = 'shared/etf.json';
  const KEY = 'stockbook.etf';
  const listeners = [];
  // 測試時直接放一份全域的 ETF_LIST，不用下載
  let data = typeof ETF_LIST !== 'undefined' ? ETF_LIST : null;
  let state = data ? 'ready' : 'idle';
  let pending = null;
  let pick = '';
  try { pick = localStorage.getItem(KEY) || ''; } catch (_) {}

  // 下載：下載好、或第一次下載失敗時通知 onChange；下載失敗時下次切過來、連上網路時再試
  //   再試又失敗不再通知：通知會重畫成分股那一頁，重畫時又會叫 need，會一直重試停不下來
  //   again：正在下載時等這次下載完再下載一次（sw.js 通知有新的那時候，正在讀的可能是舊的那份，見 app.js）
  function load(again = false) {
    if (pending) return again ? pending.then(() => load()) : pending;
    if (state === 'idle') state = 'loading';
    const get = async mode => {
      try {
        const res = await fetch(FILE, { cache: mode });
        return res.ok ? await res.json() : null;
      } catch (_) {
        return null;
      }
    };
    pending = (async () => {
      const got = (await get('no-cache')) ?? (await get('force-cache'));
      const was = state;
      if (got?.etfs && typeof got.etfs === 'object') {
        data = got;
        state = 'ready';
      } else {
        state = 'failed';
      }
      pending = null;
      if (state === 'ready' || was !== 'failed') listeners.forEach(fn => fn());
    })();
    return pending;
  }

  const need = () => (state === 'ready' ? Promise.resolve() : load());

  // 可以選的 ETF，照代號：[{ code, name, source, date, url, holdings: [[代號, 權重], ...] }]
  const list = () => (data ? Object.entries(data.etfs).map(([code, e]) => ({ code, ...e })).sort((a, b) => (a.code < b.code ? -1 : 1)) : []);

  // 一檔股票被哪幾檔 ETF 持有：[{ code: ETF 代號, name, weight: 佔那檔 ETF 的權重 }]，權重大的在前；資料換了才重算
  let index = null;
  let indexOf = null;
  function holders(code) {
    if (!data) return [];
    if (indexOf !== data) {
      index = new Map();
      list().forEach(e => e.holdings.forEach(([c, weight]) => {
        if (!index.has(c)) index.set(c, []);
        index.get(c).push({ code: e.code, name: e.name, weight });
      }));
      index.forEach(arr => arr.sort((a, b) => b.weight - a.weight));
      indexOf = data;
    }
    return index.get(U.toHalf(code ?? '').trim().toUpperCase()) || [];
  }

  // 目前選的那一檔；記住的那一檔不在資料裡了（拿掉了）用第一檔；還沒下載好是 null
  function current() {
    const all = list();
    return all.find(e => e.code === pick) || all[0] || null;
  }

  function select(code) {
    pick = code;
    try { localStorage.setItem(KEY, code); } catch (_) {}
  }

  // 還沒下載好、下載不了時的說明
  const waiting = () => (state === 'failed' ? '下載不了成分股資料（連上網路後會再試）' : '成分股資料下載中…');

  return { need, load, list, holders, current, select, waiting, ready: () => state === 'ready', failed: () => state === 'failed', onChange: fn => listeners.push(fn) };
})();

// ETF 持有：行情的一頁（列表、「持有｜觀察｜全市場｜成分股」、搜尋見 market.js），每一檔股票被幾檔 ETF 持有
//   只算 shared/etf.json 裡有的 ETF（從投信網站抄的，見上面），所以「幾檔」最多就是收了幾檔；說明裡寫收了哪幾檔、哪一天公布的
//   排序：ETF 多的在前（預設，一樣多的照權重加總）、權重加總高的在前、依代號
//     權重加總：這一檔佔每一檔持有它的 ETF 的權重加起來，越高代表 ETF 買得越多
//   全市場只列至少一檔 ETF 持有的；持有、觀察照樣列出來（沒有 ETF 持有的是 0 檔，排最後）
//   表格的「哪幾檔」只列權重最大的 3 檔，全部的在詳細頁（detail.js 的 etfHTML）
//   ETF 資料打開這一頁才下載（app.js 切到這一頁時叫 Etf.need），下載好之後整頁重畫
const ETF_PAGE = (() => {
  const md = d => (d.startsWith(U.today().slice(0, 4)) ? U.fmtDate(d).slice(5) : U.fmtDate(d));
  const pct = v => `${U.fmtNum(U.round(v, 2), 2)}%`;
  const ready = () => Etf.ready();

  function enrich(r) {
    const by = Etf.holders(r.code);
    return { ...r, by, n: ready() ? by.length : null, wsum: by.reduce((s, x) => s + x.weight, 0) };
  }

  // 哪幾檔：ETF 代號，權重大的在前，一個一個小框；表格只列前 3 檔，其他的寫「+9」（全部的看詳細頁、詳細卡片）
  const MAX = 3;
  const tagsHTML = by => `<span class="etf-by">${by.slice(0, MAX).map(x => `<span>${U.esc(x.code)}</span>`).join('')}` +
    `${by.length > MAX ? `<span class="more">+${by.length - MAX}</span>` : ''}</span>`;

  // 表格：幾檔（下面是權重加總）｜哪幾檔
  const table = {
    cols: [{ label: ['ETF', '權重加總'], sort: 'count' }, { label: ['哪幾檔'] }],
    cells(r) {
      if (r.n === null) return [Table.cell('—'), Table.cell('—')];
      return [
        Table.cell(`${r.n} 檔`, r.n ? pct(r.wsum) : '—', r.n ? 'strong' : ''),
        `<span class="tcell etf-by-cell">${r.n ? tagsHTML(r.by) : '<small>沒有</small>'}</span>`,
      ];
    },
  };

  function cardHTML(r) {
    const cell = (label, v) => `<span class="cell"><small>${label}</small><span>${v}</span></span>`;
    const tag = holdTagsHTML(r);
    return `
      <div class="card etf-card" data-code="${U.esc(r.code)}">
        <span class="card-top">
          <span class="card-title">${tag ? `<span class="card-tags">${tag}</span>` : ''}<span class="card-code">${U.esc(r.code)}</span>${U.esc(r.name)}</span>
          <span class="card-primary"><small>ETF 持有</small><b>${r.n === null ? '—' : `${r.n} 檔`}</b></span>
        </span>
        ${r.n ? `<span class="card-grid">${r.by.map(x => cell(`${U.esc(x.code)} ${U.esc(x.name)}`, pct(x.weight))).join('')}</span>
        <span class="card-note">權重加總 ${pct(r.wsum)}</span>` : `<span class="card-note">${r.n === null ? U.esc(Etf.waiting()) : '收的 ETF 都沒有持有這一檔'}</span>`}
      </div>`;
  }

  // 列表上面的說明（見 market.js 的 intro）：一行寫收了幾檔、哪一天公布的（不是每天更新，免得誤會），小視窗寫怎麼算、收了哪幾檔
  function intro() {
    if (!ready()) return { title: 'ETF 持有怎麼看', line: U.esc(Etf.waiting()), body: `<p>${U.esc(Etf.waiting())}</p>` };
    const all = Etf.list();
    const dates = [...new Set(all.map(e => e.date))].sort();
    const when = dates.length === 1 ? `${md(dates[0])} 公布` : `最舊的 ${md(dates[0])} 公布`;
    const each = dates.length === 1 ? `都是 ${U.fmtDate(dates[0])} 公布的` : all.map(e => `${e.code} ${md(e.date)}`).join('、');
    return {
      title: 'ETF 持有怎麼看',
      line: U.esc(`收 ${all.length} 檔 ETF・${when}`),
      body: '<p>被幾檔 ETF 持有，越多排越前面；權重加總是這一檔在每一檔持有它的 ETF 裡佔的權重加起來，越高代表 ETF 買得越多</p>' +
        `<p>只算收了的 ${all.length} 檔：${U.esc(all.map(e => `${e.code} ${e.name}`).join('、'))}</p>` +
        `<p class="muted">成分股從投信網站抄的，${U.esc(each)}，ETF 調整成分股時才更新</p>`,
    };
  }

  // 全市場只列至少一檔 ETF 持有的
  const keep = r => MARKET_VIEW.range !== 'market' || !ready() || r.n > 0;
  const skippedHTML = () => '收的 ETF 都沒有持有符合的股票';

  const byCount = (a, b) => (b.n ?? -1) - (a.n ?? -1) || b.wsum - a.wsum;
  return {
    title: 'ETF 持有',
    table,
    sorts: [['count', 'ETF 多的在前', byCount], ['weight', '權重加總高的在前', (a, b) => b.wsum - a.wsum], ['code', '依代號', null]],
    enrich, cardHTML, intro, keep, skippedHTML,
  };
})();
