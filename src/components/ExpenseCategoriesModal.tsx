import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  GripVertical,
  ListOrdered,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { EXPENSE_CATEGORIES } from '../types/finance';
import {
  addExpenseCategory,
  moveExpenseCategory,
  removeExpenseCategory,
  reorderExpenseCategories,
} from '../utils/financeRules';

interface ExpenseCategoriesModalProps {
  open: boolean;
  onClose: () => void;
  expenseCategories: string[];
  selectedCategory?: string;
  onSelectCategory?: (category: string) => void;
  onUpdateExpenseCategories: (nextCategories: string[]) => Promise<void>;
}

export const ExpenseCategoriesModal: React.FC<ExpenseCategoriesModalProps> = ({
  open,
  onClose,
  expenseCategories,
  selectedCategory,
  onSelectCategory,
  onUpdateExpenseCategories,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isPersistingRef = useRef(false);
  const queuedSaveRef = useRef<string[] | null>(null);
  const wasOpenRef = useRef(false);

  const [localCategories, setLocalCategories] = useState<string[]>(expenseCategories);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setLocalCategories(expenseCategories);
      setNewCategoryName('');
      setDraggedIndex(null);
      setDragOverIndex(null);
      setFeedback(null);
      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 40);
      wasOpenRef.current = true;
      return () => window.clearTimeout(timer);
    }
    if (!open) {
      wasOpenRef.current = false;
    }
  }, [open, expenseCategories]);

  useEffect(() => {
    if (open && !isPersistingRef.current && !queuedSaveRef.current) {
      setLocalCategories(expenseCategories);
    }
  }, [open, expenseCategories]);

  if (!open) return null;

  const persistCategories = async (
    nextList: string[],
    successMessage?: string
  ): Promise<boolean> => {
    setLocalCategories(nextList);
    queuedSaveRef.current = nextList;

    if (isPersistingRef.current) {
      return true;
    }

    isPersistingRef.current = true;
    setSaving(true);
    let lastSucceeded = true;

    try {
      while (queuedSaveRef.current) {
        const batchToSave = queuedSaveRef.current;
        queuedSaveRef.current = null;
        await onUpdateExpenseCategories(batchToSave);
      }
      if (successMessage) {
        setFeedback({ type: 'success', text: successMessage });
      }
    } catch (err) {
      lastSucceeded = false;
      queuedSaveRef.current = null;
      setLocalCategories(expenseCategories);
      setFeedback({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể lưu danh mục chi tiêu vào hồ sơ Firestore.',
      });
    } finally {
      isPersistingRef.current = false;
      setSaving(false);
    }

    return lastSucceeded;
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const res = addExpenseCategory(localCategories, newCategoryName);
    if (res.error || !res.added) {
      setFeedback({
        type: 'error',
        text: res.error || 'Không thể thêm danh mục mới.',
      });
      return;
    }

    const addedName = res.added;
    setNewCategoryName('');
    onSelectCategory?.(addedName);
    await persistCategories(
      res.next,
      `Đã thêm danh mục "${addedName}" vào hồ sơ.`
    );
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    setFeedback(null);
    const next = moveExpenseCategory(localCategories, index, direction);
    if (next === localCategories) return;
    const movedName = localCategories[index];
    await persistCategories(
      next,
      `Đã cập nhật thứ tự "${movedName}".`
    );
  };

  const handleDrop = async (targetIndex: number) => {
    const from = draggedIndex;
    setDraggedIndex(null);
    setDragOverIndex(null);
    if (from === null || from === targetIndex) return;

    setFeedback(null);
    const next = reorderExpenseCategories(localCategories, from, targetIndex);
    const movedName = localCategories[from];
    await persistCategories(
      next,
      `Đã chuyển "${movedName}" đến vị trí ${String(targetIndex + 1).padStart(2, '0')}.`
    );
  };

  const handleRemove = async (target: string) => {
    setFeedback(null);
    const res = removeExpenseCategory(localCategories, target);
    if (res.error) {
      setFeedback({ type: 'error', text: res.error });
      return;
    }
    if (selectedCategory === target && res.next.length > 0) {
      onSelectCategory?.(res.next[0]);
    }
    await persistCategories(res.next, `Đã xóa danh mục "${target}".`);
  };

  const handleRestoreDefaults = async () => {
    setFeedback(null);
    const defaults = [...EXPENSE_CATEGORIES];
    if (
      selectedCategory &&
      !defaults.includes(selectedCategory as (typeof EXPENSE_CATEGORIES)[number])
    ) {
      onSelectCategory?.(defaults[0]);
    }
    await persistCategories(
      defaults,
      'Đã khôi phục thứ tự và danh mục chi tiêu mặc định.'
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="expense-categories-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-[#0B1437] via-[#132154] to-[#1E3A8A] text-white flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <ListOrdered className="w-4 h-4 text-blue-100" />
            </div>
            <div className="min-w-0">
              <h2
                id="expense-categories-modal-title"
                className="font-display text-base font-bold truncate"
              >
                Tùy chỉnh &amp; sắp xếp danh mục chi tiêu
              </h2>
              <p className="text-xs text-blue-200/85 truncate">
                Lưu trực tiếp vào hồ sơ Firestore và cập nhật ngay cho biểu mẫu giao dịch
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại danh mục chi tiêu"
            className="p-1.5 rounded-lg text-blue-100 hover:bg-white/15 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Add custom category form */}
          <form onSubmit={handleAddSubmit} className="space-y-2">
            <label
              htmlFor="new-expense-category-input"
              className="block text-xs font-semibold text-slate-700"
            >
              Thêm danh mục chi tiêu tùy chỉnh
            </label>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              <input
                ref={inputRef}
                id="new-expense-category-input"
                type="text"
                maxLength={100}
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="VD: Thú cưng, Bảo trì nhà cửa, Học ngoại ngữ..."
                className="flex-1 h-10 px-3.5 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white"
              />
              <button
                type="submit"
                disabled={localCategories.length >= 100}
                className="inline-flex items-center justify-center gap-1.5 h-10 px-4 bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-bold rounded-xl shadow-xs transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                <span>Thêm danh mục</span>
              </button>
            </div>
          </form>

          {feedback && (
            <div
              role={feedback.type === 'error' ? 'alert' : 'status'}
              className={`flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-xs font-semibold ${
                feedback.type === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}
            >
              {feedback.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          {/* Reorderable list */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="font-bold text-slate-900">
                  Thứ tự trong danh sách chọn
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums text-slate-500">
                  {localCategories.length}/100 danh mục
                </span>
              </div>

              <button
                type="button"
                onClick={handleRestoreDefaults}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-blue-700 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Khôi phục mặc định</span>
              </button>
            </div>

            <ul
              aria-label="Danh sách danh mục chi tiêu có thể sắp xếp"
              className="divide-y divide-slate-100 border border-slate-200/90 rounded-xl overflow-hidden bg-white"
            >
              {localCategories.map((cat, index) => {
                const isFirst = index === 0;
                const isLast = index === localCategories.length - 1;
                const isSelected = selectedCategory === cat;
                const isDragging = draggedIndex === index;
                const isDragTarget =
                  dragOverIndex === index && draggedIndex !== null && draggedIndex !== index;

                return (
                  <li
                    key={cat}
                    draggable
                    onDragStart={(e) => {
                      setDraggedIndex(index);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', cat);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dragOverIndex !== index) {
                        setDragOverIndex(index);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverIndex === index) {
                        setDragOverIndex(null);
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      handleDrop(index);
                    }}
                    onDragEnd={() => {
                      setDraggedIndex(null);
                      setDragOverIndex(null);
                    }}
                    className={`flex items-center justify-between gap-3 px-3.5 py-2.5 transition-colors ${
                      isDragging
                        ? 'opacity-45 bg-slate-100'
                        : isDragTarget
                        ? 'bg-blue-50/80 ring-2 ring-inset ring-blue-500/60'
                        : isSelected
                        ? 'bg-rose-50/60'
                        : 'bg-white hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span
                        aria-hidden="true"
                        className="text-slate-400 cursor-grab active:cursor-grabbing shrink-0"
                        title="Kéo thả để sắp xếp"
                      >
                        <GripVertical className="w-4 h-4" />
                      </span>
                      <span className="text-xs font-mono tabular-nums text-slate-400 w-6 shrink-0">
                        {String(index + 1).padStart(2, '0')}
                      </span>

                      {onSelectCategory ? (
                        <button
                          type="button"
                          onClick={() => onSelectCategory(cat)}
                          className={`text-left text-sm truncate hover:underline ${
                            isSelected
                              ? 'font-bold text-rose-700'
                              : 'font-medium text-slate-800'
                          }`}
                        >
                          {cat}
                        </button>
                      ) : (
                        <span
                          className={`text-sm truncate ${
                            isSelected
                              ? 'font-bold text-rose-700'
                              : 'font-medium text-slate-800'
                          }`}
                        >
                          {cat}
                        </span>
                      )}

                      {(isFirst || isSelected) && (
                        <span className="hidden sm:inline text-[11px] text-slate-400 shrink-0">
                          {isSelected ? '· Đang chọn' : '· Mặc định'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={isFirst}
                        onClick={() => handleMove(index, 'up')}
                        aria-label={`Di chuyển "${cat}" lên`}
                        title="Di chuyển lên"
                        className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={isLast}
                        onClick={() => handleMove(index, 'down')}
                        aria-label={`Di chuyển "${cat}" xuống`}
                        title="Di chuyển xuống"
                        className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={localCategories.length <= 1}
                        onClick={() => handleRemove(cat)}
                        aria-label={`Xóa danh mục "${cat}"`}
                        title={`Xóa "${cat}"`}
                        className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
          <span>
            {saving
              ? 'Đang đồng bộ lên Firestore...'
              : 'Kéo thả hoặc dùng nút mũi tên lên/xuống để thay đổi thứ tự'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-[#0B1437] text-white font-semibold rounded-xl hover:bg-blue-900 transition-colors whitespace-nowrap"
          >
            Xong (Esc)
          </button>
        </div>
      </div>
    </div>
  );
};
