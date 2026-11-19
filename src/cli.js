import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { RecordRepository } from './repository.js';
import { CollectionService } from './service.js';
import { ObservationLog } from './observation-log.js';
import { ComparisonStore } from './comparison-store.js';
import { RuleBook } from './rule-book.js';
import { ComparisonService } from './comparison-service.js';

const here = dirname(fileURLToPath(import.meta.url));
const stateDir = resolve(here, '../var');
const observationLog = new ObservationLog(join(stateDir, 'observations.json'));
const comparisonStore = new ComparisonStore(join(stateDir, 'comparisons.json'));
const service = new CollectionService(new RecordRepository(join(stateDir, 'records.json')), { observationLog });
const ruleBook = new RuleBook(process.env.PRICE_RULES ?? resolve(here, '../fixtures/rules.json'));
const comparisonService = new ComparisonService({ observations: observationLog, rules: ruleBook, comparisons: comparisonStore });

const commands = ['ingest', 'query', 'observations', 'compare', 'publish', 'recompute', 'comparisons'];
const [action, ...args] = process.argv.slice(2);
const print = (value) => console.log(JSON.stringify(value, null, 2));

if (!action || action === '--help' || action === '-h') {
  print({
    usage: 'npm start -- ingest [文件] | query [来源] | observations [sourceId] | compare <sku> | publish <sku> | recompute <comparisonId> | comparisons',
    commands,
    rules: ruleBook.path,
  });
  process.exit(0);
}

if (action === 'ingest') {
  const records = JSON.parse(await readFile(args[0] ?? resolve(here, '../fixtures/records.json'), 'utf8'));
  print(await service.ingest(records));
} else if (action === 'query') {
  print(await service.query({ source: args[0] }));
} else if (action === 'observations') {
  const observations = await observationLog.read();
  print(args[0] ? observations.filter((observation) => observation.sourceId === args[0]) : observations);
} else if (action === 'compare') {
  if (!args[0]) throw new Error('compare requires <sku>');
  print(await comparisonService.compare(args[0]));
} else if (action === 'publish') {
  if (!args[0]) throw new Error('publish requires <sku>');
  print(await comparisonService.publish(args[0]));
} else if (action === 'recompute') {
  if (!args[0]) throw new Error('recompute requires <comparisonId>');
  print(await comparisonService.recompute(args[0]));
} else if (action === 'comparisons') {
  print(await comparisonService.list());
} else {
  throw new Error(`unknown action "${action}": expected one of ${commands.join(', ')}`);
}
