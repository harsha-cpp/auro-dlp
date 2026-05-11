import React from 'react';

export default function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="px-6 py-5 border-b bg-white flex items-end justify-between">
      <div>
        <h1 className="text-base font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </header>
  );
}
