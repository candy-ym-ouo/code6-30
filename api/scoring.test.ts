import assert from 'node:assert/strict';
import { buildFinaleSnapshot, endingForAverage, legacyBuggyAverage, migrateTour, summarizeHistory } from './scoring.js';

const h = (...scores:number[]) => scores.map((score, i) => ({ id: `p${i}`, townId: `town${i}`, score, income: 10 }));

// 修复点一：首站必须计入终局均分。
{
  const s = summarizeHistory(h(100, 50, 60));
  assert.equal(s.performanceCount, 3, '全部三场（含首站）都应纳入统计');
  assert.equal(s.average, 70, '均分应为三场的平均，而非漏掉首站后的 55');
  assert.equal(s.rawAverage, 70);
}

// 修复点二：只有一场演出时按该场分数结算，不再按零分。
{
  const single = summarizeHistory(h(90));
  assert.equal(single.performanceCount, 1);
  assert.equal(single.average, 90, '单场巡演均分应等于该场得分');
  const finale = buildFinaleSnapshot(h(90), 'now');
  assert.equal(finale.ending, '万镇喝彩', '单场 90 分应得到“万镇喝彩”，旧逻辑会误判为“散场之后”');
  assert.equal(finale.performanceCount, 1);
  assert.deepEqual(finale.includedTownIds, ['town0']);
}

// 空历史（理论上不会进入终局）按零分而不是 NaN。
{
  const empty = summarizeHistory([]);
  assert.equal(empty.performanceCount, 0);
  assert.equal(empty.average, 0);
  assert.equal(endingForAverage(empty.rawAverage), '散场之后');
}

// 阈值边界仍按未四舍五入的真实均分判定。
assert.equal(endingForAverage(74.6), '忠于舞台');
assert.equal(endingForAverage(75), '万镇喝彩');
assert.equal(endingForAverage(54.6), '散场之后');
assert.equal(endingForAverage(55), '忠于舞台');

// 旧算法复现：漏算首站，且单场按零分（仅供迁移还原）。
assert.equal(legacyBuggyAverage(h(100, 50, 60)), 55);
assert.equal(legacyBuggyAverage(h(90)), 0);

// 旧档迁移：已完成的旧结局按旧口径冻结，标记 legacy，且不被新公式重算。
{
  const legacyTour:any = {
    version: 1,
    status: 'COMPLETED',
    history: h(100, 50, 60),
  };
  migrateTour(legacyTour);
  assert.equal(legacyTour.version, 2);
  assert.ok(legacyTour.finale, '迁移后应冻结终局快照');
  assert.equal(legacyTour.finale.average, 55, '旧结局保持旧口径（漏算首站）');
  assert.equal(legacyTour.finale.ending, '忠于舞台');
  assert.equal(legacyTour.finale.legacy, true);
  assert.equal(legacyTour.finale.performanceCount, 2);
  assert.deepEqual(legacyTour.finale.includedTownIds, ['town1', 'town2']);

  // 单场旧档：迁移时仍按旧口径冻结为零分，而不是按新逻辑改成 90。
  const singleLegacy:any = { version: 1, status: 'COMPLETED', history: h(90) };
  migrateTour(singleLegacy);
  assert.equal(singleLegacy.finale.average, 0);
  assert.equal(singleLegacy.finale.ending, '散场之后');
  assert.equal(singleLegacy.finale.legacy, true);

  // 迁移幂等：再次迁移不得改动冻结结果。
  const frozenAt = legacyTour.finale.createdAt;
  migrateTour(legacyTour);
  assert.equal(legacyTour.finale.createdAt, frozenAt);
  assert.equal(legacyTour.finale.average, 55);

  // 未完成旧档：仅升级版本，不凭空生成终局。
  const active:any = { version: 1, status: 'ROUTE_SELECTION', history: h(100) };
  migrateTour(active);
  assert.equal(active.version, 2);
  assert.equal(active.finale, undefined);

  // 已经带冻结快照的完成档：版本升级且快照原样保留。
  const done:any = { version: 1, status: 'COMPLETED', history: h(1, 1), finale: buildFinaleSnapshot(h(80), 'then') };
  migrateTour(done);
  assert.equal(done.finale.average, 80);
  assert.equal(done.finale.legacy, undefined);

  // v2 存档不动。
  const v2:any = { version: 2, status: 'FINALE_READY', history: h(60) };
  migrateTour(v2);
  assert.equal(v2.version, 2);
  assert.equal(v2.finale, undefined);
}

console.log('scoring tests passed');
