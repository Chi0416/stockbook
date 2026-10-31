// K 線資料（shared/candles.json，由 tools/update-prices.mjs 產生）：選股的 K 線頁、詳細頁的小圖和大圖用（見 ma.js、kline.js、detail.js）
//   每一檔最近 20 天的開高低收、成交量（張），再往前 19 天的收盤價（最早那幾根 K 棒的月線要用）
//   檔案比較大，用到時才下載（need：打開 K 線頁、詳細頁），總覽、其他選股頁不用等它；之後用瀏覽器存的，隔 30 分鐘才再檢查有沒有新的
//   和收盤價一樣，GitHub 每個工作天收盤後更新，不用改版本號；沒有網路時用存的上一份
//   下載好、或下載到不一樣的資料時通知 onChange（app.js 重畫 K 線頁、詳細頁的 K 線那一段）
const Candles = (() => {
  const FILE = 'shared/candles.json';
  const AGAIN = 30 * 60000;
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();

  // 測試時直接放一份全域的 CANDLE_LIST，不用下載
  let data = typeof CANDLE_LIST !== 'undefined' ? CANDLE_LIST : null;
  let state = data ? 'ready' : 'idle';
  let text = '';      // 上次下載到的內容，一樣的就不通知
  let lastTry = 0;
  let pending = null; // 下載中（同時只下載一次）
  const listeners = [];

  // 下載：有新的資料、或第一次就下載失敗時通知 onChange；下載失敗、格式不對時留著原本的資料
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
          if (Array.isArray(next.days) && next.rows && typeof next.rows === 'object') {
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
      if (changed) listeners.forEach(fn => fn());
      return changed;
    })();
    return pending;
  }

  // 用到時：還沒下載、上次失敗的馬上下載，下載過的隔 30 分鐘才再檢查
  const need = () => (state !== 'ready' || Date.now() - lastTry >= AGAIN ? load() : Promise.resolve(false));

  // 這一檔有成交的日子：[{ date, open, high, low, close, vol }]，新的在前；只有收盤價的（K 線前面那 19 天）open、high、low、vol 是 null
  //   vol 是成交量（張）；還沒有成交量的舊資料也是 null
  //   還沒下載好時回傳 null；資料裡沒有這一檔是 []
  function get(code) {
    if (!data) return null;
    const row = data.rows[key(code)] || [];
    return row.map((v, i) => {
      const date = data.days[i];
      if (v === null || !date) return null;
      return Array.isArray(v)
        ? { date, open: v[0], high: v[1], low: v[2], close: v[3], vol: typeof v[4] === 'number' ? v[4] : null }
        : { date, open: null, high: null, low: null, close: v, vol: null };
    }).filter(x => x && typeof x.close === 'number');
  }

  // 還沒下載好、下載不了時的說明（下載好了是 ''）
  const waiting = () => (state === 'ready' ? '' : state === 'failed' ? '下載不了 K 線資料（連上網路後會再試）' : 'K 線資料下載中…');

  return { need, load, get, waiting, ready: () => state === 'ready', date: () => (data ? data.date : ''), onChange: fn => listeners.push(fn) };
})();
