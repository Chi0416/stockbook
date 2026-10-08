// 現金單（股利的第三頁）：把一檔股票（例如 0050）當成資金池，像銀行存款一樣看「最高能提領多少」，要用錢時算要賣幾股
//   哪一檔、手續費怎麼算，記在「現金單」資料表，每位成員一筆（見 schema.js）
//   最高能提領：全部賣掉，扣掉手續費和證交稅以後實拿多少
//   提領試算：選 10 萬、20 萬或自己填；股數無條件捨去，實拿不超過這個金額
//     一張以上時整張一筆、零股一筆，分開下單，手續費各算（最低手續費也分開）
//   投入、已提領、股利從推算持股的起點算（最近一期快照，沒有快照時從 0，見 holdings.js 的 position）
//     賺了 = 最高能提領 + 已提領 + 股利 − 投入（現在全部賣掉的話，總共賺多少）
//   價格用現價（見 market.js 的 quote）；零股的成交價可能和現價差一點
//
// Cash：手續費、證交稅、要賣幾股的計算（不碰畫面，測試直接呼叫）
//   手續費 = 成交金額 × 0.1425% × 折數，元以下捨去，不足最低手續費收最低；月退的用原價
//   證交稅 = 成交金額 × 稅率，元以下捨去：股票 0.3%，ETF、ETN（代號 00、02 開頭）0.1%
//     債券 ETF（代號 00 開頭、B 結尾，例如 00679B）免稅：停徵到 2026/12/31，行政院已通過再延 10 年的草案（還要立法院通過）
//   成交金額 = 股數 × 價格，四捨五入到元（和交易明細的試算一樣，見 schema.js 的 settleOf）
const Cash = (() => {
  const FEE_RATE = 0.001425;
  const LOT = 1000;
  const key = c => U.toHalf(c ?? '').trim().toUpperCase();
  const floor = n => Math.floor(U.round(n, 6)); // 0.1425% × 金額的浮點誤差（85.99999）不要少算 1 元

  function taxRate(code) {
    const c = key(code);
    if (/^00\d+B$/.test(c)) return 0;
    if (/^0[02]/.test(c)) return 0.001;
    return 0.003;
  }

  // 手續費的折扣：6 折是 0.6；月退、沒填、填 10 以上都是原價
  function discountOf(s) {
    const d = Number(s?.discount);
    if (/月/.test(s?.rebate ?? '') || !(d > 0) || d >= 10) return 1;
    return d / 10;
  }

  function fee(amount, odd, s) {
    if (amount <= 0) return 0;
    const min = Number(odd ? s?.oddMinFee : s?.minFee) || 0;
    return Math.max(floor(amount * FEE_RATE * discountOf(s)), min);
  }

  // 賣 n 股：{ shares, lots（整張的股數）, odd（零股的股數）, amount, fee, tax, net }
  function sell(n, price, code, s) {
    const lots = Math.floor(n / LOT) * LOT;
    const odd = n - lots;
    const rate = taxRate(code);
    const out = { shares: n, lots, odd, amount: 0, fee: 0, tax: 0, net: 0 };
    [[lots, false], [odd, true]].forEach(([k, isOdd]) => {
      if (k <= 0) return;
      const amount = Math.round(k * price);
      out.amount += amount;
      out.fee += fee(amount, isOdd, s);
      out.tax += floor(amount * rate);
    });
    out.net = out.amount - out.fee - out.tax;
    return out;
  }

  // 要提領 target 元：實拿不超過 target 的最多股數（從估計的上限往下找）
  //   回傳 sell() 的結果加上 all（全部賣掉還不到 target）；一股都不夠時 shares 是 0
  function plan(target, held, price, code, s) {
    const max = sell(held, price, code, s);
    if (max.net <= target) return { ...max, all: true };
    let n = Math.min(held, Math.ceil(target / (price * (1 - FEE_RATE - taxRate(code)))) + 1);
    while (n > 0 && sell(n, price, code, s).net > target) n--;
    return { ...sell(n, price, code, s), all: false };
  }

  return { FEE_RATE, LOT, taxRate, discountOf, fee, sell, plan };
})();

const CASH_PAGE = {
  title: '現金單',
};

// hooks.openForm(id, preset)：打開現金單的設定（id 是 null 時新增，preset 是先帶入的值）
function createCash(hooks) {
  const AMOUNTS = [100000, 200000];
  const picks = new Map(); // 每個現金單選的金額：{ amt: 100000 | 200000 | 'custom', custom: 自己填的文字 }

  const el = document.createElement('section');
  el.className = 'panel';
  el.hidden = true;
  el.innerHTML = '<div class="list"></div>';
  const listEl = el.querySelector('.list');

  const money = n => Privacy.num(U.fmtNum(Math.round(n)));
  const shares = n => Privacy.num(U.fmtNum(n));
  const wan = n => `${U.fmtNum(n / 10000)} 萬`;
  const pickOf = id => picks.get(id) || { amt: AMOUNTS[0], custom: '' };

  // 自己填的金額：35000、35,000、3.5萬、3.5 萬元都可以；看不懂時是 null
  function parseAmount(s) {
    const m = U.toHalf(s ?? '').replace(/[,\s元]/g, '').match(/^(\d+(?:\.\d+)?)(萬)?$/);
    return m ? Math.round(Number(m[1]) * (m[2] ? 10000 : 1)) : null;
  }

  // 「手續費 6 折・最低 20 元、零股 1 元」；月退的寫「6 折月退」（提領時用原價算）
  function feeText(p) {
    const d = Number(p.discount);
    const rate = d > 0 && d < 10 ? `${U.fmtNum(d)} 折${/月/.test(p.rebate ?? '') ? '月退' : ''}` : '原價';
    return `手續費 ${rate}・最低 ${U.fmtNum(Number(p.minFee) || 0)} 元、零股 ${U.fmtNum(Number(p.oddMinFee) || 0)} 元`;
  }

  // 一筆試算的說明：成交 − 手續費 − 證交稅；整張和零股都有時另一行寫出分兩筆
  function breakdown(r) {
    const split = r.lots && r.odd ? `<small>整張 ${shares(r.lots / Cash.LOT)} 張、零股 ${shares(r.odd)} 股，分兩筆下單，手續費各算</small>` : '';
    return `<small>成交 ${money(r.amount)} − 手續費 ${money(r.fee)} − 證交稅 ${money(r.tax)}</small>${split}`;
  }

  function resultHTML(p, ctx) {
    const pick = pickOf(p.id);
    const target = pick.amt === 'custom' ? parseAmount(pick.custom) : pick.amt;
    if (!target) return `<p class="cash-hint">${pick.custom.trim() ? '金額看不懂，例如 35000 或 3.5萬' : '填要提領多少元'}</p>`;
    const r = Cash.plan(target, ctx.held, ctx.price, ctx.code, p);
    if (!r.shares) return `<p class="cash-hint">${U.fmtNum(target)} 元不夠賣一股（現價 ${U.fmtNum(ctx.price, 2)}）</p>`;
    const rest = r.all
      ? `全部賣完也不到 ${target % 10000 ? `${U.fmtNum(target)} 元` : wan(target)}`
      : `賣完剩 ${shares(ctx.held - r.shares)} 股，最高還能提 ${money(Cash.sell(ctx.held - r.shares, ctx.price, ctx.code, p).net)} 元`;
    return `
      <div class="cash-line">
        <span>賣 <b>${shares(r.shares)}</b> 股</span>
        <span>實拿 <b>${money(r.net)}</b> 元</span>
      </div>
      ${breakdown(r)}
      <small>${rest}</small>`;
  }

  function pickHTML(p) {
    const pick = pickOf(p.id);
    const btn = (v, label) => `<button type="button" data-pick="${v}" aria-pressed="${pick.amt === v}">${label}</button>`;
    return `
      <div class="seg cash-pick" role="group" aria-label="要提領多少">
        ${AMOUNTS.map(a => btn(a, wan(a))).join('')}${btn('custom', '自己填')}
      </div>
      ${pick.amt === 'custom' ? `<input class="cash-custom" type="text" inputmode="decimal" autocomplete="off"
        placeholder="要提領多少元，例如 35000 或 3.5萬" value="${U.esc(pick.custom)}" aria-label="要提領多少元">` : ''}`;
  }

  // 一個現金單一張卡片：最高能提領 → 投入、已提領、股利、賺了 → 提領試算 → 手續費設定
  function cardHTML(p, many) {
    const code = Holdings.codeOf(p);
    const pos = Holdings.position(p.member, code, U.today(), true);
    const price = Market.quote(code).price;
    const who = many ? `<span class="badge member">${U.esc(Store.memberName(p.member))}</span>` : '';
    const top = `
      <span class="card-top">
        <span class="card-title"><span class="card-code">${U.esc(code)}</span>${U.esc(p.name || pos.name)}</span>${who}
      </span>`;
    const feeBtn = `<button type="button" class="cash-fee" data-edit="${U.esc(p.id)}"><span>${U.esc(feeText(p))}</span><span class="cash-edit">設定</span></button>`;

    let body;
    if (pos.shares <= 0) {
      body = `<p class="cash-hint">目前沒有 ${U.esc(code)} 的持股，在「記帳」記一筆買進，或在「庫存快照」照券商的庫存填一期</p>`;
    } else if (price === null) {
      body = `<p class="cash-hint">${U.esc(Market.waiting() || '抓不到現價，算不出能提領多少')}</p>`;
    } else {
      const ctx = { code, held: pos.shares, price };
      const all = Cash.sell(pos.shares, price, code, p);
      const gain = all.net + pos.got + pos.divs - pos.paid;
      const tone = Privacy.hidden || !gain ? '' : gain > 0 ? 'gain' : 'loss';
      // 報酬率寫在賺了後面；隱藏金額時只顯示一個 ***
      const rate = pos.paid > 0 && !Privacy.hidden ? `${U.fmtNum(U.round(gain / pos.paid * 100, 1), 1)}%` : '';
      const cell = (label, v, cls = '') => `<span class="cell${cls ? ` ${cls}` : ''}"><small>${label}</small><span>${v}</span></span>`;
      body = `
        <div class="cash-hero">
          <small>最高能提領</small>
          <b>${money(all.net)}</b>
          <span class="cash-sub">${shares(pos.shares)} 股 × ${U.fmtNum(U.round(price, 2), 2)}，扣掉手續費 ${money(all.fee)}、證交稅 ${money(all.tax)}</span>
        </div>
        <span class="card-grid">
          ${cell('投入', money(pos.paid))}
          ${cell('已提領', money(pos.got))}
          ${cell('股利', money(pos.divs))}
          ${cell('賺了', `${Privacy.num(U.fmtNum(gain))}${rate ? `<small>${rate}</small>` : ''}`, tone)}
        </span>
        ${pos.snapDate ? `<span class="card-note">從 ${U.fmtDate(pos.snapDate)} 庫存快照算起，投入包含快照的付出成本</span>` : ''}
        <div class="cash-draw" data-pool="${U.esc(p.id)}">
          ${pickHTML(p)}
          <div class="cash-result">${resultHTML(p, ctx)}</div>
        </div>`;
    }
    return `<div class="card static cash-card" data-id="${U.esc(p.id)}">${top}${body}${feeBtn}</div>`;
  }

  // 卡片的計算資料（自己填金額時只重畫試算結果，輸入框不會失去焦點）
  function ctxOf(p) {
    const code = Holdings.codeOf(p);
    return { code, held: Holdings.position(p.member, code, U.today(), true).shares, price: Market.quote(code).price };
  }

  function refresh() {
    const pools = Store.list('cashPools');
    const members = Store.members();
    const many = members.length > 1;
    const order = id => members.findIndex(m => m.id === id);
    if (!pools.length) {
      listEl.innerHTML = `
        <div class="empty">
          把一檔股票（例如 0050）當成資金池<br>要用錢時，算出要賣幾股、實拿多少
          <button type="button" class="wide-btn primary cash-start" data-add>設定現金單</button>
        </div>`;
      return;
    }
    const lacking = Store.shown().filter(id => !pools.some(p => p.member === id));
    const codes = pools.map(p => Holdings.codeOf(p));
    const note = Market.priceNote(codes);
    listEl.innerHTML = pools.slice().sort((a, b) => order(a.member) - order(b.member)).map(p => cardHTML(p, many)).join('') +
      `<p class="list-intro">${note ? `${U.esc(note)}。` : ''}零股的成交價可能和現價差一點；手續費、證交稅元以下捨去，和券商可能差 1 元。</p>` +
      (lacking.length ? `<button type="button" class="text-btn" data-add="${lacking.length === 1 ? U.esc(lacking[0]) : ''}">` +
        `＋ 幫${U.esc(lacking.map(id => Store.memberName(id)).join('、'))}設定現金單</button>` : '');
  }

  listEl.addEventListener('click', e => {
    // 只有一位成員還沒設定時，先選好那一位
    const add = e.target.closest('[data-add]');
    if (add) { hooks.openForm(null, add.dataset.add ? { member: add.dataset.add } : {}); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) { hooks.openForm(edit.dataset.edit); return; }
    const btn = e.target.closest('[data-pick]');
    if (!btn) return;
    const id = btn.closest('[data-pool]').dataset.pool;
    const v = btn.dataset.pick;
    picks.set(id, { ...pickOf(id), amt: v === 'custom' ? v : Number(v) });
    refresh();
    const draw = listEl.querySelector(`[data-pool="${CSS.escape(id)}"]`);
    if (v === 'custom') draw?.querySelector('.cash-custom')?.focus();
    else draw?.querySelector(`[data-pick="${v}"]`)?.focus({ preventScroll: true });
  });

  listEl.addEventListener('input', e => {
    const inp = e.target.closest('.cash-custom');
    if (!inp) return;
    const draw = inp.closest('[data-pool]');
    const id = draw.dataset.pool;
    picks.set(id, { amt: 'custom', custom: inp.value });
    const p = Store.get('cashPools', id);
    if (p) draw.querySelector('.cash-result').innerHTML = resultHTML(p, ctxOf(p));
  });

  function reset() {
    picks.clear();
    refresh();
  }

  return { el, refresh, reset, changed: refresh };
}
