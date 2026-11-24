import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bell,
  CheckCircle2,
  CloudUpload,
  DatabaseBackup,
  ExternalLink,
  FolderOpen,
  HardDrive,
  History,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings,
  Sheet,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  INCOME_CATEGORIES,
  type BackupRecord,
  type BackupRecordType,
  type UserProfile,
} from '../types/finance';
import {
  addExpenseCategory,
  formatDateVN,
  moveExpenseCategory,
  paginateItems,
  removeExpenseCategory,
} from '../utils/financeRules';

interface SettingsPageProps {
  userEmail: string;
  userName: string;
  userUid: string;
  profile: UserProfile | null;
  expenseCategories: string[];
  incomeCategories: string[];
  backupHistory: BackupRecord[];
  hasDriveToken: boolean;
  onOpenExpenseCategoryModal: () => void;
  onUpdateIncomeCategories: (next: string[]) => Promise<void>;
  onUpdatePreferences: (patch: {
    reminderLeadDays?: number;
    defaultPageSize?: number;
    autoPreRestoreBackup?: boolean;
  }) => Promise<void>;
  onExportBackup: () => Promise<void>;
  onImportBackup: (
    file: File,
    options: { createPreRestoreSnapshot: boolean; skipDuplicateTransactions: boolean }
  ) => Promise<{ restoredCount: number; skippedDuplicates?: number }>;
  onDriveBackup: () => Promise<void>;
  onReconnectDrive: () => void;
  onSyncGoogleSheet: () => Promise<unknown>;
}

const BACKUP_TYPE_LABEL: Record<BackupRecordType, { label: string; badgeClass: string }> = {
  manual_export: {
    label: 'Xuất JSON thủ công',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  pre_restore_snapshot: {
    label: 'Snapshot trước khôi phục',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  restore: {
    label: 'Khôi phục dữ liệu',
    badgeClass: 'bg-violet-50 text-violet-700 border-violet-200',
  },
  drive_backup: {
    label: 'Sao lưu Google Drive',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  },
  excel_import: {
    label: 'Nhập Excel',
    badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',
  },
};

export const SettingsPage: React.FC<SettingsPageProps> = ({
  userEmail,
  userName,
  userUid,
  profile,
  expenseCategories,
  incomeCategories,
  backupHistory,
  hasDriveToken,
  onOpenExpenseCategoryModal,
  onUpdateIncomeCategories,
  onUpdatePreferences,
  onExportBackup,
  onImportBackup,
  onDriveBackup,
  onReconnectDrive,
  onSyncGoogleSheet,
}) => {
  const [activeTab, setActiveTab] = useState<'categories' | 'backup' | 'workspace' | 'security'>(
    'categories'
  );

  // Preferences state
  const [leadDays, setLeadDays] = useState<number>(profile?.reminderLeadDays ?? 3);
  const [pageSize, setPageSize] = useState<number>(profile?.defaultPageSize ?? 15);
  const [autoPreRestore, setAutoPreRestore] = useState<boolean>(
    profile?.autoPreRestoreBackup ?? true
  );
  const [savingPrefs, setSavingPrefs] = useState(false);

  useEffect(() => {
    setLeadDays(profile?.reminderLeadDays ?? 3);
    setPageSize(profile?.defaultPageSize ?? 15);
    setAutoPreRestore(profile?.autoPreRestoreBackup ?? true);
  }, [profile?.reminderLeadDays, profile?.defaultPageSize, profile?.autoPreRestoreBackup]);

  // Income categories management
  const [newIncomeCat, setNewIncomeCat] = useState('');
  const [catSaving, setCatSaving] = useState(false);
  const [catNotice, setCatNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  // Backup & Restore state
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [createSnapshot, setCreateSnapshot] = useState<boolean>(
    profile?.autoPreRestoreBackup ?? true
  );
  const [backingUpDrive, setBackingUpDrive] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [backupNotice, setBackupNotice] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  useEffect(() => {
    setCreateSnapshot(profile?.autoPreRestoreBackup ?? true);
  }, [profile?.autoPreRestoreBackup]);

  const paginatedHistory = useMemo(
    () => paginateItems(backupHistory, historyPage, 8),
    [backupHistory, historyPage]
  );

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingPrefs(true);
    setCatNotice(null);
    try {
      await onUpdatePreferences({
        reminderLeadDays: leadDays,
        defaultPageSize: pageSize,
        autoPreRestoreBackup: autoPreRestore,
      });
      setCatNotice({ type: 'success', text: 'Đã lưu tùy chọn hệ thống.' });
    } catch (err) {
      setCatNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể lưu tùy chọn.',
      });
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleAddIncomeCategory = async () => {
    setCatNotice(null);
    const res = addExpenseCategory(incomeCategories, newIncomeCat);
    if (res.error) {
      setCatNotice({
        type: 'error',
        text: res.error.replace('chi tiêu', 'thu nhập'),
      });
      return;
    }
    setCatSaving(true);
    try {
      await onUpdateIncomeCategories(res.next);
      setNewIncomeCat('');
      setCatNotice({ type: 'success', text: `Đã thêm danh mục thu "${res.added}".` });
    } catch (err) {
      setCatNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Lỗi cập nhật danh mục thu.',
      });
    } finally {
      setCatSaving(false);
    }
  };

  const handleMoveIncomeCategory = async (index: number, direction: 'up' | 'down') => {
    const next = moveExpenseCategory(incomeCategories, index, direction);
    setCatSaving(true);
    try {
      await onUpdateIncomeCategories(next);
    } finally {
      setCatSaving(false);
    }
  };

  const handleRemoveIncomeCategory = async (cat: string) => {
    setCatNotice(null);
    const res = removeExpenseCategory(incomeCategories, cat);
    if (res.error) {
      setCatNotice({
        type: 'error',
        text: res.error.replace('chi tiêu', 'thu nhập'),
      });
      return;
    }
    setCatSaving(true);
    try {
      await onUpdateIncomeCategories(res.next);
    } finally {
      setCatSaving(false);
    }
  };

  const handleResetIncomeCategories = async () => {
    setCatSaving(true);
    setCatNotice(null);
    try {
      await onUpdateIncomeCategories([...INCOME_CATEGORIES]);
      setCatNotice({ type: 'success', text: 'Đã khôi phục danh mục thu mặc định.' });
    } finally {
      setCatSaving(false);
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBackupNotice(null);
    setRestoring(true);
    try {
      const res = await onImportBackup(file, {
        createPreRestoreSnapshot: createSnapshot,
        skipDuplicateTransactions: skipDuplicates,
      });
      setBackupNotice({
        type: 'success',
        text: `Đã phục hồi ${res.restoredCount} bản ghi từ "${file.name}"${
          res.skippedDuplicates ? ` (bỏ qua ${res.skippedDuplicates} giao dịch trùng lặp)` : ''
        }.`,
      });
    } catch (err) {
      setBackupNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Khôi phục JSON thất bại.',
      });
    } finally {
      setRestoring(false);
      if (restoreInputRef.current) restoreInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6 animate-fintech-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-[#0B1437]">
            CÀI ĐẶT &amp; SAO LƯU HỆ THỐNG
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Quản lý danh mục, cấu hình hiển thị, sao lưu JSON/Google Drive &amp; bảo mật tài khoản
          </p>
        </div>
      </div>

      {/* 4 Sub-tabs */}
      <div
        role="tablist"
        aria-label="Phân mục cài đặt"
        className="grid grid-cols-2 lg:grid-cols-4 gap-2.5"
      >
        {(
          [
            { id: 'categories', label: 'Danh mục & Tùy chọn', Icon: SlidersHorizontal },
            { id: 'backup', label: 'Sao lưu & Phục hồi', Icon: DatabaseBackup },
            { id: 'workspace', label: 'Google Workspace', Icon: HardDrive },
            { id: 'security', label: 'Bảo mật & Toàn vẹn', Icon: ShieldCheck },
          ] as const
        ).map(({ id, label, Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl border text-xs sm:text-sm font-bold transition-all whitespace-nowrap ${
                active
                  ? 'bg-[#0B1437] border-[#0B1437] text-white shadow-md'
                  : 'bg-white border-slate-200/90 text-slate-700 hover:border-blue-300'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab 1: Categories & Preferences */}
      {activeTab === 'categories' && (
        <div className="space-y-6">
          {catNotice && (
            <div
              role="status"
              className={`p-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
                catNotice.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-700'
              }`}
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{catNotice.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* System Preferences Card */}
            <form
              onSubmit={handleSavePrefs}
              className="xl:col-span-5 bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4"
            >
              <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Cấu hình vận hành
                  </h2>
                  <p className="text-xs text-slate-500">
                    Đồng bộ trực tiếp với hồ sơ Firestore cá nhân
                  </p>
                </div>
              </div>

              <div>
                <label
                  htmlFor="pref-lead-days"
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 mb-1"
                >
                  <Bell className="w-3.5 h-3.5 text-slate-400" />
                  <span>Số ngày nhắc trước hạn mặc định</span>
                </label>
                <select
                  id="pref-lead-days"
                  value={leadDays}
                  onChange={(e) => setLeadDays(Number(e.target.value))}
                  className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                >
                  <option value={1}>Nhắc trước 1 ngày</option>
                  <option value={3}>Nhắc trước 3 ngày (Mặc định)</option>
                  <option value={7}>Nhắc trước 7 ngày</option>
                  <option value={14}>Nhắc trước 14 ngày</option>
                  <option value={30}>Nhắc trước 30 ngày</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="pref-page-size"
                  className="block text-xs font-semibold text-slate-700 mb-1"
                >
                  Số dòng hiển thị mỗi trang (Phân trang bảng)
                </label>
                <select
                  id="pref-page-size"
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="w-full h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
                >
                  <option value={10}>10 dòng / trang</option>
                  <option value={15}>15 dòng / trang (Mặc định)</option>
                  <option value={20}>20 dòng / trang</option>
                  <option value={50}>50 dòng / trang</option>
                </select>
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoPreRestore}
                  onChange={(e) => setAutoPreRestore(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300"
                />
                <span>
                  <strong className="text-slate-900 block">
                    Tự động sao lưu an toàn trước khi phục hồi JSON
                  </strong>
                  Tạo bản snapshot hiện tại trước khi ghi đè hoặc khôi phục từ tệp sao lưu.
                </span>
              </label>

              <button
                type="submit"
                disabled={savingPrefs}
                className="w-full h-10 inline-flex items-center justify-center gap-2 px-4 bg-[#0B1437] hover:bg-blue-900 text-white text-xs sm:text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
              >
                {savingPrefs && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Lưu cấu hình hệ thống</span>
              </button>
            </form>

            {/* Expense + Income Categories Management */}
            <div className="xl:col-span-7 space-y-5">
              {/* Expense Categories Shortcut Card */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900">
                      Danh mục chi tiêu ({expenseCategories.length})
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Sắp xếp thứ tự ưu tiên, thêm hoặc xóa danh mục chi tiêu
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenExpenseCategoryModal}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl transition-colors whitespace-nowrap"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>Chỉnh sửa danh mục chi</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {expenseCategories.slice(0, 14).map((cat) => (
                    <span
                      key={cat}
                      className="px-2.5 py-1 text-xs font-medium bg-slate-100 text-slate-700 rounded-lg"
                    >
                      {cat}
                    </span>
                  ))}
                  {expenseCategories.length > 14 && (
                    <span className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 rounded-lg">
                      +{expenseCategories.length - 14} mục khác
                    </span>
                  )}
                </div>
              </div>

              {/* Income Categories Inline Manager */}
              <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display text-base font-bold text-slate-900">
                      Danh mục thu nhập ({incomeCategories.length})
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Phản ánh ngay vào biểu mẫu tạo khoản thu &amp; tạo nhanh giao dịch
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleResetIncomeCategories}
                    disabled={catSaving}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Mặc định</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newIncomeCat}
                    onChange={(e) => setNewIncomeCat(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddIncomeCategory();
                      }
                    }}
                    placeholder="Nhập tên danh mục thu nhập mới..."
                    className="flex-1 h-9 px-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:bg-white"
                  />
                  <button
                    type="button"
                    disabled={catSaving}
                    onClick={handleAddIncomeCategory}
                    className="h-9 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm</span>
                  </button>
                </div>

                <ul className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl max-h-64 overflow-y-auto">
                  {incomeCategories.map((cat, idx) => (
                    <li
                      key={cat}
                      className="px-3.5 py-2 flex items-center justify-between gap-2 text-xs hover:bg-slate-50/70"
                    >
                      <span className="font-semibold text-slate-800 truncate">
                        {idx + 1}. {cat}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0 || catSaving}
                          onClick={() => handleMoveIncomeCategory(idx, 'up')}
                          aria-label={`Di chuyển ${cat} lên`}
                          className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded disabled:opacity-30"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === incomeCategories.length - 1 || catSaving}
                          onClick={() => handleMoveIncomeCategory(idx, 'down')}
                          aria-label={`Di chuyển ${cat} xuống`}
                          className="p-1 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded disabled:opacity-30"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={incomeCategories.length <= 1 || catSaving}
                          onClick={() => handleRemoveIncomeCategory(cat)}
                          aria-label={`Xóa ${cat}`}
                          className="p-1 text-rose-600 hover:bg-rose-50 rounded disabled:opacity-30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Backup & Restore */}
      {activeTab === 'backup' && (
        <div className="space-y-6">
          {backupNotice && (
            <div
              role="status"
              className={`p-3.5 rounded-xl border text-xs font-semibold ${
                backupNotice.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-700'
              }`}
            >
              {backupNotice.text}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Export & Cloud Drive Backup */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Sao lưu toàn bộ dữ liệu (JSON)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Bao gồm tài khoản, giao dịch (thu/chi/chuyển khoản), ngân sách, mục tiêu tiết kiệm &amp; cấu hình
                </p>
              </div>

              {profile?.lastDriveBackupAt && (
                <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 text-xs text-emerald-900 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Bản sao lưu Google Drive gần nhất:{' '}
                    <strong className="font-mono">
                      {formatDateVN(profile.lastDriveBackupAt.slice(0, 10))}
                    </strong>
                  </span>
                  {profile.lastDriveBackupFileId && (
                    <a
                      href={`https://drive.google.com/file/d/${profile.lastDriveBackupFileId}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-bold text-emerald-700 underline"
                    >
                      <span>Mở trên Drive</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={async () => {
                    setBackupNotice(null);
                    try {
                      await onExportBackup();
                      setBackupNotice({
                        type: 'success',
                        text: 'Đã tải xuống tệp sao lưu JSON toàn hệ thống.',
                      });
                    } catch (err) {
                      setBackupNotice({
                        type: 'error',
                        text: err instanceof Error ? err.message : 'Sao lưu thất bại.',
                      });
                    }
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-[#0B1437] hover:bg-blue-900 text-white text-xs sm:text-sm font-bold rounded-xl transition-colors whitespace-nowrap"
                >
                  <DatabaseBackup className="w-4 h-4" />
                  <span>Tải xuống tệp JSON</span>
                </button>

                <button
                  type="button"
                  disabled={backingUpDrive}
                  onClick={async () => {
                    if (!hasDriveToken) {
                      onReconnectDrive();
                      return;
                    }
                    setBackupNotice(null);
                    setBackingUpDrive(true);
                    try {
                      await onDriveBackup();
                      setBackupNotice({
                        type: 'success',
                        text: 'Đã tải bản sao lưu JSON an toàn lên Google Drive.',
                      });
                    } catch (err) {
                      setBackupNotice({
                        type: 'error',
                        text: err instanceof Error ? err.message : 'Sao lưu Drive thất bại.',
                      });
                    } finally {
                      setBackingUpDrive(false);
                    }
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold rounded-xl transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  {backingUpDrive ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudUpload className="w-4 h-4" />
                  )}
                  <span>
                    {hasDriveToken ? 'Sao lưu lên Google Drive' : 'Kết nối Drive để sao lưu'}
                  </span>
                </button>
              </div>
            </div>

            {/* Restore JSON with Safeguards */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Phục hồi từ tệp sao lưu JSON
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Kiểm tra cấu trúc hợp lệ, chống trùng lặp và tạo snapshot bảo vệ trước khi ghi
                </p>
              </div>

              <div className="space-y-2">
                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createSnapshot}
                    onChange={(e) => setCreateSnapshot(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300"
                  />
                  <span>
                    Tạo bản sao lưu tự động (snapshot) trước khi thực hiện phục hồi
                  </span>
                </label>

                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300"
                  />
                  <span>
                    Nhận diện &amp; bỏ qua giao dịch trùng mã hoặc trùng ngày/số tiền/tên
                  </span>
                </label>
              </div>

              <input
                ref={restoreInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleRestoreFile}
                className="hidden"
              />
              <button
                type="button"
                disabled={restoring}
                onClick={() => restoreInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold rounded-xl transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {restoring ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                <span>{restoring ? 'Đang phục hồi dữ liệu...' : 'Chọn tệp JSON để phục hồi'}</span>
              </button>
            </div>
          </div>

          {/* Backup History Table */}
          <div className="bg-white border border-slate-200/80 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-blue-600" />
                <h2 className="font-display text-base font-bold text-slate-900">
                  Lịch sử sao lưu &amp; nhập liệu ({backupHistory.length})
                </h2>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4 whitespace-nowrap">Loại thao tác</th>
                    <th className="py-3 px-4">Tên tệp</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Số bản ghi</th>
                    <th className="py-3 px-4">Ghi chú</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Liên kết</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                  {paginatedHistory.items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 px-4 text-center text-slate-400">
                        Chưa có bản ghi lịch sử sao lưu hoặc nhập dữ liệu nào.
                      </td>
                    </tr>
                  ) : (
                    paginatedHistory.items.map((item) => {
                      const meta = BACKUP_TYPE_LABEL[item.type] || BACKUP_TYPE_LABEL.manual_export;
                      return (
                        <tr key={item.id} className="hover:bg-slate-50/70">
                          <td className="py-3 px-4 whitespace-nowrap">
                            <span
                              className={`inline-flex px-2 py-0.5 text-xs font-bold rounded-md border ${meta.badgeClass}`}
                            >
                              {meta.label}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-800">
                            {item.fileName}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                            {item.recordCount}
                          </td>
                          <td className="py-3 px-4 text-xs text-slate-600">
                            {item.note || '—'}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {item.driveWebViewLink ? (
                              <a
                                href={item.driveWebViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                              >
                                <span>Drive</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span className="text-xs text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {paginatedHistory.totalPages > 1 && (
              <div className="px-5 py-3 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
                <span>
                  Trang {paginatedHistory.page} / {paginatedHistory.totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={paginatedHistory.page <= 1}
                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
                  >
                    Trước
                  </button>
                  <button
                    type="button"
                    disabled={paginatedHistory.page >= paginatedHistory.totalPages}
                    onClick={() =>
                      setHistoryPage((p) => Math.min(paginatedHistory.totalPages, p + 1))
                    }
                    className="px-2.5 py-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40"
                  >
                    Sau
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Google Workspace Connections */}
      {activeTab === 'workspace' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                  <HardDrive className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="font-display text-base font-bold text-slate-900">
                    Google Drive &amp; Lưu trữ chứng từ
                  </h2>
                  <p className="text-xs text-slate-500">
                    {hasDriveToken
                      ? 'Phiên OAuth đang hoạt động (Drive · Sheets · Calendar · Tasks)'
                      : 'Tùy chọn: kết nối khi muốn lưu chứng từ Drive hoặc đồng bộ Sheets'}
                  </p>
                </div>
              </div>
              <span
                className={`px-2.5 py-1 text-xs font-bold rounded-lg border whitespace-nowrap ${
                  hasDriveToken
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {hasDriveToken ? 'Đã kết nối' : 'Chưa kết nối'}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={onReconnectDrive}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#0B1437] hover:bg-blue-900 text-white text-xs font-bold rounded-xl transition-colors whitespace-nowrap"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{hasDriveToken ? 'Làm mới quyền Google' : 'Kết nối Google Workspace'}</span>
              </button>

              {profile?.driveRootFolderId && (
                <a
                  href={`https://drive.google.com/drive/folders/${profile.driveRootFolderId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>Mở thư mục gốc (5/)</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <Sheet className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">
                  Google Sheets Đồng Bộ Dữ Liệu
                </h2>
                <p className="text-xs text-slate-500">
                  Đồng bộ 5 bảng: Tổng quan, Khoản Thu, Khoản Chi, Chuyển Khoản &amp; Tài Khoản
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                disabled={syncingSheet}
                onClick={async () => {
                  if (!hasDriveToken) {
                    onReconnectDrive();
                    return;
                  }
                  setSyncingSheet(true);
                  try {
                    await onSyncGoogleSheet();
                  } finally {
                    setSyncingSheet(false);
                  }
                }}
                className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors whitespace-nowrap disabled:opacity-50"
              >
                {syncingSheet ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sheet className="w-3.5 h-3.5" />
                )}
                <span>{syncingSheet ? 'Đang đồng bộ...' : 'Đồng bộ ngay lên Sheets'}</span>
              </button>

              {profile?.spreadsheetId && (
                <a
                  href={`https://docs.google.com/spreadsheets/d/${profile.spreadsheetId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap"
                >
                  <span>Mở Google Sheet</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Security & Data Integrity */}
      {activeTab === 'security' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-100">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              <h2 className="font-display text-base font-bold text-slate-900">
                Thông tin xác thực &amp; phân quyền người dùng
              </h2>
            </div>

            <dl className="space-y-3 text-xs sm:text-sm">
              <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100">
                <dt className="text-slate-500">Tên hiển thị</dt>
                <dd className="font-semibold text-slate-900">{userName}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100">
                <dt className="text-slate-500">Email xác thực</dt>
                <dd className="font-mono font-semibold text-slate-900">{userEmail}</dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100">
                <dt className="text-slate-500">Mã định danh (UID)</dt>
                <dd className="font-mono text-xs text-slate-700 truncate max-w-[240px]">
                  {userUid}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 py-1.5">
                <dt className="text-slate-500">Chính sách lưu trữ token</dt>
                <dd className="font-semibold text-emerald-700">
                  Chỉ lưu trong bộ nhớ phiên (RAM)
                </dd>
              </div>
            </dl>
          </div>

          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-xs space-y-3">
            <h2 className="font-display text-base font-bold text-slate-900 pb-2 border-b border-slate-100">
              Quy tắc bảo vệ toàn vẹn sổ quỹ
            </h2>
            <ul className="space-y-2.5 text-xs text-slate-600">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Dữ liệu cô lập theo từng tài khoản (<code className="font-mono">users/{'{uid}'}</code>) và được kiểm soát bởi Firestore Security Rules.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Mọi số tiền VNĐ đều làm tròn số nguyên (<code className="font-mono">toVndInt</code>) nhằm loại bỏ sai số dấu phẩy động.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Chuyển khoản nội bộ (<code className="font-mono">CK</code>) trừ tài khoản nguồn và cộng tài khoản đích trong cùng 1 transaction nguyên tử, không tính vào thu/chi.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  Lưu trữ hồ sơ chỉ cập nhật trạng thái liên kết trên bản ghi gốc, không tạo bản sao giao dịch và hỗ trợ khôi phục tức thì.
                </span>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};
