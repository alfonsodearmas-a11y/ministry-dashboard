import { useState, useCallback } from 'react';
import { generateAgencyData, getSparklineData } from '../data/mockData';
import { Plane, Droplets, Zap, Shield } from 'lucide-react';

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

  const refresh = useCallback(() => {
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setRawData(generateAgencyData());
      setLastUpdated(new Date());
      setIsLoading(false);
    }, 800);
  }, []);

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
