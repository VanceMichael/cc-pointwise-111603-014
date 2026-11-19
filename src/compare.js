import {
  addDecimal, compareDecimal, decimalToString, isDecimalString,
  multiplyDecimal, parseDecimal, roundDecimal, zeroDecimal,
} from './decimal.js';
import { ruleForInstant } from './rules.js';

// 可比口径定义：只有来源明示组成齐全时才形成“到手价”。
// 口径本身也版本化，已发布比较内嵌当时的定义，便于日后追溯。
export const comparisonDefinition = Object.freeze({
  version: 'landed-1',
  name: '到手价',
  expression: 'amount + (taxIncluded ? 0 : amount * taxRate) + shipping',
  rounding: 'half-up to 2 decimals',
  unknown: '来源未明示的组成不补默认值（运费未知不等于零运费），该报价不参与直接比较并给出原因',
});

const REASON_MESSAGES = Object.freeze({
  'amount-missing': '来源未给出页面金额',
  'amount-invalid': '来源金额不是有效的十进制字符串',
  'currency-missing': '来源未给出币种，无法确认比较口径',
  'tax-unknown': '来源未说明金额是否包含税费，税费组成未知',
  'tax-flag-invalid': '来源税费标记不是布尔值，无法解释',
  'shipping-unknown': '来源未给出运费，不能按零运费处理',
  'shipping-invalid': '来源运费不是有效的十进制字符串',
  'no-effective-rule': '观察时间不在任何规则生效范围内，无法确定税率',
});

function reason(code) {
  return { code, message: REASON_MESSAGES[code] };
}

// 单条报价口径化：返回可比总额或不可比原因。规则只用于计算未含税时的税额。
export function normalizeQuote(components, rule) {
  const reasons = [];
  let amount = null;
  if (components.amount === null || components.amount === undefined) {
    reasons.push(reason('amount-missing'));
  } else if (!isDecimalString(components.amount)) {
    reasons.push(reason('amount-invalid'));
  } else {
    amount = parseDecimal(components.amount);
  }

  if (!components.currency) reasons.push(reason('currency-missing'));

  let tax = null;
  let taxHandling = null;
  if (components.taxIncluded === null || components.taxIncluded === undefined) {
    reasons.push(reason('tax-unknown'));
  } else if (components.taxIncluded === true) {
    tax = zeroDecimal(2);
    taxHandling = 'included';
  } else if (components.taxIncluded === false) {
    taxHandling = 'added';
    if (!rule) {
      reasons.push(reason('no-effective-rule'));
    } else if (amount) {
      tax = roundDecimal(multiplyDecimal(amount, parseDecimal(rule.taxRate)), 2);
    }
  } else {
    reasons.push(reason('tax-flag-invalid'));
  }

  let shipping = null;
  if (components.shipping === null || components.shipping === undefined) {
    reasons.push(reason('shipping-unknown'));
  } else if (!isDecimalString(components.shipping)) {
    reasons.push(reason('shipping-invalid'));
  } else {
    shipping = parseDecimal(components.shipping);
  }

  if (reasons.length > 0) {
    return { comparable: false, total: null, breakdown: null, reasons };
  }
  const total = roundDecimal(addDecimal(addDecimal(amount, tax), shipping), 2);
  return {
    comparable: true,
    total: decimalToString(total, 2),
    breakdown: {
      amount: decimalToString(amount, 2),
      tax: decimalToString(tax, 2),
      shipping: decimalToString(shipping, 2),
      taxHandling,
    },
    reasons: [],
  };
}

// 形成可比结果：同一 sku 下每个 sourceId 取最新观察，逐条按观察时间解析生效规则。
export function buildComparison({ sku, observations, rules, generatedAt }) {
  const latestBySourceId = new Map();
  for (const observation of observations) {
    if (observation.label !== sku) continue;
    const current = latestBySourceId.get(observation.sourceId);
    if (!current || Date.parse(observation.observedAt) > Date.parse(current.observedAt)) {
      latestBySourceId.set(observation.sourceId, observation);
    }
  }
  const quotes = [...latestBySourceId.values()].map((observation) => {
    const rule = ruleForInstant(rules, observation.observedAt);
    const normalized = normalizeQuote(observation.components, rule);
    return {
      observation: { sourceId: observation.sourceId, observedAt: observation.observedAt },
      shop: observation.attributes.shop ?? null,
      sku,
      input: structuredClone(observation.components),
      declaredRuleVersion: observation.attributes.ruleVersion ?? null,
      rule: rule ? { version: rule.version, effectiveFrom: rule.effectiveFrom, taxRate: rule.taxRate } : null,
      ...normalized,
    };
  });
  quotes.sort((left, right) => {
    if (left.comparable && right.comparable) {
      return compareDecimal(parseDecimal(left.total), parseDecimal(right.total))
        || left.observation.sourceId.localeCompare(right.observation.sourceId);
    }
    if (left.comparable) return -1;
    if (right.comparable) return 1;
    return left.observation.sourceId.localeCompare(right.observation.sourceId);
  });
  const comparable = quotes.filter((quote) => quote.comparable);
  const currencies = [...new Set(quotes.map((quote) => quote.input.currency).filter(Boolean))];
  const singleCurrency = currencies.length <= 1;
  return {
    sku,
    generatedAt,
    definition: comparisonDefinition,
    quotes,
    summary: {
      comparable: comparable.length,
      incomparable: quotes.length - comparable.length,
      currencies,
      best: comparable.length > 0 && singleCurrency
        ? { sourceId: comparable[0].observation.sourceId, total: comparable[0].total, currency: comparable[0].input.currency }
        : null,
      note: singleCurrency ? null : '组内币种不一致，跨币种不直接比较',
    },
  };
}
