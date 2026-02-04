import React from 'react';
import { RefreshCw, Download, LogIn } from 'lucide-react';

const Header = ({ lastUpdated, isRefreshing, onRefresh }) => {
  return (
    <header className="bg-[#1a2438]/95 backdrop-blur-md border-b border-[#243049] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          {/* Title */}
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#d4af37]">
              Ministry of Public Utilities
            </h1>
            <p className="text-[#94a3b8] text-sm">Operations Dashboard</p>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            {/* Last Updated - hide on mobile */}
            <div className="hidden sm:block text-right">
              <p className="text-[#64748b] text-xs">Last Updated</p>
              <p className="text-[#f1f5f9] text-sm">
                {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={onRefresh}
                disabled={isRefreshing}
                className="p-2 rounded-lg bg-[#1a2438] hover:bg-[#243049] border border-[#243049] transition-colors disabled:opacity-50"
                title="Refresh data"
              >
                <RefreshCw className={`text-[#94a3b8] ${isRefreshing ? 'animate-spin' : ''}`} size={18} />
              </button>

              <button className="hidden sm:flex items-center gap-2 px-3 py-2 rounded-lg bg-[#d4af37] hover:bg-[#e5c04a] text-[#0f1729] text-sm font-medium transition-colors">
                <Download size={16} />
                <span className="hidden md:inline">Export</span>
              </button>

              <a
                href="/admin.html"
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#1a2438] hover:bg-[#243049] text-[#f1f5f9] text-sm font-medium transition-colors border border-[#243049]"
              >
                <LogIn size={16} />
                <span className="hidden md:inline">Admin</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Header;
