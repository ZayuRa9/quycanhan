import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
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
import { db, handleFirestoreError, OperationType } from './firebase';
import type {
  AuditHistoryEntry,
  AuditLog,
  BudgetLimit,
  DriveAttachment,
  FinancialAccount,
  Transaction,
  TransactionKind,
  UserProfile,
} from '../types/finance';
import {
  buildTransactionCode,
  computeAccountBalanceDelta,
  getEffectiveTransactionAmount,
  getYearMonthDot,
  isTransactionRealized,
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

function auditLogsCol(uid: string) {
  return collection(db, 'users', uid, 'auditLogs');
}

function countersCol(uid: string) {
  return collection(db, 'users', uid, 'codeCounters');
}

export async function ensureUserProfile(user: User): Promise<UserProfile> {
  const ref = userDocRef(user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as UserProfile;
      await updateDoc(ref, {
        email: user.email || data.email,
        displayName: user.displayName || user.email || 'Người dùng',
        updatedAt: serverTimestamp(),
      });
      return data;
    }
    const profile: UserProfile = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || user.email || 'Người dùng',
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
    Pick<UserProfile, 'driveRootFolderId' | 'spreadsheetId' | 'expenseCategories'>
  >
) {
  try {
    await updateDoc(userDocRef(uid), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
  }
}

export function subscribeUserProfile(
  uid: string,
  onData: (profile: UserProfile | null) => void
): Unsubscribe {
  return onSnapshot(
    userDocRef(uid),
    (snap) => {
      onData(snap.exists() ? (snap.data() as UserProfile) : null);
    },
    (err) => handleFirestoreError(err, OperationType.GET, `users/${uid}`)
  );
}

export function subscribeAccounts(
  uid: string,
  onData: (accounts: FinancialAccount[]) => void
): Unsubscribe {
  const q = query(accountsCol(uid), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FinancialAccount, 'id'>) }));
      list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/accounts`)
  );
}

export function subscribeTransactions(
  uid: string,
  onData: (transactions: Transaction[]) => void
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
    (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/transactions`)
  );
}

export function subscribeBudgets(
  uid: string,
  onData: (budgets: BudgetLimit[]) => void
): Unsubscribe {
  const q = query(budgetsCol(uid), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BudgetLimit, 'id'>) }));
      list.sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/budgets`)
  );
}

export function subscribeAuditLogs(
  uid: string,
  onData: (logs: AuditLog[]) => void
): Unsubscribe {
  const q = query(
    auditLogsCol(uid),
    where('userId', '==', uid),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLog, 'id'>) }));
      onData(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, `users/${uid}/auditLogs`)
  );
}

async function writeAuditLog(
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
    entityCode: entityCode.slice(0, 120),
    action: action.slice(0, 120),
    details: details.slice(0, 1000),
    actorEmail: actorEmail.slice(0, 256),
    createdAt: serverTimestamp(),
  });
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
    const payload: Record<string, unknown> = {
      userId: uid,
      type: input.type,
      name: cleanName,
      initialBalance: input.initialBalance,
      currentBalance: input.initialBalance,
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
      `Loại: ${input.type}, Số dư ban đầu: ${input.initialBalance}`
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
      initialBalance: input.initialBalance,
      currentBalance: input.initialBalance,
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
    const updatePayload: Record<string, unknown> = {
      type: patch.type,
      name: patch.name.trim().slice(0, 120),
      initialBalance: patch.initialBalance,
      currentBalance: patch.currentBalance,
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
      `Số dư hiện tại: ${patch.currentBalance}`
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
    const diff = actualVerifiedBalance - account.currentBalance;
    await updateDoc(ref, {
      actualVerifiedBalance,
      currentBalance: syncSystemBalanceToActual ? actualVerifiedBalance : account.currentBalance,
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
      `Số dư hệ thống: ${account.currentBalance}, Thực tế: ${actualVerifiedBalance}, Chênh lệch: ${diff}${syncSystemBalanceToActual ? ' (Đã cập nhật theo sao kê thực tế)' : ''}`
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
  const prefix = kind === 'income' ? 'KT' : 'KC';
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
  const prefix = input.kind === 'income' ? 'KT' : 'KC';
  const ym = getYearMonthDot(input.dateForCode);
  const counterId = `${prefix}-${ym}`;
  const counterRef = doc(db, 'users', uid, 'codeCounters', counterId);
  const txRef = doc(transactionsCol(uid));
  const accRef = doc(db, 'users', uid, 'accounts', input.accountId);

  try {
    const createdTx = await runTransaction(db, async (trx) => {
      const counterSnap = await trx.get(counterRef);
      const accSnap = await trx.get(accRef);
      if (!accSnap.exists()) {
        throw new Error('Không tìm thấy tài khoản nguồn tiền đã chọn.');
      }

      const nextSeq = counterSnap.exists()
        ? Number((counterSnap.data() as { lastSeq: number }).lastSeq) + 1
        : 1;
      const code = buildTransactionCode(input.kind, ym, nextSeq);

      const realized = isTransactionRealized(input.kind, input.status);
      const effectiveAmount = getEffectiveTransactionAmount({
        amount: input.amount,
        actualAmount: input.actualAmount,
      });

      if (realized) {
        const accData = accSnap.data() as FinancialAccount;
        const delta = input.kind === 'income' ? effectiveAmount : -effectiveAmount;
        trx.update(accRef, {
          currentBalance: accData.currentBalance + delta,
          updatedAt: serverTimestamp(),
        });
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
        action: 'Tạo giao dịch mới',
        toStatus: input.status,
        note: `Mã tự động: ${code}`,
      };

      const txPayload: Record<string, unknown> = {
        userId: uid,
        code,
        kind: input.kind,
        name: input.name.trim().slice(0, 200),
        amount: input.amount,
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

      if (input.source?.trim()) txPayload.source = input.source.trim().slice(0, 200);
      if (typeof input.actualAmount === 'number') txPayload.actualAmount = input.actualAmount;
      if (typeof input.remainingAmount === 'number') txPayload.remainingAmount = input.remainingAmount;
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
      'Tạo giao dịch',
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
      const nextAmount = updates.amount ?? existingTx.amount;
      const nextActualAmount =
        updates.actualAmount !== undefined ? updates.actualAmount : existingTx.actualAmount;

      const wasRealized = isTransactionRealized(existingTx.kind, existingTx.status);
      const isNowRealized = isTransactionRealized(existingTx.kind, nextStatus);
      const prevEffective = getEffectiveTransactionAmount(existingTx);
      const nextEffective = getEffectiveTransactionAmount({
        amount: nextAmount,
        actualAmount: nextActualAmount,
      });

      if (existingTx.accountId === nextAccountId) {
        const delta = computeAccountBalanceDelta(
          existingTx.kind,
          wasRealized,
          isNowRealized,
          prevEffective,
          nextEffective
        );
        if (delta !== 0) {
          const accRef = doc(db, 'users', uid, 'accounts', nextAccountId);
          const accSnap = await trx.get(accRef);
          if (accSnap.exists()) {
            const accData = accSnap.data() as FinancialAccount;
            trx.update(accRef, {
              currentBalance: accData.currentBalance + delta,
              updatedAt: serverTimestamp(),
            });
          }
        }
      } else {
        if (wasRealized) {
          const oldAccRef = doc(db, 'users', uid, 'accounts', existingTx.accountId);
          const oldSnap = await trx.get(oldAccRef);
          if (oldSnap.exists()) {
            const oldData = oldSnap.data() as FinancialAccount;
            const reverseDelta = existingTx.kind === 'income' ? -prevEffective : prevEffective;
            trx.update(oldAccRef, {
              currentBalance: oldData.currentBalance + reverseDelta,
              updatedAt: serverTimestamp(),
            });
          }
        }
        if (isNowRealized) {
          const newAccRef = doc(db, 'users', uid, 'accounts', nextAccountId);
          const newSnap = await trx.get(newAccRef);
          if (newSnap.exists()) {
            const newData = newSnap.data() as FinancialAccount;
            const applyDelta = existingTx.kind === 'income' ? nextEffective : -nextEffective;
            trx.update(newAccRef, {
              currentBalance: newData.currentBalance + applyDelta,
              updatedAt: serverTimestamp(),
            });
          }
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

      const optStr = (val: string | undefined, max: number) =>
        val !== undefined ? val.trim().slice(0, max) : undefined;

      const sourceVal = optStr(updates.source ?? existingTx.source, 200);
      if (sourceVal !== undefined) cleanUpdates.source = sourceVal;
      if (nextActualAmount !== undefined) cleanUpdates.actualAmount = nextActualAmount;
      const remVal = updates.remainingAmount ?? existingTx.remainingAmount;
      if (remVal !== undefined) cleanUpdates.remainingAmount = remVal;
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
    handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/transactions/${existingTx.id}`);
  }
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
      if (reverseAccountBalance && isTransactionRealized(tx.kind, tx.status)) {
        const accRef = doc(db, 'users', uid, 'accounts', tx.accountId);
        const accSnap = await trx.get(accRef);
        if (accSnap.exists()) {
          const accData = accSnap.data() as FinancialAccount;
          const amt = getEffectiveTransactionAmount(tx);
          const delta = tx.kind === 'income' ? -amt : amt;
          trx.update(accRef, {
            currentBalance: accData.currentBalance + delta,
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
  try {
    await setDoc(ref, {
      userId: uid,
      name: input.name.trim().slice(0, 150),
      scopeType: input.scopeType,
      scopeValue: input.scopeValue.trim().slice(0, 150),
      yearMonth: input.yearMonth.trim().slice(0, 10),
      limitAmount: input.limitAmount,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await writeAuditLog(
      uid,
      actorEmail,
      'budget',
      input.name.trim(),
      'Thiết lập hạn mức ngân sách',
      `${input.scopeType}: ${input.scopeValue} (${input.yearMonth}) — ${input.limitAmount}`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `users/${uid}/budgets`);
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

export async function exportFullBackupData(uid: string) {
  try {
    const [accSnap, txSnap, bdgSnap, cntSnap] = await Promise.all([
      getDocs(query(accountsCol(uid), where('userId', '==', uid))),
      getDocs(query(transactionsCol(uid), where('userId', '==', uid))),
      getDocs(query(budgetsCol(uid), where('userId', '==', uid))),
      getDocs(query(countersCol(uid), where('userId', '==', uid))),
    ]);

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      accounts: accSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      transactions: txSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      budgets: bdgSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      codeCounters: cntSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
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
  }
): Promise<{ restoredCount: number }> {
  try {
    const batch = writeBatch(db);
    let restoredCount = 0;

    for (const acc of payload.accounts || []) {
      const id = String(acc.id || doc(accountsCol(uid)).id);
      const ref = doc(db, 'users', uid, 'accounts', id);
      const data: Record<string, unknown> = {
        userId: uid,
        type: acc.type || 'cash',
        name: String(acc.name || 'Tài khoản').slice(0, 120),
        initialBalance: Number(acc.initialBalance || 0),
        currentBalance: Number(acc.currentBalance || 0),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (acc.bankName) data.bankName = String(acc.bankName).slice(0, 120);
      if (acc.accountNumber) data.accountNumber = String(acc.accountNumber).slice(0, 64);
      batch.set(ref, data);
      restoredCount++;
    }

    for (const bdg of payload.budgets || []) {
      const id = String(bdg.id || doc(budgetsCol(uid)).id);
      const ref = doc(db, 'users', uid, 'budgets', id);
      batch.set(ref, {
        userId: uid,
        name: String(bdg.name || 'Hạn mức').slice(0, 150),
        scopeType: bdg.scopeType || 'category',
        scopeValue: String(bdg.scopeValue || '').slice(0, 150),
        yearMonth: String(bdg.yearMonth || 'ALL').slice(0, 10),
        limitAmount: Math.max(1, Number(bdg.limitAmount || 1)),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      restoredCount++;
    }

    for (const cnt of payload.codeCounters || []) {
      const id = String(cnt.id || '');
      if (!id) continue;
      const ref = doc(db, 'users', uid, 'codeCounters', id);
      const existing = await getDoc(ref);
      const incomingSeq = Math.max(1, Number(cnt.lastSeq || 1));
      if (!existing.exists()) {
        batch.set(ref, {
          userId: uid,
          prefix: cnt.prefix || 'KT',
          yearMonth: String(cnt.yearMonth || ''),
          lastSeq: incomingSeq,
          updatedAt: serverTimestamp(),
        });
      } else {
        const curSeq = Number((existing.data() as { lastSeq: number }).lastSeq);
        if (incomingSeq > curSeq) {
          batch.update(ref, {
            lastSeq: incomingSeq,
            updatedAt: serverTimestamp(),
          });
        }
      }
    }

    for (const tx of payload.transactions || []) {
      const id = String(tx.id || doc(transactionsCol(uid)).id);
      const ref = doc(db, 'users', uid, 'transactions', id);
      const cleanTx: Record<string, unknown> = {
        userId: uid,
        code: String(tx.code || ''),
        kind: tx.kind === 'income' ? 'income' : 'expense',
        name: String(tx.name || '').slice(0, 200),
        amount: Math.max(0, Number(tx.amount || 0)),
        category: String(tx.category || 'Khác').slice(0, 100),
        method: String(tx.method || 'Tiền mặt').slice(0, 80),
        accountId: String(tx.accountId || ''),
        accountName: String(tx.accountName || '').slice(0, 150),
        expectedDate: String(tx.expectedDate || ''),
        status: String(tx.status || 'Đang thực hiện').slice(0, 40),
        isArchived: Boolean(tx.isArchived),
        attachments: Array.isArray(tx.attachments) ? tx.attachments.slice(0, 20) : [],
        auditHistory: Array.isArray(tx.auditHistory) ? tx.auditHistory.slice(0, 100) : [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (tx.source) cleanTx.source = String(tx.source).slice(0, 200);
      if (typeof tx.actualAmount === 'number') cleanTx.actualAmount = tx.actualAmount;
      if (typeof tx.remainingAmount === 'number') cleanTx.remainingAmount = tx.remainingAmount;
      if (tx.counterparty) cleanTx.counterparty = String(tx.counterparty).slice(0, 200);
      if (tx.reason) cleanTx.reason = String(tx.reason).slice(0, 500);
      if (tx.description) cleanTx.description = String(tx.description).slice(0, 2000);
      if (tx.workDuration) cleanTx.workDuration = String(tx.workDuration).slice(0, 120);
      if (tx.purposeTag) cleanTx.purposeTag = String(tx.purposeTag).slice(0, 120);
      if (tx.startDate) cleanTx.startDate = String(tx.startDate).slice(0, 20);
      if (tx.actualDate) cleanTx.actualDate = String(tx.actualDate).slice(0, 20);
      batch.set(ref, cleanTx);
      restoredCount++;
    }

    await batch.commit();
    await writeAuditLog(
      uid,
      actorEmail,
      'backup',
      'KHÔI PHỤC DỮ LIỆU',
      'Khôi phục bản sao lưu JSON',
      `Đã khôi phục ${restoredCount} bản ghi vào cơ sở dữ liệu.`
    );
    return { restoredCount };
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
  }
}
