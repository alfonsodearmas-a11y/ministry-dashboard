import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const TrendIndicator = ({ value, inverse = false, showIcon = true, suffix = '%' }) => {
  if (value === 0 || value === null || value === undefined) {
    return (
      <span className="flex items-center gap-1 text-sm text-[#94a3b8]">
        {showIcon && <Minus size={14} />}
        <span>0{suffix}</span>
      </span>
    );
  }

  const isPositive = inverse ? value < 0 : value > 0;
  const Icon = value > 0 ? TrendingUp : TrendingDown;

  return (
    <span className={`flex items-center gap-1 text-sm font-medium ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
      {showIcon && <Icon size={14} />}
      <span>{value > 0 ? '+' : ''}{value.toFixed(1)}{suffix}</span>
    </span>
  );
};

export default TrendIndicator;
