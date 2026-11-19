import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  X,
} from 'lucide-react';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_METHODS,
  INCOME_CATEGORIES,
  INCOME_METHODS,
  TRANSACTION_STATUSES,
  type CanonicalTransactionStatus,
  type DriveAttachment,
  type FinancialAccount,
  type Transaction,
  type TransactionKind,
} from '../types/finance';
import {
  buildDriveAttachmentName,
  getFileExtension,
  getYearMonthDot,
  isTransactionCancelled,
  validateTransactionStatusChange,
} from '../utils/financeRules';
import { resolveKeyboardShortcut } from '../utils/keyboardShortcuts';
import { DriveUploader, type QueuedUploadFile } from './DriveUploader';
import { getStatusMeta } from './StatusText';

interface QuickTransactionModalProps {
  open: boolean;
  onClose: () => void;
  accounts: FinancialAccount[];
  expenseCategories: string[];
  hasDriveToken: boolean;
  onReconnectDrive: () => void;
  onPeekCode: (kind: TransactionKind, dateForCode: string) => Promise<string>;
  onSaveNewTransaction: (params: {
    draft: Omit<
      Transaction,
      'id' | 'userId' | 'code' | 'auditHistory' | 'createdAt' | 'updatedAt'
    > & { dateForCode: string };
    queuedFiles: QueuedUploadFile[];
  }) => Promise<Transaction>;
}

export const QuickTransactionModal: React.FC<QuickTransactionModalProps> = ({
  open,
  onClose,
  accounts,
  expenseCategories,
  hasDriveToken,
  onReconnectDrive,
  onPeekCode,
  onSaveNewTransaction,
}) => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [kind, setKind] = useState<TransactionKind>('expense');
  const [previewCode, setPreviewCode] = useState<string>('...');
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>(
    expenseCategories[0] || EXPENSE_CATEGORIES[0]
  );
  const [method, setMethod] = useState<string>(EXPENSE_METHODS[0]);
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id || '');
  const [expectedDate, setExpectedDate] = useState(todayIso);
  const [actualDate, setActualDate] = useState('');
  const [status, setStatus] = useState<CanonicalTransactionStatus>('Dự kiến');
  const [markArchived, setMarkArchived] = useState(false);
  const [description, setDescription] = useState('');
  const [queuedFiles, setQueuedFiles] = useState<QueuedUploadFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Reset form cleanly whenever opened
  useEffect(() => {
    if (!open) return;
    const defaultKind: TransactionKind = 'expense';
    setKind(defaultKind);
    setName('');
    setAmount('');
    setCategory(expenseCategories[0] || EXPENSE_CATEGORIES[0]);
    setMethod(EXPENSE_METHODS[0]);
    setAccountId(accounts[0]?.id || '');
    setExpectedDate(todayIso);
    setActualDate('');
    setStatus('Dự kiến');
    setMarkArchived(false);
    setDescription('');
    setQueuedFiles([]);
    setFormError(null);

    const timer = window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [open, accounts, expenseCategories, todayIso]);

  // Refresh preview code when kind or expectedDate changes
  useEffect(() => {
    if (!open) return;
    let active = true;
    const dateRef = expectedDate || todayIso;
    onPeekCode(kind, dateRef)
      .then((code) => {
        if (active) setPreviewCode(code);
      })
      .catch(() => {
        if (active) {
          setPreviewCode(
            `${kind === 'income' ? 'KT' : 'KC'}-${getYearMonthDot(dateRef)}-01`
          );
        }
      });
    return () => {
      active = false;
    };
  }, [open, kind, expectedDate, onPeekCode, todayIso]);

  if (!open) return null;

  const isIncome = kind === 'income';
  const categoryOptions = isIncome
    ? [...INCOME_CATEGORIES]
    : expenseCategories.length > 0
    ? expenseCategories
    : [...EXPENSE_CATEGORIES];
  const methodOptions = isIncome ? [...INCOME_METHODS] : [...EXPENSE_METHODS];

  const handleSwitchKind = (nextKind: TransactionKind) => {
    setKind(nextKind);
    setCategory(
      nextKind === 'income'
        ? INCOME_CATEGORIES[0]
        : expenseCategories[0] || EXPENSE_CATEGORIES[0]
    );
    setMethod(nextKind === 'income' ? INCOME_METHODS[0] : EXPENSE_METHODS[0]);
    setFormError(null);
  };

  const handleAddQueuedFiles = (files: File[]) => {
    const existingKeys = new Set(
      queuedFiles.map((q) => `${q.file.name}:${q.file.size}`)
    );
    const deduped = files.filter((f) => !existingKeys.has(`${f.name}:${f.size}`));
    if (deduped.length < files.length) {
      throw new Error('Phát hiện tệp trùng lặp trong danh sách chờ tải lên.');
    }

    const baseCount = queuedFiles.length;
    const totalBatch = deduped.length;
    const wrapped: QueuedUploadFile[] = deduped.map((file, idx) => {
      const fullDefault = buildDriveAttachmentName(
        previewCode,
        file.name,
        baseCount + idx,
        totalBatch - idx
      );
      const ext = getFileExtension(file.name);
      const baseName =
        ext && fullDefault.endsWith(ext)
          ? fullDefault.slice(0, -ext.length)
          : fullDefault;
      return { file, customName: baseName };
    });
    setQueuedFiles((prev) => [...prev, ...wrapped]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (accounts.length === 0) {
      setFormError(
        'Bạn chưa có nguồn tiền nào. Vui lòng tạo tài khoản tại Thu & Chi -> Ngân sách hiện có.'
      );
      return;
    }

    const selectedAccount = accounts.find((a) => a.id === accountId);
    if (!selectedAccount) {
      setFormError('Vui lòng chọn tài khoản nhận / thanh toán hợp lệ.');
      return;
    }

    const numAmount = Number(amount);
    if (!name.trim() || !Number.isFinite(numAmount) || numAmount <= 0) {
      setFormError('Vui lòng nhập tên giao dịch và số tiền lớn hơn 0.');
      return;
    }

    const simulatedProofList: DriveAttachment[] = queuedFiles.map((q, idx) => ({
      id: `queued-${idx}`,
      name: q.customName || q.file.name,
      originalName: q.file.name,
      mimeType: q.file.type,
      size: q.file.size,
      sha256: '',
      webViewLink: '',
      driveFolderId: '',
      driveFolderPath: '',
      uploadedAt: '',
    }));

    const shouldArchive =
      !isTransactionCancelled(status) &&
      (markArchived || (!isIncome && status === 'Đã thực hiện'));

    const validation = validateTransactionStatusChange(
      kind,
      status,
      actualDate,
      simulatedProofList,
      accountId,
      shouldArchive
    );
    if (!validation.valid) {
      setFormError(validation.error || 'Chưa đủ điều kiện cập nhật trạng thái.');
      return;
    }

    if (queuedFiles.length > 0 && !hasDriveToken) {
      setFormError(
        'Bạn có tệp chứng từ chờ tải lên nhưng chưa kết nối Google Drive. Vui lòng kết nối Google Drive trước khi lưu.'
      );
      return;
    }

    setSubmitting(true);
    try {
      await onSaveNewTransaction({
        draft: {
          kind,
          name: name.trim(),
          amount: numAmount,
          category,
          method,
          accountId: selectedAccount.id,
          accountName: selectedAccount.name,
          description: description.trim() || undefined,
          expectedDate: expectedDate || todayIso,
          actualDate: actualDate || undefined,
          status,
          isArchived: shouldArchive,
          attachments: [],
          dateForCode: expectedDate || todayIso,
        },
        queuedFiles,
      });
      onClose();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Lưu giao dịch thất bại.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleModalKeyDown = (e: React.KeyboardEvent) => {
    const action = resolveKeyboardShortcut({
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      metaKey: e.metaKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
      repeat: e.repeat,
      isEditable: true,
      modalState: 'quick_transaction',
    });
    if (action?.type === 'submit_modal') {
      e.preventDefault();
      formRef.current?.requestSubmit();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-tx-modal-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleModalKeyDown}
        className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div
          className={`px-6 py-4 text-white flex items-center justify-between gap-3 ${
            isIncome
              ? 'bg-gradient-to-r from-emerald-600 to-teal-600'
              : 'bg-gradient-to-r from-rose-600 to-orange-500'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              {isIncome ? (
                <ArrowDownLeft className="w-4 h-4" />
              ) : (
                <ArrowUpRight className="w-4 h-4" />
              )}
            </div>
            <div>
              <h2 id="quick-tx-modal-title" className="font-display text-base font-bold">
                Tạo nhanh giao dịch ({previewCode})
              </h2>
              <p className="text-xs text-white/85">
                Phím tắt: N để mở · Ctrl/⌘+Enter để lưu · Esc để đóng
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng modal tạo giao dịch"
            className="p-1.5 rounded-lg text-white/90 hover:bg-white/15 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="p-6 space-y-4 overflow-y-auto"
        >
          {/* Kind Switcher */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="inline-flex p-1 bg-slate-100 rounded-xl">
              <button
                type="button"
                onClick={() => handleSwitchKind('expense')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
                  !isIncome
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>Khoản chi (KC)</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchKind('income')}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all whitespace-nowrap ${
                  isIncome
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ArrowDownLeft className="w-3.5 h-3.5" />
                <span>Khoản thu (KT)</span>
              </button>
            </div>

            <span className="text-xs font-mono font-bold text-slate-600">
              Mã dự kiến: {previewCode}
            </span>
          </div>

          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-medium text-rose-800"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{formError}</span>
            </div>
          )}

          {/* Row 1: Name & Amount */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-7">
              <label
                htmlFor="quick-tx-name"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {isIncome ? 'Tên khoản thu *' : 'Tên khoản chi *'}
              </label>
              <input
                ref={nameInputRef}
                id="quick-tx-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={isIncome ? 'VD: Lương tháng 11' : 'VD: Tiền điện tháng 11'}
                className="w-full h-10 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            <div className="sm:col-span-5">
              <label
                htmlFor="quick-tx-amount"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Số tiền (VNĐ) *
              </label>
              <input
                id="quick-tx-amount"
                type="number"
                min={1}
                step="1000"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500000"
                className="w-full h-10 px-3 text-sm font-mono tabular-nums bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>
          </div>

          {/* Row 2: Category, Account, Method */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="quick-tx-category"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {isIncome ? 'Loại thu *' : 'Danh mục chi tiêu *'}
              </label>
              <select
                id="quick-tx-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full h-10 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              >
                {categoryOptions.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="quick-tx-account"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {isIncome ? 'Tài khoản nhận *' : 'Nguồn tiền chi *'}
              </label>
              <select
                id="quick-tx-account"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full h-10 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              >
                {accounts.length === 0 ? (
                  <option value="">Chưa có tài khoản</option>
                ) : (
                  accounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label
                htmlFor="quick-tx-method"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Hình thức
              </label>
              <select
                id="quick-tx-method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full h-10 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              >
                {methodOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 3: Expected Date, Actual Date, Note */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="quick-tx-expected-date"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {isIncome ? 'Ngày dự kiến nhận' : 'Ngày dự kiến chi'}
              </label>
              <input
                id="quick-tx-expected-date"
                type="date"
                value={expectedDate}
                onChange={(e) => setExpectedDate(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            <div>
              <label
                htmlFor="quick-tx-actual-date"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {isIncome ? 'Ngày thực nhận' : 'Ngày chính thức chi'}
              </label>
              <input
                id="quick-tx-actual-date"
                type="date"
                value={actualDate}
                onChange={(e) => setActualDate(e.target.value)}
                className="w-full h-10 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            <div>
              <label
                htmlFor="quick-tx-note"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Ghi chú nhanh
              </label>
              <input
                id="quick-tx-note"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ghi chú ngắn (tùy chọn)"
                className="w-full h-10 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>
          </div>

          {/* Row 4: 3 Status Color Options + Archive Checkbox */}
          <div className="space-y-2">
            <span className="block text-xs font-semibold text-slate-700">
              Trạng thái giao dịch *
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {TRANSACTION_STATUSES.map((st) => {
                const meta = getStatusMeta(st);
                const selected = status === st;
                return (
                  <label
                    key={st}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                      selected ? meta.activeButtonClass : meta.idleButtonClass
                    }`}
                  >
                    <input
                      type="radio"
                      name="quick-tx-status"
                      value={st}
                      checked={selected}
                      onChange={() => setStatus(st)}
                      className="sr-only"
                    />
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        selected ? 'bg-white' : meta.dotClass
                      }`}
                    />
                    <span>{st}</span>
                  </label>
                );
              })}
            </div>

            {status !== 'Đã hủy' && (
              <label className="inline-flex items-center gap-2 text-xs text-slate-600 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={markArchived}
                  onChange={(e) => setMarkArchived(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                <span>Chuyển vào Lưu trữ sau khi hoàn tất (cần chứng từ)</span>
              </label>
            )}
          </div>

          {/* Drive Uploader when attaching proof */}
          <DriveUploader
            txCode={previewCode}
            isoDate={actualDate || expectedDate || todayIso}
            attachments={[]}
            queuedFiles={queuedFiles}
            hasDriveToken={hasDriveToken}
            onReconnectDrive={onReconnectDrive}
            onAddQueuedFiles={handleAddQueuedFiles}
            onRenameQueuedFile={(idx, customName) =>
              setQueuedFiles((prev) =>
                prev.map((q, i) => (i === idx ? { ...q, customName } : q))
              )
            }
            onRemoveQueuedFile={(idx) =>
              setQueuedFiles((prev) => prev.filter((_, i) => i !== idx))
            }
            onRemoveAttachment={() => {}}
          />

          {/* Footer Buttons */}
          <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors whitespace-nowrap"
            >
              Hủy (Esc)
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={`inline-flex items-center gap-2 px-5 py-2 text-sm font-bold text-white rounded-xl shadow-md transition-all whitespace-nowrap disabled:opacity-50 ${
                isIncome
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                  : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
              }`}
            >
              <Plus className="w-4 h-4" />
              <span>{submitting ? 'Đang lưu...' : 'Lưu giao dịch'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
