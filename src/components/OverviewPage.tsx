import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Clock,
  Download,
  ExternalLink,
  FilterX,
  Hourglass,
  Landmark,
  Minus,
  PiggyBank,
  Plus,
  Scale,
  Sheet,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import {
  INCOME_CATEGORIES,
  TRANSACTION_STATUSES,
  type BudgetLimit,
  type FinancialAccount,
  type SavingsGoal,
  type Transaction,
} from '../types/finance';
import {
  computeBalanceForecast,
  computeBalanceTimeline,
  computeCategoryBreakdown,
  computeExpenseForecast,
  computeFinancialSummary,
  computeMonthlySeries,
  computeSavingsSummary,
  formatDateVN,
  formatVND,
  getEffectiveTransactionAmount,
  getTransactionEffectiveDate,
  mergeExpenseCategories,
  normalizeTransactionStatus,
  sortTransactions,
  type BalanceForecastPoint,
  type BalanceForecastResult,
  type ExpenseForecastResult,
  type SortDirection,
  type TransactionSortField,
} from '../utils/financeRules';
import { exportFinanceWorkbook } from '../utils/excelExport';
import { ReminderCenter } from './ReminderCenter';
import { StatusText } from './StatusText';
import type { ActivePage } from './SidebarLayout';

interface OverviewPageProps {
  accounts: FinancialAccount[];
  transactions: Transaction[];
  budgets: BudgetLimit[];
  savingsGoals?: SavingsGoal[];
  expenseCategories: string[];
  incomeCategories?: string[];
  reminderLeadDays?: number;
  spreadsheetId?: string;
  hasWorkspaceToken: boolean;
  userEmail?: string;
  pushPermission: NotificationPermission | 'unsupported';
  pushEnabled: boolean;
  onTogglePush: () => void;
  onSyncGoogleSheet: () => Promise<{ spreadsheetUrl: string } | null>;
  onReconnectDrive: () => void;
  onNavigate?: (page: ActivePage) => void;
}

const CHART_PALETTE = [
  '#2563eb', // Cobalt
  '#059669', // Emerald
  '#f43f5e', // Coral
  '#7c3aed', // Violet
  '#d97706', // Amber
  '#0d9488', // Teal
  '#4f46e5', // Indigo
  '#ea580c', // Orange
];

export const OverviewPage: React.FC<OverviewPageProps> = ({
  accounts,
  transactions,
  budgets,
  savingsGoals = [],
  expenseCategories,
  incomeCategories,
  reminderLeadDays = 3,
  spreadsheetId,
  hasWorkspaceToken,
  userEmail,
  pushPermission,
  pushEnabled,
  onTogglePush,
  onSyncGoogleSheet,
  onReconnectDrive,
  onNavigate,
}) => {
  const currentYear = new Date().getFullYear();
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedIncomeCat, setSelectedIncomeCat] = useState<string>('ALL');
  const [selectedExpenseCat, setSelectedExpenseCat] = useState<string>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  const [hoveredMonthIdx, setHoveredMonthIdx] = useState<number | null>(null);
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const [balanceHorizonDays, setBalanceHorizonDays] = useState<number | null>(90);

  const [isSyncingSheet, setIsSyncingSheet] = useState(false);
  const [sheetNotice, setSheetNotice] = useState<{
    type: 'success' | 'error';
    message: string;
    url?: string;
  } | null>(null);

  const availableYears = useMemo(() => {
    const years = new Set<number>([currentYear]);
    for (const tx of transactions) {
      const d = getTransactionEffectiveDate(tx);
      const m = /^(\d{4})/.exec(d);
      if (m) years.add(Number(m[1]));
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [transactions, currentYear]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      const dateStr = getTransactionEffectiveDate(tx);
      const match = /^(\d{4})-(\d{2})/.exec(dateStr);
      const txYear = match ? Number(match[1]) : null;
      const txMonth = match ? match[2] : null;

      if (txYear !== null && txYear !== selectedYear) return false;
      if (selectedMonth !== 'ALL' && txMonth !== selectedMonth) return false;

      if (tx.kind === 'income' && selectedIncomeCat !== 'ALL') {
        if (tx.category !== selectedIncomeCat) return false;
      }
      if (tx.kind === 'expense' && selectedExpenseCat !== 'ALL') {
        if (tx.category !== selectedExpenseCat) return false;
      }
      if (
        selectedStatus !== 'ALL' &&
        normalizeTransactionStatus(tx.status) !== selectedStatus
      ) {
        return false;
      }

      return true;
    });
  }, [
    transactions,
    selectedYear,
    selectedMonth,
    selectedIncomeCat,
    selectedExpenseCat,
    selectedStatus,
  ]);

  const summary = useMemo(
    () => computeFinancialSummary(accounts, filteredTransactions),
    [accounts, filteredTransactions]
  );

  const savingsSummary = useMemo(
    () => computeSavingsSummary(savingsGoals),
    [savingsGoals]
  );

  const incomeRows = useMemo(
    () => filteredTransactions.filter((t) => t.kind === 'income'),
    [filteredTransactions]
  );

  const expenseRows = useMemo(
    () => filteredTransactions.filter((t) => t.kind === 'expense'),
    [filteredTransactions]
  );

  const monthlySeries = useMemo(
    () => computeMonthlySeries(filteredTransactions, selectedYear),
    [filteredTransactions, selectedYear]
  );

  const annualIncome = useMemo(
    () => monthlySeries.reduce((s, m) => s + m.income, 0),
    [monthlySeries]
  );
  const annualExpense = useMemo(
    () => monthlySeries.reduce((s, m) => s + m.expense, 0),
    [monthlySeries]
  );

  const expenseBreakdown = useMemo(
    () => computeCategoryBreakdown(filteredTransactions, 'expense'),
    [filteredTransactions]
  );

  const balanceTimeline = useMemo(
    () => computeBalanceTimeline(accounts, filteredTransactions),
    [accounts, filteredTransactions]
  );

  const expenseForecast = useMemo(
    () =>
      computeExpenseForecast(transactions, {
        category: selectedExpenseCat,
        forecastMonths: 3,
        historyWindow: 6,
      }),
    [transactions, selectedExpenseCat]
  );

  const balanceForecast = useMemo(
    () =>
      computeBalanceForecast(accounts, transactions, {
        horizonDays: balanceHorizonDays,
      }),
    [accounts, transactions, balanceHorizonDays]
  );

  const filterExpenseCategories = useMemo(
    () => mergeExpenseCategories(expenseCategories, transactions),
    [expenseCategories, transactions]
  );

  const allStatuses = TRANSACTION_STATUSES;

  const handleResetFilters = () => {
    setSelectedMonth('ALL');
    setSelectedYear(currentYear);
    setSelectedIncomeCat('ALL');
    setSelectedExpenseCat('ALL');
    setSelectedStatus('ALL');
  };

  const handleExportExcel = () => {
    exportFinanceWorkbook({
      transactions: filteredTransactions,
      accounts,
      budgets,
      selectedYear,
    });
  };

  const handleSyncSheets = async () => {
    if (!hasWorkspaceToken) {
      onReconnectDrive();
      return;
    }
    setIsSyncingSheet(true);
    setSheetNotice(null);
    try {
      const res = await onSyncGoogleSheet();
      if (res?.spreadsheetUrl) {
        setSheetNotice({
          type: 'success',
          message: 'Đã đồng bộ dữ liệu thực tế lên Google Sheets.',
          url: res.spreadsheetUrl,
        });
      }
    } catch (err) {
      setSheetNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Đồng bộ Google Sheets thất bại.',
      });
    } finally {
      setIsSyncingSheet(false);
    }
  };

  const maxMonthlyVal = useMemo(() => {
    return Math.max(
      1,
      ...monthlySeries.map((m) => Math.max(m.income, m.expense))
    );
  }, [monthlySeries]);

  const hoveredMonthData =
    hoveredMonthIdx !== null ? monthlySeries[hoveredMonthIdx] : null;

  return (
    <div className="space-y-6 animate-fintech-in">
      {/* Header & Export Actions (Strictly Read-Only Page: No Create/Edit buttons) */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0B1437]">
            TỔNG QUAN TÀI CHÍNH
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Theo dõi số dư thực tế, phân tích dòng tiền &amp; xuất báo cáo tài chính
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleSyncSheets}
            disabled={isSyncingSheet}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200/90 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50 hover:border-slate-300 shadow-xs transition-all whitespace-nowrap disabled:opacity-50"
          >
            <Sheet className="w-4 h-4 text-emerald-600" />
            <span>{isSyncingSheet ? 'Đang đồng bộ...' : 'Đồng bộ Google Sheets'}</span>
          </button>

          {spreadsheetId && (
            <a
              href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white border border-slate-200/90 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50 shadow-xs transition-all whitespace-nowrap"
            >
              <span>Mở Sheet</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}

          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 text-white text-sm font-semibold rounded-xl hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-600/20 transition-all whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Xuất Excel (.xlsx)</span>
          </button>
        </div>
      </div>

      {sheetNotice && (
        <div
          className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl border text-sm font-medium shadow-xs ${
            sheetNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          <span>{sheetNotice.message}</span>
          {sheetNotice.url && (
            <a
              href={sheetNotice.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
            >
              Mở Google Sheet <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      {/* A. 6 Distinctly Colored Modern Fintech KPI Cards */}
      <section
        aria-label="Tổng quan tài chính"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {/* 1. Tổng số tiền hiện có — Deep Navy to Cobalt */}
        <div className="rounded-2xl p-5 bg-gradient-to-br from-[#0B1437] via-[#132154] to-[#1E3A8A] text-white shadow-lg shadow-blue-950/15 hover:-translate-y-0.5 transition-all duration-200 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-200">
              Tổng số tiền hiện có
            </p>
            <div className="w-9 h-9 rounded-xl bg-white/15 text-blue-200 flex items-center justify-center shrink-0">
              <Wallet className="w-4 h-4" />
            </div>
          </div>
          <p className="mt-3 text-2xl sm:text-[26px] font-extrabold font-mono tabular-nums tracking-tight text-white">
            {formatVND(summary.totalAvailableBalance)}
          </p>
          <p className="mt-2 text-xs text-blue-200/85">
            Tổng hợp trên {accounts.length} nguồn tiền quản lý
          </p>
        </div>

        {/* 2. Tổng tiền đã thu — Emerald */}
        <div className="rounded-2xl p-5 bg-gradient-to-br from-emerald-50/90 via-white to-emerald-50/30 border border-emerald-200/80 shadow-xs hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Tổng tiền đã thu
            </p>
            <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs shadow-emerald-600/25">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
          </div>
          <p className="mt-3 text-2xl sm:text-[26px] font-extrabold font-mono tabular-nums tracking-tight text-emerald-700">
            {formatVND(summary.totalCollectedIncome)}
          </p>
          <p className="mt-2 text-xs text-slate-600">
            Đã thu &amp; đối soát trong kỳ lọc
          </p>
        </div>

        {/* 3. Tổng tiền đã chi — Coral Red */}
        <div className="rounded-2xl p-5 bg-gradient-to-br from-rose-50/90 via-white to-rose-50/30 border border-rose-200/80 shadow-xs hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-rose-700">
              Tổng tiền đã chi
            </p>
            <div className="w-9 h-9 rounded-xl bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-xs shadow-rose-500/25">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          </div>
          <p className="mt-3 text-2xl sm:text-[26px] font-extrabold font-mono tabular-nums tracking-tight text-rose-600">
            {formatVND(summary.totalPaidExpense)}
          </p>
          <p className="mt-2 text-xs text-slate-600">
            Đã chi, đối soát &amp; hoàn thành trong kỳ lọc
          </p>
        </div>

        {/* 4. Số dư thực tế — Violet Indigo */}
        <div className="rounded-2xl p-5 bg-gradient-to-br from-violet-50/90 via-white to-indigo-50/30 border border-violet-200/80 shadow-xs hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">
              Số dư thực tế
            </p>
            <div className="w-9 h-9 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0 shadow-xs shadow-violet-600/25">
              <Scale className="w-4 h-4" />
            </div>
          </div>
          <p className="mt-3 text-2xl sm:text-[26px] font-extrabold font-mono tabular-nums tracking-tight text-violet-900">
            {formatVND(summary.actualBalance)}
          </p>
          <p className="mt-2 text-xs text-slate-600">
            Thu - chi kỳ lọc:{' '}
            <strong
              className={`font-mono ${
                summary.netRealizedCashflow >= 0 ? 'text-emerald-700' : 'text-rose-600'
              }`}
            >
              {summary.netRealizedCashflow >= 0 ? '+' : ''}
              {formatVND(summary.netRealizedCashflow)}
            </strong>
          </p>
        </div>

        {/* 5. Tổng khoản thu đang chờ — Teal / Cyan */}
        <div className="rounded-2xl p-5 bg-gradient-to-br from-teal-50/90 via-white to-cyan-50/30 border border-teal-200/80 shadow-xs hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-teal-700">
              Tổng khoản thu đang chờ
            </p>
            <div className="w-9 h-9 rounded-xl bg-teal-600 text-white flex items-center justify-center shrink-0 shadow-xs shadow-teal-600/25">
              <Clock className="w-4 h-4" />
            </div>
          </div>
          <p className="mt-3 text-2xl sm:text-[26px] font-extrabold font-mono tabular-nums tracking-tight text-teal-800">
            {formatVND(summary.pendingIncome)}
          </p>
          <p className="mt-2 text-xs text-slate-600">
            Chưa cộng vào số dư thực tế
          </p>
        </div>

        {/* 6. Tổng khoản chi đang chờ thanh toán — Amber / Orange */}
        <div className="rounded-2xl p-5 bg-gradient-to-br from-amber-50/95 via-white to-orange-50/30 border border-amber-200/80 shadow-xs hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
              Khoản chi đang chờ thanh toán
            </p>
            <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs shadow-amber-500/25">
              <Hourglass className="w-4 h-4" />
            </div>
          </div>
          <p className="mt-3 text-2xl sm:text-[26px] font-extrabold font-mono tabular-nums tracking-tight text-amber-800">
            {formatVND(summary.pendingExpense)}
          </p>
          <p className="mt-2 text-xs text-slate-600">
            Chưa trừ khỏi số dư thực tế
          </p>
        </div>
      </section>

      {/* Actionable Empty State Onboarding when accounts or transactions are missing */}
      {(accounts.length === 0 || transactions.length === 0) && onNavigate && (
        <section
          aria-label="Hướng dẫn bắt đầu nhanh"
          className="bg-white border border-blue-200/80 rounded-2xl p-5 shadow-xs flex flex-col md:flex-row md:items-center md:justify-between gap-4"
        >
          <div className="space-y-1">
            <h2 className="font-display text-base font-bold text-[#0B1437]">
              {accounts.length === 0
                ? 'Bước 1: Tạo tài khoản hoặc ví tiền đầu tiên'
                : 'Bước 2: Ghi nhận giao dịch thu / chi đầu tiên'}
            </h2>
            <p className="text-xs text-slate-600">
              {accounts.length === 0
                ? 'Thiết lập tiền mặt, ngân hàng hoặc ví điện tử để hệ thống theo dõi số dư thực tế chính xác.'
                : 'Số dư và báo cáo tự động cập nhật ngay khi bạn tạo giao dịch hoặc nhập từ file Excel mẫu.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {accounts.length === 0 && (
              <button
                type="button"
                onClick={() => onNavigate('accounts')}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0B1437] text-white text-xs font-bold rounded-xl hover:bg-blue-900 transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Thêm tài khoản</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('transactions')}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 transition-colors whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tạo giao dịch</span>
            </button>
          </div>
        </section>
      )}

      {/* Savings Goals & Internal Transfer Snapshot Strip */}
      <section
        aria-label="Tích lũy mục tiêu và chuyển khoản nội bộ"
        className="grid grid-cols-1 md:grid-cols-2 gap-4"
      >
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center shrink-0">
              <PiggyBank className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Mục tiêu tiết kiệm ({savingsGoals.length})
              </p>
              <p className="text-base sm:text-lg font-extrabold font-mono tabular-nums text-teal-800 truncate">
                {formatVND(savingsSummary.totalAccumulated)}{' '}
                <span className="text-xs font-medium text-slate-500">
                  / {formatVND(savingsSummary.totalTarget)} ({savingsSummary.overallPercent.toFixed(1)}%)
                </span>
              </p>
            </div>
          </div>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('savings')}
              className="px-3 py-1.5 text-xs font-bold text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              Xem tiết kiệm
            </button>
          )}
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Chuyển khoản nội bộ kỳ lọc
              </p>
              <p className="text-base sm:text-lg font-extrabold font-mono tabular-nums text-indigo-800 truncate">
                {formatVND(summary.totalTransferVolume)}{' '}
                <span className="text-xs font-medium text-slate-500">
                  (Không tính vào thu/chi)
                </span>
              </p>
            </div>
          </div>
          {onNavigate && (
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              Xem báo cáo
            </button>
          )}
        </div>
      </section>

      {/* Automatic Transaction Reminders (Read-Only on Overview) */}
      <ReminderCenter
        transactions={transactions}
        userEmail={userEmail}
        defaultLeadDays={reminderLeadDays}
        pushPermission={pushPermission}
        pushEnabled={pushEnabled}
        onTogglePush={onTogglePush}
      />

      {/* D. Filter Bar */}
      <section
        aria-label="Bộ lọc thống kê"
        className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div>
            <label htmlFor="filter-month" className="block text-xs font-semibold text-slate-600 mb-1">
              Tháng
            </label>
            <select
              id="filter-month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full h-9 px-2.5 text-sm bg-slate-50/60 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            >
              <option value="ALL">Tất cả các tháng</option>
              {Array.from({ length: 12 }, (_, i) => {
                const val = String(i + 1).padStart(2, '0');
                return (
                  <option key={val} value={val}>
                    Tháng {val}
                  </option>
                );
              })}
            </select>
          </div>

          <div>
            <label htmlFor="filter-year" className="block text-xs font-semibold text-slate-600 mb-1">
              Năm
            </label>
            <select
              id="filter-year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="w-full h-9 px-2.5 text-sm bg-slate-50/60 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  Năm {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-income-cat" className="block text-xs font-semibold text-slate-600 mb-1">
              Loại thu
            </label>
            <select
              id="filter-income-cat"
              value={selectedIncomeCat}
              onChange={(e) => setSelectedIncomeCat(e.target.value)}
              className="w-full h-9 px-2.5 text-sm bg-slate-50/60 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            >
              <option value="ALL">Tất cả loại thu</option>
              {(incomeCategories && incomeCategories.length > 0
                ? incomeCategories
                : INCOME_CATEGORIES
              ).map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-expense-cat" className="block text-xs font-semibold text-slate-600 mb-1">
              Loại chi
            </label>
            <select
              id="filter-expense-cat"
              value={selectedExpenseCat}
              onChange={(e) => setSelectedExpenseCat(e.target.value)}
              className="w-full h-9 px-2.5 text-sm bg-slate-50/60 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            >
              <option value="ALL">Tất cả loại chi</option>
              {filterExpenseCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-status" className="block text-xs font-semibold text-slate-600 mb-1">
              Trạng thái
            </label>
            <select
              id="filter-status"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="w-full h-9 px-2.5 text-sm bg-slate-50/60 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            >
              <option value="ALL">Tất cả trạng thái</option>
              {allStatuses.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          </div>

          <div>
            <button
              type="button"
              onClick={handleResetFilters}
              className="w-full h-9 inline-flex items-center justify-center gap-1.5 px-3 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap"
            >
              <FilterX className="w-4 h-4" />
              <span>Đặt lại lọc</span>
            </button>
          </div>
        </div>
      </section>

      {/* C. Visual Charts Row 1: Monthly Income vs Expense (2/3) + Expense Structure Donut & Bars (1/3) */}
      <section aria-label="Biểu đồ trực quan" className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Monthly Income vs Expense + Interactive Hover Tooltip */}
        <div className="xl:col-span-7 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Thu và Chi theo tháng ({selectedYear})
              </h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1">
                <span>
                  Tổng thu năm:{' '}
                  <strong className="font-mono tabular-nums text-emerald-600">
                    {formatVND(annualIncome)}
                  </strong>
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Tổng chi năm:{' '}
                  <strong className="font-mono tabular-nums text-rose-600">
                    {formatVND(annualExpense)}
                  </strong>
                </span>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-emerald-500 inline-block" />
                Thu
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-rose-500 inline-block" />
                Chi
              </span>
            </div>
          </div>

          {/* Interactive Tooltip Info Bar (Fixed height to prevent layout jump) */}
          <div className="h-9 px-3.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center justify-between text-xs">
            {hoveredMonthData ? (
              <>
                <span className="font-semibold text-slate-800">
                  {hoveredMonthData.label}/{selectedYear}
                </span>
                <div className="flex items-center gap-4 font-mono tabular-nums">
                  <span className="text-emerald-700 font-semibold">
                    Thu: {formatVND(hoveredMonthData.income)}
                  </span>
                  <span className="text-rose-600 font-semibold">
                    Chi: {formatVND(hoveredMonthData.expense)}
                  </span>
                  <span className="hidden sm:inline text-slate-700">
                    Ròng: {hoveredMonthData.net >= 0 ? '+' : ''}
                    {formatVND(hoveredMonthData.net)}
                  </span>
                </div>
              </>
            ) : (
              <span className="text-slate-400">
                Di chuột vào từng tháng để xem chi tiết số tiền thu, chi và chênh lệch
              </span>
            )}
          </div>

          <div className="w-full overflow-x-auto">
            <div className="min-w-[520px] h-56 flex items-end gap-2 pt-4 pb-1 border-b border-slate-200">
              {monthlySeries.map((m, idx) => {
                const incH = Math.round((m.income / maxMonthlyVal) * 168);
                const expH = Math.round((m.expense / maxMonthlyVal) * 168);
                const isHovered = hoveredMonthIdx === idx;
                return (
                  <div
                    key={m.month}
                    onMouseEnter={() => setHoveredMonthIdx(idx)}
                    onMouseLeave={() => setHoveredMonthIdx(null)}
                    className={`flex-1 flex flex-col items-center gap-1.5 rounded-lg py-1 transition-colors cursor-pointer ${
                      isHovered ? 'bg-blue-50/70' : ''
                    }`}
                    title={`${m.label}/${selectedYear} — Thu: ${formatVND(m.income)} | Chi: ${formatVND(m.expense)}`}
                  >
                    <div className="w-full h-44 flex items-end justify-center gap-1">
                      <div
                        className="w-3 sm:w-3.5 bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t-sm transition-all duration-200"
                        style={{ height: `${Math.max(m.income > 0 ? 4 : 0, incH)}px` }}
                      />
                      <div
                        className="w-3 sm:w-3.5 bg-gradient-to-t from-rose-600 to-rose-400 rounded-t-sm transition-all duration-200"
                        style={{ height: `${Math.max(m.expense > 0 ? 4 : 0, expH)}px` }}
                      />
                    </div>
                    <span
                      className={`text-[11px] font-mono ${
                        isHovered ? 'font-bold text-blue-700' : 'text-slate-500'
                      }`}
                    >
                      {m.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Expense Structure by Category with Donut + Multi-color Bars */}
        <div className="xl:col-span-5 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4 flex flex-col justify-between">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Cơ cấu chi tiêu theo loại
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tỷ trọng các danh mục đã chi trong kỳ lọc
            </p>
          </div>

          {expenseBreakdown.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-sm text-slate-400 text-center border border-dashed border-slate-200 rounded-xl">
              Chưa có dữ liệu chi tiêu thực tế trong kỳ lọc.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center">
              <div className="sm:col-span-5 flex justify-center">
                <ExpenseDonutChart
                  items={expenseBreakdown.slice(0, 6)}
                  hoveredCategory={hoveredCategory}
                  onHoverCategory={setHoveredCategory}
                />
              </div>

              <div className="sm:col-span-7 space-y-2.5 max-h-60 overflow-y-auto pr-1">
                {expenseBreakdown.slice(0, 8).map((item, idx) => {
                  const color = CHART_PALETTE[idx % CHART_PALETTE.length];
                  const active = hoveredCategory === item.category;
                  return (
                    <div
                      key={item.category}
                      onMouseEnter={() => setHoveredCategory(item.category)}
                      onMouseLeave={() => setHoveredCategory(null)}
                      className={`p-1.5 -mx-1.5 rounded-lg transition-colors ${
                        active ? 'bg-slate-50' : ''
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs gap-2 mb-1">
                        <span className="inline-flex items-center gap-1.5 text-slate-700 font-semibold truncate">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="truncate">{item.category}</span>
                        </span>
                        <span className="font-mono tabular-nums text-slate-900 shrink-0 font-semibold">
                          {item.percentage.toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(100, item.percentage)}%`,
                            backgroundColor: color,
                          }}
                        />
                      </div>
                      <p className="text-[11px] font-mono tabular-nums text-slate-500 mt-0.5 text-right">
                        {formatVND(item.amount)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* C2. Balance Movement + Historical Spending Forecast side-by-side on wide laptops */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Balance Movement Chart */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Biến động số dư theo thời gian
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Theo số dư ban đầu và các giao dịch thu / chi thực tế
              </p>
            </div>
            {balanceTimeline.length > 0 && (
              <span className="text-xs font-mono tabular-nums text-blue-700 font-semibold">
                {balanceTimeline.length} ngày phát sinh
              </span>
            )}
          </div>

          {balanceTimeline.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl">
              Chưa có phát sinh thu/chi thực tế để dựng đường biến động số dư.
            </div>
          ) : (
            <BalanceLineChart points={balanceTimeline} />
          )}
        </div>

        {/* Historical Spending Forecast Chart */}
        <div
          aria-label="Biểu đồ phân tích dự báo chi tiêu"
          className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4"
        >
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Phân tích &amp; dự báo chi tiêu (3 tháng tới)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Hồi quy xu hướng dựa trên lịch sử đã chi thực tế
                {selectedExpenseCat !== 'ALL' ? ` · ${selectedExpenseCat}` : ''}
              </p>
            </div>

            {expenseForecast.history.length > 0 && (
              <span
                className={`inline-flex items-center gap-1 text-xs font-bold shrink-0 ${
                  expenseForecast.trendDirection === 'up'
                    ? 'text-rose-600'
                    : expenseForecast.trendDirection === 'down'
                    ? 'text-emerald-700'
                    : 'text-slate-700'
                }`}
              >
                {expenseForecast.trendDirection === 'up' ? (
                  <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
                ) : expenseForecast.trendDirection === 'down' ? (
                  <TrendingDown className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>
                  {expenseForecast.trendDirection === 'up'
                    ? 'Xu hướng tăng'
                    : expenseForecast.trendDirection === 'down'
                    ? 'Xu hướng giảm'
                    : 'Ổn định'}
                </span>
              </span>
            )}
          </div>

          {expenseForecast.history.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-sm text-slate-400 text-center border border-dashed border-slate-200 rounded-xl">
              Chưa có dữ liệu chi tiêu thực tế để phân tích dự báo xu hướng tương lai.
            </div>
          ) : (
            <ExpenseForecastChart forecast={expenseForecast} />
          )}
        </div>
      </section>

      {/* C3. Projected Balance Forecast Line Chart (History + Scheduled Upcoming Transactions) */}
      <section
        aria-label="Biểu đồ đường dự báo số dư dự kiến"
        className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4"
      >
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Dự báo số dư dự kiến theo lịch trình
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Đường nối số dư lịch sử thực tế và dòng tiền thu / chi dự kiến sắp tới
            </p>
          </div>

          <div
            role="group"
            aria-label="Khung thời gian dự báo số dư"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-xl self-start lg:self-auto"
          >
            {(
              [
                { label: '30 ngày tới', value: 30 },
                { label: '90 ngày tới', value: 90 },
                { label: 'Tất cả lịch trình', value: null },
              ] as const
            ).map((opt) => {
              const active = balanceHorizonDays === opt.value;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setBalanceHorizonDays(opt.value)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1 border-t border-slate-100">
          <div className="py-2">
            <p className="text-xs text-slate-500 font-medium">Số dư hiện tại</p>
            <p className="mt-0.5 text-base font-extrabold font-mono tabular-nums text-slate-900">
              {formatVND(balanceForecast.currentBalance)}
            </p>
          </div>
          <div className="py-2">
            <p className="text-xs text-slate-500 font-medium">Thu dự kiến sắp tới</p>
            <p className="mt-0.5 text-base font-extrabold font-mono tabular-nums text-emerald-700">
              +{formatVND(balanceForecast.scheduledIncomeTotal)}
            </p>
          </div>
          <div className="py-2">
            <p className="text-xs text-slate-500 font-medium">Chi dự kiến sắp tới</p>
            <p className="mt-0.5 text-base font-extrabold font-mono tabular-nums text-rose-600">
              -{formatVND(balanceForecast.scheduledExpenseTotal)}
            </p>
          </div>
          <div className="py-2">
            <p className="text-xs text-slate-500 font-medium">
              Số dư dự kiến cuối kỳ ({balanceForecast.scheduledCount} khoản)
            </p>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
              <span
                className={`text-base font-extrabold font-mono tabular-nums ${
                  balanceForecast.projectedEndBalance < 0
                    ? 'text-rose-600'
                    : 'text-teal-700'
                }`}
              >
                {formatVND(balanceForecast.projectedEndBalance)}
              </span>
              {balanceForecast.scheduledCount > 0 && (
                <span
                  className={`text-xs font-mono tabular-nums font-semibold ${
                    balanceForecast.projectedNetChange >= 0
                      ? 'text-emerald-700'
                      : 'text-rose-600'
                  }`}
                >
                  ({balanceForecast.projectedNetChange >= 0 ? '+' : ''}
                  {formatVND(balanceForecast.projectedNetChange)})
                </span>
              )}
            </div>
          </div>
        </div>

        {balanceForecast.hasNegativeRisk && balanceForecast.lowestProjectedDate && (
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-800">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
            <span>
              Cảnh báo dòng tiền âm: Số dư dự kiến có thể xuống mức{' '}
              <strong className="font-mono tabular-nums">
                {formatVND(balanceForecast.lowestProjectedBalance)}
              </strong>{' '}
              vào ngày{' '}
              <strong className="font-mono tabular-nums">
                {formatDateVN(balanceForecast.lowestProjectedDate)}
              </strong>
              .
            </span>
          </div>
        )}

        {balanceForecast.history.length === 0 && balanceForecast.forecast.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm text-slate-400 text-center border border-dashed border-slate-200 rounded-xl px-4">
            Chưa có dữ liệu lịch sử hoặc khoản thu/chi dự kiến để vẽ đường dự báo số dư.
          </div>
        ) : (
          <ProjectedBalanceLineChart
            data={balanceForecast}
            horizonDays={balanceHorizonDays}
          />
        )}
      </section>

      {/* B. Read-Only Income & Expense Ledger Tables with Sticky Headers & Column Sorting */}
      <section className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
        <ReadOnlyTransactionTable
          title="Danh sách các khoản thu"
          emptyText="Không có khoản thu nào khớp bộ lọc."
          kind="income"
          rows={incomeRows}
        />

        <ReadOnlyTransactionTable
          title="Danh sách các khoản chi"
          emptyText="Không có khoản chi nào khớp bộ lọc."
          kind="expense"
          rows={expenseRows}
        />
      </section>
    </div>
  );
};

interface ReadOnlyTransactionTableProps {
  title: string;
  emptyText: string;
  kind: 'income' | 'expense';
  rows: Transaction[];
}

const ReadOnlyTransactionTable: React.FC<ReadOnlyTransactionTableProps> = ({
  title,
  emptyText,
  kind,
  rows,
}) => {
  const [sortField, setSortField] = useState<TransactionSortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const sortedRows = useMemo(
    () => sortTransactions(rows, sortField, sortDirection),
    [rows, sortField, sortDirection]
  );

  const handleToggleSort = (field: TransactionSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'status' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (field: TransactionSortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-blue-700 shrink-0" aria-hidden="true" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-blue-700 shrink-0" aria-hidden="true" />
    );
  };

  const getAriaSort = (field: TransactionSortField): 'ascending' | 'descending' | 'none' => {
    if (sortField !== field) return 'none';
    return sortDirection === 'asc' ? 'ascending' : 'descending';
  };

  const activeSortLabel =
    sortField === 'date'
      ? sortDirection === 'desc'
        ? 'Ngày mới nhất'
        : 'Ngày cũ nhất'
      : sortField === 'amount'
      ? sortDirection === 'desc'
        ? 'Số tiền cao → thấp'
        : 'Số tiền thấp → cao'
      : sortDirection === 'asc'
      ? 'Trạng thái A → Z'
      : 'Trạng thái Z → A';

  const isIncome = kind === 'income';

  return (
    <div
      data-testid={isIncome ? 'income-ledger-card' : 'expense-ledger-card'}
      className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs flex flex-col"
    >
      <div
        className={`px-5 py-4 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2 ${
          isIncome
            ? 'bg-gradient-to-r from-emerald-50/80 via-white to-white'
            : 'bg-gradient-to-r from-rose-50/80 via-white to-white'
        }`}
      >
        <div className="flex items-center gap-2.5">
          <div
            className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
              isIncome
                ? 'bg-emerald-600 text-white'
                : 'bg-rose-500 text-white'
            }`}
          >
            {isIncome ? (
              <ArrowDownLeft className="w-4 h-4" />
            ) : (
              <ArrowUpRight className="w-4 h-4" />
            )}
          </div>
          <h2 className="font-display text-base font-bold text-slate-900">{title}</h2>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500 whitespace-nowrap">
          <span className="font-mono tabular-nums font-semibold text-slate-700">
            {rows.length} giao dịch
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-blue-700 font-medium">{activeSortLabel}</span>
        </div>
      </div>

      <div className="relative max-h-[440px] overflow-auto">
        <table
          data-testid={isIncome ? 'income-ledger-table' : 'expense-ledger-table'}
          className="w-full text-left border-separate border-spacing-0"
        >
          <thead>
            <tr className="text-xs font-semibold text-slate-600">
              <th
                scope="col"
                className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur-xs shadow-[inset_0_-1px_0_0_#e2e8f0] py-2.5 px-3.5 whitespace-nowrap"
              >
                Mã GD
              </th>
              <th
                scope="col"
                aria-sort={getAriaSort('date')}
                className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur-xs shadow-[inset_0_-1px_0_0_#e2e8f0] py-1.5 px-3.5 whitespace-nowrap"
              >
                <button
                  type="button"
                  onClick={() => handleToggleSort('date')}
                  aria-label={`Sắp xếp ${title} theo Ngày`}
                  title="Nhấn để sắp xếp nhanh theo Ngày"
                  className={`inline-flex items-center gap-1.5 py-1 px-2 -mx-2 rounded-lg hover:bg-slate-200/70 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap transition-colors ${
                    sortField === 'date'
                      ? 'bg-blue-50 text-blue-700 font-bold ring-1 ring-blue-200/80'
                      : 'text-slate-600'
                  }`}
                >
                  <span>Ngày</span>
                  {renderSortIcon('date')}
                </button>
              </th>
              <th
                scope="col"
                className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur-xs shadow-[inset_0_-1px_0_0_#e2e8f0] py-2.5 px-3.5 whitespace-nowrap"
              >
                Nội dung
              </th>
              <th
                scope="col"
                className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur-xs shadow-[inset_0_-1px_0_0_#e2e8f0] py-2.5 px-3.5 whitespace-nowrap"
              >
                Loại giao dịch
              </th>
              <th
                scope="col"
                aria-sort={getAriaSort('amount')}
                className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur-xs shadow-[inset_0_-1px_0_0_#e2e8f0] py-1.5 px-3.5 text-right whitespace-nowrap"
              >
                <button
                  type="button"
                  onClick={() => handleToggleSort('amount')}
                  aria-label={`Sắp xếp ${title} theo Số tiền`}
                  title="Nhấn để sắp xếp nhanh theo Số tiền"
                  className={`inline-flex items-center justify-end gap-1.5 py-1 px-2 -mx-2 rounded-lg hover:bg-slate-200/70 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap transition-colors ${
                    sortField === 'amount'
                      ? 'bg-blue-50 text-blue-700 font-bold ring-1 ring-blue-200/80'
                      : 'text-slate-600'
                  }`}
                >
                  <span>Số tiền</span>
                  {renderSortIcon('amount')}
                </button>
              </th>
              <th
                scope="col"
                aria-sort={getAriaSort('status')}
                className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur-xs shadow-[inset_0_-1px_0_0_#e2e8f0] py-1.5 px-3.5 whitespace-nowrap"
              >
                <button
                  type="button"
                  onClick={() => handleToggleSort('status')}
                  aria-label={`Sắp xếp ${title} theo Trạng thái`}
                  title="Nhấn để sắp xếp nhanh theo Trạng thái"
                  className={`inline-flex items-center gap-1.5 py-1 px-2 -mx-2 rounded-lg hover:bg-slate-200/70 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 whitespace-nowrap transition-colors ${
                    sortField === 'status'
                      ? 'bg-blue-50 text-blue-700 font-bold ring-1 ring-blue-200/80'
                      : 'text-slate-600'
                  }`}
                >
                  <span>Trạng thái</span>
                  {renderSortIcon('status')}
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {sortedRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 px-4 text-center text-slate-400">
                  {emptyText}
                </td>
              </tr>
            ) : (
              sortedRows.map((tx) => {
                const effectiveDate = getTransactionEffectiveDate(tx);
                const dateTooltip = tx.actualDate
                  ? `Thực tế: ${formatDateVN(tx.actualDate)} · Dự kiến: ${formatDateVN(tx.expectedDate)}`
                  : `Dự kiến: ${formatDateVN(tx.expectedDate)}`;
                return (
                  <tr key={tx.id} className="hover:bg-blue-50/35 transition-colors">
                    <td className="py-2.5 px-3.5 border-b border-slate-100 font-mono text-xs font-semibold text-slate-800 whitespace-nowrap">
                      {tx.code}
                    </td>
                    <td
                      title={dateTooltip}
                      className="py-2.5 px-3.5 border-b border-slate-100 font-mono tabular-nums text-xs text-slate-600 whitespace-nowrap"
                    >
                      {formatDateVN(effectiveDate)}
                    </td>
                    <td className="py-2.5 px-3.5 border-b border-slate-100 max-w-[210px]">
                      <div className="font-semibold text-slate-900 truncate">{tx.name}</div>
                      <div className="text-xs text-slate-500 truncate flex items-center gap-1">
                        <Landmark className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{tx.accountName}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3.5 border-b border-slate-100 whitespace-nowrap text-xs">
                      <span
                        className={`inline-flex items-center gap-1.5 font-medium ${
                          isIncome ? 'text-emerald-700' : 'text-violet-700'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            isIncome ? 'bg-emerald-500' : 'bg-violet-500'
                          }`}
                        />
                        <span>{tx.category}</span>
                      </span>
                    </td>
                    <td
                      className={`py-2.5 px-3.5 border-b border-slate-100 text-right font-mono tabular-nums font-bold whitespace-nowrap ${
                        isIncome ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {isIncome ? '+' : '-'}
                      {formatVND(getEffectiveTransactionAmount(tx))}
                    </td>
                    <td className="py-2.5 px-3.5 border-b border-slate-100 whitespace-nowrap">
                      <StatusText status={tx.status} kind={kind} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ExpenseDonutChart: React.FC<{
  items: Array<{ category: string; amount: number; percentage: number }>;
  hoveredCategory: string | null;
  onHoverCategory: (cat: string | null) => void;
}> = ({ items, hoveredCategory, onHoverCategory }) => {
  const size = 160;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let cumulativePercent = 0;
  const activeItem = items.find((i) => i.category === hoveredCategory) || items[0];

  return (
    <div className="relative w-40 h-40 flex items-center justify-center shrink-0">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="transparent"
          stroke="#f1f5f9"
          strokeWidth={strokeWidth}
        />
        {items.map((item, idx) => {
          const pct = Math.max(0, Math.min(100, item.percentage));
          const dashLength = (pct / 100) * circumference;
          const dashOffset = -(cumulativePercent / 100) * circumference;
          cumulativePercent += pct;
          const color = CHART_PALETTE[idx % CHART_PALETTE.length];
          const isHovered = hoveredCategory === item.category;

          return (
            <circle
              key={item.category}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="transparent"
              stroke={color}
              strokeWidth={isHovered ? strokeWidth + 3 : strokeWidth}
              strokeDasharray={`${dashLength} ${circumference}`}
              strokeDashoffset={dashOffset}
              onMouseEnter={() => onHoverCategory(item.category)}
              onMouseLeave={() => onHoverCategory(null)}
              className="transition-all duration-150 cursor-pointer"
            >
              <title>{`${item.category}: ${formatVND(item.amount)} (${item.percentage.toFixed(1)}%)`}</title>
            </circle>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 pointer-events-none">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 truncate max-w-[90px]">
          {activeItem?.category || 'Chi tiêu'}
        </span>
        <span className="font-mono font-extrabold text-sm text-slate-900 mt-0.5">
          {activeItem ? `${activeItem.percentage.toFixed(1)}%` : '0%'}
        </span>
      </div>
    </div>
  );
};

const BalanceLineChart: React.FC<{
  points: Array<{ date: string; label: string; balance: number }>;
}> = ({ points }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const width = 640;
  const height = 180;
  const padX = 16;
  const padY = 18;

  const balances = points.map((p) => p.balance);
  const minVal = Math.min(...balances);
  const maxVal = Math.max(...balances);
  const range = Math.max(1, maxVal - minVal);

  const coords = points.map((p, idx) => {
    const x =
      points.length === 1
        ? width / 2
        : padX + (idx / (points.length - 1)) * (width - padX * 2);
    const y =
      height - padY - ((p.balance - minVal) / range) * (height - padY * 2);
    return { ...p, x, y };
  });

  const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');
  const areaPath =
    coords.length > 1
      ? `M ${coords[0].x},${height - padY} L ${coords
          .map((c) => `${c.x},${c.y}`)
          .join(' L ')} L ${coords[coords.length - 1].x},${height - padY} Z`
      : '';

  const activePoint = hoveredIdx !== null ? coords[hoveredIdx] : coords[coords.length - 1];

  return (
    <div className="space-y-3">
      {activePoint && (
        <div className="px-3 py-2 rounded-xl bg-blue-50/70 border border-blue-200/70 flex items-center justify-between text-xs">
          <span className="font-medium text-slate-600">
            Ngày <strong className="font-mono text-slate-900">{activePoint.label}</strong>
          </span>
          <span className="font-mono font-bold text-blue-700">
            {formatVND(activePoint.balance)}
          </span>
        </div>
      )}

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-44 min-w-[400px]"
          role="img"
          aria-label="Biểu đồ biến động số dư"
        >
          <defs>
            <linearGradient id="balanceCobaltGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.24" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.01" />
            </linearGradient>
          </defs>
          {areaPath && <path d={areaPath} fill="url(#balanceCobaltGrad)" />}
          {coords.length > 1 && (
            <polyline
              fill="none"
              stroke="#2563eb"
              strokeWidth="2.6"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={polylinePoints}
            />
          )}
          {coords.map((c, idx) => (
            <circle
              key={c.date}
              cx={c.x}
              cy={c.y}
              r={hoveredIdx === idx ? 5.5 : 3.8}
              fill={hoveredIdx === idx ? '#ffffff' : '#2563eb'}
              stroke="#2563eb"
              strokeWidth="2.2"
              className="cursor-pointer transition-all"
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
            >
              <title>{`${c.label}: ${formatVND(c.balance)}`}</title>
            </circle>
          ))}
        </svg>
      </div>
      <div className="flex items-center justify-between text-xs font-mono text-slate-500">
        <span>{coords[0]?.label}</span>
        <span>
          Thấp nhất: {formatVND(minVal)} · Cao nhất: {formatVND(maxVal)}
        </span>
        <span>{coords[coords.length - 1]?.label}</span>
      </div>
    </div>
  );
};

const ExpenseForecastChart: React.FC<{
  forecast: ExpenseForecastResult;
}> = ({ forecast }) => {
  const allPoints = [...forecast.history, ...forecast.forecast];
  const width = 640;
  const height = 180;
  const padLeft = 18;
  const padRight = 18;
  const padTop = 18;
  const padBottom = 28;

  const maxVal = Math.max(1, ...allPoints.map((p) => p.amount), forecast.averageMonthly);

  const coords = allPoints.map((pt, idx) => {
    const x =
      allPoints.length === 1
        ? width / 2
        : padLeft + (idx / (allPoints.length - 1)) * (width - padLeft - padRight);
    const usableH = height - padTop - padBottom;
    const y = padTop + usableH - (pt.amount / maxVal) * usableH;
    return { ...pt, x, y };
  });

  const historyCoords = coords.filter((c) => !c.isForecast);
  const forecastCoords = coords.filter((c) => c.isForecast);
  const lastHistory = historyCoords[historyCoords.length - 1];
  const forecastLineCoords = lastHistory ? [lastHistory, ...forecastCoords] : forecastCoords;

  const historyPolyline = historyCoords.map((c) => `${c.x},${c.y}`).join(' ');
  const forecastPolyline = forecastLineCoords.map((c) => `${c.x},${c.y}`).join(' ');

  const baselineY = height - padBottom;
  const forecastAreaPath =
    forecastLineCoords.length > 1
      ? `M ${forecastLineCoords[0].x},${baselineY} L ${forecastLineCoords
          .map((c) => `${c.x},${c.y}`)
          .join(' L ')} L ${forecastLineCoords[forecastLineCoords.length - 1].x},${baselineY} Z`
      : '';

  const splitX =
    lastHistory && forecastCoords[0]
      ? (lastHistory.x + forecastCoords[0].x) / 2
      : null;

  const avgY =
    padTop + (height - padTop - padBottom) * (1 - forecast.averageMonthly / maxVal);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-violet-600 inline-block" />
            Thực tế
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 border-t-2 border-dashed border-amber-500 inline-block" />
            Dự báo
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-3 h-0.5 border-t border-dotted border-slate-400 inline-block" />
            TB ({formatVND(forecast.averageMonthly)})
          </span>
        </div>
        <span className="font-mono tabular-nums font-semibold text-amber-700">
          Dự kiến 3 tháng: {formatVND(forecast.projectedTotal)}
        </span>
      </div>

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-44 min-w-[400px]"
          role="img"
          aria-label="Biểu đồ phân tích và dự báo chi tiêu theo tháng"
        >
          <defs>
            <linearGradient id="forecastBandGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          <line
            x1={padLeft}
            y1={baselineY}
            x2={width - padRight}
            y2={baselineY}
            stroke="#e2e8f0"
            strokeWidth="1"
          />
          <line
            x1={padLeft}
            y1={avgY}
            x2={width - padRight}
            y2={avgY}
            stroke="#94a3b8"
            strokeWidth="1"
            strokeDasharray="3 3"
          />

          {splitX !== null && (
            <line
              x1={splitX}
              y1={padTop - 6}
              x2={splitX}
              y2={baselineY}
              stroke="#cbd5e1"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
          )}

          {forecastAreaPath && <path d={forecastAreaPath} fill="url(#forecastBandGrad)" />}

          {historyCoords.length > 1 && (
            <polyline
              fill="none"
              stroke="#7c3aed"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={historyPolyline}
            />
          )}

          {forecastLineCoords.length > 1 && (
            <polyline
              fill="none"
              stroke="#d97706"
              strokeWidth="2.5"
              strokeDasharray="6 4"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={forecastPolyline}
            />
          )}

          {coords.map((c) => (
            <g key={c.yearMonth}>
              <circle
                cx={c.x}
                cy={c.y}
                r="4"
                fill={c.isForecast ? '#ffffff' : '#7c3aed'}
                stroke={c.isForecast ? '#d97706' : '#7c3aed'}
                strokeWidth="2.2"
              >
                <title>
                  {`${c.label} (${c.isForecast ? 'Dự báo' : 'Thực tế'}): ${formatVND(c.amount)}`}
                </title>
              </circle>
              <text
                x={c.x}
                y={height - 8}
                textAnchor="middle"
                fontSize="10.5"
                fill={c.isForecast ? '#b45309' : '#64748b'}
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {c.label}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* 3-Month Forecast Breakdown Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {forecast.forecast.map((pt) => {
          const diff = pt.amount - forecast.averageMonthly;
          return (
            <div
              key={pt.yearMonth}
              className="border border-amber-200/70 rounded-xl px-3 py-2 bg-amber-50/40"
            >
              <p className="text-[11px] font-mono text-amber-800 font-semibold">
                Dự kiến {pt.label}
              </p>
              <p className="text-sm font-extrabold font-mono tabular-nums text-slate-900 mt-0.5">
                {formatVND(pt.amount)}
              </p>
              <p
                className={`text-[11px] font-mono tabular-nums mt-0.5 ${
                  diff > 0
                    ? 'text-rose-600'
                    : diff < 0
                    ? 'text-emerald-700'
                    : 'text-slate-500'
                }`}
              >
                {diff > 0 ? '+' : ''}
                {formatVND(diff)} so với TB
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
};

function formatCompactAxisVND(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000_000) {
    return `${sign}${(abs / 1_000_000_000).toFixed(1).replace(/\.0$/, '')} tỷ`;
  }
  if (abs >= 1_000_000) {
    return `${sign}${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')} tr`;
  }
  if (abs >= 1_000) {
    return `${sign}${Math.round(abs / 1_000)}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

const ProjectedBalanceLineChart: React.FC<{
  data: BalanceForecastResult;
  horizonDays: number | null;
}> = ({ data, horizonDays }) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const allPoints: BalanceForecastPoint[] = useMemo(
    () => [...data.history, ...data.forecast],
    [data.history, data.forecast]
  );

  const width = 920;
  const height = 236;
  const padLeft = 64;
  const padRight = 24;
  const padTop = 22;
  const padBottom = 34;

  const balances = allPoints.map((p) => p.balance);
  const rawMin = Math.min(...balances);
  const rawMax = Math.max(...balances);
  const span = Math.max(1, rawMax - rawMin);
  const paddingVal = rawMax === rawMin ? Math.max(100000, Math.abs(rawMax) * 0.1) : span * 0.1;
  const minVal = rawMin - paddingVal;
  const maxVal = rawMax + paddingVal;
  const range = Math.max(1, maxVal - minVal);

  const usableW = width - padLeft - padRight;
  const usableH = height - padTop - padBottom;

  const coords = allPoints.map((pt, idx) => {
    const x =
      allPoints.length === 1
        ? padLeft + usableW / 2
        : padLeft + (idx / (allPoints.length - 1)) * usableW;
    const y = padTop + usableH - ((pt.balance - minVal) / range) * usableH;
    return { ...pt, x, y };
  });

  const historyCoords = coords.filter((c) => !c.isForecast);
  const forecastCoords = coords.filter((c) => c.isForecast);
  const lastHistory = historyCoords[historyCoords.length - 1];
  const forecastLineCoords = lastHistory
    ? [lastHistory, ...forecastCoords]
    : forecastCoords;

  const historyPolyline = historyCoords.map((c) => `${c.x},${c.y}`).join(' ');
  const forecastPolyline = forecastLineCoords.map((c) => `${c.x},${c.y}`).join(' ');

  const baselineY = height - padBottom;
  const historyAreaPath =
    historyCoords.length > 1
      ? `M ${historyCoords[0].x},${baselineY} L ${historyCoords
          .map((c) => `${c.x},${c.y}`)
          .join(' L ')} L ${historyCoords[historyCoords.length - 1].x},${baselineY} Z`
      : '';
  const forecastAreaPath =
    forecastLineCoords.length > 1
      ? `M ${forecastLineCoords[0].x},${baselineY} L ${forecastLineCoords
          .map((c) => `${c.x},${c.y}`)
          .join(' L ')} L ${forecastLineCoords[forecastLineCoords.length - 1].x},${baselineY} Z`
      : '';

  const zeroInRange = minVal < 0 && maxVal > 0;
  const zeroY = padTop + usableH - ((0 - minVal) / range) * usableH;

  const yTicks = [0, 0.33, 0.66, 1].map((t) => {
    const value = minVal + t * range;
    const y = padTop + usableH - t * usableH;
    return { value, y };
  });

  const forecastStroke = data.hasNegativeRisk ? '#e11d48' : '#0d9488';
  const forecastGradId = data.hasNegativeRisk
    ? 'projectedBalanceRiskGrad'
    : 'projectedBalanceTealGrad';

  const activePoint =
    hoveredIdx !== null && coords[hoveredIdx]
      ? coords[hoveredIdx]
      : coords[coords.length - 1];

  const xLabelStep = Math.max(1, Math.ceil(coords.length / 8));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span className="w-3.5 h-0.5 bg-blue-600 inline-block" />
            Số dư thực tế (lịch sử)
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium">
            <span
              className="w-3.5 h-0.5 border-t-2 border-dashed inline-block"
              style={{ borderColor: forecastStroke }}
            />
            Số dư dự kiến (theo lịch)
          </span>
        </div>
        {data.forecast.length === 0 && (
          <span className="text-slate-500">
            {horizonDays
              ? `Chưa có khoản thu/chi dự kiến trong ${horizonDays} ngày tới`
              : 'Chưa có khoản thu/chi dự kiến sắp tới'}
          </span>
        )}
      </div>

      {/* Interactive Inspection Bar */}
      {activePoint && (
        <div className="px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-700">
            <span className="font-mono font-bold text-slate-900">
              {activePoint.label}
            </span>
            <span aria-hidden="true">·</span>
            <span
              className={`font-semibold ${
                activePoint.isForecast
                  ? data.hasNegativeRisk && activePoint.balance < 0
                    ? 'text-rose-600'
                    : 'text-teal-700'
                  : 'text-blue-700'
              }`}
            >
              {activePoint.isTodayAnchor
                ? 'Mốc hôm nay (Thực tế)'
                : activePoint.isForecast
                ? 'Dự kiến theo lịch'
                : 'Lịch sử thực tế'}
            </span>
            {activePoint.scheduledItems && activePoint.scheduledItems.length > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-600 truncate max-w-[420px]">
                  {activePoint.scheduledItems
                    .map(
                      (item) =>
                        `${item.code} (${item.kind === 'income' ? '+' : '-'}${formatVND(item.amount)})`
                    )
                    .join(', ')}
                </span>
              </>
            )}
          </div>

          <div className="flex items-center gap-3 font-mono tabular-nums">
            {typeof activePoint.delta === 'number' && (
              <span
                className={`font-semibold ${
                  activePoint.delta >= 0 ? 'text-emerald-700' : 'text-rose-600'
                }`}
              >
                {activePoint.delta >= 0 ? '+' : ''}
                {formatVND(activePoint.delta)}
              </span>
            )}
            <span
              className={`font-extrabold ${
                activePoint.balance < 0 ? 'text-rose-600' : 'text-slate-900'
              }`}
            >
              Số dư: {formatVND(activePoint.balance)}
            </span>
          </div>
        </div>
      )}

      <div className="w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-56 min-w-[540px]"
          role="img"
          aria-label="Biểu đồ đường dự báo số dư dự kiến dựa trên lịch sử và các khoản sắp tới"
        >
          <defs>
            <linearGradient id="historyBalanceBlueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.01" />
            </linearGradient>
            <linearGradient id="projectedBalanceTealGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0d9488" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#0d9488" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="projectedBalanceRiskGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e11d48" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#e11d48" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Horizontal Gridlines & Y-Axis Ticks */}
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line
                x1={padLeft}
                y1={tick.y}
                x2={width - padRight}
                y2={tick.y}
                stroke="#e2e8f0"
                strokeWidth="1"
              />
              <text
                x={padLeft - 8}
                y={tick.y + 3.5}
                textAnchor="end"
                fontSize="10.5"
                fill="#64748b"
                fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
              >
                {formatCompactAxisVND(tick.value)}
              </text>
            </g>
          ))}

          {/* Zero Balance Threshold */}
          {zeroInRange && (
            <g>
              <line
                x1={padLeft}
                y1={zeroY}
                x2={width - padRight}
                y2={zeroY}
                stroke="#f43f5e"
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />
              <text
                x={width - padRight}
                y={zeroY - 5}
                textAnchor="end"
                fontSize="10"
                fill="#e11d48"
                fontWeight="600"
              >
                Mốc 0 ₫
              </text>
            </g>
          )}

          {/* Vertical Divider at Today Anchor / Last History Point */}
          {lastHistory && forecastCoords.length > 0 && (
            <g>
              <line
                x1={lastHistory.x}
                y1={padTop - 6}
                x2={lastHistory.x}
                y2={baselineY}
                stroke="#94a3b8"
                strokeWidth="1.2"
                strokeDasharray="4 4"
              />
              <text
                x={lastHistory.x}
                y={padTop - 9}
                textAnchor="middle"
                fontSize="10"
                fill="#475569"
                fontWeight="600"
              >
                Hôm nay
              </text>
            </g>
          )}

          {historyAreaPath && (
            <path d={historyAreaPath} fill="url(#historyBalanceBlueGrad)" />
          )}
          {forecastAreaPath && (
            <path d={forecastAreaPath} fill={`url(#${forecastGradId})`} />
          )}

          {historyCoords.length > 1 && (
            <polyline
              fill="none"
              stroke="#2563eb"
              strokeWidth="2.6"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={historyPolyline}
            />
          )}

          {forecastLineCoords.length > 1 && (
            <polyline
              fill="none"
              stroke={forecastStroke}
              strokeWidth="2.6"
              strokeDasharray="6 4"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={forecastPolyline}
            />
          )}

          {coords.map((c, idx) => {
            const isHovered = hoveredIdx === idx;
            const nodeStroke = c.isForecast
              ? c.balance < 0
                ? '#e11d48'
                : '#0d9488'
              : '#2563eb';
            const showXLabel =
              idx === 0 ||
              idx === coords.length - 1 ||
              Boolean(c.isTodayAnchor) ||
              idx % xLabelStep === 0;

            return (
              <g key={`${c.date}-${c.isForecast ? 'f' : 'h'}`}>
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={isHovered ? 5.8 : c.isTodayAnchor ? 5 : 3.8}
                  fill={c.isForecast || isHovered ? '#ffffff' : nodeStroke}
                  stroke={nodeStroke}
                  strokeWidth="2.3"
                  className="cursor-pointer transition-all"
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                >
                  <title>
                    {`${c.label} (${c.isForecast ? 'Dự kiến' : 'Thực tế'}): ${formatVND(c.balance)}`}
                  </title>
                </circle>
                {showXLabel && (
                  <text
                    x={c.x}
                    y={height - 10}
                    textAnchor="middle"
                    fontSize="10.5"
                    fill={c.isForecast ? '#0f766e' : '#64748b'}
                    fontWeight={c.isTodayAnchor ? '700' : '400'}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  >
                    {c.label.slice(0, 5)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

