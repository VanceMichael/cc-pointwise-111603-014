// 定点十进制金额工具：金额是来源明示的十进制字符串，计算过程不允许使用浮点。
// 内部以 SCALE 位小数的大整数表示，输出金额统一保留两位小数（人民币分）。

export const SCALE = 6n;
export const MONEY_SCALE = 2n;
const SCALE_FACTOR = 10n ** SCALE;
const MONEY_FACTOR = 10n ** MONEY_SCALE;

export function parseDecimal(value, label = 'amount') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty decimal string`);
  }
  const text = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`invalid ${label}: ${value}`);
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > Number(SCALE)) throw new Error(`${label} has too many decimal places: ${value}`);
  const digits = `${whole}${fraction.padEnd(Number(SCALE), '0')}`;
  const unsigned = BigInt(digits);
  return sign === '-' ? -unsigned : unsigned;
}

// 四舍五入到两位小数并返回定点金额（最小货币单位的整数语义保留在内部大整数中）。
export function roundToMoney(value) {
  const factor = SCALE_FACTOR / MONEY_FACTOR; // 10000
  const half = factor / 2n;
  const rounded = value >= 0n
    ? ((value + half) / factor) * factor
    : -((( -value + half) / factor) * factor);
  return rounded;
}

export function formatMoney(value) {
  const reduced = roundToMoney(value) / (SCALE_FACTOR / MONEY_FACTOR);
  const negative = reduced < 0n;
  const absolute = negative ? -reduced : reduced;
  const units = absolute / MONEY_FACTOR;
  const fraction = absolute % MONEY_FACTOR;
  return `${negative ? '-' : ''}${units.toString()}.${fraction.toString().padStart(Number(MONEY_SCALE), '0')}`;
}

// 按税率（同为 SCALE 位定点数）计算税额：value * rate，结果四舍五入到分。
export function applyRate(value, rate) {
  return roundToMoney((value * rate) / SCALE_FACTOR);
}

export function addMoney(left, right) {
  return roundToMoney(left + right);
}

// 生成稳定的标识输入：键排序后的 JSON，避免对象字段顺序影响幂等标识。
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(',')}}`;
}
