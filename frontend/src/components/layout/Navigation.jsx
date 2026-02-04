import React from 'react';

const Navigation = ({ agencies, activeView, onViewChange }) => {
  return (
    <nav className="bg-[#0f1729]/90 border-b border-[#243049]/50 sticky top-[73px] z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex gap-1 py-2 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => onViewChange('summary')}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
              activeView === 'summary'
                ? 'bg-[#d4af37] text-[#0f1729] shadow-lg shadow-[#d4af37]/20'
                : 'text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#1a2438]'
            }`}
          >
            Overview
          </button>
          {agencies.map(agency => (
            <button
              key={agency.id}
              onClick={() => onViewChange(agency.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                activeView === agency.id
                  ? 'bg-[#d4af37] text-[#0f1729] shadow-lg shadow-[#d4af37]/20'
                  : 'text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#1a2438]'
              }`}
            >
              {agency.status?.type === 'critical' && (
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              )}
              {agency.status?.type === 'warning' && (
                <span className="w-2 h-2 rounded-full bg-amber-500" />
              )}
              {agency.title}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
};

export default Navigation;
