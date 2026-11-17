// 口径引擎：把来源报价在“带生效范围的规则”下换算成可比结果。
// 口径不足时返回带原因的 incomparable，绝不把未知运费/税费口径补成零。
import { addMoney, applyRate, formatMoney, parseDecimal, roundToMoney } from './money.js';
import { ruleSnapshot } from './rules.js';

export const REASON = Object.freeze({
  AMOUNT_MISSING: 'AMOUNT_MISSING',
  CURRENCY_MISSING: 'CURRENCY_MISSING',
  TAX_SCOPE_UNKNOWN: 'TAX_SCOPE_UNKNOWN',
  SHIPPING_UNKNOWN: 'SHIPPING_UNKNOWN',
  GROUP_CURRENCY_MISMATCH: 'GROUP_CURRENCY_MISMATCH',
});

const MESSAGES = {
  [REASON.AMOUNT_MISSING]: '来源未给出金额，缺少换算基数',
  [REASON.CURRENCY_MISSING]: '来源未给出币种，无法确认计价单位',
  [REASON.TAX_SCOPE_UNKNOWN]: '来源未说明金额是否含税（null 表示未知），无法统一为含税口径，也不按零税率处理',
  [REASON.SHIPPING_UNKNOWN]: '来源未给出运费口径（null 表示未知而非零运费），不能默认补零运费计算到手价',
  [REASON.GROUP_CURRENCY_MISMATCH]: '组内报价币种不一致，当前规则没有汇率换算，不能直接比较',
};

function reason(code, detail) {
  return { code, message: MESSAGES[code], ...(detail ? { detail } : {}) };
}

function knownDecimal(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// 评估单条观察。rule 是已按生效范围选定的规则；返回值同时保留口径判断与可比金额。
export function evaluateObservation(observation, rule) {
  const price = observation.price ?? {};
  const reasons = [];

  if (!knownDecimal(price.amount)) reasons.push(reason(REASON.AMOUNT_MISSING));
  if (typeof price.currency !== 'string' || price.currency.trim() === '') {
    reasons.push(reason(REASON.CURRENCY_MISSING));
  }
  if (price.taxIncluded !== true && price.taxIncluded !== false) {
    reasons.push(reason(REASON.TAX_SCOPE_UNKNOWN));
  }
  // null 是“来源未写”，不是零；只有来源明示的十进制字符串才是已知运费。
  if (!knownDecimal(price.shipping)) {
    reasons.push(reason(REASON.SHIPPING_UNKNOWN));
  }

  const evaluation = {
    observationId: observation.observationId,
    sourceId: observation.sourceId,
    sku: observation.sku,
    shop: observation.shop ?? null,
    observedAt: observation.observedAt,
    currency: typeof price.currency === 'string' ? price.currency : null,
    status: reasons.length ? 'incomparable' : 'comparable',
    reasons,
    components: null,
    rule: ruleSnapshot(rule),
  };

  if (reasons.length) return evaluation;

  const listed = parseDecimal(price.amount, 'amount');
  const rate = parseDecimal(rule.taxRate, 'taxRate');
  const shipping = parseDecimal(price.shipping, 'shipping');

  let taxAmount;
  let taxIncludedAmount;
  if (price.taxIncluded) {
    // 含税金额反推不含税净额：net = listed / (1 + rate)，再以差额计税额。
    const one = parseDecimal('1');
    const divisor = one + rate;
    const netOfTax = roundToMoney((listed * one) / divisor);
    taxAmount = roundToMoney(listed - netOfTax);
    taxIncludedAmount = roundToMoney(listed);
  } else {
    taxAmount = applyRate(listed, rate);
    taxIncludedAmount = addMoney(listed, taxAmount);
  }
  const landedPrice = addMoney(taxIncludedAmount, shipping);

  evaluation.components = {
    listedAmount: formatMoney(roundToMoney(listed)),
    taxAmount: formatMoney(taxAmount),
    taxIncludedAmount: formatMoney(taxIncludedAmount),
    shippingAmount: formatMoney(roundToMoney(shipping)),
    shippingIncluded: true,
    landedPrice: formatMoney(landedPrice),
  };
  return evaluation;
}

// 组级比较：所有成员都可比且币种一致才给出可比结果，否则整组标记不可比并逐行解释。
export function compareObservations(observations, rule) {
  const evaluations = observations.map((observation) => evaluateObservation(observation, rule));
  const currencies = new Set(evaluations.map((item) => item.currency).filter(Boolean));
  const groupReasons = [];
  if (currencies.size > 1) {
    groupReasons.push(reason(REASON.GROUP_CURRENCY_MISMATCH, { currencies: [...currencies] }));
  }

  const allComparable = evaluations.every((item) => item.status === 'comparable');
  const status = allComparable && groupReasons.length === 0 ? 'comparable' : 'incomparable';
  if (groupReasons.length) {
    for (const item of evaluations) {
      item.status = 'incomparable';
      item.reasons.push(...groupReasons);
    }
  }

  const ranking = status === 'comparable'
    ? [...evaluations]
      .sort((left, right) => {
        const byPrice = left.components.landedPrice.localeCompare(right.components.landedPrice);
        return byPrice !== 0 ? byPrice : left.sourceId.localeCompare(right.sourceId);
      })
      .map((item) => ({ sourceId: item.sourceId, sku: item.sku, landedPrice: item.components.landedPrice, currency: item.currency }))
    : null;

  return {
    status,
    currency: currencies.size === 1 ? [...currencies][0] : null,
    rule: ruleSnapshot(rule),
    evaluations,
    ranking,
  };
}
