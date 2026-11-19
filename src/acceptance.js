import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSource } from '../source/server.js';
import { SourceClient } from './source-client.js';
import { parsePage, entryPath } from './adapter.js';
import { RecordRepository } from './repository.js';
import { CollectionService } from './service.js';
import { ObservationLog } from './observation-log.js';
import { ComparisonStore } from './comparison-store.js';
import { RuleBook } from './rule-book.js';
import { ComparisonService } from './comparison-service.js';
import { readOperations } from './operations.js';

const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'collection-acceptance-'));
try {
  const client = new SourceClient(source.url);
  const page = parsePage(await client.read(entryPath));
  assert.ok(page.records.length > 0, '初始来源须有可接收的业务记录');

  const path = join(directory, 'records.json');
  const repository = new RecordRepository(path);
  const observationLog = new ObservationLog(join(directory, 'observations.json'));
  const first = await new CollectionService(repository, { observationLog }).ingest(page.records);
  assert.equal(first.accepted, page.records.length);
  assert.equal(first.observations.added, page.records.length, '首批观察全部进入观察日志');

  const stored = await repository.read();
  const reopened = new RecordRepository(path);
  const reopenedLog = new ObservationLog(join(directory, 'observations.json'));
  const restarted = new CollectionService(reopened, { observationLog: reopenedLog });
  assert.deepEqual(await restarted.query({}), stored, '重新打开后读取同一份业务记录');

  const second = await restarted.ingest(page.records);
  assert.equal(second.stored, stored.length, '重放首批记录不重复保存');
  assert.equal(second.observations.added, 0, '重放不重复写入观察日志');
  assert.equal((await reopenedLog.read()).length, page.records.length);

  const comparisonStore = new ComparisonStore(join(directory, 'comparisons.json'));
  const comparisons = new ComparisonService({
    observations: reopenedLog,
    rules: new RuleBook(new URL('../fixtures/rules.json', import.meta.url)),
    comparisons: comparisonStore,
  });

  // 组成齐全的观察形成可比结果并发布：到手价 = 金额 + 税额（未含税时）+ 运费。
  const published = await comparisons.publish('K1', { now: '2026-11-16T10:00:00Z' });
  assert.equal(published.status, 'published');
  assert.ok(published.quotes.every((quote) => quote.comparable), '组成齐全的报价都可比');
  assert.deepEqual(
    published.quotes.map((quote) => [quote.observation.sourceId, quote.total]),
    [['B-1', '125.35'], ['A-1', '128.00']],
    '到手价按升序排列，未含税报价按生效规则补税',
  );
  assert.equal(published.summary.best.sourceId, 'B-1');

  // 来源改版后口径不足：解释原因，不补默认零运费。
  source.publish('updated');
  const updated = parsePage(await client.read(entryPath));
  await restarted.ingest(updated.records);
  const candidate = await comparisons.compare('K1', { now: '2026-11-16T11:00:00Z' });
  assert.ok(candidate.quotes.every((quote) => !quote.comparable), '口径不足的报价不可直接比较');
  assert.ok(candidate.quotes.every((quote) => quote.total === null), '不可比报价不给总额');
  const codesOf = (sourceId) => candidate.quotes.find((quote) => quote.observation.sourceId === sourceId)
    .reasons.map((reason) => reason.code);
  assert.deepEqual(codesOf('A-1').sort(), ['shipping-unknown', 'tax-unknown']);
  assert.deepEqual(codesOf('B-1'), ['shipping-unknown']);

  // 已发布比较不受新观察影响；明确重算生成新版本，历史版本保持原样。
  assert.deepEqual(await comparisonStore.read(), [published], '采集不改写已发布比较');
  const recomputed = await comparisons.recompute(published.id, { now: '2026-11-16T12:00:00Z' });
  assert.equal(recomputed.supersedes, published.id);
  assert.ok(recomputed.quotes.every((quote) => !quote.comparable), '重算反映当前口径不足的观察');
  const history = await comparisonStore.read();
  assert.equal(history.length, 2);
  assert.deepEqual(history[0], published, '历史比较仍能追到原报价与当时的规则');
  assert.equal(history[0].quotes.find((quote) => quote.observation.sourceId === 'A-1').rule.version, 'tax-2');

  // 重抓旧页面：观察日志幂等，历史结论不无声改变。
  source.publish('opening');
  const rescraped = parsePage(await client.read(entryPath));
  const rescrape = await restarted.ingest(rescraped.records);
  assert.equal(rescrape.observations.added, 0, '重抓旧页面不重复写入观察');
  assert.deepEqual(await comparisonStore.read(), history, '重抓旧页面不改变已发布结论');

  const operations = await readOperations(reopened, { observations: reopenedLog, comparisons: comparisonStore });
  const current = await reopened.read();
  assert.deepEqual(operations.rows.map(row => row.sourceId), current.map(row => row.sourceId));
  for (const row of operations.rows) {
    const original = current.find(record => record.sourceId === row.sourceId);
    assert.equal(row.source, original.source);
    assert.equal(row.observedAt, original.observedAt);
    for (const [field, value] of Object.entries(row.attributes)) assert.deepEqual(value, original.attributes[field] ?? null);
  }
  assert.equal(operations.observations.total, 4, '观察日志保留两个阶段的全部观察');
  assert.equal(operations.comparisons.length, 2, '业务入口能看到已发布比较历史');

  console.log(JSON.stringify({
    accepted: first.accepted,
    persisted: stored.length,
    replayStored: second.stored,
    observations: operations.observations.total,
    published: published.id,
    recomputed: recomputed.id,
    operationRows: operations.rows.length,
    status: 'ok',
  }));
} finally {
  await source.close();
  await rm(directory, {recursive: true, force: true});
}
