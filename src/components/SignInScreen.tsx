import React from 'react';
import { AlertCircle, ShieldCheck, Wallet } from 'lucide-react';

interface SignInScreenProps {
  onSignIn: () => void;
  isSigningIn: boolean;
  errorMessage: string | null;
}

export const SignInScreen: React.FC<SignInScreenProps> = ({
  onSignIn,
  isSigningIn,
  errorMessage,
}) => {
  return (
    <div className="min-h-screen w-full bg-[#0B1437] relative overflow-hidden flex items-center justify-center p-6">
      {/* Subtle Architectural Fintech Gradient Backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle at 18% 20%, rgba(37, 99, 235, 0.28), transparent 46%), radial-gradient(circle at 82% 78%, rgba(16, 185, 129, 0.18), transparent 44%), radial-gradient(circle at 60% 15%, rgba(124, 58, 237, 0.2), transparent 38%)',
        }}
      />

      <div className="relative z-10 w-full max-w-4xl grid grid-cols-1 lg:grid-cols-12 rounded-3xl overflow-hidden shadow-2xl border border-white/10 bg-white/5 backdrop-blur-xl">
        {/* Left Navy Brand Column */}
        <div className="lg:col-span-6 p-8 sm:p-10 flex flex-col justify-between bg-gradient-to-br from-[#0F1B4C]/95 via-[#0B1437]/95 to-[#172554]/95 text-white border-b lg:border-b-0 lg:border-r border-white/10">
          <div className="space-y-6">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-blue-900/50">
                <Wallet className="w-6 h-6 text-white" />
              </div>
              <div>
                <span className="font-display font-extrabold text-xl tracking-tight block">
                  SỔ QUỸ CÁ NHÂN
                </span>
                <span className="text-xs text-blue-200/80">
                  Quản lý dòng tiền &amp; chứng từ thực tế
                </span>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight leading-tight text-white">
                Kiểm soát thu chi, ngân sách &amp; chứng từ tập trung
              </h1>
              <p className="text-sm text-slate-300 leading-relaxed">
                Đồng bộ thời gian thực trên Firestore, xuất báo cáo Excel chuẩn mực và tự động phân loại chứng từ lên Google Drive cá nhân.
              </p>
            </div>
          </div>

          <div className="pt-8 flex items-center gap-2.5 text-xs text-emerald-300 font-medium">
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Xác thực bảo mật Google Workspace &amp; Firebase Auth</span>
          </div>
        </div>

        {/* Right Sign-In Action Column */}
        <div className="lg:col-span-6 p-8 sm:p-10 bg-white flex flex-col justify-center space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
              Truy cập hệ thống
            </p>
            <h2 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              Đăng nhập tài khoản
            </h2>
            <p className="text-sm text-slate-500 leading-relaxed">
              Sử dụng tài khoản Google để mở toàn bộ Sổ Quỹ Cá Nhân. Kết nối Google Drive và Google Sheets có thể bật thêm bất kỳ lúc nào bên trong ứng dụng.
            </p>
          </div>

          {errorMessage && (
            <div
              role="alert"
              className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-700"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div className="pt-1">
            <button
              type="button"
              onClick={onSignIn}
              disabled={isSigningIn}
              className="gsi-material-button w-full"
              aria-label="Sign in with Google"
            >
              <div className="gsi-material-button-state" />
              <div className="gsi-material-button-content-wrapper">
                <div className="gsi-material-button-icon">
                  <svg
                    version="1.1"
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 48 48"
                    style={{ display: 'block' }}
                  >
                    <path
                      fill="#EA4335"
                      d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                    />
                    <path
                      fill="#4285F4"
                      d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                    />
                    <path
                      fill="#34A853"
                      d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                    />
                    <path fill="none" d="M0 0h48v48H0z" />
                  </svg>
                </div>
                <span className="gsi-material-button-contents">
                  {isSigningIn ? 'Đang kết nối...' : 'Đăng nhập bằng Google'}
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
