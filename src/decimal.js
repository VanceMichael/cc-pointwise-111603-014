// 精确十进制运算：金额为十进制字符串，比较过程不允许浮点误差。
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export function isDecimalString(text) {
  return typeof text === 'string' && DECIMAL_PATTERN.test(text.trim());
}

export function parseDecimal(text) {
  if (!isDecimalString(text)) throw new Error(`invalid decimal: ${text}`);
  const trimmed = text.trim();
  const negative = trimmed.startsWith('-');
  const [intPart, fracPart = ''] = (negative ? trimmed.slice(1) : trimmed).split('.');
  const digits = `${intPart}${fracPart}`;
  const value = BigInt(digits) * (negative ? -1n : 1n);
  return { value, scale: fracPart.length };
}

export function zeroDecimal(scale = 2) {
  return { value: 0n, scale };
}

function align(left, right) {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.value * 10n ** BigInt(scale - left.scale),
    right.value * 10n ** BigInt(scale - right.scale),
    scale,
  ];
}

export function addDecimal(left, right) {
  const [a, b, scale] = align(left, right);
  return { value: a + b, scale };
}

export function multiplyDecimal(left, right) {
  return { value: left.value * right.value, scale: left.scale + right.scale };
}

// 半进位（远离零方向）保留到指定小数位。
export function roundDecimal(decimal, scale) {
  if (decimal.scale <= scale) {
    return { value: decimal.value * 10n ** BigInt(scale - decimal.scale), scale };
  }
  const factor = 10n ** BigInt(decimal.scale - scale);
  const quotient = decimal.value / factor;
  const remainder = decimal.value % factor;
  const absolute = remainder < 0n ? -remainder : remainder;
  const bump = absolute * 2n >= factor ? (decimal.value < 0n ? -1n : 1n) : 0n;
  return { value: quotient + bump, scale };
}

export function compareDecimal(left, right) {
  const [a, b] = align(left, right);
  return a < b ? -1 : a > b ? 1 : 0;
}

export function decimalToString(decimal, minScale = 0) {
  const scale = Math.max(decimal.scale, minScale);
  const value = decimal.value * 10n ** BigInt(scale - decimal.scale);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, '0');
  const head = scale === 0 ? digits : digits.slice(0, -scale);
  const tail = scale === 0 ? '' : `.${digits.slice(-scale)}`;
  return `${negative ? '-' : ''}${head}${tail}`;
}
