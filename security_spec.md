# Security Specification — Personal Finance Ledger

## 1. Data Invariants
1. Every document under `/users/{userId}/...` belongs strictly to `userId == request.auth.uid` with `request.auth.token.email_verified == true`.
2. Transaction codes (`KT-YYYY.MM-NN`, `KC-YYYY.MM-NN`, `CK-YYYY.MM-NN`), `kind`, `userId`, and `createdAt` are immutable once created.
3. Monotonic `codeCounters` (`lastSeq`) can only increment, never decrement (`incoming().lastSeq > existing().lastSeq`).
4. Audit logs and backup history entries are append-only (`create` allowed for owner, `update` and `delete` forbidden to preserve integrity).
5. All string fields enforce bounded `.size()`, all numeric balances/amounts enforce valid number types and non-negative constraints on transaction amounts/limits/savings goals, and all timestamps enforce `request.time`.
6. Internal transfers (`kind == "transfer"`) must reference a destination account (`toAccountId`) distinct from the source (`accountId != toAccountId`) and are excluded from total income/expense.

## 2. Dirty Dozen Attack Payloads (Expected: PERMISSION_DENIED)
1. Cross-user read on `/users/{otherUid}/transactions/{txId}`.
2. Cross-user list query on `/users/{otherUid}/accounts`.
3. Unverified email write attempt (`email_verified: false`).
4. Shadow field injection (`isAdmin: true` or `extraField: "x"`) on `transactions` create.
5. Immutable code mutation (`code: "KC-2026.11-99"`) on `transactions` update.
6. Client-spoofed `createdAt` timestamp (`createdAt != request.time`) on create.
7. Oversized `description` (> 2000 chars) or `id` (> 128 chars) resource poisoning.
8. Decrementing `codeCounters.lastSeq` to reuse an old code.
9. Modifying or deleting an `auditLogs` or `backupHistory` entry.
10. Negative transaction amount (`amount: -500000`) or negative savings goal target (`targetAmount: -100`).
11. Invalid transaction `kind` (`kind: "unknown"`).
12. Invalid `accountId` / `attachments` array exceeding 20 elements.
