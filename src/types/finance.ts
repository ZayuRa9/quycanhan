export type TransactionKind = 'income' | 'expense';

export const TRANSACTION_STATUSES = [
  'Dự kiến',
  'Đã thực hiện',
  'Đã hủy',
] as const;

export type CanonicalTransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export type IncomeStatus =
  | CanonicalTransactionStatus
  | 'Đang chờ thu'
  | 'Đã thu'
  | 'Đã đối soát';
export type ExpenseStatus =
  | CanonicalTransactionStatus
  | 'Đang thực hiện'
  | 'Chờ thanh toán'
  | 'Đã chi'
  | 'Đã đối soát'
  | 'Đã hoàn thành';

export type TransactionStatus = IncomeStatus | ExpenseStatus;

export type AccountType = 'cash' | 'bank' | 'ewallet';

export type BudgetScopeType = 'category' | 'month' | 'purpose' | 'work';

export interface DriveAttachment {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
  webViewLink: string;
  driveFolderId: string;
  driveFolderPath: string;
  uploadedAt: string;
}

export interface AuditHistoryEntry {
  timestamp: string;
  actorEmail: string;
  action: string;
  fromStatus?: string;
  toStatus?: string;
  note?: string;
}

export interface Transaction {
  id: string;
  userId: string;
  code: string;
  kind: TransactionKind;
  name: string;
  source?: string;
  amount: number;
  actualAmount?: number;
  remainingAmount?: number;
  category: string;
  method: string;
  accountId: string;
  accountName: string;
  counterparty?: string;
  reason?: string;
  description?: string;
  workDuration?: string;
  purposeTag?: string;
  startDate?: string;
  expectedDate: string;
  actualDate?: string;
  status: TransactionStatus;
  isArchived: boolean;
  attachments: DriveAttachment[];
  driveMetadataFileId?: string;
  calendarEventId?: string;
  taskItemId?: string;
  auditHistory: AuditHistoryEntry[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FinancialAccount {
  id: string;
  userId: string;
  type: AccountType;
  name: string;
  bankName?: string;
  accountNumber?: string;
  initialBalance: number;
  currentBalance: number;
  actualVerifiedBalance?: number;
  lastReconciledAt?: string;
  reconciliationAttachments?: DriveAttachment[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface BudgetLimit {
  id: string;
  userId: string;
  name: string;
  scopeType: BudgetScopeType;
  scopeValue: string;
  yearMonth: string; // 'YYYY-MM' or 'ALL'
  limitAmount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuditLog {
  id: string;
  userId: string;
  entityType: 'transaction' | 'account' | 'budget' | 'backup';
  entityCode: string;
  action: string;
  details: string;
  actorEmail: string;
  createdAt?: unknown;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  driveRootFolderId?: string;
  spreadsheetId?: string;
  expenseCategories?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export const INCOME_CATEGORIES = [
  'Tiền lương',
  'Tiền thưởng',
  'Thu nhập từ công việc',
  'Tiền công, tiền dịch vụ',
  'Tiền ba mẹ hỗ trợ',
  'Tiền người thân hỗ trợ',
  'Tiền được hoàn trả',
  'Tiền bán hàng',
  'Thu nhập khác',
] as const;

export const INCOME_METHODS = [
  'Tiền mặt',
  'Chuyển khoản ngân hàng',
  'Ví điện tử',
  'Hình thức khác',
] as const;

export const INCOME_STATUSES: CanonicalTransactionStatus[] = [
  'Dự kiến',
  'Đã thực hiện',
  'Đã hủy',
];

export const EXPENSE_CATEGORIES = [
  'Công nghệ cá nhân',
  'Thiết bị điện tử',
  'Phần mềm và dịch vụ trực tuyến',
  'Khoa học và nghiên cứu',
  'Giáo dục và học tập',
  'Sách và tài liệu',
  'Công việc và chuyên môn',
  'Gia đình',
  'Sinh hoạt cá nhân',
  'Ăn uống',
  'Mua sắm',
  'Quần áo và phụ kiện',
  'Đi lại và giao thông',
  'Xăng xe và bảo dưỡng',
  'Y tế và chăm sóc sức khỏe',
  'Giải trí và du lịch',
  'Quà tặng và hiếu hỉ',
  'Hoạt động Đoàn – Hội và xã hội',
  'Tiết kiệm và đầu tư',
  'Thanh toán khoản nợ',
  'Phí ngân hàng và dịch vụ',
  'Chi phí phát sinh',
  'Khác',
] as const;

export const EXPENSE_METHODS = [
  'Tiền mặt',
  'Chuyển khoản ngân hàng',
  'Ví điện tử',
  'Thanh toán thẻ',
  'Thanh toán trực tuyến',
  'Hình thức khác',
] as const;

export const EXPENSE_STATUSES: CanonicalTransactionStatus[] = [
  'Dự kiến',
  'Đã thực hiện',
  'Đã hủy',
];
