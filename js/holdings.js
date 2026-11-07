// 持股推算：以最近一期庫存快照為起點，加上快照之後的交易與配股
//   還沒有快照時從 0 開始，加總全部的交易與配股（假設交易紀錄完整）
//   股數：買進加、賣出減（交易別含「買」或「賣」）
//         配股在發放日入帳，依除權息日前的持股計算：股票股利每股 X 元 = 每股配 X/10 股，不足一股不計
//   成本：移動平均，和券商 App 的付出成本算法一致
//         買進加上應收付金額（已含手續費）；賣出依平均成本扣除（平均成本不變）；配股不增加成本
//         除息日扣掉現金股利（除息日之前的持股 × 每股現金股利，元以下四捨五入，和累積現金股利一樣）
//   各頁之間用代號對應（不分大小寫）
//   每位成員分開推算（各自有自己的快照日期）；全家時再依代號合計
//   資料沒變時不重算（見 storage.js 的 memo）：
//     交易、快照、除權息先依成員、代號分好（index），推算時只看同一位成員、同一檔的，不用每次從頭找一遍
//     推算過的持股、核對結果記住，同一個畫面裡好幾個地方要用（庫存、選股每一頁、訊息匣）都拿同一份
//     回傳的東西大家共用，用的地方不能修改
const Holdings = (() => {
  const num = v => Number(v) || 0;
  const codeOf = r => String(r.code ?? '').trim().toUpperCase();
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const signed = t => (/買/.test(t.type) ? num(t.shares) : /賣/.test(t.type) ? -num(t.shares) : 0);

  // 依 key 分組，每組照原本的順序
  function group(rows, keyOf) {
    const m = new Map();
    rows.forEach(r => {
      const k = keyOf(r);
      const list = m.get(k);
      if (list) list.push(r);
      else m.set(k, [r]);
    });
    return m;
  }
  // 先依成員分（成員 id 照原本的值比對，和 Store.list 一樣），每位成員再依 inner 分
  const byMember = (rows, inner) => new Map([...group(rows, r => r.member)].map(([m, list]) => [m, group(list, inner)]));
  // 依成員、代號分好的資料：代號只在這裡統一一次（大小寫、前後空白）
  const index = () => Store.memo('holdings', 'index', () => {
    const trades = Store.list('trades', 'all');
    const snaps = Store.list('snapshots', 'all');
    return {
      dividends: group(Store.list('dividends'), codeOf),                         // 代號 → 除權息
      trades: byMember(trades, codeOf),                                          // 成員 → 代號 → 交易
      memberTrades: group(trades, t => t.member),                                // 成員 → 交易
      snaps: group(snaps, s => s.member),                                        // 成員 → 快照
      snapRows: byMember(snaps, s => JSON.stringify([s.date, codeOf(s)])),       // 成員 → [日期, 代號] → 那一期這檔的快照
    };
  });
  const dividendsOf = code => index().dividends.get(code) || [];
  const tradesOf = (member, code) => index().trades.get(member)?.get(code) || [];
  const memberTrades = member => index().memberTrades.get(member) || [];
  const snapsOf = member => index().snaps.get(member) || [];
  const snapRows = (member, date, code) => index().snapRows.get(member)?.get(JSON.stringify([date, code])) || [];
  // 同樣的參數算過就用上一次的（資料改過才重算）；args 轉成 JSON 當 key，成員 id 是數字或字串分得出來
  const remember = (name, args, fn) => {
    const memo = Store.memo('holdings', name, () => new Map());
    const key = JSON.stringify(args);
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key);
  };

  // 成員某代號在 inRange(日期) 範圍內的事件，依日期排序：交易（成交日）、配股入帳（發放日）、除息（除權息日）
  //   同一天的除息排最前面：除息日當天買的領不到、當天賣的領得到
  // 除權息日必須早於發放日，資料填反時略過配股（也避免無限遞迴）
  // edit：表單上還沒存的那一筆（見 preview）：{ skip: 原本那筆的 id, add: 表單上的那筆 }，add 排在同一天的最後面
  function eventsFor(member, code, inRange, edit) {
    const dividends = dividendsOf(code);
    const trades = edit
      ? [...tradesOf(member, code).filter(t => t.id !== edit.skip), edit.add]
      : tradesOf(member, code);
    return [
      ...dividends
        .filter(d => num(d.cash) > 0 && inRange(d.exDate))
        .map(d => ({ date: d.exDate, cash: d })),
      ...trades
        .filter(t => inRange(t.date))
        .map(t => ({ date: t.date, trade: t })),
      ...dividends
        .filter(d => num(d.stock) > 0 && d.exDate < d.payDate && inRange(d.payDate))
        .map(d => ({ date: d.payDate, stock: d })),
    ].sort(byDate);
  }

  // 配股入帳的股數：除權息有手動填基準日股數就用它，否則用除權息日之前的持股推算
  function bonusShares(member, code, d) {
    const manual = d.baseShares?.[member];
    const held = typeof manual === 'number' ? manual : position(member, code, d.exDate).shares;
    return Math.floor(held * num(d.stock) / 10);
  }

  // 成員在 date 之前（inclusive 時含當天）最近一期快照的日期
  function snapDateBefore(member, date, inclusive) {
    return snapsOf(member).reduce((best, s) => {
      const ok = inclusive ? s.date <= date : s.date < date;
      return ok && (!best || s.date > best) ? s.date : best;
    }, null);
  }

  // 成員某代號在 date 之前（inclusive 時含當天）的持股
  //   之前有快照就從最近一期快照往後推；沒有就從 0 開始累加（snapDate 為 null）
  //   配股入帳時要再推算除權息日之前的持股（bonusShares），記住算過的，一年配一次股的不會越推越多次
  function position(member, code, date, inclusive = false) {
    return remember('position', [member, code, date, inclusive], () => positionAt(member, code, date, inclusive));
  }

  function positionAt(member, code, date, inclusive) {
    const snapDate = snapDateBefore(member, date, inclusive);
    const { rows, base, shares, cost, name, bought, sold, bonus } = walk(member, code, snapDate, date, inclusive);

    const changed = bought > 0 || sold > 0 || bonus > 0;
    const formula = (snapDate ? `${U.fmtDate(snapDate)} 快照 ${U.fmtNum(base)}` : '從 0 開始') +
      (bought ? ` + 買進 ${U.fmtNum(bought)}` : '') +
      (sold ? ` − 賣出 ${U.fmtNum(sold)}` : '') +
      (bonus ? ` + 配股 ${U.fmtNum(bonus)}` : '');

    return { member, code, name, shares, cost, snapDate, found: rows.length > 0 || changed, changed, formula };
  }

  // 從 start 那一期快照（null 時從 0）一筆一筆推到 date（inclusive 時含當天）
  //   除了股數、成本，也算進出的錢（現金單用，見 cashflow）：
  //     paid 投入 = 起點快照的付出成本 + 之後買進的應收付金額；got 已提領 = 之後賣出拿回的應收付金額
  //     divs 股利 = 之後除息的現金股利（和付出成本扣掉的一樣）
  //   sales：每一筆賣出 { trade, held 賣出前的股數, cost 賣掉那部分的付出成本 }（賣出損益用，見 realized）
  function walk(member, code, start, date, inclusive, edit) {
    const inRange = d => (!start || d > start) && (inclusive ? d <= date : d < date);

    const rows = start ? snapRows(member, start, code) : [];
    const base = rows.reduce((t, s) => t + num(s.shares), 0);
    let shares = base;
    let cost = rows.reduce((t, s) => t + num(s.totalCost), 0);
    let name = rows.length ? rows[0].name : '';
    let bought = 0;
    let sold = 0;
    let bonus = 0;
    let paid = cost;
    let got = 0;
    let divs = 0;
    const sales = [];

    eventsFor(member, code, inRange, edit).forEach(e => {
      if (e.cash) {
        // 除息：股數不變，付出成本扣掉這次的現金股利（基準日股數有手動填就用它）
        const manual = e.cash.baseShares?.[member];
        const held = typeof manual === 'number' ? manual : shares;
        if (held > 0) {
          const cash = Math.round(U.round(num(e.cash.cash) * held));
          cost -= cash;
          divs += cash;
        }
      } else if (e.trade) {
        const t = e.trade;
        const n = num(t.shares);
        if (!name) name = t.name;
        if (/買/.test(t.type)) {
          shares += n;
          bought += n;
          cost += num(t.settle);
          paid += num(t.settle);
        } else if (/賣/.test(t.type)) {
          const before = cost;
          cost = shares > 0 ? Math.round(cost * Math.max(shares - n, 0) / shares) : 0;
          sales.push({ trade: t, held: shares, cost: before - cost });
          shares -= n;
          sold += n;
          got += num(t.settle);
        }
      } else {
        const add = bonusShares(member, code, e.stock);
        shares += add;
        bonus += add;
      }
    });

    return { rows, base, shares, cost, name, bought, sold, bonus, paid, got, divs, sales };
  }

  // ---------- 賣出損益（已實現） ----------
  // 損益 = 賣出拿回的應收付金額 − 賣掉那部分的付出成本；報酬率 = 損益 ÷ 賣掉那部分的付出成本
  //   付出成本和庫存同一種算法（移動平均，從賣出前最近一期快照往後推，見 walk）
  //   付出成本在除息日扣過現金股利，所以損益含持有期間領到的股利（和未實現損益一樣）
  //   快照當天的賣出已經算在那一期快照裡，所以從前一期快照推（不含賣出當天的快照）
  // 算不出來時 pl 是 null，why 寫原因：
  //   應收付金額空白
  //   賣出的股數比當時的持股多：前面的買進沒記
  //   這段期間的買賣和下一期快照對不上（核對是 diff）：中間漏記或記錯，成本不準
  //   第一期快照之前的買進只補了一部分（核對是 partial）：更早買的成本不知道

  // 從 start 那一期快照推到賣出那天，這段期間的買賣能不能信：不能時回傳原因
  //   看下一期快照（start 之後第一期）的核對；後面還沒有快照時沒得核對，照算
  function segmentWhy(member, code, start) {
    const next = [...new Set(snapsOf(member).map(s => s.date))].filter(d => !start || d > start).sort()[0];
    if (!next) return '';
    const c = checkOf(member).find(x => x.code === code && x.date === next);
    if (c?.status === 'diff') return `這段期間的買賣和 ${U.fmtDate(next)} 的庫存快照對不上，成本算不準`;
    if (c?.status === 'partial') return `${U.fmtDate(next)} 第一期庫存快照之前的買進還沒補齊，成本算不準`;
    return '';
  }

  // walk 記下的一筆賣出 → { pl, cost, why }
  function judge(s, why) {
    const t = s.trade;
    const reason = typeof t.settle !== 'number' ? '應收付金額空白，算不出損益'
      : s.held < num(t.shares) ? '賣出的股數比當時的持股多，前面的買進可能沒記'
      : why;
    return reason ? { pl: null, cost: null, why: reason } : { pl: Math.round(t.settle) - s.cost, cost: s.cost, why: '' };
  }

  // 成員某代號每一筆賣出的損益：Map(交易 id → { pl, cost, why })
  //   賣出前最近一期快照一樣的分成一段，一段推一次
  function realized(member, code) {
    return remember('realized', [member, code], () => {
      const out = new Map();
      const sells = tradesOf(member, code).filter(t => signed(t) < 0);
      group(sells, t => snapDateBefore(member, t.date, false)).forEach((list, start) => {
        const end = list.reduce((d, t) => (t.date > d ? t.date : d), list[0].date);
        const why = segmentWhy(member, code, start);
        walk(member, code, start, end, true).sales.forEach(s => out.set(s.trade.id, judge(s, why)));
      });
      return out;
    });
  }

  // 一筆交易的損益（不是賣出時回傳 null）
  const sale = t => (t && signed(t) < 0 ? realized(t.member, codeOf(t)).get(t.id) || null : null);

  // 表單上還沒存的賣出（新增的，或改到一半的）：和存好之後的算法一樣，這一筆排在成交日當天的最後面
  //   t：{ id（改的時候是原本那筆，新增時沒有）, member, date, type, code, shares, settle }；不是賣出、還沒填好時回傳 null
  function preview(t) {
    const code = codeOf(t);
    if (!t.member || !t.date || !code || signed(t) >= 0) return null;
    const add = { ...t, id: Symbol('preview') };
    const start = snapDateBefore(t.member, t.date, false);
    const s = walk(t.member, code, start, t.date, true, { skip: t.id, add }).sales.find(x => x.trade === add);
    return s ? judge(s, segmentWhy(t.member, code, start)) : null;
  }

  // 現金單的投入、已提領、股利（見 cash.js），到 date（含當天）為止：{ paid, got, divs, since }
  //   買賣和快照對得上就一路累加：新的快照只是照券商重設股數和成本，進出的錢沒有變，不會歸零
  //   since：從最後一期對不上的快照算起（核對見 checkMember），那之前的買賣接不起來（中間漏記、更早的交易還沒補），
  //     錢也算不準，投入從那一期的付出成本開始；補齊後就會往前算
  //     都對得上時是 null，從第一筆買賣算起
  function cashflow(member, code, date) {
    return remember('cashflow', [member, code, date], () => {
      const since = checkOf(member)
        .filter(c => c.code === code && c.status !== 'ok' && c.date <= date)
        .reduce((best, c) => (!best || c.date > best ? c.date : best), null);
      const { paid, got, divs } = walk(member, code, since, date, true);
      return { paid, got, divs, since };
    });
  }

  // 除權息日之前沒有快照時，用除權息日當天或之後最近一期快照往回推：
  //   快照股數 − 除權息日起到快照日的買進 + 同期間的賣出
  //   期間有配股入帳就無法可靠地往回推（bonus 為 true）；沒有可用的快照時回傳 null
  function positionBack(member, code, exDate) {
    const snaps = snapsOf(member);
    const snapDate = snaps.reduce((best, s) => (s.date >= exDate && (!best || s.date < best) ? s.date : best), null);
    if (!snapDate) return null;
    const inWindow = d => d >= exDate && d <= snapDate;

    const rows = snapRows(member, snapDate, code);
    const base = rows.reduce((t, s) => t + num(s.shares), 0);
    let bought = 0;
    let sold = 0;
    tradesOf(member, code).forEach(t => {
      if (!inWindow(t.date)) return;
      if (/買/.test(t.type)) bought += num(t.shares);
      else if (/賣/.test(t.type)) sold += num(t.shares);
    });
    const bonus = dividendsOf(code).some(d => num(d.stock) > 0 && inWindow(d.payDate));

    const changed = bought > 0 || sold > 0;
    const formula = `${U.fmtDate(snapDate)} 快照 ${U.fmtNum(base)}` +
      (bought ? ` − 期間買進 ${U.fmtNum(bought)}` : '') +
      (sold ? ` + 期間賣出 ${U.fmtNum(sold)}` : '');
    return { member, code, shares: base - bought + sold, snapDate, bonus, found: rows.length > 0 || changed, changed, formula };
  }

  // 成員在某次除權息的基準日股數，依序採用：
  //   1. 手動填寫（manual 是數字時）
  //   2. 除權息日之前最近一期快照往後推（position）
  //   3. 之前沒有快照時，用除權息日之後最近一期快照往回推（positionBack）
  //   4. 前後都沒有快照時，從 0 開始累加交易（position 的 snapDate 為 null）
  // 回傳 { member, found, shares, basis, error, snapDate }；found 為 false 表示這位成員當時沒有持有
  function entitled(member, code, exDate, manual) {
    if (typeof manual === 'number') return { member, found: true, shares: manual, basis: '基準日股數為手動輸入' };

    const negative = p => ({ member, found: true, shares: p.shares, error: `股數算出來是負的（${p.formula}），請檢查資料` });
    const fwd = position(member, code, exDate, false);
    const back = fwd.snapDate ? null : positionBack(member, code, exDate);
    if (back) {
      if (!back.found) return { member, found: false, snapDate: back.snapDate };
      if (back.bonus) {
        return {
          member, found: true, shares: null,
          error: `除權息日到 ${U.fmtDate(back.snapDate)} 快照之間有配股，無法往回推算，請在除權息手動填基準日股數`,
        };
      }
      if (back.shares < 0) return negative(back);
      return {
        member, found: true, shares: back.shares,
        basis: back.changed
          ? `股數 = ${back.formula}（往回推算）`
          : `股數依 ${U.fmtDate(back.snapDate)} 快照往回推算（期間沒有買賣紀錄）`,
      };
    }

    if (!fwd.found) return { member, found: false, snapDate: fwd.snapDate };
    if (fwd.shares < 0) return negative(fwd);
    return {
      member, found: true, shares: fwd.shares,
      basis: fwd.changed ? `股數 = ${fwd.formula}` : `股數依 ${U.fmtDate(fwd.snapDate)} 庫存快照`,
    };
  }

  // 成員在 date（含當天）時的全部持股，已經賣光的不列出；沒有快照也沒有交易時回傳 null
  // snapDate：推算的起點；沒有快照、從 0 開始加總交易時為 null
  // missingCode：最新一期快照與之後的交易裡，沒填代號而無法計入的筆數
  function memberAll(member, date) {
    return remember('memberAll', [member, date], () => memberAt(member, date));
  }

  function memberAt(member, date) {
    const snapDate = snapDateBefore(member, date, true);
    const recs = [
      ...(snapDate ? snapsOf(member).filter(s => s.date === snapDate) : []),
      ...memberTrades(member).filter(t => (!snapDate || t.date > snapDate) && t.date <= date),
    ];
    if (!snapDate && !recs.length) return null;
    const codes = new Set(recs.map(codeOf));
    const missingCode = codes.has('') ? recs.filter(r => !codeOf(r)).length : 0;
    codes.delete('');
    return {
      snapDate,
      missingCode,
      positions: [...codes].map(c => position(member, c, date, true)).filter(p => p.shares !== 0),
    };
  }

  // 目前檢視範圍的全部持股；全家或勾了好幾位時各成員分別推算後依代號合計，parts 為各成員的明細
  // snapDate：推算的起點（各成員的起點不一樣，或是從 0 開始加總交易時為 null）
  // mixed：各成員的起點不一樣（快照日期不同，或有人沒有快照）
  function all(date) {
    return remember('all', [date, Store.scope], () => allAt(date));
  }

  function allAt(date) {
    const ids = Store.shown();
    if (Store.scope !== 'all' && ids.length === 1) return memberAll(ids[0], date);
    const each = ids.map(id => memberAll(id, date)).filter(Boolean);
    if (!each.length) return null;

    const merged = new Map();
    each.forEach(h => h.positions.forEach(p => {
      const cur = merged.get(p.code) || { code: p.code, name: '', shares: 0, cost: 0, parts: [] };
      cur.name = cur.name || p.name;
      cur.shares += p.shares;
      cur.cost += p.cost;
      cur.parts.push(p);
      merged.set(p.code, cur);
    }));
    const dates = new Set(each.map(h => h.snapDate));
    return {
      snapDate: dates.size === 1 ? each[0].snapDate : null,
      mixed: dates.size > 1,
      missingCode: each.reduce((n, h) => n + h.missingCode, 0),
      positions: [...merged.values()].filter(p => p.shares !== 0 || p.parts.some(x => x.shares < 0)),
    };
  }

  // 全家目前持有的代號（不管目前看哪一位成員），依代號排序；同步股價用（見 sync.js）
  function heldCodes(date) {
    const codes = Store.members().flatMap(m =>
      (memberAll(m.id, date)?.positions || []).filter(p => p.shares > 0).map(p => p.code));
    return [...new Set(codes)].sort();
  }

  // 「未實現損益」下面的交易明細（見 mine.js）：這一檔的全部買賣，新的在前；跟著設定裡勾的成員
  //   快照當天或以前的買賣已經算在快照裡，持股不會再加一次（見 position），這裡照樣列，新增快照不會讓交易看不到
  //   amount：應收付金額；price：成交單價；sale：賣出的損益（見 realized），買進是 null
  function ledger(code, date) {
    const c = String(code ?? '').trim().toUpperCase();
    const rows = Store.shown().flatMap(member => tradesOf(member, c)
      .filter(t => signed(t) !== 0 && t.date <= date)
      .map(t => ({
        kind: /買/.test(t.type) ? 'buy' : 'sell', member, date: t.date, type: t.type, shares: num(t.shares),
        price: typeof t.price === 'number' ? t.price : null, amount: typeof t.settle === 'number' ? t.settle : null,
        sale: signed(t) < 0 ? realized(member, c).get(t.id) || null : null,
      })));
    return rows.sort((a, b) => byDate(b, a));
  }

  // 「未實現損益」下面的快照（見 mine.js）：這一檔每一期的庫存快照，新的在前；跟著設定裡勾的成員
  //   amount：付出成本；price：成本均價
  function snaps(code, date) {
    const c = String(code ?? '').trim().toUpperCase();
    const rows = Store.shown().flatMap(member => snapsOf(member)
      .filter(s => codeOf(s) === c && s.date <= date)
      .map(s => ({
        member, date: s.date, type: s.type || '', shares: num(s.shares),
        price: num(s.shares) ? num(s.totalCost) / num(s.shares) : null, amount: num(s.totalCost),
      })));
    return rows.sort((a, b) => byDate(b, a));
  }

  // ---------- 核對 ----------
  // 前一期快照的股數（第一期從 0 開始）＋期間的買賣與配股，應該等於這一期快照的股數
  // 回傳成員每一期快照、每一檔的結果 { member, date, prevDate, code, name, expected, actual, status, formula, recId }
  //   status：'ok' 相符、'diff' 對不上、'nohistory' 第一期之前還沒有這檔的買賣紀錄（不核對）
  //           只有配股也算沒有：配到股的持股是開始記帳之前就有的，從 0 開始推算不出來
  //           'partial' 第一期之前的交易只補了一部分：加起來比快照少，是更早的交易還沒補（不提醒）；比快照多才是對不上
  //   recId：這一期快照裡這檔的第一筆記錄；快照裡沒有這檔時為 null
  function checkMember(member) {
    const snaps = snapsOf(member);
    const dates = [...new Set(snaps.map(s => s.date))].sort();
    const sum = rows => rows.reduce((t, s) => t + num(s.shares), 0);
    return dates.flatMap((date, k) => {
      const prev = k ? dates[k - 1] : null;
      const inRange = d => (!prev || d > prev) && d <= date;
      const rowsAt = (d, code) => snapRows(member, d, code);
      const trades = memberTrades(member).filter(t => inRange(t.date));
      const codes = new Set([...snaps.filter(s => s.date === date || s.date === prev), ...trades].map(codeOf));
      codes.delete('');

      return [...codes].map(code => {
        const now = rowsAt(date, code);
        const before = prev ? rowsAt(prev, code) : [];
        const base = sum(before);
        let bought = 0;
        let sold = 0;
        let bonus = 0;
        eventsFor(member, code, inRange).forEach(e => {
          if (e.stock) bonus += bonusShares(member, code, e.stock);
          else if (!e.trade) return; // 除息不影響股數
          else if (signed(e.trade) > 0) bought += signed(e.trade);
          else sold -= signed(e.trade);
        });
        const expected = base + bought - sold + bonus;
        const actual = sum(now);
        const status = !prev && !bought && !sold ? 'nohistory'
          : expected === actual ? 'ok'
          : !prev && expected < actual ? 'partial'
          : 'diff';
        const formula = (prev ? `${U.fmtDate(prev)} 快照 ${U.fmtNum(base)}` : '從 0 開始') +
          (bought ? ` + 買進 ${U.fmtNum(bought)}` : '') +
          (sold ? ` − 賣出 ${U.fmtNum(sold)}` : '') +
          (bonus ? ` + 配股 ${U.fmtNum(bonus)}` : '');
        const name = (now[0] || before[0] || trades.find(t => codeOf(t) === code) || {}).name || '';
        return { member, date, prevDate: prev, code, name, expected, actual, status, formula, recId: now[0]?.id ?? null };
      });
    });
  }

  const checkOf = member => remember('checkMember', [member], () => checkMember(member));

  // 目前檢視範圍（勾選的成員或全家）的核對結果
  // scope 預設是目前的檢視範圍；訊息匣用 'all' 檢查全家
  function check(scope = Store.scope) {
    const ids = Store.shown(scope);
    return remember('check', ids, () => ids.flatMap(checkOf));
  }

  // 成員在 date（含當天）時用來推算持股的快照日期；沒有快照時為 null
  const snapDate = (member, date) => snapDateBefore(member, date, true);

  return { codeOf, position, cashflow, entitled, memberAll, all, heldCodes, ledger, snaps, check, snapDate, sale, preview };
})();
