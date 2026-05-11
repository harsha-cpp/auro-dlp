import React from 'react';

export default function PageHeader({ title, subtitle, actions }) {
  return (
    <header className="px-8 py-6 border-b bg-white flex items-end justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{actions}</div>
    </header>
  );
}
