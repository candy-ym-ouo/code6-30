import assert from 'node:assert/strict';
import {
  endingForAverage,
  freezeFinale,
  summarizeHistory,
  migrateTours,
  type PerformanceSnapshot,
} from './scoring.js';

const perf = (score: number, extra: Partial<PerformanceSnapshot> = {}): PerformanceSnapshot => ({
  id: `p${score}`,
  townId: 'lantern',
  score,
  income: 10,
  ending: 0,
  snapshot: {},
  createdAt: new Date(0).toISOString(),
  ...extra,
});

// 1. 首站必须计入：三场 [60, 80, 100] 的均值是 80，而不是漏掉首站的 90
{
  const s = summarizeHistory([perf(60), perf(80), perf(100)]);
  assert.equal(s.performances, 3);
  assert.equal(s.scoreSum, 240);
  assert.equal(s.average, 80);
  assert.equal(s.averageRounded, 80);
  assert.equal(s.totalIncome, 30);
  assert.deepEqual(s.townIds, ['lantern', 'lantern', 'lantern']);
}

// 2. 单场不按零分：单场 72 分的均值就是 72（旧逻辑 slice(1) 会算成 0）
{
  const s = summarizeHistory([perf(72)]);
  assert.equal(s.performances, 1);
  assert.equal(s.average, 72);
  assert.equal(s.averageRounded, 72);
  assert.equal(endingForAverage(72), '忠于舞台');
}

// 3. 无场次不产生 0 分结论
{
  const s = summarizeHistory([]);
  assert.equal(s.performances, 0);
  assert.equal(s.average, null);
  assert.equal(s.averageRounded, null);
  assert.equal(s.totalIncome, 0);
  assert.equal(endingForAverage(summarizeHistory([]).average ?? 0), '散场之后');
}

// 4. 非数值/脏快照不进分子也不进分母
{
  const s = summarizeHistory([perf(90), { score: 'oops' }, { score: null }, {}, perf(70)]);
  assert.equal(s.performances, 2);
  assert.equal(s.average, 80);
}

// 5. freezeFinale 与 summarizeHistory 完全同口径
{
  const f = freezeFinale([perf(60), perf(80), perf(100)], 'now');
  assert.equal(f.performances, 3);
  assert.equal(f.average, 80);
  assert.equal(f.averageRounded, 80);
  assert.equal(f.ending, '万镇喝彩');
  const single = freezeFinale([perf(54)], 'now');
  assert.equal(single.average, 54);
  assert.equal(single.ending, '散场之后');
}

// 6. 阈值边界
assert.equal(endingForAverage(75), '万镇喝彩');
assert.equal(endingForAverage(74.9), '忠于舞台');
assert.equal(endingForAverage(55), '忠于舞台');
assert.equal(endingForAverage(54.9), '散场之后');

// 7. 迁移：在途旧档回填同口径 stats（首站计入），不生成 finale
{
  const { tours, changed } = migrateTours([
    { id: 'a', status: 'ROUTE_SELECTION', history: [perf(60), perf(80)] },
  ]);
  assert.equal(changed, true);
  const t = tours[0] as any;
  assert.equal(t.stats.performances, 2);
  assert.equal(t.stats.average, 70);
  assert.equal(t.finale, undefined);
}

// 8. 迁移：已 COMPLETED 的旧结局冻结为 legacy，绝不重算
//    旧口径（slice(1)）下 [100, 50] 的均分是 50；新口径应为 75，但旧结局保留
{
  const { tours } = migrateTours([
    {
      id: 'old',
      status: 'COMPLETED',
      history: [perf(100, { townId: 'a' }), perf(50, { townId: 'b' })],
      ending: '散场之后',
    },
  ]);
  const t = tours[0] as any;
  assert.equal(t.finale.legacy, true);
  assert.equal(t.finale.ending, '散场之后');
  // stats 按统一口径正确汇总（首站计入），但结局文本不被改判
  assert.equal(t.stats.average, 75);
  // 迁移幂等：再跑一次不产生变更，legacy 结局原样保留
  const again = migrateTours([t]);
  assert.equal(again.changed, false);
  assert.equal((again.tours[0] as any).finale.ending, '散场之后');
  assert.equal((again.tours[0] as any).finale.legacy, true);
}

// 9. 迁移：已定格 finale 的旧结局也完全不动（哪怕与新口径评级冲突）
{
  const frozen = {
    performances: 1,
    average: 0,
    averageRounded: 0,
    ending: '散场之后',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const { tours } = migrateTours([
    { id: 'frozen', status: 'COMPLETED', history: [perf(90)], finale: frozen },
  ]);
  const t = tours[0] as any;
  assert.deepEqual(t.finale, frozen);
  assert.equal(t.stats.average, 90);
}

// 10. 迁移容错：history 缺失也不崩
{
  const { tours } = migrateTours([{ id: 'x', status: 'INVESTIGATING' }]);
  const t = tours[0] as any;
  assert.deepEqual(t.history, []);
  assert.equal(t.stats.performances, 0);
  assert.equal(t.stats.average, null);
}

console.log('scoring tests passed');
