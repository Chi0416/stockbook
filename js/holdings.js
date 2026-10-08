// 持股推算：以最近一期庫存快照為起點，加上快照之後的交易與配股
//   還沒有快照時從 0 開始，加總全部的交易與配股（假設交易紀錄完整）
//   股數：買進加、賣出減（交易別含「買」或「賣」）
//         配股在發放日入帳，依除權息日前的持股計算：股票股利每股 X 元 = 每股配 X/10 股，不足一股不計
//   成本：移動平均，和券商 App 的付出成本算法一致
//         買進加上應收付金額（已含手續費）；賣出依平均成本扣除（平均成本不變）；配股不增加成本
//         除息日扣掉現金股利（除息日之前的持股 × 每股現金股利，元以下四捨五入，和累積現金股利一樣）
//   各頁之間用代號對應（不分大小寫）
//   每位成員分開推算（各自有自己的快照日期）；全家時再依代號合計
const Holdings = (() => {
  const num = v => Number(v) || 0;
  const codeOf = r => String(r.code ?? '').trim().toUpperCase();
  const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const signed = t => (/買/.test(t.type) ? num(t.shares) : /賣/.test(t.type) ? -num(t.shares) : 0);

  // 成員某代號在 inRange(日期) 範圍內的事件，依日期排序：交易（成交日）、配股入帳（發放日）、除息（除權息日）
  //   同一天的除息排最前面：除息日當天買的領不到、當天賣的領得到
  // 除權息日必須早於發放日，資料填反時略過配股（也避免無限遞迴）
  function eventsFor(member, code, inRange) {
    const dividends = Store.list('dividends').filter(d => codeOf(d) === code);
    return [
      ...dividends
        .filter(d => num(d.cash) > 0 && inRange(d.exDate))
        .map(d => ({ date: d.exDate, cash: d })),
      ...Store.list('trades', member)
        .filter(t => codeOf(t) === code && inRange(t.date))
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
    return Store.list('snapshots', member).reduce((best, s) => {
      const ok = inclusive ? s.date <= date : s.date < date;
      return ok && (!best || s.date > best) ? s.date : best;
    }, null);
  }

  // 成員某代號在 date 之前（inclusive 時含當天）的持股
  //   之前有快照就從最近一期快照往後推；沒有就從 0 開始累加（snapDate 為 null）
  //   另外從同一個起點算進出的錢（現金單用，見 cash.js）：
  //     paid 投入 = 快照的付出成本 + 之後買進的應收付金額；got 已提領 = 之後賣出拿回的應收付金額
  //     divs 股利 = 之後除息的現金股利（和付出成本扣掉的一樣）
  function position(member, code, date, inclusive = false) {
    const snapDate = snapDateBefore(member, date, inclusive);
    const inRange = d => (!snapDate || d > snapDate) && (inclusive ? d <= date : d < date);

    const rows = snapDate ? Store.list('snapshots', member).filter(s => s.date === snapDate && codeOf(s) === code) : [];
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

    const events = eventsFor(member, code, inRange);

    events.forEach(e => {
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
          cost = shares > 0 ? Math.round(cost * Math.max(shares - n, 0) / shares) : 0;
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

    const changed = bought > 0 || sold > 0 || bonus > 0;
    const formula = (snapDate ? `${U.fmtDate(snapDate)} 快照 ${U.fmtNum(base)}` : '從 0 開始') +
      (bought ? ` + 買進 ${U.fmtNum(bought)}` : '') +
      (sold ? ` − 賣出 ${U.fmtNum(sold)}` : '') +
      (bonus ? ` + 配股 ${U.fmtNum(bonus)}` : '');

    return { member, code, name, shares, cost, paid, got, divs, snapDate, found: rows.length > 0 || changed, changed, formula };
  }

  // 除權息日之前沒有快照時，用除權息日當天或之後最近一期快照往回推：
  //   快照股數 − 除權息日起到快照日的買進 + 同期間的賣出
  //   期間有配股入帳就無法可靠地往回推（bonus 為 true）；沒有可用的快照時回傳 null
  function positionBack(member, code, exDate) {
    const snaps = Store.list('snapshots', member);
    const snapDate = snaps.reduce((best, s) => (s.date >= exDate && (!best || s.date < best) ? s.date : best), null);
    if (!snapDate) return null;
    const inWindow = d => d >= exDate && d <= snapDate;

    const rows = snaps.filter(s => s.date === snapDate && codeOf(s) === code);
    const base = rows.reduce((t, s) => t + num(s.shares), 0);
    let bought = 0;
    let sold = 0;
    Store.list('trades', member).forEach(t => {
      if (codeOf(t) !== code || !inWindow(t.date)) return;
      if (/買/.test(t.type)) bought += num(t.shares);
      else if (/賣/.test(t.type)) sold += num(t.shares);
    });
    const bonus = Store.list('dividends').some(d => codeOf(d) === code && num(d.stock) > 0 && inWindow(d.payDate));

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
    const snapDate = snapDateBefore(member, date, true);
    const recs = [
      ...(snapDate ? Store.list('snapshots', member).filter(s => s.date === snapDate) : []),
      ...Store.list('trades', member).filter(t => (!snapDate || t.date > snapDate) && t.date <= date),
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

  // ---------- 核對 ----------
  // 前一期快照的股數（第一期從 0 開始）＋期間的買賣與配股，應該等於這一期快照的股數
  // 回傳成員每一期快照、每一檔的結果 { member, date, prevDate, code, name, expected, actual, status, formula, recId }
  //   status：'ok' 相符、'diff' 對不上、'nohistory' 第一期之前還沒有這檔的買賣紀錄（不核對）
  //           只有配股也算沒有：配到股的持股是開始記帳之前就有的，從 0 開始推算不出來
  //           'partial' 第一期之前的交易只補了一部分：加起來比快照少，是更早的交易還沒補（不提醒）；比快照多才是對不上
  //   recId：這一期快照裡這檔的第一筆記錄；快照裡沒有這檔時為 null
  function checkMember(member) {
    const snaps = Store.list('snapshots', member);
    const dates = [...new Set(snaps.map(s => s.date))].sort();
    const sum = rows => rows.reduce((t, s) => t + num(s.shares), 0);
    return dates.flatMap((date, k) => {
      const prev = k ? dates[k - 1] : null;
      const inRange = d => (!prev || d > prev) && d <= date;
      const rowsAt = (d, code) => snaps.filter(s => s.date === d && codeOf(s) === code);
      const trades = Store.list('trades', member).filter(t => inRange(t.date));
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

  // 目前檢視範圍（勾選的成員或全家）的核對結果
  // scope 預設是目前的檢視範圍；訊息匣用 'all' 檢查全家
  function check(scope = Store.scope) {
    return Store.shown(scope).flatMap(checkMember);
  }

  // 成員在 date（含當天）時用來推算持股的快照日期；沒有快照時為 null
  const snapDate = (member, date) => snapDateBefore(member, date, true);

  return { codeOf, position, entitled, all, heldCodes, check, snapDate };
})();
