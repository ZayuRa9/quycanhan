import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  DatabaseBackup,
  ExternalLink,
  Eye,
  File,
  FileCheck2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  History,
  RotateCcw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  INCOME_CATEGORIES,
  TRANSFER_CATEGORIES,
  type AuditLog,
  type Transaction,
} from '../types/finance';
import {
  computeArchiveSummary,
  formatDateVN,
  formatVND,
  getEffectiveTransactionAmount,
  getTransactionEffectiveDate,
  mergeExpenseCategories,
  paginateItems,
  sortTransactions,
  type SortDirection,
  type TransactionSortField,
} from '../utils/financeRules';
import { StatusText } from './StatusText';

interface ArchivePageProps {
  transactions: Transaction[];
  auditLogs: AuditLog[];
  expenseCategories: string[];
  hasDriveToken: boolean;
  defaultPageSize?: number;
  onRestoreFromArchive: (tx: Transaction) => Promise<void>;
  onDeleteConfirmed: (tx: Transaction, deleteDriveFiles: boolean) => Promise<void>;
  onExportBackup: () => Promise<void>;
  onImportBackup: (
    file: File,
    options?: { createPreRestoreSnapshot?: boolean; skipDuplicateTransactions?: boolean }
  ) => Promise<{ restoredCount: number; skippedDuplicates?: number }>;
}

function getFileTypeIcon(name: string, mimeType?: string) {
  const lower = name.toLowerCase();
  if (
    (mimeType && mimeType.startsWith('image/')) ||
    /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(lower)
  ) {
    return { Icon: FileImage, color: 'text-violet-600' };
  }
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') {
    return { Icon: FileText, color: 'text-rose-600' };
  }
  if (/\.(xlsx|xls|csv)$/i.test(lower)) {
    return { Icon: FileSpreadsheet, color: 'text-emerald-600' };
  }
  return { Icon: File, color: 'text-blue-600' };
}

export const ArchivePage: React.FC<ArchivePageProps> = ({
  transactions,
  auditLogs,
  expenseCategories,
  hasDriveToken,
  defaultPageSize = 15,
  onRestoreFromArchive,
  onDeleteConfirmed,
  onExportBackup,
  onImportBackup,
}) => {
  const allExpenseCategories = useMemo(
    () => mergeExpenseCategories(expenseCategories, transactions),
    [expenseCategories, transactions]
  );

  const [sectionTab, setSectionTab] = useState<'income' | 'expense' | 'transfer' | 'logs'>(
    'expense'
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMonth, setFilterMonth] = useState('ALL');
  const [filterYear, setFilterYear] = useState('ALL');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [sortField, setSortField] = useState<TransactionSortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [txPage, setTxPage] = useState(1);

  const [logEntityFilter, setLogEntityFilter] = useState<string>('ALL');
  const [logPage, setLogPage] = useState(1);

  const [inspectTx, setInspectTx] = useState<Transaction | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Transaction | null>(null);
  const [confirmCodeInput, setConfirmCodeInput] = useState('');
  const [deleteDriveAlso, setDeleteDriveAlso] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupErr, setBackupErr] = useState<string | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  const archivedTransactions = useMemo(
    () => transactions.filter((t) => t.isArchived),
    [transactions]
  );

  const archiveSummary = useMemo(
    () => computeArchiveSummary(transactions),
    [transactions]
  );

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    for (const tx of archivedTransactions) {
      const d = getTransactionEffectiveDate(tx);
      const m = /^(\d{4})/.exec(d);
      if (m) years.add(m[1]);
    }
    return Array.from(years).sort((a, b) => b.localeCompare(a));
  }, [archivedTransactions]);

  const filteredList = useMemo(() => {
    if (sectionTab === 'logs') return [];
    const q = searchQuery.trim().toLowerCase();
    const list = archivedTransactions.filter((tx) => {
      if (tx.kind !== sectionTab) return false;
      const dateStr = getTransactionEffectiveDate(tx);
      const m = /^(\d{4})-(\d{2})/.exec(dateStr);
      if (filterYear !== 'ALL' && (!m || m[1] !== filterYear)) return false;
      if (filterMonth !== 'ALL' && (!m || m[2] !== filterMonth)) return false;
      if (filterCategory !== 'ALL' && tx.category !== filterCategory) return false;
      if (q) {
        const hay = `${tx.code} ${tx.name} ${tx.description || ''} ${tx.counterparty || ''} ${tx.category} ${tx.accountName} ${tx.toAccountName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    return sortTransactions(list, sortField, sortDirection);
  }, [
    archivedTransactions,
    sectionTab,
    searchQuery,
    filterYear,
    filterMonth,
    filterCategory,
    sortField,
    sortDirection,
  ]);

  const paginatedArchived = useMemo(
    () => paginateItems(filteredList, txPage, defaultPageSize),
    [filteredList, txPage, defaultPageSize]
  );

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return auditLogs.filter((log) => {
      if (logEntityFilter !== 'ALL' && log.entityType !== logEntityFilter) return false;
      if (q) {
        const hay = `${log.entityCode} ${log.action} ${log.details} ${log.actorEmail}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [auditLogs, logEntityFilter, searchQuery]);

  const paginatedLogs = useMemo(
    () => paginateItems(filteredLogs, logPage, defaultPageSize),
    [filteredLogs, logPage, defaultPageSize]
  );

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    if (confirmCodeInput.trim() !== deleteTarget.code) return;
    setDeleting(true);
    try {
      await onDeleteConfirmed(deleteTarget, deleteDriveAlso);
      setDeleteTarget(null);
      setConfirmCodeInput('');
      setDeleteDriveAlso(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleRestoreTransaction = async (tx: Transaction) => {
    setRestoringId(tx.id);
    setBackupErr(null);
    try {
      await onRestoreFromArchive(tx);
      setBackupMsg(
        `Đã khôi phục giao dịch ${tx.code} về danh sách Giao dịch (giữ nguyên mã định danh & số dư).`
      );
      if (inspectTx?.id === tx.id) {
        setInspectTx(null);
      }
    } catch (err) {
      setBackupErr(
        err instanceof Error ? err.message : 'Không thể khôi phục giao dịch từ lưu trữ.'
      );
    } finally {
      setRestoringId(null);
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupErr(null);
    setBackupMsg(null);
    try {
      const res = await onImportBackup(file, {
        createPreRestoreSnapshot: true,
        skipDuplicateTransactions: true,
      });
      setBackupMsg(
        `Đã khôi phục thành công ${res.restoredCount} bản ghi từ tệp sao lưu${
          res.skippedDuplicates ? ` (bỏ qua ${res.skippedDuplicates} trùng lặp)` : ''
        }.`
      );
    } catch (err) {
      setBackupErr(err instanceof Error ? err.message : 'Khôi phục dữ liệu thất bại.');
    } finally {
      if (restoreInputRef.current) restoreInputRef.current.value = '';
    }
  };

  const categoryFilterOptions =
    sectionTab === 'income'
      ? INCOME_CATEGORIES
      : sectionTab === 'transfer'
      ? TRANSFER_CATEGORIES
      : allExpenseCategories;

  return (
    <div className="space-y-6 animate-fintech-in">
      {/* Header + Backup/Restore */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0B1437]">
            LƯU TRỮ HỒ SƠ &amp; CHỨNG TỪ
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Kho lưu trữ giao dịch đã hoàn thành (liên kết dữ liệu gốc), chứng từ Drive &amp; nhật ký thay đổi
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={async () => {
              setBackupErr(null);
              try {
                await onExportBackup();
                setBackupMsg('Đã tải xuống tệp sao lưu JSON toàn hệ thống.');
              } catch (err) {
                setBackupErr(err instanceof Error ? err.message : 'Sao lưu thất bại.');
              }
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200/90 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-50 shadow-xs transition-all whitespace-nowrap"
          >
            <DatabaseBackup className="w-4 h-4 text-blue-600" />
            <span>Sao lưu JSON</span>
          </button>

          <input
            ref={restoreInputRef}
            type="file"
            accept="application/json,.json"
            onChange={handleRestoreFile}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => restoreInputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0B1437] text-white text-sm font-semibold rounded-xl hover:bg-blue-900 shadow-xs transition-all whitespace-nowrap"
          >
            <Upload className="w-4 h-4" />
            <span>Khôi phục JSON</span>
          </button>
        </div>
      </div>

      {/* Archive Summary Cards (4 KPI cards including Internal Transfers) */}
      <section aria-label="Thống kê lưu trữ" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl p-5 bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/30 border border-emerald-200/80 shadow-xs flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
              Khoản thu đã hoàn thành
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-emerald-700">
              {formatVND(archiveSummary.archivedIncomeTotal)}
            </p>
            <p className="text-xs text-slate-600 font-medium">
              {archiveSummary.archivedIncomeCount} hồ sơ đã lưu trữ
            </p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-emerald-600/25">
            <ArrowDownLeft className="w-5 h-5" />
          </div>
        </div>

        <div className="rounded-2xl p-5 bg-gradient-to-br from-blue-50/90 via-white to-indigo-50/30 border border-blue-200/80 shadow-xs flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wider text-blue-700">
              Khoản chi đã hoàn thành
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-slate-900">
              {formatVND(archiveSummary.archivedExpenseTotal)}
            </p>
            <p className="text-xs text-slate-600 font-medium">
              {archiveSummary.archivedExpenseCount} hồ sơ đã quyết toán
            </p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-blue-600/25">
            <ArrowUpRight className="w-5 h-5" />
          </div>
        </div>

        <div className="rounded-2xl p-5 bg-gradient-to-br from-indigo-50/90 via-white to-slate-50/40 border border-indigo-200/80 shadow-xs flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">
              Chuyển khoản nội bộ
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-indigo-800">
              {formatVND(archiveSummary.archivedTransferTotal)}
            </p>
            <p className="text-xs text-slate-600 font-medium">
              {archiveSummary.archivedTransferCount} lệnh đã đối soát
            </p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-indigo-600/25">
            <ArrowLeftRight className="w-5 h-5" />
          </div>
        </div>

        <div className="rounded-2xl p-5 bg-gradient-to-br from-violet-50/90 via-white to-slate-50/40 border border-violet-200/80 shadow-xs flex items-center justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs font-bold uppercase tracking-wider text-violet-700">
              Chứng từ Drive &amp; Nhật ký
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono tabular-nums text-violet-900">
              {archiveSummary.totalAttachments} tệp
            </p>
            <p className="text-xs text-slate-600 font-medium">
              {auditLogs.length} bản ghi nhật ký thao tác
            </p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-violet-600 text-white flex items-center justify-center shrink-0 shadow-sm shadow-violet-600/25">
            <FileCheck2 className="w-5 h-5" />
          </div>
        </div>
      </section>

      {backupMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold">
          {backupMsg}
        </div>
      )}
      {backupErr && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 font-semibold">
          {backupErr}
        </div>
      )}

      {/* 4 Segmented Tabs */}
      <div
        role="tablist"
        aria-label="Phân loại lưu trữ"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      >
        <button
          type="button"
          role="tab"
          aria-selected={sectionTab === 'income'}
          onClick={() => {
            setSectionTab('income');
            setFilterCategory('ALL');
            setTxPage(1);
          }}
          className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl border text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
            sectionTab === 'income'
              ? 'bg-gradient-to-r from-emerald-600 to-teal-600 border-emerald-600 text-white shadow-md shadow-emerald-600/20'
              : 'bg-white border-slate-200/90 text-slate-700 hover:border-emerald-300'
          }`}
        >
          <Archive className="w-4 h-4 shrink-0" />
          <span>Lưu trữ Thu ({archiveSummary.archivedIncomeCount})</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={sectionTab === 'expense'}
          onClick={() => {
            setSectionTab('expense');
            setFilterCategory('ALL');
            setTxPage(1);
          }}
          className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl border text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
            sectionTab === 'expense'
              ? 'bg-gradient-to-r from-blue-600 to-indigo-600 border-blue-600 text-white shadow-md shadow-blue-600/20'
              : 'bg-white border-slate-200/90 text-slate-700 hover:border-blue-300'
          }`}
        >
          <Archive className="w-4 h-4 shrink-0" />
          <span>Lưu trữ Chi ({archiveSummary.archivedExpenseCount})</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={sectionTab === 'transfer'}
          onClick={() => {
            setSectionTab('transfer');
            setFilterCategory('ALL');
            setTxPage(1);
          }}
          className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl border text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
            sectionTab === 'transfer'
              ? 'bg-gradient-to-r from-indigo-600 to-violet-600 border-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'bg-white border-slate-200/90 text-slate-700 hover:border-indigo-300'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4 shrink-0" />
          <span>Chuyển khoản ({archiveSummary.archivedTransferCount})</span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={sectionTab === 'logs'}
          onClick={() => {
            setSectionTab('logs');
            setLogPage(1);
          }}
          className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl border text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
            sectionTab === 'logs'
              ? 'bg-gradient-to-r from-[#0B1437] to-slate-800 border-[#0B1437] text-white shadow-md'
              : 'bg-white border-slate-200/90 text-slate-700 hover:border-slate-300'
          }`}
        >
          <History className="w-4 h-4 shrink-0" />
          <span>Nhật ký thay đổi ({auditLogs.length})</span>
        </button>
      </div>

      {sectionTab === 'logs' ? (
        <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="font-display text-base font-bold text-slate-900">
              Lịch sử thay đổi &amp; Người thực hiện ({filteredLogs.length})
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setLogPage(1);
                  }}
                  placeholder="Tìm mã, thao tác, chi tiết..."
                  className="h-8 pl-8 pr-3 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <select
                value={logEntityFilter}
                onChange={(e) => {
                  setLogEntityFilter(e.target.value);
                  setLogPage(1);
                }}
                aria-label="Lọc theo đối tượng nhật ký"
                className="h-8 px-2.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="ALL">Tất cả đối tượng</option>
                <option value="transaction">Giao dịch</option>
                <option value="account">Tài khoản</option>
                <option value="budget">Ngân sách</option>
                <option value="savings">Tiết kiệm</option>
                <option value="backup">Sao lưu / Phục hồi</option>
                <option value="settings">Cài đặt</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Phân hệ</th>
                  <th className="py-3 px-4">Đối tượng / Mã</th>
                  <th className="py-3 px-4">Thao tác</th>
                  <th className="py-3 px-4">Chi tiết</th>
                  <th className="py-3 px-4">Người thực hiện</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {paginatedLogs.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 px-4 text-center text-slate-400">
                      Chưa có nhật ký thao tác nào khớp bộ lọc.
                    </td>
                  </tr>
                ) : (
                  paginatedLogs.items.map((log) => (
                    <tr key={log.id} className="hover:bg-blue-50/35">
                      <td className="py-3 px-4 text-xs uppercase font-bold text-slate-500 whitespace-nowrap">
                        {log.entityType}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs font-bold text-slate-900 whitespace-nowrap">
                        {log.entityCode}
                      </td>
                      <td className="py-3 px-4 text-xs font-semibold text-blue-700 whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600">{log.details}</td>
                      <td className="py-3 px-4 text-xs text-slate-500 whitespace-nowrap">
                        {log.actorEmail}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {paginatedLogs.totalPages > 1 && (
            <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <span>
                Hiển thị {paginatedLogs.startIndex + 1}–{paginatedLogs.endIndex} /{' '}
                {paginatedLogs.totalItems} nhật ký
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={paginatedLogs.page <= 1}
                  onClick={() => setLogPage((p) => Math.max(1, p - 1))}
                  className="px-2.5 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
                >
                  Trước
                </button>
                <span className="font-mono font-semibold">
                  {paginatedLogs.page} / {paginatedLogs.totalPages}
                </span>
                <button
                  type="button"
                  disabled={paginatedLogs.page >= paginatedLogs.totalPages}
                  onClick={() => setLogPage((p) => Math.min(paginatedLogs.totalPages, p + 1))}
                  className="px-2.5 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
                >
                  Sau
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Search, Filter & Sort Bar */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                aria-label="Tìm theo mã, tên giao dịch, nội dung"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setTxPage(1);
                }}
                placeholder="Tìm mã (KT/KC/CK), tên, nội dung, đối tác..."
                className="w-full h-9 pl-9 pr-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
            </div>

            <select
              aria-label="Lọc theo tháng"
              value={filterMonth}
              onChange={(e) => {
                setFilterMonth(e.target.value);
                setTxPage(1);
              }}
              className="h-9 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            >
              <option value="ALL">Tất cả tháng</option>
              {Array.from({ length: 12 }, (_, i) => {
                const m = String(i + 1).padStart(2, '0');
                return (
                  <option key={m} value={m}>
                    Tháng {m}
                  </option>
                );
              })}
            </select>

            <select
              aria-label="Lọc theo năm"
              value={filterYear}
              onChange={(e) => {
                setFilterYear(e.target.value);
                setTxPage(1);
              }}
              className="h-9 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            >
              <option value="ALL">Tất cả năm</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  Năm {y}
                </option>
              ))}
            </select>

            <select
              aria-label="Lọc theo loại giao dịch"
              value={filterCategory}
              onChange={(e) => {
                setFilterCategory(e.target.value);
                setTxPage(1);
              }}
              className="h-9 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            >
              <option value="ALL">Tất cả loại</option>
              {categoryFilterOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              aria-label="Sắp xếp lưu trữ"
              value={`${sortField}:${sortDirection}`}
              onChange={(e) => {
                const [f, d] = e.target.value.split(':') as [
                  TransactionSortField,
                  SortDirection,
                ];
                setSortField(f);
                setSortDirection(d);
                setTxPage(1);
              }}
              className="h-9 px-2.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
            >
              <option value="date:desc">Ngày mới → cũ</option>
              <option value="date:asc">Ngày cũ → mới</option>
              <option value="amount:desc">Số tiền cao → thấp</option>
              <option value="amount:asc">Số tiền thấp → cao</option>
              <option value="code:desc">Mã GD Z → A</option>
              <option value="name:asc">Tên A → Z</option>
            </select>
          </div>

          {/* Archive Table */}
          <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4 whitespace-nowrap">Mã GD</th>
                    <th className="py-3 px-4 whitespace-nowrap">Ngày hoàn tất</th>
                    <th className="py-3 px-4">Giao dịch &amp; Tài khoản</th>
                    <th className="py-3 px-4 whitespace-nowrap">Loại / Hình thức</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Số tiền</th>
                    <th className="py-3 px-4 whitespace-nowrap">Chứng từ Drive</th>
                    <th className="py-3 px-4 whitespace-nowrap">Trạng thái</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {paginatedArchived.items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-10 px-4 text-center text-slate-400">
                        Chưa có giao dịch đã hoàn thành nào trong mục lưu trữ này.
                      </td>
                    </tr>
                  ) : (
                    paginatedArchived.items.map((tx) => (
                      <tr key={tx.id} className="hover:bg-blue-50/35 transition-colors">
                        <td className="py-3 px-4 font-mono text-xs font-bold text-slate-900 whitespace-nowrap">
                          {tx.code}
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                          {formatDateVN(getTransactionEffectiveDate(tx))}
                        </td>
                        <td className="py-3 px-4 max-w-[240px]">
                          <div className="font-semibold text-slate-900 truncate">{tx.name}</div>
                          <div className="text-xs text-slate-500 truncate">
                            {tx.kind === 'transfer'
                              ? `${tx.accountName} → ${tx.toAccountName || '?'}`
                              : `${tx.counterparty ? `Đối tác: ${tx.counterparty} · ` : ''}${tx.accountName}`}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          <div className="font-semibold text-slate-800">{tx.category}</div>
                          <div>{tx.method}</div>
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-mono tabular-nums font-bold whitespace-nowrap ${
                            tx.kind === 'income'
                              ? 'text-emerald-600'
                              : tx.kind === 'transfer'
                              ? 'text-indigo-700'
                              : 'text-blue-700'
                          }`}
                        >
                          {tx.kind === 'income' ? '+' : tx.kind === 'transfer' ? '⇄ ' : '-'}
                          {formatVND(getEffectiveTransactionAmount(tx))}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          {tx.attachments.length === 0 ? (
                            <span className="text-slate-400">Không có</span>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {tx.attachments.map((att) => {
                                const { Icon, color } = getFileTypeIcon(att.name, att.mimeType);
                                return (
                                  <a
                                    key={att.id}
                                    href={att.webViewLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1.5 font-mono text-blue-700 hover:underline whitespace-nowrap"
                                  >
                                    <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
                                    <span>{att.name}</span>
                                    <ExternalLink className="w-3 h-3 shrink-0 text-slate-400" />
                                  </a>
                                );
                              })}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <StatusText status={tx.status} kind={tx.kind} />
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setInspectTx(tx)}
                              aria-label={`Xem chi tiết ${tx.code}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Chi tiết</span>
                            </button>
                            <button
                              type="button"
                              disabled={restoringId === tx.id}
                              onClick={() => handleRestoreTransaction(tx)}
                              aria-label={`Khôi phục ${tx.code}`}
                              title="Khôi phục về danh sách giao dịch (không nhân bản)"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors disabled:opacity-50"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Khôi phục</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteTarget(tx);
                                setConfirmCodeInput('');
                                setDeleteDriveAlso(false);
                              }}
                              aria-label={`Xóa ${tx.code}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Xóa</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {paginatedArchived.totalPages > 1 && (
              <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                <span>
                  Hiển thị {paginatedArchived.startIndex + 1}–{paginatedArchived.endIndex} /{' '}
                  {paginatedArchived.totalItems} hồ sơ lưu trữ
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={paginatedArchived.page <= 1}
                    onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
                  >
                    Trước
                  </button>
                  <span className="font-mono font-semibold">
                    {paginatedArchived.page} / {paginatedArchived.totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={paginatedArchived.page >= paginatedArchived.totalPages}
                    onClick={() => setTxPage((p) => Math.min(paginatedArchived.totalPages, p + 1))}
                    className="px-2.5 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
                  >
                    Sau
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Detail Inspector Modal */}
      {inspectTx && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Chi tiết giao dịch ${inspectTx.code}`}
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4 pb-3 border-b border-slate-200">
              <div>
                <span className="font-mono text-xs font-bold text-blue-700">
                  {inspectTx.code} ·{' '}
                  {inspectTx.kind === 'income'
                    ? 'KHOẢN THU'
                    : inspectTx.kind === 'transfer'
                    ? 'CHUYỂN KHOẢN NỘI BỘ'
                    : 'KHOẢN CHI'}
                </span>
                <h3 className="font-display text-lg font-bold text-slate-900 mt-0.5">
                  {inspectTx.name}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={restoringId === inspectTx.id}
                  onClick={() => handleRestoreTransaction(inspectTx)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Khôi phục về sổ giao dịch</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInspectTx(null)}
                  aria-label="Đóng chi tiết"
                  className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-xs text-slate-500 block">Số tiền thực tế</span>
                <span
                  className={`font-mono font-extrabold text-base ${
                    inspectTx.kind === 'income'
                      ? 'text-emerald-600'
                      : inspectTx.kind === 'transfer'
                      ? 'text-indigo-700'
                      : 'text-blue-700'
                  }`}
                >
                  {formatVND(getEffectiveTransactionAmount(inspectTx))}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Trạng thái</span>
                <div className="mt-0.5">
                  <StatusText status={inspectTx.status} kind={inspectTx.kind} />
                </div>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Loại &amp; Hình thức</span>
                <span className="font-semibold text-slate-900">
                  {inspectTx.category} · {inspectTx.method}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">
                  {inspectTx.kind === 'transfer' ? 'Tài khoản nguồn → đích' : 'Tài khoản'}
                </span>
                <span className="font-semibold text-slate-900">
                  {inspectTx.accountName}
                  {inspectTx.kind === 'transfer' && inspectTx.toAccountName
                    ? ` → ${inspectTx.toAccountName}`
                    : ''}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">
                  {inspectTx.kind === 'income' ? 'Người/Đơn vị gửi' : 'Người/Đơn vị nhận'}
                </span>
                <span className="font-semibold text-slate-900">
                  {inspectTx.counterparty || '—'}
                </span>
              </div>
              <div>
                <span className="text-xs text-slate-500 block">Ngày dự kiến / Thực tế</span>
                <span className="font-mono text-slate-900">
                  {formatDateVN(inspectTx.expectedDate)} / {formatDateVN(inspectTx.actualDate)}
                </span>
              </div>
              {inspectTx.source && (
                <div>
                  <span className="text-xs text-slate-500 block">Nguồn khoản thu</span>
                  <span className="text-slate-900">{inspectTx.source}</span>
                </div>
              )}
              {inspectTx.reason && (
                <div>
                  <span className="text-xs text-slate-500 block">Lý do</span>
                  <span className="text-slate-900">{inspectTx.reason}</span>
                </div>
              )}
              {inspectTx.description && (
                <div className="sm:col-span-2">
                  <span className="text-xs text-slate-500 block">Mô tả chi tiết</span>
                  <p className="text-slate-800 whitespace-pre-line mt-0.5">
                    {inspectTx.description}
                  </p>
                </div>
              )}
            </div>

            {/* Attached Receipts on Google Drive */}
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <h4 className="text-sm font-bold text-slate-900">
                Chứng từ &amp; Sao kê đính kèm trên Google Drive
              </h4>
              {inspectTx.attachments.length === 0 ? (
                <p className="text-xs text-slate-500">Không có tệp đính kèm.</p>
              ) : (
                <ul className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
                  {inspectTx.attachments.map((att) => {
                    const { Icon, color } = getFileTypeIcon(att.name, att.mimeType);
                    return (
                      <li
                        key={att.id}
                        className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <Icon className={`w-4 h-4 shrink-0 ${color}`} />
                          <div className="min-w-0">
                            <p className="font-mono font-semibold text-slate-900 truncate">
                              {att.name}
                            </p>
                            <p className="text-slate-500 font-mono">
                              Thư mục: {att.driveFolderPath}/
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <a
                            href={`https://drive.google.com/drive/folders/${att.driveFolderId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg"
                          >
                            <FolderOpen className="w-3.5 h-3.5" />
                            <span>Thư mục</span>
                          </a>
                          <a
                            href={att.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg"
                          >
                            <span>Mở tệp</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {/* Status Update Audit History */}
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <h4 className="text-sm font-bold text-slate-900">
                Lịch sử cập nhật trạng thái
              </h4>
              <ul className="space-y-2 text-xs">
                {inspectTx.auditHistory.map((h, i) => (
                  <li
                    key={i}
                    className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <span className="font-bold text-slate-900">{h.action}</span>
                      {h.fromStatus && h.toStatus && (
                        <span className="text-slate-600 ml-2">
                          ({h.fromStatus} → {h.toStatus})
                        </span>
                      )}
                      {h.note && <span className="text-slate-500 ml-2">· {h.note}</span>}
                    </div>
                    <span className="font-mono text-slate-500">
                      {h.actorEmail} · {formatDateVN(h.timestamp.slice(0, 10))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Explicit Safe Delete Confirmation Dialog */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Xác nhận xóa giao dịch"
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-start gap-3 text-rose-700">
              <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Xác nhận xóa giao dịch lưu trữ
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  Hành động này không thể hoàn tác. Mã giao dịch{' '}
                  <strong className="font-mono">{deleteTarget.code}</strong> sẽ không bị tái sử dụng.
                </p>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1">
              <p>
                <span className="text-slate-500">Mã giao dịch:</span>{' '}
                <strong className="font-mono text-slate-900">{deleteTarget.code}</strong>
              </p>
              <p>
                <span className="text-slate-500">Tên giao dịch:</span>{' '}
                <strong className="text-slate-900">{deleteTarget.name}</strong>
              </p>
              <p>
                <span className="text-slate-500">Số tiền:</span>{' '}
                <strong className="font-mono text-slate-900">
                  {formatVND(getEffectiveTransactionAmount(deleteTarget))}
                </strong>
              </p>
            </div>

            {deleteTarget.attachments.length > 0 && hasDriveToken && (
              <label className="flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteDriveAlso}
                  onChange={(e) => setDeleteDriveAlso(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <span>
                  Đồng thời xóa {deleteTarget.attachments.length} tệp chứng từ khỏi Google Drive (nếu không chọn, chứng từ trên Drive vẫn được giữ nguyên).
                </span>
              </label>
            )}

            <div>
              <label htmlFor="confirm-del-code" className="block text-xs font-semibold text-slate-700 mb-1">
                Nhập chính xác mã <strong className="font-mono">{deleteTarget.code}</strong> để xác nhận:
              </label>
              <input
                id="confirm-del-code"
                type="text"
                value={confirmCodeInput}
                onChange={(e) => setConfirmCodeInput(e.target.value)}
                placeholder={deleteTarget.code}
                className="w-full h-9 px-3 text-sm font-mono bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-600"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                disabled={deleting || confirmCodeInput.trim() !== deleteTarget.code}
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl disabled:opacity-40"
              >
                {deleting ? 'Đang xóa...' : 'Xác nhận xóa vĩnh viễn'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
