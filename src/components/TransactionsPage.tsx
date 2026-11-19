import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Edit3,
  ExternalLink,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  FileUp,
  Landmark,
  ListTodo,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  SlidersHorizontal,
  Tag,
  Trash2,
  User,
  Wallet,
  X,
} from 'lucide-react';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_METHODS,
  INCOME_CATEGORIES,
  INCOME_METHODS,
  TRANSACTION_STATUSES,
  type AccountType,
  type BudgetLimit,
  type BudgetScopeType,
  type CanonicalTransactionStatus,
  type DriveAttachment,
  type FinancialAccount,
  type Transaction,
  type TransactionKind,
  type TransactionStatus,
} from '../types/finance';
import {
  addExpenseCategory,
  buildDriveAttachmentName,
  evaluateBudget,
  formatDateVN,
  formatVND,
  getEffectiveTransactionAmount,
  getFileExtension,
  getYearMonthDot,
  isExpenseRealized,
  isIncomeRealized,
  isTransactionCancelled,
  normalizeTransactionStatus,
  removeExpenseCategory,
  validateTransactionStatusChange,
} from '../utils/financeRules';
import {
  downloadSingleSheetTemplate,
  parseSingleSheetWorkbook,
  type SingleSheetParseResult,
} from '../utils/excelTemplate';
import { DriveUploader, type QueuedUploadFile } from './DriveUploader';
import { AccountsAndBudgetsSection } from './AccountsAndBudgetsSection';
import { getStatusMeta, StatusText } from './StatusText';

export type TransactionsSubTab = 'income' | 'expense' | 'budgets';

interface TransactionsPageProps {
  accounts: FinancialAccount[];
  transactions: Transaction[];
  budgets: BudgetLimit[];
  expenseCategories: string[];
  onUpdateExpenseCategories: (nextCategories: string[]) => Promise<void>;
  hasDriveToken: boolean;
  userEmail?: string;
  pushPermission: NotificationPermission | 'unsupported';
  pushEnabled: boolean;
  onTogglePush: () => void;
  onReconnectDrive: () => void;
  onPeekCode: (kind: TransactionKind, dateForCode: string) => Promise<string>;
  onSaveNewTransaction: (params: {
    draft: Omit<
      Transaction,
      'id' | 'userId' | 'code' | 'auditHistory' | 'createdAt' | 'updatedAt'
    > & { dateForCode: string };
    queuedFiles: QueuedUploadFile[];
  }) => Promise<Transaction>;
  onUpdateTransaction: (params: {
    existingTx: Transaction;
    updates: Partial<Omit<Transaction, 'id' | 'userId' | 'code' | 'kind' | 'createdAt'>>;
    queuedFiles: QueuedUploadFile[];
    actionNote?: string;
  }) => Promise<void>;
  onCreateAccount: (input: {
    type: AccountType;
    name: string;
    bankName?: string;
    accountNumber?: string;
    initialBalance: number;
  }) => Promise<unknown>;
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
  onCreateCalendarReminder: (tx: Transaction) => Promise<void>;
  onCreateTaskItem: (tx: Transaction) => Promise<void>;
  onImportSingleSheetExcel: (parsed: SingleSheetParseResult) => Promise<{
    accountsCreated: number;
    budgetsCreated: number;
    incomesCreated: number;
    expensesCreated: number;
  }>;
}

export const TransactionsPage: React.FC<TransactionsPageProps> = ({
  accounts,
  transactions,
  budgets,
  expenseCategories,
  onUpdateExpenseCategories,
  hasDriveToken,
  onReconnectDrive,
  onPeekCode,
  onSaveNewTransaction,
  onUpdateTransaction,
  onCreateAccount,
  onUpdateAccount,
  onReconcileAccount,
  onCreateBudget,
  onDeleteBudget,
  onCreateCalendarReminder,
  onCreateTaskItem,
  onImportSingleSheetExcel,
}) => {
  const [subTab, setSubTab] = useState<TransactionsSubTab>('expense');
  const todayIso = new Date().toISOString().slice(0, 10);

  // Shared Form State (switches cleanly between Income and Expense)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [previewCode, setPreviewCode] = useState<string>('...');
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [actualAmount, setActualAmount] = useState('');
  const [remainingAmount, setRemainingAmount] = useState('');
  const [category, setCategory] = useState<string>(expenseCategories[0] || EXPENSE_CATEGORIES[0]);
  const [method, setMethod] = useState<string>(EXPENSE_METHODS[0]);
  const [accountId, setAccountId] = useState<string>('');
  const [counterparty, setCounterparty] = useState('');
  const [reason, setReason] = useState('');
  const [purposeTag, setPurposeTag] = useState('');
  const [workDuration, setWorkDuration] = useState('');
  const [description, setDescription] = useState('');
  const [expectedDate, setExpectedDate] = useState(todayIso);
  const [actualDate, setActualDate] = useState('');
  const [status, setStatus] = useState<CanonicalTransactionStatus>('Dự kiến');
  const [markArchived, setMarkArchived] = useState(false);
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);

  // Expense Category Add/Remove Inline Manager State
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryMsg, setCategoryMsg] = useState<{
    type: 'error' | 'success';
    text: string;
  } | null>(null);
  const [savingCategories, setSavingCategories] = useState(false);

  const [attachments, setAttachments] = useState<DriveAttachment[]>([]);
  const [queuedFiles, setQueuedFiles] = useState<QueuedUploadFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [workspaceActionMsg, setWorkspaceActionMsg] = useState<string | null>(null);

  // Single-Sheet Excel Import State
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [importPreview, setImportPreview] = useState<{
    fileName: string;
    parsed: SingleSheetParseResult;
  } | null>(null);
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const [excelNotice, setExcelNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const activeKind: TransactionKind = subTab === 'income' ? 'income' : 'expense';
  const activeCode = editingTx ? editingTx.code : previewCode;
  const isIncomeTab = activeKind === 'income';

  // Ensure default account selection when accounts load
  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      setAccountId(accounts[0].id);
    }
  }, [accounts, accountId]);

  // Refresh preview code when kind or expectedDate month changes (for new entries)
  useEffect(() => {
    if (subTab === 'budgets' || editingTx) return;
    let active = true;
    const dateRef = expectedDate || todayIso;
    onPeekCode(activeKind, dateRef)
      .then((code) => {
        if (active) setPreviewCode(code);
      })
      .catch(() => {
        if (active) setPreviewCode(`${activeKind === 'income' ? 'KT' : 'KC'}-${getYearMonthDot(dateRef)}-01`);
      });
    return () => {
      active = false;
    };
  }, [subTab, activeKind, expectedDate, editingTx, onPeekCode, todayIso, transactions.length]);

  const budgetEvaluations = useMemo(
    () => budgets.map((b) => evaluateBudget(b, transactions)),
    [budgets, transactions]
  );

  const budgetAlerts = useMemo(
    () => budgetEvaluations.filter((ev) => ev.alertLevel !== 'ok'),
    [budgetEvaluations]
  );

  const activeIncomes = useMemo(
    () => transactions.filter((t) => t.kind === 'income' && !t.isArchived),
    [transactions]
  );

  const activeExpenses = useMemo(
    () => transactions.filter((t) => t.kind === 'expense' && !t.isArchived),
    [transactions]
  );

  const resetFormForKind = (kind: TransactionKind) => {
    setEditingTx(null);
    setName('');
    setSource('');
    setAmount('');
    setActualAmount('');
    setRemainingAmount('');
    setCategory(
      kind === 'income'
        ? INCOME_CATEGORIES[0]
        : expenseCategories[0] || EXPENSE_CATEGORIES[0]
    );
    setMethod(kind === 'income' ? INCOME_METHODS[0] : EXPENSE_METHODS[0]);
    setAccountId(accounts[0]?.id || '');
    setCounterparty('');
    setReason('');
    setPurposeTag('');
    setWorkDuration('');
    setDescription('');
    setExpectedDate(todayIso);
    setActualDate('');
    setStatus('Dự kiến');
    setMarkArchived(false);
    setShowAdvancedFields(false);
    setAttachments([]);
    setQueuedFiles([]);
    setFormError(null);
  };

  const handleSwitchSubTab = (tab: TransactionsSubTab) => {
    setSubTab(tab);
    setFormSuccess(null);
    setWorkspaceActionMsg(null);
    setShowCategoryManager(false);
    if (tab === 'income') {
      resetFormForKind('income');
    } else if (tab === 'expense') {
      resetFormForKind('expense');
    }
  };

  const startEditing = (tx: Transaction) => {
    setSubTab(tx.kind);
    setEditingTx(tx);
    setPreviewCode(tx.code);
    setName(tx.name);
    setSource(tx.source || '');
    setAmount(String(tx.amount));
    setActualAmount(typeof tx.actualAmount === 'number' ? String(tx.actualAmount) : '');
    setRemainingAmount(
      typeof tx.remainingAmount === 'number' ? String(tx.remainingAmount) : ''
    );
    setCategory(tx.category);
    setMethod(tx.method);
    setAccountId(tx.accountId);
    setCounterparty(tx.counterparty || '');
    setReason(tx.reason || '');
    setPurposeTag(tx.purposeTag || '');
    setWorkDuration(tx.workDuration || '');
    setDescription(tx.description || '');
    setExpectedDate(tx.expectedDate || todayIso);
    setActualDate(tx.actualDate || '');
    setStatus(normalizeTransactionStatus(tx.status));
    setMarkArchived(tx.isArchived);
    setShowAdvancedFields(
      Boolean(
        tx.actualAmount ||
          tx.remainingAmount ||
          tx.source ||
          tx.reason ||
          tx.purposeTag ||
          tx.counterparty ||
          tx.workDuration ||
          tx.description
      )
    );
    setAttachments(tx.attachments || []);
    setQueuedFiles([]);
    setFormError(null);
    setFormSuccess(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAddCategory = async () => {
    setCategoryMsg(null);
    const res = addExpenseCategory(expenseCategories, newCategoryName);
    if (res.error || !res.added) {
      setCategoryMsg({
        type: 'error',
        text: res.error || 'Không thể thêm danh mục.',
      });
      return;
    }
    setSavingCategories(true);
    try {
      await onUpdateExpenseCategories(res.next);
      setCategory(res.added);
      setNewCategoryName('');
      setCategoryMsg({
        type: 'success',
        text: `Đã thêm danh mục "${res.added}".`,
      });
    } catch (err) {
      setCategoryMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Lỗi lưu danh mục mới.',
      });
    } finally {
      setSavingCategories(false);
    }
  };

  const handleRemoveCategory = async (target: string) => {
    setCategoryMsg(null);
    const res = removeExpenseCategory(expenseCategories, target);
    if (res.error) {
      setCategoryMsg({ type: 'error', text: res.error });
      return;
    }
    setSavingCategories(true);
    try {
      await onUpdateExpenseCategories(res.next);
      if (category === target && res.next.length > 0) {
        setCategory(res.next[0]);
      }
      setCategoryMsg({
        type: 'success',
        text: `Đã xóa danh mục "${target}".`,
      });
    } catch (err) {
      setCategoryMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Lỗi xóa danh mục.',
      });
    } finally {
      setSavingCategories(false);
    }
  };

  const handleRestoreDefaultCategories = async () => {
    setCategoryMsg(null);
    setSavingCategories(true);
    try {
      const defaults = [...EXPENSE_CATEGORIES];
      await onUpdateExpenseCategories(defaults);
      if (!defaults.includes(category as (typeof EXPENSE_CATEGORIES)[number])) {
        setCategory(defaults[0]);
      }
      setCategoryMsg({
        type: 'success',
        text: 'Đã khôi phục danh sách danh mục chi tiêu mặc định.',
      });
    } catch (err) {
      setCategoryMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Lỗi khôi phục danh mục.',
      });
    } finally {
      setSavingCategories(false);
    }
  };

  const handleAddQueuedFiles = (files: File[]) => {
    const existingKeys = new Set(queuedFiles.map((q) => `${q.file.name}:${q.file.size}`));
    const deduped = files.filter((f) => !existingKeys.has(`${f.name}:${f.size}`));
    if (deduped.length < files.length) {
      throw new Error('Phát hiện tệp trùng lặp trong danh sách chờ tải lên.');
    }

    const baseCount = attachments.length + queuedFiles.length;
    const totalBatch = deduped.length;
    const wrapped: QueuedUploadFile[] = deduped.map((file, idx) => {
      const fullDefault = buildDriveAttachmentName(
        activeCode,
        file.name,
        baseCount + idx,
        totalBatch - idx
      );
      const ext = getFileExtension(file.name);
      const baseName = ext && fullDefault.endsWith(ext)
        ? fullDefault.slice(0, -ext.length)
        : fullDefault;
      return {
        file,
        customName: baseName,
      };
    });
    setQueuedFiles((prev) => [...prev, ...wrapped]);
  };

  const handleRenameQueuedFile = (index: number, customName: string) => {
    setQueuedFiles((prev) =>
      prev.map((item, idx) => (idx === index ? { ...item, customName } : item))
    );
  };

  const handleRemoveQueuedFile = (index: number) => {
    setQueuedFiles((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleSelectExcelFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setExcelNotice(null);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseSingleSheetWorkbook(buffer);
      setImportPreview({ fileName: file.name, parsed });
    } catch (err) {
      setExcelNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Không đọc được tệp Excel.',
      });
    } finally {
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  const handleConfirmExcelImport = async () => {
    if (!importPreview) return;
    setIsImportingExcel(true);
    setExcelNotice(null);
    try {
      const stats = await onImportSingleSheetExcel(importPreview.parsed);
      setImportPreview(null);
      setExcelNotice({
        type: 'success',
        message: `Đã nhập thành công từ "${importPreview.fileName}": ${stats.accountsCreated} tài khoản, ${stats.incomesCreated} khoản thu, ${stats.expensesCreated} khoản chi, ${stats.budgetsCreated} hạn mức ngân sách.`,
      });
    } catch (err) {
      setExcelNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Nhập dữ liệu từ Excel thất bại.',
      });
    } finally {
      setIsImportingExcel(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (accounts.length === 0) {
      setFormError(
        'Bạn chưa có tài khoản hoặc quỹ tiền nào. Vui lòng tạo nguồn tiền tại mục NGÂN SÁCH HIỆN CÓ trước.'
      );
      return;
    }

    const selectedAccount = accounts.find((a) => a.id === accountId);
    if (!selectedAccount) {
      setFormError('Vui lòng chọn tài khoản nhận / thanh toán hợp lệ.');
      return;
    }

    const numAmount = Number(amount);
    if (!name.trim() || !Number.isFinite(numAmount) || numAmount < 0) {
      setFormError('Vui lòng nhập tên giao dịch và số tiền hợp lệ.');
      return;
    }

    const totalProofCount = attachments.length + queuedFiles.length;
    const simulatedProofList: DriveAttachment[] = [
      ...attachments,
      ...queuedFiles.map((q, idx) => ({
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
      })),
    ];

    const shouldArchive =
      !isTransactionCancelled(status) &&
      (markArchived || (activeKind === 'expense' && status === 'Đã thực hiện'));

    const validation = validateTransactionStatusChange(
      activeKind,
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
        'Bạn có tệp chứng từ chờ tải lên nhưng chưa kết nối Google Drive. Vui lòng nhấn "Kết nối Google Drive" trước khi lưu.'
      );
      return;
    }

    if (totalProofCount === 0 && shouldArchive) {
      setFormError('Cần ít nhất 1 chứng từ trên Google Drive trước khi chuyển vào Lưu trữ.');
      return;
    }

    const parsedActualAmount =
      actualAmount.trim() !== '' ? Number(actualAmount) : undefined;
    const parsedRemaining =
      remainingAmount.trim() !== '' ? Number(remainingAmount) : undefined;

    setSubmitting(true);
    try {
      if (editingTx) {
        await onUpdateTransaction({
          existingTx: editingTx,
          updates: {
            name: name.trim(),
            source: source.trim() || undefined,
            amount: numAmount,
            actualAmount: parsedActualAmount,
            remainingAmount: parsedRemaining,
            category,
            method,
            accountId: selectedAccount.id,
            accountName: selectedAccount.name,
            counterparty: counterparty.trim() || undefined,
            reason: reason.trim() || undefined,
            purposeTag: purposeTag.trim() || undefined,
            workDuration: workDuration.trim() || undefined,
            description: description.trim() || undefined,
            expectedDate,
            actualDate: actualDate || undefined,
            status,
            isArchived: shouldArchive,
            attachments,
          },
          queuedFiles,
          actionNote: shouldArchive
            ? 'Hoàn thành & chuyển vào Lưu trữ'
            : 'Cập nhật thông tin giao dịch',
        });
        setFormSuccess(
          shouldArchive
            ? `Đã hoàn thành giao dịch ${editingTx.code} và chuyển vào Lưu trữ.`
            : `Đã cập nhật giao dịch ${editingTx.code}.`
        );
        resetFormForKind(activeKind);
      } else {
        const created = await onSaveNewTransaction({
          draft: {
            kind: activeKind,
            name: name.trim(),
            source: source.trim() || undefined,
            amount: numAmount,
            actualAmount: parsedActualAmount,
            remainingAmount: parsedRemaining,
            category,
            method,
            accountId: selectedAccount.id,
            accountName: selectedAccount.name,
            counterparty: counterparty.trim() || undefined,
            reason: reason.trim() || undefined,
            purposeTag: purposeTag.trim() || undefined,
            workDuration: workDuration.trim() || undefined,
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
        setFormSuccess(
          shouldArchive
            ? `Đã tạo ${created.code}, tải chứng từ lên Google Drive và chuyển vào Lưu trữ.`
            : `Đã tạo giao dịch ${created.code} thành công.`
        );
        resetFormForKind(activeKind);
      }
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Không thể lưu giao dịch. Vui lòng thử lại.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickArchive = async (tx: Transaction) => {
    setFormError(null);
    const targetStatus: TransactionStatus = 'Đã thực hiện';

    const validation = validateTransactionStatusChange(
      tx.kind,
      targetStatus,
      tx.actualDate,
      tx.attachments,
      tx.accountId,
      true
    );
    if (!validation.valid) {
      startEditing(tx);
      setStatus(targetStatus);
      setMarkArchived(true);
      setFormError(
        validation.error ||
          'Vui lòng bổ sung ngày thực tế và tải chứng từ lên Google Drive trước khi chuyển vào Lưu trữ.'
      );
      return;
    }

    try {
      await onUpdateTransaction({
        existingTx: tx,
        updates: {
          status: targetStatus,
          isArchived: true,
        },
        queuedFiles: [],
        actionNote: 'Xác nhận đã thực hiện & chuyển vào Lưu trữ',
      });
      setFormSuccess(`Đã chuyển giao dịch ${tx.code} vào Lưu trữ.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Lỗi chuyển lưu trữ.');
    }
  };

  const activeList = activeKind === 'income' ? activeIncomes : activeExpenses;

  const activeStatusCounts = useMemo(() => {
    const counts: Record<CanonicalTransactionStatus, number> = {
      'Dự kiến': 0,
      'Đã thực hiện': 0,
      'Đã hủy': 0,
    };
    for (const tx of activeList) {
      counts[normalizeTransactionStatus(tx.status)] += 1;
    }
    return counts;
  }, [activeList]);

  const totalParsedImportItems = importPreview
    ? importPreview.parsed.accounts.length +
      importPreview.parsed.incomes.length +
      importPreview.parsed.expenses.length +
      importPreview.parsed.budgets.length
    : 0;

  return (
    <div className="space-y-6 animate-fintech-in">
      {/* Header & Single-Sheet Excel Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0B1437]">
            QUẢN LÝ THU &amp; CHI
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Tạo mới, cập nhật giao dịch, nhập Excel 1 sheet &amp; quản lý ngân sách tài khoản
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={downloadSingleSheetTemplate}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200/90 text-slate-700 text-xs sm:text-sm font-semibold rounded-xl hover:bg-slate-50 shadow-xs transition-all whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Tải mẫu Excel (1 Sheet)</span>
          </button>

          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleSelectExcelFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => excelInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#0B1437] text-white text-xs sm:text-sm font-semibold rounded-xl hover:bg-blue-900 shadow-xs transition-all whitespace-nowrap"
          >
            <FileUp className="w-4 h-4" />
            <span>Nhập từ Excel</span>
          </button>
        </div>
      </div>

      {/* Prominent 3-Area Tab Navigation: THU (Emerald) | CHI (Coral) | NGÂN SÁCH HIỆN CÓ (Cobalt+Violet) */}
      <div
        role="tablist"
        aria-label="Khu vực Thu, Chi và Ngân sách"
        className="grid grid-cols-1 sm:grid-cols-3 gap-3"
      >
        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'income'}
          onClick={() => handleSwitchSubTab('income')}
          className={`flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border text-left transition-all ${
            subTab === 'income'
              ? 'bg-gradient-to-r from-emerald-600 to-teal-600 border-emerald-600 text-white shadow-lg shadow-emerald-600/20'
              : 'bg-white border-slate-200/90 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/40'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                subTab === 'income'
                  ? 'bg-white/20 text-white'
                  : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              <ArrowDownLeft className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="font-display font-bold text-sm block whitespace-nowrap">
                THU ({activeIncomes.length})
              </span>
              <span
                className={`text-xs block truncate ${
                  subTab === 'income' ? 'text-emerald-100' : 'text-slate-500'
                }`}
              >
                Ghi nhận tiền thu &amp; đối soát
              </span>
            </div>
          </div>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'expense'}
          onClick={() => handleSwitchSubTab('expense')}
          className={`flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border text-left transition-all ${
            subTab === 'expense'
              ? 'bg-gradient-to-r from-rose-600 to-orange-500 border-rose-600 text-white shadow-lg shadow-rose-600/20'
              : 'bg-white border-slate-200/90 text-slate-700 hover:border-rose-300 hover:bg-rose-50/40'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                subTab === 'expense'
                  ? 'bg-white/20 text-white'
                  : 'bg-rose-100 text-rose-600'
              }`}
            >
              <ArrowUpRight className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="font-display font-bold text-sm block whitespace-nowrap">
                CHI ({activeExpenses.length})
              </span>
              <span
                className={`text-xs block truncate ${
                  subTab === 'expense' ? 'text-rose-100' : 'text-slate-500'
                }`}
              >
                Lập khoản chi &amp; chứng từ hóa đơn
              </span>
            </div>
          </div>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={subTab === 'budgets'}
          onClick={() => handleSwitchSubTab('budgets')}
          className={`flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border text-left transition-all ${
            subTab === 'budgets'
              ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 border-blue-600 text-white shadow-lg shadow-blue-600/20'
              : 'bg-white border-slate-200/90 text-slate-700 hover:border-blue-300 hover:bg-blue-50/40'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                subTab === 'budgets'
                  ? 'bg-white/20 text-white'
                  : 'bg-blue-100 text-blue-700'
              }`}
            >
              <Wallet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="font-display font-bold text-sm block whitespace-nowrap">
                NGÂN SÁCH HIỆN CÓ ({accounts.length})
              </span>
              <span
                className={`text-xs block truncate ${
                  subTab === 'budgets' ? 'text-blue-100' : 'text-slate-500'
                }`}
              >
                Nguồn tiền, sao kê &amp; hạn mức chi
              </span>
            </div>
          </div>
        </button>
      </div>

      {excelNotice && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-xs font-semibold ${
            excelNotice.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-700'
          }`}
        >
          <span>{excelNotice.message}</span>
          <button
            type="button"
            onClick={() => setExcelNotice(null)}
            aria-label="Đóng thông báo"
            className="p-1 hover:bg-black/5 rounded"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Budget Threshold Warnings Banner (80% & 100%) */}
      {budgetAlerts.length > 0 && (
        <div
          role="status"
          className="bg-gradient-to-r from-amber-50 to-orange-50/60 border border-amber-200/90 rounded-2xl p-4 space-y-2 shadow-xs"
        >
          <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Cảnh báo hạn mức chi tiêu (80% · 100%)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {budgetAlerts.map((ev) => (
              <div
                key={ev.budget.id}
                className="flex items-center justify-between gap-3 text-xs bg-white border border-amber-200/80 rounded-xl px-3.5 py-2.5"
              >
                <span className="font-semibold text-slate-800 truncate">
                  {ev.budget.name} ({ev.budget.scopeValue})
                </span>
                <span
                  className={`font-mono font-bold shrink-0 flex items-center gap-1 ${
                    ev.alertLevel === 'over_100' ? 'text-rose-600' : 'text-amber-700'
                  }`}
                >
                  {ev.alertLevel === 'over_100' && (
                    <ShieldAlert className="w-3.5 h-3.5" />
                  )}
                  {ev.percent.toFixed(1)}% ({formatVND(ev.spent)} /{' '}
                  {formatVND(ev.budget.limitAmount)})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Compact Budget Progress Strip in Expense Tab */}
      {subTab === 'expense' && budgetEvaluations.length > 0 && (
        <section
          aria-label="Tiến trình ngân sách chi tiêu"
          className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-5 shadow-xs space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-bold text-slate-900">
              Tiến trình sử dụng ngân sách chi tiêu
            </h2>
            <button
              type="button"
              onClick={() => handleSwitchSubTab('budgets')}
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline"
            >
              Quản lý hạn mức
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {budgetEvaluations.map(({ budget, spent, remaining, percent, alertLevel }) => {
              const barColor =
                alertLevel === 'over_100'
                  ? 'bg-gradient-to-r from-rose-500 to-red-600'
                  : alertLevel === 'warn_90'
                  ? 'bg-gradient-to-r from-orange-500 to-amber-600'
                  : alertLevel === 'warn_80'
                  ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                  : 'bg-gradient-to-r from-emerald-500 to-teal-500';
              return (
                <div
                  key={budget.id}
                  className="p-3.5 border border-slate-200/80 rounded-xl space-y-2 bg-slate-50/40"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-slate-900 truncate">
                      {budget.name}
                    </span>
                    <span
                      className={`font-mono font-bold shrink-0 ${
                        alertLevel === 'over_100'
                          ? 'text-rose-600'
                          : alertLevel === 'warn_80' || alertLevel === 'warn_90'
                          ? 'text-amber-700'
                          : 'text-emerald-700'
                      }`}
                    >
                      {percent.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-200/70 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${barColor}`}
                      style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
                    <span>Đã chi: {formatVND(spent)}</span>
                    <span className={remaining < 0 ? 'text-rose-600 font-bold' : ''}>
                      Còn: {formatVND(remaining)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {subTab === 'budgets' ? (
        <AccountsAndBudgetsSection
          accounts={accounts}
          budgets={budgets}
          transactions={transactions}
          hasDriveToken={hasDriveToken}
          onReconnectDrive={onReconnectDrive}
          onCreateAccount={async (input) => {
            await onCreateAccount(input);
          }}
          onUpdateAccount={onUpdateAccount}
          onReconcileAccount={onReconcileAccount}
          onCreateBudget={onCreateBudget}
          onDeleteBudget={onDeleteBudget}
          expenseCategories={expenseCategories}
        />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left Form (7 cols on XL for spacious multi-column grid) */}
          <div className="xl:col-span-7 bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
            <div
              className={`px-6 py-4 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2 ${
                isIncomeTab
                  ? 'bg-gradient-to-r from-emerald-50/90 via-white to-white'
                  : 'bg-gradient-to-r from-rose-50/90 via-white to-white'
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white ${
                    isIncomeTab
                      ? 'bg-gradient-to-br from-emerald-600 to-teal-600'
                      : 'bg-gradient-to-br from-rose-600 to-orange-500'
                  }`}
                >
                  {isIncomeTab ? (
                    <ArrowDownLeft className="w-4 h-4" />
                  ) : (
                    <ArrowUpRight className="w-4 h-4" />
                  )}
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    {editingTx
                      ? `Cập nhật ${editingTx.kind === 'income' ? 'khoản thu' : 'khoản chi'}`
                      : isIncomeTab
                      ? 'Tạo khoản thu mới'
                      : 'Tạo khoản chi mới'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Mã giao dịch cấp tự động, cố định và không tái sử dụng
                  </p>
                </div>
              </div>
              {editingTx && (
                <button
                  type="button"
                  onClick={() => resetFormForKind(activeKind)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 underline"
                >
                  Tạo mới thay thế
                </button>
              )}
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              {accounts.length === 0 && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 flex items-center justify-between gap-3">
                  <span>
                    Chưa có tài khoản hoặc quỹ tiền nào để ghi nhận giao dịch.
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSwitchSubTab('budgets')}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-semibold whitespace-nowrap"
                  >
                    Tạo nguồn tiền ngay
                  </button>
                </div>
              )}

              {formError && (
                <div
                  role="alert"
                  className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-semibold"
                >
                  {formError}
                </div>
              )}

              {formSuccess && (
                <div
                  role="status"
                  className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold flex items-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{formSuccess}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3.5">
                {/* Row 1: Name + Auto Code (Compact) */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div className="md:col-span-3">
                    <label
                      htmlFor="tx-name"
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1"
                    >
                      <FileText className="w-3.5 h-3.5 text-slate-400" />
                      <span>{isIncomeTab ? 'Tên khoản thu *' : 'Tên khoản chi *'}</span>
                    </label>
                    <input
                      id="tx-name"
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={
                        isIncomeTab
                          ? 'Ví dụ: Lương tháng 11/2026'
                          : 'Ví dụ: Thanh toán tiền thuê nhà T11'
                      }
                      className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="tx-code"
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1"
                    >
                      <Tag className="w-3.5 h-3.5 text-slate-400" />
                      <span>Mã giao dịch</span>
                    </label>
                    <input
                      id="tx-code"
                      type="text"
                      readOnly
                      value={activeCode}
                      className="w-full h-9 px-3 text-xs font-mono font-bold bg-slate-100 text-slate-800 border border-slate-200 rounded-xl cursor-not-allowed"
                    />
                  </div>
                </div>

                {/* Row 2: Amount + Category (with Add/Delete for Expenses) + Account */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor="tx-amount"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      {isIncomeTab ? 'Số tiền thu (VNĐ) *' : 'Số tiền chi (VNĐ) *'}
                    </label>
                    <input
                      id="tx-amount"
                      type="number"
                      min={0}
                      required
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0"
                      className={`w-full h-9 px-3 text-sm font-mono font-bold bg-slate-50/70 border rounded-xl focus:outline-none focus:ring-2 focus:bg-white ${
                        isIncomeTab
                          ? 'border-emerald-200 focus:ring-emerald-600 text-emerald-800'
                          : 'border-rose-200 focus:ring-rose-600 text-rose-700'
                      }`}
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label
                        htmlFor="tx-cat"
                        className="block text-xs font-semibold text-slate-700 truncate"
                      >
                        {isIncomeTab ? 'Loại thu *' : 'Danh mục chi tiêu *'}
                      </label>
                      {!isIncomeTab && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowCategoryManager((prev) => !prev);
                            setCategoryMsg(null);
                          }}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md border transition-colors shrink-0 ${
                            showCategoryManager
                              ? 'bg-rose-600 text-white border-rose-600'
                              : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200'
                          }`}
                          title="Thêm hoặc xóa danh mục chi tiêu"
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                          <span>Thêm / Xóa</span>
                        </button>
                      )}
                    </div>
                    <select
                      id="tx-cat"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className={`w-full h-9 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:bg-white ${
                        isIncomeTab ? 'focus:ring-emerald-600' : 'focus:ring-rose-600'
                      }`}
                    >
                      {(isIncomeTab ? INCOME_CATEGORIES : expenseCategories).map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                      {!isIncomeTab &&
                        category &&
                        !expenseCategories.includes(category) && (
                          <option value={category}>{category}</option>
                        )}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="tx-account"
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1"
                    >
                      <Landmark className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {isIncomeTab ? 'Tài khoản nhận *' : 'Tài khoản chi *'}
                      </span>
                    </label>
                    <select
                      id="tx-account"
                      required
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      className="w-full h-9 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                    >
                      {accounts.length === 0 && <option value="">Chưa có tài khoản</option>}
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} — {formatVND(acc.currentBalance)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Inline Expense Category Add / Delete Panel */}
                {!isIncomeTab && showCategoryManager && (
                  <div
                    aria-label="Quản lý danh mục chi tiêu"
                    className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-800">
                        Quản lý danh mục chi tiêu ({expenseCategories.length})
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={savingCategories}
                          onClick={handleRestoreDefaultCategories}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-blue-700 disabled:opacity-50"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Khôi phục mặc định</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowCategoryManager(false)}
                          aria-label="Đóng quản lý danh mục"
                          className="p-1 text-slate-400 hover:text-slate-700 rounded"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        aria-label="Tên danh mục chi tiêu mới"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCategory();
                          }
                        }}
                        placeholder="Nhập tên danh mục mới..."
                        className="flex-1 h-8 px-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                      />
                      <button
                        type="button"
                        disabled={savingCategories}
                        onClick={handleAddCategory}
                        className="inline-flex items-center gap-1 h-8 px-3 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-lg disabled:opacity-50 shrink-0"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Thêm</span>
                      </button>
                    </div>

                    {categoryMsg && (
                      <p
                        className={`text-xs font-semibold ${
                          categoryMsg.type === 'error'
                            ? 'text-rose-600'
                            : 'text-emerald-700'
                        }`}
                      >
                        {categoryMsg.text}
                      </p>
                    )}

                    <div className="max-h-36 overflow-y-auto flex flex-wrap gap-1.5 pr-1">
                      {expenseCategories.map((cat) => (
                        <div
                          key={cat}
                          className={`inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-lg border text-xs ${
                            category === cat
                              ? 'bg-rose-50 border-rose-300 text-rose-800 font-semibold'
                              : 'bg-white border-slate-200 text-slate-700'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setCategory(cat)}
                            className="hover:underline text-left"
                          >
                            {cat}
                          </button>
                          <button
                            type="button"
                            disabled={savingCategories}
                            onClick={() => handleRemoveCategory(cat)}
                            aria-label={`Xóa danh mục ${cat}`}
                            title={`Xóa "${cat}"`}
                            className="p-0.5 text-slate-400 hover:text-rose-600 rounded disabled:opacity-40"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Row 3: Method + Expected Date + Actual Date */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor="tx-method"
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1"
                    >
                      <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                      <span>{isIncomeTab ? 'Hình thức thu *' : 'Hình thức chi *'}</span>
                    </label>
                    <select
                      id="tx-method"
                      value={method}
                      onChange={(e) => setMethod(e.target.value)}
                      className="w-full h-9 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                    >
                      {(isIncomeTab ? INCOME_METHODS : EXPENSE_METHODS).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="tx-expected-date"
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1"
                    >
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {isIncomeTab ? 'Ngày dự kiến nhận *' : 'Ngày dự kiến chi *'}
                      </span>
                    </label>
                    <input
                      id="tx-expected-date"
                      type="date"
                      required
                      value={expectedDate}
                      onChange={(e) => setExpectedDate(e.target.value)}
                      className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="tx-actual-date"
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1"
                    >
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {isIncomeTab ? 'Ngày thực tế nhận' : 'Ngày thực tế chi'}
                      </span>
                    </label>
                    <input
                      id="tx-actual-date"
                      type="date"
                      value={actualDate}
                      onChange={(e) => setActualDate(e.target.value)}
                      className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                    />
                  </div>
                </div>

                {/* Row 4: 3 Color-Coded Status Buttons (Dự kiến | Đã thực hiện | Đã hủy) + Archive Toggle */}
                <div className="pt-1 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-700">
                      Trạng thái giao dịch
                    </span>
                    <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={markArchived}
                        disabled={status === 'Đã hủy'}
                        onChange={(e) => setMarkArchived(e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      <span>Chuyển vào Lưu trữ khi hoàn tất</span>
                    </label>
                  </div>

                  <div
                    role="radiogroup"
                    aria-label="Trạng thái giao dịch"
                    className="grid grid-cols-3 gap-2"
                  >
                    {TRANSACTION_STATUSES.map((st) => {
                      const meta = getStatusMeta(st);
                      const isSelected = status === st;
                      const Icon = meta.Icon;
                      return (
                        <button
                          key={st}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          onClick={() => {
                            setStatus(st);
                            if (st === 'Đã hủy') {
                              setMarkArchived(false);
                            }
                          }}
                          className={`h-9 px-2.5 rounded-xl border text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-all whitespace-nowrap ${
                            isSelected ? meta.activeButtonClass : meta.idleButtonClass
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span>{st}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Collapsible Secondary Fields to Keep Create Form Compact */}
                <div className="border border-slate-200/80 rounded-xl overflow-hidden bg-slate-50/40">
                  <button
                    type="button"
                    aria-expanded={showAdvancedFields}
                    onClick={() => setShowAdvancedFields((prev) => !prev)}
                    className="w-full px-3.5 py-2 flex items-center justify-between text-xs font-semibold text-slate-700 hover:bg-slate-100/70 transition-colors"
                  >
                    <span>
                      Chi tiết bổ sung (số tiền thực tế, đối tác, nguồn/lý do, mô tả)
                    </span>
                    {showAdvancedFields ? (
                      <ChevronUp className="w-4 h-4 text-slate-500" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    )}
                  </button>

                  {showAdvancedFields && (
                    <div className="p-3.5 pt-2 border-t border-slate-200/70 space-y-3 bg-white">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label
                            htmlFor="tx-actual-amount"
                            className="block text-xs font-semibold text-slate-700 mb-1"
                          >
                            {isIncomeTab ? 'Số tiền thực nhận (VNĐ)' : 'Số tiền thực chi (VNĐ)'}
                          </label>
                          <input
                            id="tx-actual-amount"
                            type="number"
                            min={0}
                            value={actualAmount}
                            onChange={(e) => setActualAmount(e.target.value)}
                            placeholder="Mặc định theo dự kiến"
                            className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                          />
                        </div>

                        {isIncomeTab ? (
                          <div>
                            <label
                              htmlFor="tx-remaining"
                              className="block text-xs font-semibold text-slate-700 mb-1"
                            >
                              Số tiền còn thiếu phải thu
                            </label>
                            <input
                              id="tx-remaining"
                              type="number"
                              min={0}
                              value={remainingAmount}
                              onChange={(e) => setRemainingAmount(e.target.value)}
                              className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
                            />
                          </div>
                        ) : (
                          <div>
                            <label
                              htmlFor="tx-purpose"
                              className="block text-xs font-semibold text-slate-700 mb-1"
                            >
                              Mục đích / Công việc (ngân sách)
                            </label>
                            <input
                              id="tx-purpose"
                              type="text"
                              value={purposeTag}
                              onChange={(e) => setPurposeTag(e.target.value)}
                              placeholder="Khớp tên hạn mức nếu có"
                              className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-600 focus:bg-white"
                            />
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {isIncomeTab ? (
                          <div>
                            <label htmlFor="tx-source" className="block text-xs font-semibold text-slate-700 mb-1">
                              Nguồn khoản thu
                            </label>
                            <input
                              id="tx-source"
                              type="text"
                              value={source}
                              onChange={(e) => setSource(e.target.value)}
                              placeholder="Công ty, dự án, kinh doanh..."
                              className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
                            />
                          </div>
                        ) : (
                          <div>
                            <label htmlFor="tx-reason" className="block text-xs font-semibold text-slate-700 mb-1">
                              Lý do chi
                            </label>
                            <input
                              id="tx-reason"
                              type="text"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder="Mục đích sử dụng khoản chi..."
                              className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-600 focus:bg-white"
                            />
                          </div>
                        )}

                        <div>
                          <label
                            htmlFor="tx-counterparty"
                            className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1"
                          >
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            <span>
                              {isIncomeTab
                                ? 'Người/Đơn vị gửi tiền'
                                : 'Người/Đơn vị nhận tiền'}
                            </span>
                          </label>
                          <input
                            id="tx-counterparty"
                            type="text"
                            value={counterparty}
                            onChange={(e) => setCounterparty(e.target.value)}
                            className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                          />
                        </div>
                      </div>

                      {isIncomeTab && (
                        <div>
                          <label htmlFor="tx-work-duration" className="block text-xs font-semibold text-slate-700 mb-1">
                            Thời gian thực hiện công việc
                          </label>
                          <input
                            id="tx-work-duration"
                            type="text"
                            value={workDuration}
                            onChange={(e) => setWorkDuration(e.target.value)}
                            placeholder="01/11/2026 - 15/11/2026"
                            className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
                          />
                        </div>
                      )}

                      <div>
                        <label htmlFor="tx-desc" className="block text-xs font-semibold text-slate-700 mb-1">
                          Mô tả chi tiết
                        </label>
                        <textarea
                          id="tx-desc"
                          rows={2}
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          className="w-full p-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Google Drive Proof Uploader */}
                <DriveUploader
                  txCode={activeCode}
                  isoDate={actualDate || expectedDate || todayIso}
                  attachments={attachments}
                  queuedFiles={queuedFiles}
                  hasDriveToken={hasDriveToken}
                  onReconnectDrive={onReconnectDrive}
                  onAddQueuedFiles={handleAddQueuedFiles}
                  onRenameQueuedFile={handleRenameQueuedFile}
                  onRemoveQueuedFile={handleRemoveQueuedFile}
                  onRemoveAttachment={(att) =>
                    setAttachments((prev) => prev.filter((item) => item.id !== att.id))
                  }
                />

                <button
                  type="submit"
                  disabled={submitting || accounts.length === 0}
                  className={`w-full h-10 inline-flex items-center justify-center gap-2 px-4 text-white text-sm font-bold rounded-xl shadow-md transition-all disabled:opacity-50 ${
                    isIncomeTab
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-emerald-600/20'
                      : 'bg-gradient-to-r from-rose-600 to-orange-500 hover:from-rose-700 hover:to-orange-600 shadow-rose-600/20'
                  }`}
                >
                  {submitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Đang lưu &amp; đồng bộ Google Drive...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-4 h-4" />
                      <span>
                        {editingTx
                          ? 'Lưu cập nhật giao dịch'
                          : isIncomeTab
                          ? 'Tạo khoản thu'
                          : 'Tạo khoản chi'}
                      </span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Right List (5 cols on XL): Active Transactions Colored by Status */}
          <div className="xl:col-span-5 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display text-lg font-bold text-slate-900">
                    {isIncomeTab ? 'Khoản thu đang theo dõi' : 'Khoản chi đang xử lý'}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Màu sắc từng thẻ thể hiện trực tiếp trạng thái xử lý
                  </p>
                </div>
                <span
                  className={`text-xs font-mono font-bold ${
                    isIncomeTab ? 'text-emerald-700' : 'text-rose-600'
                  }`}
                >
                  {activeList.length} khoản
                </span>
              </div>

              {/* 3-Color Status Summary Legend */}
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                {TRANSACTION_STATUSES.map((st) => {
                  const meta = getStatusMeta(st);
                  return (
                    <span
                      key={st}
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md ${meta.badgeClass}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${meta.dotClass}`} />
                      <span>
                        {st}: {activeStatusCounts[st]}
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>

            {workspaceActionMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium">
                {workspaceActionMsg}
              </div>
            )}

            {activeList.length === 0 ? (
              <div className="py-12 text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl">
                {isIncomeTab
                  ? 'Chưa có khoản thu nào đang xử lý.'
                  : 'Chưa có khoản chi nào đang xử lý.'}
              </div>
            ) : (
              <div className="space-y-3 max-h-[820px] overflow-y-auto pr-1">
                {activeList.map((tx) => {
                  const realized =
                    tx.kind === 'income'
                      ? isIncomeRealized(tx.status)
                      : isExpenseRealized(tx.status);
                  const cancelled = isTransactionCancelled(tx.status);
                  const statusMeta = getStatusMeta(tx.status);
                  return (
                    <div
                      key={tx.id}
                      className={`p-4 border rounded-2xl space-y-3 transition-all hover:shadow-sm ${statusMeta.cardClass}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono font-bold text-slate-900">
                              {tx.code}
                            </span>
                            <span className="text-slate-300">·</span>
                            <span className="text-slate-700 font-medium">{tx.category}</span>
                            <span className="text-slate-300">·</span>
                            <StatusText status={tx.status} kind={tx.kind} />
                          </div>
                          <h3 className="text-sm font-bold text-slate-900 truncate">
                            {tx.name}
                          </h3>
                          <div className="text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
                            <span>TK: {tx.accountName}</span>
                            <span>Dự kiến: {formatDateVN(tx.expectedDate)}</span>
                            {tx.actualDate && (
                              <span>Thực tế: {formatDateVN(tx.actualDate)}</span>
                            )}
                            <span>Chứng từ: {tx.attachments.length} tệp</span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <p
                            className={`text-base font-extrabold font-mono tabular-nums ${
                              cancelled
                                ? 'line-through text-rose-500'
                                : tx.kind === 'income'
                                ? 'text-emerald-600'
                                : 'text-rose-600'
                            }`}
                          >
                            {tx.kind === 'income' ? '+' : '-'}
                            {formatVND(getEffectiveTransactionAmount(tx))}
                          </p>
                          <span className="text-[11px] text-slate-500">
                            {cancelled
                              ? 'Đã hủy (không tính số dư)'
                              : realized
                              ? 'Đã hạch toán số dư'
                              : 'Chưa hạch toán số dư'}
                          </span>
                        </div>
                      </div>

                      {tx.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {tx.attachments.map((att) => (
                            <a
                              key={att.id}
                              href={att.webViewLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-mono text-blue-700 hover:underline"
                            >
                              <FileCheck2 className="w-3.5 h-3.5" />
                              <span>{att.name}</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/70">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await onCreateCalendarReminder(tx);
                                setWorkspaceActionMsg(
                                  `Đã thêm lịch nhắc cho ${tx.code} lên Google Calendar.`
                                );
                              } catch (err) {
                                setFormError(
                                  err instanceof Error ? err.message : 'Lỗi tạo lịch Calendar.'
                                );
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Tạo lịch nhắc trên Google Calendar"
                          >
                            <CalendarPlus className="w-3.5 h-3.5" />
                            <span>Lịch nhắc</span>
                          </button>

                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await onCreateTaskItem(tx);
                                setWorkspaceActionMsg(
                                  `Đã thêm đầu việc cho ${tx.code} vào Google Tasks.`
                                );
                              } catch (err) {
                                setFormError(
                                  err instanceof Error ? err.message : 'Lỗi tạo Google Tasks.'
                                );
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Thêm đầu việc vào Google Tasks"
                          >
                            <ListTodo className="w-3.5 h-3.5" />
                            <span>Tasks</span>
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => startEditing(tx)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Cập nhật</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleQuickArchive(tx)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-[#0B1437] hover:bg-blue-800 rounded-lg transition-colors"
                          >
                            <Archive className="w-3.5 h-3.5" />
                            <span>Hoàn thành</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Single-Sheet Excel Import Preview Modal */}
      {importPreview && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Xem trước dữ liệu nhập từ Excel"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-3xl max-h-[88vh] flex flex-col bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Xem trước nhập dữ liệu từ Excel (1 Sheet)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">
                  Tệp: {importPreview.fileName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                  <span className="text-blue-700 block font-medium">Tài khoản / Quỹ</span>
                  <span className="text-lg font-bold font-mono text-blue-900">
                    {importPreview.parsed.accounts.length}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
                  <span className="text-emerald-700 block font-medium">Khoản thu</span>
                  <span className="text-lg font-bold font-mono text-emerald-800">
                    {importPreview.parsed.incomes.length}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200">
                  <span className="text-rose-700 block font-medium">Khoản chi</span>
                  <span className="text-lg font-bold font-mono text-rose-700">
                    {importPreview.parsed.expenses.length}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-violet-50 border border-violet-200">
                  <span className="text-violet-700 block font-medium">Hạn mức</span>
                  <span className="text-lg font-bold font-mono text-violet-800">
                    {importPreview.parsed.budgets.length}
                  </span>
                </div>
              </div>

              {importPreview.parsed.errors.length > 0 && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 space-y-1">
                  <p className="font-bold">
                    Phát hiện {importPreview.parsed.errors.length} dòng chưa hợp lệ (sẽ bỏ qua):
                  </p>
                  <ul className="list-disc pl-4 space-y-0.5 max-h-28 overflow-y-auto">
                    {importPreview.parsed.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {totalParsedImportItems === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl">
                  Không có dòng dữ liệu hợp lệ nào để nhập. Vui lòng kiểm tra lại cấu trúc theo file mẫu chuẩn.
                </div>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                        <th className="py-2.5 px-3">Dòng</th>
                        <th className="py-2.5 px-3">Nhóm</th>
                        <th className="py-2.5 px-3">Tên khoản / Tài khoản</th>
                        <th className="py-2.5 px-3">Loại / Phạm vi</th>
                        <th className="py-2.5 px-3 text-right">Số tiền</th>
                        <th className="py-2.5 px-3">Ngày / Tháng</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importPreview.parsed.accounts.map((a) => (
                        <tr key={`acc-${a.rowNumber}`}>
                          <td className="py-2 px-3 font-mono text-slate-500">{a.rowNumber}</td>
                          <td className="py-2 px-3 font-semibold text-blue-700">Tài khoản</td>
                          <td className="py-2 px-3 font-semibold text-slate-900">{a.name}</td>
                          <td className="py-2 px-3 text-slate-600">{a.type}</td>
                          <td className="py-2 px-3 text-right font-mono">{formatVND(a.currentBalance)}</td>
                          <td className="py-2 px-3 text-slate-500">—</td>
                        </tr>
                      ))}
                      {importPreview.parsed.budgets.map((b) => (
                        <tr key={`bdg-${b.rowNumber}`}>
                          <td className="py-2 px-3 font-mono text-slate-500">{b.rowNumber}</td>
                          <td className="py-2 px-3 font-semibold text-violet-700">Hạn mức</td>
                          <td className="py-2 px-3 font-semibold text-slate-900">{b.name}</td>
                          <td className="py-2 px-3 text-slate-600">{b.scopeValue}</td>
                          <td className="py-2 px-3 text-right font-mono">{formatVND(b.limitAmount)}</td>
                          <td className="py-2 px-3 font-mono text-slate-600">{b.yearMonth}</td>
                        </tr>
                      ))}
                      {[...importPreview.parsed.incomes, ...importPreview.parsed.expenses]
                        .slice(0, 20)
                        .map((tx) => (
                          <tr key={`tx-${tx.rowNumber}`}>
                            <td className="py-2 px-3 font-mono text-slate-500">{tx.rowNumber}</td>
                            <td
                              className={`py-2 px-3 font-semibold ${
                                tx.kind === 'income' ? 'text-emerald-700' : 'text-rose-600'
                              }`}
                            >
                              {tx.kind === 'income' ? 'Thu' : 'Chi'}
                            </td>
                            <td className="py-2 px-3 font-semibold text-slate-900">{tx.name}</td>
                            <td className="py-2 px-3 text-slate-600">{tx.category}</td>
                            <td className="py-2 px-3 text-right font-mono">
                              {formatVND(tx.actualAmount ?? tx.amount)}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-600">
                              {formatDateVN(tx.actualDate || tx.expectedDate)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isImportingExcel || totalParsedImportItems === 0}
                onClick={handleConfirmExcelImport}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {isImportingExcel && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>
                  {isImportingExcel
                    ? 'Đang nhập dữ liệu...'
                    : `Xác nhận nhập (${totalParsedImportItems} mục)`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
