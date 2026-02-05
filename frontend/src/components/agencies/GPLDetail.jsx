import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend,
  ReferenceLine, ComposedChart, PieChart, Pie, LabelList
} from 'recharts';
import {
  AlertTriangle, Zap, CheckCircle, Sun, Ship, Factory, TrendingDown,
  TrendingUp, Clock, Battery, ChevronDown, ChevronRight, Users,
  DollarSign, Upload, RefreshCw, Activity, Minus
} from 'lucide-react';
import GPLKpiUpload from '../GPLKpiUpload';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

const GPLDetail = ({ data }) => {
  // Tab state
  const [activeTab, setActiveTab] = useState('overview');

  // Station filter state (for Station Health tab)
  const [stationFilter, setStationFilter] = useState('all');

  // Collapsible AI briefing state
  const [briefingExpanded, setBriefingExpanded] = useState(false);

  // Alert expansion state
  const [expandedAlerts, setExpandedAlerts] = useState({});

  // KPI data state
  const [kpiData, setKpiData] = useState({ latest: null, trends: [], analysis: null });
  const [kpiLoading, setKpiLoading] = useState(true);
  const [showKpiUpload, setShowKpiUpload] = useState(false);

  // Forecast data state
  const [forecastData, setForecastData] = useState(null);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [refreshingForecast, setRefreshingForecast] = useState(false);

  // Fetch KPI data
  useEffect(() => {
    async function fetchKpiData() {
      setKpiLoading(true);
      try {
        const [latestRes, trendsRes, analysisRes] = await Promise.all([
          fetch(`${API_BASE}/gpl/kpi/latest`),
          fetch(`${API_BASE}/gpl/kpi/trends?months=12`),
          fetch(`${API_BASE}/gpl/kpi/analysis`)
        ]);
        const [latestData, trendsData, analysisData] = await Promise.all([
          latestRes.json(), trendsRes.json(), analysisRes.json()
        ]);
        setKpiData({
          latest: latestData.success && latestData.hasData ? latestData : null,
          trends: trendsData.success ? trendsData.trends : [],
          analysis: analysisData.success && analysisData.hasAnalysis ? analysisData.analysis : null
        });
      } catch (err) {
        console.error('Failed to fetch KPI data:', err);
      } finally {
        setKpiLoading(false);
      }
    }
    fetchKpiData();
  }, []);

  // Fetch forecast data
  useEffect(() => {
    async function fetchForecastData() {
      setForecastLoading(true);
      try {
        const response = await fetch(`${API_BASE}/gpl/forecast/all`);
        const result = await response.json();
        if (result.success) {
          setForecastData(result.data);
        }
      } catch (err) {
        console.error('Failed to fetch forecast data:', err);
      } finally {
        setForecastLoading(false);
      }
    }
    fetchForecastData();
  }, []);

  // Refresh forecasts
  const handleRefreshForecast = async () => {
    setRefreshingForecast(true);
    try {
      const response = await fetch(`${API_BASE}/gpl/forecast/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ includeAI: true })
      });
      const result = await response.json();
      if (result.success) {
        const refreshed = await fetch(`${API_BASE}/gpl/forecast/all`);
        const refreshedData = await refreshed.json();
        if (refreshedData.success) {
          setForecastData(refreshedData.data);
        }
      }
    } catch (err) {
      console.error('Failed to refresh forecasts:', err);
    } finally {
      setRefreshingForecast(false);
    }
  };

  // Compute station metrics from raw data
  const summary = useMemo(() => {
    if (!data?.powerStations) return null;

    const stations = data.powerStations;
    const totalDerated = stations.reduce((sum, s) => sum + s.derated, 0);
    const totalAvailable = stations.reduce((sum, s) => sum + s.available, 0);
    const totalUnits = stations.reduce((sum, s) => sum + s.units, 0);

    const enrichedStations = stations.map(s => ({
      ...s,
      availability: s.derated > 0 ? (s.available / s.derated) * 100 : 0,
      status: s.available === 0 ? 'offline'
            : s.available / s.derated < 0.5 ? 'critical'
            : s.available / s.derated < 0.7 ? 'degraded'
            : 'operational',
    }));

    const totalSolar = data.solarStations?.reduce((sum, s) => sum + s.capacity, 0) || data.totalRenewableCapacity || 0;
    const totalDBIS = totalAvailable + totalSolar;

    return {
      totalDerated: Math.round(totalDerated * 10) / 10,
      totalAvailable: Math.round(totalAvailable * 10) / 10,
      totalOffline: Math.round((totalDerated - totalAvailable) * 10) / 10,
      availability: Math.round((totalAvailable / totalDerated) * 1000) / 10,
      totalUnits,
      totalSolar,
      totalDBIS: Math.round(totalDBIS * 10) / 10,
      stations: enrichedStations,
      operational: enrichedStations.filter(s => s.status === 'operational'),
      degraded: enrichedStations.filter(s => s.status === 'degraded'),
      critical: enrichedStations.filter(s => s.status === 'critical'),
      offline: enrichedStations.filter(s => s.status === 'offline'),
    };
  }, [data]);

  if (!summary) return null;

  // Calculate reserve margin for health indicator
  const eveningPeak = data.actualEveningPeak?.onBars || 0;
  const reserveMargin = summary.totalDBIS > 0 ? ((summary.totalDBIS - eveningPeak) / summary.totalDBIS) * 100 : 0;

  // Compute projections with client-side fallback when server forecasts unavailable
  const computedProjections = useMemo(() => {
    // Check if server-side DBIS forecasts exist
    const serverDbisForecasts = forecastData?.demand?.filter(d => d.grid === 'DBIS') || [];
    const serverEsqForecasts = forecastData?.demand?.filter(d => d.grid === 'Essequibo') || [];

    // Current values
    const currentDbis = eveningPeak || 0;
    const currentEsq = kpiData.latest?.kpis?.['Peak Demand Essequibo']?.value ||
                       kpiData.trends?.slice(-1)[0]?.['Peak Demand Essequibo'] || 13;

    // Helper: get projected value from server data or compute linear projection
    const getProjection = (serverForecasts, current, monthlyGrowthRate, monthIndex) => {
      if (serverForecasts.length > monthIndex && serverForecasts[monthIndex]?.projected_peak_mw) {
        return parseFloat(serverForecasts[monthIndex].projected_peak_mw);
      }
      // Fallback: linear projection
      const months = monthIndex + 1; // monthIndex 5 = 6 months out
      return current + (monthlyGrowthRate * months);
    };

    // Calculate growth rates from KPI trends if available
    let dbisGrowthRate = 2.0; // Default ~2 MW/month for DBIS
    let esqGrowthRate = 0.16; // Default ~0.16 MW/month for Essequibo

    if (kpiData.trends?.length >= 3) {
      // DBIS growth rate from trends
      const dbisValues = kpiData.trends
        .map(t => t['Peak Demand DBIS'])
        .filter(v => v != null && v > 0);
      if (dbisValues.length >= 2) {
        const firstDbis = dbisValues[0];
        const lastDbis = dbisValues[dbisValues.length - 1];
        dbisGrowthRate = (lastDbis - firstDbis) / dbisValues.length;
        if (dbisGrowthRate <= 0) dbisGrowthRate = 2.0; // Ensure positive growth
      }

      // Essequibo growth rate from trends
      const esqValues = kpiData.trends
        .map(t => t['Peak Demand Essequibo'])
        .filter(v => v != null && v > 0);
      if (esqValues.length >= 2) {
        const firstEsq = esqValues[0];
        const lastEsq = esqValues[esqValues.length - 1];
        esqGrowthRate = (lastEsq - firstEsq) / esqValues.length;
        if (esqGrowthRate <= 0) esqGrowthRate = 0.16; // Ensure positive growth
      }
    }

    // Compute projections for each timeframe
    const dbis6mo = getProjection(serverDbisForecasts, currentDbis, dbisGrowthRate, 5);
    const dbis12mo = getProjection(serverDbisForecasts, currentDbis, dbisGrowthRate, 11);
    const dbis24mo = getProjection(serverDbisForecasts, currentDbis, dbisGrowthRate, 23);

    const esq6mo = getProjection(serverEsqForecasts, currentEsq, esqGrowthRate, 5);
    const esq12mo = getProjection(serverEsqForecasts, currentEsq, esqGrowthRate, 11);
    const esq24mo = getProjection(serverEsqForecasts, currentEsq, esqGrowthRate, 23);

    // Determine if using fallback
    const usingFallback = serverDbisForecasts.length === 0;

    return {
      currentDbis,
      currentEsq,
      dbis: {
        '6mo': dbis6mo,
        '12mo': dbis12mo,
        '24mo': dbis24mo,
        growthRate: dbisGrowthRate
      },
      esq: {
        '6mo': esq6mo,
        '12mo': esq12mo,
        '24mo': esq24mo,
        growthRate: esqGrowthRate
      },
      usingFallback,
      // Chart data array
      chartData: [
        { period: 'Current', dbis: currentDbis, esq: currentEsq },
        { period: '6 months', dbis: dbis6mo, esq: esq6mo },
        { period: '12 months', dbis: dbis12mo, esq: esq12mo },
        { period: '24 months', dbis: dbis24mo, esq: esq24mo }
      ],
      // Capacity data from server
      capacity: forecastData?.capacity || [],
      loadShedding: forecastData?.loadShedding || null
    };
  }, [forecastData, eveningPeak, kpiData]);
  const healthStatus = reserveMargin < 10 ? 'critical' : reserveMargin < 15 ? 'warning' : 'good';

  // Consolidate alerts from AI analysis
  const consolidatedAlerts = useMemo(() => {
    const alerts = [];

    // Add critical alerts
    if (data.aiAnalysis?.critical_alerts) {
      data.aiAnalysis.critical_alerts.forEach((alert, i) => {
        alerts.push({
          id: `critical-${i}`,
          severity: 'critical',
          title: alert.title,
          station: null,
          detail: alert.description,
          recommendation: alert.recommendation
        });
      });
    }

    // Add station concerns
    if (data.aiAnalysis?.station_concerns) {
      data.aiAnalysis.station_concerns.forEach((concern, i) => {
        alerts.push({
          id: `station-${i}`,
          severity: concern.priority === 'HIGH' ? 'high' : concern.priority === 'MEDIUM' ? 'medium' : 'low',
          title: concern.issue,
          station: concern.station,
          detail: concern.impact || '',
          recommendation: null
        });
      });
    }

    // Add recommendations as actionable alerts
    if (data.aiAnalysis?.recommendations) {
      data.aiAnalysis.recommendations.forEach((rec, i) => {
        if (rec.urgency === 'Immediate') {
          alerts.push({
            id: `rec-${i}`,
            severity: 'medium',
            title: rec.recommendation?.slice(0, 60) + (rec.recommendation?.length > 60 ? '...' : ''),
            station: null,
            detail: rec.recommendation,
            recommendation: null,
            category: rec.category
          });
        }
      });
    }

    return alerts.sort((a, b) => {
      const order = { critical: 0, high: 1, medium: 2, low: 3 };
      return (order[a.severity] || 4) - (order[b.severity] || 4);
    });
  }, [data.aiAnalysis]);

  const criticalCount = consolidatedAlerts.filter(a => a.severity === 'critical' || a.severity === 'high').length;

  // Filter stations based on filter state
  const filteredStations = useMemo(() => {
    if (stationFilter === 'all') return summary.stations;
    return summary.stations.filter(s => s.status === stationFilter);
  }, [summary.stations, stationFilter]);

  // Capacity utilization data for donut chart
  const utilizationData = [
    { name: 'Available', value: summary.totalAvailable, fill: '#10b981' },
    { name: 'Degraded', value: summary.degraded.reduce((sum, s) => sum + (s.derated - s.available), 0), fill: '#f59e0b' },
    { name: 'Offline', value: summary.totalOffline, fill: '#ef4444' }
  ].filter(d => d.value > 0);

  // Status colors
  const getStatusColor = (status) => ({
    operational: '#10b981',
    degraded: '#f59e0b',
    critical: '#f97316',
    offline: '#ef4444'
  }[status] || '#64748b');

  const getStatusBg = (status) => ({
    operational: 'bg-emerald-500/[0.15] border-emerald-500/30 text-emerald-400',
    degraded: 'bg-amber-500/[0.15] border-amber-500/30 text-amber-400',
    critical: 'bg-orange-500/[0.15] border-orange-500/30 text-orange-400',
    offline: 'bg-red-500/[0.15] border-red-500/30 text-red-400'
  }[status] || 'bg-slate-500/[0.15] border-slate-500/30 text-slate-400');

  // Tab definitions
  const tabs = [
    { id: 'overview', label: 'System Overview' },
    { id: 'stations', label: 'Station Health' },
    { id: 'trends', label: 'Trends & KPIs' },
    { id: 'forecast', label: 'Forecast' }
  ];

  return (
    <div className="space-y-4">
      {/* PERSISTENT KPI STRIP */}
      <div className="bg-[#1a2438] rounded-xl border border-[#243049] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${
              healthStatus === 'critical' ? 'bg-red-500 animate-pulse' :
              healthStatus === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'
            }`} />
            <span className="text-[#94a3b8] text-sm font-medium">System Health</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-[#64748b]">
            <span>Updated: {data.capacityDate || '-'}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Available Capacity */}
          <div className="flex items-center gap-3 p-4 bg-[#0f1729] rounded-lg border-l-4 border-emerald-500">
            <div>
              <p className="text-[#64748b] text-sm">Available Capacity</p>
              <p className="text-2xl font-bold text-[#f1f5f9]">{summary.totalAvailable}<span className="text-base font-normal text-[#64748b]"> / {summary.totalDerated} MW</span></p>
            </div>
          </div>

          {/* Reserve Margin */}
          <div className={`flex items-center gap-3 p-4 bg-[#0f1729] rounded-lg border-l-4 ${
            reserveMargin < 10 ? 'border-red-500' : reserveMargin < 15 ? 'border-amber-500' : 'border-emerald-500'
          }`}>
            <div>
              <p className="text-[#64748b] text-sm">Reserve Margin</p>
              <p className={`text-2xl font-bold ${
                reserveMargin < 10 ? 'text-red-400' : reserveMargin < 15 ? 'text-amber-400' : 'text-emerald-400'
              }`}>{reserveMargin.toFixed(1)}%</p>
              <p className="text-[#64748b] text-xs">{reserveMargin < 15 ? 'Below 15% safe threshold' : 'Adequate'}</p>
            </div>
          </div>

          {/* Offline Capacity */}
          <div className={`flex items-center gap-3 p-4 bg-[#0f1729] rounded-lg border-l-4 ${
            summary.offline.length > 0 ? 'border-red-500' : 'border-[#243049]'
          }`}>
            <div>
              <p className="text-[#64748b] text-sm">Offline Capacity</p>
              <p className="text-2xl font-bold text-red-400">{summary.totalOffline} MW</p>
              <p className="text-[#64748b] text-xs">{summary.offline.length} stations offline</p>
            </div>
          </div>

          {/* Peak Demand */}
          <div className="flex items-center gap-3 p-4 bg-[#0f1729] rounded-lg border-l-4 border-purple-500">
            <div>
              <p className="text-[#64748b] text-sm">Peak Demand (Evening)</p>
              <p className="text-2xl font-bold text-purple-400">{eveningPeak || '-'} MW</p>
              <p className="text-[#64748b] text-xs">{data.peakDemandDate || '-'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* TAB BAR */}
      <div className="bg-[#1a2438] rounded-xl border border-[#243049] p-1.5 overflow-x-auto scrollbar-hide">
        <div className="flex gap-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-4 py-2.5 rounded-lg text-base font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-[#d4af37] text-[#0f1729] shadow-lg shadow-[#d4af37]/20'
                  : 'text-[#94a3b8] hover:text-[#f1f5f9] hover:bg-[#243049]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB CONTENT */}
      <div className="min-h-[400px]">

        {/* ===================== TAB 1: SYSTEM OVERVIEW ===================== */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Active Alerts */}
            <div className="bg-[#1a2438] rounded-xl border border-[#243049] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#243049] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="text-amber-400" size={18} />
                  <h3 className="text-[#f1f5f9] font-medium text-base">Active Alerts</h3>
                  {criticalCount > 0 && (
                    <span className="bg-red-500/20 text-red-400 text-sm px-2 py-0.5 rounded-full font-medium">
                      {criticalCount} critical
                    </span>
                  )}
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {consolidatedAlerts.length === 0 ? (
                  <div className="p-4 text-center text-[#64748b] text-base">No active alerts</div>
                ) : (
                  consolidatedAlerts.slice(0, 8).map(alert => (
                    <div
                      key={alert.id}
                      className="px-4 py-3 border-b border-[#243049]/50 hover:bg-[#243049]/30 cursor-pointer"
                      onClick={() => setExpandedAlerts(prev => ({ ...prev, [alert.id]: !prev[alert.id] }))}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${
                          alert.severity === 'critical' ? 'bg-red-500' :
                          alert.severity === 'high' ? 'bg-orange-500' :
                          alert.severity === 'medium' ? 'bg-blue-500' : 'bg-slate-500'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[#f1f5f9] text-base font-medium">{alert.title}</span>
                            {alert.station && (
                              <span className="text-sm px-2 py-0.5 rounded bg-[#243049] text-[#94a3b8]">{alert.station}</span>
                            )}
                          </div>
                          {alert.detail && !expandedAlerts[alert.id] && (
                            <p className="text-[#64748b] text-sm mt-1 truncate">{alert.detail}</p>
                          )}
                          {expandedAlerts[alert.id] && (
                            <div className="mt-2 space-y-2">
                              {alert.detail && <p className="text-[#94a3b8] text-sm">{alert.detail}</p>}
                              {alert.recommendation && (
                                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                                  <p className="text-blue-400 text-sm font-medium">Recommended Action:</p>
                                  <p className="text-[#94a3b8] text-sm mt-1">{alert.recommendation}</p>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                        <ChevronRight className={`text-[#64748b] flex-shrink-0 transition-transform ${expandedAlerts[alert.id] ? 'rotate-90' : ''}`} size={16} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Fleet at a Glance */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Station Grid */}
              <div className="lg:col-span-2 bg-[#1a2438] rounded-xl border border-[#243049] p-4">
                <h3 className="text-[#f1f5f9] font-medium text-base mb-4">Fleet at a Glance</h3>
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {summary.stations.map(station => (
                    <div
                      key={station.name}
                      className="bg-[#0f1729] rounded-lg p-3 border border-[#243049] hover:border-[#d4af37]/50 transition-colors group relative"
                      title={`${station.name}: ${station.available}/${station.derated} MW (${station.units} units)`}
                    >
                      <p className="text-[#f1f5f9] text-xs font-medium truncate">{station.name}</p>
                      <p className="text-[#94a3b8] text-xs">{station.available}/{station.derated}</p>
                      <div className="h-2 bg-[#243049] rounded-full mt-1.5 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${station.availability}%`,
                            backgroundColor: getStatusColor(station.status)
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Legend */}
                <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-[#243049]">
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-emerald-500" /><span className="text-[#94a3b8] text-sm">Operational</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-amber-500" /><span className="text-[#94a3b8] text-sm">Degraded</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-orange-500" /><span className="text-[#94a3b8] text-sm">Critical</span></div>
                  <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-red-500" /><span className="text-[#94a3b8] text-sm">Offline</span></div>
                </div>
              </div>

              {/* Utilization Donut */}
              <div className="bg-[#1a2438] rounded-xl border border-[#243049] p-4">
                <h3 className="text-[#f1f5f9] font-medium text-base mb-2">Capacity Utilization</h3>
                <div className="h-48 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={utilizationData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {utilizationData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '14px' }}
                        labelStyle={{ color: '#f1f5f9' }}
                        formatter={(value) => `${value.toFixed(1)} MW`}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-3xl font-bold text-[#f1f5f9]">{summary.availability}%</p>
                      <p className="text-[#64748b] text-sm">Fleet</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5 mt-2">
                  {utilizationData.map(item => (
                    <div key={item.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded" style={{ backgroundColor: item.fill }} />
                        <span className="text-[#94a3b8]">{item.name}</span>
                      </div>
                      <span className="text-[#f1f5f9] font-medium">{item.value.toFixed(1)} MW</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* AI Executive Briefing - Collapsible */}
            {data.aiAnalysis?.executive_briefing && (
              <div className="bg-[#1a2438] rounded-xl border border-[#243049] overflow-hidden">
                <button
                  onClick={() => setBriefingExpanded(!briefingExpanded)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-[#243049]/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                      <Activity className="w-5 h-5 text-white" />
                    </div>
                    <div className="text-left">
                      <h3 className="text-[#f1f5f9] font-medium text-base">AI Executive Briefing</h3>
                      <p className="text-[#64748b] text-sm">Click to {briefingExpanded ? 'collapse' : 'expand'}</p>
                    </div>
                  </div>
                  <ChevronDown className={`text-[#64748b] transition-transform ${briefingExpanded ? 'rotate-180' : ''}`} size={18} />
                </button>

                {briefingExpanded && (
                  <div className="px-4 pb-4 space-y-4">
                    {/* Bottom Line */}
                    <div className="bg-[#0f1729] rounded-lg p-4 border border-[#243049]">
                      <p className="text-purple-400 text-sm font-medium mb-1">Bottom Line</p>
                      <p className="text-[#94a3b8] text-base leading-relaxed">
                        {data.aiAnalysis.executive_briefing.split('\n')[0] || 'System status analysis available.'}
                      </p>
                    </div>

                    {/* Immediate Priorities */}
                    {data.aiAnalysis.recommendations?.length > 0 && (
                      <div className="bg-[#0f1729] rounded-lg p-4 border border-[#243049]">
                        <p className="text-blue-400 text-sm font-medium mb-2">Immediate Priorities</p>
                        <ul className="space-y-2">
                          {data.aiAnalysis.recommendations.slice(0, 3).map((rec, i) => (
                            <li key={i} className="text-[#94a3b8] text-sm flex items-start gap-2">
                              <span className="text-blue-400">{i + 1}.</span>
                              <span>{rec.recommendation}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Grid Note */}
                    {summary.offline.length > 0 && (
                      <div className="bg-amber-500/10 rounded-lg p-4 border border-amber-500/20">
                        <p className="text-amber-400 text-sm font-medium mb-1">Attention Required</p>
                        <p className="text-[#94a3b8] text-sm">
                          {summary.offline.length} stations currently offline: {summary.offline.map(s => s.name).join(', ')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ===================== TAB 2: STATION HEALTH ===================== */}
        {activeTab === 'stations' && (
          <div className="space-y-4">
            {/* Filter Chips */}
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'all', label: 'All', count: summary.stations.length },
                { id: 'operational', label: 'Operational', count: summary.operational.length },
                { id: 'degraded', label: 'Degraded', count: summary.degraded.length },
                { id: 'critical', label: 'Critical', count: summary.critical.length },
                { id: 'offline', label: 'Offline', count: summary.offline.length }
              ].map(filter => (
                <button
                  key={filter.id}
                  onClick={() => setStationFilter(filter.id)}
                  className={`px-4 py-2 rounded-lg text-base font-medium transition-colors flex items-center gap-2 ${
                    stationFilter === filter.id
                      ? 'bg-[#d4af37] text-[#0f1729]'
                      : 'bg-[#1a2438] text-[#94a3b8] hover:text-[#f1f5f9] border border-[#243049]'
                  }`}
                >
                  {filter.label}
                  <span className={`text-sm px-2 py-0.5 rounded-full ${
                    stationFilter === filter.id ? 'bg-[#0f1729]/20' : 'bg-[#243049]'
                  }`}>{filter.count}</span>
                </button>
              ))}
            </div>

            {/* Station Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredStations.map(station => (
                <div key={station.name} className="bg-[#1a2438] rounded-xl border border-[#243049] p-5 hover:border-[#d4af37]/30 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {station.name.includes('PS') ? (
                        <Ship className="text-blue-400" size={20} />
                      ) : (
                        <Factory className="text-[#94a3b8]" size={20} />
                      )}
                      <h4 className="text-[#f1f5f9] font-medium text-base">{station.name}</h4>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium border ${getStatusBg(station.status)}`}>
                      {station.status.charAt(0).toUpperCase() + station.status.slice(1)}
                    </span>
                  </div>

                  <div className="mb-3">
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold text-[#f1f5f9]">{station.available}</span>
                      <span className="text-[#64748b] text-base">/ {station.derated} MW</span>
                    </div>
                  </div>

                  <div className="h-2.5 bg-[#243049] rounded-full overflow-hidden mb-3">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${station.availability}%`,
                        backgroundColor: getStatusColor(station.status)
                      }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-sm text-[#64748b]">
                    <span>{station.units} units</span>
                    <span>{station.availability.toFixed(0)}% available</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===================== TAB 3: TRENDS & KPIs ===================== */}
        {activeTab === 'trends' && (
          <div className="space-y-4">
            {/* Header with Upload Button */}
            <div className="flex items-center justify-between">
              <h3 className="text-[#f1f5f9] font-medium text-lg">Monthly KPI Trends</h3>
              <button
                onClick={() => setShowKpiUpload(true)}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg flex items-center gap-2 text-base"
              >
                <Upload size={16} />
                Upload KPI CSV
              </button>
            </div>

            {showKpiUpload && (
              <GPLKpiUpload
                onSuccess={() => {
                  setShowKpiUpload(false);
                  // Refetch KPI data
                  fetch(`${API_BASE}/gpl/kpi/latest`).then(r => r.json()).then(d => {
                    if (d.success && d.hasData) setKpiData(prev => ({ ...prev, latest: d }));
                  });
                }}
                onCancel={() => setShowKpiUpload(false)}
              />
            )}

            {kpiLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-6 h-6 text-[#64748b] animate-spin" />
              </div>
            ) : (
              <>
                {/* KPI Summary Cards - Reduced to 3 */}
                {kpiData.latest?.kpis && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <KpiSummaryCard
                      name="Peak Demand DBIS"
                      data={kpiData.latest.kpis['Peak Demand DBIS']}
                      icon={Zap}
                      unit="MW"
                    />
                    <KpiSummaryCard
                      name="Affected Customers"
                      data={kpiData.latest.kpis['Affected Customers']}
                      icon={Users}
                      unit=""
                      inverseGood
                    />
                    <KpiSummaryCard
                      name="Collection Rate"
                      data={kpiData.latest.kpis['Collection Rate %']}
                      icon={DollarSign}
                      unit="%"
                      target={95}
                    />
                  </div>
                )}

                {/* Charts */}
                {kpiData.trends.length > 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Peak Demand Trends */}
                    <div className="bg-[#1a2438] rounded-xl border border-[#243049] p-4">
                      <h4 className="text-[#f1f5f9] font-medium text-base mb-4">Peak Demand Trends</h4>
                      <div className="h-72">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={kpiData.trends}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#243049" />
                            <XAxis
                              dataKey="month"
                              stroke="#94a3b8"
                              tick={{ fontSize: 12 }}
                              tickFormatter={v => v?.slice(5, 7)}
                            />
                            <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '14px' }}
                              labelStyle={{ color: '#f1f5f9' }}
                            />
                            <Legend wrapperStyle={{ fontSize: '14px' }} />
                            <Area
                              type="monotone"
                              dataKey="Peak Demand DBIS"
                              stroke="#f59e0b"
                              fill="#f59e0b"
                              fillOpacity={0.2}
                              name="DBIS"
                            />
                            <Area
                              type="monotone"
                              dataKey="Peak Demand Essequibo"
                              stroke="#10b981"
                              fill="#10b981"
                              fillOpacity={0.2}
                              name="Essequibo"
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Collection Rate - Bar Chart (Fixed legibility) */}
                    <div className="bg-[#1a2438] rounded-xl border border-[#243049] p-4">
                      <h4 className="text-[#f1f5f9] font-medium text-base mb-4">Collection Rate Performance</h4>
                      <div className="h-80">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={kpiData.trends} margin={{ top: 25, right: 20, left: 10, bottom: 20 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#243049" />
                            <XAxis
                              dataKey="month"
                              stroke="#94a3b8"
                              tick={{ fontSize: 13, fill: '#94a3b8' }}
                              tickFormatter={v => {
                                if (!v) return '';
                                const d = new Date(v);
                                return `${d.toLocaleString('en', { month: 'short' })} ${String(d.getFullYear()).slice(2)}`;
                              }}
                              angle={-45}
                              textAnchor="end"
                              height={50}
                              interval={0}
                            />
                            <YAxis
                              stroke="#94a3b8"
                              tick={{ fontSize: 13, fill: '#94a3b8' }}
                              domain={[70, 105]}
                              tickFormatter={v => `${v}%`}
                            />
                            <Tooltip
                              contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '14px' }}
                              labelStyle={{ color: '#f1f5f9' }}
                              formatter={v => v ? `${v.toFixed(1)}%` : 'N/A'}
                              labelFormatter={v => {
                                if (!v) return '';
                                const d = new Date(v);
                                return d.toLocaleString('en', { month: 'long', year: 'numeric' });
                              }}
                            />
                            <ReferenceLine
                              y={95}
                              stroke="#ef4444"
                              strokeWidth={2}
                              strokeDasharray="8 4"
                              label={{ value: '95% Target', fill: '#ef4444', fontSize: 13, position: 'right' }}
                            />
                            <Bar dataKey="Collection Rate %" name="Collection Rate" radius={[4, 4, 0, 0]}>
                              {kpiData.trends.map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={
                                    entry['Collection Rate %'] >= 95 ? '#10b981' :
                                    entry['Collection Rate %'] >= 90 ? '#f59e0b' : '#ef4444'
                                  }
                                />
                              ))}
                              <LabelList
                                dataKey="Collection Rate %"
                                position="top"
                                fill="#f1f5f9"
                                fontSize={11}
                                formatter={v => v ? `${v.toFixed(0)}%` : ''}
                              />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ===================== TAB 4: FORECAST ===================== */}
        {activeTab === 'forecast' && (
          <div className="space-y-4">
            {/* Header with Refresh Button */}
            <div className="flex items-center justify-between">
              <h3 className="text-[#f1f5f9] font-medium text-lg">Predictive Analytics</h3>
              <button
                onClick={handleRefreshForecast}
                disabled={refreshingForecast}
                className="px-4 py-2 bg-[#1a2438] hover:bg-[#243049] text-[#94a3b8] rounded-lg flex items-center gap-2 text-base border border-[#243049] disabled:opacity-50"
              >
                <RefreshCw size={16} className={refreshingForecast ? 'animate-spin' : ''} />
                {refreshingForecast ? 'Refreshing...' : 'Refresh Forecasts'}
              </button>
            </div>

            {forecastLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-6 h-6 text-[#64748b] animate-spin" />
              </div>
            ) : (
              <>
                {/* Fallback indicator */}
                {computedProjections.usingFallback && (
                  <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 flex items-center gap-2">
                    <Activity className="w-5 h-5 text-blue-400" />
                    <span className="text-blue-300 text-sm">
                      Using linear projections (upload more daily DBIS data for AI-powered forecasts)
                    </span>
                  </div>
                )}

                {/* Forecast KPI Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <ForecastMetricCard
                    title="Projected Peak (6mo)"
                    value={computedProjections.dbis['6mo']}
                    unit="MW"
                    trend={computedProjections.capacity?.find(c => c.grid === 'DBIS')?.reserve_margin_pct < 15 ? 'warning' : 'normal'}
                  />
                  <ForecastMetricCard
                    title="Capacity Shortfall"
                    value={computedProjections.capacity?.find(c => c.grid === 'DBIS')?.shortfall_date}
                    isDate
                    trend={computedProjections.capacity?.find(c => c.grid === 'DBIS')?.risk_level === 'critical' ? 'danger' : 'normal'}
                  />
                  <ForecastMetricCard
                    title="Avg Load Shedding"
                    value={computedProjections.loadShedding?.avg_shed_mw}
                    unit="MW"
                    trend={computedProjections.loadShedding?.trend === 'increasing' ? 'danger' : 'normal'}
                  />
                  <ForecastMetricCard
                    title="Reserve Margin"
                    value={computedProjections.capacity?.find(c => c.grid === 'DBIS')?.reserve_margin_pct}
                    unit="%"
                    trend={parseFloat(computedProjections.capacity?.find(c => c.grid === 'DBIS')?.reserve_margin_pct || 0) < 15 ? 'warning' : 'success'}
                  />
                </div>

                {/* Demand Growth Trajectory Chart */}
                <div className="bg-[#1a2438] rounded-xl border border-[#243049] p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-[#f1f5f9] font-medium text-base">Demand Growth Trajectory</h4>
                    {computedProjections.usingFallback && (
                      <span className="text-xs text-blue-400 bg-blue-500/20 px-2 py-1 rounded">Linear Projection</span>
                    )}
                  </div>
                  <div className="h-80">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={computedProjections.chartData}
                        margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#243049" />
                        <XAxis dataKey="period" stroke="#94a3b8" tick={{ fontSize: 13 }} />
                        <YAxis stroke="#94a3b8" tick={{ fontSize: 13 }} />
                        <Tooltip
                          contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #334155', borderRadius: '8px', fontSize: '14px' }}
                          labelStyle={{ color: '#f1f5f9' }}
                          formatter={v => `${v.toFixed(1)} MW`}
                        />
                        <Legend wrapperStyle={{ fontSize: '14px' }} />
                        <Bar dataKey="dbis" name="DBIS Grid" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="esq" name="Essequibo Grid" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Trajectory Tables */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* DBIS Grid Table */}
                  <div className="bg-[#1a2438] rounded-xl border border-[#243049] overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#243049] flex items-center justify-between">
                      <h4 className="text-[#f1f5f9] font-medium text-base">DBIS Grid Trajectory</h4>
                      <span className="text-[#64748b] text-sm">Growth: ~{computedProjections.dbis.growthRate.toFixed(1)} MW/month</span>
                    </div>
                    <table className="w-full text-base">
                      <thead>
                        <tr className="border-b border-[#243049]">
                          <th className="text-left py-3 px-4 text-[#94a3b8] font-medium">Timeframe</th>
                          <th className="text-right py-3 px-4 text-[#94a3b8] font-medium">Projected Peak</th>
                          <th className="text-right py-3 px-4 text-[#94a3b8] font-medium">Growth</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { period: 'Current', key: 'current' },
                          { period: '6 months', key: '6mo' },
                          { period: '12 months', key: '12mo' },
                          { period: '24 months', key: '24mo' }
                        ].map(row => {
                          const value = row.key === 'current' ? computedProjections.currentDbis : computedProjections.dbis[row.key];
                          const growth = row.key === 'current' ? 0 : value - computedProjections.currentDbis;
                          const growthPct = computedProjections.currentDbis > 0 ? (growth / computedProjections.currentDbis) * 100 : 0;
                          return (
                            <tr key={row.period} className="border-b border-[#243049]/50">
                              <td className="py-3 px-4 text-[#f1f5f9]">{row.period}</td>
                              <td className="py-3 px-4 text-right text-[#f1f5f9] font-medium">{value.toFixed(1)} MW</td>
                              <td className="py-3 px-4 text-right text-amber-400">
                                {row.key === 'current' ? '—' : `+${growth.toFixed(1)} MW (+${growthPct.toFixed(1)}%)`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Essequibo Grid Table */}
                  <div className="bg-[#1a2438] rounded-xl border border-[#243049] overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#243049] flex items-center justify-between">
                      <h4 className="text-[#f1f5f9] font-medium text-base">Essequibo Grid Trajectory</h4>
                      <span className="text-[#64748b] text-sm">Growth: ~{computedProjections.esq.growthRate.toFixed(2)} MW/month</span>
                    </div>
                    <table className="w-full text-base">
                      <thead>
                        <tr className="border-b border-[#243049]">
                          <th className="text-left py-3 px-4 text-[#94a3b8] font-medium">Timeframe</th>
                          <th className="text-right py-3 px-4 text-[#94a3b8] font-medium">Projected Peak</th>
                          <th className="text-right py-3 px-4 text-[#94a3b8] font-medium">Growth</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { period: 'Current', key: 'current' },
                          { period: '6 months', key: '6mo' },
                          { period: '12 months', key: '12mo' },
                          { period: '24 months', key: '24mo' }
                        ].map(row => {
                          const value = row.key === 'current' ? computedProjections.currentEsq : computedProjections.esq[row.key];
                          const growth = row.key === 'current' ? 0 : value - computedProjections.currentEsq;
                          const growthPct = computedProjections.currentEsq > 0 ? (growth / computedProjections.currentEsq) * 100 : 0;
                          return (
                            <tr key={row.period} className="border-b border-[#243049]/50">
                              <td className="py-3 px-4 text-[#f1f5f9]">{row.period}</td>
                              <td className="py-3 px-4 text-right text-[#f1f5f9] font-medium">{value.toFixed(1)} MW</td>
                              <td className="py-3 px-4 text-right text-emerald-400">
                                {row.key === 'current' ? '—' : `+${growth.toFixed(1)} MW (+${growthPct.toFixed(1)}%)`}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// KPI Summary Card Component
function KpiSummaryCard({ name, data, icon: Icon, unit, inverseGood = false, target }) {
  if (!data) return null;

  const isUp = data.changePct > 0;
  const isGood = inverseGood ? !isUp : isUp;
  const atTarget = target && data.value >= target;

  return (
    <div className="bg-[#1a2438] rounded-xl border border-[#243049] p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-lg bg-[#243049] flex items-center justify-center">
            <Icon className="w-5 h-5 text-[#94a3b8]" />
          </div>
          <span className="text-[#94a3b8] text-sm">{name}</span>
        </div>
        {data.changePct !== null && (
          <div className={`flex items-center gap-1 px-2 py-1 rounded ${isGood ? 'bg-emerald-500/20' : 'bg-red-500/20'}`}>
            {isUp ? <TrendingUp className={`w-4 h-4 ${isGood ? 'text-emerald-400' : 'text-red-400'}`} /> : <TrendingDown className={`w-4 h-4 ${isGood ? 'text-emerald-400' : 'text-red-400'}`} />}
            <span className={`text-sm ${isGood ? 'text-emerald-400' : 'text-red-400'}`}>{Math.abs(data.changePct).toFixed(1)}%</span>
          </div>
        )}
      </div>
      <p className={`text-3xl font-bold ${target ? (atTarget ? 'text-emerald-400' : 'text-red-400') : 'text-[#f1f5f9]'}`}>
        {typeof data.value === 'number' ? (unit === '%' ? data.value.toFixed(1) : Math.round(data.value).toLocaleString()) : data.value}{unit}
      </p>
      {data.previousValue !== null && (
        <p className="text-[#64748b] text-sm mt-1">vs {Math.round(data.previousValue).toLocaleString()}{unit} last month</p>
      )}
    </div>
  );
}

// Forecast Metric Card Component
function ForecastMetricCard({ title, value, unit = '', isDate = false, trend = 'normal' }) {
  const trendStyles = {
    danger: 'border-l-red-500',
    warning: 'border-l-amber-500',
    success: 'border-l-emerald-500',
    normal: 'border-l-[#243049]'
  };

  let displayValue = 'N/A';
  if (isDate && value) {
    displayValue = new Date(value).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } else if (value !== null && value !== undefined) {
    displayValue = `${parseFloat(value).toFixed(1)}${unit}`;
  }

  return (
    <div className={`bg-[#1a2438] rounded-xl border border-[#243049] border-l-4 ${trendStyles[trend]} p-5`}>
      <p className="text-[#64748b] text-sm mb-1">{title}</p>
      <p className="text-2xl font-bold text-[#f1f5f9]">{displayValue}</p>
    </div>
  );
}

export default GPLDetail;
