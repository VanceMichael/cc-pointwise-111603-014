import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRanges, normalizeRules, ruleForInstant } from '../src/rules.js';

const inputs = [
  { version: 'tax-2', effectiveFrom: '2026-11-16', taxRate: '0.09' },
  { version: 'tax-1', effectiveFrom: '2026-01-01', taxRate: '0.06' },
];

test('规则按生效时间排序并校验版本、日期与税率', () => {
  const rules = normalizeRules(inputs);
  assert.deepEqual(rules.map((rule) => rule.version), ['tax-1', 'tax-2']);
  assert.equal(rules[0].effectiveFrom, '2026-01-01T00:00:00.000Z');
  assert.throws(() => normalizeRules([{ version: '', effectiveFrom: '2026-01-01', taxRate: '0.06' }]), /missing version/);
  assert.throws(() => normalizeRules([{ version: 'x', effectiveFrom: 'not-a-date', taxRate: '0.06' }]), /invalid effectiveFrom/);
  assert.throws(() => normalizeRules([{ version: 'x', effectiveFrom: '2026-01-01', taxRate: 'high' }]), /invalid taxRate/);
  assert.throws(() => normalizeRules([
    { version: 'x', effectiveFrom: '2026-01-01', taxRate: '0.06' },
    { version: 'x', effectiveFrom: '2026-02-01', taxRate: '0.07' },
  ]), /duplicate rule version/);
  assert.throws(() => normalizeRules([]), /non-empty/);
});

test('观察时间落在生效范围内即采用该规则，之前没有规则则返回空', () => {
  const rules = normalizeRules(inputs);
  assert.equal(ruleForInstant(rules, '2025-12-31T23:59:59Z'), null);
  assert.equal(ruleForInstant(rules, '2026-06-01T00:00:00Z').version, 'tax-1');
  assert.equal(ruleForInstant(rules, '2026-11-16T00:00:00Z').version, 'tax-2');
  assert.equal(ruleForInstant(rules, '2026-11-16T08:00:00Z').version, 'tax-2');
});

test('生效范围由相邻版本推导', () => {
  const ranges = effectiveRanges(normalizeRules(inputs));
  assert.deepEqual(ranges, [
    { version: 'tax-1', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: '2026-11-16T00:00:00.000Z' },
    { version: 'tax-2', effectiveFrom: '2026-11-16T00:00:00.000Z', effectiveTo: null },
  ]);
});
