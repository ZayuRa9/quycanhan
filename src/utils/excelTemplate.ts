import XLSX from 'xlsx-js-style';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_METHODS,
  INCOME_CATEGORIES,
  INCOME_METHODS,
  TRANSACTION_STATUSES,
  TRANSFER_CATEGORIES,
  TRANSFER_METHODS,
  type AccountType,
  type BudgetScopeType,
  type ExpenseStatus,
  type IncomeStatus,
  type TransactionKind,
} from '../types/finance';
import { normalizeTransactionStatus, toVndInt } from './financeRules';

export const TEMPLATE_SHEET_NAME = 'Nhap_Lieu_Tai_Chinh';

export const TEMPLATE_HEADERS = [
  'Nhóm dữ liệu *',
  'Tên khoản / Tên tài khoản *',
  'Loại chi tiết *',
  'Số tiền / Số dư ban đầu (VNĐ) *',
  'Số tiền thực tế / Số dư hiện tại (VNĐ)',
  'Hình thức / Tên ngân hàng',
  'Tài khoản / Số tài khoản',
  'Đối tác / Phạm vi ngân sách',
  'Ngày dự kiến (DD/MM/YYYY) / Tháng (YYYY-MM)',
  'Ngày thực tế (DD/MM/YYYY)',
  'Trạng thái',
  'Nguồn thu / Lý do chi',
  'Mục đích / Công việc',
  'Mô tả chi tiết',
] as const;

export interface ParsedAccountRow {
  rowNumber: number;
  type: AccountType;
  name: string;
  initialBalance: number;
  currentBalance: number;
  bankName?: string;
  accountNumber?: string;
}

export interface ParsedTransactionRow {
  rowNumber: number;
  kind: TransactionKind;
  name: string;
  category: string;
  amount: number;
  actualAmount?: number;
  method: string;
  accountName: string;
  toAccountName?: string;
  counterparty?: string;
  expectedDate: string;
  actualDate?: string;
  status: IncomeStatus | ExpenseStatus;
  sourceOrReason?: string;
  purposeTag?: string;
  description?: string;
}

export interface ParsedBudgetRow {
  rowNumber: number;
  name: string;
  scopeType: BudgetScopeType;
  scopeValue: string;
  yearMonth: string;
  limitAmount: number;
}

export interface SingleSheetParseResult {
  accounts: ParsedAccountRow[];
  incomes: ParsedTransactionRow[];
  expenses: ParsedTransactionRow[];
  transfers: ParsedTransactionRow[];
  budgets: ParsedBudgetRow[];
  errors: string[];
}

export function normalizeExcelDate(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const utcDays = Math.floor(raw - 25569);
    const d = new Date(utcDays * 86400 * 1000);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  const str = String(raw).trim();
  const vn = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
  if (vn) {
    return `${vn[3]}-${vn[2].padStart(2, '0')}-${vn[1].padStart(2, '0')}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  return str;
}

export function parseNumericCell(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
  if (raw === null || raw === undefined || raw === '') return NaN;
  const cleaned = String(raw)
    .replace(/[₫\s]/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

function mapAccountType(raw: string): AccountType {
  const lower = raw.trim().toLowerCase();
  if (lower.includes('tiết kiệm') || lower === 'savings') return 'savings';
  if (lower.includes('mặt') || lower === 'cash') return 'cash';
  if (lower.includes('ví') || lower === 'ewallet') return 'ewallet';
  return 'bank';
}

function mapBudgetScope(raw: string): BudgetScopeType {
  const lower = raw.trim().toLowerCase();
  if (lower.includes('tháng') || lower === 'month') return 'month';
  if (lower.includes('mục đích') || lower === 'purpose') return 'purpose';
  if (lower.includes('công việc') || lower === 'work') return 'work';
  return 'category';
}

export function parseSingleSheetRows(rows: unknown[][]): SingleSheetParseResult {
  const result: SingleSheetParseResult = {
    accounts: [],
    incomes: [],
    expenses: [],
    transfers: [],
    budgets: [],
    errors: [],
  };

  if (!rows || rows.length === 0) {
    result.errors.push('Tệp Excel trống.');
    return result;
  }

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const firstCell = String(rows[i]?.[0] ?? '').trim().toLowerCase();
    if (firstCell.includes('nhóm dữ liệu')) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    result.errors.push(
      'Không tìm thấy dòng tiêu đề chuẩn ("Nhóm dữ liệu *") trong sheet đầu tiên. Vui lòng sử dụng đúng file mẫu chuẩn.'
    );
    return result;
  }

  const todayIso = new Date().toISOString().slice(0, 10);

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const excelRowNum = i + 1;
    const rawGroup = String(row[0] ?? '').trim();
    const name = String(row[1] ?? '').trim();

    if (!rawGroup && !name) continue;

    if (rawGroup.startsWith('(') || rawGroup.toLowerCase().startsWith('ví dụ')) {
      continue;
    }

    const groupLower = rawGroup.toLowerCase();
    const detailType = String(row[2] ?? '').trim();
    const amountPrimary = parseNumericCell(row[3]);
    const amountSecondary = parseNumericCell(row[4]);
    const colMethodOrBank = String(row[5] ?? '').trim();
    const colAccountOrNumber = String(row[6] ?? '').trim();
    const colCounterpartyOrScopeVal = String(row[7] ?? '').trim();
    const colExpectedOrYm = row[8];
    const colActualDate = row[9];
    const colStatus = String(row[10] ?? '').trim();
    const colSourceOrReason = String(row[11] ?? '').trim();
    const colPurpose = String(row[12] ?? '').trim();
    const colDesc = String(row[13] ?? '').trim();

    if (!name) {
      result.errors.push(`Dòng ${excelRowNum}: Thiếu tên khoản / tên tài khoản.`);
      continue;
    }

    if (groupLower === 'tài khoản' || groupLower === 'ngân sách hiện có' || groupLower === 'nguồn tiền') {
      if (!Number.isFinite(amountPrimary)) {
        result.errors.push(`Dòng ${excelRowNum}: Số dư ban đầu của tài khoản "${name}" không hợp lệ.`);
        continue;
      }
      result.accounts.push({
        rowNumber: excelRowNum,
        type: mapAccountType(detailType || 'Ngân hàng'),
        name,
        initialBalance: toVndInt(amountPrimary),
        currentBalance: Number.isFinite(amountSecondary) ? toVndInt(amountSecondary) : toVndInt(amountPrimary),
        bankName: colMethodOrBank || undefined,
        accountNumber: colAccountOrNumber || undefined,
      });
    } else if (groupLower === 'hạn mức' || groupLower === 'ngân sách') {
      if (!Number.isFinite(amountPrimary) || amountPrimary <= 0) {
        result.errors.push(`Dòng ${excelRowNum}: Hạn mức "${name}" phải là số dương > 0.`);
        continue;
      }
      const scopeType = mapBudgetScope(detailType || 'Theo loại chi');
      const scopeValue = colCounterpartyOrScopeVal || name;
      const ymRaw = String(colExpectedOrYm ?? '').trim();
      const yearMonth = /^\d{4}-\d{2}$/.test(ymRaw) || ymRaw === 'ALL'
        ? ymRaw
        : todayIso.slice(0, 7);

      result.budgets.push({
        rowNumber: excelRowNum,
        name,
        scopeType,
        scopeValue,
        yearMonth,
        limitAmount: toVndInt(amountPrimary),
      });
    } else if (groupLower === 'thu' || groupLower === 'khoản thu') {
      if (!Number.isFinite(amountPrimary) || amountPrimary < 0) {
        result.errors.push(`Dòng ${excelRowNum}: Số tiền thu của "${name}" không hợp lệ.`);
        continue;
      }
      const matchedCat =
        INCOME_CATEGORIES.find((c) => c.toLowerCase() === detailType.toLowerCase()) ||
        detailType ||
        INCOME_CATEGORIES[0];
      const matchedMethod =
        INCOME_METHODS.find((m) => m.toLowerCase() === colMethodOrBank.toLowerCase()) ||
        colMethodOrBank ||
        INCOME_METHODS[1];
      const matchedStatus = colStatus
        ? TRANSACTION_STATUSES.find((s) => s.toLowerCase() === colStatus.toLowerCase()) ||
          normalizeTransactionStatus(colStatus)
        : 'Dự kiến';
      const expectedDate = normalizeExcelDate(colExpectedOrYm) || todayIso;
      const actualDate = normalizeExcelDate(colActualDate) || undefined;

      result.incomes.push({
        rowNumber: excelRowNum,
        kind: 'income',
        name,
        category: matchedCat,
        amount: toVndInt(amountPrimary),
        actualAmount: Number.isFinite(amountSecondary) ? toVndInt(amountSecondary) : undefined,
        method: matchedMethod,
        accountName: colAccountOrNumber || 'Tiền mặt cá nhân',
        counterparty: colCounterpartyOrScopeVal || undefined,
        expectedDate,
        actualDate,
        status: matchedStatus,
        sourceOrReason: colSourceOrReason || undefined,
        purposeTag: colPurpose || undefined,
        description: colDesc || undefined,
      });
    } else if (groupLower === 'chi' || groupLower === 'khoản chi') {
      if (!Number.isFinite(amountPrimary) || amountPrimary < 0) {
        result.errors.push(`Dòng ${excelRowNum}: Số tiền chi của "${name}" không hợp lệ.`);
        continue;
      }
      const matchedCat =
        EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === detailType.toLowerCase()) ||
        detailType ||
        EXPENSE_CATEGORIES[9];
      const matchedMethod =
        EXPENSE_METHODS.find((m) => m.toLowerCase() === colMethodOrBank.toLowerCase()) ||
        colMethodOrBank ||
        EXPENSE_METHODS[1];
      const matchedStatus = colStatus
        ? TRANSACTION_STATUSES.find((s) => s.toLowerCase() === colStatus.toLowerCase()) ||
          normalizeTransactionStatus(colStatus)
        : 'Dự kiến';
      const expectedDate = normalizeExcelDate(colExpectedOrYm) || todayIso;
      const actualDate = normalizeExcelDate(colActualDate) || undefined;

      result.expenses.push({
        rowNumber: excelRowNum,
        kind: 'expense',
        name,
        category: matchedCat,
        amount: toVndInt(amountPrimary),
        actualAmount: Number.isFinite(amountSecondary) ? toVndInt(amountSecondary) : undefined,
        method: matchedMethod,
        accountName: colAccountOrNumber || 'Tiền mặt cá nhân',
        counterparty: colCounterpartyOrScopeVal || undefined,
        expectedDate,
        actualDate,
        status: matchedStatus,
        sourceOrReason: colSourceOrReason || undefined,
        purposeTag: colPurpose || undefined,
        description: colDesc || undefined,
      });
    } else if (groupLower === 'chuyển khoản' || groupLower === 'chuyển tiền') {
      if (!Number.isFinite(amountPrimary) || amountPrimary <= 0) {
        result.errors.push(`Dòng ${excelRowNum}: Số tiền chuyển khoản "${name}" phải > 0.`);
        continue;
      }
      if (!colCounterpartyOrScopeVal || colCounterpartyOrScopeVal.toLowerCase() === colAccountOrNumber.toLowerCase()) {
        result.errors.push(`Dòng ${excelRowNum}: Chuyển khoản "${name}" cần cột Tài khoản đích (Cột H) khác Tài khoản nguồn (Cột G).`);
        continue;
      }
      const matchedCat =
        TRANSFER_CATEGORIES.find((c) => c.toLowerCase() === detailType.toLowerCase()) ||
        detailType ||
        TRANSFER_CATEGORIES[0];
      const matchedMethod =
        TRANSFER_METHODS.find((m) => m.toLowerCase() === colMethodOrBank.toLowerCase()) ||
        colMethodOrBank ||
        TRANSFER_METHODS[0];
      const matchedStatus = colStatus
        ? TRANSACTION_STATUSES.find((s) => s.toLowerCase() === colStatus.toLowerCase()) ||
          normalizeTransactionStatus(colStatus)
        : 'Dự kiến';
      const expectedDate = normalizeExcelDate(colExpectedOrYm) || todayIso;
      const actualDate = normalizeExcelDate(colActualDate) || undefined;

      result.transfers.push({
        rowNumber: excelRowNum,
        kind: 'transfer',
        name,
        category: matchedCat,
        amount: toVndInt(amountPrimary),
        actualAmount: Number.isFinite(amountSecondary) ? toVndInt(amountSecondary) : undefined,
        method: matchedMethod,
        accountName: colAccountOrNumber || 'Tiền mặt cá nhân',
        toAccountName: colCounterpartyOrScopeVal,
        expectedDate,
        actualDate,
        status: matchedStatus,
        sourceOrReason: colSourceOrReason || undefined,
        purposeTag: colPurpose || undefined,
        description: colDesc || undefined,
      });
    } else {
      result.errors.push(
        `Dòng ${excelRowNum}: Nhóm dữ liệu "${rawGroup}" không hợp lệ (nhận: Tài khoản, Thu, Chi, Chuyển khoản, Hạn mức).`
      );
    }
  }

  return result;
}

export function parseSingleSheetWorkbook(buffer: ArrayBuffer): SingleSheetParseResult {
  const wb = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    return { accounts: [], incomes: [], expenses: [], transfers: [], budgets: [], errors: ['Không tìm thấy sheet nào trong file Excel.'] };
  }
  const ws = wb.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  return parseSingleSheetRows(rows);
}

export function downloadSingleSheetTemplate() {
  const wb = XLSX.utils.book_new();

  const titleRow = [
    'MẪU NHẬP LIỆU TÀI CHÍNH CÁ NHÂN (THU · CHI · CHUYỂN KHOẢN · TÀI KHOẢN · HẠN MỨC)',
    ...Array(TEMPLATE_HEADERS.length - 1).fill(''),
  ];
  const guideRow = [
    'Quy ước: Cột A nhập [Tài khoản | Thu | Chi | Chuyển khoản | Hạn mức]. Với Chuyển khoản: Cột G = TK nguồn, Cột H = TK đích. Ngày nhập DD/MM/YYYY. Số tiền nguyên VNĐ.',
    ...Array(TEMPLATE_HEADERS.length - 1).fill(''),
  ];
  const spacerRow = Array(TEMPLATE_HEADERS.length).fill('');
  const headerRow = [...TEMPLATE_HEADERS];

  const emptyRows = Array.from({ length: 40 }, () =>
    Array(TEMPLATE_HEADERS.length).fill('')
  );

  const aoa = [titleRow, guideRow, spacerRow, headerRow, ...emptyRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  const borderThin = {
    top: { style: 'thin', color: { rgb: 'CBD5E1' } },
    bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
    left: { style: 'thin', color: { rgb: 'CBD5E1' } },
    right: { style: 'thin', color: { rgb: 'CBD5E1' } },
  };

  for (let c = 0; c < TEMPLATE_HEADERS.length; c++) {
    const ref = XLSX.utils.encode_cell({ r: 0, c });
    ws[ref].s = {
      fill: { fgColor: { rgb: '0F172A' } },
      font: { name: 'Calibri', sz: 13, bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { vertical: 'center', horizontal: 'left', indent: 1 },
    };
  }

  for (let c = 0; c < TEMPLATE_HEADERS.length; c++) {
    const ref = XLSX.utils.encode_cell({ r: 1, c });
    ws[ref].s = {
      fill: { fgColor: { rgb: 'F1F5F9' } },
      font: { name: 'Calibri', sz: 10, italic: true, color: { rgb: '334155' } },
      alignment: { vertical: 'center', horizontal: 'left', wrapText: true, indent: 1 },
    };
  }

  for (let c = 0; c < TEMPLATE_HEADERS.length; c++) {
    const ref = XLSX.utils.encode_cell({ r: 3, c });
    ws[ref].s = {
      fill: { fgColor: { rgb: '1E293B' } },
      font: { name: 'Calibri', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
      border: borderThin,
    };
  }

  for (let r = 4; r < 44; r++) {
    const zebraFill = r % 2 === 0 ? 'FFFFFF' : 'F8FAFC';
    for (let c = 0; c < TEMPLATE_HEADERS.length; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      ws[ref].s = {
        fill: { fgColor: { rgb: zebraFill } },
        font: { name: 'Calibri', sz: 10, color: { rgb: '0F172A' } },
        border: borderThin,
        alignment: {
          vertical: 'center',
          horizontal: c === 3 || c === 4 ? 'right' : 'left',
        },
        ...(c === 3 || c === 4 ? { numFmt: '#,##0' } : {}),
      };
    }
  }

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: TEMPLATE_HEADERS.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: TEMPLATE_HEADERS.length - 1 } },
  ];

  ws['!cols'] = [
    { wch: 18 },
    { wch: 28 },
    { wch: 24 },
    { wch: 22 },
    { wch: 22 },
    { wch: 22 },
    { wch: 22 },
    { wch: 24 },
    { wch: 22 },
    { wch: 18 },
    { wch: 18 },
    { wch: 24 },
    { wch: 20 },
    { wch: 30 },
  ];

  ws['!rows'] = [
    { hpt: 30 },
    { hpt: 28 },
    { hpt: 8 },
    { hpt: 34 },
    ...Array.from({ length: 40 }, () => ({ hpt: 22 })),
  ];

  XLSX.utils.book_append_sheet(wb, ws, TEMPLATE_SHEET_NAME);
  XLSX.writeFile(wb, 'Mau_Nhap_Lieu_Tai_Chinh_1Sheet.xlsx');
}
