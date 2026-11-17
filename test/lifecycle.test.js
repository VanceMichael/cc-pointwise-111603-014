import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordRepository } from '../src/repository.js';
import { ObservationRepository } from '../src/observations.js';
import { ComparisonRepository } from '../src/comparisons.js';
import { RuleRepository } from '../src/rule-repository.js';
import { RuleRegistry } from '../src/rules.js';
import { CollectionService } from '../src/service.js';
import { observationFromRecord } from '../src/observation-builder.js';

const rules = [
  { version: 'tax-1', effectiveFrom: '2026-01-01', taxRate: '0.06' },
  { version: 'tax-2', effectiveFrom: '2026-11-16', taxRate: '0.09' },
];

function record(overrides = {}) {
  return {
    sourceId: 'A-1',
    source: '渠道价格采集目录',
    observedAt: '2026-11-16T08:00:00Z',
    label: 'K1',
    attributes: {
      offerId: 'A-1', shop: 'a', sku: 'K1',
      amount: '120.00', currency: 'CNY', taxIncluded: true, shipping: '8.00',
      observedAt: '2026-11-16T08:00:00Z', ruleVersion: 'tax-1',
      ...overrides,
    },
  };
}

async function harness(clock) {
  const directory = await mkdtemp(join(tmpdir(), 'lifecycle-'));
  const service = new CollectionService(new RecordRepository(join(directory, 'records.json')), {
    observations: new ObservationRepository(join(directory, 'observations.json')),
    comparisons: new ComparisonRepository(join(directory, 'comparisons.json')),
    ruleRegistry: new RuleRegistry(new RuleRepository(join(directory, 'rules.json'))),
    clock,
  });
  return { directory, service };
}

test('ingest appends immutable observations and keeps source price components as given', async () => {
  const { directory, service } = await harness();
  try {
    await service.ingest([record()]);
    const observations = await service.listObservations();
    assert.equal(observations.length, 1);
    assert.deepEqual(observations[0].price, {
      amount: '120.00', currency: 'CNY', taxIncluded: true, shipping: '8.00',
    });
    assert.equal(observations[0].sourceRuleVersion, 'tax-1');
    assert.equal(observations[0].raw.shipping, '8.00', '原始来源属性完整保留');

    // 相同内容再次采集：observationId 相同，不追加、不改写。
    const again = await service.ingest([record()]);
    assert.equal(again.observations.added, 0);
    assert.equal((await service.listObservations()).length, 1);

    // 来源改版（观察时间与口径变化）：追加新观察，旧观察保持原样。
    await service.ingest([record({
      observedAt: '2026-11-16T09:00:00Z', taxIncluded: null, shipping: null, ruleVersion: 'tax-2',
    })]);
    const both = await service.listObservations();
    assert.equal(both.length, 2);
    assert.deepEqual(both[0].price.shipping, '8.00');
    assert.equal(both[1].price.shipping, null);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('published comparison stays traceable after rule upgrade and source re-crawl', async () => {
  let tick = 0;
  const clock = () => new Date(Date.parse('2026-11-16T10:00:00Z') + tick++ * 1000).toISOString();
  const { directory, service } = await harness(clock);
  try {
    await service.registerRules(rules);
    await service.ingest([record()]);
    const firstObservation = (await service.listObservations())[0];
    const published = await service.compare([firstObservation.observationId]);
    assert.equal(published.status, 'comparable');
    const originalComponents = structuredClone(published.evaluations[0].components);
    const originalRule = structuredClone(published.comparison.rule);

    // 规则升级（新版本生效）后重抓同一页面：历史比较文件内容不变。
    await service.registerRules([{ version: 'tax-3', effectiveFrom: '2026-11-17', taxRate: '0.12' }]);
    await service.ingest([record()]);
    const history = await service.listComparisons();
    const stored = history.find((item) => item.comparisonId === published.comparisonId);
    assert.equal(stored.status, 'comparable');
    assert.deepEqual(stored.evaluations[0].components, originalComponents);
    assert.deepEqual(stored.rule, originalRule, '历史结论固化当时规则快照');
    assert.equal(stored.supersededBy, undefined);

    // 只有明确发起的重算才采用新口径，并保留取代链。
    const recalculated = await service.recalculate(published.comparisonId, { ruleVersion: 'tax-3' });
    assert.equal(recalculated.comparison.kind, 'recalculation');
    assert.equal(recalculated.comparison.rule.version, 'tax-3');
    assert.notEqual(recalculated.evaluations[0].components.taxAmount, originalComponents.taxAmount);
    const after = await service.listComparisons();
    const oldOne = after.find((item) => item.comparisonId === published.comparisonId);
    assert.equal(oldOne.supersededBy, recalculated.comparisonId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('recalculation by reference time picks the newly effective rule', async () => {
  const { directory, service } = await harness();
  try {
    await service.registerRules(rules);
    await service.ingest([record()]);
    const observation = (await service.listObservations())[0];
    const first = await service.compare([observation.observationId]);
    const redone = await service.recalculate(first.comparisonId, { at: '2025-06-01T00:00:00Z' });
    // 2025 年没有生效规则，应明确失败而不是退回任意版本。
    assert.fail(`expected failure, got ${redone.comparisonId}`);
  } catch (error) {
    assert.match(error.message, /no rule is effective/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('observation identity changes when any source price component changes', () => {
  const baseline = observationFromRecord(record(), '2026-11-16T10:00:00Z');
  const changedShipping = observationFromRecord(record({ shipping: '9.00' }), '2026-11-16T10:00:00Z');
  assert.notEqual(baseline.observationId, changedShipping.observationId);
  const rebuilt = observationFromRecord(record(), '2026-11-16T10:00:00Z');
  assert.equal(baseline.observationId, rebuilt.observationId, '相同输入重建得到相同标识');
});

test('compare rejects unknown observations and service without lifecycle storage', async () => {
  const legacy = new CollectionService(new RecordRepository(join((await mkdtemp(join(tmpdir(), 'legacy-'))), 'records.json')));
  await assert.rejects(legacy.compare(['obs-x']), /lifecycle storage/);
  const { directory, service } = await harness();
  try {
    await service.registerRules(rules);
    await assert.rejects(service.compare(['obs-missing']), /unknown observations/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
