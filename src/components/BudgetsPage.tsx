import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Edit3,
  Plus,
  ShieldAlert,
  Target,
  Trash2,
} from 'lucide-react';
import type {
  BudgetLimit,
  BudgetScopeType,
  Transaction,
} from '../types/finance';
import {
  evaluateBudget,
  formatVND,
  toVndInt,
} from '../utils/financeRules';

interface BudgetsPageProps {
  budgets: BudgetLimit[];
  transactions: Transaction[];
  expenseCategories: readonly string[];
  onCreateBudget: (input: {
    name: string;
    scopeType: BudgetScopeType;
    scopeValue: string;
    yearMonth: string;
    limitAmount: number;
  }) => Promise<void>;
  onUpdateBudget: (
    budgetId: string,
    patch: {
      name: string;
      scopeType: BudgetScopeType;
      scopeValue: string;
      yearMonth: string;
      limitAmount: number;
    }
  ) => Promise<void>;
  onDeleteBudget: (budget: BudgetLimit) => Promise<void>;
}

export const BudgetsPage: React.FC<BudgetsPageProps> = ({
  budgets,
  transactions,
  expenseCategories,
  onCreateBudget,
  onUpdateBudget,
  onDeleteBudget,
}) => {
  const defaultYm = new Date().toISOString().slice(0, 7);

  const [editingBudget, setEditingBudget] = useState<BudgetLimit | null>(null);
  const [budgetName, setBudgetName] = useState('');
  const [scopeType, setScopeType] = useState<BudgetScopeType>('category');
  const [scopeValue, setScopeValue] = useState<string>(expenseCategories[0] || '');
  const [budgetYearMonth, setBudgetYearMonth] = useState(defaultYm);
  const [limitAmount, setLimitAmount] = useState('');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetErr, setBudgetErr] = useState<string | null>(null);

  const [filterAlert, setFilterAlert] = useState<'ALL' | 'over_100' | 'warn' | 'ok'>('ALL');
  const [filterMonth, setFilterMonth] = useState<string>('ALL');

  const evaluations = useMemo(
    () => budgets.map((b) => evaluateBudget(b, transactions)),
    [budgets, transactions]
  );

  const availableMonths = useMemo(() => {
    const s = new Set<string>();
    for (const b of budgets) {
      if (b.yearMonth && b.yearMonth !== 'ALL') s.add(b.yearMonth);
    }
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [budgets]);

  const filteredEvaluations = useMemo(() => {
    return evaluations.filter((ev) => {
      if (filterMonth !== 'ALL' && ev.budget.yearMonth !== filterMonth) return false;
      if (filterAlert === 'over_100' && ev.alertLevel !== 'over_100') return false;
      if (filterAlert === 'warn' && ev.alertLevel !== 'warn_80' && ev.alertLevel !== 'warn_90')
        return false;
      if (filterAlert === 'ok' && ev.alertLevel !== 'ok') return false;
      return true;
    });
  }, [evaluations, filterAlert, filterMonth]);

  const stats = useMemo(() => {
    const over = evaluations.filter((e) => e.alertLevel === 'over_100').length;
    const warn = evaluations.filter(
      (e) => e.alertLevel === 'warn_80' || e.alertLevel === 'warn_90'
    ).length;
    const totalLimit = evaluations.reduce((s, e) => s + toVndInt(e.budget.limitAmount), 0);
    const totalSpent = evaluations.reduce((s, e) => s + e.spent, 0);
    return { over, warn, totalLimit, totalSpent };
  }, [evaluations]);

  const resetForm = () => {
    setEditingBudget(null);
    setBudgetName('');
    setScopeType('category');
    setScopeValue(expenseCategories[0] || '');
    setBudgetYearMonth(defaultYm);
    setLimitAmount('');
    setBudgetErr(null);
  };

  const startEdit = (b: BudgetLimit) => {
    setEditingBudget(b);
    setBudgetName(b.name);
    setScopeType(b.scopeType);
    setScopeValue(b.scopeValue);
    setBudgetYearMonth(b.yearMonth);
    setLimitAmount(String(b.limitAmount));
    setBudgetErr(null);
  };

  const handleBudgetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBudgetErr(null);
    const lim = toVndInt(Number(limitAmount));
    if (!budgetName.trim() || !scopeValue.trim() || !Number.isFinite(lim) || lim <= 0) {
      setBudgetErr('Vui lòng nhập đầy đủ tên hạn mức, đối tượng áp dụng và số tiền nguyên VNĐ > 0.');
      return;
    }
    const payload = {
      name: budgetName.trim(),
      scopeType,
      scopeValue: scopeValue.trim(),
      yearMonth: scopeType === 'month' ? scopeValue.trim() : budgetYearMonth.trim() || 'ALL',
      limitAmount: lim,
    };

    setBudgetSaving(true);
    try {
      if (editingBudget) {
        await onUpdateBudget(editingBudget.id, payload);
      } else {
        await onCreateBudget(payload);
      }
      resetForm();
    } catch (err) {
      setBudgetErr(err instanceof Error ? err.message : 'Không thể lưu hạn mức.');
    } finally {
      setBudgetSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fintech-in">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0B1437]">
          NGÂN SÁCH &amp; HẠN MỨC CHI TIÊU
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Thiết lập hạn mức theo danh mục, tháng, mục đích hoặc công việc với cảnh báo tự động 80% · 90% · 100%
        </p>
      </div>

      {/* KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
          <p className="text-xs font-semibold text-slate-500">Tổng hạn mức thiết lập</p>
          <p className="text-xl font-extrabold font-mono tabular-nums text-slate-900 mt-1">
            {formatVND(stats.totalLimit)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{evaluations.length} hạn mức đang theo dõi</p>
        </div>
        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
          <p className="text-xs font-semibold text-slate-500">Tổng đã chi trong phạm vi</p>
          <p className="text-xl font-extrabold font-mono tabular-nums text-blue-700 mt-1">
            {formatVND(stats.totalSpent)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Không tính giao dịch đã hủy hoặc chuyển khoản</p>
        </div>
        <div className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 shadow-xs">
          <p className="text-xs font-semibold text-amber-800">Sắp chạm ngưỡng (80–99%)</p>
          <p className="text-xl font-extrabold font-mono tabular-nums text-amber-700 mt-1">
            {stats.warn} hạn mức
          </p>
          <p className="text-xs text-amber-700/80 mt-0.5">Cần cân đối chi tiêu</p>
        </div>
        <div className="bg-rose-50/70 border border-rose-200 rounded-2xl p-4 shadow-xs">
          <p className="text-xs font-semibold text-rose-800">Đã vượt hạn mức (&ge;100%)</p>
          <p className="text-xl font-extrabold font-mono tabular-nums text-rose-700 mt-1">
            {stats.over} hạn mức
          </p>
          <p className="text-xs text-rose-700/80 mt-0.5">Cần kiểm tra lại các khoản chi</p>
        </div>
      </section>

      {/* Main Grid: Form + Trackers */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-4 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center">
                <Target className="w-4 h-4" />
              </div>
              <h2 className="font-display text-base font-bold text-slate-900">
                {editingBudget ? 'Chỉnh sửa hạn mức' : 'Thiết lập hạn mức mới'}
              </h2>
            </div>
            {editingBudget && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Hủy sửa
              </button>
            )}
          </div>

          {budgetErr && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
              {budgetErr}
            </div>
          )}

          <form onSubmit={handleBudgetSubmit} className="space-y-3.5">
            <div>
              <label htmlFor="bdg-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Tên hạn mức *
              </label>
              <input
                id="bdg-name"
                type="text"
                required
                value={budgetName}
                onChange={(e) => setBudgetName(e.target.value)}
                placeholder="VD: Ngân sách ăn uống tháng 11"
                className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-600 focus:bg-white"
              />
            </div>

            <div>
              <label htmlFor="bdg-scope" className="block text-xs font-semibold text-slate-700 mb-1">
                Phạm vi áp dụng
              </label>
              <select
                id="bdg-scope"
                value={scopeType}
                onChange={(e) => {
                  const next = e.target.value as BudgetScopeType;
                  setScopeType(next);
                  if (next === 'category') {
                    setScopeValue(expenseCategories[0] || '');
                  } else if (next === 'month') {
                    setScopeValue(defaultYm);
                  } else {
                    setScopeValue('');
                  }
                }}
                className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-600 focus:bg-white"
              >
                <option value="category">Theo loại chi</option>
                <option value="month">Theo tổng tháng</option>
                <option value="purpose">Theo mục đích</option>
                <option value="work">Theo công việc</option>
              </select>
            </div>

            <div>
              <label htmlFor="bdg-val" className="block text-xs font-semibold text-slate-700 mb-1">
                Giá trị áp dụng *
              </label>
              {scopeType === 'category' ? (
                <select
                  id="bdg-val"
                  value={scopeValue}
                  onChange={(e) => setScopeValue(e.target.value)}
                  className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-600 focus:bg-white"
                >
                  {expenseCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              ) : scopeType === 'month' ? (
                <input
                  id="bdg-val"
                  type="month"
                  value={scopeValue}
                  onChange={(e) => setScopeValue(e.target.value)}
                  className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-600 focus:bg-white"
                />
              ) : (
                <input
                  id="bdg-val"
                  type="text"
                  required
                  value={scopeValue}
                  onChange={(e) => setScopeValue(e.target.value)}
                  placeholder={scopeType === 'purpose' ? 'Tên mục đích...' : 'Tên công việc...'}
                  className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-600 focus:bg-white"
                />
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {scopeType !== 'month' && (
                <div>
                  <label htmlFor="bdg-ym" className="block text-xs font-semibold text-slate-700 mb-1">
                    Tháng (YYYY-MM hoặc ALL)
                  </label>
                  <input
                    id="bdg-ym"
                    type="text"
                    value={budgetYearMonth}
                    onChange={(e) => setBudgetYearMonth(e.target.value)}
                    placeholder="2026-11 hoặc ALL"
                    className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-600 focus:bg-white"
                  />
                </div>
              )}
              <div className={scopeType === 'month' ? 'sm:col-span-2' : ''}>
                <label htmlFor="bdg-limit" className="block text-xs font-semibold text-slate-700 mb-1">
                  Hạn mức tối đa (VNĐ) *
                </label>
                <input
                  id="bdg-limit"
                  type="number"
                  min={1}
                  required
                  value={limitAmount}
                  onChange={(e) => setLimitAmount(e.target.value)}
                  className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-600 focus:bg-white"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={budgetSaving}
              className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold rounded-xl hover:from-violet-700 hover:to-indigo-700 shadow-md shadow-violet-600/20 transition-all disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>
                {budgetSaving
                  ? 'Đang lưu...'
                  : editingBudget
                  ? 'Lưu cập nhật hạn mức'
                  : 'Tạo hạn mức chi tiêu'}
              </span>
            </button>
          </form>
        </div>

        <div className="xl:col-span-8 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Danh sách hạn mức &amp; Tiến độ sử dụng
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Hiển thị theo ngưỡng an toàn (&lt;80% xanh · 80–99% vàng · &ge;100% đỏ)
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Lọc theo tháng hạn mức"
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                className="h-8 px-2.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
              >
                <option value="ALL">Mọi kỳ hạn mức</option>
                {availableMonths.map((ym) => (
                  <option key={ym} value={ym}>
                    Tháng {ym}
                  </option>
                ))}
              </select>

              <select
                aria-label="Lọc theo mức cảnh báo"
                value={filterAlert}
                onChange={(e) =>
                  setFilterAlert(e.target.value as 'ALL' | 'over_100' | 'warn' | 'ok')
                }
                className="h-8 px-2.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
              >
                <option value="ALL">Tất cả trạng thái</option>
                <option value="over_100">Vượt mức (&ge;100%)</option>
                <option value="warn">Cảnh báo (80–99%)</option>
                <option value="ok">An toàn (&lt;80%)</option>
              </select>
            </div>
          </div>

          {filteredEvaluations.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl">
              {budgets.length === 0
                ? 'Chưa có hạn mức chi tiêu nào được thiết lập. Hãy tạo hạn mức đầu tiên để kiểm soát chi tiêu.'
                : 'Không có hạn mức nào khớp bộ lọc đang chọn.'}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredEvaluations.map(({ budget, spent, remaining, percent, alertLevel }) => {
                const barColor =
                  alertLevel === 'over_100'
                    ? 'bg-gradient-to-r from-rose-500 to-red-600'
                    : alertLevel === 'warn_90'
                    ? 'bg-gradient-to-r from-orange-500 to-amber-600'
                    : alertLevel === 'warn_80'
                    ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-500';

                const cardTint =
                  alertLevel === 'over_100'
                    ? 'border-rose-200 bg-rose-50/40'
                    : alertLevel === 'warn_90' || alertLevel === 'warn_80'
                    ? 'border-amber-200 bg-amber-50/35'
                    : 'border-slate-200/90 bg-white';

                return (
                  <div
                    key={budget.id}
                    className={`p-4 border rounded-2xl space-y-2.5 transition-shadow hover:shadow-sm ${cardTint}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-sm text-slate-900">
                            {budget.name}
                          </span>
                          <span className="text-xs text-slate-500 font-medium">
                            · {budget.scopeValue} ({budget.yearMonth})
                          </span>
                        </div>
                        {alertLevel !== 'ok' && (
                          <div
                            className={`mt-1 inline-flex items-center gap-1.5 text-xs font-semibold ${
                              alertLevel === 'over_100' ? 'text-rose-700' : 'text-amber-700'
                            }`}
                          >
                            {alertLevel === 'over_100' ? (
                              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                            ) : (
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            )}
                            <span>
                              {alertLevel === 'over_100'
                                ? `Đã vượt ngân sách ${formatVND(Math.abs(remaining))}`
                                : alertLevel === 'warn_90'
                                ? 'Cảnh báo: Đã dùng trên 90% ngân sách'
                                : 'Cảnh báo: Đã chạm ngưỡng 80% ngân sách'}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEdit(budget)}
                          aria-label={`Sửa hạn mức ${budget.name}`}
                          className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteBudget(budget)}
                          aria-label={`Xóa hạn mức ${budget.name}`}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
                      <span className="text-slate-600">
                        Đã chi:{' '}
                        <strong className="text-slate-900">{formatVND(spent)}</strong> /{' '}
                        {formatVND(budget.limitAmount)}
                      </span>
                      <span
                        className={`font-bold ${
                          remaining >= 0 ? 'text-emerald-700' : 'text-rose-600'
                        }`}
                      >
                        {remaining >= 0
                          ? `Còn lại: ${formatVND(remaining)} (${percent.toFixed(0)}%)`
                          : `Vượt: ${formatVND(Math.abs(remaining))} (${percent.toFixed(0)}%)`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
