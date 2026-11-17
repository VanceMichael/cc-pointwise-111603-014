import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { startSource } from '../source/server.js';
import { SourceClient } from './source-client.js';
import { parsePage, entryPath } from './adapter.js';
import { RecordRepository } from './repository.js';
import { ObservationRepository } from './observations.js';
import { ComparisonRepository } from './comparisons.js';
import { RuleRepository } from './rule-repository.js';
import { RuleRegistry } from './rules.js';
import { CollectionService } from './service.js';
import { readOperations } from './operations.js';

const rules = JSON.parse(await readFile(new URL('../fixtures/rules.json', import.meta.url), 'utf8'));
const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
const directory = await mkdtemp(join(tmpdir(), 'collection-demo-'));
try {
  const service = new CollectionService(new RecordRepository(join(directory, 'records.json')), {
    observations: new ObservationRepository(join(directory, 'observations.json')),
    comparisons: new ComparisonRepository(join(directory, 'comparisons.json')),
    ruleRegistry: new RuleRegistry(new RuleRepository(join(directory, 'rules.json'))),
  });

  const firstPage = parsePage(await new SourceClient(source.url).read(entryPath));
  await service.ingest(firstPage.records);
  await service.registerRules(rules);
  const opening = (await service.listObservations())[0];
  const firstComparison = await service.compare([opening.observationId]);

  // 来源改版：税费口径与运费都变成“来源未写”（null）。重新抓取只追加新观察。
  source.publish('updated');
  const updatedPage = parsePage(await new SourceClient(source.url).read(entryPath));
  await service.ingest(updatedPage.records);
  const updated = (await service.listObservations()).find((item) => item.observedAt !== opening.observedAt);
  const mixedComparison = await service.compare([opening.observationId, updated.observationId]);

  // 明确发起的重算：把首条已发布结论固定到旧规则版本，产生新结论而不改动历史。
  const recalculated = await service.recalculate(firstComparison.comparisonId, { ruleVersion: 'tax-1' });

  const view = await readOperations(service.repository, {
    observations: service.observations,
    comparisons: service.comparisons,
  });
  console.log(JSON.stringify({
    observations: view.observations.map((item) => ({
      observationId: item.observationId,
      observedAt: item.observedAt,
      price: item.price,
      sourceRuleVersion: item.sourceRuleVersion,
    })),
    openingComparison: {
      id: firstComparison.comparisonId,
      status: firstComparison.status,
      rule: firstComparison.comparison.rule.version,
      components: firstComparison.evaluations[0].components,
      supersededBy: (await service.listComparisons())
        .find((item) => item.comparisonId === firstComparison.comparisonId).supersededBy,
    },
    mixedComparison: {
      id: mixedComparison.comparisonId,
      status: mixedComparison.status,
      reasons: mixedComparison.evaluations.flatMap((item) => item.reasons.map((entry) => entry.code)),
    },
    recalculation: {
      id: recalculated.comparisonId,
      kind: recalculated.comparison.kind,
      rule: recalculated.comparison.rule.version,
      supersedes: recalculated.comparison.supersedes,
      components: recalculated.evaluations[0].components,
    },
    operationRows: view.rows.length,
  }, null, 2));
} finally {
  await source.close();
  await rm(directory, { recursive: true, force: true });
}
