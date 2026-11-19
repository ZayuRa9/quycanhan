export type ShortcutNavPage =
  | 'overview'
  | 'transactions'
  | 'accounts'
  | 'budgets'
  | 'savings'
  | 'reports'
  | 'archive'
  | 'settings';

export type ModalLayerState =
  | 'none'
  | 'quick_transaction'
  | 'expense_categories'
  | 'shortcuts_help';

export type ShortcutAction =
  | { type: 'navigate'; page: ShortcutNavPage }
  | { type: 'open_quick_transaction' }
  | { type: 'focus_global_search' }
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
    title: 'Điều hướng 8 phân hệ',
    items: [
      { keys: ['1'], label: 'Tổng quan', description: 'Dashboard tổng quan tài chính & chỉ số chính' },
      { keys: ['2'], label: 'Giao dịch', description: 'Thu nhập, chi tiêu & chuyển khoản nội bộ' },
      { keys: ['3'], label: 'Tài khoản', description: 'Quỹ tiền mặt, ngân hàng, ví điện tử & tiết kiệm' },
      { keys: ['4'], label: 'Ngân sách', description: 'Hạn mức chi tiêu & cảnh báo vượt ngưỡng' },
      { keys: ['5'], label: 'Tiết kiệm', description: 'Mục tiêu tích lũy & lịch sử gửi tiết kiệm' },
      { keys: ['6'], label: 'Báo cáo', description: 'So sánh dự kiến vs thực tế, xuất Excel & PDF' },
      { keys: ['7'], label: 'Lưu trữ', description: 'Hồ sơ hoàn thành, chứng từ, nhật ký & phục hồi' },
      { keys: ['8'], label: 'Cài đặt', description: 'Danh mục, cấu hình, bảo mật & sao lưu' },
    ],
  },
  {
    title: 'Thao tác nhanh & Tìm kiếm',
    items: [
      {
        keys: ['Ctrl / ⌘', 'K'],
        label: 'Tìm kiếm toàn hệ thống',
        description: 'Nhảy nhanh vào ô tìm kiếm tổng hợp trên mọi trang',
      },
      {
        keys: ['N'],
        label: 'Tạo giao dịch mới',
        description: 'Mở nhanh modal tạo thu, chi hoặc chuyển khoản nội bộ',
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

const DIGIT_PAGE_MAP: Record<string, ShortcutNavPage> = {
  '1': 'overview',
  '2': 'transactions',
  '3': 'accounts',
  '4': 'budgets',
  '5': 'savings',
  '6': 'reports',
  '7': 'archive',
  '8': 'settings',
};

const CODE_PAGE_MAP: Record<string, ShortcutNavPage> = {
  Digit1: 'overview',
  Digit2: 'transactions',
  Digit3: 'accounts',
  Digit4: 'budgets',
  Digit5: 'savings',
  Digit6: 'reports',
  Digit7: 'archive',
  Digit8: 'settings',
};

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

  if (
    (input.ctrlKey || input.metaKey) &&
    !input.altKey &&
    key.toLowerCase() === 'k' &&
    input.modalState === 'none'
  ) {
    return { type: 'focus_global_search' };
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

  if (DIGIT_PAGE_MAP[key]) {
    return { type: 'navigate', page: DIGIT_PAGE_MAP[key] };
  }
  if (input.altKey && CODE_PAGE_MAP[code]) {
    return { type: 'navigate', page: CODE_PAGE_MAP[code] };
  }

  if (key.toLowerCase() === 'n' || (input.altKey && code === 'KeyN')) {
    return { type: 'open_quick_transaction' };
  }

  return null;
}
