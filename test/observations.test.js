import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendObservations, observationFromRecord } from '../src/observations.js';
import { ObservationLog } from '../src/observation-log.js';

const record = (sourceId, observedAt, attributes = {}) => ({
  sourceId,
  source: '渠道价格采集目录',
  observedAt,
  label: 'K1',
  attributes: {
    offerId: sourceId, shop: 'a', sku: 'K1', amount: '120.00', currency: 'CNY',
    taxIncluded: true, shipping: '8.00', observedAt, ruleVersion: 'tax-1', ...attributes,
  },
});

test('观察保留来源明示的价格组成、币种与观察时间', () => {
  const observation = observationFromRecord(record('A-1', '2026-11-16T08:00:00Z'), '2026-11-16T10:00:00Z');
  assert.equal(observation.key, 'A-1#2026-11-16T08:00:00Z');
  assert.deepEqual(observation.components, {
    amount: '120.00', currency: 'CNY', taxIncluded: true, shipping: '8.00',
  });
  assert.equal(observation.observedAt, '2026-11-16T08:00:00Z');
  assert.equal(observation.attributes.ruleVersion, 'tax-1');
});

test('来源未写明的组成保留为未知而不是零', () => {
  const observation = observationFromRecord(
    record('A-1', '2026-11-16T09:00:00Z', { taxIncluded: null, shipping: null }),
    '2026-11-16T10:00:00Z',
  );
  assert.equal(observation.components.taxIncluded, null);
  assert.equal(observation.components.shipping, null);
});

test('追加幂等：重放同一观察不重复，较旧观察与较新观察并存', () => {
  const older = observationFromRecord(record('A-1', '2026-11-16T08:00:00Z'), '2026-11-16T10:00:00Z');
  const newer = observationFromRecord(record('A-1', '2026-11-16T09:00:00Z'), '2026-11-16T10:05:00Z');
  const first = appendObservations([], [newer]);
  assert.equal(first.added.length, 1);
  const replayed = appendObservations(first.observations, [newer]);
  assert.equal(replayed.added.length, 0);
  assert.equal(replayed.conflicts.length, 0);
  const withOlder = appendObservations(replayed.observations, [older]);
  assert.equal(withOlder.added.length, 1, '重抓到的旧页面作为历史观察保留');
  assert.deepEqual(withOlder.observations.map((o) => o.observedAt), ['2026-11-16T08:00:00Z', '2026-11-16T09:00:00Z']);
});

test('同键不同内容记为冲突并保留原观察', () => {
  const original = observationFromRecord(record('A-1', '2026-11-16T08:00:00Z'), '2026-11-16T10:00:00Z');
  const restated = observationFromRecord(
    record('A-1', '2026-11-16T08:00:00Z', { amount: '119.00' }),
    '2026-11-16T11:00:00Z',
  );
  const { observations, conflicts } = appendObservations([original], [restated]);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].components.amount, '120.00', '原观察不被静默改写');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].key, 'A-1#2026-11-16T08:00:00Z');
  assert.equal(conflicts[0].rejected.components.amount, '119.00');
});

test('观察日志落库后重开一致，冲突留痕可审计', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'observation-log-'));
  try {
    const path = join(directory, 'observations.json');
    const log = new ObservationLog(path);
    const first = await log.append([record('A-1', '2026-11-16T08:00:00Z')], { now: '2026-11-16T10:00:00Z' });
    assert.equal(first.added, 1);
    const replay = await log.append([record('A-1', '2026-11-16T08:00:00Z')], { now: '2026-11-16T10:01:00Z' });
    assert.equal(replay.added, 0);
    const conflict = await log.append(
      [record('A-1', '2026-11-16T08:00:00Z', { shipping: null })],
      { now: '2026-11-16T10:02:00Z' },
    );
    assert.deepEqual(conflict.conflicts, ['A-1#2026-11-16T08:00:00Z']);
    const reopened = new ObservationLog(path);
    const observations = await reopened.read();
    assert.equal(observations.length, 1);
    assert.equal(observations[0].components.shipping, '8.00');
    const summary = await reopened.summary();
    assert.deepEqual(summary, { total: 1, bySourceId: { 'A-1': 1 }, conflicts: 1 });
    assert.equal((await reopened.conflicts())[0].rejected.components.shipping, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
