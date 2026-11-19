import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeftRight,
  BarChart3,
  HardDrive,
  Keyboard,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PiggyBank,
  Plus,
  Search,
  Settings,
  Target,
  Wallet,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  BudgetLimit,
  FinancialAccount,
  SavingsGoal,
  Transaction,
} from '../types/finance';
import {
  formatVND,
  searchGlobalEntities,
  type GlobalSearchResultItem,
} from '../utils/financeRules';

export type ActivePage =
  | 'overview'
  | 'transactions'
  | 'accounts'
  | 'budgets'
  | 'savings'
  | 'reports'
  | 'archive'
  | 'settings';

interface SidebarLayoutProps {
  activePage: ActivePage;
  onNavigate: (page: ActivePage) => void;
  onSelectSearchResult?: (item: GlobalSearchResultItem) => void;
  searchFocusSignal?: number;
  transactions: Transaction[];
  accounts: FinancialAccount[];
  budgets: BudgetLimit[];
  savingsGoals: SavingsGoal[];
  isOffline?: boolean;
  onOpenQuickTransaction?: () => void;
  onOpenShortcutsHelp?: () => void;
  userEmail: string;
  userName: string;
  hasDriveToken: boolean;
  onReconnectDrive: () => void;
  onSignOut: () => void;
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: ActivePage;
  label: string;
  shortcut: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'overview', label: 'Tổng quan', shortcut: '1', icon: LayoutDashboard },
  { id: 'transactions', label: 'Giao dịch', shortcut: '2', icon: ArrowLeftRight },
  { id: 'accounts', label: 'Tài khoản', shortcut: '3', icon: Landmark },
  { id: 'budgets', label: 'Ngân sách', shortcut: '4', icon: Target },
  { id: 'savings', label: 'Tiết kiệm', shortcut: '5', icon: PiggyBank },
  { id: 'reports', label: 'Báo cáo', shortcut: '6', icon: BarChart3 },
  { id: 'archive', label: 'Lưu trữ', shortcut: '7', icon: Archive },
  { id: 'settings', label: 'Cài đặt', shortcut: '8', icon: Settings },
];

export const SidebarLayout: React.FC<SidebarLayoutProps> = ({
  activePage,
  onNavigate,
  onSelectSearchResult,
  searchFocusSignal = 0,
  transactions,
  accounts,
  budgets,
  savingsGoals,
  isOffline = false,
  onOpenQuickTransaction,
  onOpenShortcutsHelp,
  userEmail,
  userName,
  hasDriveToken,
  onReconnectDrive,
  onSignOut,
  children,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [globalQuery, setGlobalQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (searchFocusSignal > 0) {
      searchInputRef.current?.focus();
      setSearchFocused(true);
    }
  }, [searchFocusSignal]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const searchResults = useMemo(() => {
    if (!globalQuery.trim()) return [];
    return searchGlobalEntities({
      query: globalQuery,
      transactions,
      accounts,
      budgets,
      savingsGoals,
      limit: 12,
    });
  }, [globalQuery, transactions, accounts, budgets, savingsGoals]);

  const handleSelectPage = (page: ActivePage) => {
    onNavigate(page);
    setMobileMenuOpen(false);
  };

  const handlePickResult = (item: GlobalSearchResultItem) => {
    setSearchFocused(false);
    setGlobalQuery('');
    if (onSelectSearchResult) {
      onSelectSearchResult(item);
    } else {
      onNavigate(item.targetPage);
    }
  };

  const userInitials = (userName || userEmail || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  const renderNavLinks = (isCollapsed = false) => (
    <div className="space-y-3">
      <nav aria-label="Điều hướng 8 phân hệ" className="space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activePage === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleSelectPage(item.id)}
              aria-current={active ? 'page' : undefined}
              title={`${item.label} (Phím tắt: ${item.shortcut})`}
              className={`group w-full flex items-center ${
                isCollapsed ? 'justify-center px-2' : 'justify-between px-3'
              } gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all duration-150 whitespace-nowrap ${
                active
                  ? 'bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-950/50'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    active
                      ? 'bg-white/20 text-white'
                      : 'bg-white/5 text-slate-300 group-hover:bg-white/10 group-hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </span>
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </span>
              {!isCollapsed && (
                <kbd
                  className={`hidden lg:inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-mono rounded-md shrink-0 ${
                    active
                      ? 'bg-white/20 text-white border border-white/25'
                      : 'bg-white/5 text-slate-400 border border-white/10 group-hover:text-slate-200'
                  }`}
                >
                  {item.shortcut}
                </kbd>
              )}
            </button>
          );
        })}
      </nav>

      {onOpenQuickTransaction && (
        <button
          type="button"
          onClick={() => {
            setMobileMenuOpen(false);
            onOpenQuickTransaction();
          }}
          title="Mở nhanh modal tạo giao dịch (Phím tắt: N)"
          className={`w-full flex items-center ${
            isCollapsed ? 'justify-center px-2' : 'justify-between px-3'
          } gap-2 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-400/35 text-emerald-200 hover:bg-emerald-500/25 hover:text-white text-xs font-bold transition-all whitespace-nowrap`}
        >
          <span className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-300 shrink-0" />
            {!isCollapsed && <span>Tạo nhanh giao dịch</span>}
          </span>
          {!isCollapsed && (
            <kbd className="hidden lg:inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-mono rounded-md bg-emerald-400/20 text-emerald-100 border border-emerald-300/30">
              N
            </kbd>
          )}
        </button>
      )}
    </div>
  );

  const renderAccountFooter = (isCollapsed = false) => (
    <div className="pt-3 border-t border-white/10 space-y-2.5">
      {onOpenShortcutsHelp && (
        <button
          type="button"
          onClick={() => {
            setMobileMenuOpen(false);
            onOpenShortcutsHelp();
          }}
          title="Xem danh sách phím tắt (Phím tắt: ?)"
          className={`w-full flex items-center ${
            isCollapsed ? 'justify-center px-2' : 'justify-between px-3'
          } gap-2 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 text-xs font-semibold transition-colors whitespace-nowrap`}
        >
          <span className="inline-flex items-center gap-2">
            <Keyboard className="w-3.5 h-3.5 text-blue-300 shrink-0" />
            {!isCollapsed && <span>Phím tắt</span>}
          </span>
          {!isCollapsed && (
            <kbd className="hidden lg:inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-mono rounded-md bg-white/10 text-slate-200 border border-white/15">
              ?
            </kbd>
          )}
        </button>
      )}

      {!isCollapsed ? (
        <div className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 text-slate-300">
              <HardDrive className="w-3.5 h-3.5 text-blue-400 shrink-0" />
              <span>Google Drive</span>
            </span>
            {hasDriveToken ? (
              <span className="text-emerald-400 font-semibold">Đã kết nối</span>
            ) : (
              <button
                type="button"
                onClick={onReconnectDrive}
                className="text-amber-300 font-semibold underline underline-offset-2 hover:text-amber-200"
              >
                Kết nối lại
              </button>
            )}
          </div>
          {!hasDriveToken && (
            <button
              type="button"
              onClick={onReconnectDrive}
              className="w-full flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/20 border border-amber-400/40 text-amber-200 text-xs font-semibold hover:bg-amber-500/30 transition-colors whitespace-nowrap"
            >
              <HardDrive className="w-3.5 h-3.5 shrink-0" />
              <span>Kết nối Google Drive</span>
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={hasDriveToken ? undefined : onReconnectDrive}
          title={hasDriveToken ? 'Google Drive đã kết nối' : 'Kết nối lại Google Drive'}
          className={`w-full flex items-center justify-center py-2 rounded-xl border ${
            hasDriveToken
              ? 'bg-emerald-500/10 border-emerald-400/30 text-emerald-300'
              : 'bg-amber-500/20 border-amber-400/40 text-amber-200'
          }`}
        >
          <HardDrive className="w-4 h-4" />
        </button>
      )}

      <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'gap-2.5 px-1'}`}>
        <div
          title={`${userName} (${userEmail})`}
          className="w-8 h-8 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-display font-bold text-xs flex items-center justify-center shrink-0 shadow-sm"
        >
          {userInitials || 'TK'}
        </div>
        {!isCollapsed && (
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white truncate">{userName}</p>
            <p className="text-[11px] text-slate-400 truncate">{userEmail}</p>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onSignOut}
        title="Đăng xuất"
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-white/15 bg-white/5 text-slate-200 text-xs font-semibold hover:bg-rose-500/20 hover:border-rose-400/40 hover:text-rose-100 transition-colors whitespace-nowrap"
      >
        <LogOut className="w-3.5 h-3.5 shrink-0" />
        {!isCollapsed && <span>Đăng xuất</span>}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen w-full bg-[#f4f7fe] text-slate-900 flex flex-col lg:flex-row">
      {/* Mobile Header */}
      <header className="lg:hidden sticky top-0 z-30 bg-[#0B1437] text-white border-b border-white/10 px-4 h-14 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
            <Wallet className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold text-sm tracking-tight whitespace-nowrap">
            SỔ QUỸ CÁ NHÂN
          </span>
        </div>
        <button
          type="button"
          onClick={() => setMobileMenuOpen((v) => !v)}
          aria-label={mobileMenuOpen ? 'Đóng menu điều hướng' : 'Mở menu điều hướng'}
          aria-expanded={mobileMenuOpen}
          className="p-2 rounded-lg text-slate-200 hover:bg-white/10 transition-colors"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </header>

      {/* Mobile Nav Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-50 w-72 max-w-[85vw] bg-gradient-to-b from-[#0B1437] via-[#0F1B4C] to-[#0B1437] text-white flex flex-col justify-between p-5 shadow-2xl overflow-y-auto">
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                    <Wallet className="w-4 h-4 text-white" />
                  </div>
                  <span className="font-display font-extrabold text-sm tracking-tight">
                    SỔ QUỸ CÁ NHÂN
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Đóng"
                  className="p-1.5 rounded-lg text-slate-300 hover:bg-white/10"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {renderNavLinks(false)}
            </div>
            {renderAccountFooter(false)}
          </aside>
        </div>
      )}

      {/* Collapsible Deep Navy Desktop Sidebar */}
      <aside
        className={`hidden lg:flex ${
          collapsed ? 'lg:w-20' : 'lg:w-64'
        } lg:shrink-0 bg-gradient-to-b from-[#0B1437] via-[#0F1B4C] to-[#0B1437] text-white flex-col justify-between sticky top-0 h-screen ${
          collapsed ? 'px-3 py-4' : 'p-4'
        } shadow-xl border-r border-slate-900/10 transition-all duration-200 overflow-y-auto`}
      >
        <div className="space-y-6">
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} gap-2 pt-1`}>
            {!collapsed && (
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-950/60 shrink-0">
                  <Wallet className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0">
                  <span className="font-display font-extrabold text-sm tracking-tight text-white block whitespace-nowrap">
                    SỔ QUỸ CÁ NHÂN
                  </span>
                  <span className="text-[11px] text-blue-200/75 block truncate">
                    Tài chính thực tế
                  </span>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? 'Mở rộng thanh điều hướng' : 'Thu gọn thanh điều hướng'}
              title={collapsed ? 'Mở rộng sidebar' : 'Thu gọn sidebar'}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white transition-colors shrink-0"
            >
              {collapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>

          {renderNavLinks(collapsed)}
        </div>

        {renderAccountFooter(collapsed)}
      </aside>

      {/* Main Content Area + Top Global Search Bar */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="sticky top-14 lg:top-0 z-20 bg-white/85 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 lg:px-7 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div ref={searchWrapRef} className="relative flex-1 min-w-[220px] max-w-xl">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="search"
              value={globalQuery}
              onFocus={() => setSearchFocused(true)}
              onChange={(e) => {
                setGlobalQuery(e.target.value);
                setSearchFocused(true);
              }}
              placeholder="Tìm nhanh toàn hệ thống: mã KT/KC/CK, giao dịch, tài khoản, ngân sách, tiết kiệm... (Ctrl+K)"
              aria-label="Tìm kiếm toàn hệ thống"
              className="w-full h-9 pl-9 pr-16 text-xs sm:text-sm bg-slate-100/80 border border-slate-200/90 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white transition-all"
            />
            {globalQuery ? (
              <button
                type="button"
                onClick={() => setGlobalQuery('')}
                aria-label="Xóa từ khóa tìm kiếm"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-slate-500 bg-white border border-slate-200 rounded-md absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                Ctrl+K
              </kbd>
            )}

            {searchFocused && globalQuery.trim() && (
              <div className="absolute left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden z-40 max-h-96 overflow-y-auto">
                {searchResults.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-slate-500">
                    Không tìm thấy giao dịch, tài khoản, hạn mức hoặc mục tiêu nào khớp với "{globalQuery}".
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {searchResults.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handlePickResult(item)}
                        className="w-full text-left px-4 py-2.5 hover:bg-blue-50/70 transition-colors flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="px-1.5 py-0.5 text-[10px] font-bold rounded bg-slate-100 text-slate-700 shrink-0">
                              {item.badge}
                            </span>
                            <span className="text-xs font-bold text-slate-900 truncate">
                              {item.title}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                            {item.subtitle}
                          </p>
                        </div>
                        {typeof item.amount === 'number' && (
                          <span className="font-mono text-xs font-bold text-slate-800 tabular-nums shrink-0">
                            {formatVND(item.amount)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isOffline && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800 whitespace-nowrap">
                <WifiOff className="w-3.5 h-3.5" />
                <span>Đang ngoại tuyến — chờ đồng bộ</span>
              </span>
            )}
            {onOpenQuickTransaction && (
              <button
                type="button"
                onClick={onOpenQuickTransaction}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-[#0B1437] to-blue-700 rounded-xl hover:opacity-95 shadow-xs transition-opacity whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Giao dịch mới (N)</span>
              </button>
            )}
          </div>
        </div>

        <main className="flex-1 min-w-0 w-full p-4 sm:p-6 lg:p-7 xl:p-8">
          {children}
        </main>
      </div>
    </div>
  );
};
