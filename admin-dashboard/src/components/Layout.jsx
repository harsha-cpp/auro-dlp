import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { apiStream } from '../api/client.js';

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/incidents', label: 'Incidents' },
  { to: '/policies', label: 'Policies' },
  { to: '/endpoints', label: 'Endpoints' },
  { to: '/audit', label: 'Audit Log' },
  { to: '/settings', label: 'Settings' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const [sseConnected, setSseConnected] = useState(false);
  const [newIncidents, setNewIncidents] = useState(0);
  const streamRef = useRef(null);

  useEffect(() => {
    const stream = apiStream('/stream', (type) => {
      if (type === 'incident.created') {
        if (!location.pathname.startsWith('/incidents')) {
          setNewIncidents((n) => n + 1);
        }
      }
    });
    stream.onopen = () => setSseConnected(true);
    stream.onerror = () => setSseConnected(false);
    streamRef.current = stream;
    return () => stream.close();
  }, []);

  useEffect(() => {
    if (location.pathname.startsWith('/incidents')) setNewIncidents(0);
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-56 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <div className="text-base font-semibold tracking-tight">AURO-DLP</div>
          <div className="text-xs text-slate-400 mt-0.5">Admin Console</div>
        </div>
        <nav className="flex-1 py-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={({ isActive }) =>
                `block px-5 py-2 text-sm transition ${
                  isActive
                    ? 'bg-slate-800 text-white font-medium border-l-2 border-slate-400'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border-l-2 border-transparent'
                }`
              }
            >
              {n.label}
              {n.to === '/incidents' && newIncidents > 0 && (
                <span className="ml-2 bg-rose-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{newIncidents}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800 text-xs space-y-2">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${sseConnected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
            <span className="text-slate-400">{sseConnected ? 'Live' : 'Disconnected'}</span>
          </div>
          <div className="text-slate-200 truncate">{user?.email}</div>
          <div className="text-slate-500">{user?.role}</div>
          <button
            onClick={() => { logout(); nav('/login'); }}
            className="mt-1 w-full text-left text-slate-400 hover:text-white"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
