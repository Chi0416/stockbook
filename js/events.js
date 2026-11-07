// 歷史股利：一檔每一次的配息（公告的除權息加上自己記的），和列出來的那張表；選股的殖利率、詳細資料、股利點開的卡片都用
const Events = (() => {
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const byExDesc = (a, b) => (a.exDate < b.exDate ? 1 : a.exDate > b.exDate ? -1 : 0);
  // 手動登記的記號：公告資料裡沒有這筆金額、用的是自己記的；歷史股利、即將除權息、下次除權息都放在日期後面，旁邊用小字說明
  const OWN_NOTE = '* 手動登記，並非系統紀錄';
  const ownMark = '<span class="own-mark" title="手動登記，並非系統紀錄">*</span>';

  // 這一檔每一次的現金股利，除權息日新的在前：[{ exDate, payDate, cash, stock, own }]
  //   cash 是 null：公告了日期、金額還沒公告，自己也還沒記；own：金額用的是自己記的
  //   stock：同一次另外配的股票股利（元，沒有是 0；詳細頁的歷史股利寫出來，殖利率不算）
  //   own（參數）：自己記的除權息；沒給時用 Store 裡的（已經依代號分好，見 announced.js 的 recorded）
  function list(code, own) {
    const c = key(code);
    if (!c) return [];
    const mine = (own ? own.filter(d => key(d.code) === c) : Announced.recorded(c))
      .filter(d => d.exDate && typeof d.cash === 'number' && d.cash > 0);
    const pub = Announced.forCode(c).filter(r => r.cash !== 0); // 只配股的不算
    const list = pub.map(r => {
      const m = r.cash == null ? mine.find(d => Announced.sameEvent(d, r)) : null;
      return { exDate: r.exDate, payDate: r.payDate, cash: m ? m.cash : r.cash, stock: r.stock || 0, own: !!m };
    });
    mine.filter(d => !pub.some(r => Announced.sameEvent(d, r)))
      .forEach(d => list.push({ exDate: d.exDate, payDate: d.payDate || '', cash: d.cash, stock: d.stock || 0, own: true }));
    return list.sort(byExDesc);
  }

  // 一張表，新的在前，一次一行：除權息日期｜現金股利｜股票股利｜合計（都是每股、元）
  //   合計 = 現金股利 + 股票股利（股票股利是照面額算的價值，不是現金）；沒有股票股利的那一欄寫「—」
  //   金額還沒公告的現金股利寫「待公告」、合計「—」，金額用自己記的在日期後面寫 *
  //   表格上面一行（放下面會被捲到畫面外，看不到）：每股、公告資料只抓近 13 個月（年配的只會有一行，免得以為只配過一次），其他的在「說明」；有 * 時再多一行說明 *
  //   empty：一筆都沒有時寫什麼
  function tableHTML(rows, empty) {
    if (!rows.length) return `<p class="note muted">${empty}</p>`;
    const num = v => (v ? U.fmtNum(v) : '—');
    const body = rows.map(r => {
      const cash = typeof r.cash === 'number';
      return `
        <tr>
          <td>${U.esc(U.fmtDate(r.exDate))}${r.own ? ownMark : ''}</td>
          <td class="num">${cash ? U.fmtNum(r.cash) : '待公告'}</td>
          <td class="num">${num(r.stock)}</td>
          <td class="num total">${cash ? U.fmtNum(U.round(r.cash + (r.stock || 0), 4)) : '—'}</td>
        </tr>`;
    }).join('');
    return `
      <div class="card static detail-card">
        <div class="ev-notes">
          <span class="card-note">都是每股（元）；公告資料只有近 13 個月</span>
          ${rows.some(r => r.own) ? `<span class="card-note">${OWN_NOTE}</span>` : ''}
        </div>
        <table class="ev-table">
          <thead><tr><th>除權息日期</th><th class="num">現金股利</th><th class="num">股票股利</th><th class="num">合計</th></tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  return { list, tableHTML, ownMark, OWN_NOTE };
})();
