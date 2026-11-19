import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SignInScreen } from './components/SignInScreen';
import { SidebarLayout, type ActivePage } from './components/SidebarLayout';
import { OverviewPage } from './components/OverviewPage';
import { TransactionsPage } from './components/TransactionsPage';
import { ArchivePage } from './components/ArchivePage';
import { DashboardSkeleton } from './components/DashboardSkeleton';
import { QuickTransactionModal } from './components/QuickTransactionModal';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { ToastContainer, type ToastItem, type ToastVariant } from './components/ToastContainer';
import type { QueuedUploadFile } from './components/DriveUploader';
import {
  clearAccessToken,
  getAccessToken,
  googleSignIn,
  initAuth,
  logout,
} from './services/firebase';
import {
  createAccount,
  createBudgetLimit,
  deleteBudgetLimit,
  deleteTransactionConfirmed,
  ensureUserProfile,
  exportFullBackupData,
  peekNextTransactionCode,
  reconcileAccount,
  reserveAndCreateTransaction,
  restoreBackupData,
  subscribeAccounts,
  subscribeAuditLogs,
  subscribeBudgets,
  subscribeTransactions,
  subscribeUserProfile,
  updateAccount,
  updateTransactionRecord,
  updateUserWorkspaceMeta,
} from './services/firestoreLedger';
import {
  createCalendarReminder,
  createFinancialTask,
  deleteDriveFile,
  syncLedgerToGoogleSheet,
  syncTransactionStatusMetadataOnDrive,
  uploadReceiptToDrive,
  WorkspaceAuthError,
} from './services/googleWorkspace';
import {
  EXPENSE_CATEGORIES,
  type AuditLog,
  type BudgetLimit,
  type DriveAttachment,
  type FinancialAccount,
  type Transaction,
  type TransactionKind,
  type UserProfile,
} from './types/finance';
import {
  computeTransactionReminders,
  evaluateBudget,
  formatVND,
} from './utils/financeRules';
import {
  isEditableTarget,
  resolveKeyboardShortcut,
  type ModalLayerState,
} from './utils/keyboardShortcuts';
import type { SingleSheetParseResult } from './utils/excelTemplate';

function FinanceAppShell() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activePage, setActivePage] = useState<ActivePage>('overview');
  const [quickTxModalOpen, setQuickTxModalOpen] = useState(false);
  const [shortcutsHelpOpen, setShortcutsHelpOpen] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<BudgetLimit[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [transactionsLoaded, setTransactionsLoaded] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (variant: ToastVariant, title: string, message?: string) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-3), { id, variant, title, message }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const [pushPermission, setPushPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() =>
    typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported'
  );
  const [pushEnabled, setPushEnabled] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      'Notification' in window &&
      Notification.permission === 'granted'
  );
  const sentNotificationsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsub = initAuth((fbUser, token) => {
      setUser(fbUser);
      setAccessToken(token);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setAccounts([]);
      setTransactions([]);
      setBudgets([]);
      setAuditLogs([]);
      setAccountsLoaded(false);
      setTransactionsLoaded(false);
      return;
    }

    ensureUserProfile(user).catch((err) => {
      console.error('Failed to ensure user profile:', err);
    });

    const unsubProfile = subscribeUserProfile(user.uid, setProfile);
    const unsubAccounts = subscribeAccounts(user.uid, (rows) => {
      setAccounts(rows);
      setAccountsLoaded(true);
    });
    const unsubTransactions = subscribeTransactions(user.uid, (rows) => {
      setTransactions(rows);
      setTransactionsLoaded(true);
    });
    const unsubBudgets = subscribeBudgets(user.uid, setBudgets);
    const unsubLogs = subscribeAuditLogs(user.uid, setAuditLogs);

    return () => {
      unsubProfile();
      unsubAccounts();
      unsubTransactions();
      unsubBudgets();
      unsubLogs();
    };
  }, [user]);

  const handleTogglePush = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setPushPermission('unsupported');
      return;
    }
    if (Notification.permission === 'default') {
      const perm = await Notification.requestPermission();
      setPushPermission(perm);
      setPushEnabled(perm === 'granted');
      return;
    }
    setPushPermission(Notification.permission);
    if (Notification.permission === 'granted') {
      setPushEnabled((prev) => !prev);
    }
  }, []);

  // Trigger browser Push Notifications when enabled for due/overdue reminders & 80%/100% budgets
  useEffect(() => {
    if (!user || !pushEnabled || pushPermission !== 'granted') return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;

    const todayIso = new Date().toISOString().slice(0, 10);
    const reminders = computeTransactionReminders(transactions, todayIso, 3);
    for (const rem of reminders) {
      const key = `rem:${rem.transaction.id}:${rem.severity}`;
      if (!sentNotificationsRef.current.has(key)) {
        sentNotificationsRef.current.add(key);
        new Notification(`Nhắc nhở ${rem.transaction.code}`, {
          body: `${rem.transaction.name} (${formatVND(rem.transaction.amount)}) — ${rem.message}`,
        });
      }
    }

    for (const b of budgets) {
      const ev = evaluateBudget(b, transactions);
      if (ev.alertLevel === 'ok') continue;
      const key = `bdg:${b.id}:${ev.alertLevel}`;
      if (!sentNotificationsRef.current.has(key)) {
        sentNotificationsRef.current.add(key);
        new Notification(`Cảnh báo ngân sách: ${b.name}`, {
          body: `Đã chi ${ev.percent.toFixed(1)}% (${formatVND(ev.spent)} / ${formatVND(b.limitAmount)})`,
        });
      }
    }
  }, [user, pushEnabled, pushPermission, transactions, budgets]);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn(false);
      setUser(result.user);
      setAccessToken(result.accessToken);
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Đăng nhập Google thất bại. Vui lòng thử lại.'
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleReconnectDrive = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const result = await googleSignIn(true);
      setUser(result.user);
      setAccessToken(result.accessToken);
    } catch (err) {
      console.error('Reconnect Drive error:', err);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await logout();
    setAccessToken(null);
    setUser(null);
  };

  const requireWorkspaceToken = useCallback((): string => {
    const token = getAccessToken() || accessToken;
    if (!token) {
      throw new Error(
        'Chưa có phiên kết nối Google Drive. Vui lòng nhấn "Kết nối Google Drive" để cấp quyền.'
      );
    }
    return token;
  }, [accessToken]);

  const handleWorkspaceError = useCallback((err: unknown) => {
    if (err instanceof WorkspaceAuthError) {
      clearAccessToken();
      setAccessToken(null);
    }
    throw err;
  }, []);

  const handlePeekCode = useCallback(
    async (kind: TransactionKind, dateForCode: string) => {
      if (!user) return '';
      return peekNextTransactionCode(user.uid, kind, dateForCode);
    },
    [user]
  );

  const handleSaveNewTransaction = useCallback(
    async (params: {
      draft: Omit<
        Transaction,
        'id' | 'userId' | 'code' | 'auditHistory' | 'createdAt' | 'updatedAt'
      > & { dateForCode: string };
      queuedFiles: QueuedUploadFile[];
    }): Promise<Transaction> => {
      if (!user) throw new Error('Chưa đăng nhập.');
      const actorEmail = user.email || user.uid;
      const { draft, queuedFiles } = params;

      const targetStatus = draft.status;
      const targetArchive = draft.isArchived;

      const initialPendingStatus = 'Dự kiến' as const;

      const created = await reserveAndCreateTransaction(user.uid, actorEmail, {
        ...draft,
        status: queuedFiles.length > 0 ? initialPendingStatus : targetStatus,
        isArchived: queuedFiles.length > 0 ? false : targetArchive,
      });

      const uploadedAttachments: DriveAttachment[] = [];
      let rootFolderId = profile?.driveRootFolderId;

      if (queuedFiles.length > 0) {
        try {
          const token = requireWorkspaceToken();
          const folderDate =
            draft.actualDate || draft.expectedDate || draft.startDate || draft.dateForCode;

          for (const item of queuedFiles) {
            const res = await uploadReceiptToDrive({
              accessToken: token,
              txCode: created.code,
              isoDate: folderDate,
              file: item.file,
              existingAttachments: uploadedAttachments,
              incomingBatchSize: queuedFiles.length - uploadedAttachments.length,
              status: targetStatus,
              cachedRootFolderId: rootFolderId,
              customBaseName: item.customName,
            });
            uploadedAttachments.push(res.attachment);
            rootFolderId = res.rootFolderId;
          }

          const updatedSnapshot: Transaction = {
            ...created,
            status: targetStatus,
            isArchived: targetArchive,
            attachments: uploadedAttachments,
          };

          const metaSync = await syncTransactionStatusMetadataOnDrive({
            accessToken: token,
            tx: updatedSnapshot,
            cachedRootFolderId: rootFolderId,
          });
          rootFolderId = metaSync.rootFolderId;

          if (rootFolderId && rootFolderId !== profile?.driveRootFolderId) {
            await updateUserWorkspaceMeta(user.uid, {
              driveRootFolderId: rootFolderId,
            });
          }

          await updateTransactionRecord(
            user.uid,
            actorEmail,
            created,
            {
              status: targetStatus,
              isArchived: targetArchive,
              attachments: uploadedAttachments,
              driveMetadataFileId: metaSync.metadataFileId,
            },
            'Tải chứng từ lên Google Drive & hoàn tất trạng thái'
          );

          addToast('success', `Đã lưu ${created.code}`, 'Đã tải chứng từ lên Google Drive');
          return {
            ...updatedSnapshot,
            driveMetadataFileId: metaSync.metadataFileId,
          };
        } catch (err) {
          handleWorkspaceError(err);
        }
      } else if (accessToken) {
        try {
          const metaSync = await syncTransactionStatusMetadataOnDrive({
            accessToken,
            tx: created,
            cachedRootFolderId: rootFolderId,
          });
          await updateTransactionRecord(
            user.uid,
            actorEmail,
            created,
            { driveMetadataFileId: metaSync.metadataFileId },
            'Đồng bộ trạng thái lên Google Drive'
          );
          if (metaSync.rootFolderId && metaSync.rootFolderId !== profile?.driveRootFolderId) {
            await updateUserWorkspaceMeta(user.uid, {
              driveRootFolderId: metaSync.rootFolderId,
            });
          }
        } catch (err) {
          console.warn('Drive status manifest sync skipped:', err);
        }
      }

      addToast('success', `Đã tạo giao dịch ${created.code}`, created.name);
      return created;
    },
    [user, profile, accessToken, requireWorkspaceToken, handleWorkspaceError, addToast]
  );

  const handleUpdateTransaction = useCallback(
    async (params: {
      existingTx: Transaction;
      updates: Partial<
        Omit<Transaction, 'id' | 'userId' | 'code' | 'kind' | 'createdAt'>
      >;
      queuedFiles: QueuedUploadFile[];
      actionNote?: string;
    }) => {
      if (!user) throw new Error('Chưa đăng nhập.');
      const actorEmail = user.email || user.uid;
      const { existingTx, updates, queuedFiles, actionNote } = params;

      const combinedAttachments = [
        ...(updates.attachments ?? existingTx.attachments),
      ];
      let rootFolderId = profile?.driveRootFolderId;
      let metadataFileId = existingTx.driveMetadataFileId;

      if (queuedFiles.length > 0) {
        try {
          const token = requireWorkspaceToken();
          const folderDate =
            updates.actualDate ||
            existingTx.actualDate ||
            updates.expectedDate ||
            existingTx.expectedDate;

          for (const item of queuedFiles) {
            const res = await uploadReceiptToDrive({
              accessToken: token,
              txCode: existingTx.code,
              isoDate: folderDate,
              file: item.file,
              existingAttachments: combinedAttachments,
              incomingBatchSize:
                queuedFiles.length -
                (combinedAttachments.length -
                  (updates.attachments ?? existingTx.attachments).length),
              status: updates.status ?? existingTx.status,
              cachedRootFolderId: rootFolderId,
              customBaseName: item.customName,
            });
            combinedAttachments.push(res.attachment);
            rootFolderId = res.rootFolderId;
          }
        } catch (err) {
          handleWorkspaceError(err);
        }
      }

      const token = getAccessToken() || accessToken;
      if (token) {
        try {
          const mergedTx: Transaction = {
            ...existingTx,
            ...updates,
            attachments: combinedAttachments,
          };
          const syncRes = await syncTransactionStatusMetadataOnDrive({
            accessToken: token,
            tx: mergedTx,
            cachedRootFolderId: rootFolderId,
          });
          metadataFileId = syncRes.metadataFileId;
          rootFolderId = syncRes.rootFolderId;
          if (rootFolderId && rootFolderId !== profile?.driveRootFolderId) {
            await updateUserWorkspaceMeta(user.uid, {
              driveRootFolderId: rootFolderId,
            });
          }
        } catch (err) {
          console.warn('Drive status sync warning:', err);
        }
      }

      await updateTransactionRecord(
        user.uid,
        actorEmail,
        existingTx,
        {
          ...updates,
          attachments: combinedAttachments,
          driveMetadataFileId: metadataFileId,
        },
        actionNote
      );
      addToast(
        'success',
        updates.isArchived ? `Đã lưu trữ ${existingTx.code}` : `Đã cập nhật ${existingTx.code}`,
        actionNote || existingTx.name
      );
    },
    [user, profile, accessToken, requireWorkspaceToken, handleWorkspaceError, addToast]
  );

  const handleImportSingleSheetExcel = useCallback(
    async (parsed: SingleSheetParseResult) => {
      if (!user) throw new Error('Chưa đăng nhập.');
      const actorEmail = user.email || user.uid;

      const accountMap = new Map<string, FinancialAccount>();
      for (const acc of accounts) {
        accountMap.set(acc.name.trim().toLowerCase(), acc);
      }

      let accountsCreated = 0;
      for (const accRow of parsed.accounts) {
        const key = accRow.name.trim().toLowerCase();
        if (!accountMap.has(key)) {
          const created = await createAccount(user.uid, actorEmail, {
            type: accRow.type,
            name: accRow.name,
            bankName: accRow.bankName,
            accountNumber: accRow.accountNumber,
            initialBalance: accRow.initialBalance,
          });
          if (accRow.currentBalance !== accRow.initialBalance) {
            await updateAccount(user.uid, actorEmail, created.id, {
              type: created.type,
              name: created.name,
              bankName: created.bankName,
              accountNumber: created.accountNumber,
              initialBalance: created.initialBalance,
              currentBalance: accRow.currentBalance,
            });
            created.currentBalance = accRow.currentBalance;
          }
          accountMap.set(key, created);
          accountsCreated++;
        }
      }

      let budgetsCreated = 0;
      for (const bRow of parsed.budgets) {
        await createBudgetLimit(user.uid, actorEmail, {
          name: bRow.name,
          scopeType: bRow.scopeType,
          scopeValue: bRow.scopeValue,
          yearMonth: bRow.yearMonth,
          limitAmount: bRow.limitAmount,
        });
        budgetsCreated++;
      }

      const resolveAccount = async (requestedName: string): Promise<FinancialAccount> => {
        const key = requestedName.trim().toLowerCase();
        const found = accountMap.get(key);
        if (found) return found;
        const firstExisting = accountMap.values().next().value as FinancialAccount | undefined;
        if (firstExisting && !requestedName.trim()) {
          return firstExisting;
        }
        const created = await createAccount(user.uid, actorEmail, {
          type: 'cash',
          name: requestedName.trim() || 'Tiền mặt cá nhân',
          initialBalance: 0,
        });
        accountMap.set(created.name.trim().toLowerCase(), created);
        accountsCreated++;
        return created;
      };

      let incomesCreated = 0;
      for (const row of parsed.incomes) {
        const targetAcc = await resolveAccount(row.accountName);
        await reserveAndCreateTransaction(user.uid, actorEmail, {
          kind: 'income',
          name: row.name,
          source: row.sourceOrReason,
          amount: row.amount,
          actualAmount: row.actualAmount,
          category: row.category,
          method: row.method,
          accountId: targetAcc.id,
          accountName: targetAcc.name,
          counterparty: row.counterparty,
          description: row.description,
          expectedDate: row.expectedDate,
          actualDate: row.actualDate,
          status: row.status,
          isArchived: false,
          attachments: [],
          dateForCode: row.actualDate || row.expectedDate,
        });
        incomesCreated++;
      }

      let expensesCreated = 0;
      for (const row of parsed.expenses) {
        const targetAcc = await resolveAccount(row.accountName);
        await reserveAndCreateTransaction(user.uid, actorEmail, {
          kind: 'expense',
          name: row.name,
          reason: row.sourceOrReason,
          purposeTag: row.purposeTag,
          amount: row.amount,
          actualAmount: row.actualAmount,
          category: row.category,
          method: row.method,
          accountId: targetAcc.id,
          accountName: targetAcc.name,
          counterparty: row.counterparty,
          description: row.description,
          expectedDate: row.expectedDate,
          actualDate: row.actualDate,
          status: row.status,
          isArchived: false,
          attachments: [],
          dateForCode: row.actualDate || row.expectedDate,
        });
        expensesCreated++;
      }

      return { accountsCreated, budgetsCreated, incomesCreated, expensesCreated };
    },
    [user, accounts]
  );

  const handleReconcileAccount = useCallback(
    async (
      account: FinancialAccount,
      actualVerifiedBalance: number,
      file: File | null,
      syncBalance: boolean
    ) => {
      if (!user) throw new Error('Chưa đăng nhập.');
      const actorEmail = user.email || user.uid;
      const attachments = [...(account.reconciliationAttachments || [])];

      if (file) {
        try {
          const token = requireWorkspaceToken();
          const todayIso = new Date().toISOString().slice(0, 10);
          const safeAccCode = `SAOKE-${account.name
            .replace(/[^a-zA-Z0-9]/g, '')
            .slice(0, 12) || 'TK'}`;
          const res = await uploadReceiptToDrive({
            accessToken: token,
            txCode: safeAccCode,
            isoDate: todayIso,
            file,
            existingAttachments: attachments,
            incomingBatchSize: 1,
            status: 'Đã đối soát sao kê',
            cachedRootFolderId: profile?.driveRootFolderId,
          });
          attachments.push(res.attachment);
          if (res.rootFolderId !== profile?.driveRootFolderId) {
            await updateUserWorkspaceMeta(user.uid, {
              driveRootFolderId: res.rootFolderId,
            });
          }
        } catch (err) {
          handleWorkspaceError(err);
        }
      }

      await reconcileAccount(
        user.uid,
        actorEmail,
        account,
        actualVerifiedBalance,
        attachments,
        syncBalance
      );
      addToast('success', `Đã đối chiếu ${account.name}`, `Số dư sao kê: ${formatVND(actualVerifiedBalance)}`);
    },
    [user, profile, requireWorkspaceToken, handleWorkspaceError, addToast]
  );

  const handleSyncGoogleSheet = useCallback(async () => {
    if (!user) return null;
    try {
      const token = requireWorkspaceToken();
      const res = await syncLedgerToGoogleSheet({
        accessToken: token,
        transactions,
        accounts,
        existingSpreadsheetId: profile?.spreadsheetId,
      });
      if (res.spreadsheetId !== profile?.spreadsheetId) {
        await updateUserWorkspaceMeta(user.uid, {
          spreadsheetId: res.spreadsheetId,
        });
      }
      addToast('success', 'Đồng bộ Google Sheets thành công');
      return { spreadsheetUrl: res.spreadsheetUrl };
    } catch (err) {
      handleWorkspaceError(err);
      return null;
    }
  }, [user, profile, transactions, accounts, requireWorkspaceToken, handleWorkspaceError, addToast]);

  const handleCreateCalendarReminder = useCallback(
    async (tx: Transaction) => {
      if (!user) return;
      try {
        const token = requireWorkspaceToken();
        const res = await createCalendarReminder({ accessToken: token, tx });
        await updateTransactionRecord(
          user.uid,
          user.email || user.uid,
          tx,
          { calendarEventId: res.eventId },
          'Đã tạo lịch nhắc Google Calendar'
        );
        addToast('success', `Đã thêm lịch Calendar cho ${tx.code}`);
      } catch (err) {
        handleWorkspaceError(err);
      }
    },
    [user, requireWorkspaceToken, handleWorkspaceError, addToast]
  );

  const handleCreateTaskItem = useCallback(
    async (tx: Transaction) => {
      if (!user) return;
      try {
        const token = requireWorkspaceToken();
        const res = await createFinancialTask({ accessToken: token, tx });
        await updateTransactionRecord(
          user.uid,
          user.email || user.uid,
          tx,
          { taskItemId: res.taskId },
          'Đã thêm đầu việc Google Tasks'
        );
        addToast('success', `Đã thêm vào Google Tasks (${tx.code})`);
      } catch (err) {
        handleWorkspaceError(err);
      }
    },
    [user, requireWorkspaceToken, handleWorkspaceError, addToast]
  );

  const handleDeleteConfirmed = useCallback(
    async (tx: Transaction, deleteDriveFiles: boolean) => {
      if (!user) return;
      if (deleteDriveFiles) {
        const token = getAccessToken() || accessToken;
        if (token) {
          for (const att of tx.attachments) {
            await deleteDriveFile(token, att.id);
          }
          if (tx.driveMetadataFileId) {
            await deleteDriveFile(token, tx.driveMetadataFileId);
          }
        }
      }
      await deleteTransactionConfirmed(user.uid, user.email || user.uid, tx, true);
      addToast('info', `Đã xóa giao dịch ${tx.code}`);
    },
    [user, accessToken, addToast]
  );

  const handleExportBackup = useCallback(async () => {
    if (!user) return;
    const data = await exportFullBackupData(user.uid);
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SoQuy_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('success', 'Đã xuất tệp sao lưu JSON');
  }, [user, addToast]);

  const handleImportBackup = useCallback(
    async (file: File) => {
      if (!user) throw new Error('Chưa đăng nhập.');
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Tệp sao lưu JSON không hợp lệ.');
      }
      const res = await restoreBackupData(user.uid, user.email || user.uid, parsed);
      addToast('success', `Đã khôi phục ${res.restoredCount} bản ghi`);
      return res;
    },
    [user, addToast]
  );

  const expenseCategories = useMemo(
    () =>
      profile?.expenseCategories && profile.expenseCategories.length > 0
        ? profile.expenseCategories
        : [...EXPENSE_CATEGORIES],
    [profile?.expenseCategories]
  );

  const handleUpdateExpenseCategories = useCallback(
    async (nextCategories: string[]) => {
      if (!user) return;
      await updateUserWorkspaceMeta(user.uid, {
        expenseCategories: nextCategories,
      });
    },
    [user]
  );

  useEffect(() => {
    if (!authReady || !user) return;

    const modalState: ModalLayerState = quickTxModalOpen
      ? 'quick_transaction'
      : shortcutsHelpOpen
      ? 'shortcuts_help'
      : 'none';

    const onKeyDown = (e: KeyboardEvent) => {
      const action = resolveKeyboardShortcut({
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        repeat: e.repeat,
        isEditable: isEditableTarget(e.target),
        modalState,
      });

      if (!action) return;

      if (action.type === 'navigate') {
        e.preventDefault();
        setActivePage(action.page);
      } else if (action.type === 'open_quick_transaction') {
        e.preventDefault();
        setShortcutsHelpOpen(false);
        setQuickTxModalOpen(true);
      } else if (action.type === 'toggle_shortcuts_help') {
        e.preventDefault();
        setShortcutsHelpOpen((prev) => !prev);
      } else if (action.type === 'close_modal') {
        e.preventDefault();
        if (quickTxModalOpen) {
          setQuickTxModalOpen(false);
        } else if (shortcutsHelpOpen) {
          setShortcutsHelpOpen(false);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [authReady, user, quickTxModalOpen, shortcutsHelpOpen]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#f4f7fe] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-2xl p-6 shadow-xs text-center space-y-2">
          <div className="text-sm text-slate-700 font-semibold">
            Đang khởi tạo hệ thống...
          </div>
          <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full w-1/2 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <SignInScreen
        onSignIn={handleSignIn}
        isSigningIn={isSigningIn}
        errorMessage={authError}
      />
    );
  }

  const actorEmail = user.email || user.uid;
  const initialDataReady = accountsLoaded && transactionsLoaded;

  return (
    <>
      <SidebarLayout
        activePage={activePage}
        onNavigate={setActivePage}
        onOpenQuickTransaction={() => {
          setShortcutsHelpOpen(false);
          setQuickTxModalOpen(true);
        }}
        onOpenShortcutsHelp={() => setShortcutsHelpOpen((prev) => !prev)}
        userEmail={actorEmail}
        userName={user.displayName || actorEmail}
        hasDriveToken={Boolean(accessToken)}
        onReconnectDrive={handleReconnectDrive}
        onSignOut={handleSignOut}
      >
        {!initialDataReady ? (
          <DashboardSkeleton />
        ) : (
          <>
            {activePage === 'overview' && (
              <OverviewPage
                accounts={accounts}
                transactions={transactions}
                budgets={budgets}
                expenseCategories={expenseCategories}
                spreadsheetId={profile?.spreadsheetId}
                hasWorkspaceToken={Boolean(accessToken)}
                userEmail={user.email || undefined}
                pushPermission={pushPermission}
                pushEnabled={pushEnabled}
                onTogglePush={handleTogglePush}
                onSyncGoogleSheet={handleSyncGoogleSheet}
                onReconnectDrive={handleReconnectDrive}
              />
            )}

            {activePage === 'transactions' && (
              <TransactionsPage
                accounts={accounts}
                transactions={transactions}
                budgets={budgets}
                expenseCategories={expenseCategories}
                onUpdateExpenseCategories={handleUpdateExpenseCategories}
                hasDriveToken={Boolean(accessToken)}
                userEmail={user.email || undefined}
                pushPermission={pushPermission}
                pushEnabled={pushEnabled}
                onTogglePush={handleTogglePush}
                onReconnectDrive={handleReconnectDrive}
                onPeekCode={handlePeekCode}
                onSaveNewTransaction={handleSaveNewTransaction}
                onUpdateTransaction={handleUpdateTransaction}
                onCreateAccount={async (input) => {
                  const res = await createAccount(user.uid, actorEmail, input);
                  addToast('success', 'Đã thêm nguồn tiền mới', input.name);
                  return res;
                }}
                onUpdateAccount={async (id, patch) => {
                  await updateAccount(user.uid, actorEmail, id, patch);
                  addToast('success', 'Đã cập nhật tài khoản', patch.name);
                }}
                onReconcileAccount={handleReconcileAccount}
                onCreateBudget={async (input) => {
                  await createBudgetLimit(user.uid, actorEmail, input);
                  addToast('success', 'Đã tạo hạn mức chi tiêu', input.name);
                }}
                onDeleteBudget={async (b) => {
                  await deleteBudgetLimit(user.uid, actorEmail, b);
                  addToast('info', 'Đã xóa hạn mức chi tiêu', b.name);
                }}
                onCreateCalendarReminder={handleCreateCalendarReminder}
                onCreateTaskItem={handleCreateTaskItem}
                onImportSingleSheetExcel={async (parsed) => {
                  const stats = await handleImportSingleSheetExcel(parsed);
                  addToast(
                    'success',
                    'Đã nhập dữ liệu Excel thành công',
                    `${stats.incomesCreated} thu · ${stats.expensesCreated} chi · ${stats.budgetsCreated} hạn mức`
                  );
                  return stats;
                }}
              />
            )}

            {activePage === 'archive' && (
              <ArchivePage
                transactions={transactions}
                auditLogs={auditLogs}
                expenseCategories={expenseCategories}
                hasDriveToken={Boolean(accessToken)}
                onDeleteConfirmed={handleDeleteConfirmed}
                onExportBackup={handleExportBackup}
                onImportBackup={handleImportBackup}
              />
            )}
          </>
        )}
      </SidebarLayout>

      <QuickTransactionModal
        open={quickTxModalOpen}
        onClose={() => setQuickTxModalOpen(false)}
        accounts={accounts}
        expenseCategories={expenseCategories}
        hasDriveToken={Boolean(accessToken)}
        onReconnectDrive={handleReconnectDrive}
        onPeekCode={handlePeekCode}
        onSaveNewTransaction={handleSaveNewTransaction}
      />

      <KeyboardShortcutsModal
        open={shortcutsHelpOpen}
        onClose={() => setShortcutsHelpOpen(false)}
      />

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <FinanceAppShell />
    </ErrorBoundary>
  );
}
