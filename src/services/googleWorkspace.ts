import type {
  DriveAttachment,
  FinancialAccount,
  Transaction,
} from '../types/finance';
import {
  buildDriveAttachmentName,
  formatDateVN,
  getDriveFolderParts,
  getEffectiveTransactionAmount,
} from '../utils/financeRules';

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
const SHEETS_API_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const CALENDAR_API_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const TASKS_API_URL = 'https://tasks.googleapis.com/tasks/v1';

export class WorkspaceAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceAuthError';
  }
}

async function driveFetch(
  url: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers || {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new WorkspaceAuthError(
      'Phiên kết nối Google Workspace đã hết hạn hoặc chưa đủ quyền. Vui lòng kết nối lại Google Drive.'
    );
  }
  return res;
}

export async function computeFileSha256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function findFolderByName(
  accessToken: string,
  name: string,
  parentId: string
): Promise<{ id: string; webViewLink?: string } | null> {
  const q = `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink)&spaces=drive`;
  const res = await driveFetch(url, accessToken);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Không thể tìm thư mục "${name}" trên Google Drive: ${errText}`);
  }
  const data = (await res.json()) as {
    files?: { id: string; name: string; webViewLink?: string }[];
  };
  return data.files && data.files.length > 0 ? data.files[0] : null;
}

async function createFolder(
  accessToken: string,
  name: string,
  parentId: string
): Promise<{ id: string; webViewLink: string }> {
  const res = await driveFetch(
    `${DRIVE_FILES_URL}?fields=id,name,webViewLink`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    }
  );
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Không thể tạo thư mục "${name}" trên Google Drive: ${errText}`);
  }
  const data = (await res.json()) as { id: string; webViewLink?: string };
  return {
    id: data.id,
    webViewLink: data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`,
  };
}

async function getOrCreateFolder(
  accessToken: string,
  name: string,
  parentId: string
): Promise<{ id: string; webViewLink: string }> {
  const existing = await findFolderByName(accessToken, name, parentId);
  if (existing) {
    return {
      id: existing.id,
      webViewLink: existing.webViewLink || `https://drive.google.com/drive/folders/${existing.id}`,
    };
  }
  return createFolder(accessToken, name, parentId);
}

export async function ensureDriveFolderHierarchy(
  accessToken: string,
  isoDate: string,
  cachedRootFolderId?: string
): Promise<{
  rootFolderId: string;
  yearFolderId: string;
  monthFolderId: string;
  folderPath: string;
  folderWebViewLink: string;
}> {
  const parts = getDriveFolderParts(isoDate);

  let rootFolderId = cachedRootFolderId;
  if (rootFolderId) {
    const checkRes = await driveFetch(
      `${DRIVE_FILES_URL}/${rootFolderId}?fields=id,trashed`,
      accessToken
    );
    if (!checkRes.ok) {
      rootFolderId = undefined;
    } else {
      const meta = (await checkRes.json()) as { id: string; trashed?: boolean };
      if (meta.trashed) rootFolderId = undefined;
    }
  }

  if (!rootFolderId) {
    const rootFolder = await getOrCreateFolder(accessToken, parts.root, 'root');
    rootFolderId = rootFolder.id;
  }

  const yearFolder = await getOrCreateFolder(accessToken, parts.year, rootFolderId);
  const monthFolder = await getOrCreateFolder(accessToken, parts.month, yearFolder.id);

  return {
    rootFolderId,
    yearFolderId: yearFolder.id,
    monthFolderId: monthFolder.id,
    folderPath: parts.path,
    folderWebViewLink: monthFolder.webViewLink,
  };
}

export async function checkDuplicateInDriveFolder(
  accessToken: string,
  folderId: string,
  sha256: string,
  fileName: string,
  existingAttachments: DriveAttachment[]
): Promise<string | null> {
  const localMatch = existingAttachments.find((att) => att.sha256 === sha256);
  if (localMatch) {
    return `Tệp "${fileName}" trùng nội dung (SHA-256) với chứng từ đã tải lên "${localMatch.name}".`;
  }

  const q = `'${folderId}' in parents and trashed = false`;
  const url = `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name,appProperties,sha256Checksum)`;
  const res = await driveFetch(url, accessToken);
  if (res.ok) {
    const data = (await res.json()) as {
      files?: {
        id: string;
        name: string;
        sha256Checksum?: string;
        appProperties?: Record<string, string>;
      }[];
    };
    const match = data.files?.find(
      (f) => f.sha256Checksum === sha256 || f.appProperties?.sha256 === sha256
    );
    if (match) {
      return `Chứng từ "${fileName}" đã tồn tại trên Google Drive trong thư mục này dưới tên "${match.name}".`;
    }
  }

  return null;
}

export async function uploadReceiptToDrive(params: {
  accessToken: string;
  txCode: string;
  isoDate: string;
  file: File;
  existingAttachments: DriveAttachment[];
  incomingBatchSize: number;
  status: string;
  cachedRootFolderId?: string;
  customBaseName?: string;
}): Promise<{ attachment: DriveAttachment; rootFolderId: string }> {
  const {
    accessToken,
    txCode,
    isoDate,
    file,
    existingAttachments,
    incomingBatchSize,
    status,
    cachedRootFolderId,
    customBaseName,
  } = params;

  const sha256 = await computeFileSha256(file);
  const hierarchy = await ensureDriveFolderHierarchy(
    accessToken,
    isoDate,
    cachedRootFolderId
  );

  const duplicateMessage = await checkDuplicateInDriveFolder(
    accessToken,
    hierarchy.monthFolderId,
    sha256,
    file.name,
    existingAttachments
  );
  if (duplicateMessage) {
    throw new Error(duplicateMessage);
  }

  const targetName = buildDriveAttachmentName(
    txCode,
    file.name,
    existingAttachments.length,
    incomingBatchSize,
    customBaseName
  );

  const metadata = {
    name: targetName,
    parents: [hierarchy.monthFolderId],
    description: `Chứng từ giao dịch ${txCode} | Trạng thái: ${status} | Thư mục: ${hierarchy.folderPath}`,
    appProperties: {
      txCode,
      status,
      sha256,
      folderPath: hierarchy.folderPath,
    },
  };

  const boundary = `boundary_${crypto.randomUUID()}`;
  const metadataBlob = JSON.stringify(metadata);
  const fileBuffer = await file.arrayBuffer();

  const headerPart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadataBlob}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`;
  const footerPart = `\r\n--${boundary}--`;

  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(headerPart);
  const footerBytes = encoder.encode(footerPart);
  const combined = new Uint8Array(
    headerBytes.length + fileBuffer.byteLength + footerBytes.length
  );
  combined.set(headerBytes, 0);
  combined.set(new Uint8Array(fileBuffer), headerBytes.length);
  combined.set(footerBytes, headerBytes.length + fileBuffer.byteLength);

  const uploadRes = await driveFetch(
    `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,mimeType,size,webViewLink`,
    accessToken,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: combined,
    }
  );

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Tải chứng từ lên Google Drive thất bại: ${errText}`);
  }

  const uploaded = (await uploadRes.json()) as {
    id: string;
    name: string;
    mimeType?: string;
    size?: string;
    webViewLink?: string;
  };

  return {
    rootFolderId: hierarchy.rootFolderId,
    attachment: {
      id: uploaded.id,
      name: uploaded.name || targetName,
      originalName: file.name,
      mimeType: uploaded.mimeType || file.type || 'application/octet-stream',
      size: Number(uploaded.size || file.size),
      sha256,
      webViewLink:
        uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
      driveFolderId: hierarchy.monthFolderId,
      driveFolderPath: hierarchy.folderPath,
      uploadedAt: new Date().toISOString(),
    },
  };
}

export async function syncTransactionStatusMetadataOnDrive(params: {
  accessToken: string;
  tx: Transaction;
  cachedRootFolderId?: string;
}): Promise<{ metadataFileId: string; rootFolderId: string }> {
  const { accessToken, tx, cachedRootFolderId } = params;
  const dateForFolder = tx.actualDate || tx.expectedDate || tx.startDate || new Date().toISOString().slice(0, 10);
  const hierarchy = await ensureDriveFolderHierarchy(
    accessToken,
    dateForFolder,
    cachedRootFolderId
  );

  // Update status appProperties on every existing attachment without modifying file binary
  for (const att of tx.attachments) {
    try {
      await driveFetch(`${DRIVE_FILES_URL}/${att.id}`, accessToken, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: `Chứng từ ${tx.code} | Trạng thái: ${tx.status} | Lưu trữ: ${tx.isArchived ? 'Đã lưu trữ' : 'Đang xử lý'}`,
          appProperties: {
            txCode: tx.code,
            status: tx.status,
            isArchived: String(tx.isArchived),
          },
        }),
      });
    } catch (err) {
      console.warn('Could not patch attachment metadata on Drive:', err);
    }
  }

  const metadataName = `${tx.code}_TRANG_THAI.json`;
  const kindLabel =
    tx.kind === 'income'
      ? 'KHOẢN THU'
      : tx.kind === 'transfer'
      ? 'CHUYỂN KHOẢN NỘI BỘ'
      : 'KHOẢN CHI';
  const payload = JSON.stringify(
    {
      code: tx.code,
      kind: kindLabel,
      name: tx.name,
      amount: tx.amount,
      actualAmount: tx.actualAmount ?? null,
      status: tx.status,
      isArchived: tx.isArchived,
      accountName: tx.accountName,
      toAccountName: tx.toAccountName ?? null,
      expectedDate: formatDateVN(tx.expectedDate),
      actualDate: tx.actualDate ? formatDateVN(tx.actualDate) : null,
      driveFolderPath: hierarchy.folderPath,
      attachments: tx.attachments.map((a) => ({
        id: a.id,
        name: a.name,
        webViewLink: a.webViewLink,
      })),
      auditHistory: tx.auditHistory,
      syncedAt: new Date().toISOString(),
    },
    null,
    2
  );

  if (tx.driveMetadataFileId) {
    const patchRes = await driveFetch(
      `${DRIVE_UPLOAD_URL}/${tx.driveMetadataFileId}?uploadType=media&fields=id`,
      accessToken,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      }
    );
    if (patchRes.ok) {
      return {
        metadataFileId: tx.driveMetadataFileId,
        rootFolderId: hierarchy.rootFolderId,
      };
    }
  }

  const boundary = `meta_${crypto.randomUUID()}`;
  const metaJson = JSON.stringify({
    name: metadataName,
    parents: [hierarchy.monthFolderId],
    mimeType: 'application/json',
    appProperties: {
      txCode: tx.code,
      recordType: 'status_manifest',
      status: tx.status,
    },
  });

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metaJson}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${payload}\r\n` +
    `--${boundary}--`;

  const createRes = await driveFetch(
    `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id`,
    accessToken,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Không thể đồng bộ tệp trạng thái lên Google Drive: ${errText}`);
  }
  const created = (await createRes.json()) as { id: string };
  return {
    metadataFileId: created.id,
    rootFolderId: hierarchy.rootFolderId,
  };
}

export async function deleteDriveFile(
  accessToken: string,
  fileId: string
): Promise<void> {
  const res = await driveFetch(`${DRIVE_FILES_URL}/${fileId}`, accessToken, {
    method: 'DELETE',
  });
  if (!res.ok && res.status !== 404) {
    const errText = await res.text();
    throw new Error(`Không thể xóa tệp trên Google Drive: ${errText}`);
  }
}

export async function syncLedgerToGoogleSheet(params: {
  accessToken: string;
  transactions: Transaction[];
  accounts: FinancialAccount[];
  existingSpreadsheetId?: string;
}): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const { accessToken, transactions, accounts, existingSpreadsheetId } = params;
  let spreadsheetId = existingSpreadsheetId;
  let spreadsheetUrl = spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}`
    : '';

  let existingTitles = new Set<string>();
  if (spreadsheetId) {
    const checkRes = await driveFetch(
      `${SHEETS_API_URL}/${spreadsheetId}?fields=spreadsheetId,spreadsheetUrl,sheets.properties.title`,
      accessToken
    );
    if (!checkRes.ok) {
      spreadsheetId = undefined;
    } else {
      const info = (await checkRes.json()) as {
        spreadsheetUrl?: string;
        sheets?: Array<{ properties?: { title?: string } }>;
      };
      spreadsheetUrl = info.spreadsheetUrl || spreadsheetUrl;
      existingTitles = new Set(
        (info.sheets || []).map((s) => s.properties?.title || '').filter(Boolean)
      );
    }
  }

  if (!spreadsheetId) {
    const createRes = await driveFetch(SHEETS_API_URL, accessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: { title: 'Sổ Quỹ Cá Nhân — Tổng Hợp Thu Chi' },
        sheets: [
          { properties: { title: 'Khoan_Thu' } },
          { properties: { title: 'Khoan_Chi' } },
          { properties: { title: 'Chuyen_Khoan' } },
          { properties: { title: 'Tai_Khoan' } },
        ],
      }),
    });
    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Không thể tạo Google Sheet: ${errText}`);
    }
    const created = (await createRes.json()) as {
      spreadsheetId: string;
      spreadsheetUrl: string;
    };
    spreadsheetId = created.spreadsheetId;
    spreadsheetUrl = created.spreadsheetUrl;
  } else {
    const requiredTabs = ['Khoan_Thu', 'Khoan_Chi', 'Chuyen_Khoan', 'Tai_Khoan'];
    const missingTabs = requiredTabs.filter((t) => !existingTitles.has(t));
    if (missingTabs.length > 0) {
      const addRes = await driveFetch(
        `${SHEETS_API_URL}/${spreadsheetId}:batchUpdate`,
        accessToken,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: missingTabs.map((title) => ({
              addSheet: { properties: { title } },
            })),
          }),
        }
      );
      if (!addRes.ok) {
        const errText = await addRes.text();
        throw new Error(`Không thể bổ sung trang tính mới vào Google Sheet: ${errText}`);
      }
    }
  }

  const incomeRows = [
    ['Mã GD', 'Tên khoản thu', 'Nguồn', 'Loại thu', 'Hình thức', 'Tài khoản', 'Người gửi', 'Ngày dự kiến', 'Ngày thực nhận', 'Số tiền', 'Thực nhận', 'Trạng thái', 'Lưu trữ'],
    ...transactions
      .filter((t) => t.kind === 'income')
      .map((t) => [
        t.code,
        t.name,
        t.source || '',
        t.category,
        t.method,
        t.accountName,
        t.counterparty || '',
        formatDateVN(t.expectedDate),
        formatDateVN(t.actualDate),
        t.amount,
        getEffectiveTransactionAmount(t),
        t.status,
        t.isArchived ? 'Đã lưu trữ' : 'Đang xử lý',
      ]),
  ];

  const expenseRows = [
    ['Mã GD', 'Tên khoản chi', 'Loại chi', 'Hình thức', 'Tài khoản', 'Người nhận', 'Lý do', 'Ngày dự kiến', 'Ngày chính thức chi', 'Dự kiến', 'Thực chi', 'Trạng thái', 'Lưu trữ'],
    ...transactions
      .filter((t) => t.kind === 'expense')
      .map((t) => [
        t.code,
        t.name,
        t.category,
        t.method,
        t.accountName,
        t.counterparty || '',
        t.reason || '',
        formatDateVN(t.expectedDate),
        formatDateVN(t.actualDate),
        t.amount,
        getEffectiveTransactionAmount(t),
        t.status,
        t.isArchived ? 'Đã lưu trữ' : 'Đang xử lý',
      ]),
  ];

  const transferRows = [
    ['Mã GD', 'Nội dung điều chuyển', 'Loại', 'Hình thức', 'Từ tài khoản', 'Đến tài khoản', 'Ngày dự kiến', 'Ngày thực tế', 'Số tiền', 'Trạng thái', 'Lưu trữ'],
    ...transactions
      .filter((t) => t.kind === 'transfer')
      .map((t) => [
        t.code,
        t.name,
        t.category,
        t.method,
        t.accountName,
        t.toAccountName || '—',
        formatDateVN(t.expectedDate),
        formatDateVN(t.actualDate),
        getEffectiveTransactionAmount(t),
        t.status,
        t.isArchived ? 'Đã lưu trữ' : 'Đang xử lý',
      ]),
  ];

  const accountRows = [
    ['Tên tài khoản', 'Loại', 'Ngân hàng', 'Số tài khoản', 'Số dư ban đầu', 'Số dư hiện tại', 'Số dư sao kê thực tế', 'Đối chiếu gần nhất'],
    ...accounts.map((a) => [
      a.name,
      a.type === 'cash'
        ? 'Tiền mặt'
        : a.type === 'bank'
        ? 'Ngân hàng'
        : a.type === 'savings'
        ? 'Tiết kiệm'
        : 'Ví điện tử',
      a.bankName || '',
      a.accountNumber || '',
      a.initialBalance,
      a.currentBalance,
      a.actualVerifiedBalance ?? '',
      a.lastReconciledAt ? formatDateVN(a.lastReconciledAt.slice(0, 10)) : '',
    ]),
  ];

  const clearRes = await driveFetch(
    `${SHEETS_API_URL}/${spreadsheetId}/values:batchClear`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ranges: ['Khoan_Thu!A1:Z5000', 'Khoan_Chi!A1:Z5000', 'Chuyen_Khoan!A1:Z5000', 'Tai_Khoan!A1:Z1000'],
      }),
    }
  );
  if (!clearRes.ok) {
    const errText = await clearRes.text();
    throw new Error(`Không thể làm mới Google Sheet: ${errText}`);
  }

  const updateRes = await driveFetch(
    `${SHEETS_API_URL}/${spreadsheetId}/values:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: [
          { range: 'Khoan_Thu!A1', values: incomeRows },
          { range: 'Khoan_Chi!A1', values: expenseRows },
          { range: 'Chuyen_Khoan!A1', values: transferRows },
          { range: 'Tai_Khoan!A1', values: accountRows },
        ],
      }),
    }
  );
  if (!updateRes.ok) {
    const errText = await updateRes.text();
    throw new Error(`Không thể ghi dữ liệu vào Google Sheet: ${errText}`);
  }

  return { spreadsheetId, spreadsheetUrl };
}

export async function uploadJsonBackupToDrive(params: {
  accessToken: string;
  jsonContent: string;
  fileName: string;
  cachedRootFolderId?: string;
}): Promise<{ fileId: string; webViewLink: string; rootFolderId: string }> {
  const { accessToken, jsonContent, fileName, cachedRootFolderId } = params;
  const todayIso = new Date().toISOString().slice(0, 10);
  const hierarchy = await ensureDriveFolderHierarchy(accessToken, todayIso, cachedRootFolderId);
  const backupFolder = await getOrCreateFolder(accessToken, 'Backups', hierarchy.rootFolderId);

  const boundary = `backup_${crypto.randomUUID()}`;
  const metadata = JSON.stringify({
    name: fileName,
    parents: [backupFolder.id],
    mimeType: 'application/json',
    description: `Bản sao lưu dữ liệu Sổ Quỹ Cá Nhân ngày ${formatDateVN(todayIso)}`,
    appProperties: {
      recordType: 'ledger_json_backup',
      exportedDate: todayIso,
    },
  });

  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${jsonContent}\r\n` +
    `--${boundary}--`;

  const uploadRes = await driveFetch(
    `${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,webViewLink`,
    accessToken,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Không thể tải bản sao lưu lên Google Drive: ${errText}`);
  }
  const uploaded = (await uploadRes.json()) as { id: string; webViewLink?: string };
  return {
    fileId: uploaded.id,
    webViewLink: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    rootFolderId: hierarchy.rootFolderId,
  };
}

export async function createCalendarReminder(params: {
  accessToken: string;
  tx: Transaction;
}): Promise<{ eventId: string; htmlLink: string }> {
  const { accessToken, tx } = params;
  const dateStr = tx.expectedDate || new Date().toISOString().slice(0, 10);
  const titlePrefix =
    tx.kind === 'income'
      ? '[Thu dự kiến]'
      : tx.kind === 'transfer'
      ? '[Chuyển khoản nội bộ]'
      : '[Hạn thanh toán]';
  const res = await driveFetch(CALENDAR_API_URL, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: `${titlePrefix} ${tx.code} — ${tx.name}`,
      description: `Số tiền: ${tx.amount.toLocaleString('vi-VN')} ₫\nLoại: ${tx.category}\nTài khoản: ${tx.accountName}${tx.toAccountName ? ` → ${tx.toAccountName}` : ''}\nĐối tác: ${tx.counterparty || '—'}\n${tx.description || ''}`,
      start: { date: dateStr },
      end: { date: dateStr },
      reminders: { useDefault: true },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Không thể tạo lịch nhắc trên Google Calendar: ${errText}`);
  }
  const data = (await res.json()) as { id: string; htmlLink?: string };
  return {
    eventId: data.id,
    htmlLink: data.htmlLink || 'https://calendar.google.com',
  };
}

export async function createFinancialTask(params: {
  accessToken: string;
  tx: Transaction;
}): Promise<{ taskId: string }> {
  const { accessToken, tx } = params;
  const dueDate = tx.expectedDate ? `${tx.expectedDate}T09:00:00.000Z` : undefined;
  const actionLabel =
    tx.kind === 'income'
      ? 'Theo dõi thu tiền'
      : tx.kind === 'transfer'
      ? 'Thực hiện chuyển khoản'
      : 'Thanh toán khoản chi';
  const res = await driveFetch(`${TASKS_API_URL}/lists/@default/tasks`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `${actionLabel}: ${tx.code} — ${tx.name}`,
      notes: `Số tiền: ${tx.amount.toLocaleString('vi-VN')} ₫ | Loại: ${tx.category} | Tài khoản: ${tx.accountName}${tx.toAccountName ? ` → ${tx.toAccountName}` : ''}`,
      due: dueDate,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Không thể thêm đầu việc vào Google Tasks: ${errText}`);
  }
  const data = (await res.json()) as { id: string };
  return { taskId: data.id };
}
