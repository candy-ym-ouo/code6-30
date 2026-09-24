// 终局与导出的统一汇总口径。
// 历史快照（history 中的每场演出）是唯一数据源：
// 终局冻结、旧档迁移、导出统计都必须经由本模块的同一组函数汇总，
// 避免再出现“漏算首站”或“单场按零分”这类各路口径不一致的问题。

export type PerformanceRecord = { score?:number; townId?:string; income?:number; [key:string]:unknown };

export type EndingTitle = '万镇喝彩' | '忠于舞台' | '散场之后';

export type HistorySummary = {
  // 纳入统计的演出快照场次（首站同样计入；为空时整体均分按 0）
  performanceCount:number;
  // 未四舍五入的均分，供结局阈值判定，保证阈值边界与历史行为一致
  rawAverage:number;
  // 对外展示/冻结的均分口径：对真实均值四舍五入
  average:number;
};

// 终局一旦结算即冻结进存档的快照，旧结局永不被新代码重算。
export type FinaleSnapshot = {
  ending:EndingTitle;
  average:number;
  performanceCount:number;
  includedTownIds:string[];
  createdAt:string;
  // 由 v1 旧档迁移而来：当时的结局按旧口径（漏算首站、单场按零）还原冻结
  legacy?:boolean;
};

export const CURRENT_TOUR_VERSION = 2;

type VersionedTour = {
  version?:number;
  status?:string;
  history?:PerformanceRecord[];
  finale?:FinaleSnapshot;
};

// 同口径汇总：对全部演出快照（含首站）求算术平均，空历史按 0 分。
export function summarizeHistory(history:PerformanceRecord[]|undefined):HistorySummary {
  const scored = Array.isArray(history)
    ? history.filter((h):h is PerformanceRecord => !!h && typeof h.score === 'number')
    : [];
  const performanceCount = scored.length;
  const rawAverage = performanceCount === 0 ? 0 : scored.reduce((sum, h) => sum + (h.score as number), 0) / performanceCount;
  return { performanceCount, rawAverage, average: Math.round(rawAverage) };
}

export function endingForAverage(rawAverage:number):EndingTitle {
  return rawAverage >= 75 ? '万镇喝彩' : rawAverage >= 55 ? '忠于舞台' : '散场之后';
}

// 仅供迁移旧档：原样复刻 v1 的终局算法（history.slice(1) 漏掉首站，
// 且历史不足两场时分母仍为 1，导致只有一场时均分按 0）。
// 任何新结算都不允许调用本函数。
export function legacyBuggyAverage(history:PerformanceRecord[]|undefined):number {
  const list = Array.isArray(history) ? history : [];
  return list.slice(1).reduce((sum, x) => sum + (typeof x?.score === 'number' ? x.score : 0), 0) / Math.max(1, list.length - 1);
}

// 新终局结算：基于全部历史快照（含首站）生成一次性冻结的结局。
export function buildFinaleSnapshot(history:PerformanceRecord[]|undefined, createdAt:string):FinaleSnapshot {
  const summary = summarizeHistory(history);
  const included = Array.isArray(history)
    ? history.filter(h => h && typeof h.score === 'number').map(h => String(h.townId ?? ''))
    : [];
  return {
    ending: endingForAverage(summary.rawAverage),
    average: summary.average,
    performanceCount: summary.performanceCount,
    includedTownIds: included,
    createdAt,
  };
}

// 旧档迁移：已完成的旧档按当时的旧口径还原结局并冻结，绝不按新公式重算；
// 其余存档只升级版本号。迁移是幂等的。
export function migrateTour<T extends VersionedTour>(tour:T):T {
  if ((tour.version ?? 1) >= CURRENT_TOUR_VERSION) return tour;
  if (tour.status === 'COMPLETED' && !tour.finale) {
    const legacyRaw = legacyBuggyAverage(tour.history);
    const included = Array.isArray(tour.history)
      ? tour.history.slice(1).filter(h => h && typeof h.score === 'number').map(h => String(h.townId ?? ''))
      : [];
    tour.finale = {
      ending: endingForAverage(legacyRaw),
      average: Math.round(legacyRaw),
      performanceCount: included.length,
      includedTownIds: included,
      createdAt: new Date().toISOString(),
      legacy: true,
    };
  }
  tour.version = CURRENT_TOUR_VERSION;
  return tour;
}
