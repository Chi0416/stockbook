// 日 KD（9、3、3），台灣券商常用的算法：tools/update-prices.mjs 用（測試見 tests/kd.test.mjs）
//   RSV = (今天收盤 − 近 9 天最低) ÷ (近 9 天最高 − 近 9 天最低) × 100；9 天的最高等於最低（價格完全沒動）時 RSV 當作 50
//   K = 前一天的 K × 2/3 + 今天的 RSV × 1/3
//   D = 前一天的 D × 2/3 + 今天的 K × 1/3
//   第一次算的時候「前一天」的 K、D 都當作 50；之後一天接一天算，50 天後起始值的影響已經小到看不出來
//   bars：有成交的每一天，日期舊的在前 [{ high, low, close }]；沒有成交的那天不要放進來（不算一天）
//   回傳每一天的 { k, d }（沒有四捨五入）；前 8 天還湊不滿 9 天，是 null
export function kd(bars, n = 9) {
  let k = 50;
  let d = 50;
  return bars.map((b, i) => {
    if (i < n - 1) return { k: null, d: null };
    const days = bars.slice(i - n + 1, i + 1);
    const high = Math.max(...days.map(x => x.high));
    const low = Math.min(...days.map(x => x.low));
    const rsv = high === low ? 50 : (b.close - low) / (high - low) * 100;
    k = k * 2 / 3 + rsv / 3;
    d = d * 2 / 3 + k / 3;
    return { k, d };
  });
}
