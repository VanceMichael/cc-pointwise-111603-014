import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { RecordRepository } from './repository.js';
import { CollectionService } from './service.js';
import { ObservationRepository } from './observations.js';
import { ComparisonRepository } from './comparisons.js';
import { RuleRepository } from './rule-repository.js';
import { RuleRegistry } from './rules.js';
import { readOperations } from './operations.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const VALUE_FLAGS = new Set(['state', 'rules', 'rule-version', 'at']);

function parseFlags(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=');
      if (inline !== undefined) {
        flags[key] = inline;
      } else if (VALUE_FLAGS.has(key)) {
        flags[key] = argv[index + 1];
        index += 1;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const { positional, flags } = parseFlags(process.argv.slice(2));
const action = positional[0] ?? '--help';
const commands = ['ingest', 'query', 'rules', 'observe', 'compare', 'recalculate', 'comparisons'];

if (action === '--help' || action === '-h') {
  console.log(JSON.stringify({
    usage: 'npm start -- ingest [文件] | query [来源] | rules [文件] | observe | compare <observationId...> | recalculate <comparisonId> | comparisons',
    commands,
    flags: ['--state=目录', '--rules=文件', '--rule-version=版本', '--at=时间'],
    details: {
      ingest: 'ingest [文件]：导入来源报价，同时追加不可变观察',
      query: 'query [来源]：读取本地最新报价集合',
      rules: 'rules [文件]：登记带生效范围的规则；同版本内容不可变',
      observe: 'observe：列出已采集观察（保留来源明示价格组成与币种、观察时间）',
      compare: 'compare <observationId ...>：按生效规则形成可比结果，口径不足时给出原因',
      recalculate: 'recalculate <comparisonId> [--rule-version=版本|--at=时间]：明确发起的重算，生成新结论',
      comparisons: 'comparisons：列出已发布比较及其规则快照与取代关系',
    },
  }, null, 2));
  process.exit(0);
}

const stateDir = flags.state ? resolve(flags.state) : resolve(root, 'var');
const recordsRepo = new RecordRepository(resolve(stateDir, 'records.json'));
const observationsRepo = new ObservationRepository(resolve(stateDir, 'observations.json'));
const comparisonsRepo = new ComparisonRepository(resolve(stateDir, 'comparisons.json'));
const rulesRepo = new RuleRepository(resolve(stateDir, 'rules.json'));
const service = new CollectionService(recordsRepo, {
  observations: observationsRepo,
  comparisons: comparisonsRepo,
  ruleRegistry: new RuleRegistry(rulesRepo),
});

if (action === 'ingest') {
  const records = JSON.parse(await readFile(positional[1] ?? resolve(root, 'fixtures/records.json'), 'utf8'));
  console.log(JSON.stringify(await service.ingest(records), null, 2));
} else if (action === 'query') {
  console.log(JSON.stringify(await service.query({ source: positional[1] }), null, 2));
} else if (action === 'rules') {
  const rules = JSON.parse(await readFile(positional[1] ?? flags.rules ?? resolve(root, 'fixtures/rules.json'), 'utf8'));
  console.log(JSON.stringify(await service.registerRules(rules), null, 2));
} else if (action === 'observe') {
  console.log(JSON.stringify(await service.listObservations(), null, 2));
} else if (action === 'compare') {
  const ids = positional.slice(1);
  if (!ids.length) throw new Error('compare requires at least one observationId');
  const result = await service.compare(ids, { ruleVersion: flags['rule-version'] });
  console.log(JSON.stringify(result, null, 2));
} else if (action === 'recalculate') {
  const comparisonId = positional[1];
  if (!comparisonId) throw new Error('recalculate requires a comparisonId');
  const result = await service.recalculate(comparisonId, {
    ruleVersion: flags['rule-version'],
    at: flags.at,
  });
  console.log(JSON.stringify(result, null, 2));
} else if (action === 'comparisons') {
  console.log(JSON.stringify(await service.listComparisons(), null, 2));
} else {
  throw new Error('action must be one of: ingest, query, rules, observe, compare, recalculate, comparisons');
}
