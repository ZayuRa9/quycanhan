import React, { useMemo, useState } from 'react';
import {
  ArrowDownUp,
  BarChart3,
  FileSpreadsheet,
  FileText,
  Sheet,
} from 'lucide-react';
import type {
  FinancialAccount,
  SavingsGoal,
  Transaction,
} from '../types/finance';
import {
  computeFinancialSummary,
  computePlannedVsActualReport,
  formatVND,
} from '../utils/financeRules';
import { exportFinanceReportPdf } from '../utils/pdfExport';

interface ReportsPageProps {
  transactions: Transaction[];
  accounts: FinancialAccount[];
  savingsGoals: SavingsGoal[];
  userEmail?: string;
  onExportExcel: (year: number) => void;
  onSyncGoogleSheet: () => Promise<void>;
  hasDriveToken: boolean;
  spreadsheetUrl?: string;
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
  transactions,
  accounts,
  savingsGoals,
  userEmail,
  onExportExcel,
  onSyncGoogleSheet,
  hasDriveToken,
  spreadsheetUrl,
}) => {
  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(() => {
    const s = new Set<number>([currentYear]);
    for (const tx of transactions) {
      const m = /^(\d{4})/.exec(tx.actualDate || tx.expectedDate || '');
      if (m) s.add(Number(m[1]));
    }
    return Array.from(s).sort((a, b) => b - a);
  }, [transactions, currentYear]);

  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [chartMode, setChartMode] = useState<'income' | 'expense'>('expense');
  const [catKindFilter, setCatKindFilter] = useState<'ALL' | 'income' | 'expense'>('ALL');
  const [sortBy, setSortBy] = useState<'planned' | 'actual' | 'variance'>('actual');
  const [sortDesc, setSortDesc] = useState(true);
  const [syncingSheet, setSyncingSheet] = useState(false);

  const summary = useMemo(
    () => computeFinancialSummary(accounts, transactions),
    [accounts, transactions]
  );

  const report = useMemo(
    () =>
      computePlannedVsActualReport(transactions, {
        year: selectedYear,
        month: selectedMonth,
      }),
    [transactions, selectedYear, selectedMonth]
  );

  const sortedCategories = useMemo(() => {
    const list = report.categories.filter(
      (c) => catKindFilter === 'ALL' || c.kind === catKindFilter
    );
    const factor = sortDesc ? -1 : 1;
    return [...list].sort((a, b) => (a[sortBy] - b[sortBy]) * factor);
  }, [report.categories, catKindFilter, sortBy, sortDesc]);

  const maxChartVal = useMemo(() => {
    let m = 1;
    for (const row of report.months) {
      const p = chartMode === 'income' ? row.plannedIncome : row.plannedExpense;
      const a = chartMode === 'income' ? row.actualIncome : row.actualExpense;
      if (p > m) m = p;
      if (a > m) m = a;
    }
    return m;
  }, [report.months, chartMode]);

  const handleSortClick = (field: 'planned' | 'actual' | 'variance') => {
    if (sortBy === field) {
      setSortDesc((v) => !v);
    } else {
      setSortBy(field);
      setSortDesc(true);
    }
  };

  const handleSync = async () => {
    setSyncingSheet(true);
    try {
      await onSyncGoogleSheet();
    } finally {
      setSyncingSheet(false);
    }
  };

  return (
    <div className="space-y-6 animate-fintech-in">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0B1437]">
            BÁO CÁO &amp; PHÂN TÍCH TÀI CHÍNH
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            So sánh Dự kiến vs Thực tế trực tiếp từ sổ cái giao dịch (không tính chuyển khoản nội bộ &amp; giao dịch đã hủy)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onExportExcel(selectedYear)}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-white border border-slate-200 text-slate-800 text-xs sm:text-sm font-semibold rounded-xl hover:bg-slate-50 shadow-xs whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Xuất Excel (.xlsx)</span>
          </button>

          <button
            type="button"
            onClick={() =>
              exportFinanceReportPdf({
                transactions,
                accounts,
                savingsGoals,
                selectedYear,
                selectedMonth,
                userEmail,
              })
            }
            className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-[#0B1437] text-white text-xs sm:text-sm font-semibold rounded-xl hover:bg-blue-900 shadow-xs whitespace-nowrap"
          >
            <FileText className="w-4 h-4 text-blue-300" />
            <span>Xuất Báo Cáo PDF</span>
          </button>

          <button
            type="button"
            disabled={syncingSheet}
            onClick={handleSync}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-emerald-600 text-white text-xs sm:text-sm font-semibold rounded-xl hover:bg-emerald-700 shadow-xs disabled:opacity-50 whitespace-nowrap"
          >
            <Sheet className="w-4 h-4" />
            <span>
              {syncingSheet
                ? 'Đang đồng bộ...'
                : hasDriveToken
                ? 'Đồng bộ Sheets'
                : 'Kết nối & Đồng bộ Sheets'}
            </span>
          </button>
        </div>
      </div>

      {/* Period Filters */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <label htmlFor="rep-year" className="text-xs font-semibold text-slate-600 mr-2">
              Năm:
            </label>
            <select
              id="rep-year"
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="h-9 px-3 text-sm font-mono font-semibold bg-slate-50 border border-slate-200 rounded-xl"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="rep-month" className="text-xs font-semibold text-slate-600 mr-2">
              Tháng:
            </label>
            <select
              id="rep-month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-9 px-3 text-sm bg-slate-50 border border-slate-200 rounded-xl"
            >
              <option value="ALL">Cả năm {selectedYear}</option>
              {Array.from({ length: 12 }, (_, i) => {
                const m = String(i + 1).padStart(2, '0');
                return (
                  <option key={m} value={m}>
                    Tháng {m}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        {spreadsheetUrl && (
          <a
            href={spreadsheetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold text-emerald-700 hover:underline"
          >
            Mở Google Sheet tổng hợp
          </a>
        )}
      </div>

      {/* Planned vs Actual KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-emerald-200/80 rounded-2xl p-4 shadow-xs space-y-1">
          <p className="text-xs font-semibold text-emerald-800">Thu Thực tế vs Dự kiến</p>
          <p className="text-xl font-extrabold font-mono tabular-nums text-emerald-700">
            {formatVND(report.actualIncome)}
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            Dự kiến: {formatVND(report.plannedIncome)} ({report.incomeRatePct.toFixed(0)}%)
          </p>
        </div>

        <div className="bg-white border border-rose-200/80 rounded-2xl p-4 shadow-xs space-y-1">
          <p className="text-xs font-semibold text-rose-800">Chi Thực tế vs Dự kiến</p>
          <p className="text-xl font-extrabold font-mono tabular-nums text-rose-600">
            {formatVND(report.actualExpense)}
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            Dự kiến: {formatVND(report.plannedExpense)} ({report.expenseRatePct.toFixed(0)}%)
          </p>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-1">
          <p className="text-xs font-semibold text-slate-600">Chênh lệch Ròng Thực tế</p>
          <p
            className={`text-xl font-extrabold font-mono tabular-nums ${
              report.actualNet >= 0 ? 'text-blue-700' : 'text-rose-600'
            }`}
          >
            {report.actualNet > 0 ? '+' : ''}
            {formatVND(report.actualNet)}
          </p>
          <p className="text-xs text-slate-500 font-mono tabular-nums">
            Ròng dự kiến: {formatVND(report.plannedNet)}
          </p>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-1">
          <p className="text-xs font-semibold text-slate-600">Điều chuyển nội bộ (tham khảo)</p>
          <p className="text-xl font-extrabold font-mono tabular-nums text-slate-900">
            {formatVND(summary.totalTransferVolume)}
          </p>
          <p className="text-xs text-slate-500">Không cộng vào tổng thu hoặc chi</p>
        </div>
      </section>

      {/* Dual-Bar SVG Monthly Comparison Chart */}
      <section className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Biểu đồ Dự kiến vs Thực tế theo 12 tháng ({selectedYear})
              </h2>
              <p className="text-xs text-slate-500">
                Cột nhạt: Kế hoạch dự kiến · Cột đậm: Thực tế đã hoàn thành
              </p>
            </div>
          </div>

          <div className="inline-flex p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setChartMode('expense')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors ${
                chartMode === 'expense' ? 'bg-rose-600 text-white' : 'text-slate-600'
              }`}
            >
              Chi tiêu
            </button>
            <button
              type="button"
              onClick={() => setChartMode('income')}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-colors ${
                chartMode === 'income' ? 'bg-emerald-600 text-white' : 'text-slate-600'
              }`}
            >
              Thu nhập
            </button>
          </div>
        </div>

        <div className="overflow-x-auto pb-2">
          <svg
            viewBox="0 0 760 220"
            role="img"
            aria-label={`Biểu đồ so sánh dự kiến và thực tế năm ${selectedYear}`}
            className="w-full min-w-[600px] h-56"
          >
            {[0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = 185 - ratio * 150;
              return (
                <line
                  key={ratio}
                  x1={24}
                  x2={748}
                  y1={y}
                  y2={y}
                  stroke="#E2E8F0"
                  strokeDasharray="3 3"
                />
              );
            })}
            <line x1={24} x2={748} y1={185} y2={185} stroke="#CBD5E1" />

            {report.months.map((row, idx) => {
              const planned = chartMode === 'income' ? row.plannedIncome : row.plannedExpense;
              const actual = chartMode === 'income' ? row.actualIncome : row.actualExpense;
              const groupX = 32 + idx * 60;
              const hPlan = planned > 0 ? Math.max(3, (planned / maxChartVal) * 150) : 0;
              const hAct = actual > 0 ? Math.max(3, (actual / maxChartVal) * 150) : 0;
              const planFill = chartMode === 'income' ? '#A7F3D0' : '#FECDD3';
              const actFill = chartMode === 'income' ? '#059669' : '#E11D48';

              return (
                <g key={row.month}>
                  <rect
                    x={groupX}
                    y={185 - hPlan}
                    width={18}
                    height={hPlan}
                    rx={4}
                    fill={planFill}
                  >
                    <title>{`${row.label} Dự kiến: ${formatVND(planned)}`}</title>
                  </rect>
                  <rect
                    x={groupX + 21}
                    y={185 - hAct}
                    width={18}
                    height={hAct}
                    rx={4}
                    fill={actFill}
                  >
                    <title>{`${row.label} Thực tế: ${formatVND(actual)}`}</title>
                  </rect>
                  <text
                    x={groupX + 20}
                    y={204}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="600"
                    fill="#64748B"
                  >
                    {row.label}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </section>

      {/* Category Variance Table */}
      <section className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Bảng đối chiếu Dự kiến vs Thực tế theo Danh mục
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Bấm vào tiêu đề cột số liệu để sắp xếp tăng/giảm
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            {(['ALL', 'income', 'expense'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setCatKindFilter(k)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg border ${
                  catKindFilter === k
                    ? 'bg-[#0B1437] text-white border-[#0B1437]'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {k === 'ALL' ? 'Tất cả' : k === 'income' ? 'Thu nhập' : 'Chi tiêu'}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Nhóm</th>
                <th className="py-3 px-4">Danh mục</th>
                <th className="py-3 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => handleSortClick('planned')}
                    className="inline-flex items-center gap-1 hover:text-blue-700"
                  >
                    <span>Dự kiến</span>
                    <ArrowDownUp className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => handleSortClick('actual')}
                    className="inline-flex items-center gap-1 hover:text-blue-700"
                  >
                    <span>Thực tế</span>
                    <ArrowDownUp className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => handleSortClick('variance')}
                    className="inline-flex items-center gap-1 hover:text-blue-700"
                  >
                    <span>Chênh lệch</span>
                    <ArrowDownUp className="w-3 h-3" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right">Tỷ lệ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {sortedCategories.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 px-4 text-center text-slate-400">
                    Chưa có dữ liệu thu chi nào trong kỳ thống kê đã chọn.
                  </td>
                </tr>
              ) : (
                sortedCategories.map((row) => (
                  <tr key={`${row.kind}-${row.category}`} className="hover:bg-blue-50/35">
                    <td className="py-3 px-4 text-xs font-bold">
                      <span
                        className={`px-2 py-0.5 rounded-md ${
                          row.kind === 'income'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-rose-100 text-rose-800'
                        }`}
                      >
                        {row.kind === 'income' ? 'THU' : 'CHI'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900">{row.category}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                      {formatVND(row.planned)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                      {formatVND(row.actual)}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono tabular-nums font-bold ${
                        row.variance >= 0 ? 'text-emerald-700' : 'text-rose-600'
                      }`}
                    >
                      {row.variance > 0 ? '+' : ''}
                      {formatVND(row.variance)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-semibold text-slate-700">
                      {row.achievementPct.toFixed(1)}%
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
