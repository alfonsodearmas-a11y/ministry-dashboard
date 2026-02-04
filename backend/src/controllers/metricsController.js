const { query, transaction } = require('../config/database');
const { auditService } = require('../services/auditService');
const { AppError, asyncHandler } = require('../middleware/errorHandler');

const AGENCY_TABLES = {
  cjia: 'cjia_daily_metrics',
  gwi: 'gwi_daily_metrics',
  gpl: 'gpl_daily_metrics',
  gcaa: 'gcaa_daily_metrics'
};

// GPL DBIS Power Stations configuration
const GPL_STATIONS = [
  { code: 'SEI', name: 'Skeldon Energy Inc', type: 'fossil' },
  { code: 'CANEFIELD', name: 'Canefield', type: 'fossil' },
  { code: 'DP1', name: 'Demerara Power 1', type: 'fossil' },
  { code: 'DP2', name: 'Demerara Power 2', type: 'fossil' },
  { code: 'DP3', name: 'Demerara Power 3', type: 'fossil' },
  { code: 'DP4', name: 'Demerara Power 4', type: 'fossil' },
  { code: 'DP5', name: 'Demerara Power 5', type: 'fossil' },
  { code: 'COL', name: 'Columbia', type: 'fossil' },
  { code: 'ONVERWAGT', name: 'Onverwagt', type: 'fossil' },
  { code: 'GOE', name: 'Garden of Eden', type: 'fossil' },
  { code: 'PS1', name: 'Power Station 1', type: 'fossil' },
  { code: 'PS2', name: 'Power Station 2', type: 'fossil' }
];

const GPL_SOLAR_SITES = [
  { code: 'HAMPSHIRE', name: 'Hampshire Solar', capacity: 3 },
  { code: 'PROSPECT', name: 'Prospect Solar', capacity: 3 },
  { code: 'TRAFALGAR', name: 'Trafalgar Solar', capacity: 4 }
];

const metricsController = {
  // Get dashboard overview (latest metrics from all agencies)
  getDashboard: asyncHandler(async (req, res) => {
    const [cjia, gwi, gpl, gplDbis, gcaa, alerts] = await Promise.all([
      query(`SELECT * FROM cjia_daily_metrics WHERE status = 'approved' ORDER BY report_date DESC LIMIT 1`),
      query(`SELECT * FROM gwi_daily_metrics WHERE status = 'approved' ORDER BY report_date DESC LIMIT 1`),
      query(`SELECT * FROM gpl_daily_metrics WHERE status = 'approved' ORDER BY report_date DESC LIMIT 1`),
      query(`SELECT * FROM gpl_dbis_daily WHERE status = 'approved' ORDER BY report_date DESC LIMIT 1`),
      query(`SELECT * FROM gcaa_daily_metrics WHERE status = 'approved' ORDER BY report_date DESC LIMIT 1`),
      query(`SELECT * FROM alerts WHERE is_active = true AND resolved_at IS NULL ORDER BY severity DESC, created_at DESC LIMIT 10`)
    ]);

    // Merge GPL data with DBIS data if available
    let gplData = gpl.rows[0] || null;
    const dbisData = gplDbis.rows[0] || null;

    if (dbisData) {
      gplData = {
        ...gplData,
        dbis: dbisData
      };
    }

    res.json({
      success: true,
      data: {
        cjia: cjia.rows[0] || null,
        gwi: gwi.rows[0] || null,
        gpl: gplData,
        gcaa: gcaa.rows[0] || null,
        alerts: alerts.rows
      },
      timestamp: new Date().toISOString()
    });
  }),

  // Get GPL station configuration
  getGPLStations: asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: {
        stations: GPL_STATIONS,
        solarSites: GPL_SOLAR_SITES
      }
    });
  }),

  // Get trend data for charts
  getTrends: asyncHandler(async (req, res) => {
    const { agency } = req.params;
    const { days = 7 } = req.query;

    // Handle GPL DBIS separately
    if (agency?.toLowerCase() === 'gpl-dbis') {
      const result = await query(
        `SELECT * FROM gpl_dbis_daily
         WHERE status = 'approved' AND report_date >= CURRENT_DATE - $1::int
         ORDER BY report_date ASC`,
        [parseInt(days)]
      );
      return res.json({ success: true, data: result.rows });
    }

    const table = AGENCY_TABLES[agency?.toLowerCase()];

    if (!table) {
      throw new AppError('Invalid agency', 400, 'INVALID_AGENCY');
    }

    const result = await query(
      `SELECT * FROM ${table}
       WHERE status = 'approved' AND report_date >= CURRENT_DATE - $1::int
       ORDER BY report_date ASC`,
      [parseInt(days)]
    );

    res.json({ success: true, data: result.rows });
  }),

  // Submit CJIA metrics
  submitCJIA: asyncHandler(async (req, res) => {
    const {
      reportDate, arrivals, departures, onTimePercent,
      revenueMtd, revenueTarget, safetyIncidents, safetyIncidentDetails,
      powerUptime, baggageUptime, securityUptime, notes
    } = req.body;

    // Validation
    if (!reportDate) throw new AppError('Report date is required', 400);
    if (arrivals === undefined) throw new AppError('Arrivals is required', 400);
    if (departures === undefined) throw new AppError('Departures is required', 400);

    const result = await transaction(async (client) => {
      // Check for existing entry
      const existing = await client.query(
        `SELECT id, status FROM cjia_daily_metrics WHERE report_date = $1`,
        [reportDate]
      );

      let metricsResult;
      let action;

      if (existing.rows.length > 0) {
        if (existing.rows[0].status === 'approved') {
          throw new AppError('Cannot modify approved metrics', 400, 'ALREADY_APPROVED');
        }

        metricsResult = await client.query(`
          UPDATE cjia_daily_metrics SET
            arrivals = $1, departures = $2, on_time_departure_percent = $3,
            revenue_mtd = $4, revenue_target = $5, safety_incidents = $6,
            safety_incident_details = $7, power_uptime_percent = $8,
            baggage_uptime_percent = $9, security_uptime_percent = $10,
            notes = $11, submitted_by = $12, status = 'pending'
          WHERE report_date = $13
          RETURNING *`,
          [arrivals, departures, onTimePercent, revenueMtd, revenueTarget,
           safetyIncidents || 0, safetyIncidentDetails, powerUptime,
           baggageUptime, securityUptime, notes, req.user.id, reportDate]
        );
        action = 'UPDATE';
      } else {
        metricsResult = await client.query(`
          INSERT INTO cjia_daily_metrics (
            report_date, arrivals, departures, on_time_departure_percent,
            revenue_mtd, revenue_target, safety_incidents, safety_incident_details,
            power_uptime_percent, baggage_uptime_percent, security_uptime_percent,
            notes, submitted_by, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending')
          RETURNING *`,
          [reportDate, arrivals, departures, onTimePercent, revenueMtd,
           revenueTarget, safetyIncidents || 0, safetyIncidentDetails,
           powerUptime, baggageUptime, securityUptime, notes, req.user.id]
        );
        action = 'CREATE';
      }

      // Create alert for safety incidents
      if (safetyIncidents > 0) {
        await client.query(`
          INSERT INTO alerts (agency, severity, metric_name, current_value, message)
          VALUES ('cjia', 'critical', 'safety_incidents', $1, $2)`,
          [safetyIncidents, `${safetyIncidents} safety incident(s) reported for ${reportDate}`]
        );
      }

      return { metrics: metricsResult.rows[0], action };
    });

    await auditService.log({
      userId: req.user.id,
      action: result.action,
      entityType: 'cjia_daily_metrics',
      entityId: result.metrics.id,
      newValues: req.body,
      req
    });

    res.status(result.action === 'CREATE' ? 201 : 200).json({
      success: true,
      message: `CJIA metrics ${result.action.toLowerCase()}d successfully`,
      data: result.metrics
    });
  }),

  // Submit GWI metrics
  submitGWI: asyncHandler(async (req, res) => {
    const {
      reportDate, nrwPercent, waterProduced, waterBilled,
      activeDisruptions, disruptionAreas, avgResponseTime,
      avgRepairTime, customerComplaints, notes
    } = req.body;

    if (!reportDate) throw new AppError('Report date is required', 400);
    if (nrwPercent === undefined) throw new AppError('NRW percent is required', 400);

    const result = await transaction(async (client) => {
      const existing = await client.query(
        `SELECT id, status FROM gwi_daily_metrics WHERE report_date = $1`,
        [reportDate]
      );

      let metricsResult;
      let action;

      if (existing.rows.length > 0) {
        if (existing.rows[0].status === 'approved') {
          throw new AppError('Cannot modify approved metrics', 400);
        }

        metricsResult = await client.query(`
          UPDATE gwi_daily_metrics SET
            nrw_percent = $1, water_produced_cubic_meters = $2,
            water_billed_cubic_meters = $3, active_disruptions = $4,
            disruption_areas = $5, avg_response_time_hours = $6,
            avg_repair_time_hours = $7, customer_complaints = $8,
            notes = $9, submitted_by = $10, status = 'pending'
          WHERE report_date = $11
          RETURNING *`,
          [nrwPercent, waterProduced, waterBilled, activeDisruptions || 0,
           disruptionAreas, avgResponseTime, avgRepairTime,
           customerComplaints || 0, notes, req.user.id, reportDate]
        );
        action = 'UPDATE';
      } else {
        metricsResult = await client.query(`
          INSERT INTO gwi_daily_metrics (
            report_date, nrw_percent, water_produced_cubic_meters,
            water_billed_cubic_meters, active_disruptions, disruption_areas,
            avg_response_time_hours, avg_repair_time_hours, customer_complaints,
            notes, submitted_by, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
          RETURNING *`,
          [reportDate, nrwPercent, waterProduced, waterBilled,
           activeDisruptions || 0, disruptionAreas, avgResponseTime,
           avgRepairTime, customerComplaints || 0, notes, req.user.id]
        );
        action = 'CREATE';
      }

      // Create alert for high NRW
      if (nrwPercent > 50) {
        await client.query(`
          INSERT INTO alerts (agency, severity, metric_name, current_value, threshold_value, message)
          VALUES ('gwi', 'critical', 'nrw_percent', $1, 50, $2)`,
          [nrwPercent, `NRW at ${nrwPercent}% - exceeds 50% threshold`]
        );
      }

      return { metrics: metricsResult.rows[0], action };
    });

    await auditService.log({
      userId: req.user.id,
      action: result.action,
      entityType: 'gwi_daily_metrics',
      entityId: result.metrics.id,
      newValues: req.body,
      req
    });

    res.status(result.action === 'CREATE' ? 201 : 200).json({
      success: true,
      message: `GWI metrics ${result.action.toLowerCase()}d successfully`,
      data: result.metrics
    });
  }),

  // Submit GPL basic metrics (legacy)
  submitGPL: asyncHandler(async (req, res) => {
    const {
      reportDate, currentLoad, capacity, activeOutages, affectedCustomers,
      avgRestorationTime, collectionRate, hfoGeneration, lfoGeneration,
      solarGeneration, otherGeneration, notes
    } = req.body;

    if (!reportDate) throw new AppError('Report date is required', 400);
    if (currentLoad === undefined) throw new AppError('Current load is required', 400);

    // Validate generation percentages
    const totalGeneration = (hfoGeneration || 0) + (lfoGeneration || 0) +
                           (solarGeneration || 0) + (otherGeneration || 0);
    if (Math.abs(totalGeneration - 100) > 0.1) {
      throw new AppError('Generation percentages must sum to 100%', 400);
    }

    const result = await transaction(async (client) => {
      const existing = await client.query(
        `SELECT id, status FROM gpl_daily_metrics WHERE report_date = $1`,
        [reportDate]
      );

      let metricsResult;
      let action;

      if (existing.rows.length > 0) {
        if (existing.rows[0].status === 'approved') {
          throw new AppError('Cannot modify approved metrics', 400);
        }

        metricsResult = await client.query(`
          UPDATE gpl_daily_metrics SET
            current_load_mw = $1, capacity_mw = $2, active_outages = $3,
            affected_customers = $4, avg_restoration_time_hours = $5,
            collection_rate_percent = $6, hfo_generation_percent = $7,
            lfo_generation_percent = $8, solar_generation_percent = $9,
            other_generation_percent = $10, notes = $11, submitted_by = $12, status = 'pending'
          WHERE report_date = $13
          RETURNING *`,
          [currentLoad, capacity, activeOutages || 0, affectedCustomers || 0,
           avgRestorationTime, collectionRate, hfoGeneration, lfoGeneration,
           solarGeneration, otherGeneration, notes, req.user.id, reportDate]
        );
        action = 'UPDATE';
      } else {
        metricsResult = await client.query(`
          INSERT INTO gpl_daily_metrics (
            report_date, current_load_mw, capacity_mw, active_outages,
            affected_customers, avg_restoration_time_hours, collection_rate_percent,
            hfo_generation_percent, lfo_generation_percent, solar_generation_percent,
            other_generation_percent, notes, submitted_by, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending')
          RETURNING *`,
          [reportDate, currentLoad, capacity, activeOutages || 0,
           affectedCustomers || 0, avgRestorationTime, collectionRate,
           hfoGeneration, lfoGeneration, solarGeneration, otherGeneration,
           notes, req.user.id]
        );
        action = 'CREATE';
      }

      return { metrics: metricsResult.rows[0], action };
    });

    await auditService.log({
      userId: req.user.id,
      action: result.action,
      entityType: 'gpl_daily_metrics',
      entityId: result.metrics.id,
      newValues: req.body,
      req
    });

    res.status(result.action === 'CREATE' ? 201 : 200).json({
      success: true,
      message: `GPL metrics ${result.action.toLowerCase()}d successfully`,
      data: result.metrics
    });
  }),

  // Submit GPL DBIS daily report (new comprehensive endpoint)
  submitGPLDBIS: asyncHandler(async (req, res) => {
    const {
      reportDate,
      stationData,           // { SEI: { units, derated_mw, available_mw }, ... }
      hampshireSolarMwp,
      prospectSolarMwp,
      trafalgarSolarMwp,
      eveningPeakOnbars,
      eveningPeakSuppressed,
      dayPeakOnbars,
      dayPeakSuppressed,
      generationAvailability,
      activeOutages,
      affectedCustomers,
      avgRestorationTime,
      collectionRate,
      hfoGeneration,
      lfoGeneration,
      solarGeneration,
      otherGeneration,
      notes
    } = req.body;

    // Validation
    if (!reportDate) throw new AppError('Report date is required', 400);
    if (!stationData || Object.keys(stationData).length === 0) {
      throw new AppError('Station data is required', 400);
    }

    // Validate station data structure
    for (const [stationCode, data] of Object.entries(stationData)) {
      if (!GPL_STATIONS.find(s => s.code === stationCode)) {
        throw new AppError(`Invalid station code: ${stationCode}`, 400);
      }
      if (data.available_mw !== undefined && data.available_mw < 0) {
        throw new AppError(`Invalid available MW for ${stationCode}`, 400);
      }
    }

    // Calculate totals
    let totalFossilCapacity = 0;
    for (const [code, data] of Object.entries(stationData)) {
      totalFossilCapacity += parseFloat(data.available_mw) || 0;
    }

    const totalRenewable = (parseFloat(hampshireSolarMwp) || 0) +
                          (parseFloat(prospectSolarMwp) || 0) +
                          (parseFloat(trafalgarSolarMwp) || 0);

    const result = await transaction(async (client) => {
      const existing = await client.query(
        `SELECT id, status FROM gpl_dbis_daily WHERE report_date = $1`,
        [reportDate]
      );

      let metricsResult;
      let action;

      if (existing.rows.length > 0) {
        if (existing.rows[0].status === 'approved') {
          throw new AppError('Cannot modify approved metrics', 400, 'ALREADY_APPROVED');
        }

        metricsResult = await client.query(`
          UPDATE gpl_dbis_daily SET
            station_data = $1,
            hampshire_solar_mwp = $2,
            prospect_solar_mwp = $3,
            trafalgar_solar_mwp = $4,
            total_fossil_capacity_mw = $5,
            total_renewable_capacity_mw = $6,
            total_dbis_capacity_mw = $7,
            evening_peak_onbars_mw = $8,
            evening_peak_suppressed_mw = $9,
            day_peak_onbars_mw = $10,
            day_peak_suppressed_mw = $11,
            generation_availability_mw = $12,
            active_outages = $13,
            affected_customers = $14,
            avg_restoration_time_hours = $15,
            collection_rate_percent = $16,
            hfo_generation_percent = $17,
            lfo_generation_percent = $18,
            solar_generation_percent = $19,
            other_generation_percent = $20,
            notes = $21,
            submitted_by = $22,
            status = 'pending'
          WHERE report_date = $23
          RETURNING *`,
          [
            JSON.stringify(stationData),
            hampshireSolarMwp || 0,
            prospectSolarMwp || 0,
            trafalgarSolarMwp || 0,
            totalFossilCapacity,
            totalRenewable,
            totalFossilCapacity + totalRenewable,
            eveningPeakOnbars,
            eveningPeakSuppressed,
            dayPeakOnbars,
            dayPeakSuppressed,
            generationAvailability,
            activeOutages || 0,
            affectedCustomers || 0,
            avgRestorationTime,
            collectionRate,
            hfoGeneration,
            lfoGeneration,
            solarGeneration,
            otherGeneration,
            notes,
            req.user.id,
            reportDate
          ]
        );
        action = 'UPDATE';
      } else {
        metricsResult = await client.query(`
          INSERT INTO gpl_dbis_daily (
            report_date, station_data,
            hampshire_solar_mwp, prospect_solar_mwp, trafalgar_solar_mwp,
            total_fossil_capacity_mw, total_renewable_capacity_mw, total_dbis_capacity_mw,
            evening_peak_onbars_mw, evening_peak_suppressed_mw,
            day_peak_onbars_mw, day_peak_suppressed_mw,
            generation_availability_mw,
            active_outages, affected_customers, avg_restoration_time_hours,
            collection_rate_percent,
            hfo_generation_percent, lfo_generation_percent,
            solar_generation_percent, other_generation_percent,
            notes, submitted_by, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, 'pending')
          RETURNING *`,
          [
            reportDate,
            JSON.stringify(stationData),
            hampshireSolarMwp || 0,
            prospectSolarMwp || 0,
            trafalgarSolarMwp || 0,
            totalFossilCapacity,
            totalRenewable,
            totalFossilCapacity + totalRenewable,
            eveningPeakOnbars,
            eveningPeakSuppressed,
            dayPeakOnbars,
            dayPeakSuppressed,
            generationAvailability,
            activeOutages || 0,
            affectedCustomers || 0,
            avgRestorationTime,
            collectionRate,
            hfoGeneration,
            lfoGeneration,
            solarGeneration,
            otherGeneration,
            notes,
            req.user.id
          ]
        );
        action = 'CREATE';
      }

      // Create alerts for critical conditions
      const totalCapacity = totalFossilCapacity + totalRenewable;
      const peakDemand = eveningPeakOnbars || dayPeakOnbars || 0;

      if (peakDemand > 0 && generationAvailability) {
        const reserveMargin = ((generationAvailability - peakDemand) / peakDemand) * 100;
        if (reserveMargin < 15) {
          await client.query(`
            INSERT INTO alerts (agency, severity, metric_name, current_value, threshold_value, message)
            VALUES ('gpl', $1, 'reserve_margin', $2, 15, $3)`,
            [
              reserveMargin < 10 ? 'critical' : 'warning',
              reserveMargin,
              `Reserve margin at ${reserveMargin.toFixed(1)}% - below 15% threshold`
            ]
          );
        }
      }

      return { metrics: metricsResult.rows[0], action };
    });

    await auditService.log({
      userId: req.user.id,
      action: result.action,
      entityType: 'gpl_dbis_daily',
      entityId: result.metrics.id,
      newValues: req.body,
      req
    });

    res.status(result.action === 'CREATE' ? 201 : 200).json({
      success: true,
      message: `GPL DBIS metrics ${result.action.toLowerCase()}d successfully`,
      data: result.metrics
    });
  }),

  // Get GPL DBIS history
  getGPLDBISHistory: asyncHandler(async (req, res) => {
    const { limit = 30, offset = 0 } = req.query;

    const result = await query(`
      SELECT d.*,
             s.full_name as submitted_by_name,
             a.full_name as approved_by_name
      FROM gpl_dbis_daily d
      LEFT JOIN users s ON d.submitted_by = s.id
      LEFT JOIN users a ON d.approved_by = a.id
      ORDER BY d.report_date DESC
      LIMIT $1 OFFSET $2`,
      [parseInt(limit), parseInt(offset)]
    );

    res.json({ success: true, data: result.rows });
  }),

  // Submit GCAA metrics
  submitGCAA: asyncHandler(async (req, res) => {
    const {
      reportDate, activeRegistrations, inspectionsMtd, inspectionsTarget,
      complianceRate, incidentReports, incidentDetails, renewalsPending, notes
    } = req.body;

    if (!reportDate) throw new AppError('Report date is required', 400);
    if (activeRegistrations === undefined) throw new AppError('Active registrations required', 400);

    const result = await transaction(async (client) => {
      const existing = await client.query(
        `SELECT id, status FROM gcaa_daily_metrics WHERE report_date = $1`,
        [reportDate]
      );

      let metricsResult;
      let action;

      if (existing.rows.length > 0) {
        if (existing.rows[0].status === 'approved') {
          throw new AppError('Cannot modify approved metrics', 400);
        }

        metricsResult = await client.query(`
          UPDATE gcaa_daily_metrics SET
            active_aircraft_registrations = $1, inspections_completed_mtd = $2,
            inspections_target = $3, compliance_rate_percent = $4,
            incident_reports = $5, incident_details = $6, renewals_pending = $7,
            notes = $8, submitted_by = $9, status = 'pending'
          WHERE report_date = $10
          RETURNING *`,
          [activeRegistrations, inspectionsMtd, inspectionsTarget,
           complianceRate, incidentReports || 0, incidentDetails,
           renewalsPending || 0, notes, req.user.id, reportDate]
        );
        action = 'UPDATE';
      } else {
        metricsResult = await client.query(`
          INSERT INTO gcaa_daily_metrics (
            report_date, active_aircraft_registrations, inspections_completed_mtd,
            inspections_target, compliance_rate_percent, incident_reports,
            incident_details, renewals_pending, notes, submitted_by, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
          RETURNING *`,
          [reportDate, activeRegistrations, inspectionsMtd, inspectionsTarget,
           complianceRate, incidentReports || 0, incidentDetails,
           renewalsPending || 0, notes, req.user.id]
        );
        action = 'CREATE';
      }

      return { metrics: metricsResult.rows[0], action };
    });

    await auditService.log({
      userId: req.user.id,
      action: result.action,
      entityType: 'gcaa_daily_metrics',
      entityId: result.metrics.id,
      newValues: req.body,
      req
    });

    res.status(result.action === 'CREATE' ? 201 : 200).json({
      success: true,
      message: `GCAA metrics ${result.action.toLowerCase()}d successfully`,
      data: result.metrics
    });
  }),

  // Approve/reject metrics (updated to handle DBIS)
  updateStatus: asyncHandler(async (req, res) => {
    const { agency, id } = req.params;
    const { status } = req.body;

    // Handle GPL DBIS separately
    let table;
    if (agency?.toLowerCase() === 'gpl-dbis') {
      table = 'gpl_dbis_daily';
    } else {
      table = AGENCY_TABLES[agency?.toLowerCase()];
    }

    if (!table) throw new AppError('Invalid agency', 400);
    if (!['approved', 'rejected'].includes(status)) {
      throw new AppError('Invalid status', 400);
    }

    const result = await query(`
      UPDATE ${table}
      SET status = $1, approved_by = $2
      WHERE id = $3
      RETURNING *`,
      [status, req.user.id, id]
    );

    if (result.rows.length === 0) {
      throw new AppError('Metric not found', 404);
    }

    await auditService.log({
      userId: req.user.id,
      action: status === 'approved' ? 'APPROVE' : 'REJECT',
      entityType: table,
      entityId: id,
      newValues: { status },
      req
    });

    res.json({
      success: true,
      message: `Metric ${status} successfully`,
      data: result.rows[0]
    });
  }),

  // Get submission history
  getHistory: asyncHandler(async (req, res) => {
    const { agency } = req.params;
    const { limit = 30, offset = 0 } = req.query;

    // Handle GPL DBIS separately
    let table;
    if (agency?.toLowerCase() === 'gpl-dbis') {
      table = 'gpl_dbis_daily';
    } else {
      table = AGENCY_TABLES[agency?.toLowerCase()];
    }

    if (!table) throw new AppError('Invalid agency', 400);

    const result = await query(`
      SELECT m.*,
             s.full_name as submitted_by_name,
             a.full_name as approved_by_name
      FROM ${table} m
      LEFT JOIN users s ON m.submitted_by = s.id
      LEFT JOIN users a ON m.approved_by = a.id
      ORDER BY m.report_date DESC
      LIMIT $1 OFFSET $2`,
      [parseInt(limit), parseInt(offset)]
    );

    res.json({ success: true, data: result.rows });
  }),

  // Get pending submissions (for supervisors) - updated to include DBIS
  getPending: asyncHandler(async (req, res) => {
    const pending = {};

    // Add DBIS to tables for pending check
    const allTables = {
      ...AGENCY_TABLES,
      'gpl-dbis': 'gpl_dbis_daily'
    };

    for (const [agency, table] of Object.entries(allTables)) {
      // Check if user can access this agency
      const agencyBase = agency.replace('-dbis', '');
      if (req.user.role !== 'director' && req.user.role !== 'admin' &&
          req.user.agency !== 'ministry' && req.user.agency !== agencyBase) {
        continue;
      }

      const result = await query(`
        SELECT m.*, u.full_name as submitted_by_name
        FROM ${table} m
        LEFT JOIN users u ON m.submitted_by = u.id
        WHERE m.status = 'pending'
        ORDER BY m.report_date DESC`
      );
      pending[agency] = result.rows;
    }

    res.json({ success: true, data: pending });
  })
};

module.exports = { metricsController };
