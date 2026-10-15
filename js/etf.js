// ETF 成分股（shared/etf.json）：行情每一頁上面的「成分股」用（見 market.js），選一檔 ETF，列表換成它的成分股
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

  // 下載：下載好、或第一次就下載失敗時通知 onChange；下載失敗時下次切過來再試
  function load() {
    if (pending) return pending;
    state = 'loading';
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
      if (got?.etfs && typeof got.etfs === 'object') {
        data = got;
        state = 'ready';
      } else {
        state = 'failed';
      }
      pending = null;
      listeners.forEach(fn => fn());
    })();
    return pending;
  }

  const need = () => (state === 'ready' ? Promise.resolve() : load());

  // 可以選的 ETF，照代號：[{ code, name, source, date, url, holdings: [[代號, 權重], ...] }]
  const list = () => (data ? Object.entries(data.etfs).map(([code, e]) => ({ code, ...e })).sort((a, b) => (a.code < b.code ? -1 : 1)) : []);

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

  return { need, list, current, select, waiting, ready: () => state === 'ready', onChange: fn => listeners.push(fn) };
})();
