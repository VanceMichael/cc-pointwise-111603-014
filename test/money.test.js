import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRate, canonicalJson, formatMoney, parseDecimal, roundToMoney } from '../src/money.js';

test('decimal strings parse to fixed-point integers without float drift', () => {
  assert.equal(formatMoney(roundToMoney(parseDecimal('120.00'))), '120.00');
  assert.equal(formatMoney(roundToMoney(parseDecimal('0.1'))), '0.10');
  assert.equal(formatMoney(roundToMoney(parseDecimal('100.005'))), '100.01', 'half rounds up');
  assert.equal(formatMoney(applyRate(parseDecimal('120.00'), parseDecimal('0.06'))), '7.20');
  assert.equal(formatMoney(applyRate(parseDecimal('113.21'), parseDecimal('0.09'))), '10.19');
});

test('invalid or over-precise decimals are rejected', () => {
  assert.throws(() => parseDecimal(''), /non-empty/);
  assert.throws(() => parseDecimal(120), /non-empty/);
  assert.throws(() => parseDecimal('12.3.4'), /invalid amount/);
  assert.throws(() => parseDecimal('1.1234567'), /too many decimal/);
});

test('canonical json ignores key order for stable identity hashing', () => {
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }));
  assert.notEqual(canonicalJson({ a: 1, b: 2 }), canonicalJson({ a: 1, b: 3 }));
});
