import { useState, useCallback, useEffect } from 'react';
import { generateAgencyData, getSparklineData } from '../data/mockData';
import { Plane, Droplets, Zap, Shield } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api/v1';

// Transform API response to match expected GPL data structure
const transformGPLData = (apiData) => {
  if (!apiData?.stations || !apiData?.summary) {
    return null;
  }

  const { summary, stations, units, analysis } = apiData;

  // Build power stations array from stations data
  const powerStations = stations.map(station => {
    // Find units for this station
    const stationUnits = units?.filter(u => u.station === station.station_name) || [];
    const onlineUnits = stationUnits.filter(u => u.status === 'online').length;
    const totalUnits = stationUnits.length || station.total_units || 0;

    return {
      code: station.station_name?.toUpperCase().replace(/\s+/g, '_') || 'UNKNOWN',
      name: station.station_name || 'Unknown',
      type: 'fossil',
      units: totalUnits,
      onlineUnits,
      derated: parseFloat(station.total_derated_capacity_mw) || 0,
      available: parseFloat(station.total_available_mw) || 0,
    };
  });

  // Solar stations
  const solarStations = [
    { name: 'Hampshire Solar', capacity: parseFloat(summary.solar_hampshire_mwp) || 0 },
    { name: 'Prospect Solar', capacity: parseFloat(summary.solar_prospect_mwp) || 0 },
    { name: 'Trafalgar Solar', capacity: parseFloat(summary.solar_trafalgar_mwp) || 0 },
  ].filter(s => s.capacity > 0);

  return {
    powerStations,
    solarStations,
    totalRenewableCapacity: parseFloat(summary.total_renewable_mwp) || 0,
    forcedOutageRate: parseFloat(summary.average_for) * 100 || 7.5,
    expectedPeakDemand: parseFloat(summary.expected_peak_demand_mw) || 200,
    actualEveningPeak: {
      onBars: parseFloat(summary.evening_peak_on_bars_mw) || 0,
      suppressed: parseFloat(summary.evening_peak_suppressed_mw) || 0,
    },
    actualDayPeak: {
      onBars: parseFloat(summary.day_peak_on_bars_mw) || 0,
      suppressed: parseFloat(summary.day_peak_suppressed_mw) || 0,
    },
    reportDate: summary.report_date,
    // AI Analysis
    aiAnalysis: analysis || null,
  };
};

const AGENCY_CONFIG = {
  cjia: {
    id: 'cjia',
    title: 'CJIA',
    subtitle: 'Cheddi Jagan International Airport',
    icon: Plane,
    accentColor: 'from-sky-500 to-blue-600',
  },
  gwi: {
    id: 'gwi',
    title: 'GWI',
    subtitle: 'Guyana Water Inc.',
    icon: Droplets,
    accentColor: 'from-cyan-500 to-teal-600',
  },
  gpl: {
    id: 'gpl',
    title: 'GPL',
    subtitle: 'Guyana Power & Light',
    icon: Zap,
    accentColor: 'from-amber-500 to-orange-600',
  },
  gcaa: {
    id: 'gcaa',
    title: 'GCAA',
    subtitle: 'Guyana Civil Aviation Authority',
    icon: Shield,
    accentColor: 'from-violet-500 to-purple-600',
  },
};

// Compute GPL summary from power station data
const computeGPLSummary = (data) => {
  if (!data?.powerStations) return null;

  const stations = data.powerStations;
  const totalDerated = stations.reduce((sum, s) => sum + s.derated, 0);
  const totalAvailable = stations.reduce((sum, s) => sum + s.available, 0);

  // Count stations by status
  const stationStatuses = stations.map(s => {
    if (s.available === 0) return 'offline';
    if (s.available / s.derated < 0.5) return 'critical';
    if (s.available / s.derated < 0.8) return 'degraded';
    return 'operational';
  });

  const offlineCount = stationStatuses.filter(s => s === 'offline').length;
  const criticalCount = stationStatuses.filter(s => s === 'critical').length;
  const degradedCount = stationStatuses.filter(s => s === 'degraded').length;
  const stationsBelowCapacity = offlineCount + criticalCount + degradedCount;

  // Solar capacity
  const totalSolar = data.solarStations?.reduce((sum, s) => sum + s.capacity, 0) || data.totalRenewableCapacity || 0;

  // Total DBIS = Available Fossil + Renewable (actual usable capacity)
  const totalDBIS = totalAvailable + totalSolar;

  // Actual peak demand (evening on bars) - this is real current load
  const actualPeak = data.actualEveningPeak?.onBars || 0;

  // ACTUAL RESERVE: Total DBIS Capacity minus Actual Peak Demand
  // This is the operational reserve - how much spare capacity we have RIGHT NOW
  const actualReserve = totalDBIS - actualPeak;

  // Planning metrics (for reference)
  const expectedCapacity = totalAvailable * (1 - (data.forcedOutageRate || 7.5) / 100);
  const expectedPeak = data.expectedPeakDemand || 200;
  const planningReserve = expectedCapacity - expectedPeak;

  return {
    derated: Math.round(totalDerated * 10) / 10,
    available: Math.round(totalAvailable * 10) / 10,
    availability: Math.round((totalAvailable / totalDerated) * 1000) / 10,
    solar: totalSolar,
    totalDBIS: Math.round(totalDBIS * 10) / 10,
    actualPeak: Math.round(actualPeak * 10) / 10,
    expectedPeak,
    expectedCapacity: Math.round(expectedCapacity * 10) / 10,
    // Use actual reserve (same as drill-down view)
    reserve: Math.round(actualReserve * 10) / 10,
    planningReserve: Math.round(planningReserve * 10) / 10,
    offlineCount,
    criticalCount,
    degradedCount,
    stationsBelowCapacity,
    issueCount: offlineCount + criticalCount,
  };
};

const getAgencyStatus = (id, data) => {
  switch (id) {
    case 'cjia':
      return data.safetyIncidents === 0 && data.onTimePercent >= 85
        ? { type: 'good', text: 'Operational' }
        : { type: 'warning', text: 'Attention' };
    case 'gwi':
      if (data.nrwPercent > 55) return { type: 'critical', text: 'Critical' };
      if (data.activeDisruptions > 2) return { type: 'warning', text: 'Disruptions' };
      return { type: 'good', text: 'Operational' };
    case 'gpl': {
      const summary = computeGPLSummary(data);
      if (!summary) return { type: 'good', text: 'Unknown' };
      // Use actual reserve for status (consistent with displayed value)
      if (summary.reserve < 0) return { type: 'critical', text: 'Deficit' };
      if (summary.criticalCount > 2) return { type: 'warning', text: 'Degraded' };
      if (summary.reserve < 20) return { type: 'warning', text: 'Tight Margin' };
      return { type: 'good', text: 'Operational' };
    }
    case 'gcaa':
      return data.complianceRate >= 90
        ? { type: 'good', text: 'Compliant' }
        : { type: 'warning', text: 'Review' };
    default:
      return { type: 'good', text: 'Unknown' };
  }
};

const getAgencyMetrics = (id, data) => {
  switch (id) {
    case 'cjia':
      return [
        { label: 'Passengers MTD', value: data.mtdTotal?.toLocaleString(), highlight: true },
        { label: 'YoY Growth', value: `+${data.mtdYoyChange}%`, status: 'good' },
        { label: '2025 Passengers', value: data.annual2025Total?.toLocaleString() },
      ];
    case 'gwi':
      return [
        { label: 'NRW', value: `${data.nrwPercent}%`, highlight: true, status: data.nrwPercent > 50 ? 'critical' : 'good' },
        { label: 'Disruptions', value: data.activeDisruptions, status: data.activeDisruptions > 2 ? 'warning' : 'good' },
        { label: 'Response Time', value: `${data.avgResponseTime} hrs` },
      ];
    case 'gpl': {
      const summary = computeGPLSummary(data);
      if (!summary) {
        return [
          { label: 'System Load', value: 'No data', highlight: true },
          { label: 'Availability', value: '-' },
          { label: 'Total DBIS', value: '-' },
        ];
      }
      return [
        {
          // System Load: Actual Peak / Total DBIS Capacity
          label: 'System Load',
          value: `${summary.actualPeak}/${summary.totalDBIS} MW`,
          highlight: true
        },
        {
          label: 'Availability',
          value: `${summary.availability}%`,
          status: summary.availability >= 80 ? 'good' : summary.availability >= 70 ? 'warning' : 'critical'
        },
        {
          // Now using actual reserve (DBIS - Peak) to match drill-down
          label: 'Reserve',
          value: `${summary.reserve > 0 ? '+' : ''}${summary.reserve} MW`,
          status: summary.reserve >= 30 ? 'good' : summary.reserve >= 0 ? 'warning' : 'critical'
        },
      ];
    }
    case 'gcaa':
      return [
        { label: 'Aircraft', value: data.activeRegistrations, highlight: true },
        { label: 'Inspections', value: `${data.inspectionsMTD}/${data.inspectionsTarget}` },
        { label: 'Compliance', value: `${data.complianceRate}%` },
      ];
    default:
      return [];
  }
};

const getAgencyTrend = (id, data) => {
  switch (id) {
    case 'cjia':
      return data.mtdYoyChange;
    case 'gwi':
      return data.responseTimeTrend;
    case 'gpl':
      return null;
    case 'gcaa':
      return null;
    default:
      return null;
  }
};

// Get warning badge for agencies with issues requiring attention
const getAgencyWarningBadge = (id, data) => {
  switch (id) {
    case 'gpl': {
      const summary = computeGPLSummary(data);
      if (!summary) return null;
      // Show badge if any stations are below capacity
      if (summary.stationsBelowCapacity > 0) {
        return {
          count: summary.stationsBelowCapacity,
          text: `${summary.stationsBelowCapacity} station${summary.stationsBelowCapacity > 1 ? 's' : ''} below capacity`,
          severity: summary.criticalCount > 0 || summary.offlineCount > 0 ? 'critical' : 'warning'
        };
      }
      return null;
    }
    case 'gwi': {
      if (data.activeDisruptions > 0) {
        return {
          count: data.activeDisruptions,
          text: `${data.activeDisruptions} active disruption${data.activeDisruptions > 1 ? 's' : ''}`,
          severity: data.activeDisruptions > 2 ? 'warning' : 'info'
        };
      }
      return null;
    }
    default:
      return null;
  }
};

export const useAgencyData = () => {
  const [rawData, setRawData] = useState(generateAgencyData());
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [isLoading, setIsLoading] = useState(false);

  // Fetch GPL data from API
  const fetchGPLData = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/gpl/latest`);
      if (!response.ok) {
        console.warn('Failed to fetch GPL data:', response.status);
        return null;
      }
      const data = await response.json();

      // Also fetch AI analysis if we have an upload_id
      let analysis = null;
      if (data.summary?.upload_id) {
        try {
          const analysisResponse = await fetch(`${API_BASE}/gpl/analysis/${data.summary.upload_id}`);
          if (analysisResponse.ok) {
            analysis = await analysisResponse.json();
          }
        } catch (err) {
          console.warn('Failed to fetch AI analysis:', err);
        }
      }

      return transformGPLData({ ...data, analysis });
    } catch (err) {
      console.warn('Error fetching GPL data:', err);
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);

    // Fetch real GPL data
    const gplData = await fetchGPLData();

    // Get mock data for other agencies
    const mockData = generateAgencyData();

    // Merge real GPL data with mock data for other agencies
    setRawData(prev => ({
      ...mockData,
      gpl: gplData || mockData.gpl,
    }));

    setLastUpdated(new Date());
    setIsLoading(false);
  }, [fetchGPLData]);

  // Fetch data on initial mount
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Build enriched agency objects
  const agencies = Object.keys(AGENCY_CONFIG).map(id => {
    const config = AGENCY_CONFIG[id];
    const data = rawData[id];
    return {
      ...config,
      status: getAgencyStatus(id, data),
      metrics: getAgencyMetrics(id, data),
      sparklineData: getSparklineData(id, data),
      trend: getAgencyTrend(id, data),
      warningBadge: getAgencyWarningBadge(id, data),
      data,
    };
  });

  // Generate alerts from data
  const gplSummary = computeGPLSummary(rawData.gpl);

  const alerts = [
    ...(rawData.gwi.nrwPercent > 55 ? [{
      severity: 'critical',
      agency: 'gwi',
      message: `Non-Revenue Water at ${rawData.gwi.nrwPercent}%`,
      detail: 'Exceeds 55% critical threshold',
    }] : []),
    ...(rawData.cjia.safetyIncidents > 0 ? [{
      severity: 'critical',
      agency: 'cjia',
      message: `${rawData.cjia.safetyIncidents} safety incident(s) reported`,
      detail: 'Immediate action required',
    }] : []),
    ...(gplSummary && gplSummary.reserve < 0 ? [{
      severity: 'critical',
      agency: 'gpl',
      message: `Capacity deficit: ${Math.abs(gplSummary.reserve).toFixed(1)} MW below current demand`,
      detail: `DBIS Capacity: ${gplSummary.totalDBIS} MW | Evening Peak: ${gplSummary.actualPeak} MW`,
    }] : []),
    ...(gplSummary && gplSummary.reserve >= 0 && gplSummary.reserve < 20 ? [{
      severity: 'warning',
      agency: 'gpl',
      message: `Low reserve margin: ${gplSummary.reserve.toFixed(1)} MW`,
      detail: `DBIS Capacity: ${gplSummary.totalDBIS} MW | Evening Peak: ${gplSummary.actualPeak} MW`,
    }] : []),
    ...(gplSummary && gplSummary.criticalCount > 0 ? [{
      severity: 'warning',
      agency: 'gpl',
      message: `${gplSummary.criticalCount} power station(s) at critical capacity`,
      detail: 'Operating below 50% of derated capacity',
    }] : []),
    ...(rawData.gwi.activeDisruptions > 2 ? [{
      severity: 'warning',
      agency: 'gwi',
      message: `${rawData.gwi.activeDisruptions} service disruptions active`,
      detail: rawData.gwi.disruptionAreas.join(', '),
    }] : []),
  ];

  return {
    agencies,
    alerts,
    rawData,
    lastUpdated,
    isLoading,
    refresh,
  };
};

export default useAgencyData;
