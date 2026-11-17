import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('命令帮助列出采集与比价入口且正常退出', () => {
  const result = spawnSync(process.execPath, ['src/cli.js', '--help'], {encoding: 'utf8'});
  assert.equal(result.status, 0);
  const help = JSON.parse(result.stdout);
  assert.ok(help.usage.includes('ingest'));
  for (const command of ['ingest', 'query', 'rules', 'observe', 'compare', 'recalculate', 'comparisons']) {
    assert.ok(help.commands.includes(command), `帮助应包含 ${command}`);
  }
});

test('未知动作明确失败而不执行默认查询', () => {
  const result = spawnSync(process.execPath, ['src/cli.js', 'invalid-action'], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ingest, query/);
});

test('端到端 CLI：规则登记、观察采集、不可比解释与显式重算写入独立状态目录', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cli-e2e-'));
  const run = (args) => spawnSync(process.execPath, ['src/cli.js', ...args, '--state', directory], { encoding: 'utf8' });
  try {
    const ingested = run(['ingest', 'fixtures/records.json']);
    assert.equal(ingested.status, 0, ingested.stderr);
    const ingestResult = JSON.parse(ingested.stdout);
    assert.equal(ingestResult.accepted, 1);
    assert.equal(ingestResult.observations.added, 1);

    const registered = run(['rules', 'fixtures/rules.json']);
    assert.equal(registered.status, 0, registered.stderr);
    assert.equal(JSON.parse(registered.stdout).registered, 2);

    const observe = run(['observe']);
    assert.equal(observe.status, 0, observe.stderr);
    const observationId = JSON.parse(observe.stdout)[0].observationId;

    const compared = run(['compare', observationId]);
    assert.equal(compared.status, 0, compared.stderr);
    const comparison = JSON.parse(compared.stdout);
    assert.equal(comparison.status, 'comparable');
    assert.equal(comparison.comparison.rule.version, 'tax-2');

    const recalculated = run(['recalculate', comparison.comparisonId, '--rule-version=tax-1']);
    assert.equal(recalculated.status, 0, recalculated.stderr);
    const redone = JSON.parse(recalculated.stdout);
    assert.equal(redone.comparison.kind, 'recalculation');
    assert.equal(redone.comparison.rule.version, 'tax-1');

    const history = JSON.parse(run(['comparisons']).stdout);
    assert.equal(history.length, 2);
    assert.ok(history.some((item) => item.supersededBy === redone.comparisonId));

    const queried = run(['query']);
    assert.equal(queried.status, 0, queried.stderr);
    assert.equal(JSON.parse(queried.stdout).length, 1, '既有 query 能力保持不变');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
