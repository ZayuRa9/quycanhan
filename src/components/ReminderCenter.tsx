import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  BellOff,
  Clock,
  Mail,
} from 'lucide-react';
import type { Transaction } from '../types/finance';
import {
  computeTransactionReminders,
  formatDateVN,
  formatVND,
} from '../utils/financeRules';

interface ReminderCenterProps {
  transactions: Transaction[];
  userEmail?: string;
  defaultLeadDays?: number;
  pushPermission: NotificationPermission | 'unsupported';
  pushEnabled: boolean;
  onTogglePush: () => void;
  onSelectTransaction?: (tx: Transaction) => void;
}

export const ReminderCenter: React.FC<ReminderCenterProps> = ({
  transactions,
  userEmail,
  defaultLeadDays = 3,
  pushPermission,
  pushEnabled,
  onTogglePush,
  onSelectTransaction,
}) => {
  const [leadDays, setLeadDays] = useState<number>(defaultLeadDays);
  React.useEffect(() => {
    setLeadDays(defaultLeadDays);
  }, [defaultLeadDays]);
  const todayIso = new Date().toISOString().slice(0, 10);

  const reminders = useMemo(
    () => computeTransactionReminders(transactions, todayIso, leadDays),
    [transactions, todayIso, leadDays]
  );

  const overdueCount = reminders.filter((r) => r.severity === 'overdue').length;
  const dueTodayCount = reminders.filter((r) => r.severity === 'due_today').length;
  const upcomingCount = reminders.filter((r) => r.severity === 'upcoming').length;

  const mailtoHref = useMemo(() => {
    if (reminders.length === 0) return '';
    const subject = encodeURIComponent(
      `[Sổ Quỹ Cá Nhân] Nhắc nhở ${reminders.length} giao dịch (${formatDateVN(todayIso)})`
    );
    const lines = reminders.map((r, idx) => {
      const kindLabel =
        r.transaction.kind === 'income'
          ? 'THU'
          : r.transaction.kind === 'transfer'
          ? 'CHUYỂN KHOẢN'
          : 'CHI';
      return `${idx + 1}. [${kindLabel}] ${r.transaction.code} — ${r.transaction.name}\n   Số tiền: ${formatVND(r.transaction.amount)} | ${r.message}`;
    });
    const body = encodeURIComponent(
      `Danh sách nhắc nhở giao dịch tính đến ngày ${formatDateVN(todayIso)}:\n\n${lines.join('\n\n')}`
    );
    const recipient = userEmail ? encodeURIComponent(userEmail) : '';
    return `mailto:${recipient}?subject=${subject}&body=${body}`;
  }, [reminders, todayIso, userEmail]);

  const hasUrgent = overdueCount > 0 || dueTodayCount > 0;

  return (
    <section
      aria-label="Hệ thống nhắc nhở giao dịch tự động"
      className={`rounded-2xl border p-4 sm:p-5 space-y-3 shadow-xs transition-colors ${
        hasUrgent
          ? 'bg-gradient-to-r from-amber-50/90 via-white to-rose-50/50 border-amber-200/90'
          : 'bg-white border-slate-200/80'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-xs ${
              hasUrgent
                ? 'bg-gradient-to-br from-amber-500 to-orange-600 text-white'
                : 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white'
            }`}
          >
            <Bell className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              Nhắc nhở giao dịch tự động
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              {reminders.length === 0
                ? `Không có khoản thu quá hạn hoặc giao dịch sắp đến hạn trong ${leadDays} ngày tới.`
                : `${overdueCount} quá hạn · ${dueTodayCount} đến hạn hôm nay · ${upcomingCount} sắp đến hạn`}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <label htmlFor="reminder-lead-days" className="sr-only">
            Số ngày nhắc trước hạn
          </label>
          <select
            id="reminder-lead-days"
            value={leadDays}
            onChange={(e) => setLeadDays(Number(e.target.value))}
            className="h-8 px-2.5 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value={1}>Nhắc trước 1 ngày</option>
            <option value={3}>Nhắc trước 3 ngày</option>
            <option value={7}>Nhắc trước 7 ngày</option>
            <option value={14}>Nhắc trước 14 ngày</option>
          </select>

          {pushPermission !== 'unsupported' && (
            <button
              type="button"
              onClick={onTogglePush}
              className={`h-8 inline-flex items-center gap-1.5 px-3 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap ${
                pushEnabled && pushPermission === 'granted'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {pushEnabled && pushPermission === 'granted' ? (
                <>
                  <Bell className="w-3.5 h-3.5 text-emerald-700" />
                  <span>Đang bật Push</span>
                </>
              ) : (
                <>
                  <BellOff className="w-3.5 h-3.5 text-slate-500" />
                  <span>
                    {pushPermission === 'denied'
                      ? 'Trình duyệt đã chặn thông báo'
                      : 'Bật thông báo đẩy'}
                  </span>
                </>
              )}
            </button>
          )}

          {reminders.length > 0 && (
            <a
              href={mailtoHref}
              className="h-8 inline-flex items-center gap-1.5 px-3 text-xs font-semibold rounded-lg bg-gradient-to-r from-[#0B1437] to-blue-700 text-white hover:opacity-95 transition-opacity whitespace-nowrap shadow-xs"
            >
              <Mail className="w-3.5 h-3.5" />
              <span>Gửi nhắc qua Email</span>
            </a>
          )}
        </div>
      </div>

      {reminders.length > 0 && (
        <div className="divide-y divide-slate-200/80 border border-slate-200/80 rounded-xl overflow-hidden bg-white">
          {reminders.map((item) => {
            const { transaction: tx, severity, message } = item;
            const isOverdue = severity === 'overdue';
            const isToday = severity === 'due_today';

            return (
              <div
                key={tx.id}
                className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs hover:bg-slate-50/70 transition-colors"
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  {isOverdue ? (
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  ) : (
                    <Clock
                      className={`w-4 h-4 shrink-0 mt-0.5 ${
                        isToday ? 'text-amber-600' : 'text-blue-600'
                      }`}
                    />
                  )}
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`font-bold ${
                          isOverdue
                            ? 'text-rose-700'
                            : isToday
                            ? 'text-amber-700'
                            : 'text-blue-700'
                        }`}
                      >
                        {isOverdue
                          ? 'Quá hạn'
                          : isToday
                          ? 'Đến hạn hôm nay'
                          : 'Sắp đến hạn'}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {tx.code}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="font-semibold text-slate-800 truncate">
                        {tx.name}
                      </span>
                    </div>
                    <p className="text-slate-500">
                      {message} · Tài khoản: {tx.accountName}
                      {tx.kind === 'transfer' && tx.toAccountName ? ` → ${tx.toAccountName}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <span
                    className={`font-mono font-bold tabular-nums ${
                      tx.kind === 'income'
                        ? 'text-emerald-700'
                        : tx.kind === 'transfer'
                        ? 'text-blue-700'
                        : 'text-rose-600'
                    }`}
                  >
                    {tx.kind === 'income' ? '+' : tx.kind === 'transfer' ? '⇄ ' : '-'}
                    {formatVND(tx.amount)}
                  </span>

                  {onSelectTransaction && (
                    <button
                      type="button"
                      onClick={() => onSelectTransaction(tx)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap"
                    >
                      <span>Xử lý ngay</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
