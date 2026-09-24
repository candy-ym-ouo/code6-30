import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'tours-'));

const actor = { id: 'mei', name: '梅枝', role: '牵线师', precision: 8, acting: 6, improvisation: 5, stamina: 78, trait: '', bio: '', level: 1, xp: 0, fatigue: 0 };
const perf = (townId: string, score: number, income = 10) => ({
  id: randomUUID(), townId, score, income, feedback: '', ending: 0,
  snapshot: { playId: 'moon', assignments: {}, timeline: [], endings: [0, 0, 0] },
  createdAt: new Date().toISOString(),
});
const baseTour = (over: Record<string, unknown>) => ({
  id: randomUUID(), name: '旧档剧团', seed: 1, townIds: ['lantern', 'reed', 'stone', 'moss', 'paper', 'well'],
  stopIndex: 0, funds: 420, reputation: 50, inspiration: 3, version: 1,
  actors: [{ ...actor }], visited: [], clues: {}, history: [], unlocked: [], ...over,
});

async function startServer(initial: unknown) {
  const file = join(dir, `data-${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify(initial ?? []));
  process.env.TOUR_DATA_FILE = file;
  const mod: any = await import(`./server.js?boot=${randomUUID()}`);
  const server: Server = await new Promise((resolve) => {
    const s = mod.app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
      method,
      headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  const stop = async () => { await new Promise((r) => server.close(r)); await new Promise((r) => setTimeout(r, 200)); };
  return { call, stop, file };
}

// —— 场景一：真实走完一场演出，三处口径一致；终局对单场不误算零分 ——
{
  const { call, stop } = await startServer([]);
  try {
    const created = await call('POST', '/tours', { name: '单场剧团' });
    const id = created.body.tour.id;

    await call('POST', `/tours/${id}/investigations`, { kind: 'market' });
    const draft = {
      playId: 'moon',
      assignments: { mei: 'main' },
      timeline: [{ actionId: 'enter', actorIds: ['mei'], act: 0, slot: 0 }],
      endings: [0, 0, 0],
    };
    const v = await call('POST', `/tours/${id}/production/validate`, draft);
    assert.equal(v.body.valid, true, JSON.stringify(v.body));
    await call('PUT', `/tours/${id}/production`, draft);
    const performed = await call('POST', `/tours/${id}/performances`, draft, { 'Idempotency-Key': randomUUID() });
    assert.equal(performed.status, 200);
    const score = performed.body.performance.score;
    assert.ok(score > 0);

    // 演出后 tour.stats 已按历史快照刷新：单场均分 = 该场分数，不是 0
    assert.equal(performed.body.tour.stats.performances, 1);
    assert.equal(performed.body.tour.stats.average, score);
    assert.equal(performed.body.tour.stats.averageRounded, score);

    // 历史快照接口同口径
    const hist = await call('GET', `/tours/${id}/history`);
    assert.equal(hist.body.stats.performances, 1);
    assert.equal(hist.body.stats.average, score);

    // 导出接口同口径
    const exported = await call('GET', `/tours/${id}/export`);
    assert.equal(exported.body.stats.performances, 1);
    assert.equal(exported.body.stats.average, score);
    assert.equal(exported.body.stats.totalIncome, performed.body.performance.income);
    assert.deepEqual(exported.body.history.length, 1);
    assert.equal(exported.body.finale, null);
  } finally {
    await stop();
  }
}

// —— 场景二：只演过一场就抵达终局（迁移构造的 FINALE_READY 档），终局均分不得为 0 ——
{
  const tour = baseTour({
    status: 'FINALE_READY',
    stopIndex: 5,
    history: [perf('lantern', 72)],
    visited: ['lantern'],
  });
  const { call, stop } = await startServer([tour]);
  try {
    const fin = await call('POST', `/tours/${(tour as any).id}/finale`);
    assert.equal(fin.status, 200);
    assert.equal(fin.body.average, 72, '单场终局均分必须是 72，旧逻辑为 0');
    assert.equal(fin.body.ending, '忠于舞台');
    assert.equal(fin.body.legacy, undefined);

    // 旧结局/已定格结局不重算：重复调用只回放
    const replay = await call('POST', `/tours/${(tour as any).id}/finale`);
    assert.equal(replay.body.replayed, true);
    assert.equal(replay.body.average, 72);
    assert.equal(replay.body.ending, '忠于舞台');
  } finally {
    await stop();
  }
}

// —— 场景三：旧结局迁移档不被重算，统计仍是统一口径 ——
{
  // 旧口径 slice(1) 会把 [100, 50] 算成 50 -> 散场之后；新口径是 75
  const tour = baseTour({
    status: 'COMPLETED',
    stopIndex: 5,
    history: [perf('lantern', 100, 20), perf('reed', 50, 5)],
    visited: ['lantern', 'reed'],
    ending: '散场之后',
  });
  const { call, stop, file } = await startServer([tour]);
  try {
    // 加载时迁移已冻结旧结局
    const persisted = JSON.parse(readFileSync(file, 'utf8'))[0];
    assert.equal(persisted.finale.legacy, true);
    assert.equal(persisted.finale.ending, '散场之后');
    assert.equal(persisted.stats.average, 75); // 统计按新口径（首站计入）

    const got = await call('GET', `/tours/${(tour as any).id}`);
    assert.equal(got.body.tour.finale.legacy, true);
    assert.equal(got.body.tour.finale.ending, '散场之后');
    assert.equal(got.body.tour.stats.average, 75);

    // 终局接口对旧结局只回放、不重算
    const fin = await call('POST', `/tours/${(tour as any).id}/finale`);
    assert.equal(fin.body.replayed, true);
    assert.equal(fin.body.legacy, true);
    assert.equal(fin.body.ending, '散场之后');
    assert.equal(fin.body.average, 75); // 定格中回填的同口径均分

    // 导出台账：同口径统计 + 冻结的旧结局
    const exported = await call('GET', `/tours/${(tour as any).id}/export`);
    assert.equal(exported.body.stats.performances, 2);
    assert.equal(exported.body.stats.average, 75);
    assert.equal(exported.body.stats.scoreSum, 150);
    assert.equal(exported.body.stats.totalIncome, 25);
    assert.equal(exported.body.finale.legacy, true);
    assert.equal(exported.body.finale.ending, '散场之后');
    assert.equal(exported.body.history[0].score, 100);
  } finally {
    await stop();
  }
}

console.log('server integration tests passed');
