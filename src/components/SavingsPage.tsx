import React, { useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Edit3,
  PiggyBank,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  SAVINGS_CATEGORIES,
  type FinancialAccount,
  type SavingsContribution,
  type SavingsGoal,
  type SavingsGoalStatus,
} from '../types/finance';
import {
  computeSavingsSummary,
  evaluateSavingsGoal,
  formatDateVN,
  formatVND,
  paginateItems,
  toVndInt,
} from '../utils/financeRules';

interface SavingsPageProps {
  goals: SavingsGoal[];
  contributions: SavingsContribution[];
  accounts: FinancialAccount[];
  defaultPageSize?: number;
  onCreateGoal: (input: {
    name: string;
    targetAmount: number;
    currentAmount?: number;
    targetDate?: string;
    linkedAccountId?: string;
    linkedAccountName?: string;
    category?: string;
    note?: string;
  }) => Promise<void>;
  onUpdateGoal: (
    goalId: string,
    patch: {
      name: string;
      targetAmount: number;
      targetDate?: string;
      linkedAccountId?: string;
      linkedAccountName?: string;
      category?: string;
      status: SavingsGoalStatus;
      note?: string;
    }
  ) => Promise<void>;
  onDeleteGoal: (goal: SavingsGoal) => Promise<void>;
  onRecordContribution: (input: {
    goalId: string;
    type: 'deposit' | 'withdraw';
    amount: number;
    date: string;
    accountId?: string;
    accountName?: string;
    linkAccountBalance: boolean;
    note?: string;
  }) => Promise<void>;
}

export const SavingsPage: React.FC<SavingsPageProps> = ({
  goals,
  contributions,
  accounts,
  defaultPageSize = 10,
  onCreateGoal,
  onUpdateGoal,
  onDeleteGoal,
  onRecordContribution,
}) => {
  const todayIso = new Date().toISOString().slice(0, 10);

  const [editingGoal, setEditingGoal] = useState<SavingsGoal | null>(null);
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [initialSaved, setInitialSaved] = useState('0');
  const [targetDate, setTargetDate] = useState('');
  const [category, setCategory] = useState<string>(SAVINGS_CATEGORIES[0]);
  const [linkedAccountId, setLinkedAccountId] = useState<string>(accounts[0]?.id || '');
  const [status, setStatus] = useState<SavingsGoalStatus>('active');
  const [note, setNote] = useState('');
  const [savingGoal, setSavingGoal] = useState(false);
  const [goalErr, setGoalErr] = useState<string | null>(null);

  // Deposit/Withdraw Modal
  const [activeContribGoal, setActiveContribGoal] = useState<SavingsGoal | null>(null);
  const [contribType, setContribType] = useState<'deposit' | 'withdraw'>('deposit');
  const [contribAmount, setContribAmount] = useState('');
  const [contribDate, setContribDate] = useState(todayIso);
  const [contribAccountId, setContribAccountId] = useState<string>(accounts[0]?.id || '');
  const [linkAccountBalance, setLinkAccountBalance] = useState(true);
  const [contribNote, setContribNote] = useState('');
  const [submittingContrib, setSubmittingContrib] = useState(false);
  const [contribErr, setContribErr] = useState<string | null>(null);

  const [historyPage, setHistoryPage] = useState(1);

  const summary = useMemo(() => computeSavingsSummary(goals), [goals]);
  const evaluatedGoals = useMemo(
    () => goals.map((g) => evaluateSavingsGoal(g, todayIso)),
    [goals, todayIso]
  );

  const pagedHistory = useMemo(
    () => paginateItems(contributions, historyPage, defaultPageSize),
    [contributions, historyPage, defaultPageSize]
  );

  const resetForm = () => {
    setEditingGoal(null);
    setName('');
    setTargetAmount('');
    setInitialSaved('0');
    setTargetDate('');
    setCategory(SAVINGS_CATEGORIES[0]);
    setLinkedAccountId(accounts[0]?.id || '');
    setStatus('active');
    setNote('');
    setGoalErr(null);
  };

  const startEdit = (goal: SavingsGoal) => {
    setEditingGoal(goal);
    setName(goal.name);
    setTargetAmount(String(goal.targetAmount));
    setTargetDate(goal.targetDate || '');
    setCategory(goal.category || SAVINGS_CATEGORIES[0]);
    setLinkedAccountId(goal.linkedAccountId || '');
    setStatus(goal.status);
    setNote(goal.note || '');
    setGoalErr(null);
  };

  const handleGoalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGoalErr(null);
    const targetInt = toVndInt(Number(targetAmount));
    const initInt = toVndInt(Number(initialSaved || 0));
    if (!name.trim() || !Number.isFinite(targetInt) || targetInt <= 0) {
      setGoalErr('Vui lòng nhập tên mục tiêu và số tiền mục tiêu > 0.');
      return;
    }

    const linkedAcc = accounts.find((a) => a.id === linkedAccountId);
    setSavingGoal(true);
    try {
      if (editingGoal) {
        await onUpdateGoal(editingGoal.id, {
          name: name.trim(),
          targetAmount: targetInt,
          targetDate: targetDate || '',
          linkedAccountId: linkedAcc?.id || '',
          linkedAccountName: linkedAcc?.name || '',
          category,
          status,
          note,
        });
      } else {
        await onCreateGoal({
          name: name.trim(),
          targetAmount: targetInt,
          currentAmount: Math.max(0, initInt),
          targetDate: targetDate || undefined,
          linkedAccountId: linkedAcc?.id,
          linkedAccountName: linkedAcc?.name,
          category,
          note: note.trim() || undefined,
        });
      }
      resetForm();
    } catch (err) {
      setGoalErr(err instanceof Error ? err.message : 'Lưu mục tiêu tiết kiệm thất bại.');
    } finally {
      setSavingGoal(false);
    }
  };

  const openContribModal = (goal: SavingsGoal, type: 'deposit' | 'withdraw') => {
    setActiveContribGoal(goal);
    setContribType(type);
    setContribAmount('');
    setContribDate(todayIso);
    const defaultAccId = goal.linkedAccountId || accounts[0]?.id || '';
    setContribAccountId(defaultAccId);
    setLinkAccountBalance(Boolean(defaultAccId));
    setContribNote('');
    setContribErr(null);
  };

  const handleContribSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeContribGoal) return;
    setContribErr(null);

    const amtInt = toVndInt(Number(contribAmount));
    if (!Number.isFinite(amtInt) || amtInt <= 0) {
      setContribErr('Số tiền tích lũy / rút phải là số nguyên lớn hơn 0.');
      return;
    }
    if (contribType === 'withdraw' && amtInt > activeContribGoal.currentAmount) {
      setContribErr('Số tiền rút không được vượt quá số dư hiện tại của mục tiêu.');
      return;
    }

    const acc = accounts.find((a) => a.id === contribAccountId);
    setSubmittingContrib(true);
    try {
      await onRecordContribution({
        goalId: activeContribGoal.id,
        type: contribType,
        amount: amtInt,
        date: contribDate || todayIso,
        accountId: acc?.id,
        accountName: acc?.name,
        linkAccountBalance: Boolean(linkAccountBalance && acc),
        note: contribNote.trim() || undefined,
      });
      setActiveContribGoal(null);
    } catch (err) {
      setContribErr(err instanceof Error ? err.message : 'Thao tác tích lũy thất bại.');
    } finally {
      setSubmittingContrib(false);
    }
  };

  return (
    <div className="space-y-6 animate-fintech-in">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0B1437]">
          TIẾT KIỆM &amp; MỤC TIÊU TÍCH LŨY
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Theo dõi mục tiêu tài chính dài hạn, nhịp độ tích lũy mỗi tháng và lịch sử gửi / rút liên kết nguồn tiền
        </p>
      </div>

      {/* KPI Strip */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-2xl p-4 bg-gradient-to-br from-[#0B1437] to-blue-900 text-white shadow-md">
          <p className="text-xs font-semibold text-blue-200">Tổng đã tích lũy</p>
          <p className="text-2xl font-extrabold font-mono tabular-nums mt-1">
            {formatVND(summary.totalAccumulated)}
          </p>
          <p className="text-xs text-blue-200/80 mt-0.5 tabular-nums">
            Đạt {summary.overallPercent.toFixed(1)}% tổng mục tiêu
          </p>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
          <p className="text-xs font-semibold text-slate-500">Tổng mục tiêu đặt ra</p>
          <p className="text-2xl font-extrabold font-mono tabular-nums text-slate-900 mt-1">
            {formatVND(summary.totalTarget)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{goals.length} mục tiêu đang quản lý</p>
        </div>

        <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-4 shadow-xs">
          <p className="text-xs font-semibold text-emerald-800">Mục tiêu hoàn thành</p>
          <p className="text-2xl font-extrabold font-mono tabular-nums text-emerald-700 mt-1">
            {summary.completedCount} mục tiêu
          </p>
          <p className="text-xs text-emerald-700/80 mt-0.5">Đạt &ge;100% số tiền đề ra</p>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs">
          <p className="text-xs font-semibold text-slate-500">Đang tích lũy</p>
          <p className="text-2xl font-extrabold font-mono tabular-nums text-blue-700 mt-1">
            {summary.activeCount} mục tiêu
          </p>
          <p className="text-xs text-slate-500 mt-0.5">{contributions.length} lần ghi nhận giao dịch</p>
        </div>
      </section>

      {/* Create / Edit Goal + Goals Grid */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        <div className="xl:col-span-4 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                <PiggyBank className="w-4 h-4" />
              </div>
              <h2 className="font-display text-base font-bold text-slate-900">
                {editingGoal ? 'Chỉnh sửa mục tiêu' : 'Tạo mục tiêu tiết kiệm'}
              </h2>
            </div>
            {editingGoal && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Hủy sửa
              </button>
            )}
          </div>

          {goalErr && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
              {goalErr}
            </div>
          )}

          <form onSubmit={handleGoalSubmit} className="space-y-3.5">
            <div>
              <label htmlFor="sav-name" className="block text-xs font-semibold text-slate-700 mb-1">
                Tên mục tiêu *
              </label>
              <input
                id="sav-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Quỹ dự phòng 6 tháng, Mua Laptop mới..."
                className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sav-target" className="block text-xs font-semibold text-slate-700 mb-1">
                  Số tiền mục tiêu (VNĐ) *
                </label>
                <input
                  id="sav-target"
                  type="number"
                  min={1}
                  required
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                  className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                />
              </div>

              {!editingGoal ? (
                <div>
                  <label htmlFor="sav-init" className="block text-xs font-semibold text-slate-700 mb-1">
                    Số dư ban đầu (VNĐ)
                  </label>
                  <input
                    id="sav-init"
                    type="number"
                    min={0}
                    value={initialSaved}
                    onChange={(e) => setInitialSaved(e.target.value)}
                    className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                  />
                </div>
              ) : (
                <div>
                  <label htmlFor="sav-status" className="block text-xs font-semibold text-slate-700 mb-1">
                    Trạng thái
                  </label>
                  <select
                    id="sav-status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as SavingsGoalStatus)}
                    className="w-full h-9 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                  >
                    <option value="active">Đang tích lũy</option>
                    <option value="paused">Tạm dừng</option>
                    <option value="completed">Đã hoàn thành</option>
                  </select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="sav-cat" className="block text-xs font-semibold text-slate-700 mb-1">
                  Nhóm mục tiêu
                </label>
                <select
                  id="sav-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full h-9 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                >
                  {SAVINGS_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sav-date" className="block text-xs font-semibold text-slate-700 mb-1">
                  Hạn hoàn thành dự kiến
                </label>
                <input
                  id="sav-date"
                  type="date"
                  value={targetDate}
                  onChange={(e) => setTargetDate(e.target.value)}
                  className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                />
              </div>
            </div>

            <div>
              <label htmlFor="sav-acc" className="block text-xs font-semibold text-slate-700 mb-1">
                Tài khoản liên kết mặc định
              </label>
              <select
                id="sav-acc"
                value={linkedAccountId}
                onChange={(e) => setLinkedAccountId(e.target.value)}
                className="w-full h-9 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              >
                <option value="">Không gắn tài khoản cụ thể</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({formatVND(a.currentBalance)})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="sav-note" className="block text-xs font-semibold text-slate-700 mb-1">
                Ghi chú kế hoạch
              </label>
              <input
                id="sav-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ghi chú ngắn về kế hoạch tích lũy..."
                className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            <button
              type="submit"
              disabled={savingGoal}
              className="w-full inline-flex items-center justify-center gap-2 h-10 px-4 bg-gradient-to-r from-[#0B1437] to-blue-700 text-white text-sm font-semibold rounded-xl hover:opacity-95 shadow-md transition-all disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>
                {savingGoal
                  ? 'Đang lưu...'
                  : editingGoal
                  ? 'Lưu thay đổi mục tiêu'
                  : 'Tạo mục tiêu mới'}
              </span>
            </button>
          </form>
        </div>

        <div className="xl:col-span-8 space-y-4">
          {evaluatedGoals.length === 0 ? (
            <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-10 text-center space-y-2">
              <PiggyBank className="w-8 h-8 text-blue-600 mx-auto" />
              <p className="text-sm font-bold text-slate-800">
                Chưa có mục tiêu tiết kiệm nào
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Hãy tạo mục tiêu đầu tiên (ví dụ Quỹ dự phòng khẩn cấp hoặc Kế hoạch mua sắm) để theo dõi tiến độ tích lũy hàng tháng.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {evaluatedGoals.map(
                ({
                  goal,
                  percent,
                  remainingAmount,
                  isCompleted,
                  isOverdue,
                  monthlyPaceNeeded,
                }) => (
                  <div
                    key={goal.id}
                    className={`rounded-2xl border p-5 space-y-3 shadow-xs transition-shadow hover:shadow-md ${
                      isCompleted
                        ? 'bg-emerald-50/45 border-emerald-200'
                        : goal.status === 'paused'
                        ? 'bg-slate-50 border-slate-200 opacity-90'
                        : 'bg-white border-slate-200/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-display font-bold text-base text-slate-900 truncate">
                            {goal.name}
                          </h3>
                          {isCompleted && (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {goal.category || 'Tiết kiệm'}
                          {goal.linkedAccountName ? ` · TK: ${goal.linkedAccountName}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => startEdit(goal)}
                          aria-label={`Sửa mục tiêu ${goal.name}`}
                          className="p-1.5 rounded-lg text-slate-500 hover:text-blue-700 hover:bg-blue-50"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteGoal(goal)}
                          aria-label={`Xóa mục tiêu ${goal.name}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-lg font-extrabold font-mono tabular-nums text-slate-900">
                          {formatVND(goal.currentAmount)}
                        </span>
                        <span className="text-xs font-mono text-slate-500 tabular-nums">
                          Mục tiêu: {formatVND(goal.targetAmount)}
                        </span>
                      </div>
                      <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isCompleted
                              ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                              : 'bg-gradient-to-r from-blue-600 to-indigo-600'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                        <span className="font-bold text-blue-700">{percent.toFixed(1)}%</span>
                        <span className="text-slate-600">
                          {isCompleted
                            ? 'Đã đạt mục tiêu'
                            : `Còn thiếu ${formatVND(remainingAmount)}`}
                        </span>
                      </div>
                    </div>

                    {(goal.targetDate || monthlyPaceNeeded) && (
                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 text-xs flex flex-wrap items-center justify-between gap-2">
                        {goal.targetDate && (
                          <span
                            className={`inline-flex items-center gap-1 font-medium ${
                              isOverdue ? 'text-rose-700' : 'text-slate-600'
                            }`}
                          >
                            <Calendar className="w-3.5 h-3.5" />
                            <span>
                              Đích: {formatDateVN(goal.targetDate)}
                              {isOverdue ? ' (Quá hạn)' : ''}
                            </span>
                          </span>
                        )}
                        {monthlyPaceNeeded !== null && (
                          <span className="font-mono font-semibold text-blue-700 tabular-nums">
                            ~{formatVND(monthlyPaceNeeded)}/tháng
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => openContribModal(goal, 'deposit')}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors"
                      >
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                        <span>Gửi tích lũy</span>
                      </button>
                      <button
                        type="button"
                        disabled={goal.currentAmount <= 0}
                        onClick={() => openContribModal(goal, 'withdraw')}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-40"
                      >
                        <ArrowUpRight className="w-3.5 h-3.5" />
                        <span>Rút tiền</span>
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </section>

      {/* Accumulation History Table */}
      <section className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-base font-bold text-slate-900">
              Lịch sử gửi &amp; rút tích lũy
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Mọi biến động tích lũy đều được ghi nhận đồng bộ số dư với tài khoản liên kết (nếu chọn)
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-slate-600">
            {contributions.length} giao dịch
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Ngày</th>
                <th className="py-3 px-4">Mục tiêu tiết kiệm</th>
                <th className="py-3 px-4">Loại thao tác</th>
                <th className="py-3 px-4">Tài khoản liên kết</th>
                <th className="py-3 px-4 text-right">Số tiền</th>
                <th className="py-3 px-4">Ghi chú</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {pagedHistory.items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 px-4 text-center text-slate-400">
                    Chưa có lịch sử gửi hoặc rút tích lũy nào.
                  </td>
                </tr>
              ) : (
                pagedHistory.items.map((c) => (
                  <tr key={c.id} className="hover:bg-blue-50/35">
                    <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                      {formatDateVN(c.date)}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-900">{c.goalName}</td>
                    <td className="py-3 px-4 text-xs">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md font-bold ${
                          c.type === 'deposit'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {c.type === 'deposit' ? 'Gửi thêm' : 'Rút ra'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600">
                      {c.accountName || 'Không liên kết'}
                    </td>
                    <td
                      className={`py-3 px-4 text-right font-mono font-bold tabular-nums whitespace-nowrap ${
                        c.type === 'deposit' ? 'text-emerald-600' : 'text-rose-600'
                      }`}
                    >
                      {c.type === 'deposit' ? '+' : '-'}
                      {formatVND(c.amount)}
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500">{c.note || '—'}</td>
                  </tr>
                ))
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

      {/* Deposit / Withdraw Modal */}
      {activeContribGoal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Cập nhật tích lũy tiết kiệm"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  {contribType === 'deposit' ? 'Gửi tiền vào mục tiêu' : 'Rút tiền từ mục tiêu'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {activeContribGoal.name} · Hiện có{' '}
                  <strong className="font-mono text-slate-900">
                    {formatVND(activeContribGoal.currentAmount)}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveContribGoal(null)}
                aria-label="Đóng"
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {contribErr && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-medium">
                {contribErr}
              </div>
            )}

            <form onSubmit={handleContribSubmit} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="sc-amt" className="block text-xs font-semibold text-slate-700 mb-1">
                    Số tiền (VNĐ) *
                  </label>
                  <input
                    id="sc-amt"
                    type="number"
                    min={1}
                    required
                    value={contribAmount}
                    onChange={(e) => setContribAmount(e.target.value)}
                    className="w-full h-9 px-3 text-sm font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label htmlFor="sc-date" className="block text-xs font-semibold text-slate-700 mb-1">
                    Ngày thực hiện *
                  </label>
                  <input
                    id="sc-date"
                    type="date"
                    required
                    value={contribDate}
                    onChange={(e) => setContribDate(e.target.value)}
                    className="w-full h-9 px-3 text-sm font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              {accounts.length > 0 && (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={linkAccountBalance}
                      onChange={(e) => setLinkAccountBalance(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600"
                    />
                    <span>
                      {contribType === 'deposit'
                        ? 'Đồng thời trừ số dư từ tài khoản nguồn'
                        : 'Đồng thời cộng tiền rút về tài khoản'}
                    </span>
                  </label>

                  {linkAccountBalance && (
                    <select
                      aria-label="Chọn tài khoản liên kết"
                      value={contribAccountId}
                      onChange={(e) => setContribAccountId(e.target.value)}
                      className="w-full h-9 px-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl"
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} ({formatVND(a.currentBalance)})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="sc-note" className="block text-xs font-semibold text-slate-700 mb-1">
                  Ghi chú
                </label>
                <input
                  id="sc-note"
                  type="text"
                  value={contribNote}
                  onChange={(e) => setContribNote(e.target.value)}
                  placeholder="VD: Trích 20% lương tháng 11..."
                  className="w-full h-9 px-3 text-sm bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveContribGoal(null)}
                  className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={submittingContrib}
                  className={`px-4 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-50 ${
                    contribType === 'deposit'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  {submittingContrib
                    ? 'Đang xử lý...'
                    : contribType === 'deposit'
                    ? 'Xác nhận gửi'
                    : 'Xác nhận rút'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
