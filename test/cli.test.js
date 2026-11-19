import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('命令帮助列出导入、查询与比价入口且正常退出', () => {
  const result = spawnSync(process.execPath, ['src/cli.js', '--help'], {encoding: 'utf8'});
  assert.equal(result.status, 0);
  const help = JSON.parse(result.stdout);
  assert.ok(help.usage.includes('ingest'));
  assert.deepEqual(help.commands, ['ingest', 'query', 'observations', 'compare', 'publish', 'recompute', 'comparisons']);
});

test('未知动作明确失败而不执行默认查询', () => {
  const result = spawnSync(process.execPath, ['src/cli.js', 'invalid-action'], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /expected one of ingest, query/);
});

test('compare 缺少 sku 时明确失败', () => {
  const result = spawnSync(process.execPath, ['src/cli.js', 'compare'], {encoding: 'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires <sku>/);
});
