import test from 'node:test';
import assert from 'node:assert/strict';
import { compareObservations, evaluateObservation, REASON } from '../src/compare.js';

const rule = { version: 'tax-2', effectiveFrom: '2026-11-16', taxRate: '0.09' };

function observation(overrides = {}) {
  return {
    observationId: overrides.observationId ?? 'obs-1',
    sourceId: overrides.sourceId ?? 'A-1',
    sku: 'K1',
    shop: 'a',
    observedAt: '2026-11-16T08:00:00Z',
    price: {
      amount: '120.00',
      currency: 'CNY',
      taxIncluded: true,
      shipping: '8.00',
      ...(overrides.price ?? {}),
    },
  };
}

test('complete caliber produces a comparable landed price and keeps the rule snapshot', () => {
  const result = evaluateObservation(observation(), rule);
  assert.equal(result.status, 'comparable');
  assert.deepEqual(result.reasons, []);
  assert.equal(result.components.listedAmount, '120.00');
  assert.equal(result.components.shippingAmount, '8.00');
  assert.match(result.components.taxAmount, /^\d+\.\d{2}$/);
  assert.equal(result.components.landedPrice, '128.00', '含税报价的到手价 = 含税金额 + 明示运费');
  assert.equal(result.rule.version, 'tax-2');
  assert.equal(result.rule.taxRate, '0.09');
});

test('tax-excluded amount is grossed up with the selected rule', () => {
  const result = evaluateObservation(observation({ price: { taxIncluded: false } }), rule);
  assert.equal(result.status, 'comparable');
  assert.equal(result.components.taxAmount, '10.80');
  assert.equal(result.components.taxIncludedAmount, '130.80');
  assert.equal(result.components.landedPrice, '138.80');
});

test('unknown tax scope and shipping are explained, never defaulted to zero', () => {
  const result = evaluateObservation(observation({
    observationId: 'obs-2',
    price: { taxIncluded: null, shipping: null },
  }), rule);
  assert.equal(result.status, 'incomparable');
  assert.equal(result.components, null, '口径不足时不产出可能误导的可比金额');
  const codes = result.reasons.map((entry) => entry.code);
  assert.ok(codes.includes(REASON.TAX_SCOPE_UNKNOWN));
  assert.ok(codes.includes(REASON.SHIPPING_UNKNOWN));
  assert.match(result.reasons.find((entry) => entry.code === REASON.SHIPPING_UNKNOWN).message, /不能默认补零运费/);
});

test('missing amount or currency is reported instead of fabricating a price', () => {
  const noAmount = evaluateObservation(observation({ price: { amount: null } }), rule);
  assert.equal(noAmount.status, 'incomparable');
  assert.ok(noAmount.reasons.some((entry) => entry.code === REASON.AMOUNT_MISSING));
  const noCurrency = evaluateObservation(observation({ price: { currency: null } }), rule);
  assert.ok(noCurrency.reasons.some((entry) => entry.code === REASON.CURRENCY_MISSING));
});

test('group comparison ranks comparable offers by landed price', () => {
  const cheap = observation({ observationId: 'obs-a', sourceId: 'A-1', price: { shipping: '0.00' } });
  const pricey = observation({ observationId: 'obs-b', sourceId: 'B-1', price: { amount: '200.00', shipping: '8.00' } });
  const group = compareObservations([pricey, cheap], rule);
  assert.equal(group.status, 'comparable');
  assert.deepEqual(group.ranking.map((row) => row.sourceId), ['A-1', 'B-1']);
  assert.equal(group.ranking[0].currency, 'CNY');
});

test('a group with mixed currencies is incomparable and every member carries the explanation', () => {
  const cny = observation({ observationId: 'obs-cny', sourceId: 'A-1' });
  const usd = observation({ observationId: 'obs-usd', sourceId: 'B-1', price: { currency: 'USD' } });
  const group = compareObservations([cny, usd], rule);
  assert.equal(group.status, 'incomparable');
  assert.equal(group.ranking, null);
  assert.ok(group.evaluations.every((item) =>
    item.reasons.some((entry) => entry.code === REASON.GROUP_CURRENCY_MISMATCH)));
});

test('one incomplete member makes the whole group incomparable while the other stays explainable', () => {
  const good = observation({ observationId: 'obs-good', sourceId: 'A-1' });
  const bad = observation({ observationId: 'obs-bad', sourceId: 'B-1', price: { shipping: null, taxIncluded: null } });
  const group = compareObservations([good, bad], rule);
  assert.equal(group.status, 'incomparable');
  const badEntry = group.evaluations.find((item) => item.observationId === 'obs-bad');
  assert.ok(badEntry.reasons.some((entry) => entry.code === REASON.SHIPPING_UNKNOWN));
});
