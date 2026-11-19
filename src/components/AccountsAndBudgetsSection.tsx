import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Building2,
  CheckCircle2,
  Edit3,
  ExternalLink,
  PieChart,
  Plus,
  ShieldAlert,
  Smartphone,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
import type {
  AccountType,
  BudgetLimit,
  BudgetScopeType,
  DriveAttachment,
  FinancialAccount,
  Transaction,
} from '../types/finance';
import {
  computeAccountAllocation,
  evaluateBudget,
  formatDateVN,
  formatVND,
} from '../utils/financeRules';

interface AccountsAndBudgetsSectionProps {
  accounts: FinancialAccount[];
  budgets: BudgetLimit[];
  transactions: Transaction[];
  hasDriveToken: boolean;
  onReconnectDrive: () => void;
  onCreateAccount: (input: {
    type: AccountType;
    name: string;
    bankName?: string;
    accountNumber?: string;
    initialBalance: number;
  }) => Promise<void>;
  onUpdateAccount: (
    accountId: string,
    patch: {
      type: AccountType;
      name: string;
      bankName?: string;
      accountNumber?: string;
      initialBalance: number;
      currentBalance: number;
    }
  ) => Promise<void>;
  onReconcileAccount: (
    account: FinancialAccount,
    actualVerifiedBalance: number,
    file: File | null,
    syncBalance: boolean
  ) => Promise<void>;
  onCreateBudget: (input: {
    name: string;
    scopeType: BudgetScopeType;
    scopeValue: string;
    yearMonth: string;
    limitAmount: number;
  }) => Promise<void>;
  onDeleteBudget: (budget: BudgetLimit) => Promise<void>;
  expenseCategories: readonly string[];
}

export const AccountsAndBudgetsSection: React.FC<AccountsAndBudgetsSectionProps> = ({
  accounts,
  budgets,
  transactions,
  hasDriveToken,
  onReconnectDrive,
  onCreateAccount,
  onUpdateAccount,
  onReconcileAccount,
  onCreateBudget,
  onDeleteBudget,
  expenseCategories,
}) => {
  // Account Form State
  const [accType, setAccType] = useState<AccountType>('bank');
  const [accName, setAccName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [initialBalance, setInitialBalance] = useState('');
  const [editingAcc, setEditingAcc] = useState<FinancialAccount | null>(null);
  const [editCurrentBalance, setEditCurrentBalance] = useState('');
  const [accSaving, setAccSaving] = useState(false);
  const [accError, setAccError] = useState<string | null>(null);

  // Reconciliation Modal State
  const [reconcilingAcc, setReconcilingAcc] = useState<FinancialAccount | null>(null);
  const [actualStmtBalance, setActualStmtBalance] = useState('');
  const [stmtFile, setStmtFile] = useState<File | null>(null);
  const [syncToActual, setSyncToActual] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileErr, setReconcileErr] = useState<string | null>(null);

  // Budget Form State
  const [budgetName, setBudgetName] = useState('');
  const [scopeType, setScopeType] = useState<BudgetScopeType>('category');
  const [scopeValue, setScopeValue] = useState<string>(expenseCategories[0] || '');
  const [budgetYearMonth, setBudgetYearMonth] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [limitAmount, setLimitAmount] = useState('');
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetErr, setBudgetErr] = useState<string | null>(null);

  const budgetEvaluations = useMemo(
    () => budgets.map((b) => evaluateBudget(b, transactions)),
    [budgets, transactions]
  );

  const allocation = useMemo(
    () => computeAccountAllocation(accounts),
    [accounts]
  );

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccError(null);
    if (!accName.trim()) {
      setAccError('Vui lòng nhập tên tài khoản hoặc quỹ tiền.');
      return;
    }
    const initVal = Number(initialBalance || 0);
    if (!Number.isFinite(initVal)) {
      setAccError('Số dư ban đầu không hợp lệ.');
      return;
    }

    setAccSaving(true);
    try {
      if (editingAcc) {
        const curVal = Number(editCurrentBalance || initVal);
        await onUpdateAccount(editingAcc.id, {
          type: accType,
          name: accName,
          bankName,
          accountNumber,
          initialBalance: initVal,
          currentBalance: curVal,
        });
        setEditingAcc(null);
      } else {
        await onCreateAccount({
          type: accType,
          name: accName,
          bankName,
          accountNumber,
          initialBalance: initVal,
        });
      }
      setAccName('');
      setBankName('');
      setAccountNumber('');
      setInitialBalance('');
      setEditCurrentBalance('');
    } catch (err) {
      setAccError(err instanceof Error ? err.message : 'Lỗi lưu tài khoản.');
    } finally {
      setAccSaving(false);
    }
  };

  const startEditAccount = (acc: FinancialAccount) => {
    setEditingAcc(acc);
    setAccType(acc.type);
    setAccName(acc.name);
    setBankName(acc.bankName || '');
    setAccountNumber(acc.accountNumber || '');
    setInitialBalance(String(acc.initialBalance));
    setEditCurrentBalance(String(acc.currentBalance));
    setAccError(null);
  };

  const handleReconcileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reconcilingAcc) return;
    setReconcileErr(null);

    const val = Number(actualStmtBalance);
    if (!Number.isFinite(val)) {
      setReconcileErr('Vui lòng nhập số dư thực tế hợp lệ.');
      return;
    }
    if (stmtFile && !hasDriveToken) {
      setReconcileErr('Vui lòng kết nối Google Drive trước khi tải lên ảnh sao kê.');
      return;
    }

    setReconciling(true);
    try {
      await onReconcileAccount(reconcilingAcc, val, stmtFile, syncToActual);
      setReconcilingAcc(null);
      setActualStmtBalance('');
      setStmtFile(null);
    } catch (err) {
      setReconcileErr(err instanceof Error ? err.message : 'Đối chiếu thất bại.');
    } finally {
      setReconciling(false);
    }
  };

  const handleBudgetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBudgetErr(null);
    const lim = Number(limitAmount);
    if (!budgetName.trim() || !scopeValue.trim() || !Number.isFinite(lim) || lim <= 0) {
      setBudgetErr('Vui lòng nhập đầy đủ tên hạn mức, đối tượng áp dụng và số tiền > 0.');
      return;
    }
    setBudgetSaving(true);
    try {
      await onCreateBudget({
        name: budgetName,
        scopeType,
        scopeValue,
        yearMonth: scopeType === 'month' ? scopeValue : budgetYearMonth || 'ALL',
        limitAmount: lim,
      });
      setBudgetName('');
      setLimitAmount('');
    } catch (err) {
      setBudgetErr(err instanceof Error ? err.message : 'Không thể lưu hạn mức.');
    } finally {
      setBudgetSaving(false);
    }
  };

  return (
    <div className="space-y-8 animate-fintech-in">
      {/* Top Overview Strip: Type Cards + Balance Distribution Chart */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-4 rounded-2xl p-5 bg-gradient-to-br from-[#0B1437] via-[#132154] to-blue-900 text-white shadow-lg shadow-blue-950/15 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-200">
              Tổng số dư hiện có
            </span>
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-blue-200" />
            </div>
          </div>
          <p className="text-3xl font-extrabold font-mono tabular-nums mt-3">
            {formatVND(allocation.totalBalance)}
          </p>
          <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-white/15 text-xs">
            <div>
              <span className="text-emerald-300 block font-medium">Tiền mặt</span>
              <span className="font-mono font-bold tabular-nums">
                {allocation.byType.cash.percentage.toFixed(0)}%
              </span>
            </div>
            <div>
              <span className="text-blue-300 block font-medium">Ngân hàng</span>
              <span className="font-mono font-bold tabular-nums">
                {allocation.byType.bank.percentage.toFixed(0)}%
              </span>
            </div>
            <div>
              <span className="text-violet-300 block font-medium">Ví điện tử</span>
              <span className="font-mono font-bold tabular-nums">
                {allocation.byType.ewallet.percentage.toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

        {/* Account Balance Distribution Chart */}
        <div className="lg:col-span-8 bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white flex items-center justify-center">
                <PieChart className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Biểu đồ phân bổ số dư tài khoản
                </h2>
                <p className="text-xs text-slate-500">
                  Tỷ trọng dòng tiền theo loại hình nguồn tiền thực tế
                </p>
              </div>
            </div>
            <span className="text-xs font-mono font-semibold text-blue-700">
              {accounts.length} nguồn tiền
            </span>
          </div>

          {accounts.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl">
              Chưa có tài khoản để hiển thị phân bổ số dư.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Proportional Stacked Bar */}
              <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden flex">
                {allocation.byType.cash.percentage > 0 && (
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300"
                    style={{ width: `${allocation.byType.cash.percentage}%` }}
                    title={`Tiền mặt: ${formatVND(allocation.byType.cash.total)}`}
                  />
                )}
                {allocation.byType.bank.percentage > 0 && (
                  <div
                    className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-300"
                    style={{ width: `${allocation.byType.bank.percentage}%` }}
                    title={`Ngân hàng: ${formatVND(allocation.byType.bank.total)}`}
                  />
                )}
                {allocation.byType.ewallet.percentage > 0 && (
                  <div
                    className="h-full bg-gradient-to-r from-violet-600 to-purple-500 transition-all duration-300"
                    style={{ width: `${allocation.byType.ewallet.percentage}%` }}
                    title={`Ví điện tử: ${formatVND(allocation.byType.ewallet.total)}`}
                  />
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200/70 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Banknote className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <span className="font-semibold text-emerald-900 block">Tiền mặt</span>
                      <span className="text-[11px] text-emerald-700">
                        {allocation.byType.cash.count} quỹ
                      </span>
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <span className="font-bold text-slate-900 block">
                      {formatVND(allocation.byType.cash.total)}
                    </span>
                    <span className="text-[11px] text-emerald-700 font-semibold">
                      {allocation.byType.cash.percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200/70 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-semibold text-blue-950 block">Ngân hàng</span>
                      <span className="text-[11px] text-blue-700">
                        {allocation.byType.bank.count} tài khoản
                      </span>
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <span className="font-bold text-slate-900 block">
                      {formatVND(allocation.byType.bank.total)}
                    </span>
                    <span className="text-[11px] text-blue-700 font-semibold">
                      {allocation.byType.bank.percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-violet-50/70 border border-violet-200/70 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-violet-600 shrink-0" />
                    <div>
                      <span className="font-semibold text-violet-950 block">Ví điện tử</span>
                      <span className="text-[11px] text-violet-700">
                        {allocation.byType.ewallet.count} ví
                      </span>
                    </div>
                  </div>
                  <div className="text-right font-mono">
                    <span className="font-bold text-slate-900 block">
                      {formatVND(allocation.byType.ewallet.total)}
                    </span>
                    <span className="text-[11px] text-violet-700 font-semibold">
                      {allocation.byType.ewallet.percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* A. Money Sources / Accounts Form + Styled Account Cards */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-5 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="font-display text-base font-bold text-slate-900">
              {editingAcc ? `Chỉnh sửa: ${editingAcc.name}` : 'Thêm nguồn tiền / tài khoản'}
            </h2>
            {editingAcc && (
              <button
                type="button"
                onClick={() => {
                  setEditingAcc(null);
                  setAccName('');
                  setBankName('');
                  setAccountNumber('');
                  setInitialBalance('');
                }}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline"
              >
                Hủy sửa
              </button>
            )}
          </div>

          {accError && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
              {accError}
            </div>
          )}

          <form onSubmit={handleAccountSubmit} className="space-y-3.5">
            <div>
              <label htmlFor="acc-type" className="block text-xs font-semibold text-slate-700 mb-1">
                Loại nguồn tiền
              </label>
              <select
                id="acc-type"
                value={accType}
                onChange={(e) => setAccType(e.target.value as AccountType)}
                className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              >
                <option value="cash">Tiền mặt</option>
                <option value="bank">Tài khoản ngân hàng</option>
                <option value="ewallet">Ví điện tử</option>
              </select>
            </div>

            <div>
              <label htmlFor="acc-name" className="block text-xs font-semibold text-slate-700 mb-1">
                {accType === 'cash'
                  ? 'Tên quỹ tiền mặt *'
                  : accType === 'bank'
                  ? 'Tên tài khoản *'
                  : 'Tên ví điện tử *'}
              </label>
              <input
                id="acc-name"
                type="text"
                required
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                placeholder={
                  accType === 'cash'
                    ? 'Ví dụ: Tiền mặt cá nhân'
                    : accType === 'bank'
                    ? 'Ví dụ: Tài khoản chi tiêu chính'
                    : 'Ví dụ: MoMo / ZaloPay'
                }
                className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            {accType === 'bank' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="acc-bank" className="block text-xs font-semibold text-slate-700 mb-1">
                    Tên ngân hàng
                  </label>
                  <input
                    id="acc-bank"
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="Vietcombank, Techcombank..."
                    className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label htmlFor="acc-number" className="block text-xs font-semibold text-slate-700 mb-1">
                    Số tài khoản (tùy chọn)
                  </label>
                  <input
                    id="acc-number"
                    type="text"
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                  />
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="acc-init" className="block text-xs font-semibold text-slate-700 mb-1">
                  Số dư ban đầu (VNĐ) *
                </label>
                <input
                  id="acc-init"
                  type="number"
                  required
                  value={initialBalance}
                  onChange={(e) => setInitialBalance(e.target.value)}
                  className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                />
              </div>
              {editingAcc && (
                <div>
                  <label htmlFor="acc-cur" className="block text-xs font-semibold text-slate-700 mb-1">
                    Số dư hiện tại (VNĐ)
                  </label>
                  <input
                    id="acc-cur"
                    type="number"
                    value={editCurrentBalance}
                    onChange={(e) => setEditCurrentBalance(e.target.value)}
                    className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                  />
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={accSaving}
              className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-semibold rounded-xl hover:from-blue-700 hover:to-indigo-700 shadow-md shadow-blue-600/20 transition-all disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>
                {accSaving
                  ? 'Đang lưu...'
                  : editingAcc
                  ? 'Lưu thay đổi tài khoản'
                  : 'Thêm tài khoản nguồn tiền'}
              </span>
            </button>
          </form>
        </div>

        <div className="xl:col-span-7 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Danh sách quỹ tiền, ngân hàng &amp; ví điện tử
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Tự động cập nhật khi giao dịch thu/chi hoàn tất
              </p>
            </div>
            <span className="text-xs font-mono font-bold text-blue-700">
              {accounts.length} tài khoản
            </span>
          </div>

          {accounts.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl">
              Chưa có nguồn tiền nào. Hãy tạo ít nhất một quỹ tiền mặt, tài khoản ngân hàng hoặc ví điện tử ở biểu mẫu bên cạnh.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {allocation.items.map(({ account: acc, percentage }) => {
                const isCash = acc.type === 'cash';
                const isBank = acc.type === 'bank';
                const Icon = isCash ? Banknote : isBank ? Building2 : Smartphone;
                const cardStyle = isCash
                  ? 'from-emerald-50/80 via-white to-white border-emerald-200/80'
                  : isBank
                  ? 'from-blue-50/80 via-white to-white border-blue-200/80'
                  : 'from-violet-50/80 via-white to-white border-violet-200/80';
                const iconBoxStyle = isCash
                  ? 'bg-emerald-600 text-white'
                  : isBank
                  ? 'bg-blue-600 text-white'
                  : 'bg-violet-600 text-white';

                const diff =
                  typeof acc.actualVerifiedBalance === 'number'
                    ? acc.actualVerifiedBalance - acc.currentBalance
                    : null;

                return (
                  <div
                    key={acc.id}
                    className={`p-4 rounded-2xl border bg-gradient-to-br space-y-3 hover:shadow-md transition-all ${cardStyle}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBoxStyle}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-sm text-slate-900 truncate">
                            {acc.name}
                          </h3>
                          <p className="text-xs text-slate-500 truncate">
                            {isCash
                              ? 'Tiền mặt'
                              : isBank
                              ? acc.bankName || 'Ngân hàng'
                              : 'Ví điện tử'}
                            {acc.accountNumber ? ` · ${acc.accountNumber}` : ''}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-mono font-bold text-slate-500 shrink-0">
                        {percentage.toFixed(1)}%
                      </span>
                    </div>

                    <div>
                      <p className="text-xl font-extrabold font-mono tabular-nums text-slate-900">
                        {formatVND(acc.currentBalance)}
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                        Ban đầu: {formatVND(acc.initialBalance)}
                        {acc.lastReconciledAt
                          ? ` · Đối chiếu ${formatDateVN(acc.lastReconciledAt.slice(0, 10))}`
                          : ''}
                      </p>
                    </div>

                    {diff !== null && (
                      <div
                        className={`text-xs font-mono font-medium ${
                          diff === 0 ? 'text-emerald-700' : 'text-amber-700'
                        }`}
                      >
                        Sao kê: {formatVND(acc.actualVerifiedBalance!)} (Chênh: {formatVND(diff)})
                      </div>
                    )}

                    {acc.reconciliationAttachments &&
                      acc.reconciliationAttachments.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {acc.reconciliationAttachments.map((att: DriveAttachment) => (
                            <a
                              key={att.id}
                              href={att.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline font-mono"
                            >
                              <span>{att.name}</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ))}
                        </div>
                      )}

                    <div className="flex items-center gap-2 pt-2 border-t border-slate-200/60">
                      <button
                        type="button"
                        onClick={() => startEditAccount(acc)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Sửa</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReconcilingAcc(acc);
                          setActualStmtBalance(String(acc.currentBalance));
                          setStmtFile(null);
                          setReconcileErr(null);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-[#0B1437] hover:bg-blue-800 rounded-lg transition-colors"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Đối chiếu sao kê</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Reconciliation Modal */}
      {reconcilingAcc && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Đối chiếu số dư sao kê thực tế"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-2xl">
            <h3 className="font-display text-lg font-bold text-slate-900">
              Đối chiếu sao kê: {reconcilingAcc.name}
            </h3>
            <p className="text-xs text-slate-500">
              Số dư trên hệ thống hiện tại:{' '}
              <strong className="font-mono text-slate-900">
                {formatVND(reconcilingAcc.currentBalance)}
              </strong>
            </p>

            {reconcileErr && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                {reconcileErr}
              </div>
            )}

            <form onSubmit={handleReconcileSubmit} className="space-y-4">
              <div>
                <label htmlFor="stmt-balance" className="block text-xs font-semibold text-slate-700 mb-1">
                  Số dư thực tế trên sao kê (VNĐ) *
                </label>
                <input
                  id="stmt-balance"
                  type="number"
                  required
                  value={actualStmtBalance}
                  onChange={(e) => setActualStmtBalance(e.target.value)}
                  className="w-full h-9 px-3 text-sm font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label htmlFor="stmt-file" className="block text-xs font-semibold text-slate-700 mb-1">
                  Ảnh chụp số dư / Sao kê ngân hàng (tải lên Google Drive)
                </label>
                {!hasDriveToken ? (
                  <button
                    type="button"
                    onClick={onReconnectDrive}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-300 text-amber-800 text-xs font-semibold rounded-lg"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Kết nối Google Drive để tải sao kê</span>
                  </button>
                ) : (
                  <input
                    id="stmt-file"
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setStmtFile(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-200 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100"
                  />
                )}
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={syncToActual}
                  onChange={(e) => setSyncToActual(e.target.checked)}
                  className="rounded border-slate-300"
                />
                <span>Cập nhật số dư hệ thống khớp với số dư sao kê thực tế</span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setReconcilingAcc(null)}
                  className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={reconciling}
                  className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50"
                >
                  {reconciling ? 'Đang đối chiếu...' : 'Xác nhận đối chiếu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* B. Spending Budgets & Threshold Alerts (Violet Theme) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-5 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="pb-3 border-b border-slate-100">
            <h2 className="font-display text-base font-bold text-slate-900">
              Thiết lập hạn mức chi tiêu
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Cài đặt ngân sách tháng theo danh mục, mục đích hoặc công việc
            </p>
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
                placeholder="Ví dụ: Ngân sách ăn uống tháng 11"
                className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-600 focus:bg-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                      setScopeValue(new Date().toISOString().slice(0, 7));
                    } else {
                      setScopeValue('');
                    }
                  }}
                  className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-600 focus:bg-white"
                >
                  <option value="category">Theo loại chi</option>
                  <option value="month">Theo từng tháng</option>
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
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {scopeType !== 'month' && (
                <div>
                  <label htmlFor="bdg-ym" className="block text-xs font-semibold text-slate-700 mb-1">
                    Tháng áp dụng (hoặc ALL)
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
              <span>{budgetSaving ? 'Đang lưu...' : 'Tạo hạn mức chi tiêu'}</span>
            </button>
          </form>
        </div>

        <div className="xl:col-span-7 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Theo dõi ngân sách &amp; Cảnh báo (80% · 90% · 100%)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Hiển thị trực quan mức độ tiêu dùng theo ngưỡng an toàn
              </p>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-semibold">
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <span className="w-2 h-2 rounded-full bg-emerald-500" /> &lt;80%
              </span>
              <span className="inline-flex items-center gap-1 text-amber-700">
                <span className="w-2 h-2 rounded-full bg-amber-500" /> 80-99%
              </span>
              <span className="inline-flex items-center gap-1 text-rose-700">
                <span className="w-2 h-2 rounded-full bg-rose-600" /> &ge;100%
              </span>
            </div>
          </div>

          {budgetEvaluations.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl">
              Chưa có hạn mức chi tiêu nào được thiết lập.
            </div>
          ) : (
            <div className="space-y-3">
              {budgetEvaluations.map(({ budget, spent, remaining, percent, alertLevel }) => {
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
                                ? 'Cảnh báo: Đã vượt 100% hạn mức ngân sách!'
                                : alertLevel === 'warn_90'
                                ? 'Cảnh báo: Chi tiêu đã đạt từ 90% ngân sách.'
                                : 'Lưu ý: Chi tiêu đã đạt từ 80% ngân sách.'}
                            </span>
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => onDeleteBudget(budget)}
                        aria-label={`Xóa hạn mức ${budget.name}`}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                      <div>
                        <span className="text-slate-500 block font-sans">Đã chi</span>
                        <span className="font-bold text-slate-900">
                          {formatVND(spent)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 block font-sans">Còn lại</span>
                        <span
                          className={`font-bold ${
                            remaining < 0 ? 'text-rose-600' : 'text-emerald-700'
                          }`}
                        >
                          {formatVND(remaining)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-500 block font-sans">Mức dùng</span>
                        <span className="font-bold text-slate-900">
                          {percent.toFixed(1)}% / {formatVND(budget.limitAmount)}
                        </span>
                      </div>
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
