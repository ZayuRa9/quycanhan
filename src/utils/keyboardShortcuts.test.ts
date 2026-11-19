import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEditableTarget,
  resolveKeyboardShortcut,
  SHORTCUT_GROUPS,
} from './keyboardShortcuts';

test('resolveKeyboardShortcut maps 1-8, Ctrl/Cmd+K, N, and ? when idle and not in an editable input', () => {
  const base = {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isEditable: false,
    modalState: 'none' as const,
  };

  assert.deepEqual(resolveKeyboardShortcut({ ...base, key: '1' }), { type: 'navigate', page: 'overview' });
  assert.deepEqual(resolveKeyboardShortcut({ ...base, key: '2' }), { type: 'navigate', page: 'transactions' });
  assert.deepEqual(resolveKeyboardShortcut({ ...base, key: '3' }), { type: 'navigate', page: 'accounts' });
  assert.deepEqual(resolveKeyboardShortcut({ ...base, key: '4' }), { type: 'navigate', page: 'budgets' });
  assert.deepEqual(resolveKeyboardShortcut({ ...base, key: '5' }), { type: 'navigate', page: 'savings' });
  assert.deepEqual(resolveKeyboardShortcut({ ...base, key: '6' }), { type: 'navigate', page: 'reports' });
  assert.deepEqual(resolveKeyboardShortcut({ ...base, key: '7' }), { type: 'navigate', page: 'archive' });
  assert.deepEqual(resolveKeyboardShortcut({ ...base, key: '8' }), { type: 'navigate', page: 'settings' });

  assert.deepEqual(resolveKeyboardShortcut({ ...base, key: 'k', ctrlKey: true }), {
    type: 'focus_global_search',
  });
  assert.deepEqual(resolveKeyboardShortcut({ ...base, key: 'K', metaKey: true }), {
    type: 'focus_global_search',
  });
  assert.deepEqual(resolveKeyboardShortcut({ ...base, key: 'n' }), {
    type: 'open_quick_transaction',
  });
  assert.deepEqual(resolveKeyboardShortcut({ ...base, key: 'N', shiftKey: true }), {
    type: 'open_quick_transaction',
  });
  assert.deepEqual(resolveKeyboardShortcut({ ...base, key: '?', shiftKey: true }), {
    type: 'toggle_shortcuts_help',
  });

  // macOS Option+1 / Option+N produces alternate characters but keeps code Digit1 / KeyN
  assert.deepEqual(
    resolveKeyboardShortcut({ ...base, key: '¡', code: 'Digit1', altKey: true }),
    { type: 'navigate', page: 'overview' }
  );
  assert.deepEqual(
    resolveKeyboardShortcut({ ...base, key: '˜', code: 'KeyN', altKey: true }),
    { type: 'open_quick_transaction' }
  );
});

test('resolveKeyboardShortcut never hijacks typing in inputs or unrelated Ctrl/Cmd shortcuts', () => {
  const base = {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isEditable: false,
    modalState: 'none' as const,
  };

  // Typing inside form fields
  assert.equal(resolveKeyboardShortcut({ ...base, key: '1', isEditable: true }), null);
  assert.equal(resolveKeyboardShortcut({ ...base, key: 'n', isEditable: true }), null);
  assert.equal(resolveKeyboardShortcut({ ...base, key: '?', isEditable: true }), null);

  // Ctrl+K is ignored while a modal is open
  assert.equal(
    resolveKeyboardShortcut({ ...base, key: 'k', ctrlKey: true, modalState: 'quick_transaction' }),
    null
  );

  // Browser Ctrl / Cmd combos
  assert.equal(resolveKeyboardShortcut({ ...base, key: '1', ctrlKey: true }), null);
  assert.equal(resolveKeyboardShortcut({ ...base, key: 'n', metaKey: true }), null);
  assert.equal(resolveKeyboardShortcut({ ...base, key: '2', metaKey: true }), null);

  // Key repeat ignored
  assert.equal(resolveKeyboardShortcut({ ...base, key: 'n', repeat: true }), null);
});

test('resolveKeyboardShortcut handles modal layers, Escape, and Ctrl/Cmd+Enter submit', () => {
  const base = {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    isEditable: false,
  };

  // Navigation and N are blocked while modal is open
  assert.equal(
    resolveKeyboardShortcut({ ...base, key: '1', modalState: 'quick_transaction' }),
    null
  );
  assert.equal(
    resolveKeyboardShortcut({ ...base, key: 'n', modalState: 'shortcuts_help' }),
    null
  );

  // Escape closes any open modal, even if focus is inside an input
  assert.deepEqual(
    resolveKeyboardShortcut({
      ...base,
      key: 'Escape',
      isEditable: true,
      modalState: 'quick_transaction',
    }),
    { type: 'close_modal' }
  );
  assert.deepEqual(
    resolveKeyboardShortcut({
      ...base,
      key: 'Escape',
      modalState: 'shortcuts_help',
    }),
    { type: 'close_modal' }
  );
  assert.deepEqual(
    resolveKeyboardShortcut({
      ...base,
      key: 'Escape',
      isEditable: true,
      modalState: 'expense_categories',
    }),
    { type: 'close_modal' }
  );
  assert.equal(
    resolveKeyboardShortcut({ ...base, key: '1', modalState: 'expense_categories' }),
    null
  );
  assert.equal(
    resolveKeyboardShortcut({ ...base, key: 'Escape', modalState: 'none' }),
    null
  );

  // ? toggles help when help modal is open
  assert.deepEqual(
    resolveKeyboardShortcut({
      ...base,
      key: '?',
      shiftKey: true,
      modalState: 'shortcuts_help',
    }),
    { type: 'toggle_shortcuts_help' }
  );

  // Ctrl+Enter / Cmd+Enter submits when quick_transaction modal is open (even inside input)
  assert.deepEqual(
    resolveKeyboardShortcut({
      ...base,
      key: 'Enter',
      ctrlKey: true,
      isEditable: true,
      modalState: 'quick_transaction',
    }),
    { type: 'submit_modal' }
  );
  assert.deepEqual(
    resolveKeyboardShortcut({
      ...base,
      key: 'Enter',
      metaKey: true,
      modalState: 'quick_transaction',
    }),
    { type: 'submit_modal' }
  );
  assert.equal(
    resolveKeyboardShortcut({
      ...base,
      key: 'Enter',
      ctrlKey: true,
      modalState: 'none',
    }),
    null
  );
});

test('isEditableTarget accurately detects input, textarea, select, and contentEditable elements', () => {
  assert.equal(isEditableTarget(null), false);
  assert.equal(isEditableTarget({ tagName: 'DIV' }), false);
  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isEditableTarget({ tagName: 'input' }), true);
  assert.equal(isEditableTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditableTarget({ tagName: 'SELECT' }), true);
  assert.equal(isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(
    isEditableTarget({
      tagName: 'SPAN',
      closest: (sel: string) => (sel.includes('combobox') ? {} : null),
    }),
    true
  );
  assert.ok(SHORTCUT_GROUPS.length >= 3);
});
