import type {
  AccountType,
  BudgetLimit,
  CanonicalTransactionStatus,
  DriveAttachment,
  FinancialAccount,
  SavingsGoal,
  Transaction,
  TransactionKind,
  TransactionStatus,
} from '../types/finance';

export function toVndInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

export function formatVND(amount: number): string {
  const safe = toVndInt(amount);
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

export function getTransactionCodePrefix(kind: TransactionKind): 'KT' | 'KC' | 'CK' {
  if (kind === 'income') return 'KT';
  if (kind === 'transfer') return 'CK';
  return 'KC';
}

export function buildTransactionCode(
  kind: TransactionKind,
  yearMonthDot: string,
  sequenceNumber: number
): string {
  const prefix = getTransactionCodePrefix(kind);
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

export function isTransferRealized(status: TransactionStatus | string): boolean {
  return (
    status === 'Đã thực hiện' ||
    status === 'Đã đối soát' ||
    status === 'Đã hoàn thành'
  );
}

export function isTransactionRealized(
  kind: TransactionKind,
  status: TransactionStatus | string
): boolean {
  if (isTransactionCancelled(status)) return false;
  if (kind === 'income') return isIncomeRealized(status);
  if (kind === 'transfer') return isTransferRealized(status);
  return isExpenseRealized(status);
}

export function getEffectiveTransactionAmount(
  tx: Pick<Transaction, 'amount' | 'actualAmount'>
): number {
  if (
    typeof tx.actualAmount === 'number' &&
    Number.isFinite(tx.actualAmount) &&
    tx.actualAmount > 0
  ) {
    return toVndInt(tx.actualAmount);
  }
  return toVndInt(tx.amount);
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
  totalTransferVolume: number;
}

export function computeFinancialSummary(
  accounts: FinancialAccount[],
  transactions: Transaction[]
): FinancialSummary {
  const totalAvailableBalance = accounts.reduce(
    (sum, acc) => sum + toVndInt(acc.currentBalance),
    0
  );

  let totalCollectedIncome = 0;
  let totalPaidExpense = 0;
  let pendingIncome = 0;
  let pendingExpense = 0;
  let totalTransferVolume = 0;

  for (const tx of transactions) {
    if (isTransactionCancelled(tx.status)) continue;
    const val = getEffectiveTransactionAmount(tx);
    // Internal transfers must NEVER be counted as income or expense
    if (tx.kind === 'transfer') {
      if (isTransferRealized(tx.status)) {
        totalTransferVolume += val;
      }
      continue;
    }
    if (tx.kind === 'income') {
      if (isIncomeRealized(tx.status)) {
        totalCollectedIncome += val;
      } else {
        pendingIncome += toVndInt(tx.amount);
      }
    } else {
      if (isExpenseRealized(tx.status)) {
        totalPaidExpense += val;
      } else {
        pendingExpense += toVndInt(tx.amount);
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
    totalTransferVolume,
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
  const prevImpact = wasRealized ? sign * toVndInt(prevEffectiveAmount) : 0;
  const nextImpact = isNowRealized ? sign * toVndInt(nextEffectiveAmount) : 0;
  return nextImpact - prevImpact;
}

export function computeTransferDestinationDelta(
  wasRealized: boolean,
  isNowRealized: boolean,
  prevEffectiveAmount: number,
  nextEffectiveAmount: number
): number {
  const prevImpact = wasRealized ? toVndInt(prevEffectiveAmount) : 0;
  const nextImpact = isNowRealized ? toVndInt(nextEffectiveAmount) : 0;
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
  markArchived: boolean,
  toAccountId?: string,
  requireProof = true
): ValidationResult {
  if (isTransactionCancelled(nextStatus)) {
    return { valid: true };
  }
  if (kind === 'transfer') {
    if (!accountId) {
      return {
        valid: false,
        error: 'Vui lòng chọn tài khoản nguồn chuyển đi.',
      };
    }
    if (!toAccountId) {
      return {
        valid: false,
        error: 'Vui lòng chọn tài khoản đích nhận chuyển khoản nội bộ.',
      };
    }
    if (accountId === toAccountId) {
      return {
        valid: false,
        error: 'Tài khoản nguồn và tài khoản đích không được trùng nhau.',
      };
    }
    if (isTransferRealized(nextStatus) || markArchived) {
      if (!actualDate || !actualDate.trim()) {
        return {
          valid: false,
          error: 'Vui lòng nhập ngày thực tế chuyển khoản.',
        };
      }
    }
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
      if (requireProof && attachments.length === 0) {
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
      if (requireProof && attachments.length === 0) {
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

  const limit = budget.limitAmount > 0 ? toVndInt(budget.limitAmount) : 1;
  const percent = (spent / limit) * 100;
  const remaining = toVndInt(budget.limitAmount) - spent;

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
            : tx.kind === 'transfer'
            ? `Lệnh chuyển khoản quá hạn ${overdueDays} ngày (dự kiến ${formatDateVN(tx.expectedDate)})`
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
            : tx.kind === 'transfer'
            ? `Hôm nay đến lịch chuyển khoản nội bộ (${formatDateVN(tx.expectedDate)})`
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
            : tx.kind === 'transfer'
            ? `Còn ${daysDiff} ngày tới lịch chuyển khoản (${formatDateVN(tx.expectedDate)})`
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
    if (tx.kind === 'transfer') continue;
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
    } else if (tx.kind === 'expense') {
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
    (sum, acc) => sum + toVndInt(acc.initialBalance),
    0
  );

  // Internal transfers cancel out across aggregate user net balance
  const realized = transactions
    .filter((tx) => tx.kind !== 'transfer' && isTransactionRealized(tx.kind, tx.status))
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

export type TransactionSortField = 'date' | 'amount' | 'status' | 'code' | 'name';
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
    } else if (field === 'code') {
      cmp = a.code.localeCompare(b.code);
    } else if (field === 'name') {
      cmp = a.name.localeCompare(b.name, 'vi');
    }

    if (cmp !== 0) {
      return cmp * factor;
    }
    return b.code.localeCompare(a.code);
  });
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}

export function paginateItems<T>(
  items: readonly T[],
  requestedPage: number,
  requestedPageSize: number
): PaginatedResult<T> {
  const pageSize = Math.max(1, Math.floor(requestedPageSize || 10));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.floor(requestedPage || 1)));
  const startIndex = totalItems === 0 ? 0 : (page - 1) * pageSize;
  const endIndex = Math.min(totalItems, startIndex + pageSize);
  return {
    items: items.slice(startIndex, endIndex),
    page,
    pageSize,
    totalItems,
    totalPages,
    startIndex,
    endIndex,
  };
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
  byType: Record<AccountType, { count: number; total: number; percentage: number }>;
}

export function computeAccountAllocation(
  accounts: FinancialAccount[]
): AccountAllocationSummary {
  const totalBalance = accounts.reduce(
    (sum, acc) => sum + toVndInt(acc.currentBalance),
    0
  );
  const positiveTotal = accounts.reduce(
    (sum, acc) =>
      sum + (Number.isFinite(acc.currentBalance) && acc.currentBalance > 0 ? toVndInt(acc.currentBalance) : 0),
    0
  );

  const byType: AccountAllocationSummary['byType'] = {
    cash: { count: 0, total: 0, percentage: 0 },
    bank: { count: 0, total: 0, percentage: 0 },
    ewallet: { count: 0, total: 0, percentage: 0 },
    savings: { count: 0, total: 0, percentage: 0 },
  };

  for (const acc of accounts) {
    const bal = toVndInt(acc.currentBalance);
    const bucket = byType[acc.type] || byType.bank;
    bucket.count += 1;
    bucket.total += bal;
  }

  for (const key of ['cash', 'bank', 'ewallet', 'savings'] as const) {
    byType[key].percentage =
      positiveTotal > 0 && byType[key].total > 0
        ? (byType[key].total / positiveTotal) * 100
        : 0;
  }

  const items: AccountAllocationItem[] = accounts.map((account) => {
    const bal = toVndInt(account.currentBalance);
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
  archivedTransferCount: number;
  archivedTransferTotal: number;
  totalAttachments: number;
}

export function computeArchiveSummary(transactions: Transaction[]): ArchiveSummary {
  let archivedIncomeCount = 0;
  let archivedIncomeTotal = 0;
  let archivedExpenseCount = 0;
  let archivedExpenseTotal = 0;
  let archivedTransferCount = 0;
  let archivedTransferTotal = 0;
  let totalAttachments = 0;

  for (const tx of transactions) {
    if (!tx.isArchived) continue;
    const amt = getEffectiveTransactionAmount(tx);
    totalAttachments += tx.attachments.length;
    if (tx.kind === 'income') {
      archivedIncomeCount += 1;
      archivedIncomeTotal += amt;
    } else if (tx.kind === 'transfer') {
      archivedTransferCount += 1;
      archivedTransferTotal += amt;
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
    archivedTransferCount,
    archivedTransferTotal,
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

export function reorderExpenseCategories(
  list: readonly string[],
  fromIndex: number,
  toIndex: number
): string[] {
  if (
    list.length <= 1 ||
    !Number.isInteger(fromIndex) ||
    !Number.isInteger(toIndex) ||
    fromIndex < 0 ||
    fromIndex >= list.length ||
    toIndex < 0 ||
    toIndex >= list.length ||
    fromIndex === toIndex
  ) {
    return [...list];
  }
  const copy = [...list];
  const [moved] = copy.splice(fromIndex, 1);
  copy.splice(toIndex, 0, moved);
  return copy;
}

export function moveExpenseCategory(
  list: readonly string[],
  index: number,
  direction: 'up' | 'down'
): string[] {
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  return reorderExpenseCategories(list, index, targetIndex);
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
    (sum, acc) => sum + toVndInt(acc.currentBalance),
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
    if (tx.kind === 'transfer') continue;
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

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export function matchesSearchTokens(
  searchableParts: readonly (string | undefined)[],
  rawQuery: string
): boolean {
  const trimmed = rawQuery.trim();
  if (!trimmed) return true;
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;

  const combinedLower = searchableParts
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
  const combinedNormalized = normalizeSearchText(combinedLower);

  return tokens.every((token) => {
    const tokenLower = token.toLowerCase();
    const tokenNormalized = normalizeSearchText(token);
    if (tokenLower !== tokenNormalized) {
      return combinedLower.includes(tokenLower);
    }
    return combinedNormalized.includes(tokenNormalized);
  });
}

export function filterTransactionsByQuery(
  transactions: readonly Transaction[],
  rawQuery: string
): Transaction[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return [...transactions];
  }

  return transactions.filter((tx) =>
    matchesSearchTokens(
      [tx.code, tx.name, tx.counterparty, tx.description, tx.reason],
      trimmed
    )
  );
}

// =========================================================================
// Planned vs Actual Reports
// =========================================================================

export interface PlannedActualCategoryRow {
  kind: 'income' | 'expense';
  category: string;
  planned: number;
  actual: number;
  variance: number;
  achievementPct: number;
}

export interface PlannedActualMonthRow {
  month: number;
  label: string;
  plannedIncome: number;
  actualIncome: number;
  plannedExpense: number;
  actualExpense: number;
}

export interface PlannedVsActualReport {
  plannedIncome: number;
  actualIncome: number;
  incomeVariance: number;
  incomeRatePct: number;
  plannedExpense: number;
  actualExpense: number;
  expenseVariance: number;
  expenseRatePct: number;
  plannedNet: number;
  actualNet: number;
  categories: PlannedActualCategoryRow[];
  months: PlannedActualMonthRow[];
}

export function computePlannedVsActualReport(
  transactions: readonly Transaction[],
  options: { year: number; month?: string }
): PlannedVsActualReport {
  const { year, month = 'ALL' } = options;

  let plannedIncome = 0;
  let actualIncome = 0;
  let plannedExpense = 0;
  let actualExpense = 0;

  const catMap = new Map<string, { kind: 'income' | 'expense'; category: string; planned: number; actual: number }>();
  const months: PlannedActualMonthRow[] = Array.from({ length: 12 }, (_, idx) => ({
    month: idx + 1,
    label: `T${String(idx + 1).padStart(2, '0')}`,
    plannedIncome: 0,
    actualIncome: 0,
    plannedExpense: 0,
    actualExpense: 0,
  }));

  for (const tx of transactions) {
    if (tx.kind === 'transfer') continue;
    if (isTransactionCancelled(tx.status)) continue;

    const realized = isTransactionRealized(tx.kind, tx.status);
    const refDate = realized
      ? tx.actualDate || tx.expectedDate || tx.startDate || ''
      : tx.expectedDate || tx.actualDate || tx.startDate || '';
    const match = /^(\d{4})-(\d{2})/.exec(refDate);
    if (!match) continue;
    const txYear = Number(match[1]);
    const txMonthStr = match[2];
    const txMonthNum = Number(txMonthStr);
    if (txYear !== year) continue;

    const plannedAmt = toVndInt(tx.amount);
    const actualAmt = realized ? getEffectiveTransactionAmount(tx) : 0;

    if (txMonthNum >= 1 && txMonthNum <= 12) {
      if (tx.kind === 'income') {
        months[txMonthNum - 1].plannedIncome += plannedAmt;
        months[txMonthNum - 1].actualIncome += actualAmt;
      } else {
        months[txMonthNum - 1].plannedExpense += plannedAmt;
        months[txMonthNum - 1].actualExpense += actualAmt;
      }
    }

    if (month !== 'ALL' && txMonthStr !== month) continue;

    if (tx.kind === 'income') {
      plannedIncome += plannedAmt;
      actualIncome += actualAmt;
    } else {
      plannedExpense += plannedAmt;
      actualExpense += actualAmt;
    }

    const catKey = `${tx.kind}::${tx.category}`;
    const existing = catMap.get(catKey) || {
      kind: tx.kind,
      category: tx.category,
      planned: 0,
      actual: 0,
    };
    existing.planned += plannedAmt;
    existing.actual += actualAmt;
    catMap.set(catKey, existing);
  }

  const categories: PlannedActualCategoryRow[] = Array.from(catMap.values())
    .map((c) => ({
      ...c,
      variance: c.actual - c.planned,
      achievementPct: c.planned > 0 ? (c.actual / c.planned) * 100 : c.actual > 0 ? 100 : 0,
    }))
    .sort((a, b) => Math.max(b.planned, b.actual) - Math.max(a.planned, a.actual));

  return {
    plannedIncome,
    actualIncome,
    incomeVariance: actualIncome - plannedIncome,
    incomeRatePct: plannedIncome > 0 ? (actualIncome / plannedIncome) * 100 : 0,
    plannedExpense,
    actualExpense,
    expenseVariance: actualExpense - plannedExpense,
    expenseRatePct: plannedExpense > 0 ? (actualExpense / plannedExpense) * 100 : 0,
    plannedNet: plannedIncome - plannedExpense,
    actualNet: actualIncome - actualExpense,
    categories,
    months,
  };
}

// =========================================================================
// Savings Goal Evaluation
// =========================================================================

export interface SavingsGoalEvaluation {
  goal: SavingsGoal;
  percent: number;
  remainingAmount: number;
  isCompleted: boolean;
  isOverdue: boolean;
  daysRemaining: number | null;
  monthlyPaceNeeded: number | null;
}

export function evaluateSavingsGoal(
  goal: SavingsGoal,
  todayIso: string = new Date().toISOString().slice(0, 10)
): SavingsGoalEvaluation {
  const target = Math.max(1, toVndInt(goal.targetAmount));
  const current = Math.max(0, toVndInt(goal.currentAmount));
  const percent = (current / target) * 100;
  const remainingAmount = Math.max(0, target - current);
  const isCompleted = goal.status === 'completed' || current >= target;

  let daysRemaining: number | null = null;
  let isOverdue = false;
  let monthlyPaceNeeded: number | null = null;

  if (goal.targetDate) {
    const todayUtc = parseIsoDayUtc(todayIso);
    const targetUtc = parseIsoDayUtc(goal.targetDate);
    if (todayUtc !== null && targetUtc !== null) {
      daysRemaining = Math.round((targetUtc - todayUtc) / 86400000);
      isOverdue = !isCompleted && daysRemaining < 0;
      if (!isCompleted && remainingAmount > 0 && daysRemaining > 0) {
        const monthsLeft = Math.max(1, daysRemaining / 30);
        monthlyPaceNeeded = toVndInt(remainingAmount / monthsLeft);
      }
    }
  }

  return {
    goal,
    percent,
    remainingAmount,
    isCompleted,
    isOverdue,
    daysRemaining,
    monthlyPaceNeeded,
  };
}

export interface SavingsSummary {
  totalTarget: number;
  totalAccumulated: number;
  overallPercent: number;
  activeCount: number;
  completedCount: number;
}

export function computeSavingsSummary(goals: readonly SavingsGoal[]): SavingsSummary {
  let totalTarget = 0;
  let totalAccumulated = 0;
  let activeCount = 0;
  let completedCount = 0;

  for (const g of goals) {
    totalTarget += Math.max(0, toVndInt(g.targetAmount));
    totalAccumulated += Math.max(0, toVndInt(g.currentAmount));
    if (g.status === 'completed' || g.currentAmount >= g.targetAmount) {
      completedCount += 1;
    } else if (g.status === 'active') {
      activeCount += 1;
    }
  }

  const overallPercent = totalTarget > 0 ? (totalAccumulated / totalTarget) * 100 : 0;
  return {
    totalTarget,
    totalAccumulated,
    overallPercent,
    activeCount,
    completedCount,
  };
}

// =========================================================================
// Duplicate Transaction Detection (Excel Import & Backup Safeguards)
// =========================================================================

export interface DuplicateCandidateInput {
  rowNumber: number;
  kind: TransactionKind;
  name: string;
  amount: number;
  actualAmount?: number;
  expectedDate: string;
  actualDate?: string;
}

export interface DuplicateDetectionResult {
  duplicateRowNumbers: Set<number>;
  reasonByRow: Map<number, string>;
}

function buildDuplicateSignature(params: {
  kind: TransactionKind;
  date: string;
  amount: number;
  name: string;
}): string {
  const normName = normalizeSearchText(params.name).replace(/\s+/g, ' ').trim();
  const datePart = (params.date || '').slice(0, 10);
  return `${params.kind}|${datePart}|${toVndInt(params.amount)}|${normName}`;
}

export function detectDuplicateTransactions(
  candidates: readonly DuplicateCandidateInput[],
  existingTransactions: readonly Transaction[]
): DuplicateDetectionResult {
  const existingSignatures = new Map<string, string>();
  for (const tx of existingTransactions) {
    const amt = getEffectiveTransactionAmount(tx);
    const sigExpected = buildDuplicateSignature({
      kind: tx.kind,
      date: tx.expectedDate,
      amount: tx.amount,
      name: tx.name,
    });
    existingSignatures.set(sigExpected, tx.code);
    if (tx.actualDate || tx.actualAmount) {
      const sigActual = buildDuplicateSignature({
        kind: tx.kind,
        date: tx.actualDate || tx.expectedDate,
        amount: amt,
        name: tx.name,
      });
      existingSignatures.set(sigActual, tx.code);
    }
  }

  const seenInBatch = new Map<string, number>();
  const duplicateRowNumbers = new Set<number>();
  const reasonByRow = new Map<number, string>();

  for (const row of candidates) {
    const effAmt =
      typeof row.actualAmount === 'number' && Number.isFinite(row.actualAmount) && row.actualAmount > 0
        ? row.actualAmount
        : row.amount;
    const sig1 = buildDuplicateSignature({
      kind: row.kind,
      date: row.expectedDate,
      amount: row.amount,
      name: row.name,
    });
    const sig2 = buildDuplicateSignature({
      kind: row.kind,
      date: row.actualDate || row.expectedDate,
      amount: effAmt,
      name: row.name,
    });

    const existingMatch = existingSignatures.get(sig1) || existingSignatures.get(sig2);
    if (existingMatch) {
      duplicateRowNumbers.add(row.rowNumber);
      reasonByRow.set(row.rowNumber, `Trùng với giao dịch ${existingMatch}`);
      continue;
    }

    const batchDupRow = seenInBatch.get(sig1) || seenInBatch.get(sig2);
    if (batchDupRow !== undefined) {
      duplicateRowNumbers.add(row.rowNumber);
      reasonByRow.set(row.rowNumber, `Trùng với dòng ${batchDupRow} trong file`);
      continue;
    }

    seenInBatch.set(sig1, row.rowNumber);
    seenInBatch.set(sig2, row.rowNumber);
  }

  return { duplicateRowNumbers, reasonByRow };
}

// =========================================================================
// Global System Search
// =========================================================================

export type GlobalSearchModuleTarget =
  | 'overview'
  | 'transactions'
  | 'accounts'
  | 'budgets'
  | 'savings'
  | 'reports'
  | 'archive'
  | 'settings';

export interface GlobalSearchResultItem {
  id: string;
  entityType: 'transaction' | 'account' | 'budget' | 'savings';
  title: string;
  subtitle: string;
  amount?: number;
  badge: string;
  targetPage: GlobalSearchModuleTarget;
  searchHint?: string;
}

export function searchGlobalEntities(params: {
  query: string;
  transactions: readonly Transaction[];
  accounts: readonly FinancialAccount[];
  budgets: readonly BudgetLimit[];
  savingsGoals: readonly SavingsGoal[];
  limit?: number;
}): GlobalSearchResultItem[] {
  const q = params.query.trim();
  if (!q) return [];
  const limit = Math.max(1, params.limit ?? 15);
  const results: GlobalSearchResultItem[] = [];

  for (const acc of params.accounts) {
    if (matchesSearchTokens([acc.name, acc.bankName, acc.accountNumber, acc.type], q)) {
      results.push({
        id: `acc:${acc.id}`,
        entityType: 'account',
        title: acc.name,
        subtitle: acc.bankName || acc.accountNumber || 'Nguồn tiền / Tài khoản',
        amount: toVndInt(acc.currentBalance),
        badge: 'Tài khoản',
        targetPage: 'accounts',
      });
    }
  }

  for (const goal of params.savingsGoals) {
    if (matchesSearchTokens([goal.name, goal.category, goal.note, goal.linkedAccountName], q)) {
      results.push({
        id: `sav:${goal.id}`,
        entityType: 'savings',
        title: goal.name,
        subtitle: `Mục tiêu: ${formatVND(goal.targetAmount)}`,
        amount: toVndInt(goal.currentAmount),
        badge: 'Tiết kiệm',
        targetPage: 'savings',
      });
    }
  }

  for (const b of params.budgets) {
    if (matchesSearchTokens([b.name, b.scopeValue, b.yearMonth], q)) {
      results.push({
        id: `bdg:${b.id}`,
        entityType: 'budget',
        title: b.name,
        subtitle: `${b.scopeValue} · ${b.yearMonth}`,
        amount: toVndInt(b.limitAmount),
        badge: 'Ngân sách',
        targetPage: 'budgets',
      });
    }
  }

  for (const tx of params.transactions) {
    if (
      matchesSearchTokens(
        [
          tx.code,
          tx.name,
          tx.counterparty,
          tx.description,
          tx.reason,
          tx.category,
          tx.accountName,
          tx.toAccountName,
        ],
        q
      )
    ) {
      results.push({
        id: `tx:${tx.id}`,
        entityType: 'transaction',
        title: `${tx.code} — ${tx.name}`,
        subtitle: `${tx.category} · ${tx.accountName}${tx.toAccountName ? ` → ${tx.toAccountName}` : ''} · ${tx.status}`,
        amount: getEffectiveTransactionAmount(tx),
        badge: tx.isArchived ? 'Lưu trữ' : tx.kind === 'income' ? 'Thu' : tx.kind === 'transfer' ? 'Chuyển khoản' : 'Chi',
        targetPage: tx.isArchived ? 'archive' : 'transactions',
        searchHint: tx.code,
      });
    }
  }

  return results.slice(0, limit);
}

function extractAuthErrorText(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    const record = err as { code?: unknown; message?: unknown };
    const code = typeof record.code === 'string' ? record.code : '';
    const message = typeof record.message === 'string' ? record.message : '';
    return `${code} ${message}`.trim();
  }
  return String(err);
}

export function isPopupCancelledError(err: unknown): boolean {
  const lower = extractAuthErrorText(err).toLowerCase();
  return (
    lower.includes('popup-closed-by-user') ||
    lower.includes('cancelled-popup-request')
  );
}

export function formatFirebaseAuthError(err: unknown): string {
  const raw = err instanceof Error ? err.message : extractAuthErrorText(err);
  const lower = extractAuthErrorText(err).toLowerCase();

  if (isPopupCancelledError(err)) {
    return 'Cửa sổ xác thực Google đã được đóng trước khi hoàn tất. Vui lòng thử lại.';
  }
  if (lower.includes('popup-blocked')) {
    return 'Trình duyệt đang chặn cửa sổ bật lên (Popup). Vui lòng cho phép Popup cho trang web này rồi thử lại.';
  }
  if (lower.includes('unauthorized-domain')) {
    return 'Tên miền hiện tại chưa được cấp phép trong Firebase Authentication (Authorized domains).';
  }
  if (lower.includes('user-mismatch')) {
    return 'Vui lòng chọn đúng tài khoản Google đang đăng nhập để kết nối Google Workspace.';
  }
  if (lower.includes('network-request-failed')) {
    return 'Lỗi kết nối mạng khi xác thực Google. Vui lòng kiểm tra Internet và thử lại.';
  }
  if (
    lower.includes('access_denied') ||
    lower.includes('testing') ||
    lower.includes('kiểm thử') ||
    lower.includes('xác minh') ||
    lower.includes('org_internal')
  ) {
    return 'Màn hình đồng ý OAuth trên Google Cloud Console của dự án vẫn đang ở chế độ Thử nghiệm (Testing). Chủ dự án cần vào Google Cloud Console → Google Auth Platform → Audience và nhấn "Publish App" (Xuất bản ứng dụng) để mọi người dùng đều đăng nhập được.';
  }

  return raw || 'Đăng nhập Google thất bại. Vui lòng thử lại.';
}


