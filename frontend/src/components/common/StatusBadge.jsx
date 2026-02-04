import React from 'react';

const StatusBadge = ({ status, text, size = 'sm' }) => {
  // Status colors with 33% transparency backgrounds on navy theme
  const colors = {
    good: 'bg-emerald-500/[0.15] text-emerald-400 border-emerald-500/30',
    warning: 'bg-amber-500/[0.15] text-amber-400 border-amber-500/30',
    critical: 'bg-red-500/[0.15] text-red-400 border-red-500/30',
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
    lg: 'px-4 py-1.5 text-base',
  };

  return (
    <span className={`rounded-full font-medium border ${colors[status]} ${sizes[size]}`}>
      {text}
    </span>
  );
};

export default StatusBadge;
