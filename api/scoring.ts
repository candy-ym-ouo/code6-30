// 终局与统计的统一口径：所有汇总都基于历史中不可变的演出快照，
// 首站计入、单场不误算为零分；已冻结的旧结局只迁移、不重算。

export type PerformanceSnapshot = {
  id?: string;
  townId?: string;
  score?: unknown;
  income?: unknown;
  ending?: number;
  snapshot?: unknown;
  createdAt?: string;
  idempotencyKey?: string;
};

export type FinaleSnapshot = {
  // 终局定格时的历史快照数量与均分，用于说明该结局的口径
  performances: number;
  average: number; // 原始均值，未经四舍五入
  ending: string;
  averageRounded: number;
  createdAt: string;
  // 迁移前已经落幕、但当时没有定格终局的旧结局，标记为旧结局；永远不重算
  legacy?: boolean;
};

export type TourStats = {
  performances: number; // 计入汇总的场次数（首站起算）
  scoreSum: number;
  average: number | null; // 无有效场次时为 null，绝不按 0 分处理
  averageRounded: number | null;
  totalIncome: number;
  townIds: string[];
};

export type ScoredTourLike = {
  history?: unknown;
  stats?: TourStats;
  finale?: FinaleSnapshot;
  status?: string;
  version?: number;
};

// 终局评级的唯一判定入口，保证终局结算、迁移、导出阈值一致
export function endingForAverage(avg: number): string {
  if (avg >= 75) return '万镇喝彩';
  if (avg >= 55) return '忠于舞台';
  return '散场之后';
}

// 从历史快照中取有效分数（数值且有限），其余旧脏数据不计入分子也不计入分母
export function validScores(history: PerformanceSnapshot[]): number[] {
  return history
    .map((x) => (x && typeof x === 'object' ? x.score : NaN))
    .filter((s): s is number => typeof s === 'number' && Number.isFinite(s));
}

// 统一口径汇总：历史快照（首站起算）→ 汇总统计
export function summarizeHistory(history: unknown): TourStats {
  const list: PerformanceSnapshot[] = Array.isArray(history) ? history : [];
  const scores = validScores(list);
  const scoreSum = scores.reduce((n, s) => n + s, 0);
  const totalIncome = list.reduce(
    (n, x) => n + (typeof x.income === 'number' && Number.isFinite(x.income) ? x.income : 0),
    0,
  );
  return {
    performances: scores.length,
    scoreSum,
    // 分母为实际计入的场次数；单场时均值就是该场分数，而不是 0
    average: scores.length ? scoreSum / scores.length : null,
    averageRounded: scores.length ? Math.round(scoreSum / scores.length) : null,
    totalIncome,
    townIds: list.map((x) => (typeof x.townId === 'string' ? x.townId : '')).filter(Boolean),
  };
}

// 终局定格：与 summarizeHistory 完全同口径，额外生成评级并冻结
export function freezeFinale(history: unknown[], now: string): FinaleSnapshot {
  const stats = summarizeHistory(history);
  const average = stats.average ?? 0;
  return {
    performances: stats.performances,
    average,
    averageRounded: stats.averageRounded ?? 0,
    ending: endingForAverage(average),
    createdAt: now,
  };
}

// 迁移旧存档：补齐结构、按统一口径回填汇总统计；已落幕的旧结局冻结保留，绝不重算
export function migrateTour(input: unknown): { tour: ScoredTourLike; changed: boolean } {
  const t: ScoredTourLike =
    input && typeof input === 'object' ? (input as ScoredTourLike) : {};
  let changed = false;

  if (!Array.isArray(t.history)) {
    (t as { history: unknown[] }).history = [];
    changed = true;
  }

  // 统计始终按历史快照同口径重算（历史快照本身不可变），保证三处口径一致
  const stats = summarizeHistory(t.history);
  const before = t.stats;
  if (
    !before ||
    before.performances !== stats.performances ||
    before.scoreSum !== stats.scoreSum ||
    before.average !== stats.average ||
    before.averageRounded !== stats.averageRounded ||
    before.totalIncome !== stats.totalIncome ||
    JSON.stringify(before.townIds) !== JSON.stringify(stats.townIds)
  ) {
    t.stats = stats;
    changed = true;
  }

  // 旧结局不重算：
  // - 已定格 finale：原样保留（含旧口径产生的结果），不覆盖
  // - 已 COMPLETED 但无定格的更旧存档：冻结一个 legacy 标记占位，之后永不重算
  if (t.status === 'COMPLETED' && !t.finale) {
    const oldEnding =
      typeof (t as { ending?: unknown }).ending === 'string'
        ? ((t as { ending?: string }).ending as string)
        : '旧档结局';
    t.finale = {
      performances: stats.performances,
      average: stats.average ?? 0,
      averageRounded: stats.averageRounded ?? 0,
      ending: oldEnding,
      createdAt: new Date(0).toISOString(),
      legacy: true,
    };
    changed = true;
  }

  if (typeof t.version !== 'number') {
    t.version = 1;
    changed = true;
  }

  return { tour: t, changed };
}

export function migrateTours(input: unknown): { tours: ScoredTourLike[]; changed: boolean } {
  const raw = Array.isArray(input) ? input : [];
  let changed = false;
  const tours = raw.map((x) => {
    const r = migrateTour(x);
    changed = changed || r.changed;
    return r.tour;
  });
  return { tours, changed };
}
