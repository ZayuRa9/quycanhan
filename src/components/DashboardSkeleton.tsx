import React from 'react';

export const DashboardSkeleton: React.FC = () => {
  return (
    <div className="space-y-6 animate-fintech-in" aria-label="Đang tải dữ liệu tài chính">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-64 rounded-lg bg-slate-200/80" />
          <div className="h-4 w-80 rounded-md bg-slate-200/60" />
        </div>
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-44 rounded-xl bg-slate-200/70" />
          <div className="h-10 w-40 rounded-xl bg-blue-200/70" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div
            key={idx}
            className="h-32 rounded-2xl border border-slate-200/80 bg-white/80 p-5 flex flex-col justify-between"
          >
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-32 rounded bg-slate-200/70" />
              <div className="h-8 w-8 rounded-xl bg-slate-200/70" />
            </div>
            <div className="h-7 w-44 rounded-md bg-slate-200/80" />
            <div className="h-3 w-36 rounded bg-slate-200/60" />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 h-72 rounded-2xl border border-slate-200/80 bg-white/80 p-5" />
        <div className="h-72 rounded-2xl border border-slate-200/80 bg-white/80 p-5" />
      </div>
    </div>
  );
};
