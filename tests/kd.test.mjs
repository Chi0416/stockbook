// 日 KD 的算法（tools/kd.mjs）：node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kd } from '../tools/kd.mjs';

const bar = (high, low, close) => ({ high, low, close });
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}：${a} ≠ ${b}`);

test('前 8 天湊不滿 9 天，算不出來', () => {
  const r = kd([...Array(8)].map(() => bar(11, 9, 10)));
  assert.equal(r.length, 8);
  assert.ok(r.every(x => x.k === null && x.d === null));
});

test('第 9 天開始算：前一天的 K、D 當作 50', () => {
  // 9 天內最高 20、最低 10，收盤 18：RSV 80，K = 50 × 2/3 + 80 / 3 = 60，D = 50 × 2/3 + 60 / 3 = 53.33
  const bars = [bar(20, 15, 16), ...[...Array(7)].map(() => bar(16, 12, 14)), bar(19, 10, 18)];
  const r = kd(bars);
  near(r[8].k, 60, 'K');
  near(r[8].d, 50 * 2 / 3 + 20, 'D');
});

test('之後每天接著前一天算，只看最近 9 天的最高、最低', () => {
  const bars = [bar(30, 10, 20), ...[...Array(8)].map(() => bar(16, 12, 14)), bar(17, 13, 16)];
  const r = kd(bars);
  // 第 9 天（第 1 天的 30、10 還在裡面）：RSV = (14 − 10) ÷ 20 × 100 = 20
  const k9 = 50 * 2 / 3 + 20 / 3;
  near(r[8].k, k9, '第 9 天的 K');
  // 第 10 天：第 1 天已經不在 9 天裡，最高 17、最低 12，RSV = (16 − 12) ÷ 5 × 100 = 80
  const k10 = k9 * 2 / 3 + 80 / 3;
  near(r[9].k, k10, '第 10 天的 K');
  near(r[9].d, (50 * 2 / 3 + k9 / 3) * 2 / 3 + k10 / 3, '第 10 天的 D');
});

test('收在 9 天最高 K 往 100 走、收在最低往 0 走；價格完全沒動時 RSV 當作 50', () => {
  const up = kd([...Array(60)].map((_, i) => bar(10 + i, 9 + i, 10 + i)));
  assert.ok(up[59].k > 99.9 && up[59].d > 99.9);
  const down = kd([...Array(60)].map((_, i) => bar(100 - i, 99 - i, 99 - i)));
  assert.ok(down[59].k < 0.1 && down[59].d < 0.1);
  const flat = kd([...Array(20)].map(() => bar(10, 10, 10)));
  near(flat[19].k, 50, 'K');
  near(flat[19].d, 50, 'D');
});

test('起始值的影響：抓 60 天算出來的，和多抓 200 天的差不到 0.01', () => {
  // 假的股價：上下波動
  const all = [...Array(260)].map((_, i) => {
    const c = 100 + 10 * Math.sin(i / 5) + 3 * Math.sin(i / 1.7);
    return bar(c + 1.5, c - 1.5, c);
  });
  const long = kd(all).at(-1);
  const short = kd(all.slice(-60)).at(-1);
  assert.ok(Math.abs(long.k - short.k) < 0.01 && Math.abs(long.d - short.d) < 0.01, `${long.k} ${short.k} ${long.d} ${short.d}`);
});
