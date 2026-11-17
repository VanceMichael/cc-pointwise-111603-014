import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const directory = await mkdtemp(join(tmpdir(), 'collection-acceptance-'));
try {
  const recordsRepo = new RecordRepository(join(directory, 'records.json'));
  const observationsRepo = new ObservationRepository(join(directory, 'observations.json'));
  const comparisonsRepo = new ComparisonRepository(join(directory, 'comparisons.json'));
  const rulesRepo = new RuleRepository(join(directory, 'rules.json'));
  const service = new CollectionService(recordsRepo, {
    observations: observationsRepo,
    comparisons: comparisonsRepo,
    ruleRegistry: new RuleRegistry(rulesRepo),
  });

  // 1. 首批来源读取、导入与重启回读（保留原有能力）。
  const page = parsePage(await new SourceClient(source.url).read(entryPath));
  assert.ok(page.records.length > 0, '初始来源须有可接收的业务记录');
  const first = await service.ingest(page.records);
  assert.equal(first.accepted, page.records.length);
  const stored = await recordsRepo.read();
  const reopened = new CollectionService(new RecordRepository(join(directory, 'records.json')), {
    observations: observationsRepo, comparisons: comparisonsRepo, ruleRegistry: new RuleRegistry(rulesRepo),
  });
  assert.deepEqual(await reopened.query({}), stored, '重新打开后读取同一份业务记录');
  const replay = await reopened.ingest(page.records);
  assert.equal(replay.stored, stored.length, '重放首批记录不重复保存');
  assert.equal(replay.observations.added, 0, '相同来源内容重抓不产生新观察');

  await service.registerRules(rules);
  await assert.rejects(service.registerRules(rules.map((rule) =>
    rule.version === 'tax-1' ? { ...rule, taxRate: '0.99' } : rule)), /immutable/,
    '已登记规则版本的内容不可被替换');

  // 2. 口径完整的报价形成可比结果，且金额不是浮点猜测。
  const opening = (await service.listObservations())[0];
  const openingResult = await service.compare([opening.observationId]);
  assert.equal(openingResult.status, 'comparable');
  assert.equal(openingResult.evaluations[0].components.listedAmount, '120.00');
  assert.equal(openingResult.evaluations[0].components.shippingAmount, '8.00');
  assert.equal(openingResult.comparison.rule.version, 'tax-2', '按观察时间选中当时生效规则');
  assert.ok(openingResult.evaluations[0].rule.taxRate, '比较结果固化规则快照');
  const republished = await service.compare([opening.observationId]);
  assert.equal(republished.published, false, '相同输入与规则重复发布是幂等的');

  // 3. 来源改版后口径缺失：重抓只追加新观察，不补零运费、不静默改写历史。
  source.publish('updated');
  await service.ingest(parsePage(await new SourceClient(source.url).read(entryPath)).records);
  const observations = await service.listObservations();
  assert.equal(observations.length, 2, '来源改版追加一条新观察');
  const updated = observations.find((item) => item.observationId !== opening.observationId);
  assert.equal(updated.price.taxIncluded, null, '来源未写税费口径时保留 null');
  assert.equal(updated.price.shipping, null, '来源未写运费时保留 null 而非零');

  const historical = (await service.listComparisons()).find((item) => item.comparisonId === openingResult.comparisonId);
  assert.equal(historical.status, 'comparable', '重抓旧页面不能让历史结论无声改变');
  assert.deepEqual(historical.evaluations[0].components, openingResult.evaluations[0].components);

  const mixed = await service.compare([opening.observationId, updated.observationId]);
  assert.equal(mixed.status, 'incomparable');
  const codes = mixed.evaluations.find((item) => item.observationId === updated.observationId)
    .reasons.map((entry) => entry.code);
  assert.ok(codes.includes('TAX_SCOPE_UNKNOWN'), '税费口径未知须显式解释');
  assert.ok(codes.includes('SHIPPING_UNKNOWN'), '运费未知须显式解释且不默认零运费');

  // 4. 明确发起的重算可以固定到旧规则版本，新结论取代旧结论，原结论仍可追溯。
  const recalculated = await service.recalculate(openingResult.comparisonId, { ruleVersion: 'tax-1' });
  assert.equal(recalculated.comparison.kind, 'recalculation');
  assert.equal(recalculated.comparison.rule.version, 'tax-1');
  assert.deepEqual(recalculated.comparison.supersedes, [openingResult.comparisonId]);
  const historyAfter = await service.listComparisons();
  const oldOne = historyAfter.find((item) => item.comparisonId === openingResult.comparisonId);
  assert.equal(oldOne.supersededBy, recalculated.comparisonId, '旧结论记录被取代关系而非被删除');
  assert.equal(oldOne.rule.version, 'tax-2', '旧结论仍指向当时的规则快照');
  assert.notEqual(recalculated.evaluations[0].components.taxAmount,
    openingResult.evaluations[0].components.taxAmount, '不同规则口径得到不同税额');

  // 5. 业务读取入口同时看到观察、比较与解释信息。
  const operations = await readOperations(recordsRepo, { observations: observationsRepo, comparisons: comparisonsRepo });
  assert.equal(operations.rows.length, stored.length);
  assert.equal(operations.observations.length, 2);
  assert.ok(operations.comparisons.some((item) => item.comparisonId === openingResult.comparisonId));

  console.log(JSON.stringify({
    accepted: first.accepted,
    persisted: stored.length,
    replayStored: replay.stored,
    observations: observations.length,
    comparisons: (await service.listComparisons()).length,
    openingRule: openingResult.comparison.rule.version,
    recalculationRule: recalculated.comparison.rule.version,
    status: 'ok',
  }));
} finally {
  await source.close();
  await rm(directory, { recursive: true, force: true });
}
