import React, { useState } from 'react';
import {
  Archive,
  ArrowLeftRight,
  HardDrive,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Wallet,
  X,
} from 'lucide-react';

export type ActivePage = 'overview' | 'transactions' | 'archive';

interface SidebarLayoutProps {
  activePage: ActivePage;
  onNavigate: (page: ActivePage) => void;
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
  { id: 'transactions', label: 'Thu & Chi', shortcut: '2', icon: ArrowLeftRight },
  { id: 'archive', label: 'Lưu trữ', shortcut: '3', icon: Archive },
];

export const SidebarLayout: React.FC<SidebarLayoutProps> = ({
  activePage,
  onNavigate,
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

  const handleSelectPage = (page: ActivePage) => {
    onNavigate(page);
    setMobileMenuOpen(false);
  };

  const userInitials = (userName || userEmail || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');

  const renderNavLinks = () => (
    <div className="space-y-4">
      <nav aria-label="Điều hướng chính" className="space-y-1.5">
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
              className={`group w-full flex items-center justify-between gap-2 px-3.5 py-3 rounded-xl text-sm font-semibold transition-all duration-150 whitespace-nowrap ${
                active
                  ? 'bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-950/50'
                  : 'text-slate-300 hover:text-white hover:bg-white/10'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    active
                      ? 'bg-white/20 text-white'
                      : 'bg-white/5 text-slate-300 group-hover:bg-white/10 group-hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </span>
                <span className="truncate">{item.label}</span>
              </span>
              <kbd
                className={`hidden lg:inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 text-[11px] font-mono rounded-md shrink-0 ${
                  active
                    ? 'bg-white/20 text-white border border-white/25'
                    : 'bg-white/5 text-slate-400 border border-white/10 group-hover:text-slate-200'
                }`}
              >
                {item.shortcut}
              </kbd>
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
          className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-400/35 text-emerald-200 hover:bg-emerald-500/25 hover:text-white text-xs font-bold transition-all whitespace-nowrap"
        >
          <span className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-300 shrink-0" />
            <span>Tạo nhanh giao dịch</span>
          </span>
          <kbd className="hidden lg:inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 text-[11px] font-mono rounded-md bg-emerald-400/20 text-emerald-100 border border-emerald-300/30">
            N
          </kbd>
        </button>
      )}
    </div>
  );

  const renderAccountFooter = () => (
    <div className="pt-4 border-t border-white/10 space-y-3">
      {onOpenShortcutsHelp && (
        <button
          type="button"
          onClick={() => {
            setMobileMenuOpen(false);
            onOpenShortcutsHelp();
          }}
          title="Xem danh sách phím tắt (Phím tắt: ?)"
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white hover:bg-white/10 text-xs font-semibold transition-colors whitespace-nowrap"
        >
          <span className="inline-flex items-center gap-2">
            <Keyboard className="w-3.5 h-3.5 text-blue-300 shrink-0" />
            <span>Phím tắt</span>
          </span>
          <kbd className="hidden lg:inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 text-[11px] font-mono rounded-md bg-white/10 text-slate-200 border border-white/15">
            ?
          </kbd>
        </button>
      )}
      {/* Google Drive Status Row */}
      <div className="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-slate-300">
            <HardDrive className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <span>Google Drive</span>
          </span>
          {hasDriveToken ? (
            <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Đã kết nối
            </span>
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

      {/* Logged-in Account Profile */}
      <div className="flex items-center gap-2.5 px-1">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-display font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">
          {userInitials || 'TK'}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white truncate">{userName}</p>
          <p className="text-[11px] text-slate-400 truncate">{userEmail}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={onSignOut}
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-white/15 bg-white/5 text-slate-200 text-xs font-semibold hover:bg-rose-500/20 hover:border-rose-400/40 hover:text-rose-100 transition-colors whitespace-nowrap"
      >
        <LogOut className="w-3.5 h-3.5 shrink-0" />
        <span>Đăng xuất</span>
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
          <aside className="relative z-50 w-72 max-w-[85vw] bg-gradient-to-b from-[#0B1437] via-[#0F1B4C] to-[#0B1437] text-white flex flex-col justify-between p-5 shadow-2xl">
            <div className="space-y-6">
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
              {renderNavLinks()}
            </div>
            {renderAccountFooter()}
          </aside>
        </div>
      )}

      {/* Fixed Deep Navy Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:shrink-0 bg-gradient-to-b from-[#0B1437] via-[#0F1B4C] to-[#0B1437] text-white flex-col justify-between sticky top-0 h-screen p-5 shadow-xl border-r border-slate-900/10">
        <div className="space-y-8">
          <div className="flex items-center gap-3 px-1 pt-1">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-950/60 shrink-0">
              <Wallet className="w-5 h-5 text-white" />
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

          {renderNavLinks()}
        </div>

        {renderAccountFooter()}
      </aside>

      {/* Main Content Area — Full Remaining Laptop Width (100vw minus 256px sidebar) */}
      <main className="flex-1 min-w-0 w-full p-4 sm:p-6 lg:p-7 xl:p-8">
        {children}
      </main>
    </div>
  );
};
