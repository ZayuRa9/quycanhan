import * as XLSX from 'xlsx';
import type {
  BudgetLimit,
  FinancialAccount,
  SavingsGoal,
  Transaction,
} from '../types/finance';
import {
  computeFinancialSummary,
  computeMonthlySeries,
  computePlannedVsActualReport,
  evaluateBudget,
  evaluateSavingsGoal,
  formatDateVN,
  getEffectiveTransactionAmount,
} from './financeRules';

function getAccountTypeLabel(type: FinancialAccount['type']): string {
  switch (type) {
    case 'cash':
      return 'Tiền mặt';
    case 'bank':
      return 'Ngân hàng';
    case 'ewallet':
      return 'Ví điện tử';
    case 'savings':
      return 'Tài khoản tiết kiệm';
  }
}

export function exportFinanceWorkbook(params: {
  transactions: Transaction[];
  accounts: FinancialAccount[];
  budgets: BudgetLimit[];
  savingsGoals?: SavingsGoal[];
  selectedYear: number;
}) {
  const { transactions, accounts, budgets, savingsGoals = [], selectedYear } = params;
  const wb = XLSX.utils.book_new();
  const summary = computeFinancialSummary(accounts, transactions);

  // Sheet 1: Tong_Hop
  const summaryRows = [
    ['BÁO CÁO TỔNG HỢP TÀI CHÍNH CÁ NHÂN', ''],
    ['Ngày xuất báo cáo', formatDateVN(new Date().toISOString().slice(0, 10))],
    ['Năm thống kê', selectedYear],
    ['', ''],
    ['Chỉ tiêu tài chính', 'Giá trị (VNĐ)'],
    ['Tổng số tiền hiện có (tổng các quỹ/tài khoản)', summary.totalAvailableBalance],
    ['Tổng tiền đã thu (thực tế, không tính chuyển khoản)', summary.totalCollectedIncome],
    ['Tổng tiền đã chi (thực tế, không tính chuyển khoản)', summary.totalPaidExpense],
    ['Số dư thực tế', summary.actualBalance],
    ['Chênh lệch thu - chi thực tế', summary.netRealizedCashflow],
    ['Tổng khoản thu đang chờ', summary.pendingIncome],
    ['Tổng khoản chi đang chờ thanh toán', summary.pendingExpense],
    ['Tổng chuyển khoản nội bộ đã thực hiện (tham khảo)', summary.totalTransferVolume],
  ];
  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 52 }, { wch: 24 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Tong_Hop');

  // Sheet 2: Khoan_Thu
  const incomes = transactions.filter((t) => t.kind === 'income');
  const incomeHeader = [
    'Mã giao dịch',
    'Ngày dự kiến nhận',
    'Ngày thực tế nhận',
    'Tên khoản thu',
    'Nguồn khoản thu',
    'Loại thu',
    'Hình thức giao dịch',
    'Tài khoản nhận tiền',
    'Người/Đơn vị gửi',
    'Số tiền dự kiến (VNĐ)',
    'Số tiền thực nhận (VNĐ)',
    'Còn thiếu phải thu (VNĐ)',
    'Trạng thái',
    'Lưu trữ',
    'Mô tả chi tiết',
    'Liên kết Google Drive',
  ];
  const incomeData = incomes.map((t) => [
    t.code,
    formatDateVN(t.expectedDate),
    formatDateVN(t.actualDate),
    t.name,
    t.source || '',
    t.category,
    t.method,
    t.accountName,
    t.counterparty || '',
    t.amount,
    getEffectiveTransactionAmount(t),
    t.remainingAmount ?? 0,
    t.status,
    t.isArchived ? 'Đã lưu trữ' : 'Đang theo dõi',
    t.description || '',
    t.attachments.map((a) => a.webViewLink).join(' | '),
  ]);
  const wsIncome = XLSX.utils.aoa_to_sheet([incomeHeader, ...incomeData]);
  wsIncome['!cols'] = [
    { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 28 }, { wch: 20 },
    { wch: 22 }, { wch: 22 }, { wch: 20 }, { wch: 22 }, { wch: 18 },
    { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 40 },
  ];
  XLSX.utils.book_append_sheet(wb, wsIncome, 'Khoan_Thu');

  // Sheet 3: Khoan_Chi
  const expenses = transactions.filter((t) => t.kind === 'expense');
  const expenseHeader = [
    'Mã giao dịch',
    'Ngày bắt đầu',
    'Ngày dự kiến thanh toán',
    'Ngày chính thức chi',
    'Tên khoản chi',
    'Loại chi',
    'Hình thức giao dịch',
    'Tài khoản thanh toán',
    'Người/Đơn vị nhận',
    'Lý do chi',
    'Số tiền dự kiến (VNĐ)',
    'Số tiền thực chi (VNĐ)',
    'Trạng thái',
    'Lưu trữ',
    'Mô tả chi tiết',
    'Liên kết Google Drive',
  ];
  const expenseData = expenses.map((t) => [
    t.code,
    formatDateVN(t.startDate),
    formatDateVN(t.expectedDate),
    formatDateVN(t.actualDate),
    t.name,
    t.category,
    t.method,
    t.accountName,
    t.counterparty || '',
    t.reason || '',
    t.amount,
    getEffectiveTransactionAmount(t),
    t.status,
    t.isArchived ? 'Đã lưu trữ' : 'Đang xử lý',
    t.description || '',
    t.attachments.map((a) => a.webViewLink).join(' | '),
  ]);
  const wsExpense = XLSX.utils.aoa_to_sheet([expenseHeader, ...expenseData]);
  wsExpense['!cols'] = [
    { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 28 },
    { wch: 24 }, { wch: 22 }, { wch: 20 }, { wch: 22 }, { wch: 26 },
    { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 40 },
  ];
  XLSX.utils.book_append_sheet(wb, wsExpense, 'Khoan_Chi');

  // Sheet 4: Chuyen_Khoan_Noi_Bo
  const transfers = transactions.filter((t) => t.kind === 'transfer');
  const transferHeader = [
    'Mã giao dịch',
    'Ngày dự kiến',
    'Ngày thực tế',
    'Nội dung chuyển',
    'Loại điều chuyển',
    'Từ tài khoản',
    'Đến tài khoản',
    'Số tiền (VNĐ)',
    'Trạng thái',
    'Lưu trữ',
    'Ghi chú',
  ];
  const transferRows = transfers.map((t) => [
    t.code,
    formatDateVN(t.expectedDate),
    formatDateVN(t.actualDate),
    t.name,
    t.category,
    t.accountName,
    t.toAccountName || '—',
    getEffectiveTransactionAmount(t),
    t.status,
    t.isArchived ? 'Đã lưu trữ' : 'Đang theo dõi',
    t.description || '',
  ]);
  const wsTransfer = XLSX.utils.aoa_to_sheet([transferHeader, ...transferRows]);
  wsTransfer['!cols'] = [
    { wch: 16 }, { wch: 14 }, { wch: 14 }, { wch: 28 }, { wch: 20 },
    { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 28 },
  ];
  XLSX.utils.book_append_sheet(wb, wsTransfer, 'Chuyen_Khoan');

  // Sheet 5: Thong_Ke_Thang_Nam
  const monthly = computeMonthlySeries(transactions, selectedYear);
  const monthlyHeader = ['Tháng', `Tổng thu ${selectedYear} (VNĐ)`, `Tổng chi ${selectedYear} (VNĐ)`, 'Chênh lệch ròng (VNĐ)'];
  const monthlyData = monthly.map((m) => [
    `Tháng ${String(m.month).padStart(2, '0')}/${selectedYear}`,
    m.income,
    m.expense,
    m.net,
  ]);
  const yearIncomeTotal = monthly.reduce((s, m) => s + m.income, 0);
  const yearExpenseTotal = monthly.reduce((s, m) => s + m.expense, 0);
  monthlyData.push([
    `Tổng cộng năm ${selectedYear}`,
    yearIncomeTotal,
    yearExpenseTotal,
    yearIncomeTotal - yearExpenseTotal,
  ]);
  const wsMonthly = XLSX.utils.aoa_to_sheet([monthlyHeader, ...monthlyData]);
  wsMonthly['!cols'] = [{ wch: 24 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsMonthly, 'Thong_Ke_Thang_Nam');

  // Sheet 6: Du_Kien_vs_Thuc_Te
  const pva = computePlannedVsActualReport(transactions, { year: selectedYear });
  const pvaHeader = ['Phân loại', 'Danh mục', 'Dự kiến (VNĐ)', 'Thực tế (VNĐ)', 'Chênh lệch (VNĐ)', 'Tỷ lệ thực hiện (%)'];
  const pvaRows = pva.categories.map((c) => [
    c.kind === 'income' ? 'Khoản thu' : 'Khoản chi',
    c.category,
    c.planned,
    c.actual,
    c.variance,
    Number(c.achievementPct.toFixed(1)),
  ]);
  const wsPva = XLSX.utils.aoa_to_sheet([pvaHeader, ...pvaRows]);
  wsPva['!cols'] = [{ wch: 14 }, { wch: 28 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, wsPva, 'Du_Kien_vs_Thuc_Te');

  // Sheet 7: Tai_Khoan_Ngan_Sach
  const accHeader = ['Loại nguồn tiền', 'Tên tài khoản', 'Ngân hàng', 'Số TK', 'Số dư ban đầu', 'Số dư hiện tại', 'Số dư sao kê'];
  const accRows = accounts.map((a) => [
    getAccountTypeLabel(a.type),
    a.name,
    a.bankName || '',
    a.accountNumber || '',
    a.initialBalance,
    a.currentBalance,
    a.actualVerifiedBalance ?? '',
  ]);
  const budgetHeader = ['Tên hạn mức', 'Phạm vi', 'Giá trị áp dụng', 'Tháng', 'Hạn mức (VNĐ)', 'Đã chi (VNĐ)', 'Còn lại (VNĐ)', 'Tỷ lệ (%)'];
  const budgetRows = budgets.map((b) => {
    const ev = evaluateBudget(b, transactions);
    return [
      b.name,
      b.scopeType,
      b.scopeValue,
      b.yearMonth,
      b.limitAmount,
      ev.spent,
      ev.remaining,
      Number(ev.percent.toFixed(1)),
    ];
  });
  const wsAccBudget = XLSX.utils.aoa_to_sheet([
    accHeader,
    ...accRows,
    [],
    budgetHeader,
    ...budgetRows,
  ]);
  wsAccBudget['!cols'] = [
    { wch: 22 }, { wch: 24 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, wsAccBudget, 'Tai_Khoan_Ngan_Sach');

  // Sheet 8: Muc_Tieu_Tiet_Kiem
  if (savingsGoals.length > 0) {
    const savHeader = ['Tên mục tiêu', 'Nhóm', 'Đã tích lũy (VNĐ)', 'Mục tiêu (VNĐ)', 'Còn thiếu (VNĐ)', 'Tiến độ (%)', 'Hạn đích', 'Trạng thái'];
    const savRows = savingsGoals.map((g) => {
      const ev = evaluateSavingsGoal(g);
      return [
        g.name,
        g.category || '',
        g.currentAmount,
        g.targetAmount,
        ev.remainingAmount,
        Number(ev.percent.toFixed(1)),
        g.targetDate ? formatDateVN(g.targetDate) : '—',
        ev.isCompleted ? 'Hoàn thành' : g.status === 'paused' ? 'Tạm dừng' : 'Đang tích lũy',
      ];
    });
    const wsSav = XLSX.utils.aoa_to_sheet([savHeader, ...savRows]);
    wsSav['!cols'] = [
      { wch: 28 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
    ];
    XLSX.utils.book_append_sheet(wb, wsSav, 'Muc_Tieu_Tiet_Kiem');
  }

  const todayTag = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `BaoCao_TaiChinh_${selectedYear}_${todayTag}.xlsx`);
}
