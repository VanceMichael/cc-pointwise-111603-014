import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDecimal, compareDecimal, decimalToString, isDecimalString,
  multiplyDecimal, parseDecimal, roundDecimal, zeroDecimal,
} from '../src/decimal.js';

test('十进制解析与格式化保持来源精度', () => {
  assert.equal(decimalToString(parseDecimal('120.00'), 2), '120.00');
  assert.equal(decimalToString(parseDecimal('0.05')), '0.05');
  assert.equal(decimalToString(parseDecimal('007.50')), '7.50');
  assert.equal(decimalToString(parseDecimal('-3.5'), 2), '-3.50');
  assert.ok(isDecimalString('120.00'));
  assert.ok(!isDecimalString('12.3.4'));
  assert.ok(!isDecimalString('abc'));
  assert.ok(!isDecimalString(120));
});

test('加减乘按标量精确计算', () => {
  const sum = addDecimal(parseDecimal('120.00'), parseDecimal('8.00'));
  assert.equal(decimalToString(sum, 2), '128.00');
  const tax = multiplyDecimal(parseDecimal('115.00'), parseDecimal('0.09'));
  assert.equal(decimalToString(roundDecimal(tax, 2), 2), '10.35');
  const total = addDecimal(addDecimal(parseDecimal('115.00'), roundDecimal(tax, 2)), zeroDecimal(2));
  assert.equal(decimalToString(total, 2), '125.35');
});

test('半进位舍入且负数以远离零方向处理', () => {
  assert.equal(decimalToString(roundDecimal(parseDecimal('10.345'), 2)), '10.35');
  assert.equal(decimalToString(roundDecimal(parseDecimal('10.344'), 2)), '10.34');
  assert.equal(decimalToString(roundDecimal(parseDecimal('-10.345'), 2)), '-10.35');
  assert.equal(decimalToString(roundDecimal(parseDecimal('1.2'), 2)), '1.20');
});

test('比较与解析拒绝非法输入', () => {
  assert.equal(compareDecimal(parseDecimal('125.35'), parseDecimal('128.00')), -1);
  assert.equal(compareDecimal(parseDecimal('128.00'), parseDecimal('128.0')), 0);
  assert.throws(() => parseDecimal('not-a-number'), /invalid decimal/);
});
