import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowDownLeft,
  ArrowLeftRight,
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
  FilterX,
  Landmark,
  ListTodo,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Tag,
  Target,
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
  TRANSFER_CATEGORIES,
  TRANSFER_METHODS,
  type BudgetLimit,
  type CanonicalTransactionStatus,
  type DriveAttachment,
  type FinancialAccount,
  type Transaction,
  type TransactionKind,
  type TransactionStatus,
} from '../types/finance';
import {
  buildDriveAttachmentName,
  detectDuplicateTransactions,
  evaluateBudget,
  filterTransactionsByQuery,
  formatDateVN,
  formatVND,
  getEffectiveTransactionAmount,
  getFileExtension,
  getTransactionCodePrefix,
  getTransactionEffectiveDate,
  getYearMonthDash,
  getYearMonthDot,
  isExpenseRealized,
  isIncomeRealized,
  isTransactionCancelled,
  isTransferRealized,
  normalizeTransactionStatus,
  paginateItems,
  sortTransactions,
  toVndInt,
  validateTransactionStatusChange,
  type SortDirection,
  type TransactionSortField,
} from '../utils/financeRules';
import {
  downloadSingleSheetTemplate,
  parseSingleSheetWorkbook,
  type SingleSheetParseResult,
} from '../utils/excelTemplate';
import { DriveUploader, type QueuedUploadFile } from './DriveUploader';
import { getStatusMeta, StatusText } from './StatusText';
import type { ActivePage } from './SidebarLayout';

export type TransactionsSubTab = 'income' | 'expense' | 'transfer';

interface TransactionsPageProps {
  accounts: FinancialAccount[];
  transactions: Transaction[];
  budgets: BudgetLimit[];
  expenseCategories: string[];
  incomeCategories?: string[];
  defaultPageSize?: number;
  externalSearchQuery?: string;
  onOpenCategoryManager: (
    currentCategory: string,
    onSelect: (category: string) => void
  ) => void;
  hasDriveToken: boolean;
  userEmail?: string;
  pushPermission: NotificationPermission | 'unsupported';
  pushEnabled: boolean;
  onTogglePush: () => void;
  onReconnectDrive: () => void;
  onNavigate?: (page: ActivePage) => void;
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
  onCreateCalendarReminder: (tx: Transaction) => Promise<void>;
  onCreateTaskItem: (tx: Transaction) => Promise<void>;
  onImportSingleSheetExcel: (
    parsed: SingleSheetParseResult,
    options: { skipDuplicates: boolean }
  ) => Promise<{
    accountsCreated: number;
    budgetsCreated: number;
    incomesCreated: number;
    expensesCreated: number;
    transfersCreated: number;
    skippedDuplicates: number;
  }>;
}

export const TransactionsPage: React.FC<TransactionsPageProps> = ({
  accounts,
  transactions,
  budgets,
  expenseCategories,
  incomeCategories,
  defaultPageSize = 15,
  externalSearchQuery,
  onOpenCategoryManager,
  hasDriveToken,
  onReconnectDrive,
  onNavigate,
  onPeekCode,
  onSaveNewTransaction,
  onUpdateTransaction,
  onCreateCalendarReminder,
  onCreateTaskItem,
  onImportSingleSheetExcel,
}) => {
  const effectiveIncomeCategories = useMemo(
    () =>
      incomeCategories && incomeCategories.length > 0
        ? incomeCategories
        : [...INCOME_CATEGORIES],
    [incomeCategories]
  );

  const [subTab, setSubTab] = useState<TransactionsSubTab>('expense');
  const todayIso = new Date().toISOString().slice(0, 10);

  // Shared Form State (Income | Expense | Internal Transfer)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [previewCode, setPreviewCode] = useState<string>('...');
  const [name, setName] = useState('');
  const [source, setSource] = useState('');
  const [amount, setAmount] = useState('');
  const [actualAmount, setActualAmount] = useState('');
  const [remainingAmount, setRemainingAmount] = useState('');
  const [category, setCategory] = useState<string>(
    expenseCategories[0] || EXPENSE_CATEGORIES[0]
  );
  const [method, setMethod] = useState<string>(EXPENSE_METHODS[0]);
  const [accountId, setAccountId] = useState<string>('');
  const [toAccountId, setToAccountId] = useState<string>('');
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

  const [attachments, setAttachments] = useState<DriveAttachment[]>([]);
  const [queuedFiles, setQueuedFiles] = useState<QueuedUploadFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [workspaceActionMsg, setWorkspaceActionMsg] = useState<string | null>(null);

  // Search, combined filters, sorting & pagination
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterAccountId, setFilterAccountId] = useState<string>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [filterMonth, setFilterMonth] = useState<string>('ALL');
  const [sortField, setSortField] = useState<TransactionSortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [listPage, setListPage] = useState(1);

  // Single-Sheet Excel Import State
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [importPreview, setImportPreview] = useState<{
    fileName: string;
    parsed: SingleSheetParseResult;
  } | null>(null);
  const [skipExcelDuplicates, setSkipExcelDuplicates] = useState(true);
  const [isImportingExcel, setIsImportingExcel] = useState(false);
  const [excelNotice, setExcelNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const activeKind: TransactionKind = subTab;
  const activeCode = editingTx ? editingTx.code : previewCode;
  const isIncomeTab = activeKind === 'income';
  const isTransferTab = activeKind === 'transfer';

  // Sync external search query from Global Search bar
  useEffect(() => {
    if (!externalSearchQuery) return;
    setSearchQuery(externalSearchQuery);
    setListPage(1);
    const upper = externalSearchQuery.trim().toUpperCase();
    if (upper.startsWith('KT-')) {
      setSubTab('income');
    } else if (upper.startsWith('CK-')) {
      setSubTab('transfer');
    } else if (upper.startsWith('KC-')) {
      setSubTab('expense');
    } else {
      const matched = transactions.find(
        (t) =>
          !t.isArchived &&
          t.code.toUpperCase() === upper
      );
      if (matched) {
        setSubTab(matched.kind);
      }
    }
  }, [externalSearchQuery, transactions]);

  // Ensure default account selections when accounts load
  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      setAccountId(accounts[0].id);
    }
    if (accounts.length > 1 && (!toAccountId || toAccountId === accountId)) {
      const alt = accounts.find((a) => a.id !== (accountId || accounts[0].id));
      if (alt) setToAccountId(alt.id);
    }
  }, [accounts, accountId, toAccountId]);

  // Keep selected category valid if custom categories are updated
  useEffect(() => {
    if (editingTx) return;
    if (isIncomeTab) {
      if (effectiveIncomeCategories.length > 0 && !effectiveIncomeCategories.includes(category)) {
        setCategory(effectiveIncomeCategories[0]);
      }
    } else if (!isTransferTab) {
      if (expenseCategories.length > 0 && !expenseCategories.includes(category)) {
        setCategory(expenseCategories[0]);
      }
    }
  }, [isIncomeTab, isTransferTab, editingTx, expenseCategories, effectiveIncomeCategories, category]);

  // Refresh preview code when kind or expectedDate month changes (for new entries)
  useEffect(() => {
    if (editingTx) return;
    let active = true;
    const dateRef = expectedDate || todayIso;
    onPeekCode(activeKind, dateRef)
      .then((code) => {
        if (active) setPreviewCode(code);
      })
      .catch(() => {
        if (active) {
          setPreviewCode(
            `${getTransactionCodePrefix(activeKind)}-${getYearMonthDot(dateRef)}-01`
          );
        }
      });
    return () => {
      active = false;
    };
  }, [activeKind, expectedDate, editingTx, onPeekCode, todayIso, transactions.length]);

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

  const activeTransfers = useMemo(
    () => transactions.filter((t) => t.kind === 'transfer' && !t.isArchived),
    [transactions]
  );

  const hasSearchQuery = searchQuery.trim().length > 0;

  const queriedIncomes = useMemo(
    () => filterTransactionsByQuery(activeIncomes, searchQuery),
    [activeIncomes, searchQuery]
  );
  const queriedExpenses = useMemo(
    () => filterTransactionsByQuery(activeExpenses, searchQuery),
    [activeExpenses, searchQuery]
  );
  const queriedTransfers = useMemo(
    () => filterTransactionsByQuery(activeTransfers, searchQuery),
    [activeTransfers, searchQuery]
  );

  const baseListForTab = isIncomeTab
    ? queriedIncomes
    : isTransferTab
    ? queriedTransfers
    : queriedExpenses;

  const availableMonthsForTab = useMemo(() => {
    const s = new Set<string>();
    const pool = isIncomeTab ? activeIncomes : isTransferTab ? activeTransfers : activeExpenses;
    for (const tx of pool) {
      const d = getTransactionEffectiveDate(tx);
      if (d) s.add(getYearMonthDash(d));
    }
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [isIncomeTab, isTransferTab, activeIncomes, activeTransfers, activeExpenses]);

  const activeList = useMemo(() => {
    const filtered = baseListForTab.filter((tx) => {
      if (
        filterStatus !== 'ALL' &&
        normalizeTransactionStatus(tx.status) !== filterStatus
      ) {
        return false;
      }
      if (filterAccountId !== 'ALL') {
        const matchesAcc =
          tx.accountId === filterAccountId || tx.toAccountId === filterAccountId;
        if (!matchesAcc) return false;
      }
      if (filterCategory !== 'ALL' && tx.category !== filterCategory) {
        return false;
      }
      if (filterMonth !== 'ALL') {
        const d = getTransactionEffectiveDate(tx);
        if (!d || getYearMonthDash(d) !== filterMonth) return false;
      }
      return true;
    });
    return sortTransactions(filtered, sortField, sortDirection);
  }, [
    baseListForTab,
    filterStatus,
    filterAccountId,
    filterCategory,
    filterMonth,
    sortField,
    sortDirection,
  ]);

  const paginatedList = useMemo(
    () => paginateItems(activeList, listPage, defaultPageSize),
    [activeList, listPage, defaultPageSize]
  );

  const hasCombinedFilters =
    filterStatus !== 'ALL' ||
    filterAccountId !== 'ALL' ||
    filterCategory !== 'ALL' ||
    filterMonth !== 'ALL';

  const resetFormForKind = (kind: TransactionKind) => {
    setEditingTx(null);
    setName('');
    setSource('');
    setAmount('');
    setActualAmount('');
    setRemainingAmount('');
    setCategory(
      kind === 'income'
        ? effectiveIncomeCategories[0] || INCOME_CATEGORIES[0]
        : kind === 'transfer'
        ? TRANSFER_CATEGORIES[0]
        : expenseCategories[0] || EXPENSE_CATEGORIES[0]
    );
    setMethod(
      kind === 'income'
        ? INCOME_METHODS[0]
        : kind === 'transfer'
        ? TRANSFER_METHODS[0]
        : EXPENSE_METHODS[0]
    );
    const defaultSrc = accounts[0]?.id || '';
    const defaultDest = accounts.find((a) => a.id !== defaultSrc)?.id || '';
    setAccountId(defaultSrc);
    setToAccountId(defaultDest);
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
    setFilterCategory('ALL');
    setListPage(1);
    setFormSuccess(null);
    setWorkspaceActionMsg(null);
    resetFormForKind(tab);
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
    setToAccountId(tx.toAccountId || '');
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
      const baseName =
        ext && fullDefault.endsWith(ext)
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
      setSkipExcelDuplicates(true);
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

  const duplicateCheck = useMemo(() => {
    if (!importPreview) return null;
    const candidates = [
      ...importPreview.parsed.incomes,
      ...importPreview.parsed.expenses,
      ...importPreview.parsed.transfers,
    ].map((row) => ({
      rowNumber: row.rowNumber,
      kind: row.kind,
      name: row.name,
      amount: row.amount,
      actualAmount: row.actualAmount,
      expectedDate: row.expectedDate,
      actualDate: row.actualDate,
    }));
    return detectDuplicateTransactions(candidates, transactions);
  }, [importPreview, transactions]);

  const handleConfirmExcelImport = async () => {
    if (!importPreview) return;
    setIsImportingExcel(true);
    setExcelNotice(null);
    try {
      const stats = await onImportSingleSheetExcel(importPreview.parsed, {
        skipDuplicates: skipExcelDuplicates,
      });
      setImportPreview(null);
      setExcelNotice({
        type: 'success',
        message: `Đã nhập từ "${importPreview.fileName}": ${stats.accountsCreated} tài khoản, ${stats.incomesCreated} thu, ${stats.expensesCreated} chi, ${stats.transfersCreated} chuyển khoản, ${stats.budgetsCreated} hạn mức${
          stats.skippedDuplicates > 0 ? ` (bỏ qua ${stats.skippedDuplicates} trùng lặp)` : ''
        }.`,
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
        'Bạn chưa có tài khoản hoặc quỹ tiền nào. Vui lòng tạo tài khoản tại phân hệ Tài khoản trước.'
      );
      return;
    }

    if (isTransferTab && accounts.length < 2) {
      setFormError(
        'Chuyển khoản nội bộ yêu cầu tối thiểu 2 tài khoản nguồn và đích khác nhau.'
      );
      return;
    }

    const selectedAccount = accounts.find((a) => a.id === accountId);
    if (!selectedAccount) {
      setFormError('Vui lòng chọn tài khoản nguồn / thanh toán hợp lệ.');
      return;
    }

    const selectedDestAccount = isTransferTab
      ? accounts.find((a) => a.id === toAccountId)
      : undefined;

    const numAmount = toVndInt(Number(amount));
    if (!name.trim() || !Number.isFinite(numAmount) || numAmount < 0) {
      setFormError('Vui lòng nhập tên giao dịch và số tiền nguyên VNĐ hợp lệ.');
      return;
    }
    if (isTransferTab && numAmount <= 0) {
      setFormError('Số tiền chuyển khoản nội bộ phải lớn hơn 0.');
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
      shouldArchive,
      isTransferTab ? toAccountId : undefined,
      hasDriveToken
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

    if (hasDriveToken && totalProofCount === 0 && shouldArchive && !isTransferTab) {
      setFormError('Cần ít nhất 1 chứng từ trên Google Drive trước khi chuyển vào Lưu trữ.');
      return;
    }

    const parsedActualAmount =
      actualAmount.trim() !== '' ? toVndInt(Number(actualAmount)) : undefined;
    const parsedRemaining =
      remainingAmount.trim() !== '' ? toVndInt(Number(remainingAmount)) : undefined;

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
            ...(editingTx.kind === 'transfer' && selectedDestAccount
              ? {
                  toAccountId: selectedDestAccount.id,
                  toAccountName: selectedDestAccount.name,
                }
              : {}),
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
            ...(isTransferTab && selectedDestAccount
              ? {
                  toAccountId: selectedDestAccount.id,
                  toAccountName: selectedDestAccount.name,
                }
              : {}),
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
            ? `Đã tạo ${created.code} và chuyển vào Lưu trữ.`
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
      true,
      tx.toAccountId,
      hasDriveToken
    );
    if (!validation.valid) {
      startEditing(tx);
      setStatus(targetStatus);
      setMarkArchived(true);
      setFormError(
        validation.error ||
          'Vui lòng bổ sung ngày thực tế và chứng từ trước khi chuyển vào Lưu trữ.'
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

  const unfilteredActiveCount = isIncomeTab
    ? activeIncomes.length
    : isTransferTab
    ? activeTransfers.length
    : activeExpenses.length;

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
      importPreview.parsed.transfers.length +
      importPreview.parsed.budgets.length
    : 0;

  const activeCategoryChoices = isIncomeTab
    ? effectiveIncomeCategories
    : isTransferTab
    ? [...TRANSFER_CATEGORIES]
    : expenseCategories;

  const activeMethodChoices = isIncomeTab
    ? INCOME_METHODS
    : isTransferTab
    ? TRANSFER_METHODS
    : EXPENSE_METHODS;

  return (
    <div className="space-y-6 animate-fintech-in">
      {/* Header & Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0B1437]">
            QUẢN LÝ GIAO DỊCH THU · CHI · CHUYỂN KHOẢN
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Tạo mới, đối soát chứng từ Drive, chuyển tiền nội bộ &amp; nhập liệu từ Excel 1 sheet
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {onNavigate && (
            <>
              <button
                type="button"
                onClick={() => onNavigate('accounts')}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200/90 text-slate-700 text-xs sm:text-sm font-semibold rounded-xl hover:bg-slate-50 shadow-xs transition-all whitespace-nowrap"
              >
                <Wallet className="w-4 h-4 text-blue-600" />
                <span>Tài khoản ({accounts.length})</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('budgets')}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200/90 text-slate-700 text-xs sm:text-sm font-semibold rounded-xl hover:bg-slate-50 shadow-xs transition-all whitespace-nowrap"
              >
                <Target className="w-4 h-4 text-violet-600" />
                <span>Ngân sách ({budgets.length})</span>
              </button>
            </>
          )}

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

      {/* Real-Time Transaction Search Bar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-2.5 sm:p-3 shadow-xs flex flex-col sm:flex-row sm:items-center gap-2.5">
        <div className="relative flex-1 min-w-0">
          <label htmlFor="tx-search-input" className="sr-only">
            Tìm kiếm giao dịch theo tên, đối tác hoặc nội dung ghi chú
          </label>
          <Search
            aria-hidden="true"
            className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
          />
          <input
            id="tx-search-input"
            type="text"
            role="searchbox"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setListPage(1);
            }}
            placeholder="Tìm kiếm giao dịch theo mã (KT/KC/CK), tên, đối tác hoặc ghi chú..."
            className="w-full h-10 pl-10 pr-9 text-sm bg-slate-50/70 border border-slate-200/90 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-colors"
          />
          {hasSearchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setListPage(1);
              }}
              aria-label="Xóa từ khóa tìm kiếm"
              title="Xóa tìm kiếm"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center justify-between sm:justify-end gap-2 px-1 text-xs text-slate-500 shrink-0">
          {hasSearchQuery ? (
            <span className="font-mono tabular-nums font-semibold text-slate-700 whitespace-nowrap">
              Khớp {queriedIncomes.length} thu · {queriedExpenses.length} chi ·{' '}
              {queriedTransfers.length} CK
            </span>
          ) : (
            <span className="whitespace-nowrap">
              Lọc tức thì theo mã, tên, đối tác &amp; ghi chú
            </span>
          )}
        </div>
      </div>

      {/* 3-Area Tab Navigation: THU (Emerald) | CHI (Coral) | CHUYỂN KHOẢN NỘI BỘ (Cobalt/Indigo) */}
      <div
        role="tablist"
        aria-label="Phân loại giao dịch Thu, Chi và Chuyển khoản nội bộ"
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
                KHOẢN THU (
                {hasSearchQuery
                  ? `${queriedIncomes.length}/${activeIncomes.length}`
                  : activeIncomes.length}
                )
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
                KHOẢN CHI (
                {hasSearchQuery
                  ? `${queriedExpenses.length}/${activeExpenses.length}`
                  : activeExpenses.length}
                )
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
          aria-selected={subTab === 'transfer'}
          onClick={() => handleSwitchSubTab('transfer')}
          className={`flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border text-left transition-all ${
            subTab === 'transfer'
              ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 border-blue-600 text-white shadow-lg shadow-blue-600/20'
              : 'bg-white border-slate-200/90 text-slate-700 hover:border-blue-300 hover:bg-blue-50/40'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                subTab === 'transfer'
                  ? 'bg-white/20 text-white'
                  : 'bg-blue-100 text-blue-700'
              }`}
            >
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <span className="font-display font-bold text-sm block whitespace-nowrap">
                CHUYỂN KHOẢN NỘI BỘ (
                {hasSearchQuery
                  ? `${queriedTransfers.length}/${activeTransfers.length}`
                  : activeTransfers.length}
                )
              </span>
              <span
                className={`text-xs block truncate ${
                  subTab === 'transfer' ? 'text-blue-100' : 'text-slate-500'
                }`}
              >
                Điều chuyển giữa các ví (không tính thu/chi)
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
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Cảnh báo hạn mức chi tiêu (80% · 100%)</span>
            </div>
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('budgets')}
                className="text-xs font-bold text-amber-900 underline"
              >
                Mở Ngân sách
              </button>
            )}
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
                  {ev.alertLevel === 'over_100' && <ShieldAlert className="w-3.5 h-3.5" />}
                  {ev.percent.toFixed(1)}% ({formatVND(ev.spent)} /{' '}
                  {formatVND(ev.budget.limitAmount)})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Split Workspace: Left Form (7 cols) | Right Filtered & Paginated Ledger (5 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Form */}
        <div className="xl:col-span-7 bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
          <div
            className={`px-6 py-4 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2 ${
              isIncomeTab
                ? 'bg-gradient-to-r from-emerald-50/90 via-white to-white'
                : isTransferTab
                ? 'bg-gradient-to-r from-blue-50/90 via-white to-white'
                : 'bg-gradient-to-r from-rose-50/90 via-white to-white'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-white ${
                  isIncomeTab
                    ? 'bg-gradient-to-br from-emerald-600 to-teal-600'
                    : isTransferTab
                    ? 'bg-gradient-to-br from-blue-600 to-indigo-600'
                    : 'bg-gradient-to-br from-rose-600 to-orange-500'
                }`}
              >
                {isIncomeTab ? (
                  <ArrowDownLeft className="w-4 h-4" />
                ) : isTransferTab ? (
                  <ArrowLeftRight className="w-4 h-4" />
                ) : (
                  <ArrowUpRight className="w-4 h-4" />
                )}
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  {editingTx
                    ? `Cập nhật ${
                        editingTx.kind === 'income'
                          ? 'khoản thu'
                          : editingTx.kind === 'transfer'
                          ? 'lệnh chuyển khoản'
                          : 'khoản chi'
                      }`
                    : isIncomeTab
                    ? 'Tạo khoản thu mới'
                    : isTransferTab
                    ? 'Lập lệnh chuyển khoản nội bộ'
                    : 'Tạo khoản chi mới'}
                </h2>
                <p className="text-xs text-slate-500">
                  {isTransferTab
                    ? 'Mã CK cấp tự động · Không cộng vào tổng thu hoặc tổng chi'
                    : 'Mã giao dịch cấp tự động, cố định và không tái sử dụng'}
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
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('accounts')}
                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-semibold whitespace-nowrap"
                  >
                    Tạo tài khoản ngay
                  </button>
                )}
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
              {/* Row 1: Name + Auto Code */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-3">
                  <label
                    htmlFor="tx-name"
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1"
                  >
                    <FileText className="w-3.5 h-3.5 text-slate-400" />
                    <span>
                      {isIncomeTab
                        ? 'Tên khoản thu *'
                        : isTransferTab
                        ? 'Nội dung chuyển khoản *'
                        : 'Tên khoản chi *'}
                    </span>
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
                        : isTransferTab
                        ? 'Ví dụ: Nạp tiền sang ví MoMo / Gửi tiết kiệm'
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

              {/* Row 2: Amount + Category + Accounts */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="tx-amount"
                    className="block text-xs font-semibold text-slate-700 mb-1"
                  >
                    {isIncomeTab
                      ? 'Số tiền thu (VNĐ) *'
                      : isTransferTab
                      ? 'Số tiền chuyển (VNĐ) *'
                      : 'Số tiền chi (VNĐ) *'}
                  </label>
                  <input
                    id="tx-amount"
                    type="number"
                    min={0}
                    step={1}
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className={`w-full h-9 px-3 text-sm font-mono font-bold bg-slate-50/70 border rounded-xl focus:outline-none focus:ring-2 focus:bg-white ${
                      isIncomeTab
                        ? 'border-emerald-200 focus:ring-emerald-600 text-emerald-800'
                        : isTransferTab
                        ? 'border-blue-200 focus:ring-blue-600 text-blue-800'
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
                      {isIncomeTab
                        ? 'Loại thu *'
                        : isTransferTab
                        ? 'Loại điều chuyển *'
                        : 'Danh mục chi tiêu *'}
                    </label>
                    {!isIncomeTab && !isTransferTab && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenCategoryManager(category, (nextCat) =>
                            setCategory(nextCat)
                          )
                        }
                        aria-label="Mở hộp thoại sắp xếp và thêm danh mục chi tiêu"
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-md border bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200 transition-colors shrink-0 whitespace-nowrap"
                      >
                        <SlidersHorizontal className="w-3 h-3" />
                        <span>Sắp xếp / Thêm</span>
                      </button>
                    )}
                  </div>
                  <select
                    id="tx-cat"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full h-9 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                  >
                    {activeCategoryChoices.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                    {category && !activeCategoryChoices.includes(category) && (
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
                      {isIncomeTab
                        ? 'Tài khoản nhận *'
                        : isTransferTab
                        ? 'Từ tài khoản (nguồn) *'
                        : 'Tài khoản chi *'}
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

              {/* Extra Row for Transfer Destination Account */}
              {isTransferTab && (
                <div>
                  <label
                    htmlFor="tx-to-account"
                    className="flex items-center gap-1.5 text-xs font-semibold text-blue-800 mb-1"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5 text-blue-600" />
                    <span>Đến tài khoản (đích nhận) *</span>
                  </label>
                  <select
                    id="tx-to-account"
                    required
                    value={toAccountId}
                    onChange={(e) => setToAccountId(e.target.value)}
                    className="w-full h-9 px-2.5 text-sm bg-blue-50/40 border border-blue-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                  >
                    <option value="">-- Chọn tài khoản đích --</option>
                    {accounts
                      .filter((a) => a.id !== accountId)
                      .map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} — {formatVND(acc.currentBalance)}
                        </option>
                      ))}
                  </select>
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
                    <span>
                      {isIncomeTab
                        ? 'Hình thức thu *'
                        : isTransferTab
                        ? 'Kênh chuyển *'
                        : 'Hình thức chi *'}
                    </span>
                  </label>
                  <select
                    id="tx-method"
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="w-full h-9 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                  >
                    {activeMethodChoices.map((m) => (
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
                      {isIncomeTab
                        ? 'Ngày dự kiến nhận *'
                        : isTransferTab
                        ? 'Ngày dự kiến chuyển *'
                        : 'Ngày dự kiến chi *'}
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
                      {isIncomeTab
                        ? 'Ngày thực tế nhận'
                        : isTransferTab
                        ? 'Ngày thực tế chuyển'
                        : 'Ngày thực tế chi'}
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

              {/* Row 4: 3 Status Buttons + Archive Toggle */}
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

              {/* Collapsible Secondary Fields */}
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
                          {isIncomeTab
                            ? 'Số tiền thực nhận (VNĐ)'
                            : isTransferTab
                            ? 'Số tiền thực chuyển (VNĐ)'
                            : 'Số tiền thực chi (VNĐ)'}
                        </label>
                        <input
                          id="tx-actual-amount"
                          type="number"
                          min={0}
                          step={1}
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
                            step={1}
                            value={remainingAmount}
                            onChange={(e) => setRemainingAmount(e.target.value)}
                            className="w-full h-9 px-3 text-sm font-mono bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
                          />
                        </div>
                      ) : !isTransferTab ? (
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
                      ) : (
                        <div>
                          <label
                            htmlFor="tx-reason-transfer"
                            className="block text-xs font-semibold text-slate-700 mb-1"
                          >
                            Lý do điều chuyển
                          </label>
                          <input
                            id="tx-reason-transfer"
                            type="text"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Gửi tiết kiệm, cân đối dòng tiền..."
                            className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                          />
                        </div>
                      )}
                    </div>

                    {!isTransferTab && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {isIncomeTab ? (
                          <div>
                            <label
                              htmlFor="tx-source"
                              className="block text-xs font-semibold text-slate-700 mb-1"
                            >
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
                            <label
                              htmlFor="tx-reason"
                              className="block text-xs font-semibold text-slate-700 mb-1"
                            >
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
                    )}

                    {isIncomeTab && (
                      <div>
                        <label
                          htmlFor="tx-work-duration"
                          className="block text-xs font-semibold text-slate-700 mb-1"
                        >
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
                      <label
                        htmlFor="tx-desc"
                        className="block text-xs font-semibold text-slate-700 mb-1"
                      >
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
                    : isTransferTab
                    ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:opacity-95 shadow-blue-600/20'
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
                        : isTransferTab
                        ? 'Tạo lệnh chuyển khoản'
                        : 'Tạo khoản chi'}
                    </span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Right List: Combined Filters, Sort & Paginated Ledger */}
        <div className="xl:col-span-5 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900">
                  {isIncomeTab
                    ? 'Khoản thu đang theo dõi'
                    : isTransferTab
                    ? 'Lệnh chuyển khoản nội bộ'
                    : 'Khoản chi đang xử lý'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Lọc kết hợp, sắp xếp &amp; phân trang trực tiếp
                </p>
              </div>
              <span
                className={`text-xs font-mono font-bold tabular-nums ${
                  isIncomeTab
                    ? 'text-emerald-700'
                    : isTransferTab
                    ? 'text-indigo-700'
                    : 'text-rose-600'
                }`}
              >
                {hasSearchQuery || hasCombinedFilters
                  ? `${activeList.length}/${unfilteredActiveCount} khoản`
                  : `${activeList.length} khoản`}
              </span>
            </div>

            {/* Combined Filters & Sort Controls */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <select
                aria-label="Lọc trạng thái"
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value);
                  setListPage(1);
                }}
                className="h-8 px-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="ALL">Mọi trạng thái</option>
                {TRANSACTION_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>

              <select
                aria-label="Lọc tài khoản"
                value={filterAccountId}
                onChange={(e) => {
                  setFilterAccountId(e.target.value);
                  setListPage(1);
                }}
                className="h-8 px-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="ALL">Mọi tài khoản</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name}
                  </option>
                ))}
              </select>

              <select
                aria-label="Lọc tháng"
                value={filterMonth}
                onChange={(e) => {
                  setFilterMonth(e.target.value);
                  setListPage(1);
                }}
                className="h-8 px-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="ALL">Mọi tháng</option>
                {availableMonthsForTab.map((ym) => (
                  <option key={ym} value={ym}>
                    {ym}
                  </option>
                ))}
              </select>

              <select
                aria-label="Sắp xếp danh sách"
                value={`${sortField}:${sortDirection}`}
                onChange={(e) => {
                  const [f, d] = e.target.value.split(':') as [
                    TransactionSortField,
                    SortDirection,
                  ];
                  setSortField(f);
                  setSortDirection(d);
                  setListPage(1);
                }}
                className="h-8 px-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="date:desc">Ngày mới → cũ</option>
                <option value="date:asc">Ngày cũ → mới</option>
                <option value="amount:desc">Tiền cao → thấp</option>
                <option value="amount:asc">Tiền thấp → cao</option>
                <option value="status:asc">Trạng thái</option>
              </select>
            </div>

            {/* Category filter + reset */}
            <div className="flex items-center gap-2">
              <select
                aria-label="Lọc danh mục"
                value={filterCategory}
                onChange={(e) => {
                  setFilterCategory(e.target.value);
                  setListPage(1);
                }}
                className="flex-1 h-8 px-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="ALL">Tất cả danh mục</option>
                {activeCategoryChoices.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>

              {(hasCombinedFilters || hasSearchQuery) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setFilterStatus('ALL');
                    setFilterAccountId('ALL');
                    setFilterCategory('ALL');
                    setFilterMonth('ALL');
                    setListPage(1);
                  }}
                  className="h-8 inline-flex items-center gap-1 px-2.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap"
                >
                  <FilterX className="w-3.5 h-3.5" />
                  <span>Đặt lại</span>
                </button>
              )}
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

          {paginatedList.items.length === 0 ? (
            <div className="py-12 px-4 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl space-y-3">
              <p>
                {hasSearchQuery || hasCombinedFilters
                  ? 'Không tìm thấy giao dịch nào khớp bộ lọc hiện tại.'
                  : isIncomeTab
                  ? 'Chưa có khoản thu nào đang xử lý.'
                  : isTransferTab
                  ? 'Chưa có lệnh chuyển khoản nội bộ nào.'
                  : 'Chưa có khoản chi nào đang xử lý.'}
              </p>
              {(hasSearchQuery || hasCombinedFilters) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setFilterStatus('ALL');
                    setFilterAccountId('ALL');
                    setFilterCategory('ALL');
                    setFilterMonth('ALL');
                    setListPage(1);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Xóa bộ lọc</span>
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {paginatedList.items.map((tx) => {
                const realized =
                  tx.kind === 'income'
                    ? isIncomeRealized(tx.status)
                    : tx.kind === 'transfer'
                    ? isTransferRealized(tx.status)
                    : isExpenseRealized(tx.status);
                const cancelled = isTransactionCancelled(tx.status);
                const statusMeta = getStatusMeta(tx.status);
                const noteContent = tx.description || tx.reason;
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
                          <span>
                            {tx.kind === 'transfer'
                              ? `TK: ${tx.accountName} → ${tx.toAccountName || '?'}`
                              : `TK: ${tx.accountName}`}
                          </span>
                          {tx.counterparty && <span>Đối tác: {tx.counterparty}</span>}
                          <span>Dự kiến: {formatDateVN(tx.expectedDate)}</span>
                          {tx.actualDate && (
                            <span>Thực tế: {formatDateVN(tx.actualDate)}</span>
                          )}
                          {tx.attachments.length > 0 && (
                            <span>Chứng từ: {tx.attachments.length} tệp</span>
                          )}
                        </div>
                        {noteContent && (
                          <p className="text-xs text-slate-500 truncate">
                            Ghi chú: {noteContent}
                          </p>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <p
                          className={`text-base font-extrabold font-mono tabular-nums ${
                            cancelled
                              ? 'line-through text-rose-500'
                              : tx.kind === 'income'
                              ? 'text-emerald-600'
                              : tx.kind === 'transfer'
                              ? 'text-indigo-700'
                              : 'text-rose-600'
                          }`}
                        >
                          {tx.kind === 'income'
                            ? '+'
                            : tx.kind === 'transfer'
                            ? '⇄ '
                            : '-'}
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

              {paginatedList.totalPages > 1 && (
                <div className="pt-2 flex items-center justify-between text-xs text-slate-600 border-t border-slate-100">
                  <span>
                    Hiển thị {paginatedList.startIndex + 1}–{paginatedList.endIndex} /{' '}
                    {paginatedList.totalItems} giao dịch
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={paginatedList.page <= 1}
                      onClick={() => setListPage((p) => Math.max(1, p - 1))}
                      className="px-2.5 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
                    >
                      Trước
                    </button>
                    <span className="font-mono font-semibold">
                      {paginatedList.page} / {paginatedList.totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={paginatedList.page >= paginatedList.totalPages}
                      onClick={() =>
                        setListPage((p) => Math.min(paginatedList.totalPages, p + 1))
                      }
                      className="px-2.5 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
                    >
                      Sau
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Single-Sheet Excel Import Preview Modal with Duplicate Detection */}
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
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-blue-50 border border-blue-200">
                  <span className="text-blue-700 block font-medium">Tài khoản</span>
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
                <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200">
                  <span className="text-indigo-700 block font-medium">Chuyển khoản</span>
                  <span className="text-lg font-bold font-mono text-indigo-800">
                    {importPreview.parsed.transfers.length}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-violet-50 border border-violet-200">
                  <span className="text-violet-700 block font-medium">Hạn mức</span>
                  <span className="text-lg font-bold font-mono text-violet-800">
                    {importPreview.parsed.budgets.length}
                  </span>
                </div>
              </div>

              {duplicateCheck && duplicateCheck.duplicateRowNumbers.size > 0 && (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-2">
                  <p className="font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>
                      Phát hiện {duplicateCheck.duplicateRowNumbers.size} giao dịch có dấu hiệu trùng lặp với sổ quỹ hiện tại hoặc trong tệp:
                    </span>
                  </p>
                  <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipExcelDuplicates}
                      onChange={(e) => setSkipExcelDuplicates(e.target.checked)}
                      className="rounded border-amber-400"
                    />
                    <span>Tự động bỏ qua các dòng trùng lặp khi nhập</span>
                  </label>
                </div>
              )}

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
                        <th className="py-2.5 px-3">Ngày / Ghi chú trùng</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {importPreview.parsed.accounts.map((a) => (
                        <tr key={`acc-${a.rowNumber}`}>
                          <td className="py-2 px-3 font-mono text-slate-500">{a.rowNumber}</td>
                          <td className="py-2 px-3 font-semibold text-blue-700">Tài khoản</td>
                          <td className="py-2 px-3 font-semibold text-slate-900">{a.name}</td>
                          <td className="py-2 px-3 text-slate-600">{a.type}</td>
                          <td className="py-2 px-3 text-right font-mono">
                            {formatVND(a.currentBalance)}
                          </td>
                          <td className="py-2 px-3 text-slate-500">—</td>
                        </tr>
                      ))}
                      {importPreview.parsed.budgets.map((b) => (
                        <tr key={`bdg-${b.rowNumber}`}>
                          <td className="py-2 px-3 font-mono text-slate-500">{b.rowNumber}</td>
                          <td className="py-2 px-3 font-semibold text-violet-700">Hạn mức</td>
                          <td className="py-2 px-3 font-semibold text-slate-900">{b.name}</td>
                          <td className="py-2 px-3 text-slate-600">{b.scopeValue}</td>
                          <td className="py-2 px-3 text-right font-mono">
                            {formatVND(b.limitAmount)}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-600">{b.yearMonth}</td>
                        </tr>
                      ))}
                      {[
                        ...importPreview.parsed.incomes,
                        ...importPreview.parsed.expenses,
                        ...importPreview.parsed.transfers,
                      ]
                        .slice(0, 25)
                        .map((tx) => {
                          const dupReason = duplicateCheck?.reasonByRow.get(tx.rowNumber);
                          return (
                            <tr
                              key={`tx-${tx.rowNumber}`}
                              className={dupReason ? 'bg-amber-50/60' : ''}
                            >
                              <td className="py-2 px-3 font-mono text-slate-500">
                                {tx.rowNumber}
                              </td>
                              <td
                                className={`py-2 px-3 font-semibold ${
                                  tx.kind === 'income'
                                    ? 'text-emerald-700'
                                    : tx.kind === 'transfer'
                                    ? 'text-indigo-700'
                                    : 'text-rose-600'
                                }`}
                              >
                                {tx.kind === 'income'
                                  ? 'Thu'
                                  : tx.kind === 'transfer'
                                  ? 'Chuyển khoản'
                                  : 'Chi'}
                              </td>
                              <td className="py-2 px-3 font-semibold text-slate-900">
                                {tx.name}
                              </td>
                              <td className="py-2 px-3 text-slate-600">{tx.category}</td>
                              <td className="py-2 px-3 text-right font-mono">
                                {formatVND(tx.actualAmount ?? tx.amount)}
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-600">
                                {formatDateVN(tx.actualDate || tx.expectedDate)}
                                {dupReason && (
                                  <span className="block text-[10px] font-sans font-semibold text-amber-800">
                                    {dupReason}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
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
