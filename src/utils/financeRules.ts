import type {
  BudgetLimit,
  CanonicalTransactionStatus,
  DriveAttachment,
  FinancialAccount,
  Transaction,
  TransactionKind,
  TransactionStatus,
} from '../types/finance';

export function formatVND(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0;
  return `${new Intl.NumberFormat('vi-VN').format(safe)} ₫`;
}

export function formatDateVN(isoDate?: string): string {
  if (!isoDate) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!match) return isoDate;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function getYearMonthDot(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(isoDate.trim());
  if (match) {
    return `${match[1]}.${match[2]}`;
  }
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  return `${y}.${m}`;
}

export function getYearMonthDash(isoDate: string): string {
  return getYearMonthDot(isoDate).replace('.', '-');
}

export function getDriveFolderParts(isoDate: string): {
  root: '5';
  year: string;
  month: string;
  path: string;
} {
  const ym = getYearMonthDot(isoDate);
  const [year, month] = ym.split('.');
  return {
    root: '5',
    year,
    month,
    path: `5/${year}/${month}`,
  };
}

export function buildTransactionCode(
  kind: TransactionKind,
  yearMonthDot: string,
  sequenceNumber: number
): string {
  const prefix = kind === 'income' ? 'KT' : 'KC';
  const seqStr = String(Math.max(1, Math.floor(sequenceNumber))).padStart(2, '0');
  return `${prefix}-${yearMonthDot}-${seqStr}`;
}

export function getFileExtension(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0 || idx === filename.length - 1) return '';
  return filename.slice(idx).toLowerCase();
}

export function buildDriveAttachmentName(
  txCode: string,
  originalFilename: string,
  existingAttachmentCount: number,
  incomingBatchSize: number,
  customBaseName?: string
): string {
  const ext = getFileExtension(originalFilename);
  const cleanedCustom = customBaseName
    ? customBaseName
        .trim()
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(new RegExp(`${ext.replace('.', '\\.')}$`, 'i'), '')
    : '';

  if (cleanedCustom) {
    return `${cleanedCustom}${ext}`;
  }

  const totalExpected = existingAttachmentCount + incomingBatchSize;
  if (totalExpected <= 1 && existingAttachmentCount === 0) {
    return `${txCode}${ext}`;
  }
  const index = existingAttachmentCount + 1;
  const seq = String(index).padStart(2, '0');
  return `${txCode}_${seq}${ext}`;
}

export function normalizeTransactionStatus(
  status: TransactionStatus | string
): CanonicalTransactionStatus {
  if (
    status === 'Đã thực hiện' ||
    status === 'Đã thu' ||
    status === 'Đã chi' ||
    status === 'Đã đối soát' ||
    status === 'Đã hoàn thành'
  ) {
    return 'Đã thực hiện';
  }
  if (status === 'Đã hủy') {
    return 'Đã hủy';
  }
  return 'Dự kiến';
}

export function isTransactionCancelled(
  status: TransactionStatus | string
): boolean {
  return status === 'Đã hủy';
}

export function isIncomeRealized(status: TransactionStatus | string): boolean {
  return (
    status === 'Đã thực hiện' ||
    status === 'Đã thu' ||
    status === 'Đã đối soát'
  );
}

export function isExpenseRealized(status: TransactionStatus | string): boolean {
  return (
    status === 'Đã thực hiện' ||
    status === 'Đã chi' ||
    status === 'Đã đối soát' ||
    status === 'Đã hoàn thành'
  );
}

export function isTransactionRealized(
  kind: TransactionKind,
  status: TransactionStatus | string
): boolean {
  if (isTransactionCancelled(status)) return false;
  return kind === 'income'
    ? isIncomeRealized(status)
    : isExpenseRealized(status);
}

export function getEffectiveTransactionAmount(
  tx: Pick<Transaction, 'amount' | 'actualAmount'>
): number {
  if (
    typeof tx.actualAmount === 'number' &&
    Number.isFinite(tx.actualAmount) &&
    tx.actualAmount > 0
  ) {
    return tx.actualAmount;
  }
  return Number.isFinite(tx.amount) ? tx.amount : 0;
}

export function getTransactionEffectiveDate(
  tx: Pick<Transaction, 'actualDate' | 'expectedDate' | 'startDate'>
): string {
  return tx.actualDate || tx.expectedDate || tx.startDate || '';
}

export interface FinancialSummary {
  totalAvailableBalance: number;
  totalCollectedIncome: number;
  totalPaidExpense: number;
  actualBalance: number;
  pendingIncome: number;
  pendingExpense: number;
  netRealizedCashflow: number;
}

export function computeFinancialSummary(
  accounts: FinancialAccount[],
  transactions: Transaction[]
): FinancialSummary {
  const totalAvailableBalance = accounts.reduce(
    (sum, acc) =>
      sum + (Number.isFinite(acc.currentBalance) ? acc.currentBalance : 0),
    0
  );

  let totalCollectedIncome = 0;
  let totalPaidExpense = 0;
  let pendingIncome = 0;
  let pendingExpense = 0;

  for (const tx of transactions) {
    if (isTransactionCancelled(tx.status)) continue;
    const val = getEffectiveTransactionAmount(tx);
    if (tx.kind === 'income') {
      if (isIncomeRealized(tx.status)) {
        totalCollectedIncome += val;
      } else {
        pendingIncome += tx.amount;
      }
    } else {
      if (isExpenseRealized(tx.status)) {
        totalPaidExpense += val;
      } else {
        pendingExpense += tx.amount;
      }
    }
  }

  return {
    totalAvailableBalance,
    totalCollectedIncome,
    totalPaidExpense,
    actualBalance: totalAvailableBalance,
    pendingIncome,
    pendingExpense,
    netRealizedCashflow: totalCollectedIncome - totalPaidExpense,
  };
}

export function computeAccountBalanceDelta(
  kind: TransactionKind,
  wasRealized: boolean,
  isNowRealized: boolean,
  prevEffectiveAmount: number,
  nextEffectiveAmount: number
): number {
  const sign = kind === 'income' ? 1 : -1;
  const prevImpact = wasRealized ? sign * prevEffectiveAmount : 0;
  const nextImpact = isNowRealized ? sign * nextEffectiveAmount : 0;
  return nextImpact - prevImpact;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateTransactionStatusChange(
  kind: TransactionKind,
  nextStatus: TransactionStatus,
  actualDate: string | undefined,
  attachments: DriveAttachment[],
  accountId: string | undefined,
  markArchived: boolean
): ValidationResult {
  if (isTransactionCancelled(nextStatus)) {
    return { valid: true };
  }
  if (kind === 'income') {
    if (isIncomeRealized(nextStatus) || markArchived) {
      if (!accountId) {
        return {
          valid: false,
          error: 'Vui lòng chọn tài khoản nhận tiền trước khi xác nhận đã thực hiện.',
        };
      }
      if (!actualDate || !actualDate.trim()) {
        return {
          valid: false,
          error: 'Vui lòng nhập ngày thực tế nhận tiền.',
        };
      }
      if (attachments.length === 0) {
        return {
          valid: false,
          error:
            'Khoản thu đã thực hiện bắt buộc phải có chứng từ hoặc hình ảnh xác nhận.',
        };
      }
    }
  } else {
    if (isExpenseRealized(nextStatus) || markArchived) {
      if (!actualDate || !actualDate.trim()) {
        return {
          valid: false,
          error:
            'Khi đánh dấu đã thực hiện hoặc hoàn thành, bắt buộc phải nhập ngày chính thức chi tiền.',
        };
      }
      if (attachments.length === 0) {
        return {
          valid: false,
          error:
            'Không cho phép đánh dấu đã thực hiện hoặc lưu trữ nếu chưa có hóa đơn/chứng từ hợp lệ.',
        };
      }
    }
  }
  return { valid: true };
}

export type BudgetAlertLevel = 'ok' | 'warn_80' | 'warn_90' | 'over_100';

export interface BudgetEvaluation {
  budget: BudgetLimit;
  spent: number;
  remaining: number;
  percent: number;
  alertLevel: BudgetAlertLevel;
}

export function evaluateBudget(
  budget: BudgetLimit,
  transactions: Transaction[]
): BudgetEvaluation {
  let spent = 0;

  for (const tx of transactions) {
    if (tx.kind !== 'expense') continue;
    if (isTransactionCancelled(tx.status)) continue;
    const txDate = getTransactionEffectiveDate(tx);
    const txMonth = txDate ? getYearMonthDash(txDate) : '';
    if (budget.yearMonth !== 'ALL' && txMonth !== budget.yearMonth) {
      continue;
    }

    let matches = false;
    switch (budget.scopeType) {
      case 'category':
        matches = tx.category === budget.scopeValue;
        break;
      case 'month':
        matches = txMonth === budget.scopeValue;
        break;
      case 'purpose':
        matches =
          (tx.purposeTag || '').trim().toLowerCase() ===
            budget.scopeValue.trim().toLowerCase() ||
          (tx.reason || '').trim().toLowerCase() ===
            budget.scopeValue.trim().toLowerCase();
        break;
      case 'work':
        matches =
          (tx.purposeTag || '').trim().toLowerCase() ===
            budget.scopeValue.trim().toLowerCase() ||
          (tx.workDuration || '').trim().toLowerCase() ===
            budget.scopeValue.trim().toLowerCase() ||
          tx.name.trim().toLowerCase().includes(budget.scopeValue.trim().toLowerCase());
        break;
    }

    if (matches) {
      spent += getEffectiveTransactionAmount(tx);
    }
  }

  const limit = budget.limitAmount > 0 ? budget.limitAmount : 1;
  const percent = (spent / limit) * 100;
  const remaining = budget.limitAmount - spent;

  let alertLevel: BudgetAlertLevel = 'ok';
  if (percent >= 100) {
    alertLevel = 'over_100';
  } else if (percent >= 90) {
    alertLevel = 'warn_90';
  } else if (percent >= 80) {
    alertLevel = 'warn_80';
  }

  return {
    budget,
    spent,
    remaining,
    percent,
    alertLevel,
  };
}

export type ReminderSeverity = 'overdue' | 'due_today' | 'upcoming';

export interface TransactionReminder {
  transaction: Transaction;
  severity: ReminderSeverity;
  daysDiff: number;
  message: string;
}

function parseIsoDayUtc(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function computeTransactionReminders(
  transactions: Transaction[],
  todayIso: string,
  leadDays = 3
): TransactionReminder[] {
  const todayUtc = parseIsoDayUtc(todayIso);
  if (todayUtc === null) return [];

  const msPerDay = 86400000;
  const reminders: TransactionReminder[] = [];

  for (const tx of transactions) {
    if (tx.isArchived) continue;
    if (isTransactionCancelled(tx.status)) continue;
    if (isTransactionRealized(tx.kind, tx.status)) continue;
    if (!tx.expectedDate) continue;

    const targetUtc = parseIsoDayUtc(tx.expectedDate);
    if (targetUtc === null) continue;

    const daysDiff = Math.round((targetUtc - todayUtc) / msPerDay);

    if (daysDiff < 0) {
      const overdueDays = Math.abs(daysDiff);
      reminders.push({
        transaction: tx,
        severity: 'overdue',
        daysDiff,
        message:
          tx.kind === 'income'
            ? `Khoản thu quá hạn ${overdueDays} ngày (dự kiến ${formatDateVN(tx.expectedDate)})`
            : `Khoản chi quá hạn ${overdueDays} ngày (hạn ${formatDateVN(tx.expectedDate)})`,
      });
    } else if (daysDiff === 0) {
      reminders.push({
        transaction: tx,
        severity: 'due_today',
        daysDiff: 0,
        message:
          tx.kind === 'income'
            ? `Hôm nay đến ngày dự kiến nhận tiền (${formatDateVN(tx.expectedDate)})`
            : `Hôm nay đến hạn thanh toán (${formatDateVN(tx.expectedDate)})`,
      });
    } else if (daysDiff <= leadDays) {
      reminders.push({
        transaction: tx,
        severity: 'upcoming',
        daysDiff,
        message:
          tx.kind === 'income'
            ? `Còn ${daysDiff} ngày tới hạn dự kiến nhận (${formatDateVN(tx.expectedDate)})`
            : `Còn ${daysDiff} ngày tới hạn thanh toán (${formatDateVN(tx.expectedDate)})`,
      });
    }
  }

  const weight: Record<ReminderSeverity, number> = {
    overdue: 0,
    due_today: 1,
    upcoming: 2,
  };

  return reminders.sort((a, b) => {
    if (weight[a.severity] !== weight[b.severity]) {
      return weight[a.severity] - weight[b.severity];
    }
    return a.daysDiff - b.daysDiff;
  });
}

export interface MonthlyAggregate {
  month: number;
  label: string;
  income: number;
  expense: number;
  net: number;
}

export function computeMonthlySeries(
  transactions: Transaction[],
  year: number
): MonthlyAggregate[] {
  const buckets: MonthlyAggregate[] = Array.from({ length: 12 }, (_, idx) => ({
    month: idx + 1,
    label: `T${String(idx + 1).padStart(2, '0')}`,
    income: 0,
    expense: 0,
    net: 0,
  }));

  for (const tx of transactions) {
    if (!isTransactionRealized(tx.kind, tx.status)) continue;
    const dateStr = getTransactionEffectiveDate(tx);
    const match = /^(\d{4})-(\d{2})/.exec(dateStr);
    if (!match) continue;
    const txYear = Number(match[1]);
    const txMonth = Number(match[2]);
    if (txYear !== year || txMonth < 1 || txMonth > 12) continue;

    const val = getEffectiveTransactionAmount(tx);
    if (tx.kind === 'income') {
      buckets[txMonth - 1].income += val;
    } else {
      buckets[txMonth - 1].expense += val;
    }
  }

  for (const b of buckets) {
    b.net = b.income - b.expense;
  }

  return buckets;
}

export interface CategoryBreakdownItem {
  category: string;
  amount: number;
  percentage: number;
}

export function computeCategoryBreakdown(
  transactions: Transaction[],
  kind: TransactionKind = 'expense'
): CategoryBreakdownItem[] {
  const totals = new Map<string, number>();
  let grandTotal = 0;

  for (const tx of transactions) {
    if (tx.kind !== kind) continue;
    if (!isTransactionRealized(tx.kind, tx.status)) continue;
    const val = getEffectiveTransactionAmount(tx);
    totals.set(tx.category, (totals.get(tx.category) || 0) + val);
    grandTotal += val;
  }

  if (grandTotal === 0) return [];

  return Array.from(totals.entries())
    .map(([category, amount]) => ({
      category,
      amount,
      percentage: (amount / grandTotal) * 100,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export interface BalancePoint {
  date: string;
  label: string;
  balance: number;
}

export function computeBalanceTimeline(
  accounts: FinancialAccount[],
  transactions: Transaction[]
): BalancePoint[] {
  const initialTotal = accounts.reduce(
    (sum, acc) =>
      sum + (Number.isFinite(acc.initialBalance) ? acc.initialBalance : 0),
    0
  );

  const realized = transactions
    .filter((tx) => isTransactionRealized(tx.kind, tx.status))
    .map((tx) => ({
      date: getTransactionEffectiveDate(tx),
      delta:
        tx.kind === 'income'
          ? getEffectiveTransactionAmount(tx)
          : -getEffectiveTransactionAmount(tx),
    }))
    .filter((item) => Boolean(item.date))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (realized.length === 0) {
    return [];
  }

  const dailyMap = new Map<string, number>();
  for (const item of realized) {
    dailyMap.set(item.date, (dailyMap.get(item.date) || 0) + item.delta);
  }

  let running = initialTotal;
  const points: BalancePoint[] = [];
  for (const [date, delta] of Array.from(dailyMap.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    running += delta;
    points.push({
      date,
      label: formatDateVN(date),
      balance: running,
    });
  }
  return points;
}

export type TransactionSortField = 'date' | 'amount' | 'status';
export type SortDirection = 'asc' | 'desc';

export function sortTransactions(
  transactions: Transaction[],
  field: TransactionSortField,
  direction: SortDirection
): Transaction[] {
  const factor = direction === 'asc' ? 1 : -1;
  return [...transactions].sort((a, b) => {
    let cmp = 0;
    if (field === 'date') {
      const dateA = getTransactionEffectiveDate(a);
      const dateB = getTransactionEffectiveDate(b);
      cmp = dateA.localeCompare(dateB);
    } else if (field === 'amount') {
      const amtA = getEffectiveTransactionAmount(a);
      const amtB = getEffectiveTransactionAmount(b);
      cmp = amtA - amtB;
    } else if (field === 'status') {
      const normA = normalizeTransactionStatus(a.status);
      const normB = normalizeTransactionStatus(b.status);
      cmp = normA.localeCompare(normB, 'vi');
      if (cmp === 0) {
        cmp = a.status.localeCompare(b.status, 'vi');
      }
    }

    if (cmp !== 0) {
      return cmp * factor;
    }
    return b.code.localeCompare(a.code);
  });
}

export interface ExpenseForecastPoint {
  yearMonth: string;
  label: string;
  amount: number;
  isForecast: boolean;
}

export interface ExpenseForecastResult {
  history: ExpenseForecastPoint[];
  forecast: ExpenseForecastPoint[];
  averageMonthly: number;
  slopePerMonth: number;
  trendDirection: 'up' | 'down' | 'stable';
  projectedNextMonth: number;
  projectedTotal: number;
}

function addYearMonth(yearMonth: string, offset: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!m) return yearMonth;
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + offset;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function formatYearMonthShort(yearMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!m) return yearMonth;
  return `T${m[2]}/${m[1]}`;
}

export function computeExpenseForecast(
  transactions: Transaction[],
  options?: {
    category?: string;
    forecastMonths?: number;
    historyWindow?: number;
  }
): ExpenseForecastResult {
  const forecastMonths = Math.max(1, options?.forecastMonths ?? 3);
  const historyWindow = Math.max(2, options?.historyWindow ?? 6);
  const categoryFilter = options?.category;

  const monthlyTotals = new Map<string, number>();

  for (const tx of transactions) {
    if (tx.kind !== 'expense') continue;
    if (!isExpenseRealized(tx.status)) continue;
    if (categoryFilter && categoryFilter !== 'ALL' && tx.category !== categoryFilter) {
      continue;
    }

    const dateStr = getTransactionEffectiveDate(tx);
    const match = /^(\d{4})-(\d{2})/.exec(dateStr);
    if (!match) continue;
    const ym = `${match[1]}-${match[2]}`;
    const amt = getEffectiveTransactionAmount(tx);
    monthlyTotals.set(ym, (monthlyTotals.get(ym) || 0) + amt);
  }

  if (monthlyTotals.size === 0) {
    return {
      history: [],
      forecast: [],
      averageMonthly: 0,
      slopePerMonth: 0,
      trendDirection: 'stable',
      projectedNextMonth: 0,
      projectedTotal: 0,
    };
  }

  const sortedMonths = Array.from(monthlyTotals.keys()).sort();
  const firstYm = sortedMonths[0];
  const lastYm = sortedMonths[sortedMonths.length - 1];

  const [y1, m1] = firstYm.split('-').map(Number);
  const [y2, m2] = lastYm.split('-').map(Number);
  const spanMonths = (y2 - y1) * 12 + (m2 - m1) + 1;
  const startOffset = Math.max(0, spanMonths - historyWindow);

  const history: ExpenseForecastPoint[] = [];
  for (let i = startOffset; i < spanMonths; i++) {
    const ym = addYearMonth(firstYm, i);
    history.push({
      yearMonth: ym,
      label: formatYearMonthShort(ym),
      amount: Math.round(monthlyTotals.get(ym) || 0),
      isForecast: false,
    });
  }

  const n = history.length;
  const ys = history.map((h) => h.amount);
  const averageMonthly = ys.reduce((sum, v) => sum + v, 0) / n;

  let slopePerMonth = 0;
  let intercept = averageMonthly;

  if (n >= 2) {
    const meanX = (n - 1) / 2;
    let sumXX = 0;
    let sumXY = 0;
    for (let i = 0; i < n; i++) {
      const dx = i - meanX;
      const dy = ys[i] - averageMonthly;
      sumXX += dx * dx;
      sumXY += dx * dy;
    }
    slopePerMonth = sumXX > 0 ? sumXY / sumXX : 0;
    intercept = averageMonthly - slopePerMonth * meanX;
  }

  const forecast: ExpenseForecastPoint[] = [];
  for (let k = 1; k <= forecastMonths; k++) {
    const ym = addYearMonth(lastYm, k);
    const rawProjected = intercept + slopePerMonth * (n - 1 + k);
    forecast.push({
      yearMonth: ym,
      label: formatYearMonthShort(ym),
      amount: Math.max(0, Math.round(rawProjected)),
      isForecast: true,
    });
  }

  let trendDirection: 'up' | 'down' | 'stable' = 'stable';
  if (n >= 2 && averageMonthly > 0) {
    if (slopePerMonth > averageMonthly * 0.03) {
      trendDirection = 'up';
    } else if (slopePerMonth < -averageMonthly * 0.03) {
      trendDirection = 'down';
    }
  } else if (n >= 2 && slopePerMonth > 0) {
    trendDirection = 'up';
  }

  const projectedNextMonth = forecast[0]?.amount ?? 0;
  const projectedTotal = forecast.reduce((sum, item) => sum + item.amount, 0);

  return {
    history,
    forecast,
    averageMonthly: Math.round(averageMonthly),
    slopePerMonth: Math.round(slopePerMonth),
    trendDirection,
    projectedNextMonth,
    projectedTotal,
  };
}

export interface AccountAllocationItem {
  account: FinancialAccount;
  percentage: number;
}

export interface AccountAllocationSummary {
  totalBalance: number;
  positiveTotal: number;
  items: AccountAllocationItem[];
  byType: Record<FinancialAccount['type'], { count: number; total: number; percentage: number }>;
}

export function computeAccountAllocation(
  accounts: FinancialAccount[]
): AccountAllocationSummary {
  const totalBalance = accounts.reduce(
    (sum, acc) => sum + (Number.isFinite(acc.currentBalance) ? acc.currentBalance : 0),
    0
  );
  const positiveTotal = accounts.reduce(
    (sum, acc) => sum + (Number.isFinite(acc.currentBalance) && acc.currentBalance > 0 ? acc.currentBalance : 0),
    0
  );

  const byType: AccountAllocationSummary['byType'] = {
    cash: { count: 0, total: 0, percentage: 0 },
    bank: { count: 0, total: 0, percentage: 0 },
    ewallet: { count: 0, total: 0, percentage: 0 },
  };

  for (const acc of accounts) {
    const bal = Number.isFinite(acc.currentBalance) ? acc.currentBalance : 0;
    byType[acc.type].count += 1;
    byType[acc.type].total += bal;
  }

  for (const key of ['cash', 'bank', 'ewallet'] as const) {
    byType[key].percentage =
      positiveTotal > 0 && byType[key].total > 0
        ? (byType[key].total / positiveTotal) * 100
        : 0;
  }

  const items: AccountAllocationItem[] = accounts.map((account) => {
    const bal = Number.isFinite(account.currentBalance) ? account.currentBalance : 0;
    const percentage = positiveTotal > 0 && bal > 0 ? (bal / positiveTotal) * 100 : 0;
    return { account, percentage };
  });

  return { totalBalance, positiveTotal, items, byType };
}

export interface ArchiveSummary {
  archivedIncomeCount: number;
  archivedIncomeTotal: number;
  archivedExpenseCount: number;
  archivedExpenseTotal: number;
  totalAttachments: number;
}

export function computeArchiveSummary(transactions: Transaction[]): ArchiveSummary {
  let archivedIncomeCount = 0;
  let archivedIncomeTotal = 0;
  let archivedExpenseCount = 0;
  let archivedExpenseTotal = 0;
  let totalAttachments = 0;

  for (const tx of transactions) {
    if (!tx.isArchived) continue;
    const amt = getEffectiveTransactionAmount(tx);
    totalAttachments += tx.attachments.length;
    if (tx.kind === 'income') {
      archivedIncomeCount += 1;
      archivedIncomeTotal += amt;
    } else {
      archivedExpenseCount += 1;
      archivedExpenseTotal += amt;
    }
  }

  return {
    archivedIncomeCount,
    archivedIncomeTotal,
    archivedExpenseCount,
    archivedExpenseTotal,
    totalAttachments,
  };
}

export function addExpenseCategory(
  list: readonly string[],
  rawName: string
): { next: string[]; added?: string; error?: string } {
  const clean = rawName.trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!clean) {
    return { next: [...list], error: 'Vui lòng nhập tên danh mục chi tiêu.' };
  }
  const exists = list.some((c) => c.trim().toLowerCase() === clean.toLowerCase());
  if (exists) {
    return { next: [...list], error: `Danh mục "${clean}" đã tồn tại.` };
  }
  if (list.length >= 100) {
    return { next: [...list], error: 'Đã đạt giới hạn tối đa 100 danh mục.' };
  }
  return { next: [...list, clean], added: clean };
}

export function removeExpenseCategory(
  list: readonly string[],
  target: string
): { next: string[]; error?: string } {
  if (list.length <= 1) {
    return { next: [...list], error: 'Phải giữ lại ít nhất 1 danh mục chi tiêu.' };
  }
  const filtered = list.filter((c) => c !== target);
  if (filtered.length === list.length) {
    return { next: [...list] };
  }
  return { next: filtered };
}

export function mergeExpenseCategories(
  userCategories: readonly string[] | undefined,
  transactions: readonly Pick<Transaction, 'kind' | 'category'>[]
): string[] {
  const base = userCategories ? [...userCategories] : [];
  const seen = new Set(base.map((c) => c.trim().toLowerCase()));
  for (const tx of transactions) {
    if (tx.kind !== 'expense') continue;
    const cat = tx.category?.trim();
    if (cat && !seen.has(cat.toLowerCase())) {
      seen.add(cat.toLowerCase());
      base.push(cat);
    }
  }
  return base;
}

export interface BalanceForecastScheduledItem {
  code: string;
  name: string;
  kind: TransactionKind;
  amount: number;
}

export interface BalanceForecastPoint {
  date: string;
  label: string;
  balance: number;
  isForecast: boolean;
  isTodayAnchor?: boolean;
  delta?: number;
  scheduledItems?: BalanceForecastScheduledItem[];
}

export interface BalanceForecastResult {
  history: BalanceForecastPoint[];
  forecast: BalanceForecastPoint[];
  currentBalance: number;
  projectedEndBalance: number;
  projectedNetChange: number;
  scheduledIncomeTotal: number;
  scheduledExpenseTotal: number;
  scheduledCount: number;
  lowestProjectedBalance: number;
  lowestProjectedDate: string | null;
  hasNegativeRisk: boolean;
}

export function computeBalanceForecast(
  accounts: FinancialAccount[],
  transactions: Transaction[],
  options?: {
    todayIso?: string;
    horizonDays?: number | null;
    historyLimit?: number;
  }
): BalanceForecastResult {
  const todayIso =
    options?.todayIso && /^\d{4}-\d{2}-\d{2}/.test(options.todayIso)
      ? options.todayIso.slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  const horizonDays = options?.horizonDays ?? null;
  const historyLimit = Math.max(5, options?.historyLimit ?? 24);

  const currentBalance = accounts.reduce(
    (sum, acc) => sum + (Number.isFinite(acc.currentBalance) ? acc.currentBalance : 0),
    0
  );

  const rawTimeline = computeBalanceTimeline(accounts, transactions);
  const trimmedTimeline =
    rawTimeline.length > historyLimit
      ? rawTimeline.slice(rawTimeline.length - historyLimit)
      : rawTimeline;

  const history: BalanceForecastPoint[] = trimmedTimeline.map((pt) => ({
    date: pt.date,
    label: pt.label,
    balance: pt.balance,
    isForecast: false,
  }));

  const todayUtc = parseIsoDayUtc(todayIso);
  const msPerDay = 86400000;

  const scheduledMap = new Map<
    string,
    { delta: number; items: BalanceForecastScheduledItem[] }
  >();

  let scheduledIncomeTotal = 0;
  let scheduledExpenseTotal = 0;
  let scheduledCount = 0;

  for (const tx of transactions) {
    if (tx.isArchived) continue;
    if (isTransactionCancelled(tx.status)) continue;
    if (isTransactionRealized(tx.kind, tx.status)) continue;

    const scheduledDate = (tx.expectedDate || '').slice(0, 10);
    if (!scheduledDate) continue;
    const targetUtc = parseIsoDayUtc(scheduledDate);
    if (targetUtc === null || todayUtc === null) continue;

    const daysDiff = Math.round((targetUtc - todayUtc) / msPerDay);
    if (daysDiff < 0) continue;
    if (horizonDays !== null && horizonDays > 0 && daysDiff > horizonDays) continue;

    const amt = getEffectiveTransactionAmount(tx);
    if (amt <= 0) continue;

    const signedDelta = tx.kind === 'income' ? amt : -amt;
    if (tx.kind === 'income') {
      scheduledIncomeTotal += amt;
    } else {
      scheduledExpenseTotal += amt;
    }
    scheduledCount += 1;

    const bucket = scheduledMap.get(scheduledDate) || { delta: 0, items: [] };
    bucket.delta += signedDelta;
    bucket.items.push({
      code: tx.code,
      name: tx.name,
      kind: tx.kind,
      amount: amt,
    });
    scheduledMap.set(scheduledDate, bucket);
  }

  const sortedFutureDates = Array.from(scheduledMap.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  // Anchor today's real balance when there is a gap or no realized history yet
  if (
    (history.length === 0 && (accounts.length > 0 || sortedFutureDates.length > 0)) ||
    (history.length > 0 && history[history.length - 1].date < todayIso)
  ) {
    history.push({
      date: todayIso,
      label: formatDateVN(todayIso),
      balance: currentBalance,
      isForecast: false,
      isTodayAnchor: true,
    });
  }

  let running = currentBalance;
  const forecast: BalanceForecastPoint[] = [];

  for (const date of sortedFutureDates) {
    const bucket = scheduledMap.get(date)!;
    running += bucket.delta;
    forecast.push({
      date,
      label: formatDateVN(date),
      balance: running,
      isForecast: true,
      delta: bucket.delta,
      scheduledItems: bucket.items,
    });
  }

  const projectedEndBalance =
    forecast.length > 0 ? forecast[forecast.length - 1].balance : currentBalance;
  const projectedNetChange = projectedEndBalance - currentBalance;

  let lowestProjectedBalance = currentBalance;
  let lowestProjectedDate: string | null = history.length > 0 ? history[history.length - 1].date : null;

  for (const pt of forecast) {
    if (pt.balance < lowestProjectedBalance) {
      lowestProjectedBalance = pt.balance;
      lowestProjectedDate = pt.date;
    }
  }

  return {
    history,
    forecast,
    currentBalance,
    projectedEndBalance,
    projectedNetChange,
    scheduledIncomeTotal,
    scheduledExpenseTotal,
    scheduledCount,
    lowestProjectedBalance,
    lowestProjectedDate,
    hasNegativeRisk: forecast.some((pt) => pt.balance < 0),
  };
}



