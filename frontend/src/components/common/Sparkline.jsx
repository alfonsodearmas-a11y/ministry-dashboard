import React from 'react';

const Sparkline = ({ data, color = '#10b981', height = 24, width = 80, showDot = true }) => {
  if (!data || data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 100 - ((v - min) / range) * 80 - 10; // 10% padding top/bottom
    return `${x},${y}`;
  }).join(' ');

  const lastPoint = data[data.length - 1];
  const lastX = 100;
  const lastY = 100 - ((lastPoint - min) / range) * 80 - 10;

  return (
    <svg viewBox="0 0 100 100" style={{ width, height }} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
      {showDot && (
        <circle
          cx={lastX}
          cy={lastY}
          r="4"
          fill={color}
        />
      )}
    </svg>
  );
};

export default Sparkline;
