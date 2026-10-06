// 隱藏金額：像網路銀行的「隱藏餘額」，自己的數字（金額、股數、單價、成本、佔比）一律顯示成 ＊＊＊
//   照常顯示的只有公開資訊：除權息日、發放日、每股股利（schema 裡標了 public 的欄位），以及代號、名稱、日期、筆數
//   開關：總覽「總投資成本」卡片右上角的眼睛、設定選單裡的「隱藏金額」；只記在這台裝置，下次打開維持上次的狀態
//   編輯表單照常顯示（要改數字就要看得到）；試算表不受影響
//   不管原本幾位數都顯示成一樣長的 ＊＊＊，才看不出是幾萬還是幾百萬
const Privacy = (() => {
  const KEY = 'stockbook.hideAmounts';
  const MASK = '＊＊＊';
  const listeners = [];
  let hidden = false;
  try { hidden = localStorage.getItem(KEY) === '1'; } catch (_) {}

  // 自己的數字（已經格式化好的文字）：隱藏時換成 ＊＊＊；空白照常（還沒有值時顯示的「—」由呼叫的地方處理）
  const num = s => (hidden && s !== '' && s != null ? MASK : s);

  // 一段說明文字裡的數字換成 ＊＊＊（夾著股數的算式、核對結果，例如「0056 元大高股息：推算 42,000 股（2026/08/31 快照 41,000 + 買進 1,000）」）
  //   只換前面是空白、後面是空白或標點的數字（算式裡的股數都是這樣寫的），名稱裡的數字（元大台灣50）和日期（2026/08/31）不會被換到
  //   另外不換：單獨的 0（「從 0 開始」）、股票代號（股數一千以上一定有千分位逗號，四碼以上又沒有逗號的是代號：0056、00679B）
  const NUMBER = /(?<=^|\s)-?\d+(?:,\d{3})*(?:\.\d+)?(?=$|\s|[）),，、])/g;
  const keep = m => m === '0' || /^\d{4,}$/.test(m);
  const text = s => (hidden ? String(s ?? '').replace(NUMBER, m => (keep(m) ? m : MASK)) : s);

  function set(v) {
    hidden = !!v;
    try { localStorage.setItem(KEY, hidden ? '1' : '0'); } catch (_) {}
    listeners.forEach(fn => fn(hidden));
  }

  return {
    MASK,
    get hidden() { return hidden; },
    num,
    text,
    set,
    toggle: () => set(!hidden),
    // 切換時通知（app.js 重畫每一頁）
    onChange: fn => listeners.push(fn),
  };
})();
