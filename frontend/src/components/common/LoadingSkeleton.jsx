import React from 'react';

const LoadingSkeleton = ({ type = 'card', count = 1 }) => {
  const skeletons = {
    card: (
      <div className="bg-[#1a2438] rounded-2xl p-6 border border-[#243049] animate-pulse">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-[#243049]" />
          <div className="flex-1">
            <div className="h-5 bg-[#243049] rounded w-24 mb-2" />
            <div className="h-4 bg-[#243049] rounded w-16" />
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex justify-between">
            <div className="h-4 bg-[#243049] rounded w-20" />
            <div className="h-4 bg-[#243049] rounded w-16" />
          </div>
          <div className="flex justify-between">
            <div className="h-4 bg-[#243049] rounded w-24" />
            <div className="h-4 bg-[#243049] rounded w-12" />
          </div>
          <div className="flex justify-between">
            <div className="h-4 bg-[#243049] rounded w-16" />
            <div className="h-4 bg-[#243049] rounded w-20" />
          </div>
        </div>
      </div>
    ),
    statusBar: (
      <div className="bg-[#1a2438] rounded-2xl p-6 border border-[#243049] animate-pulse">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-4 h-4 rounded-full bg-[#243049]" />
            <div>
              <div className="h-6 bg-[#243049] rounded w-48 mb-2" />
              <div className="h-4 bg-[#243049] rounded w-32" />
            </div>
          </div>
          <div className="flex gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="w-3 h-3 rounded-full bg-[#243049]" />
            ))}
          </div>
        </div>
      </div>
    ),
    chart: (
      <div className="bg-[#1a2438] rounded-xl p-6 border border-[#243049] animate-pulse">
        <div className="h-5 bg-[#243049] rounded w-32 mb-4" />
        <div className="h-64 bg-[#243049]/50 rounded-lg" />
      </div>
    ),
    table: (
      <div className="bg-[#1a2438] rounded-xl p-6 border border-[#243049] animate-pulse">
        <div className="h-5 bg-[#243049] rounded w-40 mb-4" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex gap-4">
              <div className="h-4 bg-[#243049] rounded flex-1" />
              <div className="h-4 bg-[#243049] rounded w-20" />
              <div className="h-4 bg-[#243049] rounded w-20" />
              <div className="h-4 bg-[#243049] rounded w-16" />
            </div>
          ))}
        </div>
      </div>
    ),
  };

  return (
    <>
      {[...Array(count)].map((_, i) => (
        <React.Fragment key={i}>{skeletons[type]}</React.Fragment>
      ))}
    </>
  );
};

export default LoadingSkeleton;
