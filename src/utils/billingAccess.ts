export type BillingPlan = 'monthly' | 'yearly' | 'prepaid_month';
export type SubscriptionStatus = 'none' | 'active' | 'canceling' | 'past_due' | 'canceled';

export function isBillingPlan(value: unknown): value is BillingPlan {
  return value === 'monthly' || value === 'yearly' || value === 'prepaid_month';
}

const PRO_STATUSES = new Set<SubscriptionStatus>(['active', 'canceling', 'past_due']);

/** Waffo often sends `currentPeriodEnd` as a date (`YYYY-MM-DD`), not a timestamp. */
export function periodEndMs(periodEnd?: string | null): number | null {
  if (!periodEnd) return null;
  const trimmed = periodEnd.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const end = Date.parse(`${trimmed}T23:59:59.999Z`);
    return Number.isNaN(end) ? null : end;
  }
  const end = Date.parse(trimmed);
  return Number.isNaN(end) ? null : end;
}

/**
 * Hosted AI stays on through canceling / past_due until Waffo sends canceled.
 * Prepaid WeChat months have no cancel event — they expire at current_period_end.
 */
export function hasProAccess(
  status: string | null | undefined,
  periodEnd?: string | null,
  plan?: string | null,
): boolean {
  if (!status || !PRO_STATUSES.has(status as SubscriptionStatus)) return false;
  const honorPeriod = status === 'canceling' || plan === 'prepaid_month';
  if (!honorPeriod) return true;
  const end = periodEndMs(periodEnd);
  if (plan === 'prepaid_month' && end === null) return false;
  if (end !== null && end < Date.now()) return false;
  return true;
}
