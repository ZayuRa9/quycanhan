import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addExpenseCategory,
  buildDriveAttachmentName,
  buildTransactionCode,
  computeAccountAllocation,
  computeAccountBalanceDelta,
  computeArchiveSummary,
  computeBalanceForecast,
  computeBalanceTimeline,
  computeCategoryBreakdown,
  computeExpenseForecast,
  computeFinancialSummary,
  computeMonthlySeries,
  computePlannedVsActualReport,
  computeSavingsSummary,
  computeTransactionReminders,
  computeTransferDestinationDelta,
  evaluateBudget,
  evaluateSavingsGoal,
  filterTransactionsByQuery,
  formatDateVN,
  formatFirebaseAuthError,
  formatVND,
  getDriveFolderParts,
  mergeExpenseCategories,
  moveExpenseCategory,
  normalizeTransactionStatus,
  paginateItems,
  removeExpenseCategory,
  reorderExpenseCategories,
  searchGlobalEntities,
  sortTransactions,
  toVndInt,
  validateTransactionStatusChange,
  detectDuplicateTransactions,
} from './financeRules';
import { buildPdfDocumentFromJpegPages } from './pdfExport';
import { parseSingleSheetRows, TEMPLATE_HEADERS } from './excelTemplate';
import type { BudgetLimit, DriveAttachment, FinancialAccount, SavingsGoal, Transaction } from '../types/finance';

const sampleAttachment: DriveAttachment = {
  id: 'drv-1',
  name: 'KC-2026.11-01.pdf',
  originalName: 'invoice.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  sha256: 'abc123',
  webViewLink: 'https://drive.google.com/file/d/drv-1/view',
  driveFolderId: 'fld-11',
  driveFolderPath: '5/2026/11',
  uploadedAt: '2026-11-19T00:00:00Z',
};

test('formatVND and formatDateVN format Vietnamese standards accurately', () => {
  assert.equal(formatVND(15000000), '15.000.000 ₫');
  assert.equal(formatDateVN('2026-11-19'), '19/11/2026');
});

test('transaction code generation follows KT/KC-YYYY.MM-NN rules', () => {
  assert.equal(buildTransactionCode('income', '2026.11', 1), 'KT-2026.11-01');
  assert.equal(buildTransactionCode('income', '2026.11', 2), 'KT-2026.11-02');
  assert.equal(buildTransactionCode('expense', '2026.11', 1), 'KC-2026.11-01');
  assert.equal(buildTransactionCode('expense', '2026.11', 14), 'KC-2026.11-14');
});

test('Drive folder path, standard naming, and custom user rename preserve extensions', () => {
  const folder = getDriveFolderParts('2026-11-19');
  assert.equal(folder.path, '5/2026/11');
  assert.equal(buildDriveAttachmentName('KC-2026.11-01', 'hoadon.pdf', 0, 1), 'KC-2026.11-01.pdf');
  assert.equal(buildDriveAttachmentName('KC-2026.11-01', 'anh1.jpg', 0, 3), 'KC-2026.11-01_01.jpg');
  assert.equal(buildDriveAttachmentName('KC-2026.11-01', 'anh2.pdf', 1, 2), 'KC-2026.11-01_02.pdf');
  assert.equal(
    buildDriveAttachmentName('KC-2026.11-01', 'photo.png', 0, 1, 'HoaDon_Dien_T11'),
    'HoaDon_Dien_T11.png'
  );
  assert.equal(
    buildDriveAttachmentName('KC-2026.11-01', 'photo.png', 0, 1, 'HoaDon_Dien_T11.png'),
    'HoaDon_Dien_T11.png'
  );
});

test('accounting summary excludes pending income and unpaid expense from actual realized totals', () => {
  const accounts: FinancialAccount[] = [
    {
      id: 'acc-1',
      userId: 'u1',
      type: 'bank',
      name: 'VCB',
      initialBalance: 10000000,
      currentBalance: 13000000,
    },
  ];

  const transactions: Transaction[] = [
    {
      id: 't1',
      userId: 'u1',
      code: 'KT-2026.11-01',
      kind: 'income',
      name: 'Lương tháng 11',
      amount: 5000000,
      actualAmount: 5000000,
      category: 'Tiền lương',
      method: 'Chuyển khoản ngân hàng',
      accountId: 'acc-1',
      accountName: 'VCB',
      expectedDate: '2026-11-10',
      actualDate: '2026-11-10',
      status: 'Đã thu',
      isArchived: false,
      attachments: [sampleAttachment],
      auditHistory: [],
    },
    {
      id: 't2',
      userId: 'u1',
      code: 'KT-2026.11-02',
      kind: 'income',
      name: 'Thưởng dự án',
      amount: 3000000,
      category: 'Tiền thưởng',
      method: 'Chuyển khoản ngân hàng',
      accountId: 'acc-1',
      accountName: 'VCB',
      expectedDate: '2026-11-25',
      status: 'Đang chờ thu',
      isArchived: false,
      attachments: [],
      auditHistory: [],
    },
    {
      id: 't3',
      userId: 'u1',
      code: 'KC-2026.11-01',
      kind: 'expense',
      name: 'Mua sách',
      amount: 2000000,
      actualAmount: 2000000,
      category: 'Sách và tài liệu',
      method: 'Chuyển khoản ngân hàng',
      accountId: 'acc-1',
      accountName: 'VCB',
      expectedDate: '2026-11-12',
      actualDate: '2026-11-12',
      status: 'Đã chi',
      isArchived: false,
      attachments: [sampleAttachment],
      auditHistory: [],
    },
    {
      id: 't4',
      userId: 'u1',
      code: 'KC-2026.11-02',
      kind: 'expense',
      name: 'Hóa đơn điện',
      amount: 1200000,
      category: 'Sinh hoạt cá nhân',
      method: 'Ví điện tử',
      accountId: 'acc-1',
      accountName: 'VCB',
      expectedDate: '2026-11-28',
      status: 'Chờ thanh toán',
      isArchived: false,
      attachments: [],
      auditHistory: [],
    },
  ];

  const summary = computeFinancialSummary(accounts, transactions);
  assert.equal(summary.totalCollectedIncome, 5000000);
  assert.equal(summary.pendingIncome, 3000000);
  assert.equal(summary.totalPaidExpense, 2000000);
  assert.equal(summary.pendingExpense, 1200000);
  assert.equal(summary.actualBalance, 13000000);
  assert.equal(summary.netRealizedCashflow, 3000000);
});

test('account balance delta transitions accurately between pending and realized states', () => {
  assert.equal(computeAccountBalanceDelta('income', false, true, 5000000, 5000000), 5000000);
  assert.equal(computeAccountBalanceDelta('expense', false, true, 1200000, 1200000), -1200000);
  assert.equal(computeAccountBalanceDelta('expense', true, true, 1200000, 1500000), -300000);
  assert.equal(computeAccountBalanceDelta('income', true, false, 5000000, 5000000), -5000000);
});

test('validation enforces proof and date before completing income or expense', () => {
  const missingDate = validateTransactionStatusChange('expense', 'Đã chi', '', [sampleAttachment], 'acc-1', false);
  assert.equal(missingDate.valid, false);

  const missingProof = validateTransactionStatusChange('expense', 'Đã hoàn thành', '2026-11-19', [], 'acc-1', true);
  assert.equal(missingProof.valid, false);

  const validExpense = validateTransactionStatusChange('expense', 'Đã hoàn thành', '2026-11-19', [sampleAttachment], 'acc-1', true);
  assert.equal(validExpense.valid, true);

  const incomeWithoutProof = validateTransactionStatusChange('income', 'Đã thu', '2026-11-19', [], 'acc-1', false);
  assert.equal(incomeWithoutProof.valid, false);
});

test('budget alerts trigger at 80%, 90%, and >=100% thresholds', () => {
  const budget: BudgetLimit = {
    id: 'b1',
    userId: 'u1',
    name: 'Ăn uống T11',
    scopeType: 'category',
    scopeValue: 'Ăn uống',
    yearMonth: '2026-11',
    limitAmount: 1000000,
  };

  const makeExpense = (amount: number): Transaction => ({
    id: 'x',
    userId: 'u1',
    code: 'KC-2026.11-01',
    kind: 'expense',
    name: 'Cơm trưa',
    amount,
    category: 'Ăn uống',
    method: 'Tiền mặt',
    accountId: 'a1',
    accountName: 'Tiền mặt',
    expectedDate: '2026-11-15',
    status: 'Đã chi',
    isArchived: false,
    attachments: [],
    auditHistory: [],
  });

  assert.equal(evaluateBudget(budget, [makeExpense(790000)]).alertLevel, 'ok');
  assert.equal(evaluateBudget(budget, [makeExpense(800000)]).alertLevel, 'warn_80');
  assert.equal(evaluateBudget(budget, [makeExpense(900000)]).alertLevel, 'warn_90');
  assert.equal(evaluateBudget(budget, [makeExpense(1000000)]).alertLevel, 'over_100');
  assert.equal(evaluateBudget(budget, [makeExpense(1100000)]).alertLevel, 'over_100');
});

test('automatic transaction reminders detect upcoming expense, upcoming income, and overdue income', () => {
  const txs: Transaction[] = [
    {
      id: 'inc-overdue',
      userId: 'u1',
      code: 'KT-2026.11-01',
      kind: 'income',
      name: 'Khách hàng A thanh toán',
      amount: 5000000,
      category: 'Tiền công, tiền dịch vụ',
      method: 'Chuyển khoản ngân hàng',
      accountId: 'a1',
      accountName: 'VCB',
      expectedDate: '2026-11-17',
      status: 'Đang chờ thu',
      isArchived: false,
      attachments: [],
      auditHistory: [],
    },
    {
      id: 'exp-upcoming',
      userId: 'u1',
      code: 'KC-2026.11-01',
      kind: 'expense',
      name: 'Tiền internet',
      amount: 300000,
      category: 'Sinh hoạt cá nhân',
      method: 'Ví điện tử',
      accountId: 'a1',
      accountName: 'VCB',
      expectedDate: '2026-11-21',
      status: 'Chờ thanh toán',
      isArchived: false,
      attachments: [],
      auditHistory: [],
    },
    {
      id: 'exp-done',
      userId: 'u1',
      code: 'KC-2026.11-02',
      kind: 'expense',
      name: 'Đã trả xong',
      amount: 200000,
      category: 'Ăn uống',
      method: 'Tiền mặt',
      accountId: 'a1',
      accountName: 'VCB',
      expectedDate: '2026-11-19',
      actualDate: '2026-11-19',
      status: 'Đã chi',
      isArchived: false,
      attachments: [sampleAttachment],
      auditHistory: [],
    },
  ];

  const reminders = computeTransactionReminders(txs, '2026-11-19', 3);
  assert.equal(reminders.length, 2);
  assert.equal(reminders[0].transaction.code, 'KT-2026.11-01');
  assert.equal(reminders[0].severity, 'overdue');
  assert.equal(reminders[1].transaction.code, 'KC-2026.11-01');
  assert.equal(reminders[1].severity, 'upcoming');
  assert.equal(reminders[1].daysDiff, 2);
});

test('single-sheet Excel parser handles Tài khoản, Thu, Chi, and Hạn mức rows accurately', () => {
  const rows: unknown[][] = [
    ['MẪU NHẬP LIỆU'],
    ['Quy ước'],
    [],
    [...TEMPLATE_HEADERS],
    ['Tài khoản', 'VCB Chính', 'Ngân hàng', 10000000, 10000000, 'Vietcombank', '00112233'],
    ['Thu', 'Lương T11', 'Tiền lương', 15000000, '', 'Chuyển khoản ngân hàng', 'VCB Chính', 'Công ty X', '19/11/2026', '', 'Đang chờ thu'],
    ['Chi', 'Ăn trưa', 'Ăn uống', 120000, 120000, 'Tiền mặt', 'VCB Chính', 'Quán cơm', '19/11/2026', '19/11/2026', 'Đã chi'],
    ['Hạn mức', 'Hạn mức ăn uống T11', 'Theo loại chi', 3000000, '', '', '', 'Ăn uống', '2026-11'],
  ];

  const parsed = parseSingleSheetRows(rows);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.accounts.length, 1);
  assert.equal(parsed.incomes.length, 1);
  assert.equal(parsed.incomes[0].expectedDate, '2026-11-19');
  assert.equal(parsed.expenses.length, 1);
  assert.equal(parsed.expenses[0].actualDate, '2026-11-19');
  assert.equal(parsed.budgets.length, 1);
  assert.equal(parsed.budgets[0].scopeValue, 'Ăn uống');
});

test('monthly series, category breakdown, and balance timeline compute accurately', () => {
  const accounts: FinancialAccount[] = [
    {
      id: 'a1',
      userId: 'u1',
      type: 'cash',
      name: 'Ví chính',
      initialBalance: 1000000,
      currentBalance: 3500000,
    },
  ];
  const txs: Transaction[] = [
    {
      id: '1',
      userId: 'u1',
      code: 'KT-2026.11-01',
      kind: 'income',
      name: 'Lương',
      amount: 3000000,
      category: 'Tiền lương',
      method: 'Tiền mặt',
      accountId: 'a1',
      accountName: 'Ví chính',
      expectedDate: '2026-11-01',
      actualDate: '2026-11-01',
      status: 'Đã thu',
      isArchived: true,
      attachments: [sampleAttachment],
      auditHistory: [],
    },
    {
      id: '2',
      userId: 'u1',
      code: 'KC-2026.11-01',
      kind: 'expense',
      name: 'Ăn tối',
      amount: 500000,
      category: 'Ăn uống',
      method: 'Tiền mặt',
      accountId: 'a1',
      accountName: 'Ví chính',
      expectedDate: '2026-11-02',
      actualDate: '2026-11-02',
      status: 'Đã chi',
      isArchived: false,
      attachments: [sampleAttachment],
      auditHistory: [],
    },
  ];

  const monthly = computeMonthlySeries(txs, 2026);
  assert.equal(monthly[10].income, 3000000);
  assert.equal(monthly[10].expense, 500000);
  assert.equal(monthly[10].net, 2500000);

  const breakdown = computeCategoryBreakdown(txs, 'expense');
  assert.equal(breakdown.length, 1);
  assert.equal(breakdown[0].category, 'Ăn uống');
  assert.equal(breakdown[0].percentage, 100);

  const timeline = computeBalanceTimeline(accounts, txs);
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].balance, 4000000);
  assert.equal(timeline[1].balance, 3500000);
});

test('sortTransactions sorts by date, amount, and status in asc/desc without mutating input', () => {
  const base: Omit<
    Transaction,
    'id' | 'code' | 'name' | 'amount' | 'actualAmount' | 'expectedDate' | 'actualDate' | 'status'
  > = {
    userId: 'u1',
    kind: 'expense',
    category: 'Ăn uống',
    method: 'Tiền mặt',
    accountId: 'a1',
    accountName: 'Tiền mặt',
    isArchived: false,
    attachments: [],
    auditHistory: [],
  };

  const txs: Transaction[] = [
    {
      ...base,
      id: '1',
      code: 'KC-2026.11-01',
      name: 'Khoản B',
      amount: 500000,
      expectedDate: '2026-11-10',
      status: 'Đang thực hiện',
    },
    {
      ...base,
      id: '2',
      code: 'KC-2026.11-02',
      name: 'Khoản A',
      amount: 200000,
      actualAmount: 900000,
      expectedDate: '2026-11-05',
      actualDate: '2026-11-18',
      status: 'Đã chi',
    },
    {
      ...base,
      id: '3',
      code: 'KC-2026.11-03',
      name: 'Khoản C',
      amount: 300000,
      expectedDate: '2026-11-12',
      status: 'Chờ thanh toán',
    },
  ];

  const snapshotIds = txs.map((t) => t.id);

  // Date ascending uses effective date (actualDate if set, else expectedDate)
  const dateAsc = sortTransactions(txs, 'date', 'asc');
  assert.deepEqual(
    dateAsc.map((t) => t.id),
    ['1', '3', '2']
  );

  // Date descending
  const dateDesc = sortTransactions(txs, 'date', 'desc');
  assert.deepEqual(
    dateDesc.map((t) => t.id),
    ['2', '3', '1']
  );

  // Amount ascending uses effective amount (actualAmount if > 0)
  const amtAsc = sortTransactions(txs, 'amount', 'asc');
  assert.deepEqual(
    amtAsc.map((t) => t.id),
    ['3', '1', '2']
  );

  // Amount descending
  const amtDesc = sortTransactions(txs, 'amount', 'desc');
  assert.deepEqual(
    amtDesc.map((t) => t.id),
    ['2', '1', '3']
  );

  // Status ascending & descending (normalized canonical status first, then raw status tiebreaker)
  const statusAsc = sortTransactions(txs, 'status', 'asc');
  assert.deepEqual(
    statusAsc.map((t) => t.status),
    ['Chờ thanh toán', 'Đang thực hiện', 'Đã chi']
  );

  const statusDesc = sortTransactions(txs, 'status', 'desc');
  assert.deepEqual(
    statusDesc.map((t) => t.status),
    ['Đã chi', 'Đang thực hiện', 'Chờ thanh toán']
  );

  const canonicalTxs: Transaction[] = [
    { ...txs[0], id: 'c1', status: 'Đã thực hiện' },
    { ...txs[1], id: 'c2', status: 'Đã hủy' },
    { ...txs[2], id: 'c3', status: 'Dự kiến' },
  ];
  assert.deepEqual(
    sortTransactions(canonicalTxs, 'status', 'asc').map((t) => t.status),
    ['Dự kiến', 'Đã hủy', 'Đã thực hiện']
  );
  assert.deepEqual(
    sortTransactions(canonicalTxs, 'status', 'desc').map((t) => t.status),
    ['Đã thực hiện', 'Đã hủy', 'Dự kiến']
  );

  // Input array was not mutated
  assert.deepEqual(
    txs.map((t) => t.id),
    snapshotIds
  );
});

test('computeExpenseForecast predicts upward/downward trends from realized expenses and clamps >= 0', () => {
  // Empty case
  const empty = computeExpenseForecast([]);
  assert.equal(empty.history.length, 0);
  assert.equal(empty.forecast.length, 0);

  const makeExp = (
    id: string,
    date: string,
    amount: number,
    status: Transaction['status'] = 'Đã chi',
    category = 'Ăn uống'
  ): Transaction => ({
    id,
    userId: 'u1',
    code: `KC-2026-${id}`,
    kind: 'expense',
    name: `Chi ${id}`,
    amount,
    category,
    method: 'Tiền mặt',
    accountId: 'a1',
    accountName: 'Tiền mặt',
    expectedDate: date,
    actualDate: status === 'Đã chi' ? date : undefined,
    status,
    isArchived: false,
    attachments: [],
    auditHistory: [],
  });

  // Upward linear trend: 2M -> 3M -> 4M (pending 99M ignored)
  const risingTxs: Transaction[] = [
    makeExp('1', '2026-09-10', 2000000, 'Đã chi'),
    makeExp('2', '2026-10-10', 3000000, 'Đã chi'),
    makeExp('3', '2026-11-10', 4000000, 'Đã chi'),
    makeExp('4', '2026-11-15', 99000000, 'Chờ thanh toán'),
  ];

  const rising = computeExpenseForecast(risingTxs);
  assert.equal(rising.history.length, 3);
  assert.equal(rising.forecast.length, 3);
  assert.equal(rising.averageMonthly, 3000000);
  assert.equal(rising.trendDirection, 'up');
  assert.deepEqual(
    rising.forecast.map((f) => [f.yearMonth, f.amount]),
    [
      ['2026-12', 5000000],
      ['2027-01', 6000000],
      ['2027-02', 7000000],
    ]
  );

  // Steep downward trend clamps forecasted values at 0 instead of negative
  const fallingTxs: Transaction[] = [
    makeExp('1', '2026-09-10', 6000000, 'Đã chi'),
    makeExp('2', '2026-10-10', 3000000, 'Đã chi'),
    makeExp('3', '2026-11-10', 500000, 'Đã chi'),
  ];
  const falling = computeExpenseForecast(fallingTxs);
  assert.equal(falling.trendDirection, 'down');
  assert.ok(falling.forecast.every((f) => f.amount >= 0));
});

test('computeAccountAllocation and computeArchiveSummary aggregate real balances and archived records', () => {
  const accounts: FinancialAccount[] = [
    { id: 'a1', userId: 'u1', type: 'cash', name: 'Tiền mặt', initialBalance: 2000000, currentBalance: 2000000 },
    { id: 'a2', userId: 'u1', type: 'bank', name: 'VCB', initialBalance: 6000000, currentBalance: 6000000 },
    { id: 'a3', userId: 'u1', type: 'ewallet', name: 'MoMo', initialBalance: 2000000, currentBalance: 2000000 },
  ];

  const alloc = computeAccountAllocation(accounts);
  assert.equal(alloc.totalBalance, 10000000);
  assert.equal(alloc.byType.bank.percentage, 60);
  assert.equal(alloc.byType.cash.percentage, 20);
  assert.equal(alloc.byType.ewallet.percentage, 20);

  const txs: Transaction[] = [
    {
      id: 't1', userId: 'u1', code: 'KT-2026.11-01', kind: 'income', name: 'Lương',
      amount: 10000000, category: 'Tiền lương', method: 'Chuyển khoản ngân hàng',
      accountId: 'a2', accountName: 'VCB', expectedDate: '2026-11-10',
      actualDate: '2026-11-10', status: 'Đã đối soát', isArchived: true,
      attachments: [sampleAttachment], auditHistory: [],
    },
    {
      id: 't2', userId: 'u1', code: 'KC-2026.11-01', kind: 'expense', name: 'Mua đồ',
      amount: 1500000, actualAmount: 1400000, category: 'Mua sắm', method: 'Ví điện tử',
      accountId: 'a3', accountName: 'MoMo', expectedDate: '2026-11-12',
      actualDate: '2026-11-12', status: 'Đã hoàn thành', isArchived: true,
      attachments: [sampleAttachment, sampleAttachment], auditHistory: [],
    },
    {
      id: 't3', userId: 'u1', code: 'KC-2026.11-02', kind: 'expense', name: 'Chưa lưu trữ',
      amount: 500000, category: 'Ăn uống', method: 'Tiền mặt',
      accountId: 'a1', accountName: 'Tiền mặt', expectedDate: '2026-11-15',
      status: 'Đang thực hiện', isArchived: false, attachments: [], auditHistory: [],
    },
  ];

  const arch = computeArchiveSummary(txs);
  assert.equal(arch.archivedIncomeCount, 1);
  assert.equal(arch.archivedIncomeTotal, 10000000);
  assert.equal(arch.archivedExpenseCount, 1);
  assert.equal(arch.archivedExpenseTotal, 1400000);
  assert.equal(arch.totalAttachments, 3);
});

test('normalizeTransactionStatus maps canonical and legacy statuses accurately', () => {
  assert.equal(normalizeTransactionStatus('Dự kiến'), 'Dự kiến');
  assert.equal(normalizeTransactionStatus('Đang chờ thu'), 'Dự kiến');
  assert.equal(normalizeTransactionStatus('Chờ thanh toán'), 'Dự kiến');
  assert.equal(normalizeTransactionStatus('Đang thực hiện'), 'Dự kiến');
  assert.equal(normalizeTransactionStatus('Đã thực hiện'), 'Đã thực hiện');
  assert.equal(normalizeTransactionStatus('Đã thu'), 'Đã thực hiện');
  assert.equal(normalizeTransactionStatus('Đã chi'), 'Đã thực hiện');
  assert.equal(normalizeTransactionStatus('Đã đối soát'), 'Đã thực hiện');
  assert.equal(normalizeTransactionStatus('Đã hoàn thành'), 'Đã thực hiện');
  assert.equal(normalizeTransactionStatus('Đã hủy'), 'Đã hủy');
});

test('cancelled transactions are excluded from summary, budgets, reminders, and allow status change without proof', () => {
  const accounts: FinancialAccount[] = [
    {
      id: 'a1',
      userId: 'u1',
      type: 'bank',
      name: 'VCB',
      initialBalance: 5000000,
      currentBalance: 5000000,
    },
  ];

  const cancelledExpense: Transaction = {
    id: 'cx1',
    userId: 'u1',
    code: 'KC-2026.11-01',
    kind: 'expense',
    name: 'Đặt cọc đã hủy',
    amount: 2000000,
    category: 'Ăn uống',
    method: 'Tiền mặt',
    accountId: 'a1',
    accountName: 'VCB',
    expectedDate: '2026-11-18',
    status: 'Đã hủy',
    isArchived: false,
    attachments: [],
    auditHistory: [],
  };

  const cancelledIncome: Transaction = {
    id: 'ci1',
    userId: 'u1',
    code: 'KT-2026.11-01',
    kind: 'income',
    name: 'Hợp đồng hủy',
    amount: 9000000,
    category: 'Tiền lương',
    method: 'Chuyển khoản ngân hàng',
    accountId: 'a1',
    accountName: 'VCB',
    expectedDate: '2026-11-18',
    status: 'Đã hủy',
    isArchived: false,
    attachments: [],
    auditHistory: [],
  };

  const summary = computeFinancialSummary(accounts, [cancelledExpense, cancelledIncome]);
  assert.equal(summary.totalCollectedIncome, 0);
  assert.equal(summary.pendingIncome, 0);
  assert.equal(summary.totalPaidExpense, 0);
  assert.equal(summary.pendingExpense, 0);

  const budget: BudgetLimit = {
    id: 'b1',
    userId: 'u1',
    name: 'Ăn uống',
    scopeType: 'category',
    scopeValue: 'Ăn uống',
    yearMonth: '2026-11',
    limitAmount: 1000000,
  };
  assert.equal(evaluateBudget(budget, [cancelledExpense]).spent, 0);

  const reminders = computeTransactionReminders([cancelledExpense, cancelledIncome], '2026-11-19', 3);
  assert.equal(reminders.length, 0);

  assert.equal(
    validateTransactionStatusChange('expense', 'Đã hủy', '', [], 'a1', false).valid,
    true
  );
  assert.equal(
    validateTransactionStatusChange('expense', 'Đã thực hiện', '', [], 'a1', false).valid,
    false
  );
  assert.equal(
    validateTransactionStatusChange('expense', 'Đã thực hiện', '2026-11-19', [sampleAttachment], 'a1', false).valid,
    true
  );
});

test('addExpenseCategory, removeExpenseCategory, and mergeExpenseCategories enforce validation and deduplication', () => {
  const initial = ['Ăn uống', 'Di chuyển'];

  const emptyRes = addExpenseCategory(initial, '   ');
  assert.ok(emptyRes.error);
  assert.deepEqual(emptyRes.next, initial);

  const dupRes = addExpenseCategory(initial, '  ăn uống  ');
  assert.ok(dupRes.error);
  assert.deepEqual(dupRes.next, initial);

  const addRes = addExpenseCategory(initial, '  Du lịch   biển ');
  assert.equal(addRes.error, undefined);
  assert.equal(addRes.added, 'Du lịch biển');
  assert.deepEqual(addRes.next, ['Ăn uống', 'Di chuyển', 'Du lịch biển']);

  const removeRes = removeExpenseCategory(addRes.next, 'Di chuyển');
  assert.equal(removeRes.error, undefined);
  assert.deepEqual(removeRes.next, ['Ăn uống', 'Du lịch biển']);

  const removeToOne = removeExpenseCategory(['Ăn uống', 'Du lịch biển'], 'Du lịch biển');
  assert.deepEqual(removeToOne.next, ['Ăn uống']);

  const removeLast = removeExpenseCategory(['Ăn uống'], 'Ăn uống');
  assert.ok(removeLast.error);
  assert.deepEqual(removeLast.next, ['Ăn uống']);

  const merged = mergeExpenseCategories(['Ăn uống'], [
    { kind: 'expense', category: 'ăn uống' },
    { kind: 'expense', category: 'Y tế' },
    { kind: 'income', category: 'Tiền lương' },
  ]);
  assert.deepEqual(merged, ['Ăn uống', 'Y tế']);
});

test('reorderExpenseCategories and moveExpenseCategory reorder without mutating input and handle bounds', () => {
  const source = ['Ăn uống', 'Đi lại', 'Mua sắm', 'Khác'];
  const snapshot = [...source];

  // Drag/move from index 2 to 0
  assert.deepEqual(reorderExpenseCategories(source, 2, 0), [
    'Mua sắm',
    'Ăn uống',
    'Đi lại',
    'Khác',
  ]);

  // Move from index 0 to 3
  assert.deepEqual(reorderExpenseCategories(source, 0, 3), [
    'Đi lại',
    'Mua sắm',
    'Khác',
    'Ăn uống',
  ]);

  // Out-of-bounds or same index returns unchanged copy
  assert.deepEqual(reorderExpenseCategories(source, -1, 2), source);
  assert.deepEqual(reorderExpenseCategories(source, 0, 99), source);
  assert.deepEqual(reorderExpenseCategories(source, 1, 1), source);

  // moveExpenseCategory up/down
  assert.deepEqual(moveExpenseCategory(source, 1, 'up'), [
    'Đi lại',
    'Ăn uống',
    'Mua sắm',
    'Khác',
  ]);
  assert.deepEqual(moveExpenseCategory(source, 1, 'down'), [
    'Ăn uống',
    'Mua sắm',
    'Đi lại',
    'Khác',
  ]);
  assert.deepEqual(moveExpenseCategory(source, 0, 'up'), source);
  assert.deepEqual(moveExpenseCategory(source, 3, 'down'), source);

  // Input array was never mutated
  assert.deepEqual(source, snapshot);
});

test('computeBalanceForecast combines historical balances with scheduled upcoming transactions and detects negative risk', () => {
  const empty = computeBalanceForecast([], [], { todayIso: '2026-11-19' });
  assert.equal(empty.currentBalance, 0);
  assert.equal(empty.history.length, 0);
  assert.equal(empty.forecast.length, 0);
  assert.equal(empty.hasNegativeRisk, false);

  const accounts: FinancialAccount[] = [
    {
      id: 'a1',
      userId: 'u1',
      type: 'bank',
      name: 'VCB',
      initialBalance: 10000000,
      currentBalance: 13000000,
    },
  ];

  const txs: Transaction[] = [
    {
      id: 'h1',
      userId: 'u1',
      code: 'KT-2026.11-01',
      kind: 'income',
      name: 'Lương',
      amount: 5000000,
      category: 'Tiền lương',
      method: 'Chuyển khoản ngân hàng',
      accountId: 'a1',
      accountName: 'VCB',
      expectedDate: '2026-11-10',
      actualDate: '2026-11-10',
      status: 'Đã thực hiện',
      isArchived: false,
      attachments: [sampleAttachment],
      auditHistory: [],
    },
    {
      id: 'h2',
      userId: 'u1',
      code: 'KC-2026.11-01',
      kind: 'expense',
      name: 'Thuê nhà',
      amount: 2000000,
      category: 'Sinh hoạt cá nhân',
      method: 'Chuyển khoản ngân hàng',
      accountId: 'a1',
      accountName: 'VCB',
      expectedDate: '2026-11-12',
      actualDate: '2026-11-12',
      status: 'Đã thực hiện',
      isArchived: false,
      attachments: [sampleAttachment],
      auditHistory: [],
    },
    // Scheduled same-day pair on 2026-11-22: -15M (causes negative dip to -2M!)
    {
      id: 'f1',
      userId: 'u1',
      code: 'KC-2026.11-02',
      kind: 'expense',
      name: 'Thanh toán thiết bị',
      amount: 16000000,
      category: 'Mua sắm',
      method: 'Chuyển khoản ngân hàng',
      accountId: 'a1',
      accountName: 'VCB',
      expectedDate: '2026-11-22',
      status: 'Dự kiến',
      isArchived: false,
      attachments: [],
      auditHistory: [],
    },
    {
      id: 'f2',
      userId: 'u1',
      code: 'KT-2026.11-02',
      kind: 'income',
      name: 'Hoàn cọc',
      amount: 1000000,
      category: 'Tiền thưởng',
      method: 'Chuyển khoản ngân hàng',
      accountId: 'a1',
      accountName: 'VCB',
      expectedDate: '2026-11-22',
      status: 'Dự kiến',
      isArchived: false,
      attachments: [],
      auditHistory: [],
    },
    // Later scheduled income on 2026-12-05 (+8M -> recovers to +6M)
    {
      id: 'f3',
      userId: 'u1',
      code: 'KT-2026.12-01',
      kind: 'income',
      name: 'Lương T12',
      amount: 8000000,
      category: 'Tiền lương',
      method: 'Chuyển khoản ngân hàng',
      accountId: 'a1',
      accountName: 'VCB',
      expectedDate: '2026-12-05',
      status: 'Dự kiến',
      isArchived: false,
      attachments: [],
      auditHistory: [],
    },
    // Far future (> 30 days) on 2027-01-15 (+4M)
    {
      id: 'f4',
      userId: 'u1',
      code: 'KT-2027.01-01',
      kind: 'income',
      name: 'Thưởng Tết',
      amount: 4000000,
      category: 'Tiền thưởng',
      method: 'Chuyển khoản ngân hàng',
      accountId: 'a1',
      accountName: 'VCB',
      expectedDate: '2027-01-15',
      status: 'Dự kiến',
      isArchived: false,
      attachments: [],
      auditHistory: [],
    },
    // Cancelled future expense must be ignored
    {
      id: 'fc',
      userId: 'u1',
      code: 'KC-2026.11-09',
      kind: 'expense',
      name: 'Đơn hủy',
      amount: 99000000,
      category: 'Mua sắm',
      method: 'Chuyển khoản ngân hàng',
      accountId: 'a1',
      accountName: 'VCB',
      expectedDate: '2026-11-25',
      status: 'Đã hủy',
      isArchived: false,
      attachments: [],
      auditHistory: [],
    },
  ];

  // Horizon = 30 days from 2026-11-19 excludes 2027-01-15
  const horizon30 = computeBalanceForecast(accounts, txs, {
    todayIso: '2026-11-19',
    horizonDays: 30,
  });

  // History has 2 realized points + 1 today anchor (2026-11-19)
  assert.equal(horizon30.history.length, 3);
  assert.equal(horizon30.history[0].balance, 15000000);
  assert.equal(horizon30.history[1].balance, 13000000);
  assert.equal(horizon30.history[2].isTodayAnchor, true);
  assert.equal(horizon30.history[2].balance, 13000000);

  // Forecast has 2 grouped dates: 2026-11-22 (-2M) and 2026-12-05 (+6M)
  assert.equal(horizon30.forecast.length, 2);
  assert.equal(horizon30.forecast[0].date, '2026-11-22');
  assert.equal(horizon30.forecast[0].delta, -15000000);
  assert.equal(horizon30.forecast[0].balance, -2000000);
  assert.equal(horizon30.forecast[0].scheduledItems?.length, 2);
  assert.equal(horizon30.forecast[1].date, '2026-12-05');
  assert.equal(horizon30.forecast[1].balance, 6000000);

  assert.equal(horizon30.scheduledIncomeTotal, 9000000);
  assert.equal(horizon30.scheduledExpenseTotal, 16000000);
  assert.equal(horizon30.scheduledCount, 3);
  assert.equal(horizon30.projectedEndBalance, 6000000);
  assert.equal(horizon30.projectedNetChange, -7000000);
  assert.equal(horizon30.hasNegativeRisk, true);
  assert.equal(horizon30.lowestProjectedBalance, -2000000);
  assert.equal(horizon30.lowestProjectedDate, '2026-11-22');

  // All scheduled items (horizonDays: null) includes 2027-01-15
  const allHorizon = computeBalanceForecast(accounts, txs, {
    todayIso: '2026-11-19',
    horizonDays: null,
  });
  assert.equal(allHorizon.forecast.length, 3);
  assert.equal(allHorizon.projectedEndBalance, 10000000);

  // Account with balance & no realized history anchors today cleanly
  const noHistory = computeBalanceForecast(
    [{ id: 'a1', userId: 'u1', type: 'cash', name: 'Ví', initialBalance: 5000000, currentBalance: 5000000 }],
    [txs[4]], // only 2026-12-05 +8M
    { todayIso: '2026-11-19' }
  );
  assert.equal(noHistory.history.length, 1);
  assert.equal(noHistory.history[0].isTodayAnchor, true);
  assert.equal(noHistory.history[0].balance, 5000000);
  assert.equal(noHistory.forecast.length, 1);
  assert.equal(noHistory.forecast[0].balance, 13000000);
});

test('filterTransactionsByQuery filters in real-time by name, counterparty, or note content', () => {
  const base: Omit<
    Transaction,
    'id' | 'code' | 'name' | 'counterparty' | 'description' | 'reason'
  > = {
    userId: 'u1',
    kind: 'expense',
    amount: 100000,
    category: 'Ăn uống',
    method: 'Tiền mặt',
    accountId: 'a1',
    accountName: 'Ví',
    expectedDate: '2026-11-19',
    status: 'Dự kiến',
    isArchived: false,
    attachments: [],
    auditHistory: [],
  };

  const list: Transaction[] = [
    {
      ...base,
      id: '1',
      code: 'KC-2026.11-01',
      name: 'Thanh toán tiền điện T11',
      counterparty: 'Công ty Điện lực EVN',
      description: 'Hóa đơn phòng trọ tầng 2',
    },
    {
      ...base,
      id: '2',
      code: 'KC-2026.11-02',
      name: 'Mua sách chuyên ngành',
      counterparty: 'Nhà sách Phương Nam',
      description: 'Tài liệu nghiên cứu AI',
    },
    {
      ...base,
      id: '3',
      code: 'KC-2026.11-03',
      name: 'Ăn trưa văn phòng',
      counterparty: 'Quán Cơm Tấm Sài Gòn',
      reason: 'Tiếp khách đối tác',
    },
  ];

  // Empty/whitespace returns all
  assert.equal(filterTransactionsByQuery(list, '').length, 3);
  assert.equal(filterTransactionsByQuery(list, '   ').length, 3);

  // Match by name (case-insensitive & ASCII accent-insensitive)
  assert.deepEqual(
    filterTransactionsByQuery(list, 'tiền điện').map((t) => t.id),
    ['1']
  );
  assert.deepEqual(
    filterTransactionsByQuery(list, 'tien dien').map((t) => t.id),
    ['1']
  );

  // Match by counterparty
  assert.deepEqual(
    filterTransactionsByQuery(list, 'Phương Nam').map((t) => t.id),
    ['2']
  );

  // Match by note / description / reason
  assert.deepEqual(
    filterTransactionsByQuery(list, 'phòng trọ').map((t) => t.id),
    ['1']
  );
  assert.deepEqual(
    filterTransactionsByQuery(list, 'nghiên cứu').map((t) => t.id),
    ['2']
  );
  assert.deepEqual(
    filterTransactionsByQuery(list, 'đối tác').map((t) => t.id),
    ['3']
  );

  // Multi-word across name + counterparty
  assert.deepEqual(
    filterTransactionsByQuery(list, 'điện EVN').map((t) => t.id),
    ['1']
  );

  // Non-matching query returns empty
  assert.equal(filterTransactionsByQuery(list, 'không tồn tại').length, 0);
});

test('internal transfers (CK) never count as income, expense, budget spend, or aggregate net delta', () => {
  assert.equal(buildTransactionCode('transfer', '2026.11', 1), 'CK-2026.11-01');
  assert.equal(toVndInt(1250000.6), 1250001);

  assert.equal(
    validateTransactionStatusChange('transfer', 'Đã thực hiện', '2026-11-19', [], 'a1', false, 'a1').valid,
    false
  );
  assert.equal(
    validateTransactionStatusChange('transfer', 'Đã thực hiện', '', [], 'a1', false, 'a2').valid,
    false
  );
  assert.equal(
    validateTransactionStatusChange('transfer', 'Đã thực hiện', '2026-11-19', [], 'a1', false, 'a2').valid,
    true
  );

  assert.equal(computeTransferDestinationDelta(false, true, 5000000, 5000000), 5000000);
  assert.equal(computeTransferDestinationDelta(true, false, 5000000, 5000000), -5000000);

  const accounts: FinancialAccount[] = [
    { id: 'a1', userId: 'u1', type: 'bank', name: 'VCB', initialBalance: 20000000, currentBalance: 15000000 },
    { id: 'a2', userId: 'u1', type: 'savings', name: 'Tiết kiệm', initialBalance: 0, currentBalance: 5000000 },
  ];

  const txs: Transaction[] = [
    {
      id: 't1',
      userId: 'u1',
      code: 'CK-2026.11-01',
      kind: 'transfer',
      name: 'Chuyển quỹ tiết kiệm',
      amount: 5000000,
      category: 'Gửi tiết kiệm',
      method: 'Chuyển khoản ngân hàng',
      accountId: 'a1',
      accountName: 'VCB',
      toAccountId: 'a2',
      toAccountName: 'Tiết kiệm',
      expectedDate: '2026-11-10',
      actualDate: '2026-11-10',
      status: 'Đã thực hiện',
      isArchived: true,
      attachments: [],
      auditHistory: [],
    },
  ];

  const summary = computeFinancialSummary(accounts, txs);
  assert.equal(summary.totalAvailableBalance, 20000000);
  assert.equal(summary.totalCollectedIncome, 0);
  assert.equal(summary.totalPaidExpense, 0);
  assert.equal(summary.netRealizedCashflow, 0);
  assert.equal(summary.totalTransferVolume, 5000000);

  const alloc = computeAccountAllocation(accounts);
  assert.equal(alloc.byType.savings.count, 1);
  assert.equal(alloc.byType.savings.total, 5000000);

  const archiveSum = computeArchiveSummary(txs);
  assert.equal(archiveSum.archivedTransferCount, 1);
  assert.equal(archiveSum.archivedTransferTotal, 5000000);

  const monthly = computeMonthlySeries(txs, 2026);
  assert.equal(monthly[10].income, 0);
  assert.equal(monthly[10].expense, 0);
  assert.equal(computeBalanceTimeline(accounts, txs).length, 0);
});

test('computePlannedVsActualReport computes accurate variance and excludes cancelled and transfers', () => {
  const base = {
    userId: 'u1',
    method: 'Chuyển khoản ngân hàng',
    accountId: 'a1',
    accountName: 'VCB',
    isArchived: false,
    attachments: [],
    auditHistory: [],
  };
  const txs: Transaction[] = [
    {
      ...base,
      id: '1',
      code: 'KT-2026.11-01',
      kind: 'income',
      name: 'Lương T11',
      category: 'Tiền lương',
      amount: 20000000,
      actualAmount: 21000000,
      expectedDate: '2026-11-05',
      actualDate: '2026-11-05',
      status: 'Đã thực hiện',
    },
    {
      ...base,
      id: '2',
      code: 'KC-2026.11-01',
      kind: 'expense',
      name: 'Tiền nhà T11',
      category: 'Sinh hoạt cá nhân',
      amount: 5000000,
      actualAmount: 5000000,
      expectedDate: '2026-11-06',
      actualDate: '2026-11-06',
      status: 'Đã thực hiện',
    },
    {
      ...base,
      id: '3',
      code: 'KC-2026.11-02',
      kind: 'expense',
      name: 'Mua sắm dự kiến',
      category: 'Mua sắm',
      amount: 2000000,
      expectedDate: '2026-11-28',
      status: 'Dự kiến',
    },
    {
      ...base,
      id: '4',
      code: 'KC-2026.11-03',
      kind: 'expense',
      name: 'Đã hủy',
      category: 'Mua sắm',
      amount: 9000000,
      expectedDate: '2026-11-28',
      status: 'Đã hủy',
    },
    {
      ...base,
      id: '5',
      code: 'CK-2026.11-01',
      kind: 'transfer',
      name: 'Chuyển nội bộ',
      category: 'Chuyển khoản nội bộ',
      toAccountId: 'a2',
      toAccountName: 'Ví',
      amount: 4000000,
      expectedDate: '2026-11-12',
      actualDate: '2026-11-12',
      status: 'Đã thực hiện',
    },
  ];

  const report = computePlannedVsActualReport(txs, { year: 2026, month: '11' });
  assert.equal(report.plannedIncome, 20000000);
  assert.equal(report.actualIncome, 21000000);
  assert.equal(report.incomeVariance, 1000000);
  assert.equal(report.plannedExpense, 7000000);
  assert.equal(report.actualExpense, 5000000);
  assert.equal(report.expenseVariance, -2000000);
  assert.equal(report.plannedNet, 13000000);
  assert.equal(report.actualNet, 16000000);
  assert.equal(report.categories.length, 3);
});

test('evaluateSavingsGoal and computeSavingsSummary calculate progress and monthly pace', () => {
  const goals: SavingsGoal[] = [
    {
      id: 'g1',
      userId: 'u1',
      name: 'Quỹ dự phòng',
      targetAmount: 60000000,
      currentAmount: 30000000,
      targetDate: '2027-05-19', // ~181 days after 2026-11-19 (~6 months)
      status: 'active',
    },
    {
      id: 'g2',
      userId: 'u1',
      name: 'Mua Laptop',
      targetAmount: 25000000,
      currentAmount: 25000000,
      status: 'completed',
    },
  ];

  const ev1 = evaluateSavingsGoal(goals[0], '2026-11-19');
  assert.equal(ev1.percent, 50);
  assert.equal(ev1.remainingAmount, 30000000);
  assert.equal(ev1.isCompleted, false);
  assert.equal(ev1.isOverdue, false);
  assert.ok((ev1.monthlyPaceNeeded || 0) > 4500000 && (ev1.monthlyPaceNeeded || 0) < 5500000);

  const summary = computeSavingsSummary(goals);
  assert.equal(summary.totalTarget, 85000000);
  assert.equal(summary.totalAccumulated, 55000000);
  assert.equal(summary.activeCount, 1);
  assert.equal(summary.completedCount, 1);
});

test('detectDuplicateTransactions flags matching existing transactions and in-file duplicates', () => {
  const existing: Transaction[] = [
    {
      id: 'e1',
      userId: 'u1',
      code: 'KC-2026.11-01',
      kind: 'expense',
      name: 'Tiền điện T11',
      amount: 850000,
      category: 'Sinh hoạt cá nhân',
      method: 'Chuyển khoản ngân hàng',
      accountId: 'a1',
      accountName: 'VCB',
      expectedDate: '2026-11-15',
      status: 'Đã thực hiện',
      isArchived: false,
      attachments: [],
      auditHistory: [],
    },
  ];

  const dupResult = detectDuplicateTransactions(
    [
      { rowNumber: 6, kind: 'expense', name: 'tien dien T11', amount: 850000, expectedDate: '2026-11-15' },
      { rowNumber: 7, kind: 'income', name: 'Thưởng dự án', amount: 3000000, expectedDate: '2026-11-20' },
      { rowNumber: 8, kind: 'income', name: 'Thưởng dự án', amount: 3000000, expectedDate: '2026-11-20' },
    ],
    existing
  );

  assert.equal(dupResult.duplicateRowNumbers.has(6), true);
  assert.equal(dupResult.duplicateRowNumbers.has(7), false);
  assert.equal(dupResult.duplicateRowNumbers.has(8), true);
  assert.ok(dupResult.reasonByRow.get(6)?.includes('KC-2026.11-01'));
  assert.ok(dupResult.reasonByRow.get(8)?.includes('dòng 7'));
});

test('paginateItems, extended sortTransactions, searchGlobalEntities, and Excel transfer/savings parsing work cleanly', () => {
  const page2 = paginateItems([1, 2, 3, 4, 5], 2, 2);
  assert.deepEqual(page2.items, [3, 4]);
  assert.equal(page2.totalPages, 3);
  assert.equal(page2.startIndex, 2);
  assert.equal(page2.endIndex, 4);

  const clampedPage = paginateItems([1, 2, 3], 99, 2);
  assert.equal(clampedPage.page, 2);
  assert.deepEqual(clampedPage.items, [3]);

  const txA: Transaction = {
    id: '1', userId: 'u1', code: 'KT-2026.11-01', kind: 'income', name: 'Bán sách', amount: 100000,
    category: 'Tiền bán hàng', method: 'Tiền mặt', accountId: 'a1', accountName: 'Ví',
    expectedDate: '2026-11-10', status: 'Dự kiến', isArchived: false, attachments: [], auditHistory: [],
  };
  const txB: Transaction = {
    ...txA, id: '2', code: 'KC-2026.11-02', kind: 'expense', name: 'Ăn sáng',
  };
  assert.deepEqual(sortTransactions([txA, txB], 'name', 'asc').map((t) => t.id), ['2', '1']);
  assert.deepEqual(sortTransactions([txA, txB], 'code', 'desc').map((t) => t.id), ['1', '2']);

  const searchRes = searchGlobalEntities({
    query: 'quỹ dự phòng',
    transactions: [txA, txB],
    accounts: [],
    budgets: [],
    savingsGoals: [{ id: 'g1', userId: 'u1', name: 'Quỹ dự phòng', targetAmount: 10000000, currentAmount: 2000000, status: 'active' }],
  });
  assert.equal(searchRes.length, 1);
  assert.equal(searchRes[0].targetPage, 'savings');

  const parsed = parseSingleSheetRows([
    [...TEMPLATE_HEADERS],
    ['Tài khoản', 'Sổ Tiết Kiệm BIDV', 'Tài khoản tiết kiệm', '50000000', '50000000', 'BIDV', '999', '', '', '', '', '', '', ''],
    ['Chuyển khoản', 'Nạp quỹ tiết kiệm', 'Gửi tiết kiệm', '5000000', '', 'Chuyển khoản ngân hàng', 'VCB', 'Sổ Tiết Kiệm BIDV', '19/11/2026', '19/11/2026', 'Đã thực hiện', '', '', ''],
  ]);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.accounts[0].type, 'savings');
  assert.equal(parsed.transfers.length, 1);
  assert.equal(parsed.transfers[0].toAccountName, 'Sổ Tiết Kiệm BIDV');
});

test('buildPdfDocumentFromJpegPages outputs valid multi-page PDF 1.4 binary', () => {
  const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9]);
  const pdf = buildPdfDocumentFromJpegPages([
    { data: fakeJpeg, width: 1240, height: 1754 },
    { data: fakeJpeg, width: 1240, height: 1754 },
  ]);
  const text = new TextDecoder().decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.includes('/Count 2'));
  assert.ok(text.includes('%%EOF'));
});

test('validateTransactionStatusChange allows realization/archive without attachments when requireProof=false', () => {
  const withoutDriveExp = validateTransactionStatusChange(
    'expense',
    'Đã thực hiện',
    '2026-11-23',
    [],
    'acc-1',
    true,
    undefined,
    false
  );
  assert.equal(withoutDriveExp.valid, true);

  const withoutDriveInc = validateTransactionStatusChange(
    'income',
    'Đã thực hiện',
    '2026-11-23',
    [],
    'acc-1',
    true,
    undefined,
    false
  );
  assert.equal(withoutDriveInc.valid, true);

  // Still requires actualDate and accountId even when requireProof=false
  const missingDate = validateTransactionStatusChange(
    'expense',
    'Đã thực hiện',
    '',
    [],
    'acc-1',
    true,
    undefined,
    false
  );
  assert.equal(missingDate.valid, false);

  const missingAccount = validateTransactionStatusChange(
    'income',
    'Đã thực hiện',
    '2026-11-23',
    [],
    '',
    true,
    undefined,
    false
  );
  assert.equal(missingAccount.valid, false);
});

test('formatFirebaseAuthError translates common OAuth and testing-mode errors into Vietnamese guidance', () => {
  assert.ok(
    formatFirebaseAuthError(new Error('Firebase: Error (auth/popup-closed-by-user).')).includes('đã được đóng')
  );
  assert.ok(
    formatFirebaseAuthError(new Error('Firebase: Error (auth/popup-blocked).')).includes('Popup')
  );
  assert.ok(
    formatFirebaseAuthError(new Error('Firebase: Error (auth/unauthorized-domain).')).includes('Authorized domains')
  );
  const testingMsg = formatFirebaseAuthError(
    new Error('access_denied: app has not completed Google verification (testing mode)')
  );
  assert.ok(testingMsg.includes('Publish App'));
  assert.ok(testingMsg.includes('Google Cloud Console'));
});




