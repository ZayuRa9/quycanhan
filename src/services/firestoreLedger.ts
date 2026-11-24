import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import {
  buildFirestoreError,
  db,
  handleFirestoreError,
  OperationType,
  resolveUserEmail,
} from './firebase';
import type {
  AuditHistoryEntry,
  AuditLog,
  BackupRecord,
  BackupRecordType,
  BudgetLimit,
  DriveAttachment,
  FinancialAccount,
  SavingsContribution,
  SavingsGoal,
  Transaction,
  TransactionKind,
  UserProfile,
} from '../types/finance';
import {
  buildTransactionCode,
  detectDuplicateTransactions,
  getEffectiveTransactionAmount,
  getTransactionCodePrefix,
  getYearMonthDot,
  isTransactionRealized,
  toVndInt,
} from '../utils/financeRules';

function userDocRef(uid: string) {
  return doc(db, 'users', uid);
}

function accountsCol(uid: string) {
  return collection(db, 'users', uid, 'accounts');
}

function transactionsCol(uid: string) {
  return collection(db, 'users', uid, 'transactions');
}

function budgetsCol(uid: string) {
  return collection(db, 'users', uid, 'budgets');
}

function savingsGoalsCol(uid: string) {
  return collection(db, 'users', uid, 'savingsGoals');
}

function savingsContributionsCol(uid: string) {
  return collection(db, 'users', uid, 'savingsContributions');
}

function backupHistoryCol(uid: string) {
  return collection(db, 'users', uid, 'backupHistory');
}

function auditLogsCol(uid: string) {
  return collection(db, 'users', uid, 'auditLogs');
}

function countersCol(uid: string) {
  return collection(db, 'users', uid, 'codeCounters');
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const ref = userDocRef(user.uid);
  const resolvedEmail = resolveUserEmail(user);
  const resolvedName = (user.displayName || resolvedEmail || 'Người dùng').slice(0, 128);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as UserProfile;
      await updateDoc(ref, {
        email: (resolvedEmail || data.email || '').slice(0, 256),
        displayName: resolvedName,
        updatedAt: serverTimestamp(),
      });
      return data;
    }
    const profile: UserProfile = {
      uid: user.uid,
      email: resolvedEmail.slice(0, 256),
      displayName: resolvedName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await setDoc(ref, profile);
    return profile;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
  }
}

export async function updateUserWorkspaceMeta(
  uid: string,
  patch: Partial<
    Pick<
      UserProfile,
      | 'driveRootFolderId'
      | 'spreadsheetId'
      | 'expenseCategories'
      | 'incomeCategories'
      | 'reminderLeadDays'
      | 'defaultPageSize'
      | 'autoPreRestoreBackup'
      | 'lastDriveBackupAt'
      | 'lastDriveBackupFileId'
    >
  >
) {
  try {
    const cleanPatch: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (patch.driveRootFolderId !== undefined) {
      cleanPatch.driveRootFolderId = String(patch.driveRootFolderId).slice(0, 128);
    }
    if (patch.spreadsheetId !== undefined) {
      cleanPatch.spreadsheetId = String(patch.spreadsheetId).slice(0, 128);
    }
    if (patch.expenseCategories !== undefined) {
      cleanPatch.expenseCategories = patch.expenseCategories
        .map((c) => c.trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 100);
    }
    if (patch.incomeCategories !== undefined) {
      cleanPatch.incomeCategories = patch.incomeCategories
        .map((c) => c.trim().slice(0, 100))
        .filter(Boolean)
        .slice(0, 100);
    }
    if (patch.reminderLeadDays !== undefined) {
      cleanPatch.reminderLeadDays = Math.min(30, Math.max(1, Math.round(Number(patch.reminderLeadDays) || 3)));
    }
    if (patch.defaultPageSize !== undefined) {
      cleanPatch.defaultPageSize = Math.min(100, Math.max(5, Math.round(Number(patch.defaultPageSize) || 15)));
    }
    if (patch.autoPreRestoreBackup !== undefined) {
      cleanPatch.autoPreRestoreBackup = Boolean(patch.autoPreRestoreBackup);
    }
    if (patch.lastDriveBackupAt !== undefined) {
      cleanPatch.lastDriveBackupAt = String(patch.lastDriveBackupAt).slice(0, 40);
    }
    if (patch.lastDriveBackupFileId !== undefined) {
      cleanPatch.lastDriveBackupFileId = String(patch.lastDriveBackupFileId).slice(0, 128);
    }

    await updateDoc(userDocRef(uid), cleanPatch);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

function getCreatedAtMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'object' && value !== null && 'toMillis' in value) {
    const fn = (value as { toMillis?: () => number }).toMillis;
    if (typeof fn === 'function') return fn.call(value);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function forwardSubscriptionError(
  err: unknown,
  operation: OperationType,
  path: string,
  onError?: (error: Error) => void
) {
  const formatted = buildFirestoreError(err, operation, path);
  if (onError) {
    onError(formatted);
    return;
  }
  throw formatted;
}

export function subscribeUserProfile(
  uid: string,
  onData: (profile: UserProfile | null) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  return onSnapshot(
    userDocRef(uid),
    (snap) => {
      onData(snap.exists() ? (snap.data() as UserProfile) : null);
    },
    (err) => forwardSubscriptionError(err, OperationType.GET, `users/${uid}`, onError)
  );
}

export function subscribeAccounts(
  uid: string,
  onData: (accounts: FinancialAccount[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(accountsCol(uid), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FinancialAccount, 'id'>) }));
      list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      onData(list);
    },
    (err) => forwardSubscriptionError(err, OperationType.LIST, `users/${uid}/accounts`, onError)
  );
}

export function subscribeTransactions(
  uid: string,
  onData: (transactions: Transaction[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(transactionsCol(uid), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Transaction, 'id'>) }));
      list.sort((a, b) => {
        const dA = a.actualDate || a.expectedDate || '';
        const dB = b.actualDate || b.expectedDate || '';
        if (dB !== dA) return dB.localeCompare(dA);
        return b.code.localeCompare(a.code);
      });
      onData(list);
    },
    (err) => forwardSubscriptionError(err, OperationType.LIST, `users/${uid}/transactions`, onError)
  );
}

export function subscribeBudgets(
  uid: string,
  onData: (budgets: BudgetLimit[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(budgetsCol(uid), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BudgetLimit, 'id'>) }));
      list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      onData(list);
    },
    (err) => forwardSubscriptionError(err, OperationType.LIST, `users/${uid}/budgets`, onError)
  );
}

export function subscribeSavingsGoals(
  uid: string,
  onData: (goals: SavingsGoal[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(savingsGoalsCol(uid), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SavingsGoal, 'id'>) }));
      list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      onData(list);
    },
    (err) => forwardSubscriptionError(err, OperationType.LIST, `users/${uid}/savingsGoals`, onError)
  );
}

export function subscribeSavingsContributions(
  uid: string,
  onData: (contributions: SavingsContribution[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(savingsContributionsCol(uid), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SavingsContribution, 'id'>) }));
      list.sort((a, b) => b.date.localeCompare(a.date));
      onData(list);
    },
    (err) =>
      forwardSubscriptionError(
        err,
        OperationType.LIST,
        `users/${uid}/savingsContributions`,
        onError
      )
  );
}

export function subscribeBackupHistory(
  uid: string,
  onData: (records: BackupRecord[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(backupHistoryCol(uid), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BackupRecord, 'id'>) }));
      list.sort((a, b) => getCreatedAtMillis(b.createdAt) - getCreatedAtMillis(a.createdAt));
      onData(list);
    },
    (err) => forwardSubscriptionError(err, OperationType.LIST, `users/${uid}/backupHistory`, onError)
  );
}

export function subscribeAuditLogs(
  uid: string,
  onData: (logs: AuditLog[]) => void,
  onError?: (error: Error) => void
): Unsubscribe {
  const q = query(auditLogsCol(uid), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLog, 'id'>) }));
      list.sort((a, b) => getCreatedAtMillis(b.createdAt) - getCreatedAtMillis(a.createdAt));
      onData(list);
    },
    (err) => forwardSubscriptionError(err, OperationType.LIST, `users/${uid}/auditLogs`, onError)
  );
}

export async function writeAuditLog(
  uid: string,
  actorEmail: string,
  entityType: AuditLog['entityType'],
  entityCode: string,
  action: string,
  details: string
) {
  const ref = doc(auditLogsCol(uid));
  await setDoc(ref, {
    userId: uid,
    entityType,
    entityCode: (entityCode || 'SYSTEM').slice(0, 120),
    action: (action || 'Cập nhật').slice(0, 120),
    details: details.slice(0, 1000),
    actorEmail: actorEmail.slice(0, 256),
    createdAt: serverTimestamp(),
  });
}

export async function recordBackupHistory(
  uid: string,
  input: {
    type: BackupRecordType;
    recordCount: number;
    fileName: string;
    driveFileId?: string;
    driveWebViewLink?: string;
    note?: string;
  }
): Promise<void> {
  try {
    const ref = doc(backupHistoryCol(uid));
    const payload: Record<string, unknown> = {
      userId: uid,
      type: input.type,
      recordCount: Math.max(0, toVndInt(input.recordCount)),
      fileName: input.fileName.trim().slice(0, 200) || 'backup.json',
      createdAt: serverTimestamp(),
    };
    if (input.driveFileId) payload.driveFileId = input.driveFileId.slice(0, 128);
    if (input.driveWebViewLink) payload.driveWebViewLink = input.driveWebViewLink.slice(0, 500);
    if (input.note) payload.note = input.note.slice(0, 500);
    await setDoc(ref, payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${uid}/backupHistory`);
  }
}

export async function createAccount(
  uid: string,
  actorEmail: string,
  input: {
    type: FinancialAccount['type'];
    name: string;
    bankName?: string;
    accountNumber?: string;
    initialBalance: number;
  }
): Promise<FinancialAccount> {
  const ref = doc(accountsCol(uid));
  try {
    const cleanName = input.name.trim().slice(0, 120);
    const initialBal = toVndInt(input.initialBalance);
    const payload: Record<string, unknown> = {
      userId: uid,
      type: input.type,
      name: cleanName,
      initialBalance: initialBal,
      currentBalance: initialBal,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    if (input.bankName?.trim()) {
      payload.bankName = input.bankName.trim().slice(0, 120);
    }
    if (input.accountNumber?.trim()) {
      payload.accountNumber = input.accountNumber.trim().slice(0, 64);
    }
    await setDoc(ref, payload);
    await writeAuditLog(
      uid,
      actorEmail,
      'account',
      cleanName,
      'Tạo nguồn tiền mới',
      `Loại: ${input.type}, Số dư ban đầu: ${initialBal}`
    );
    return {
      id: ref.id,
      userId: uid,
      type: input.type,
      name: cleanName,
      bankName: input.bankName?.trim() ? input.bankName.trim().slice(0, 120) : undefined,
      accountNumber: input.accountNumber?.trim()
        ? input.accountNumber.trim().slice(0, 64)
        : undefined,
      initialBalance: initialBal,
      currentBalance: initialBal,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${uid}/accounts`);
  }
}

export async function updateAccount(
  uid: string,
  actorEmail: string,
  accountId: string,
  patch: {
    type: FinancialAccount['type'];
    name: string;
    bankName?: string;
    accountNumber?: string;
    initialBalance: number;
    currentBalance: number;
  }
) {
  const ref = doc(db, 'users', uid, 'accounts', accountId);
  try {
    const initBal = toVndInt(patch.initialBalance);
    const curBal = toVndInt(patch.currentBalance);
    const updatePayload: Record<string, unknown> = {
      type: patch.type,
      name: patch.name.trim().slice(0, 120),
      initialBalance: initBal,
      currentBalance: curBal,
      updatedAt: serverTimestamp(),
    };
    if (patch.bankName?.trim()) updatePayload.bankName = patch.bankName.trim().slice(0, 120);
    if (patch.accountNumber?.trim()) updatePayload.accountNumber = patch.accountNumber.trim().slice(0, 64);

    await updateDoc(ref, updatePayload);
    await writeAuditLog(
      uid,
      actorEmail,
      'account',
      patch.name.trim(),
      'Cập nhật thông tin tài khoản',
      `Số dư hiện tại: ${curBal}`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/accounts/${accountId}`);
  }
}

export async function reconcileAccount(
  uid: string,
  actorEmail: string,
  account: FinancialAccount,
  actualVerifiedBalance: number,
  attachments: DriveAttachment[],
  syncSystemBalanceToActual: boolean
) {
  const ref = doc(db, 'users', uid, 'accounts', account.id);
  try {
    const nowIso = new Date().toISOString();
    const verifiedInt = toVndInt(actualVerifiedBalance);
    const diff = verifiedInt - toVndInt(account.currentBalance);
    await updateDoc(ref, {
      actualVerifiedBalance: verifiedInt,
      currentBalance: syncSystemBalanceToActual ? verifiedInt : toVndInt(account.currentBalance),
      lastReconciledAt: nowIso,
      reconciliationAttachments: attachments.slice(0, 10),
      updatedAt: serverTimestamp(),
    });
    await writeAuditLog(
      uid,
      actorEmail,
      'account',
      account.name,
      'Đối chiếu sao kê số dư',
      `Số dư hệ thống: ${account.currentBalance}, Thực tế: ${verifiedInt}, Chênh lệch: ${diff}${syncSystemBalanceToActual ? ' (Đã cập nhật theo sao kê thực tế)' : ''}`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/accounts/${account.id}`);
  }
}

export async function peekNextTransactionCode(
  uid: string,
  kind: TransactionKind,
  dateForCode: string
): Promise<string> {
  const prefix = getTransactionCodePrefix(kind);
  const ym = getYearMonthDot(dateForCode);
  const counterId = `${prefix}-${ym}`;
  const counterRef = doc(db, 'users', uid, 'codeCounters', counterId);
  try {
    const snap = await getDoc(counterRef);
    const nextSeq = snap.exists() ? Number((snap.data() as { lastSeq: number }).lastSeq) + 1 : 1;
    return buildTransactionCode(kind, ym, nextSeq);
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}/codeCounters/${counterId}`);
  }
}

export async function reserveAndCreateTransaction(
  uid: string,
  actorEmail: string,
  input: Omit<Transaction, 'id' | 'userId' | 'code' | 'auditHistory' | 'createdAt' | 'updatedAt'> & {
    dateForCode: string;
  }
): Promise<Transaction> {
  if (input.kind === 'transfer') {
    if (!input.toAccountId || input.toAccountId === input.accountId) {
      throw new Error('Chuyển khoản nội bộ phải chọn tài khoản đích khác tài khoản nguồn.');
    }
  }

  const prefix = getTransactionCodePrefix(input.kind);
  const ym = getYearMonthDot(input.dateForCode);
  const counterId = `${prefix}-${ym}`;
  const counterRef = doc(db, 'users', uid, 'codeCounters', counterId);
  const txRef = doc(transactionsCol(uid));
  const accRef = doc(db, 'users', uid, 'accounts', input.accountId);
  const toAccRef =
    input.kind === 'transfer' && input.toAccountId
      ? doc(db, 'users', uid, 'accounts', input.toAccountId)
      : null;

  try {
    const createdTx = await runTransaction(db, async (trx) => {
      // ALL reads first before any write
      const counterSnap = await trx.get(counterRef);
      const accSnap = await trx.get(accRef);
      const toAccSnap = toAccRef ? await trx.get(toAccRef) : null;

      if (!accSnap.exists()) {
        throw new Error('Không tìm thấy tài khoản nguồn đã chọn.');
      }
      if (input.kind === 'transfer' && (!toAccSnap || !toAccSnap.exists())) {
        throw new Error('Không tìm thấy tài khoản đích nhận chuyển khoản.');
      }

      const nextSeq = counterSnap.exists()
        ? Number((counterSnap.data() as { lastSeq: number }).lastSeq) + 1
        : 1;
      const code = buildTransactionCode(input.kind, ym, nextSeq);

      const realized = isTransactionRealized(input.kind, input.status);
      const amountInt = Math.max(0, toVndInt(input.amount));
      const actualAmountInt =
        typeof input.actualAmount === 'number' && Number.isFinite(input.actualAmount)
          ? Math.max(0, toVndInt(input.actualAmount))
          : undefined;
      const remainingAmountInt =
        typeof input.remainingAmount === 'number' && Number.isFinite(input.remainingAmount)
          ? Math.max(0, toVndInt(input.remainingAmount))
          : undefined;

      const effectiveAmount = getEffectiveTransactionAmount({
        amount: amountInt,
        actualAmount: actualAmountInt,
      });

      if (realized) {
        const accData = accSnap.data() as FinancialAccount;
        if (input.kind === 'income') {
          trx.update(accRef, {
            currentBalance: toVndInt(accData.currentBalance) + effectiveAmount,
            updatedAt: serverTimestamp(),
          });
        } else if (input.kind === 'expense') {
          trx.update(accRef, {
            currentBalance: toVndInt(accData.currentBalance) - effectiveAmount,
            updatedAt: serverTimestamp(),
          });
        } else if (input.kind === 'transfer' && toAccRef && toAccSnap?.exists()) {
          const toAccData = toAccSnap.data() as FinancialAccount;
          trx.update(accRef, {
            currentBalance: toVndInt(accData.currentBalance) - effectiveAmount,
            updatedAt: serverTimestamp(),
          });
          trx.update(toAccRef, {
            currentBalance: toVndInt(toAccData.currentBalance) + effectiveAmount,
            updatedAt: serverTimestamp(),
          });
        }
      }

      if (counterSnap.exists()) {
        trx.update(counterRef, {
          lastSeq: nextSeq,
          updatedAt: serverTimestamp(),
        });
      } else {
        trx.set(counterRef, {
          userId: uid,
          prefix,
          yearMonth: ym,
          lastSeq: nextSeq,
          updatedAt: serverTimestamp(),
        });
      }

      const historyEntry: AuditHistoryEntry = {
        timestamp: new Date().toISOString(),
        actorEmail,
        action:
          input.kind === 'transfer'
            ? 'Tạo lệnh chuyển khoản nội bộ'
            : 'Tạo giao dịch mới',
        toStatus: input.status,
        note: `Mã tự động: ${code}`,
      };

      const txPayload: Record<string, unknown> = {
        userId: uid,
        code,
        kind: input.kind,
        name: input.name.trim().slice(0, 200),
        amount: amountInt,
        category: input.category.slice(0, 100),
        method: input.method.slice(0, 80),
        accountId: input.accountId,
        accountName: input.accountName.slice(0, 150),
        expectedDate: input.expectedDate,
        status: input.status,
        isArchived: input.isArchived,
        attachments: input.attachments.slice(0, 20),
        auditHistory: [historyEntry],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      if (input.kind === 'transfer' && input.toAccountId) {
        txPayload.toAccountId = input.toAccountId;
        if (input.toAccountName) {
          txPayload.toAccountName = input.toAccountName.slice(0, 150);
        }
      }
      if (input.source?.trim()) txPayload.source = input.source.trim().slice(0, 200);
      if (actualAmountInt !== undefined) txPayload.actualAmount = actualAmountInt;
      if (remainingAmountInt !== undefined) txPayload.remainingAmount = remainingAmountInt;
      if (input.counterparty?.trim()) txPayload.counterparty = input.counterparty.trim().slice(0, 200);
      if (input.reason?.trim()) txPayload.reason = input.reason.trim().slice(0, 500);
      if (input.description?.trim()) txPayload.description = input.description.trim().slice(0, 2000);
      if (input.workDuration?.trim()) txPayload.workDuration = input.workDuration.trim().slice(0, 120);
      if (input.purposeTag?.trim()) txPayload.purposeTag = input.purposeTag.trim().slice(0, 120);
      if (input.startDate) txPayload.startDate = input.startDate;
      if (input.actualDate) txPayload.actualDate = input.actualDate;
      if (input.driveMetadataFileId) txPayload.driveMetadataFileId = input.driveMetadataFileId;
      if (input.calendarEventId) txPayload.calendarEventId = input.calendarEventId;
      if (input.taskItemId) txPayload.taskItemId = input.taskItemId;

      trx.set(txRef, txPayload);

      return {
        id: txRef.id,
        ...(txPayload as unknown as Omit<Transaction, 'id'>),
      };
    });

    await writeAuditLog(
      uid,
      actorEmail,
      'transaction',
      createdTx.code,
      input.kind === 'transfer' ? 'Tạo chuyển khoản nội bộ' : 'Tạo giao dịch',
      `${createdTx.name} | Trạng thái: ${createdTx.status} | Số tiền: ${createdTx.amount}`
    );

    return createdTx;
  } catch (err) {
    if (err instanceof Error && !err.message.includes('permission')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.CREATE, `users/${uid}/transactions`);
  }
}

export async function updateTransactionRecord(
  uid: string,
  actorEmail: string,
  existingTx: Transaction,
  updates: Partial<Omit<Transaction, 'id' | 'userId' | 'code' | 'kind' | 'createdAt'>>,
  actionNote = 'Cập nhật giao dịch'
) {
  const txRef = doc(db, 'users', uid, 'transactions', existingTx.id);

  try {
    await runTransaction(db, async (trx) => {
      const nextStatus = updates.status ?? existingTx.status;
      const nextAccountId = updates.accountId ?? existingTx.accountId;
      const nextToAccountId =
        existingTx.kind === 'transfer'
          ? updates.toAccountId ?? existingTx.toAccountId
          : undefined;

      if (existingTx.kind === 'transfer') {
        if (!nextAccountId || !nextToAccountId || nextAccountId === nextToAccountId) {
          throw new Error('Chuyển khoản nội bộ phải có tài khoản nguồn và tài khoản đích khác nhau.');
        }
      }

      const nextAmount = toVndInt(updates.amount ?? existingTx.amount);
      const nextActualAmount =
        updates.actualAmount !== undefined
          ? typeof updates.actualAmount === 'number'
            ? toVndInt(updates.actualAmount)
            : undefined
          : existingTx.actualAmount;

      const wasRealized = isTransactionRealized(existingTx.kind, existingTx.status);
      const isNowRealized = isTransactionRealized(existingTx.kind, nextStatus);
      const prevEffective = getEffectiveTransactionAmount(existingTx);
      const nextEffective = getEffectiveTransactionAmount({
        amount: nextAmount,
        actualAmount: nextActualAmount,
      });

      // Aggregate net balance deltas per distinct account ID (reads before writes)
      const deltas = new Map<string, number>();
      const addDelta = (accId: string | undefined, amount: number) => {
        if (!accId || amount === 0) return;
        deltas.set(accId, (deltas.get(accId) || 0) + amount);
      };

      if (existingTx.kind === 'transfer') {
        if (wasRealized) {
          addDelta(existingTx.accountId, prevEffective);
          addDelta(existingTx.toAccountId, -prevEffective);
        }
        if (isNowRealized) {
          addDelta(nextAccountId, -nextEffective);
          addDelta(nextToAccountId, nextEffective);
        }
      } else {
        const sign = existingTx.kind === 'income' ? 1 : -1;
        if (wasRealized) {
          addDelta(existingTx.accountId, -sign * prevEffective);
        }
        if (isNowRealized) {
          addDelta(nextAccountId, sign * nextEffective);
        }
      }

      const nonZeroAccountIds = Array.from(deltas.entries())
        .filter(([, d]) => d !== 0)
        .map(([accId]) => accId);

      // Read all affected accounts BEFORE updating any
      const accSnaps = await Promise.all(
        nonZeroAccountIds.map(async (accId) => {
          const ref = doc(db, 'users', uid, 'accounts', accId);
          const snap = await trx.get(ref);
          return { accId, ref, snap };
        })
      );

      for (const { accId, ref, snap } of accSnaps) {
        if (snap.exists()) {
          const accData = snap.data() as FinancialAccount;
          const delta = deltas.get(accId) || 0;
          trx.update(ref, {
            currentBalance: toVndInt(accData.currentBalance) + delta,
            updatedAt: serverTimestamp(),
          });
        }
      }

      const historyEntry: AuditHistoryEntry = {
        timestamp: new Date().toISOString(),
        actorEmail,
        action: actionNote,
        fromStatus: existingTx.status,
        toStatus: nextStatus,
      };
      const mergedHistory = [...existingTx.auditHistory, historyEntry].slice(-100);

      const cleanUpdates: Record<string, unknown> = {
        name: (updates.name ?? existingTx.name).trim().slice(0, 200),
        amount: nextAmount,
        category: (updates.category ?? existingTx.category).slice(0, 100),
        method: (updates.method ?? existingTx.method).slice(0, 80),
        accountId: nextAccountId,
        accountName: (updates.accountName ?? existingTx.accountName).slice(0, 150),
        expectedDate: updates.expectedDate ?? existingTx.expectedDate,
        status: nextStatus,
        isArchived: updates.isArchived ?? existingTx.isArchived,
        attachments: (updates.attachments ?? existingTx.attachments).slice(0, 20),
        auditHistory: mergedHistory,
        updatedAt: serverTimestamp(),
      };

      if (existingTx.kind === 'transfer' && nextToAccountId) {
        cleanUpdates.toAccountId = nextToAccountId;
        const nextToName = updates.toAccountName ?? existingTx.toAccountName;
        if (nextToName) cleanUpdates.toAccountName = nextToName.slice(0, 150);
      }

      const optStr = (val: string | undefined, max: number) =>
        val !== undefined ? val.trim().slice(0, max) : undefined;

      const sourceVal = optStr(updates.source ?? existingTx.source, 200);
      if (sourceVal !== undefined) cleanUpdates.source = sourceVal;
      if (nextActualAmount !== undefined) cleanUpdates.actualAmount = nextActualAmount;
      const remVal = updates.remainingAmount ?? existingTx.remainingAmount;
      if (remVal !== undefined) cleanUpdates.remainingAmount = toVndInt(remVal);
      const cpVal = optStr(updates.counterparty ?? existingTx.counterparty, 200);
      if (cpVal !== undefined) cleanUpdates.counterparty = cpVal;
      const reasonVal = optStr(updates.reason ?? existingTx.reason, 500);
      if (reasonVal !== undefined) cleanUpdates.reason = reasonVal;
      const descVal = optStr(updates.description ?? existingTx.description, 2000);
      if (descVal !== undefined) cleanUpdates.description = descVal;
      const workVal = optStr(updates.workDuration ?? existingTx.workDuration, 120);
      if (workVal !== undefined) cleanUpdates.workDuration = workVal;
      const purposeVal = optStr(updates.purposeTag ?? existingTx.purposeTag, 120);
      if (purposeVal !== undefined) cleanUpdates.purposeTag = purposeVal;
      const startVal = updates.startDate ?? existingTx.startDate;
      if (startVal !== undefined) cleanUpdates.startDate = startVal;
      const actualDateVal = updates.actualDate ?? existingTx.actualDate;
      if (actualDateVal !== undefined) cleanUpdates.actualDate = actualDateVal;
      const metaId = updates.driveMetadataFileId ?? existingTx.driveMetadataFileId;
      if (metaId !== undefined) cleanUpdates.driveMetadataFileId = metaId;
      const calId = updates.calendarEventId ?? existingTx.calendarEventId;
      if (calId !== undefined) cleanUpdates.calendarEventId = calId;
      const tskId = updates.taskItemId ?? existingTx.taskItemId;
      if (tskId !== undefined) cleanUpdates.taskItemId = tskId;

      trx.update(txRef, cleanUpdates);
    });

    await writeAuditLog(
      uid,
      actorEmail,
      'transaction',
      existingTx.code,
      actionNote,
      `Trạng thái: ${existingTx.status} -> ${updates.status ?? existingTx.status}`
    );
  } catch (err) {
    if (err instanceof Error && !err.message.includes('permission')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/transactions/${existingTx.id}`);
  }
}

export async function restoreTransactionFromArchive(
  uid: string,
  actorEmail: string,
  tx: Transaction
) {
  return updateTransactionRecord(
    uid,
    actorEmail,
    tx,
    { isArchived: false },
    'Khôi phục từ Lưu trữ về sổ giao dịch'
  );
}

export async function deleteTransactionConfirmed(
  uid: string,
  actorEmail: string,
  tx: Transaction,
  reverseAccountBalance: boolean
) {
  const txRef = doc(db, 'users', uid, 'transactions', tx.id);
  try {
    await runTransaction(db, async (trx) => {
      const shouldReverse =
        reverseAccountBalance && isTransactionRealized(tx.kind, tx.status);
      const accRef = shouldReverse ? doc(db, 'users', uid, 'accounts', tx.accountId) : null;
      const toAccRef =
        shouldReverse && tx.kind === 'transfer' && tx.toAccountId
          ? doc(db, 'users', uid, 'accounts', tx.toAccountId)
          : null;

      // Read before writing
      const accSnap = accRef ? await trx.get(accRef) : null;
      const toAccSnap = toAccRef ? await trx.get(toAccRef) : null;

      if (shouldReverse) {
        const amt = getEffectiveTransactionAmount(tx);
        if (accRef && accSnap?.exists()) {
          const accData = accSnap.data() as FinancialAccount;
          const delta = tx.kind === 'income' ? -amt : amt;
          trx.update(accRef, {
            currentBalance: toVndInt(accData.currentBalance) + delta,
            updatedAt: serverTimestamp(),
          });
        }
        if (toAccRef && toAccSnap?.exists() && tx.kind === 'transfer') {
          const toAccData = toAccSnap.data() as FinancialAccount;
          trx.update(toAccRef, {
            currentBalance: toVndInt(toAccData.currentBalance) - amt,
            updatedAt: serverTimestamp(),
          });
        }
      }

      trx.delete(txRef);
    });
    // NOTE: Monotonic codeCounters is NEVER decremented or reused!
    await writeAuditLog(
      uid,
      actorEmail,
      'transaction',
      tx.code,
      'Xóa giao dịch theo xác nhận',
      `Đã xóa ${tx.code} (${tx.name}). Mã giao dịch được giữ nguyên không tái sử dụng.`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${uid}/transactions/${tx.id}`);
  }
}

export async function createBudgetLimit(
  uid: string,
  actorEmail: string,
  input: {
    name: string;
    scopeType: BudgetLimit['scopeType'];
    scopeValue: string;
    yearMonth: string;
    limitAmount: number;
  }
) {
  const ref = doc(budgetsCol(uid));
  const limitInt = Math.max(1, toVndInt(input.limitAmount));
  try {
    await setDoc(ref, {
      userId: uid,
      name: input.name.trim().slice(0, 150),
      scopeType: input.scopeType,
      scopeValue: input.scopeValue.trim().slice(0, 150),
      yearMonth: input.yearMonth.trim().slice(0, 10),
      limitAmount: limitInt,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await writeAuditLog(
      uid,
      actorEmail,
      'budget',
      input.name.trim(),
      'Thiết lập hạn mức ngân sách',
      `${input.scopeType}: ${input.scopeValue} (${input.yearMonth}) — ${limitInt}`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${uid}/budgets`);
  }
}

export async function updateBudgetLimit(
  uid: string,
  actorEmail: string,
  budgetId: string,
  patch: {
    name: string;
    scopeType: BudgetLimit['scopeType'];
    scopeValue: string;
    yearMonth: string;
    limitAmount: number;
  }
) {
  const ref = doc(db, 'users', uid, 'budgets', budgetId);
  const limitInt = Math.max(1, toVndInt(patch.limitAmount));
  try {
    await updateDoc(ref, {
      name: patch.name.trim().slice(0, 150),
      scopeType: patch.scopeType,
      scopeValue: patch.scopeValue.trim().slice(0, 150),
      yearMonth: patch.yearMonth.trim().slice(0, 10),
      limitAmount: limitInt,
      updatedAt: serverTimestamp(),
    });
    await writeAuditLog(
      uid,
      actorEmail,
      'budget',
      patch.name.trim(),
      'Cập nhật hạn mức ngân sách',
      `${patch.scopeType}: ${patch.scopeValue} (${patch.yearMonth}) — ${limitInt}`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/budgets/${budgetId}`);
  }
}

export async function deleteBudgetLimit(
  uid: string,
  actorEmail: string,
  budget: BudgetLimit
) {
  try {
    await deleteDoc(doc(db, 'users', uid, 'budgets', budget.id));
    await writeAuditLog(
      uid,
      actorEmail,
      'budget',
      budget.name,
      'Xóa hạn mức ngân sách',
      `Đã xóa hạn mức ${budget.name}`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${uid}/budgets/${budget.id}`);
  }
}

// =========================================================================
// Savings Goals & Atomic Accumulations
// =========================================================================

export async function createSavingsGoal(
  uid: string,
  actorEmail: string,
  input: {
    name: string;
    targetAmount: number;
    currentAmount?: number;
    targetDate?: string;
    linkedAccountId?: string;
    linkedAccountName?: string;
    category?: string;
    note?: string;
  }
): Promise<SavingsGoal> {
  const ref = doc(savingsGoalsCol(uid));
  const targetInt = Math.max(1, toVndInt(input.targetAmount));
  const currentInt = Math.max(0, toVndInt(input.currentAmount || 0));
  const status: SavingsGoal['status'] = currentInt >= targetInt ? 'completed' : 'active';
  const cleanName = input.name.trim().slice(0, 150);

  const payload: Record<string, unknown> = {
    userId: uid,
    name: cleanName,
    targetAmount: targetInt,
    currentAmount: currentInt,
    status,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.targetDate?.trim()) payload.targetDate = input.targetDate.trim().slice(0, 20);
  if (input.linkedAccountId?.trim()) payload.linkedAccountId = input.linkedAccountId.trim().slice(0, 128);
  if (input.linkedAccountName?.trim()) payload.linkedAccountName = input.linkedAccountName.trim().slice(0, 150);
  if (input.category?.trim()) payload.category = input.category.trim().slice(0, 100);
  if (input.note?.trim()) payload.note = input.note.trim().slice(0, 500);

  try {
    await setDoc(ref, payload);
    await writeAuditLog(
      uid,
      actorEmail,
      'savings',
      cleanName,
      'Tạo mục tiêu tiết kiệm',
      `Mục tiêu: ${targetInt} VNĐ | Hiện có: ${currentInt} VNĐ`
    );
    return {
      id: ref.id,
      userId: uid,
      name: cleanName,
      targetAmount: targetInt,
      currentAmount: currentInt,
      targetDate: input.targetDate,
      linkedAccountId: input.linkedAccountId,
      linkedAccountName: input.linkedAccountName,
      category: input.category,
      status,
      note: input.note,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${uid}/savingsGoals`);
  }
}

export async function updateSavingsGoal(
  uid: string,
  actorEmail: string,
  goalId: string,
  patch: {
    name: string;
    targetAmount: number;
    targetDate?: string;
    linkedAccountId?: string;
    linkedAccountName?: string;
    category?: string;
    status: SavingsGoal['status'];
    note?: string;
  }
) {
  const ref = doc(db, 'users', uid, 'savingsGoals', goalId);
  const targetInt = Math.max(1, toVndInt(patch.targetAmount));
  const cleanName = patch.name.trim().slice(0, 150);
  const payload: Record<string, unknown> = {
    name: cleanName,
    targetAmount: targetInt,
    status: patch.status,
    updatedAt: serverTimestamp(),
  };
  if (patch.targetDate !== undefined) payload.targetDate = patch.targetDate.trim().slice(0, 20);
  if (patch.linkedAccountId !== undefined) payload.linkedAccountId = patch.linkedAccountId.trim().slice(0, 128);
  if (patch.linkedAccountName !== undefined) payload.linkedAccountName = patch.linkedAccountName.trim().slice(0, 150);
  if (patch.category !== undefined) payload.category = patch.category.trim().slice(0, 100);
  if (patch.note !== undefined) payload.note = patch.note.trim().slice(0, 500);

  try {
    await updateDoc(ref, payload);
    await writeAuditLog(
      uid,
      actorEmail,
      'savings',
      cleanName,
      'Cập nhật mục tiêu tiết kiệm',
      `Mục tiêu mới: ${targetInt} VNĐ | Trạng thái: ${patch.status}`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/savingsGoals/${goalId}`);
  }
}

export async function deleteSavingsGoal(
  uid: string,
  actorEmail: string,
  goal: SavingsGoal
) {
  try {
    await deleteDoc(doc(db, 'users', uid, 'savingsGoals', goal.id));
    await writeAuditLog(
      uid,
      actorEmail,
      'savings',
      goal.name,
      'Xóa mục tiêu tiết kiệm',
      `Đã xóa mục tiêu ${goal.name}`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${uid}/savingsGoals/${goal.id}`);
  }
}

export async function recordSavingsContribution(
  uid: string,
  actorEmail: string,
  input: {
    goalId: string;
    type: 'deposit' | 'withdraw';
    amount: number;
    date: string;
    accountId?: string;
    accountName?: string;
    linkAccountBalance: boolean;
    note?: string;
  }
) {
  const amountInt = toVndInt(input.amount);
  if (amountInt <= 0) {
    throw new Error('Số tiền tích lũy hoặc rút phải lớn hơn 0.');
  }

  const goalRef = doc(db, 'users', uid, 'savingsGoals', input.goalId);
  const contribRef = doc(savingsContributionsCol(uid));
  const accRef =
    input.linkAccountBalance && input.accountId
      ? doc(db, 'users', uid, 'accounts', input.accountId)
      : null;

  try {
    let goalNameForLog = '';
    let nextGoalAmt = 0;

    await runTransaction(db, async (trx) => {
      // Read before write
      const goalSnap = await trx.get(goalRef);
      const accSnap = accRef ? await trx.get(accRef) : null;

      if (!goalSnap.exists()) {
        throw new Error('Không tìm thấy mục tiêu tiết kiệm.');
      }
      const goalData = goalSnap.data() as SavingsGoal;
      goalNameForLog = goalData.name;
      const curGoalAmt = toVndInt(goalData.currentAmount);

      if (input.type === 'withdraw' && amountInt > curGoalAmt) {
        throw new Error('Số tiền rút không được vượt quá số tiền đã tích lũy trong mục tiêu.');
      }

      nextGoalAmt = input.type === 'deposit' ? curGoalAmt + amountInt : curGoalAmt - amountInt;
      const nextStatus: SavingsGoal['status'] =
        nextGoalAmt >= toVndInt(goalData.targetAmount)
          ? 'completed'
          : goalData.status === 'completed'
          ? 'active'
          : goalData.status;

      trx.update(goalRef, {
        currentAmount: nextGoalAmt,
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });

      if (accRef && accSnap?.exists()) {
        const accData = accSnap.data() as FinancialAccount;
        const accDelta = input.type === 'deposit' ? -amountInt : amountInt;
        trx.update(accRef, {
          currentBalance: toVndInt(accData.currentBalance) + accDelta,
          updatedAt: serverTimestamp(),
        });
      }

      const contribPayload: Record<string, unknown> = {
        userId: uid,
        goalId: input.goalId,
        goalName: goalData.name.slice(0, 150),
        type: input.type,
        amount: amountInt,
        date: input.date.slice(0, 20),
        createdAt: serverTimestamp(),
      };
      if (input.accountId) contribPayload.accountId = input.accountId.slice(0, 128);
      if (input.accountName) contribPayload.accountName = input.accountName.slice(0, 150);
      if (input.note?.trim()) contribPayload.note = input.note.trim().slice(0, 500);

      trx.set(contribRef, contribPayload);
    });

    await writeAuditLog(
      uid,
      actorEmail,
      'savings',
      goalNameForLog,
      input.type === 'deposit' ? 'Gửi thêm vào mục tiêu tiết kiệm' : 'Rút tiền từ mục tiêu tiết kiệm',
      `${input.type === 'deposit' ? '+' : '-'}${amountInt} VNĐ | Số dư mục tiêu mới: ${nextGoalAmt} VNĐ${input.linkAccountBalance && input.accountName ? ` | Liên kết TK: ${input.accountName}` : ''}`
    );
  } catch (err) {
    if (err instanceof Error && !err.message.includes('permission')) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}/savingsGoals/${input.goalId}`);
  }
}

// =========================================================================
// Full JSON Backup & Restore (with Pre-Restore Snapshot + Batch Chunking)
// =========================================================================

export async function exportFullBackupData(uid: string) {
  try {
    const [userSnap, accSnap, txSnap, bdgSnap, cntSnap, savGoalSnap, savContribSnap] =
      await Promise.all([
        getDoc(userDocRef(uid)),
        getDocs(query(accountsCol(uid), where('userId', '==', uid))),
        getDocs(query(transactionsCol(uid), where('userId', '==', uid))),
        getDocs(query(budgetsCol(uid), where('userId', '==', uid))),
        getDocs(query(countersCol(uid), where('userId', '==', uid))),
        getDocs(query(savingsGoalsCol(uid), where('userId', '==', uid))),
        getDocs(query(savingsContributionsCol(uid), where('userId', '==', uid))),
      ]);

    const userData = userSnap.exists() ? (userSnap.data() as UserProfile) : null;

    return {
      version: 2,
      exportedAt: new Date().toISOString(),
      accounts: accSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      transactions: txSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      budgets: bdgSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      codeCounters: cntSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      savingsGoals: savGoalSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      savingsContributions: savContribSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      userSettings: userData
        ? {
            expenseCategories: userData.expenseCategories,
            incomeCategories: userData.incomeCategories,
            reminderLeadDays: userData.reminderLeadDays,
            defaultPageSize: userData.defaultPageSize,
            autoPreRestoreBackup: userData.autoPreRestoreBackup,
          }
        : undefined,
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `users/${uid}`);
  }
}

export async function restoreBackupData(
  uid: string,
  actorEmail: string,
  payload: {
    accounts?: Array<Record<string, unknown>>;
    transactions?: Array<Record<string, unknown>>;
    budgets?: Array<Record<string, unknown>>;
    codeCounters?: Array<Record<string, unknown>>;
    savingsGoals?: Array<Record<string, unknown>>;
    savingsContributions?: Array<Record<string, unknown>>;
    userSettings?: {
      expenseCategories?: string[];
      incomeCategories?: string[];
      reminderLeadDays?: number;
      defaultPageSize?: number;
      autoPreRestoreBackup?: boolean;
    };
  },
  options?: {
    createPreRestoreSnapshot?: boolean;
    skipDuplicateTransactions?: boolean;
    sourceFileName?: string;
  }
): Promise<{
  restoredCount: number;
  skippedDuplicates: number;
  preRestoreSnapshot?: Awaited<ReturnType<typeof exportFullBackupData>>;
}> {
  try {
    let preRestoreSnapshot: Awaited<ReturnType<typeof exportFullBackupData>> | undefined;
    if (options?.createPreRestoreSnapshot !== false) {
      preRestoreSnapshot = await exportFullBackupData(uid);
      const snapshotCount =
        (preRestoreSnapshot?.accounts.length || 0) +
        (preRestoreSnapshot?.transactions.length || 0) +
        (preRestoreSnapshot?.budgets.length || 0) +
        (preRestoreSnapshot?.savingsGoals.length || 0);
      if (snapshotCount > 0) {
        await recordBackupHistory(uid, {
          type: 'pre_restore_snapshot',
          recordCount: snapshotCount,
          fileName: `AutoSnapshot_BeforeRestore_${new Date().toISOString().slice(0, 10)}.json`,
          note: 'Bản sao lưu an toàn tự động trước khi phục hồi',
        });
      }
    }

    const existingCodes = new Set<string>();
    const existingTxs: Transaction[] = [];
    if (options?.skipDuplicateTransactions) {
      const txSnap = await getDocs(query(transactionsCol(uid), where('userId', '==', uid)));
      for (const d of txSnap.docs) {
        const tx = { id: d.id, ...(d.data() as Omit<Transaction, 'id'>) };
        existingTxs.push(tx);
        if (tx.code) existingCodes.add(tx.code);
      }
    }

    // Queue write operations and flush every 350 ops (< Firestore 500 batch limit)
    const pendingOps: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];
    let restoredCount = 0;
    let skippedDuplicates = 0;

    for (const acc of payload.accounts || []) {
      const id = String(acc.id || doc(accountsCol(uid)).id);
      const ref = doc(db, 'users', uid, 'accounts', id);
      const accType =
        acc.type === 'cash' || acc.type === 'bank' || acc.type === 'ewallet' || acc.type === 'savings'
          ? acc.type
          : 'bank';
      const data: Record<string, unknown> = {
        userId: uid,
        type: accType,
        name: String(acc.name || 'Tài khoản').slice(0, 120),
        initialBalance: toVndInt(Number(acc.initialBalance || 0)),
        currentBalance: toVndInt(Number(acc.currentBalance || 0)),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (acc.bankName) data.bankName = String(acc.bankName).slice(0, 120);
      if (acc.accountNumber) data.accountNumber = String(acc.accountNumber).slice(0, 64);
      pendingOps.push((b) => b.set(ref, data));
      restoredCount++;
    }

    for (const bdg of payload.budgets || []) {
      const id = String(bdg.id || doc(budgetsCol(uid)).id);
      const ref = doc(db, 'users', uid, 'budgets', id);
      const scopeType =
        bdg.scopeType === 'month' || bdg.scopeType === 'purpose' || bdg.scopeType === 'work'
          ? bdg.scopeType
          : 'category';
      pendingOps.push((b) =>
        b.set(ref, {
          userId: uid,
          name: String(bdg.name || 'Hạn mức').slice(0, 150),
          scopeType,
          scopeValue: String(bdg.scopeValue || 'Khác').slice(0, 150),
          yearMonth: String(bdg.yearMonth || 'ALL').slice(0, 10),
          limitAmount: Math.max(1, toVndInt(Number(bdg.limitAmount || 1))),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
      restoredCount++;
    }

    for (const goal of payload.savingsGoals || []) {
      const id = String(goal.id || doc(savingsGoalsCol(uid)).id);
      const ref = doc(db, 'users', uid, 'savingsGoals', id);
      const status =
        goal.status === 'completed' || goal.status === 'paused' ? goal.status : 'active';
      const data: Record<string, unknown> = {
        userId: uid,
        name: String(goal.name || 'Mục tiêu tiết kiệm').slice(0, 150),
        targetAmount: Math.max(1, toVndInt(Number(goal.targetAmount || 1))),
        currentAmount: Math.max(0, toVndInt(Number(goal.currentAmount || 0))),
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (goal.targetDate) data.targetDate = String(goal.targetDate).slice(0, 20);
      if (goal.linkedAccountId) data.linkedAccountId = String(goal.linkedAccountId).slice(0, 128);
      if (goal.linkedAccountName) data.linkedAccountName = String(goal.linkedAccountName).slice(0, 150);
      if (goal.category) data.category = String(goal.category).slice(0, 100);
      if (goal.note) data.note = String(goal.note).slice(0, 500);
      pendingOps.push((b) => b.set(ref, data));
      restoredCount++;
    }

    for (const sc of payload.savingsContributions || []) {
      const id = String(sc.id || doc(savingsContributionsCol(uid)).id);
      const ref = doc(db, 'users', uid, 'savingsContributions', id);
      const amount = Math.max(1, toVndInt(Number(sc.amount || 0)));
      const data: Record<string, unknown> = {
        userId: uid,
        goalId: String(sc.goalId || 'goal'),
        goalName: String(sc.goalName || 'Mục tiêu').slice(0, 150),
        type: sc.type === 'withdraw' ? 'withdraw' : 'deposit',
        amount,
        date: String(sc.date || new Date().toISOString().slice(0, 10)).slice(0, 20),
        createdAt: serverTimestamp(),
      };
      if (sc.accountId) data.accountId = String(sc.accountId).slice(0, 128);
      if (sc.accountName) data.accountName = String(sc.accountName).slice(0, 150);
      if (sc.note) data.note = String(sc.note).slice(0, 500);
      pendingOps.push((b) => b.set(ref, data));
      restoredCount++;
    }

    for (const cnt of payload.codeCounters || []) {
      const id = String(cnt.id || '');
      if (!id) continue;
      const ref = doc(db, 'users', uid, 'codeCounters', id);
      const existing = await getDoc(ref);
      const incomingSeq = Math.max(1, Math.round(Number(cnt.lastSeq || 1)));
      const prefix = cnt.prefix === 'KC' || cnt.prefix === 'CK' ? cnt.prefix : 'KT';
      if (!existing.exists()) {
        pendingOps.push((b) =>
          b.set(ref, {
            userId: uid,
            prefix,
            yearMonth: String(cnt.yearMonth || ''),
            lastSeq: incomingSeq,
            updatedAt: serverTimestamp(),
          })
        );
      } else {
        const curSeq = Number((existing.data() as { lastSeq: number }).lastSeq);
        if (incomingSeq > curSeq) {
          pendingOps.push((b) =>
            b.update(ref, {
              lastSeq: incomingSeq,
              updatedAt: serverTimestamp(),
            })
          );
        }
      }
    }

    const incomingTxs = payload.transactions || [];
    const dupCheck =
      options?.skipDuplicateTransactions && incomingTxs.length > 0
        ? detectDuplicateTransactions(
            incomingTxs.map((tx, idx) => ({
              rowNumber: idx + 1,
              kind:
                tx.kind === 'income'
                  ? 'income'
                  : tx.kind === 'transfer'
                  ? 'transfer'
                  : 'expense',
              name: String(tx.name || ''),
              amount: toVndInt(Number(tx.amount || 0)),
              actualAmount:
                typeof tx.actualAmount === 'number' ? toVndInt(tx.actualAmount) : undefined,
              expectedDate: String(tx.expectedDate || ''),
              actualDate: tx.actualDate ? String(tx.actualDate) : undefined,
            })),
            existingTxs
          )
        : null;

    incomingTxs.forEach((tx, idx) => {
      const codeStr = String(tx.code || '');
      if (
        options?.skipDuplicateTransactions &&
        ((codeStr && existingCodes.has(codeStr)) || dupCheck?.duplicateRowNumbers.has(idx + 1))
      ) {
        skippedDuplicates++;
        return;
      }

      const id = String(tx.id || doc(transactionsCol(uid)).id);
      const ref = doc(db, 'users', uid, 'transactions', id);
      const kind: TransactionKind =
        tx.kind === 'income'
          ? 'income'
          : tx.kind === 'transfer'
          ? 'transfer'
          : 'expense';

      const accId = String(tx.accountId || 'default');
      const toAccId = tx.toAccountId ? String(tx.toAccountId) : undefined;
      const cleanKind: TransactionKind =
        kind === 'transfer' && (!toAccId || toAccId === accId) ? 'expense' : kind;

      const cleanTx: Record<string, unknown> = {
        userId: uid,
        code: codeStr,
        kind: cleanKind,
        name: String(tx.name || 'Giao dịch').slice(0, 200),
        amount: Math.max(0, toVndInt(Number(tx.amount || 0))),
        category: String(tx.category || 'Khác').slice(0, 100),
        method: String(tx.method || 'Tiền mặt').slice(0, 80),
        accountId: accId,
        accountName: String(tx.accountName || 'Tài khoản').slice(0, 150),
        expectedDate: String(tx.expectedDate || new Date().toISOString().slice(0, 10)),
        status: String(tx.status || 'Dự kiến').slice(0, 40),
        isArchived: Boolean(tx.isArchived),
        attachments: Array.isArray(tx.attachments) ? tx.attachments.slice(0, 20) : [],
        auditHistory: Array.isArray(tx.auditHistory) ? tx.auditHistory.slice(0, 100) : [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (cleanKind === 'transfer' && toAccId) {
        cleanTx.toAccountId = toAccId;
        if (tx.toAccountName) cleanTx.toAccountName = String(tx.toAccountName).slice(0, 150);
      }
      if (tx.source) cleanTx.source = String(tx.source).slice(0, 200);
      if (typeof tx.actualAmount === 'number') cleanTx.actualAmount = Math.max(0, toVndInt(tx.actualAmount));
      if (typeof tx.remainingAmount === 'number') cleanTx.remainingAmount = Math.max(0, toVndInt(tx.remainingAmount));
      if (tx.counterparty) cleanTx.counterparty = String(tx.counterparty).slice(0, 200);
      if (tx.reason) cleanTx.reason = String(tx.reason).slice(0, 500);
      if (tx.description) cleanTx.description = String(tx.description).slice(0, 2000);
      if (tx.workDuration) cleanTx.workDuration = String(tx.workDuration).slice(0, 120);
      if (tx.purposeTag) cleanTx.purposeTag = String(tx.purposeTag).slice(0, 120);
      if (tx.startDate) cleanTx.startDate = String(tx.startDate).slice(0, 20);
      if (tx.actualDate) cleanTx.actualDate = String(tx.actualDate).slice(0, 20);
      pendingOps.push((b) => b.set(ref, cleanTx));
      restoredCount++;
    });

    const CHUNK_SIZE = 350;
    for (let i = 0; i < pendingOps.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      const slice = pendingOps.slice(i, i + CHUNK_SIZE);
      for (const apply of slice) {
        apply(batch);
      }
      await batch.commit();
    }

    if (payload.userSettings) {
      await updateUserWorkspaceMeta(uid, payload.userSettings);
    }

    await recordBackupHistory(uid, {
      type: 'restore',
      recordCount: restoredCount,
      fileName: options?.sourceFileName || 'backup-restore.json',
      note:
        skippedDuplicates > 0
          ? `Đã phục hồi ${restoredCount} bản ghi, bỏ qua ${skippedDuplicates} giao dịch trùng.`
          : `Đã phục hồi ${restoredCount} bản ghi thành công.`,
    });

    await writeAuditLog(
      uid,
      actorEmail,
      'backup',
      'KHÔI PHỤC DỮ LIỆU',
      'Khôi phục bản sao lưu JSON',
      `Đã khôi phục ${restoredCount} bản ghi (bỏ qua ${skippedDuplicates} trùng lặp) vào cơ sở dữ liệu.`
    );
    return { restoredCount, skippedDuplicates, preRestoreSnapshot };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
  }
}
