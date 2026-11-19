import type {
  FinancialAccount,
  SavingsGoal,
  Transaction,
} from '../types/finance';
import {
  computeCategoryBreakdown,
  computeFinancialSummary,
  computePlannedVsActualReport,
  computeSavingsSummary,
  formatDateVN,
  formatVND,
} from './financeRules';

export interface PdfJpegPage {
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Pure PDF 1.4 binary builder from JPEG-encoded pages (supports full Vietnamese Unicode
 * via high-DPI browser Canvas typography, without relying on broken Latin-1 PDF fonts or window.open).
 */
export function buildPdfDocumentFromJpegPages(pages: PdfJpegPage[]): Uint8Array {
  if (pages.length === 0) {
    throw new Error('Không có trang báo cáo nào để tạo PDF.');
  }

  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let currentOffset = 0;

  const pushStr = (s: string) => {
    const bytes = encoder.encode(s);
    chunks.push(bytes);
    currentOffset += bytes.length;
  };
  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    currentOffset += bytes.length;
  };

  pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  const offsets: number[] = [0]; // 1-indexed object offsets; index 0 is unused
  // Object 1: Catalog
  // Object 2: Pages
  // Each page uses 3 objects: Page (base), Content stream (base+1), Image XObject (base+2)
  const pageCount = pages.length;
  const pageObjNums: number[] = [];
  for (let i = 0; i < pageCount; i++) {
    pageObjNums.push(3 + i * 3);
  }

  // Obj 1: Catalog
  offsets[1] = currentOffset;
  pushStr('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Obj 2: Pages
  offsets[2] = currentOffset;
  pushStr(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageCount} >>\nendobj\n`
  );

  // A4 portrait in points: 595.28 x 841.89
  const a4W = 595.28;
  const a4H = 841.89;

  for (let i = 0; i < pageCount; i++) {
    const page = pages[i];
    const pageObj = 3 + i * 3;
    const contentObj = pageObj + 1;
    const imageObj = pageObj + 2;

    const contentStream = `q\n${a4W.toFixed(2)} 0 0 ${a4H.toFixed(2)} 0 0 cm\n/Im${i} Do\nQ\n`;
    const contentBytes = encoder.encode(contentStream);

    // Page object
    offsets[pageObj] = currentOffset;
    pushStr(
      `${pageObj} 0 obj\n` +
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${a4W.toFixed(2)} ${a4H.toFixed(2)}] ` +
        `/Resources << /XObject << /Im${i} ${imageObj} 0 R >> >> /Contents ${contentObj} 0 R >>\n` +
        `endobj\n`
    );

    // Content stream object
    offsets[contentObj] = currentOffset;
    pushStr(`${contentObj} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`);
    pushBytes(contentBytes);
    pushStr('\nendstream\nendobj\n');

    // Image XObject
    offsets[imageObj] = currentOffset;
    pushStr(
      `${imageObj} 0 obj\n` +
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.data.length} >>\nstream\n`
    );
    pushBytes(page.data);
    pushStr('\nendstream\nendobj\n');
  }

  const totalObjects = 2 + pageCount * 3;
  const xrefOffset = currentOffset;
  pushStr(`xref\n0 ${totalObjects + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let objNum = 1; objNum <= totalObjects; objNum++) {
    pushStr(`${String(offsets[objNum]).padStart(10, '0')} 00000 n \n`);
  }

  pushStr(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  );

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || '';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  stroke?: string
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

function truncateText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}...`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return `${s}...`;
}

export function exportFinanceReportPdf(params: {
  transactions: Transaction[];
  accounts: FinancialAccount[];
  savingsGoals: SavingsGoal[];
  selectedYear: number;
  selectedMonth: string;
  userEmail?: string;
}) {
  const { transactions, accounts, savingsGoals, selectedYear, selectedMonth, userEmail } = params;
  const W = 1240;
  const H = 1754;
  const margin = 72;
  const contentW = W - margin * 2;
  const fontMain = '"Inter", "Be Vietnam Pro", system-ui, -apple-system, sans-serif';

  const summary = computeFinancialSummary(accounts, transactions);
  const pva = computePlannedVsActualReport(transactions, {
    year: selectedYear,
    month: selectedMonth,
  });
  const expenseCats = computeCategoryBreakdown(
    transactions.filter((tx) => {
      const m = /^(\d{4})-(\d{2})/.exec(tx.actualDate || tx.expectedDate || '');
      if (!m || Number(m[1]) !== selectedYear) return false;
      if (selectedMonth !== 'ALL' && m[2] !== selectedMonth) return false;
      return true;
    }),
    'expense'
  ).slice(0, 8);
  const savingsSum = computeSavingsSummary(savingsGoals);

  const pages: PdfJpegPage[] = [];

  const createCanvas = () => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    return { canvas, ctx };
  };

  // --- Page 1: Executive Summary, Planned vs Actual & Expense Categories ---
  const p1 = createCanvas();
  const ctx = p1.ctx;

  // Header Banner
  drawRoundedRect(ctx, margin, 56, contentW, 136, 18, '#0B1437');
  ctx.fillStyle = '#93C5FD';
  ctx.font = `700 18px ${fontMain}`;
  ctx.fillText('SỔ QUỸ CÁ NHÂN · BÁO CÁO TÀI CHÍNH THỰC TẾ', margin + 32, 102);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `800 34px ${fontMain}`;
  const periodLabel =
    selectedMonth === 'ALL'
      ? `Tổng hợp năm ${selectedYear}`
      : `Tháng ${selectedMonth}/${selectedYear}`;
  ctx.fillText(`Báo Cáo Thu Chi & Dự Kiến vs Thực Tế — ${periodLabel}`, margin + 32, 146);

  ctx.fillStyle = '#CBD5E1';
  ctx.font = `500 17px ${fontMain}`;
  const todayStr = formatDateVN(new Date().toISOString().slice(0, 10));
  ctx.fillText(
    `Ngày xuất: ${todayStr}${userEmail ? ` · Tài khoản: ${userEmail}` : ''} · Chuyển khoản nội bộ không tính vào thu/chi`,
    margin + 32,
    176
  );

  // KPI Grid (2 rows x 3 cards)
  const kpiCards = [
    { label: 'Tổng số dư hiện có', val: formatVND(summary.totalAvailableBalance), bg: '#EFF6FF', border: '#BFDBFE', fg: '#1E3A8A' },
    { label: `Thu thực tế (${periodLabel})`, val: formatVND(pva.actualIncome), bg: '#ECFDF5', border: '#A7F3D0', fg: '#047857' },
    { label: `Chi thực tế (${periodLabel})`, val: formatVND(pva.actualExpense), bg: '#FFF1F2', border: '#FECDD3', fg: '#BE123C' },
    { label: `Thu dự kiến (${periodLabel})`, val: formatVND(pva.plannedIncome), bg: '#F0FDFA', border: '#99F6E4', fg: '#0F766E' },
    { label: `Chi dự kiến (${periodLabel})`, val: formatVND(pva.plannedExpense), bg: '#FFFBEB', border: '#FDE68A', fg: '#B45309' },
    { label: 'Tích lũy tiết kiệm', val: formatVND(savingsSum.totalAccumulated), bg: '#F5F3FF', border: '#DDD6FE', fg: '#5B21B6' },
  ];

  const cardW = (contentW - 32) / 3;
  const cardH = 104;
  kpiCards.forEach((k, idx) => {
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x = margin + col * (cardW + 16);
    const y = 220 + row * (cardH + 16);
    drawRoundedRect(ctx, x, y, cardW, cardH, 14, k.bg, k.border);
    ctx.fillStyle = '#475569';
    ctx.font = `600 16px ${fontMain}`;
    ctx.fillText(truncateText(ctx, k.label, cardW - 32), x + 18, y + 36);
    ctx.fillStyle = k.fg;
    ctx.font = `800 26px ${fontMain}`;
    ctx.fillText(truncateText(ctx, k.val, cardW - 32), x + 18, y + 78);
  });

  // Section: Planned vs Actual Table by Category
  let cursorY = 478;
  ctx.fillStyle = '#0B1437';
  ctx.font = `800 22px ${fontMain}`;
  ctx.fillText('1. So sánh Dự kiến và Thực tế theo Danh mục', margin, cursorY);
  cursorY += 20;

  // Table header
  drawRoundedRect(ctx, margin, cursorY, contentW, 44, 8, '#0F172A');
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 16px ${fontMain}`;
  ctx.fillText('Loại', margin + 16, cursorY + 28);
  ctx.fillText('Danh mục', margin + 120, cursorY + 28);
  ctx.textAlign = 'right';
  ctx.fillText('Dự kiến', margin + 620, cursorY + 28);
  ctx.fillText('Thực tế', margin + 810, cursorY + 28);
  ctx.fillText('Chênh lệch', margin + 1000, cursorY + 28);
  ctx.fillText('Tỷ lệ', margin + contentW - 16, cursorY + 28);
  ctx.textAlign = 'left';
  cursorY += 48;

  const catSlice = pva.categories.slice(0, 11);
  if (catSlice.length === 0) {
    ctx.fillStyle = '#64748B';
    ctx.font = `500 17px ${fontMain}`;
    ctx.fillText('Chưa có dữ liệu giao dịch trong kỳ đã chọn.', margin + 16, cursorY + 34);
    cursorY += 56;
  } else {
    catSlice.forEach((row, idx) => {
      if (idx % 2 === 1) {
        ctx.fillStyle = '#F8FAFC';
        ctx.fillRect(margin, cursorY, contentW, 42);
      }
      ctx.fillStyle = row.kind === 'income' ? '#047857' : '#BE123C';
      ctx.font = `700 15px ${fontMain}`;
      ctx.fillText(row.kind === 'income' ? 'THU' : 'CHI', margin + 16, cursorY + 27);

      ctx.fillStyle = '#0F172A';
      ctx.font = `600 16px ${fontMain}`;
      ctx.fillText(truncateText(ctx, row.category, 300), margin + 120, cursorY + 27);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#334155';
      ctx.fillText(formatVND(row.planned), margin + 620, cursorY + 27);
      ctx.fillStyle = '#0F172A';
      ctx.font = `700 16px ${fontMain}`;
      ctx.fillText(formatVND(row.actual), margin + 810, cursorY + 27);
      ctx.fillStyle = row.variance >= 0 ? '#047857' : '#DC2626';
      ctx.fillText(
        `${row.variance > 0 ? '+' : ''}${formatVND(row.variance)}`,
        margin + 1000,
        cursorY + 27
      );
      ctx.fillStyle = '#334155';
      ctx.fillText(`${row.achievementPct.toFixed(0)}%`, margin + contentW - 16, cursorY + 27);
      ctx.textAlign = 'left';

      ctx.strokeStyle = '#E2E8F0';
      ctx.beginPath();
      ctx.moveTo(margin, cursorY + 42);
      ctx.lineTo(margin + contentW, cursorY + 42);
      ctx.stroke();
      cursorY += 42;
    });
  }

  // Section 2: Top Expense Categories Bar Summary on Page 1
  cursorY += 38;
  ctx.fillStyle = '#0B1437';
  ctx.font = `800 22px ${fontMain}`;
  ctx.fillText('2. Cơ cấu Chi tiêu Thực tế Nổi bật', margin, cursorY);
  cursorY += 22;

  if (expenseCats.length === 0) {
    ctx.fillStyle = '#64748B';
    ctx.font = `500 17px ${fontMain}`;
    ctx.fillText('Chưa có khoản chi thực tế trong kỳ.', margin + 16, cursorY + 26);
  } else {
    expenseCats.forEach((cat) => {
      ctx.fillStyle = '#0F172A';
      ctx.font = `600 16px ${fontMain}`;
      ctx.fillText(truncateText(ctx, cat.category, 380), margin, cursorY + 20);

      const barX = margin + 400;
      const barMaxW = 460;
      drawRoundedRect(ctx, barX, cursorY + 6, barMaxW, 16, 8, '#E2E8F0');
      const fillW = Math.max(8, Math.round((cat.percentage / 100) * barMaxW));
      drawRoundedRect(ctx, barX, cursorY + 6, fillW, 16, 8, '#2563EB');

      ctx.textAlign = 'right';
      ctx.fillStyle = '#0F172A';
      ctx.font = `700 16px ${fontMain}`;
      ctx.fillText(`${formatVND(cat.amount)} (${cat.percentage.toFixed(1)}%)`, margin + contentW, cursorY + 20);
      ctx.textAlign = 'left';
      cursorY += 38;
    });
  }

  // Footer Page 1
  ctx.fillStyle = '#94A3B8';
  ctx.font = `500 15px ${fontMain}`;
  ctx.fillText('Sổ Quỹ Cá Nhân · Trang 1/2', margin, H - 40);

  pages.push({
    data: dataUrlToUint8Array(p1.canvas.toDataURL('image/jpeg', 0.92)),
    width: W,
    height: H,
  });

  // --- Page 2: 12-Month Cashflow Table + Accounts & Savings Goals ---
  const p2 = createCanvas();
  const ctx2 = p2.ctx;
  let y2 = 76;

  ctx2.fillStyle = '#0B1437';
  ctx2.font = `800 22px ${fontMain}`;
  ctx2.fillText(`3. Tổng hợp Thu & Chi Theo Tháng — Năm ${selectedYear}`, margin, y2);
  y2 += 20;

  drawRoundedRect(ctx2, margin, y2, contentW, 44, 8, '#0F172A');
  ctx2.fillStyle = '#FFFFFF';
  ctx2.font = `700 16px ${fontMain}`;
  ctx2.fillText('Tháng', margin + 16, y2 + 28);
  ctx2.textAlign = 'right';
  ctx2.fillText('Thu dự kiến', margin + 390, y2 + 28);
  ctx2.fillText('Thu thực tế', margin + 590, y2 + 28);
  ctx2.fillText('Chi dự kiến', margin + 790, y2 + 28);
  ctx2.fillText('Chi thực tế', margin + 990, y2 + 28);
  ctx2.fillText('Ròng thực tế', margin + contentW - 16, y2 + 28);
  ctx2.textAlign = 'left';
  y2 += 48;

  pva.months.forEach((m, idx) => {
    if (idx % 2 === 1) {
      ctx2.fillStyle = '#F8FAFC';
      ctx2.fillRect(margin, y2, contentW, 38);
    }
    const net = m.actualIncome - m.actualExpense;
    ctx2.fillStyle = '#0F172A';
    ctx2.font = `700 15px ${fontMain}`;
    ctx2.fillText(`Tháng ${String(m.month).padStart(2, '0')}/${selectedYear}`, margin + 16, y2 + 25);

    ctx2.textAlign = 'right';
    ctx2.font = `500 15px ${fontMain}`;
    ctx2.fillStyle = '#64748B';
    ctx2.fillText(formatVND(m.plannedIncome), margin + 390, y2 + 25);
    ctx2.fillStyle = '#047857';
    ctx2.font = `700 15px ${fontMain}`;
    ctx2.fillText(formatVND(m.actualIncome), margin + 590, y2 + 25);
    ctx2.fillStyle = '#64748B';
    ctx2.font = `500 15px ${fontMain}`;
    ctx2.fillText(formatVND(m.plannedExpense), margin + 790, y2 + 25);
    ctx2.fillStyle = '#BE123C';
    ctx2.font = `700 15px ${fontMain}`;
    ctx2.fillText(formatVND(m.actualExpense), margin + 990, y2 + 25);
    ctx2.fillStyle = net >= 0 ? '#047857' : '#DC2626';
    ctx2.fillText(`${net > 0 ? '+' : ''}${formatVND(net)}`, margin + contentW - 16, y2 + 25);
    ctx2.textAlign = 'left';

    y2 += 38;
  });

  // Accounts Summary
  y2 += 42;
  ctx2.fillStyle = '#0B1437';
  ctx2.font = `800 22px ${fontMain}`;
  ctx2.fillText('4. Số Dư Các Nguồn Tiền & Mục Tiêu Tiết Kiệm', margin, y2);
  y2 += 20;

  drawRoundedRect(ctx2, margin, y2, contentW, 42, 8, '#1E293B');
  ctx2.fillStyle = '#FFFFFF';
  ctx2.font = `700 15px ${fontMain}`;
  ctx2.fillText('Tài khoản / Mục tiêu', margin + 16, y2 + 27);
  ctx2.fillText('Phân loại', margin + 520, y2 + 27);
  ctx2.textAlign = 'right';
  ctx2.fillText('Số dư / Đã tích lũy', margin + contentW - 16, y2 + 27);
  ctx2.textAlign = 'left';
  y2 += 46;

  accounts.slice(0, 10).forEach((acc, idx) => {
    if (idx % 2 === 1) {
      ctx2.fillStyle = '#F8FAFC';
      ctx2.fillRect(margin, y2, contentW, 38);
    }
    const typeName =
      acc.type === 'cash'
        ? 'Tiền mặt'
        : acc.type === 'bank'
        ? 'Ngân hàng'
        : acc.type === 'savings'
        ? 'Tiết kiệm'
        : 'Ví điện tử';
    ctx2.fillStyle = '#0F172A';
    ctx2.font = `600 16px ${fontMain}`;
    ctx2.fillText(truncateText(ctx2, acc.name, 460), margin + 16, y2 + 25);
    ctx2.fillStyle = '#475569';
    ctx2.fillText(typeName, margin + 520, y2 + 25);
    ctx2.textAlign = 'right';
    ctx2.fillStyle = '#0F172A';
    ctx2.font = `700 16px ${fontMain}`;
    ctx2.fillText(formatVND(acc.currentBalance), margin + contentW - 16, y2 + 25);
    ctx2.textAlign = 'left';
    y2 += 38;
  });

  savingsGoals.slice(0, 6).forEach((g) => {
    ctx2.fillStyle = '#F5F3FF';
    ctx2.fillRect(margin, y2, contentW, 38);
    ctx2.fillStyle = '#5B21B6';
    ctx2.font = `600 16px ${fontMain}`;
    ctx2.fillText(truncateText(ctx2, `Mục tiêu: ${g.name}`, 460), margin + 16, y2 + 25);
    ctx2.fillStyle = '#6D28D9';
    ctx2.fillText('Mục tiêu tiết kiệm', margin + 520, y2 + 25);
    ctx2.textAlign = 'right';
    ctx2.fillText(
      `${formatVND(g.currentAmount)} / ${formatVND(g.targetAmount)}`,
      margin + contentW - 16,
      y2 + 25
    );
    ctx2.textAlign = 'left';
    y2 += 38;
  });

  ctx2.fillStyle = '#94A3B8';
  ctx2.font = `500 15px ${fontMain}`;
  ctx2.fillText('Sổ Quỹ Cá Nhân · Trang 2/2', margin, H - 40);

  pages.push({
    data: dataUrlToUint8Array(p2.canvas.toDataURL('image/jpeg', 0.92)),
    width: W,
    height: H,
  });

  const pdfBytes = buildPdfDocumentFromJpegPages(pages);
  const copyBytes = new Uint8Array(pdfBytes.byteLength);
  copyBytes.set(pdfBytes);
  const blob = new Blob([copyBytes.buffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const todayTag = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `BaoCao_TaiChinh_${selectedYear}_${todayTag}.pdf`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
