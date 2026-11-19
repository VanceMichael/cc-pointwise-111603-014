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
const directory = await mkdtemp(join(tmpdir(), 'collection-demo-'));
try {
  const client = new SourceClient(source.url);
  const records = new RecordRepository(join(directory, 'records.json'));
  const observationLog = new ObservationLog(join(directory, 'observations.json'));
  const comparisonStore = new ComparisonStore(join(directory, 'comparisons.json'));
  const service = new CollectionService(records, { observationLog });
  const comparisons = new ComparisonService({
    observations: observationLog,
    rules: new RuleBook(new URL('../fixtures/rules.json', import.meta.url)),
    comparisons: comparisonStore,
  });

  // 首批采集：两个渠道对同一 sku 的报价组成齐全，发布可比结果。
  const first = parsePage(await client.read(entryPath));
  await service.ingest(first.records);
  const published = await comparisons.publish('K1');

  // 来源改版：金额口径不再明示（税费、运费未知），新观察进入日志，
  // 候选比较给出不可比原因而不是补默认零运费；已发布结论不受影响。
  source.publish('updated');
  const second = parsePage(await client.read(entryPath));
  await service.ingest(second.records);
  const explained = await comparisons.compare('K1');

  // 明确发起的重算生成新版本，历史版本保持原样。
  const recomputed = await comparisons.recompute(published.id);

  // 重抓旧页面：观察日志幂等，已发布比较不发生无声变化。
  source.publish('opening');
  const rescraped = parsePage(await client.read(entryPath));
  const rescrapeResult = await service.ingest(rescraped.records);

  const operations = await readOperations(records, { observations: observationLog, comparisons: comparisonStore });
  console.log(JSON.stringify({
    published,
    explained: explained.quotes.map((quote) => ({
      sourceId: quote.observation.sourceId,
      comparable: quote.comparable,
      total: quote.total,
      reasons: quote.reasons,
    })),
    recomputed: { id: recomputed.id, supersedes: recomputed.supersedes },
    rescrape: rescrapeResult.observations,
    history: operations.comparisons.map((comparison) => ({
      id: comparison.id,
      quotes: comparison.quotes.map((quote) => ({
        observation: quote.observation,
        rule: quote.rule?.version ?? null,
        total: quote.total,
      })),
    })),
    operations,
  }, null, 2));
} finally { await source.close(); await rm(directory, { recursive: true, force: true }); }
