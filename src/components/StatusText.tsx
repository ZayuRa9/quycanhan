import React from 'react';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import type {
  CanonicalTransactionStatus,
  TransactionKind,
  TransactionStatus,
} from '../types/finance';
import { normalizeTransactionStatus } from '../utils/financeRules';

export interface StatusVisualMeta {
  label: CanonicalTransactionStatus;
  badgeClass: string;
  dotClass: string;
  cardClass: string;
  activeButtonClass: string;
  idleButtonClass: string;
  Icon: React.ComponentType<{ className?: string }>;
}

export function getStatusMeta(status: TransactionStatus | string): StatusVisualMeta {
  const normalized = normalizeTransactionStatus(status);
  switch (normalized) {
    case 'Đã thực hiện':
      return {
        label: 'Đã thực hiện',
        badgeClass:
          'bg-emerald-100/90 text-emerald-800 border border-emerald-300/90',
        dotClass: 'bg-emerald-500',
        cardClass:
          'border-l-4 border-l-emerald-500 border-emerald-200/80 bg-emerald-50/35 hover:border-emerald-300',
        activeButtonClass:
          'bg-emerald-600 text-white border-emerald-600 shadow-sm shadow-emerald-600/20',
        idleButtonClass:
          'bg-emerald-50/70 text-emerald-800 border-emerald-200 hover:bg-emerald-100/80',
        Icon: CheckCircle2,
      };
    case 'Đã hủy':
      return {
        label: 'Đã hủy',
        badgeClass: 'bg-rose-100/90 text-rose-800 border border-rose-300/90',
        dotClass: 'bg-rose-500',
        cardClass:
          'border-l-4 border-l-rose-500 border-rose-200/80 bg-rose-50/30 hover:border-rose-300 opacity-90',
        activeButtonClass:
          'bg-rose-600 text-white border-rose-600 shadow-sm shadow-rose-600/20',
        idleButtonClass:
          'bg-rose-50/70 text-rose-700 border-rose-200 hover:bg-rose-100/80',
        Icon: XCircle,
      };
    case 'Dự kiến':
    default:
      return {
        label: 'Dự kiến',
        badgeClass: 'bg-amber-100/90 text-amber-800 border border-amber-300/90',
        dotClass: 'bg-amber-500',
        cardClass:
          'border-l-4 border-l-amber-500 border-amber-200/80 bg-amber-50/35 hover:border-amber-300',
        activeButtonClass:
          'bg-amber-500 text-white border-amber-500 shadow-sm shadow-amber-500/20',
        idleButtonClass:
          'bg-amber-50/70 text-amber-800 border-amber-200 hover:bg-amber-100/80',
        Icon: Clock,
      };
  }
}

export const StatusText: React.FC<{
  status: TransactionStatus | string;
  kind?: TransactionKind;
}> = ({ status }) => {
  const { label, badgeClass, Icon } = getStatusMeta(status);

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-bold whitespace-nowrap ${badgeClass}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span>{label}</span>
    </span>
  );
};
