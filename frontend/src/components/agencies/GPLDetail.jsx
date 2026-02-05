import React, { useMemo } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AlertTriangle, Zap, CheckCircle, Sun, Ship, Factory, TrendingDown, Clock, Battery } from 'lucide-react';

const GPLDetail = ({ data }) => {
  // Compute all metrics from raw station data
  const summary = useMemo(() => {
    if (!data?.powerStations) return null;

    const stations = data.powerStations;
    const totalDerated = stations.reduce((sum, s) => sum + s.derated, 0);
    const totalAvailable = stations.reduce((sum, s) => sum + s.available, 0);
    const totalUnits = stations.reduce((sum, s) => sum + s.units, 0);

    // Preserve station order from data source (logical grouping)
    const enrichedStations = stations.map(s => ({
      ...s,
      availability: s.derated > 0 ? (s.available / s.derated) * 100 : 0,
      status: s.available === 0 ? 'offline'
            : s.available / s.derated < 0.5 ? 'critical'
            : s.available / s.derated < 0.7 ? 'degraded'
            : 'operational',
    }));

    // Solar totals
    const totalSolar = data.solarStations?.reduce((sum, s) => sum + s.capacity, 0) || data.totalRenewableCapacity || 0;

    // Total DBIS = Available Fossil + Renewable
    const totalDBIS = totalAvailable + totalSolar;

    // Expected capacity after FOR
    const expectedCapacity = totalAvailable * (1 - (data.forcedOutageRate || 7.5) / 100);

    return {
      totalDerated: Math.round(totalDerated * 10) / 10,
      totalAvailable: Math.round(totalAvailable * 10) / 10,
      totalOffline: Math.round((totalDerated - totalAvailable) * 10) / 10,
      availability: Math.round((totalAvailable / totalDerated) * 1000) / 10,
      totalUnits,
      totalSolar,
      totalDBIS: Math.round(totalDBIS * 10) / 10,
      expectedPeak: data.expectedPeakDemand || 200,
      expectedCapacity: Math.round(expectedCapacity * 10) / 10,
      reserve: Math.round((expectedCapacity - (data.expectedPeakDemand || 200)) * 10) / 10,
      stations: enrichedStations,
      operational: enrichedStations.filter(s => s.status === 'operational'),
      degraded: enrichedStations.filter(s => s.status === 'degraded'),
      critical: enrichedStations.filter(s => s.status === 'critical'),
      offline: enrichedStations.filter(s => s.status === 'offline'),
    };
  }, [data]);

  if (!summary) return null;

  const getBarColor = (status) => {
    switch (status) {
      case 'operational': return '#10b981';
      case 'degraded': return '#f59e0b';
      case 'critical': return '#f97316';
      case 'offline': return '#ef4444';
      default: return '#64748b';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'operational': return <CheckCircle size={12} />;
      case 'degraded': return <AlertTriangle size={12} />;
      case 'critical': return <AlertTriangle size={12} />;
      case 'offline': return <Zap size={12} />;
      default: return null;
    }
  };

  // Peak demand values
  const eveningPeak = data.actualEveningPeak?.onBars || 0;
  const eveningSuppressed = data.actualEveningPeak?.suppressed || 0;
  const dayPeak = data.actualDayPeak?.onBars || 0;
  const daySuppressed = data.actualDayPeak?.suppressed || 0;

  // System load calculation
  const systemLoad = eveningPeak;
  const loadPercent = summary.totalDBIS > 0 ? (systemLoad / summary.totalDBIS) * 100 : 0;
  const actualReserve = summary.totalDBIS - systemLoad;

  // Peak demand trend data for chart
  const peakTrendData = data.peakDemandHistory?.map(d => ({
    date: d.date.split('-')[0],
    evening: d.eveningOnBars,
    eveningSuppressed: d.eveningSuppressed,
    day: d.dayOnBars,
  })) || [];

  // Count of stations with issues
  const stationsWithIssues = summary.critical.length + summary.degraded.length + summary.offline.length;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Data Source */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-4">
        <p className="text-[#64748b] text-xs">
          Source: {data.source || 'DBIS Availability Report'}
        </p>
        <div className="flex items-center gap-3 sm:gap-4 text-xs text-[#64748b]">
          <span>Capacity: {data.capacityDate || '-'}</span>
          <span>Peak: {data.peakDemandDate || '-'}</span>
        </div>
      </div>

      {/* STATIONS BELOW CAPACITY ALERT - Prominent Position */}
      {stationsWithIssues > 0 && (
        <div className="bg-gradient-to-r from-amber-500/[0.15] to-orange-500/[0.1] border-2 border-amber-500/50 rounded-xl p-4 sm:p-5 shadow-lg shadow-amber-500/10">
          {/* Header with count badge */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="p-2 bg-amber-500/20 rounded-lg">
                <AlertTriangle className="text-amber-400" size={20} />
              </div>
              <div>
                <h3 className="text-amber-300 font-semibold text-base sm:text-lg">Stations Below Capacity</h3>
                <p className="text-amber-400/60 text-xs">Requires attention</p>
              </div>
            </div>
            <div className="bg-amber-500/30 text-amber-300 font-bold text-lg sm:text-xl px-3 sm:px-4 py-1.5 sm:py-2 rounded-full">
              {stationsWithIssues}
            </div>
          </div>

          {/* Station List - Scannable format */}
          <div className="space-y-3">
            {/* Critical Stations */}
            {summary.critical.length > 0 && (
              <div className="bg-orange-500/10 rounded-lg p-3 border border-orange-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
                  <span className="text-orange-400 font-semibold text-sm">Critical (&lt;50% capacity)</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {summary.critical.map(station => (
                    <div key={station.name} className="inline-flex items-center gap-2 bg-orange-500/20 px-3 py-1.5 rounded-lg border border-orange-500/40">
                      <Factory size={12} className="text-orange-400 flex-shrink-0" />
                      <span className="text-orange-300 font-medium text-sm">{station.name}</span>
                      <span className="text-orange-400/80 text-xs font-bold">{station.availability.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Degraded Stations */}
            {summary.degraded.length > 0 && (
              <div className="bg-amber-500/10 rounded-lg p-3 border border-amber-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-amber-400 font-semibold text-sm">Degraded (50-70% capacity)</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {summary.degraded.map(station => (
                    <div key={station.name} className="inline-flex items-center gap-2 bg-amber-500/20 px-3 py-1.5 rounded-lg border border-amber-500/40">
                      <Factory size={12} className="text-amber-400 flex-shrink-0" />
                      <span className="text-amber-300 font-medium text-sm">{station.name}</span>
                      <span className="text-amber-400/80 text-xs font-bold">{station.availability.toFixed(0)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Offline Stations */}
            {summary.offline.length > 0 && (
              <div className="bg-red-500/10 rounded-lg p-3 border border-red-500/30">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-red-400 font-semibold text-sm">Offline (0% capacity)</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {summary.offline.map(station => (
                    <div key={station.name} className="inline-flex items-center gap-2 bg-red-500/20 px-3 py-1.5 rounded-lg border border-red-500/40">
                      <Zap size={12} className="text-red-400 flex-shrink-0" />
                      <span className="text-red-300 font-medium text-sm">{station.name}</span>
                      <span className="text-red-400/80 text-xs font-bold">OFFLINE</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Impact summary */}
          <div className="mt-3 pt-3 border-t border-amber-500/30">
            <p className="text-amber-400/70 text-xs sm:text-sm">
              <span className="font-medium text-amber-300">{summary.totalOffline.toFixed(1)} MW</span> unavailable from derated capacity
            </p>
          </div>
        </div>
      )}

      {/* Key Metrics - 4 Column Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {/* Total DBIS Capacity - Highlighted with Gold */}
        <div className="bg-[#d4af37]/[0.08] rounded-xl p-3 sm:p-4 border border-[#d4af37]/30">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
            <Battery className="text-[#d4af37] flex-shrink-0" size={14} />
            <p className="text-[#d4af37]/80 text-[10px] sm:text-xs font-medium truncate">Total DBIS</p>
          </div>
          <p className="text-2xl sm:text-3xl font-bold text-[#d4af37]">{summary.totalDBIS}</p>
          <p className="text-[#d4af37]/60 text-xs sm:text-sm">MW Capacity</p>
        </div>

        {/* Total Fossil Fuel */}
        <div className="bg-[#1a2438] rounded-xl p-3 sm:p-4 border border-[#243049]">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
            <Factory className="text-teal-400 flex-shrink-0" size={14} />
            <p className="text-[#94a3b8] text-[10px] sm:text-xs truncate">Fossil Fuel</p>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-teal-400">{summary.totalAvailable}</p>
          <p className="text-[#64748b] text-xs sm:text-sm">MW Available</p>
        </div>

        {/* Total Renewable (Solar) */}
        <div className="bg-[#1a2438] rounded-xl p-3 sm:p-4 border border-[#243049]">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
            <Sun className="text-green-400 flex-shrink-0" size={14} />
            <p className="text-[#94a3b8] text-[10px] sm:text-xs truncate">Renewable</p>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-green-400">{summary.totalSolar}</p>
          <p className="text-[#64748b] text-xs sm:text-sm">MWp Solar</p>
        </div>

        {/* Availability */}
        <div className="bg-[#1a2438] rounded-xl p-3 sm:p-4 border border-[#243049]">
          <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
            <Zap className="text-[#94a3b8] flex-shrink-0" size={14} />
            <p className="text-[#94a3b8] text-[10px] sm:text-xs truncate">Fleet Avail.</p>
          </div>
          <p className={`text-xl sm:text-2xl font-bold ${summary.availability >= 70 ? 'text-emerald-400' : summary.availability >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
            {summary.availability}%
          </p>
          <div className="mt-1.5 sm:mt-2 h-1 sm:h-1.5 bg-[#243049] rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${summary.availability >= 70 ? 'bg-emerald-500' : summary.availability >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${summary.availability}%` }} />
          </div>
        </div>
      </div>

      {/* System Load Bar */}
      <div className="bg-[#1a2438] rounded-xl p-4 sm:p-5 border border-[#243049]">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 sm:gap-0 mb-3">
          <h4 className="text-[#f1f5f9] font-medium flex items-center gap-2 text-sm sm:text-base">
            <TrendingDown size={16} className="text-blue-400 flex-shrink-0" />
            System Load
          </h4>
          <span className={`text-xs sm:text-sm font-semibold px-2.5 sm:px-3 py-1 rounded-full w-fit ${actualReserve >= 30 ? 'bg-emerald-500/[0.15] text-emerald-400' : actualReserve >= 0 ? 'bg-amber-500/[0.15] text-amber-400' : 'bg-red-500/[0.15] text-red-400'}`}>
            Reserve: {actualReserve > 0 ? '+' : ''}{actualReserve.toFixed(1)} MW
          </span>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <div className="flex-1 h-6 sm:h-8 bg-[#243049] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${loadPercent >= 90 ? 'bg-gradient-to-r from-red-600 to-red-500' : loadPercent >= 75 ? 'bg-gradient-to-r from-amber-600 to-amber-500' : 'bg-gradient-to-r from-emerald-600 to-emerald-500'}`}
              style={{ width: `${Math.min(loadPercent, 100)}%` }}
            />
          </div>
          <div className="text-right sm:min-w-[140px]">
            <span className="text-[#d4af37] font-bold text-base sm:text-lg">{systemLoad}</span>
            <span className="text-[#64748b]"> / </span>
            <span className="text-[#f1f5f9] text-sm sm:text-base">{summary.totalDBIS} MW</span>
          </div>
        </div>
        <p className="text-[#64748b] text-[10px] sm:text-xs mt-2 text-right">{loadPercent.toFixed(1)}% utilization (Evening Peak)</p>
      </div>

      {/* Peak Demand Section */}
      <div className="bg-[#1a2438] rounded-xl p-4 sm:p-5 border border-[#243049]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0 mb-4">
          <h4 className="text-[#f1f5f9] font-medium text-sm sm:text-base">Actual Peak Demand (On Bars)</h4>
          <span className="text-[#64748b] text-[10px] sm:text-xs flex items-center gap-1">
            <Clock size={10} className="sm:w-3 sm:h-3" /> {data.peakDemandDate || '-'}
          </span>
        </div>

        {/* Peak Demand Cards - Fixed Mobile Layout */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-4">
          {/* Evening Peak */}
          <div className="bg-purple-500/[0.08] border border-purple-500/30 rounded-lg p-3 sm:p-4">
            <p className="text-purple-400/80 text-xs sm:text-sm mb-2">Evening Peak</p>
            <div className="space-y-1">
              <div>
                <p className="text-2xl sm:text-3xl font-bold text-purple-300 leading-tight">{eveningPeak || '-'}</p>
                <p className="text-purple-400/60 text-[10px] sm:text-xs">MW (on bars)</p>
              </div>
              <div className="pt-1 border-t border-purple-500/20">
                <p className="text-base sm:text-lg font-medium text-purple-300/50 leading-tight">{eveningSuppressed || '-'}</p>
                <p className="text-purple-400/40 text-[10px] sm:text-xs">MW suppressed</p>
              </div>
            </div>
          </div>

          {/* Day Peak */}
          <div className="bg-cyan-500/[0.08] border border-cyan-500/30 rounded-lg p-3 sm:p-4">
            <p className="text-cyan-400/80 text-xs sm:text-sm mb-2">Day Peak</p>
            <div className="space-y-1">
              <div>
                <p className="text-2xl sm:text-3xl font-bold text-cyan-300 leading-tight">{dayPeak || '-'}</p>
                <p className="text-cyan-400/60 text-[10px] sm:text-xs">MW (on bars)</p>
              </div>
              <div className="pt-1 border-t border-cyan-500/20">
                <p className="text-base sm:text-lg font-medium text-cyan-300/50 leading-tight">{daySuppressed || '-'}</p>
                <p className="text-cyan-400/40 text-[10px] sm:text-xs">MW suppressed</p>
              </div>
            </div>
          </div>
        </div>

        {/* Generation Availability & Suppressed Peak */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 mb-4">
          <div className="bg-[#0f1729] rounded-lg p-3">
            <p className="text-[#64748b] text-[10px] sm:text-xs leading-tight">Generation Availability at Suppressed Peak</p>
            <p className="text-[#94a3b8] text-sm sm:text-lg font-medium mt-1">
              {data.generationAvailAtSuppressed || 'Not reported'}
            </p>
          </div>
          <div className="bg-[#0f1729] rounded-lg p-3">
            <p className="text-[#64748b] text-[10px] sm:text-xs leading-tight">Approximate Suppressed Peak</p>
            <p className="text-[#94a3b8] text-sm sm:text-lg font-medium mt-1">
              {data.approximateSuppressedPeak || 'Not reported'}
            </p>
          </div>
        </div>

        {/* Peak Demand Trend Chart */}
        {peakTrendData.length > 0 && (
          <div className="h-32 sm:h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={peakTrendData} margin={{ top: 5, right: 5, left: -15, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#243049" />
                <XAxis dataKey="date" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} domain={[150, 230]} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1a2438', border: '1px solid #243049', borderRadius: '8px', fontSize: '12px' }}
                  formatter={(value, name) => [
                    `${value} MW`,
                    name === 'evening' ? 'Evening (On Bars)' :
                    name === 'eveningSuppressed' ? 'Evening (Suppressed)' : 'Day (On Bars)'
                  ]}
                />
                <Line type="monotone" dataKey="evening" stroke="#a855f7" strokeWidth={2} dot={{ r: 2 }} />
                <Line type="monotone" dataKey="eveningSuppressed" stroke="#a855f7" strokeWidth={1} strokeDasharray="5 5" dot={false} />
                <Line type="monotone" dataKey="day" stroke="#22d3ee" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Solar Sites Breakdown */}
      <div className="bg-[#d4af37]/[0.05] rounded-xl p-3 sm:p-4 border border-[#d4af37]/20">
        <div className="flex items-center gap-2 mb-3">
          <Sun className="text-[#d4af37] flex-shrink-0" size={16} />
          <h4 className="text-[#d4af37] font-medium text-sm sm:text-base">Solar Generation Sites</h4>
        </div>
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          {data.solarStations?.map((site) => (
            <div key={site.name} className="bg-[#0f1729] rounded-lg p-2 sm:p-3 text-center border border-[#d4af37]/20">
              <p className="text-[#d4af37] text-xl sm:text-2xl font-bold">{site.capacity}</p>
              <p className="text-[#d4af37]/60 text-[10px] sm:text-sm">MWp</p>
              <p className="text-[#f1f5f9] text-[10px] sm:text-xs mt-0.5 sm:mt-1 truncate">{site.name}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Generation Capacity Chart */}
      <div className="bg-[#1a2438] rounded-xl p-4 sm:p-5 border border-[#243049]">
        <h4 className="text-[#f1f5f9] font-medium mb-4 text-sm sm:text-base">Generation Capacity by Station</h4>
        <div className="h-64 sm:h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={summary.stations} layout="vertical" margin={{ left: 0, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243049" horizontal={false} />
              <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 10 }} domain={[0, 80]} />
              <YAxis type="category" dataKey="name" stroke="#94a3b8" tick={{ fontSize: 10 }} width={65} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a2438', border: '1px solid #243049', borderRadius: '8px', fontSize: '12px' }}
                formatter={(value, name, props) => {
                  const station = props.payload;
                  if (name === 'derated') return [`${value} MW`, 'Derated'];
                  return [`${value} MW (${station.availability.toFixed(0)}%)`, 'Available'];
                }}
              />
              <Bar dataKey="derated" fill="#243049" radius={[0, 4, 4, 0]} name="Derated" />
              <Bar dataKey="available" radius={[0, 4, 4, 0]} name="Available">
                {summary.stations.map((station, index) => (
                  <Cell key={`cell-${index}`} fill={getBarColor(station.status)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* Legend - Mobile optimized */}
        <div className="grid grid-cols-2 sm:flex sm:justify-center gap-2 sm:gap-6 mt-4">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded bg-[#243049]" />
            <span className="text-[#94a3b8] text-[10px] sm:text-sm">Derated</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded bg-emerald-500" />
            <span className="text-[#94a3b8] text-[10px] sm:text-sm">Operational</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded bg-amber-500" />
            <span className="text-[#94a3b8] text-[10px] sm:text-sm">Degraded</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded bg-orange-500" />
            <span className="text-[#94a3b8] text-[10px] sm:text-sm">Critical</span>
          </div>
        </div>
      </div>

      {/* Station Details Table */}
      <details className="bg-[#1a2438] rounded-xl border border-[#243049] group">
        <summary className="p-4 sm:p-5 cursor-pointer text-[#f1f5f9] font-medium hover:bg-[#243049]/50 rounded-xl transition-colors list-none flex items-center justify-between text-sm sm:text-base">
          <span>Station Details</span>
          <span className="text-[#64748b] text-xs sm:text-sm group-open:hidden">Click to expand</span>
        </summary>
        <div className="px-3 sm:px-5 pb-4 sm:pb-5">
          <div className="overflow-x-auto -mx-3 sm:mx-0">
            <table className="w-full text-xs sm:text-sm min-w-[500px]">
              <thead>
                <tr className="border-b border-[#243049]">
                  <th className="text-left py-2 px-2 sm:px-3 text-[#94a3b8]">Station</th>
                  <th className="text-center py-2 px-2 sm:px-3 text-[#94a3b8]">Units</th>
                  <th className="text-right py-2 px-2 sm:px-3 text-[#94a3b8]">Derated</th>
                  <th className="text-right py-2 px-2 sm:px-3 text-[#94a3b8]">Available</th>
                  <th className="text-right py-2 px-2 sm:px-3 text-[#94a3b8]">Avail %</th>
                  <th className="text-center py-2 px-2 sm:px-3 text-[#94a3b8]">Status</th>
                </tr>
              </thead>
              <tbody>
                {summary.stations.map((station) => (
                  <tr key={station.name} className="border-b border-[#243049]/50">
                    <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-[#f1f5f9] font-medium">
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        {station.name.includes('PS') ? <Ship size={12} className="text-blue-400 flex-shrink-0" /> : <Factory size={12} className="text-[#94a3b8] flex-shrink-0" />}
                        <span className="truncate">{station.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-center text-[#f1f5f9]">{station.units}</td>
                    <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-right text-[#f1f5f9]">{station.derated.toFixed(1)}</td>
                    <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-right text-teal-400">{station.available.toFixed(1)}</td>
                    <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-right">
                      <span className={`font-medium ${
                        station.status === 'operational' ? 'text-emerald-400' :
                        station.status === 'degraded' ? 'text-amber-400' :
                        station.status === 'critical' ? 'text-orange-400' : 'text-red-400'
                      }`}>
                        {station.availability.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-medium ${
                        station.status === 'operational' ? 'bg-emerald-500/[0.15] text-emerald-400' :
                        station.status === 'degraded' ? 'bg-amber-500/[0.15] text-amber-400' :
                        station.status === 'critical' ? 'bg-orange-500/[0.15] text-orange-400' :
                        'bg-red-500/[0.15] text-red-400'
                      }`}>
                        {getStatusIcon(station.status)}
                        <span className="hidden sm:inline">{station.status.charAt(0).toUpperCase() + station.status.slice(1)}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#243049] bg-[#0f1729]">
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-[#f1f5f9] font-bold">Total Fossil</td>
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-center text-[#f1f5f9] font-bold">{summary.totalUnits}</td>
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-right text-[#f1f5f9] font-bold">{summary.totalDerated}</td>
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-right text-teal-400 font-bold">{summary.totalAvailable}</td>
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-right text-[#f1f5f9] font-bold">{summary.availability}%</td>
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3"></td>
                </tr>
                <tr className="bg-[#d4af37]/[0.08]">
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-[#d4af37] font-bold">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <Sun size={12} className="flex-shrink-0" /> Renewable
                    </div>
                  </td>
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-center text-[#d4af37]">3</td>
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3"></td>
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-right text-[#d4af37] font-bold">{summary.totalSolar}</td>
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3" colSpan={2}></td>
                </tr>
                <tr className="bg-blue-500/[0.08]">
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-blue-300 font-bold">Total DBIS</td>
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3" colSpan={2}></td>
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3 text-right text-[#d4af37] font-bold">{summary.totalDBIS}</td>
                  <td className="py-2.5 sm:py-3 px-2 sm:px-3" colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </details>

      {/* AI Executive Briefing */}
      {data.aiAnalysis && data.aiAnalysis.analysis_status === 'completed' && data.aiAnalysis.executive_briefing && !data.aiAnalysis.executive_briefing.includes('failed') && (
        <details className="bg-purple-500/[0.08] border border-purple-500/30 rounded-xl overflow-hidden" open>
          <summary className="px-3 sm:px-4 py-3 cursor-pointer hover:bg-purple-500/[0.05] transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-purple-300 font-semibold text-sm sm:text-base flex items-center gap-2">
                <Battery size={16} className="text-purple-400" />
                AI Executive Briefing
              </span>
              <span className="text-purple-400/60 text-xs">Click to expand</span>
            </div>
          </summary>
          <div className="px-3 sm:px-4 pb-4 space-y-4">
            {/* Executive Summary */}
            <div className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">
              {data.aiAnalysis.executive_briefing}
            </div>

            {/* Critical Alerts */}
            {data.aiAnalysis.critical_alerts && data.aiAnalysis.critical_alerts.length > 0 && (
              <div>
                <h4 className="text-red-400 text-xs font-semibold mb-2 uppercase tracking-wider">Critical Alerts</h4>
                <div className="space-y-2">
                  {data.aiAnalysis.critical_alerts.map((alert, i) => (
                    <div key={i} className="p-2 bg-red-500/10 border border-red-500/30 rounded-lg">
                      <p className="text-red-300 text-sm font-medium">{alert.title}</p>
                      <p className="text-slate-400 text-xs mt-1">{alert.description}</p>
                      {alert.recommendation && (
                        <p className="text-slate-500 text-xs mt-1 italic">→ {alert.recommendation}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Station Concerns */}
            {data.aiAnalysis.station_concerns && data.aiAnalysis.station_concerns.length > 0 && (
              <div>
                <h4 className="text-amber-400 text-xs font-semibold mb-2 uppercase tracking-wider">Station Concerns</h4>
                <div className="space-y-2">
                  {data.aiAnalysis.station_concerns.map((concern, i) => (
                    <div key={i} className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                      <p className="text-amber-300 text-sm font-medium">{concern.station}</p>
                      <p className="text-slate-400 text-xs mt-1">{concern.issue}</p>
                      {concern.impact && (
                        <p className="text-slate-500 text-xs mt-1">Impact: {concern.impact}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {data.aiAnalysis.recommendations && data.aiAnalysis.recommendations.length > 0 && (
              <div>
                <h4 className="text-blue-400 text-xs font-semibold mb-2 uppercase tracking-wider">Recommendations</h4>
                <ul className="space-y-1">
                  {data.aiAnalysis.recommendations.map((rec, i) => (
                    <li key={i} className="text-slate-400 text-xs flex items-start gap-2">
                      <span className="text-blue-400 mt-0.5">•</span>
                      <span>{rec.recommendation}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}

      {/* Status Summary - Mobile optimized 2x2 grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        <div className="bg-emerald-500/[0.08] border border-emerald-500/30 rounded-xl p-3 sm:p-4 text-center">
          <p className="text-emerald-400 text-xl sm:text-2xl font-bold">{summary.operational.length}</p>
          <p className="text-emerald-400/70 text-xs sm:text-sm">Operational</p>
        </div>
        <div className="bg-amber-500/[0.08] border border-amber-500/30 rounded-xl p-3 sm:p-4 text-center">
          <p className="text-amber-400 text-xl sm:text-2xl font-bold">{summary.degraded.length}</p>
          <p className="text-amber-400/70 text-xs sm:text-sm">Degraded</p>
        </div>
        <div className="bg-orange-500/[0.08] border border-orange-500/30 rounded-xl p-3 sm:p-4 text-center">
          <p className="text-orange-400 text-xl sm:text-2xl font-bold">{summary.critical.length}</p>
          <p className="text-orange-400/70 text-xs sm:text-sm">Critical</p>
        </div>
        <div className="bg-red-500/[0.08] border border-red-500/30 rounded-xl p-3 sm:p-4 text-center">
          <p className="text-red-400 text-xl sm:text-2xl font-bold">{summary.offline.length}</p>
          <p className="text-red-400/70 text-xs sm:text-sm">Offline</p>
        </div>
      </div>
    </div>
  );
};

export default GPLDetail;
