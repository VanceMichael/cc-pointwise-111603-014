import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRules, RuleRegistry, selectRule } from '../src/rules.js';
import { RuleRepository } from '../src/rule-repository.js';

const sample = [
  { version: 'tax-1', effectiveFrom: '2026-01-01', taxRate: '0.06' },
  { version: 'tax-2', effectiveFrom: '2026-11-16', taxRate: '0.09' },
];

test('rules validate fields and reject duplicate versions on load', () => {
  assert.throws(() => loadRules([{ version: 'x', effectiveFrom: 'bad-date', taxRate: '0.1' }]), /effectiveFrom/);
  assert.throws(() => loadRules([sample[0], { ...sample[0] }]), /duplicate rule version/);
  assert.throws(() => loadRules([{ version: 'x', effectiveFrom: '2026-01-01' }]), /missing rule taxRate/);
});

test('selection uses the effective range at the reference time or an explicit version', () => {
  const rules = loadRules(sample);
  assert.equal(selectRule(rules, { at: '2026-11-15T23:59:00Z' }).version, 'tax-1');
  assert.equal(selectRule(rules, { at: '2026-11-16T00:00:00Z' }).version, 'tax-2', '生效日当天即采用新规则');
  assert.equal(selectRule(rules, { at: '2026-11-16T09:00:00Z', version: 'tax-1' }).version, 'tax-1', '明确指定版本可固定旧口径');
  assert.throws(() => selectRule(rules, { at: '2025-12-31T00:00:00Z' }), /no rule is effective/);
  assert.throws(() => selectRule(rules, { version: 'missing' }), /unknown rule version/);
});

test('rule registry appends new versions but refuses to mutate a registered one', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rules-'));
  try {
    const registry = new RuleRegistry(new RuleRepository(join(directory, 'rules.json')));
    assert.deepEqual(await registry.register(sample), { registered: 2, total: 2 });
    assert.deepEqual(await registry.register(sample), { registered: 0, total: 2 }, '重复登记同内容规则无副作用');
    await assert.rejects(
      registry.register([{ version: 'tax-1', effectiveFrom: '2026-01-01', taxRate: '0.99' }]),
      /immutable/,
    );
    const next = await registry.register([{ version: 'tax-3', effectiveFrom: '2026-12-01', taxRate: '0.10' }]);
    assert.equal(next.registered, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
