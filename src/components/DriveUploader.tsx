import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  HardDrive,
  Pencil,
  Trash2,
  Upload,
} from 'lucide-react';
import type { DriveAttachment } from '../types/finance';
import { getDriveFolderParts, getFileExtension } from '../utils/financeRules';

export interface QueuedUploadFile {
  file: File;
  customName: string;
}

interface DriveUploaderProps {
  txCode: string;
  isoDate: string;
  attachments: DriveAttachment[];
  queuedFiles: QueuedUploadFile[];
  hasDriveToken: boolean;
  onReconnectDrive: () => void;
  onAddQueuedFiles: (files: File[]) => void;
  onRenameQueuedFile: (index: number, customName: string) => void;
  onRemoveQueuedFile: (index: number) => void;
  onRemoveAttachment: (att: DriveAttachment) => void;
}

function getAttachmentIcon(name: string, mimeType?: string) {
  const lower = name.toLowerCase();
  if (
    (mimeType && mimeType.startsWith('image/')) ||
    /\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(lower)
  ) {
    return { Icon: FileImage, color: 'text-violet-600 bg-violet-50' };
  }
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') {
    return { Icon: FileText, color: 'text-rose-600 bg-rose-50' };
  }
  if (/\.(xlsx|xls|csv)$/i.test(lower)) {
    return { Icon: FileSpreadsheet, color: 'text-emerald-600 bg-emerald-50' };
  }
  return { Icon: File, color: 'text-blue-600 bg-blue-50' };
}

export const DriveUploader: React.FC<DriveUploaderProps> = ({
  txCode,
  isoDate,
  attachments,
  queuedFiles,
  hasDriveToken,
  onReconnectDrive,
  onAddQueuedFiles,
  onRenameQueuedFile,
  onRemoveQueuedFile,
  onRemoveAttachment,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const folderParts = getDriveFolderParts(isoDate || new Date().toISOString().slice(0, 10));

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    setErrorMsg(null);
    try {
      onAddQueuedFiles(Array.from(fileList));
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Không thể chọn tệp chứng từ.'
      );
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/70 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-slate-900">
            Chứng từ &amp; Hình ảnh xác nhận (Google Drive)
          </p>
          <p className="text-xs text-slate-500 font-mono">
            Thư mục đích: {folderParts.path}/ · Tên mặc định: {txCode}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-semibold rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap shadow-xs"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Chọn ảnh / chứng từ</span>
          </button>

          {!hasDriveToken && (
            <button
              type="button"
              onClick={onReconnectDrive}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white text-xs font-semibold rounded-lg hover:bg-amber-700 transition-colors whitespace-nowrap"
            >
              <HardDrive className="w-3.5 h-3.5" />
              <span>Kết nối Google Drive</span>
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {queuedFiles.length > 0 && (
        <div className="border border-blue-200 bg-blue-50/70 rounded-xl p-3 space-y-2.5">
          <p className="text-xs font-bold text-blue-950 flex items-center gap-1.5">
            <Pencil className="w-3.5 h-3.5 shrink-0 text-blue-600" />
            <span>
              Đặt tên tệp tải lên Google Drive ({queuedFiles.length} tệp chờ lưu):
            </span>
          </p>
          <ul className="space-y-2">
            {queuedFiles.map((item, idx) => {
              const ext = getFileExtension(item.file.name);
              return (
                <li
                  key={`${item.file.name}-${item.file.size}-${idx}`}
                  className="bg-white border border-blue-200/80 rounded-lg p-2.5 space-y-1.5"
                >
                  <div className="flex items-center gap-2">
                    <label htmlFor={`rename-file-${idx}`} className="sr-only">
                      Tên tệp muốn lưu cho {item.file.name}
                    </label>
                    <input
                      id={`rename-file-${idx}`}
                      type="text"
                      value={item.customName}
                      onChange={(e) => onRenameQueuedFile(idx, e.target.value)}
                      placeholder={txCode}
                      className="flex-1 h-8 px-2.5 text-xs font-mono bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                    {ext && (
                      <span className="text-xs font-mono text-slate-500 shrink-0">
                        {ext}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveQueuedFile(idx)}
                      className="text-xs font-semibold text-rose-600 hover:underline shrink-0 px-1"
                    >
                      Bỏ chọn
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 truncate">
                    Tệp gốc: {item.file.name} · {(item.file.size / 1024).toFixed(1)} KB
                  </p>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {attachments.length === 0 && queuedFiles.length === 0 ? (
        <p className="text-xs text-slate-500">
          Chưa có chứng từ. Bạn có thể chọn hình ảnh/hóa đơn và đổi tên theo yêu cầu trước khi tải lên Google Drive (kiểm tra trùng lặp SHA-256).
        </p>
      ) : attachments.length > 0 ? (
        <ul className="divide-y divide-slate-200 border border-slate-200 rounded-xl bg-white overflow-hidden">
          {attachments.map((att) => {
            const { Icon, color } = getAttachmentIcon(att.name, att.mimeType);
            return (
              <li
                key={att.id}
                className="px-3 py-2.5 flex items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-mono font-semibold text-slate-900 truncate">
                      {att.name}
                    </p>
                    <p className="text-slate-500 truncate">
                      {att.driveFolderPath}/ · {(att.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={`https://drive.google.com/drive/folders/${att.driveFolderId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Mở thư mục trên Google Drive"
                    className="p-1.5 text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                  </a>
                  <a
                    href={att.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Mở chứng từ trên Google Drive"
                    className="p-1.5 text-slate-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() => onRemoveAttachment(att)}
                    title="Gỡ liên kết chứng từ"
                    aria-label={`Gỡ liên kết ${att.name}`}
                    className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
};
