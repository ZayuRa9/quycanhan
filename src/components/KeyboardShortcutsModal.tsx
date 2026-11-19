import React from 'react';
import { Keyboard, X } from 'lucide-react';
import { SHORTCUT_GROUPS } from '../utils/keyboardShortcuts';

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

export const KeyboardShortcutsModal: React.FC<KeyboardShortcutsModalProps> = ({
  open,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-4 bg-gradient-to-r from-[#0B1437] via-[#132154] to-[#1E3A8A] text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <Keyboard className="w-4 h-4 text-blue-100" />
            </div>
            <div>
              <h2 id="shortcuts-modal-title" className="font-display text-base font-bold">
                Phím tắt thao tác nhanh
              </h2>
              <p className="text-xs text-blue-200/85">
                Tự động tạm ngưng khi bạn đang nhập liệu trong ô văn bản
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bảng phím tắt"
            className="p-1.5 rounded-lg text-blue-100 hover:bg-white/15 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="space-y-2.5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                {group.title}
              </h3>
              <div className="divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden">
                {group.items.map((item) => (
                  <div
                    key={item.label}
                    className="px-4 py-3 bg-white flex items-center justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {item.label}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {item.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.keys.map((k, idx) => (
                        <React.Fragment key={`${item.label}-${k}`}>
                          {idx > 0 && (
                            <span className="text-xs text-slate-400 font-semibold">+</span>
                          )}
                          <kbd className="inline-flex items-center justify-center min-w-[28px] h-7 px-2 text-xs font-mono font-bold text-slate-800 bg-slate-100 border border-slate-300/90 rounded-lg shadow-[0_1px_0_0_#cbd5e1]">
                            {k}
                          </kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200/80 flex items-center justify-between text-xs text-slate-500">
          <span>Nhấn ? bất kỳ lúc nào để mở lại bảng này</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 bg-slate-900 text-white font-semibold rounded-lg hover:bg-slate-800 transition-colors"
          >
            Đóng (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
