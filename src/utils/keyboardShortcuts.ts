export type ShortcutNavPage = 'overview' | 'transactions' | 'archive';

export type ModalLayerState = 'none' | 'quick_transaction' | 'shortcuts_help';

export type ShortcutAction =
  | { type: 'navigate'; page: ShortcutNavPage }
  | { type: 'open_quick_transaction' }
  | { type: 'toggle_shortcuts_help' }
  | { type: 'close_modal' }
  | { type: 'submit_modal' };

export interface KeyboardShortcutInput {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isEditable: boolean;
  modalState: ModalLayerState;
}

export interface ShortcutCatalogItem {
  keys: string[];
  label: string;
  description: string;
}

export interface ShortcutCatalogGroup {
  title: string;
  items: ShortcutCatalogItem[];
}

export const SHORTCUT_GROUPS: ShortcutCatalogGroup[] = [
  {
    title: 'Điều hướng trang',
    items: [
      {
        keys: ['1'],
        label: 'Tổng quan',
        description: 'Chuyển nhanh đến trang Tổng quan tài chính',
      },
      {
        keys: ['2'],
        label: 'Thu & Chi',
        description: 'Chuyển nhanh đến trang Thu & Chi và Ngân sách',
      },
      {
        keys: ['3'],
        label: 'Lưu trữ',
        description: 'Chuyển nhanh đến trang Lưu trữ chứng từ & Nhật ký',
      },
    ],
  },
  {
    title: 'Thao tác giao dịch nhanh',
    items: [
      {
        keys: ['N'],
        label: 'Tạo giao dịch mới',
        description: 'Mở nhanh modal tạo khoản thu hoặc khoản chi từ mọi trang',
      },
      {
        keys: ['Ctrl / ⌘', 'Enter'],
        label: 'Lưu giao dịch',
        description: 'Gửi biểu mẫu khi đang mở modal tạo giao dịch',
      },
    ],
  },
  {
    title: 'Hệ thống & Cửa sổ',
    items: [
      {
        keys: ['?'],
        label: 'Bảng phím tắt',
        description: 'Mở hoặc đóng danh sách phím tắt này',
      },
      {
        keys: ['Esc'],
        label: 'Đóng hộp thoại',
        description: 'Đóng modal tạo giao dịch hoặc bảng phím tắt đang mở',
      },
    ],
  },
];

export function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const el = target as {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  };
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  if (el.isContentEditable) {
    return true;
  }
  if (typeof el.closest === 'function') {
    if (el.closest('[contenteditable="true"], [role="combobox"]')) {
      return true;
    }
  }
  return false;
}

export function resolveKeyboardShortcut(
  input: KeyboardShortcutInput
): ShortcutAction | null {
  const key = input.key || '';
  const code = input.code || '';

  if (key === 'Escape') {
    return input.modalState !== 'none' ? { type: 'close_modal' } : null;
  }

  if (
    (input.ctrlKey || input.metaKey) &&
    !input.altKey &&
    key === 'Enter' &&
    input.modalState === 'quick_transaction'
  ) {
    return { type: 'submit_modal' };
  }

  // Never intercept browser/OS Ctrl or Cmd combos
  if (input.ctrlKey || input.metaKey) {
    return null;
  }

  if (input.repeat) {
    return null;
  }

  // Never intercept typing inside inputs, selects, textareas, or editable regions
  if (input.isEditable) {
    return null;
  }

  const isHelpTrigger =
    key === '?' || (input.shiftKey && (key === '/' || code === 'Slash'));
  if (isHelpTrigger) {
    if (input.modalState === 'none' || input.modalState === 'shortcuts_help') {
      return { type: 'toggle_shortcuts_help' };
    }
    return null;
  }

  // When a modal is open, ignore background page-switching or open-modal keys
  if (input.modalState !== 'none') {
    return null;
  }

  if (key === '1' || (input.altKey && code === 'Digit1')) {
    return { type: 'navigate', page: 'overview' };
  }
  if (key === '2' || (input.altKey && code === 'Digit2')) {
    return { type: 'navigate', page: 'transactions' };
  }
  if (key === '3' || (input.altKey && code === 'Digit3')) {
    return { type: 'navigate', page: 'archive' };
  }

  if (key.toLowerCase() === 'n' || (input.altKey && code === 'KeyN')) {
    return { type: 'open_quick_transaction' };
  }

  return null;
}
