import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { startSource } from '../source/server.js';
import { parsePage, entryPath } from '../src/adapter.js';
import { SourceClient } from '../src/source-client.js';

async function observe(stage = 'opening', path = entryPath) {
  const source = await startSource(new URL('../fixtures/source.json', import.meta.url));
  try {
    source.publish(stage);
    return parsePage(await new SourceClient(source.url).read(path));
  } finally { await source.close(); }
}

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));
}

test('price source preserves unknown components rather than converting them to zero', async () => {
  const initial = (await observe()).records[0].attributes;
  const changed = (await observe('updated')).records[0].attributes;
  assert.equal(initial.amount, '120.00');
  assert.equal(initial.shipping, '8.00');
  assert.equal(changed.shipping, null);
  assert.equal(changed.taxIncluded, null);
  assert.equal((await fixture('rules')).length, 2);
});

test('explicit zero shipping stays distinct from unknown shipping across offers', async () => {
  const opening = await observe();
  assert.equal(opening.records.length, 2);
  const listed = opening.records[1].attributes;
  assert.equal(listed.offerId, 'B-1');
  assert.equal(listed.taxIncluded, false);
  assert.equal(listed.shipping, '0.00', '来源明示的零运费是口径声明，不同于未知');
  const changed = (await observe('updated')).records[1].attributes;
  assert.equal(changed.shipping, null, '改版后来源不再明示运费');
});
