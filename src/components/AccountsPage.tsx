import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  CheckCircle2,
  Edit3,
  ExternalLink,
  History,
  PieChart,
  PiggyBank,
  Plus,
  Smartphone,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import type {
  AccountType,
  DriveAttachment,
  FinancialAccount,
  Transaction,
} from '../types/finance';
import {
  computeAccountAllocation,
  formatDateVN,
  formatVND,
  getEffectiveTransactionAmount,
  getTransactionEffectiveDate,
  paginateItems,
  toVndInt,
} from '../utils/financeRules';
import { StatusText } from './StatusText';

interface AccountsPageProps {
  accounts: FinancialAccount[];
  transactions: Transaction[];
  hasDriveToken: boolean;
  defaultPageSize?: number;
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
}

const ACCOUNT_TYPE_META: Record<
  AccountType,
  {
    label: string;
    cardClass: string;
    iconBoxClass: string;
    barClass: string;
    chipClass: string;
    Icon: React.ComponentType<{ className?: string }>;
  }
> = {
  cash: {
    label: 'Tiền mặt',
    cardClass: 'from-emerald-50/80 via-white to-white border-emerald-200/80',
    iconBoxClass: 'bg-emerald-600 text-white',
    barClass: 'from-emerald-500 to-teal-500',
    chipClass: 'bg-emerald-50/70 border-emerald-200/70 text-emerald-800',
    Icon: Banknote,
  },
  bank: {
    label: 'Ngân hàng',
    cardClass: 'from-blue-50/80 via-white to-white border-blue-200/80',
    iconBoxClass: 'bg-blue-600 text-white',
    barClass: 'from-blue-600 to-indigo-600',
    chipClass: 'bg-blue-50/70 border-blue-200/70 text-blue-800',
    Icon: Building2,
  },
  ewallet: {
    label: 'Ví điện tử',
    cardClass: 'from-violet-50/80 via-white to-white border-violet-200/80',
    iconBoxClass: 'bg-violet-600 text-white',
    barClass: 'from-violet-600 to-purple-500',
    chipClass: 'bg-violet-50/70 border-violet-200/70 text-violet-800',
    Icon: Smartphone,
  },
  savings: {
    label: 'Tiết kiệm',
    cardClass: 'from-amber-50/80 via-white to-white border-amber-200/80',
    iconBoxClass: 'bg-amber-600 text-white',
    barClass: 'from-amber-500 to-orange-500',
    chipClass: 'bg-amber-50/70 border-amber-200/70 text-amber-900',
    Icon: PiggyBank,
  },
};

export const AccountsPage: React.FC<AccountsPageProps> = ({
  accounts,
  transactions,
  hasDriveToken,
  defaultPageSize = 10,
  onReconnectDrive,
  onCreateAccount,
  onUpdateAccount,
  onReconcileAccount,
}) => {
  const [accType, setAccType] = useState<AccountType>('bank');
  const [accName, setAccName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [initialBalance, setInitialBalance] = useState('');
  const [editingAcc, setEditingAcc] = useState<FinancialAccount | null>(null);
  const [editCurrentBalance, setEditCurrentBalance] = useState('');
  const [accSaving, setAccSaving] = useState(false);
  const [accError, setAccError] = useState<string | null>(null);

  const [filterType, setFilterType] = useState<'ALL' | AccountType>('ALL');
  const [selectedAccountForHistory, setSelectedAccountForHistory] =
    useState<FinancialAccount | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  const [reconcilingAcc, setReconcilingAcc] = useState<FinancialAccount | null>(null);
  const [actualStmtBalance, setActualStmtBalance] = useState('');
  const [stmtFile, setStmtFile] = useState<File | null>(null);
  const [syncToActual, setSyncToActual] = useState(true);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileErr, setReconcileErr] = useState<string | null>(null);

  const allocation = useMemo(() => computeAccountAllocation(accounts), [accounts]);

  const filteredItems = useMemo(() => {
    if (filterType === 'ALL') return allocation.items;
    return allocation.items.filter((it) => it.account.type === filterType);
  }, [allocation.items, filterType]);

  const accountHistoryList = useMemo(() => {
    if (!selectedAccountForHistory) return [];
    const targetId = selectedAccountForHistory.id;
    return transactions.filter(
      (tx) => tx.accountId === targetId || tx.toAccountId === targetId
    );
  }, [selectedAccountForHistory, transactions]);

  const pagedHistory = useMemo(
    () => paginateItems(accountHistoryList, historyPage, defaultPageSize),
    [accountHistoryList, historyPage, defaultPageSize]
  );

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAccError(null);
    if (!accName.trim()) {
      setAccError('Vui lòng nhập tên tài khoản hoặc quỹ tiền.');
      return;
    }
    const initVal = toVndInt(Number(initialBalance || 0));
    if (!Number.isFinite(initVal)) {
      setAccError('Số dư ban đầu không hợp lệ.');
      return;
    }

    setAccSaving(true);
    try {
      if (editingAcc) {
        const curVal = toVndInt(Number(editCurrentBalance || initVal));
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

    const val = toVndInt(Number(actualStmtBalance));
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

  return (
    <div className="space-y-6 animate-fintech-in">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0B1437]">
            QUẢN LÝ TÀI KHOẢN &amp; NGUỒN TIỀN
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Theo dõi tiền mặt, tài khoản ngân hàng, ví điện tử, sổ tiết kiệm và đối chiếu sao kê thực tế
          </p>
        </div>
      </div>

      {/* Top Summary & Allocation Strip */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-4 rounded-2xl p-5 bg-gradient-to-br from-[#0B1437] via-[#132154] to-blue-900 text-white shadow-lg shadow-blue-950/15 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-200">
              Tổng số dư các tài khoản
            </span>
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center">
              <Wallet className="w-4 h-4 text-blue-200" />
            </div>
          </div>
          <p className="text-3xl font-extrabold font-mono tabular-nums mt-3">
            {formatVND(allocation.totalBalance)}
          </p>
          <div className="grid grid-cols-4 gap-2 mt-4 pt-3 border-t border-white/15 text-[11px]">
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
              <span className="text-violet-300 block font-medium">Ví ĐT</span>
              <span className="font-mono font-bold tabular-nums">
                {allocation.byType.ewallet.percentage.toFixed(0)}%
              </span>
            </div>
            <div>
              <span className="text-amber-300 block font-medium">Tiết kiệm</span>
              <span className="font-mono font-bold tabular-nums">
                {allocation.byType.savings.percentage.toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-8 bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs flex flex-col justify-between space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white flex items-center justify-center">
                <PieChart className="w-4 h-4" />
              </div>
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Cơ cấu phân bổ dòng tiền
                </h2>
                <p className="text-xs text-slate-500">
                  Tự động cập nhật khi thu, chi hoặc chuyển khoản nội bộ hoàn tất
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
              <div className="w-full h-3.5 bg-slate-100 rounded-full overflow-hidden flex">
                {(['cash', 'bank', 'ewallet', 'savings'] as const).map((t) =>
                  allocation.byType[t].percentage > 0 ? (
                    <div
                      key={t}
                      className={`h-full bg-gradient-to-r ${ACCOUNT_TYPE_META[t].barClass} transition-all duration-300`}
                      style={{ width: `${allocation.byType[t].percentage}%` }}
                      title={`${ACCOUNT_TYPE_META[t].label}: ${formatVND(allocation.byType[t].total)}`}
                    />
                  ) : null
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 text-xs">
                {(['cash', 'bank', 'ewallet', 'savings'] as const).map((t) => {
                  const meta = ACCOUNT_TYPE_META[t];
                  const Icon = meta.Icon;
                  const bucket = allocation.byType[t];
                  return (
                    <div
                      key={t}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-2 ${meta.chipClass}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className="w-4 h-4 shrink-0" />
                        <div className="min-w-0">
                          <span className="font-semibold block truncate">{meta.label}</span>
                          <span className="text-[11px] opacity-80">{bucket.count} TK</span>
                        </div>
                      </div>
                      <div className="text-right font-mono shrink-0">
                        <span className="font-bold text-slate-900 block tabular-nums">
                          {formatVND(bucket.total)}
                        </span>
                        <span className="text-[11px] font-semibold tabular-nums">
                          {bucket.percentage.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Form + Account Cards */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-4 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
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
                <option value="savings">Tài khoản tiết kiệm</option>
              </select>
            </div>

            <div>
              <label htmlFor="acc-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Tên tài khoản / quỹ *
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
                    ? 'Ví dụ: Vietcombank chi tiêu'
                    : accType === 'savings'
                    ? 'Ví dụ: Sổ tiết kiệm dự phòng'
                    : 'Ví dụ: MoMo / ZaloPay'
                }
                className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            {(accType === 'bank' || accType === 'savings') && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="acc-bank" className="block text-xs font-semibold text-slate-700 mb-1">
                    Ngân hàng / Nơi gửi
                  </label>
                  <input
                    id="acc-bank"
                    type="text"
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="VCB, ACB, Cake..."
                    className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                  />
                </div>
                <div>
                  <label htmlFor="acc-number" className="block text-xs font-semibold text-slate-700 mb-1">
                    Số tài khoản / Mã sổ
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

        <div className="xl:col-span-8 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Danh sách tài khoản hiện có
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Lọc theo nhóm hoặc bấm &quot;Lịch sử&quot; để kiểm tra biến động số dư chi tiết
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(['ALL', 'cash', 'bank', 'ewallet', 'savings'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setFilterType(t)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                    filterType === t
                      ? 'bg-[#0B1437] text-white border-[#0B1437]'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {t === 'ALL' ? 'Tất cả' : ACCOUNT_TYPE_META[t].label}
                </button>
              ))}
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl">
              {accounts.length === 0
                ? 'Chưa có nguồn tiền nào. Hãy tạo tài khoản đầu tiên ở biểu mẫu bên cạnh.'
                : 'Không có tài khoản nào thuộc nhóm đang lọc.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {filteredItems.map(({ account: acc, percentage }) => {
                const meta = ACCOUNT_TYPE_META[acc.type] || ACCOUNT_TYPE_META.bank;
                const Icon = meta.Icon;
                const diff =
                  typeof acc.actualVerifiedBalance === 'number'
                    ? acc.actualVerifiedBalance - acc.currentBalance
                    : null;

                return (
                  <div
                    key={acc.id}
                    className={`p-4 rounded-2xl border bg-gradient-to-br space-y-3 hover:shadow-md transition-all ${meta.cardClass}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${meta.iconBoxClass}`}
                        >
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-sm text-slate-900 truncate">
                            {acc.name}
                          </h3>
                          <p className="text-xs text-slate-500 truncate">
                            {acc.bankName || meta.label}
                            {acc.accountNumber ? ` · ${acc.accountNumber}` : ''}
                          </p>
                        </div>
                      </div>
                      <span className="text-[11px] font-mono font-bold text-slate-500 shrink-0 tabular-nums">
                        {percentage.toFixed(1)}%
                      </span>
                    </div>

                    <div>
                      <p className="text-xl font-extrabold font-mono tabular-nums text-slate-900">
                        {formatVND(acc.currentBalance)}
                      </p>
                      <p className="text-[11px] text-slate-500 font-mono mt-0.5 tabular-nums">
                        Ban đầu: {formatVND(acc.initialBalance)}
                        {acc.lastReconciledAt
                          ? ` · Đối chiếu ${formatDateVN(acc.lastReconciledAt.slice(0, 10))}`
                          : ''}
                      </p>
                    </div>

                    {diff !== null && (
                      <div
                        className={`text-xs font-mono font-medium tabular-nums ${
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

                    <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-200/60">
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
                          setSelectedAccountForHistory(acc);
                          setHistoryPage(1);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                      >
                        <History className="w-3 h-3" />
                        <span>Lịch sử</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReconcilingAcc(acc);
                          setActualStmtBalance(String(acc.currentBalance));
                          setStmtFile(null);
                          setReconcileErr(null);
                        }}
                        className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-[#0B1437] hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap"
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

      {/* Account Transaction History Section */}
      {selectedAccountForHistory && (
        <section className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-base font-bold text-slate-900">
                Biến động giao dịch: {selectedAccountForHistory.name}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Hiển thị tất cả khoản thu, khoản chi và chuyển khoản nội bộ liên quan ({accountHistoryList.length} giao dịch)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedAccountForHistory(null)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg"
            >
              <X className="w-3.5 h-3.5" />
              <span>Đóng</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Mã GD</th>
                  <th className="py-3 px-4">Ngày</th>
                  <th className="py-3 px-4">Nội dung</th>
                  <th className="py-3 px-4">Phân loại</th>
                  <th className="py-3 px-4 text-right">Biến động</th>
                  <th className="py-3 px-4">Trạng thái</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {pagedHistory.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 px-4 text-center text-slate-400">
                      Tài khoản này chưa phát sinh giao dịch nào.
                    </td>
                  </tr>
                ) : (
                  pagedHistory.items.map((tx) => {
                    const isIncomingTransfer =
                      tx.kind === 'transfer' &&
                      tx.toAccountId === selectedAccountForHistory.id;
                    const isPositive = tx.kind === 'income' || isIncomingTransfer;
                    return (
                      <tr key={tx.id} className="hover:bg-blue-50/35">
                        <td className="py-3 px-4 font-mono text-xs font-bold text-slate-900 whitespace-nowrap">
                          {tx.code}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {formatDateVN(getTransactionEffectiveDate(tx))}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{tx.name}</div>
                          {tx.kind === 'transfer' && (
                            <div className="text-xs text-blue-700 flex items-center gap-1 mt-0.5">
                              <ArrowLeftRight className="w-3 h-3" />
                              <span>
                                {tx.accountName} → {tx.toAccountName || '—'}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">{tx.category}</td>
                        <td
                          className={`py-3 px-4 text-right font-mono font-bold tabular-nums whitespace-nowrap ${
                            isPositive ? 'text-emerald-600' : 'text-rose-600'
                          }`}
                        >
                          {isPositive ? '+' : '-'}
                          {formatVND(getEffectiveTransactionAmount(tx))}
                        </td>
                        <td className="py-3 px-4">
                          <StatusText status={tx.status} kind={tx.kind} />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {pagedHistory.totalPages > 1 && (
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between text-xs text-slate-600">
              <span>
                Hiển thị {pagedHistory.startIndex + 1}–{pagedHistory.endIndex} / {pagedHistory.totalItems}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={pagedHistory.page <= 1}
                  onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white disabled:opacity-40"
                >
                  Trước
                </button>
                <span className="font-mono font-semibold">
                  {pagedHistory.page} / {pagedHistory.totalPages}
                </span>
                <button
                  type="button"
                  disabled={pagedHistory.page >= pagedHistory.totalPages}
                  onClick={() => setHistoryPage((p) => p + 1)}
                  className="px-2.5 py-1 rounded-lg border border-slate-200 bg-white disabled:opacity-40"
                >
                  Sau
                </button>
              </div>
            </div>
          )}
        </section>
      )}

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
    </div>
  );
};
