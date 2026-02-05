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
        <div style={{ height: Math.max(400, summary.stations.length * 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={summary.stations}
              layout="vertical"
              margin={{ left: 10, right: 20, top: 10, bottom: 10 }}
              barGap={2}
              barCategoryGap="20%"
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#243049" horizontal={false} />
              <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 11 }} domain={[0, 80]} />
              <YAxis
                type="category"
                dataKey="name"
                stroke="#94a3b8"
                tick={{ fontSize: 11 }}
                width={85}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1a2438', border: '1px solid #243049', borderRadius: '8px', fontSize: '12px' }}
                formatter={(value, name, props) => {
                  const station = props.payload;
                  if (name === 'derated') return [`${value} MW`, 'Derated'];
                  return [`${value} MW (${station.availability.toFixed(0)}%)`, 'Available'];
                }}
              />
              <Bar dataKey="derated" fill="#243049" radius={[0, 4, 4, 0]} name="Derated" barSize={14} />
              <Bar dataKey="available" radius={[0, 4, 4, 0]} name="Available" barSize={14}>
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
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h3 className="text-white font-semibold">AI Intelligence Briefing</h3>
              <p className="text-slate-500 text-xs">Powered by Claude • Analysis complete</p>
            </div>
          </div>

          {/* Executive Summary Card */}
          <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-slate-700/50 rounded-xl p-4">
            <div className="prose prose-sm prose-invert max-w-none">
              <p className="text-slate-300 text-sm leading-relaxed">
                {data.aiAnalysis.executive_briefing}
              </p>
            </div>
          </div>

          {/* Alerts & Concerns Grid */}
          {((data.aiAnalysis.critical_alerts && data.aiAnalysis.critical_alerts.length > 0) ||
            (data.aiAnalysis.station_concerns && data.aiAnalysis.station_concerns.length > 0)) && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Critical Alerts */}
              {data.aiAnalysis.critical_alerts && data.aiAnalysis.critical_alerts.length > 0 && (
                <div className="bg-red-500/[0.05] border border-red-500/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-full bg-red-500/20 flex items-center justify-center">
                      <AlertTriangle size={12} className="text-red-400" />
                    </div>
                    <h4 className="text-red-400 text-sm font-semibold">Critical Alerts</h4>
                    <span className="ml-auto text-red-400/60 text-xs bg-red-500/10 px-2 py-0.5 rounded-full">
                      {data.aiAnalysis.critical_alerts.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {data.aiAnalysis.critical_alerts.map((alert, i) => (
                      <div key={i} className="bg-red-500/[0.08] rounded-lg p-3">
                        <p className="text-red-300 text-sm font-medium">{alert.title}</p>
                        <p className="text-slate-400 text-xs mt-1 leading-relaxed">{alert.description}</p>
                        {alert.recommendation && (
                          <p className="text-red-400/70 text-xs mt-2 flex items-start gap-1.5">
                            <span className="text-red-400">→</span>
                            {alert.recommendation}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Station Concerns */}
              {data.aiAnalysis.station_concerns && data.aiAnalysis.station_concerns.length > 0 && (
                <div className="bg-amber-500/[0.05] border border-amber-500/20 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center">
                      <Factory size={12} className="text-amber-400" />
                    </div>
                    <h4 className="text-amber-400 text-sm font-semibold">Station Concerns</h4>
                    <span className="ml-auto text-amber-400/60 text-xs bg-amber-500/10 px-2 py-0.5 rounded-full">
                      {data.aiAnalysis.station_concerns.length}
                    </span>
                  </div>
                  <div className="space-y-2">
                    {data.aiAnalysis.station_concerns.map((concern, i) => (
                      <div key={i} className="bg-amber-500/[0.08] rounded-lg p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-amber-300 text-sm font-medium">{concern.station}</span>
                          {concern.priority && (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              concern.priority === 'HIGH' ? 'bg-red-500/20 text-red-400' :
                              concern.priority === 'MEDIUM' ? 'bg-amber-500/20 text-amber-400' :
                              'bg-slate-500/20 text-slate-400'
                            }`}>
                              {concern.priority}
                            </span>
                          )}
                        </div>
                        <p className="text-slate-400 text-xs mt-1 leading-relaxed">{concern.issue}</p>
                        {concern.impact && (
                          <p className="text-slate-500 text-xs mt-1">
                            <span className="text-amber-400/70">Impact:</span> {concern.impact}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Recommendations */}
          {data.aiAnalysis.recommendations && data.aiAnalysis.recommendations.length > 0 && (
            <div className="bg-blue-500/[0.05] border border-blue-500/20 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                  <TrendingDown size={12} className="text-blue-400 rotate-180" />
                </div>
                <h4 className="text-blue-400 text-sm font-semibold">Recommendations</h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {data.aiAnalysis.recommendations.map((rec, i) => (
                  <div key={i} className="bg-blue-500/[0.08] rounded-lg p-3 flex items-start gap-2">
                    <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${
                      rec.urgency === 'Immediate' ? 'bg-red-500/30 text-red-300' :
                      rec.urgency === 'Short-term' ? 'bg-amber-500/30 text-amber-300' :
                      'bg-blue-500/30 text-blue-300'
                    }`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-300 text-xs leading-relaxed">{rec.recommendation}</p>
                      {rec.category && (
                        <span className="inline-block mt-1.5 text-xs text-blue-400/60 bg-blue-500/10 px-2 py-0.5 rounded">
                          {rec.category}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
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
