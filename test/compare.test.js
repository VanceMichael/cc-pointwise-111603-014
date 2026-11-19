import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildComparison, comparisonDefinition, normalizeQuote } from '../src/compare.js';
import { normalizeRules } from '../src/rules.js';
import { observationFromRecord } from '../src/observations.js';
import { ObservationLog } from '../src/observation-log.js';
import { ComparisonStore } from '../src/comparison-store.js';
import { RuleBook } from '../src/rule-book.js';
import { ComparisonService } from '../src/comparison-service.js';

const rules = normalizeRules([
  { version: 'tax-1', effectiveFrom: '2026-01-01', taxRate: '0.06' },
  { version: 'tax-2', effectiveFrom: '2026-11-16', taxRate: '0.09' },
]);
const tax2 = rules[1];

test('来源明示完整的报价形成到手价：未含税按生效规则补税', () => {
  const result = normalizeQuote(
    { amount: '115.00', currency: 'CNY', taxIncluded: false, shipping: '0.00' },
    tax2,
  );
  assert.equal(result.comparable, true);
  assert.equal(result.total, '125.35');
  assert.deepEqual(result.breakdown, {
    amount: '115.00', tax: '10.35', shipping: '0.00', taxHandling: 'added',
  });
});

test('含税报价不重复计税，运费以来源明示为准', () => {
  const result = normalizeQuote(
    { amount: '120.00', currency: 'CNY', taxIncluded: true, shipping: '8.00' },
    tax2,
  );
  assert.equal(result.total, '128.00');
  assert.equal(result.breakdown.tax, '0.00');
  assert.equal(result.breakdown.taxHandling, 'included');
});

test('税费口径未知与运费未知都解释原因，绝不补默认零运费', () => {
  const result = normalizeQuote(
    { amount: '120.00', currency: 'CNY', taxIncluded: null, shipping: null },
    tax2,
  );
  assert.equal(result.comparable, false);
  assert.equal(result.total, null);
  assert.equal(result.breakdown, null);
  assert.deepEqual(result.reasons.map((r) => r.code).sort(), ['shipping-unknown', 'tax-unknown']);
  assert.match(result.reasons.find((r) => r.code === 'shipping-unknown').message, /不能按零运费/);
});

test('金额或币种缺失、格式非法都给出对应原因', () => {
  const missing = normalizeQuote({ amount: null, currency: null, taxIncluded: true, shipping: '0.00' }, tax2);
  assert.deepEqual(missing.reasons.map((r) => r.code).sort(), ['amount-missing', 'currency-missing']);
  const invalid = normalizeQuote({ amount: 120, currency: 'CNY', taxIncluded: 'yes', shipping: 'free' }, tax2);
  assert.deepEqual(invalid.reasons.map((r) => r.code).sort(), ['amount-invalid', 'shipping-invalid', 'tax-flag-invalid']);
});

test('未含税报价在观察时间无生效规则时说明原因', () => {
  const result = normalizeQuote(
    { amount: '100.00', currency: 'CNY', taxIncluded: false, shipping: '0.00' },
    null,
  );
  assert.equal(result.comparable, false);
  assert.deepEqual(result.reasons.map((r) => r.code), ['no-effective-rule']);
});

const record = (sourceId, observedAt, attributes = {}) => ({
  sourceId,
  source: '渠道价格采集目录',
  observedAt,
  label: 'K1',
  attributes: {
    offerId: sourceId, shop: sourceId.slice(0, 1).toLowerCase(), sku: 'K1',
    amount: '120.00', currency: 'CNY', taxIncluded: true, shipping: '8.00',
    observedAt, ruleVersion: 'tax-1', ...attributes,
  },
});

test('比较按 sourceId 取最新观察，到手价升序排列并给出最优', () => {
  const observations = [
    observationFromRecord(record('A-1', '2026-11-16T08:00:00Z'), '2026-11-16T10:00:00Z'),
    observationFromRecord(record('B-1', '2026-11-16T08:05:00Z', {
      amount: '115.00', taxIncluded: false, shipping: '0.00', ruleVersion: 'tax-2',
    }), '2026-11-16T10:00:00Z'),
    observationFromRecord(record('B-1', '2026-11-16T07:00:00Z', {
      amount: '999.00', taxIncluded: true, shipping: '0.00',
    }), '2026-11-16T09:00:00Z'),
  ];
  const comparison = buildComparison({ sku: 'K1', observations, rules, generatedAt: '2026-11-16T10:30:00Z' });
  assert.deepEqual(comparison.quotes.map((q) => [q.observation.sourceId, q.total]), [['B-1', '125.35'], ['A-1', '128.00']]);
  assert.equal(comparison.quotes[0].observation.observedAt, '2026-11-16T08:05:00Z', '同一报价取最新观察');
  assert.deepEqual(comparison.summary.best, { sourceId: 'B-1', total: '125.35', currency: 'CNY' });
  assert.equal(comparison.definition, comparisonDefinition);
});

test('组内币种不一致时不直接比较', () => {
  const observations = [
    observationFromRecord(record('A-1', '2026-11-16T08:00:00Z'), 't'),
    observationFromRecord(record('C-1', '2026-11-16T08:00:00Z', { currency: 'USD' }), 't'),
  ];
  const comparison = buildComparison({ sku: 'K1', observations, rules, generatedAt: 't' });
  assert.equal(comparison.summary.best, null);
  assert.match(comparison.summary.note, /币种不一致/);
});

async function fixtureService(directory, rulesContent) {
  const rulesPath = join(directory, 'rules.json');
  await writeFile(rulesPath, JSON.stringify(rulesContent));
  const observations = new ObservationLog(join(directory, 'observations.json'));
  const comparisons = new ComparisonStore(join(directory, 'comparisons.json'));
  const service = new ComparisonService({ observations, rules: new RuleBook(rulesPath), comparisons });
  return { service, observations, comparisons, rulesPath };
}

test('发布后不可变：规则升级、新观察与重抓旧页面都不让历史结论无声改变', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'comparison-lifecycle-'));
  try {
    const { service, observations, comparisons, rulesPath } = await fixtureService(directory, [
      { version: 'tax-1', effectiveFrom: '2026-01-01', taxRate: '0.06' },
      { version: 'tax-2', effectiveFrom: '2026-11-16', taxRate: '0.09' },
    ]);
    await observations.append([record('B-1', '2026-11-16T08:05:00Z', {
      amount: '115.00', taxIncluded: false, shipping: '0.00', ruleVersion: 'tax-2',
    })], { now: '2026-11-16T10:00:00Z' });
    const published = await service.publish('K1', { now: '2026-11-16T10:00:00Z' });
    assert.equal(published.id, 'cmp-0001');
    assert.equal(published.quotes[0].total, '125.35');
    assert.equal(published.quotes[0].rule.version, 'tax-2', '发布内嵌当时的规则快照');

    // 规则升级：追加 tax-3。新观察按新口径解析。
    await writeFile(rulesPath, JSON.stringify([
      { version: 'tax-1', effectiveFrom: '2026-01-01', taxRate: '0.06' },
      { version: 'tax-2', effectiveFrom: '2026-11-16', taxRate: '0.09' },
      { version: 'tax-3', effectiveFrom: '2026-11-17', taxRate: '0.13' },
    ]));
    await observations.append([record('B-1', '2026-11-17T08:05:00Z', {
      amount: '115.00', taxIncluded: false, shipping: '0.00', ruleVersion: 'tax-3',
    })], { now: '2026-11-17T10:00:00Z' });
    const candidate = await service.compare('K1', { now: '2026-11-17T10:00:00Z' });
    assert.equal(candidate.quotes[0].rule.version, 'tax-3', '新观察采用新口径');
    assert.equal(candidate.quotes[0].total, '129.95');
    assert.deepEqual(await comparisons.read(), [published], '候选比较不改写已发布结论');

    // 明确发起的重算生成新版本；历史版本保持原报价与当时的规则。
    const recomputed = await service.recompute('cmp-0001', { now: '2026-11-17T11:00:00Z' });
    assert.equal(recomputed.id, 'cmp-0002');
    assert.equal(recomputed.supersedes, 'cmp-0001');
    assert.equal(recomputed.quotes[0].rule.version, 'tax-3');
    const history = await comparisons.read();
    assert.equal(history.length, 2);
    assert.deepEqual(history[0], published, '历史比较仍可追到原报价与当时的规则');
    assert.equal(history[0].quotes[0].observation.observedAt, '2026-11-16T08:05:00Z');

    // 重抓旧页面：同键观察幂等，内容不同记冲突，已发布结论不变。
    const rescrape = await observations.append([record('B-1', '2026-11-16T08:05:00Z', {
      amount: '115.00', taxIncluded: false, shipping: '0.00', ruleVersion: 'tax-2',
    })], { now: '2026-11-17T12:00:00Z' });
    assert.equal(rescrape.added, 0);
    const restated = await observations.append([record('B-1', '2026-11-16T08:05:00Z', {
      amount: '110.00', taxIncluded: false, shipping: '0.00', ruleVersion: 'tax-2',
    })], { now: '2026-11-17T12:05:00Z' });
    assert.deepEqual(restated.conflicts, ['B-1#2026-11-16T08:05:00Z']);
    assert.deepEqual(await comparisons.read(), history, '重抓旧页面不改变已发布结论');
    const kept = (await observations.read()).find((o) => o.key === 'B-1#2026-11-16T08:05:00Z');
    assert.equal(kept.components.amount, '115.00', '冲突观察保留原内容');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('重算未知比较与缺少 sku 都明确报错', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'comparison-errors-'));
  try {
    const { service } = await fixtureService(directory, [
      { version: 'tax-1', effectiveFrom: '2026-01-01', taxRate: '0.06' },
    ]);
    await assert.rejects(service.recompute('cmp-9999'), /unknown comparison/);
    await assert.rejects(service.compare(''), /requires a sku/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
