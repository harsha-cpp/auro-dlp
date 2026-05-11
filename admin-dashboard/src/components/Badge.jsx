import React from 'react';

const VARIANT = {
  block: 'bg-rose-100 text-rose-800 ring-rose-200',
  warn: 'bg-amber-100 text-amber-800 ring-amber-200',
  allow: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-sky-100 text-sky-800 ring-sky-200',
};

export default function Badge({ children, variant = 'neutral' }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${VARIANT[variant] || VARIANT.neutral}`}>
      {children}
    </span>
  );
}

export function verdictVariant(v) {
  if (!v) return 'neutral';
  const u = String(v).toUpperCase();
  if (u.startsWith('BLOCK')) return 'block';
  if (u === 'WARN') return 'warn';
  if (u === 'ALLOW') return 'allow';
  return 'neutral';
}
