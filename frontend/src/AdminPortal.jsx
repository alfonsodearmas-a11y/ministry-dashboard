import React, { useState, useMemo } from 'react';
import { Plane, Droplets, Zap, Shield, Save, CheckCircle, AlertCircle, LogOut, User, Calendar, Clock, ChevronDown, Eye, EyeOff, FileText, History, UserPlus, Mail, ArrowLeft, Battery, Sun, TrendingUp, Upload } from 'lucide-react';
import GPLExcelUpload from './components/GPLExcelUpload';

// Simulated user accounts for each agency
const USERS = {
  'cjia_admin': { password: 'cjia2024', agency: 'cjia', name: 'CJIA Administrator', role: 'Data Entry Officer' },
  'gwi_admin': { password: 'gwi2024', agency: 'gwi', name: 'GWI Administrator', role: 'Data Entry Officer' },
  'gpl_admin': { password: 'gpl2024', agency: 'gpl', name: 'GPL Administrator', role: 'Data Entry Officer' },
  'gcaa_admin': { password: 'gcaa2024', agency: 'gcaa', name: 'GCAA Administrator', role: 'Data Entry Officer' },
  'ministry_admin': { password: 'ministry2024', agency: 'all', name: 'Ministry Administrator', role: 'Director General' },
};

// GPL DBIS Power Stations
const GPL_POWER_STATIONS = [
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
  { code: 'PS2', name: 'Power Station 2', type: 'fossil' },
];

const GPL_SOLAR_SITES = [
  { code: 'HAMPSHIRE', name: 'Hampshire Solar', defaultCapacity: 3 },
  { code: 'PROSPECT', name: 'Prospect Solar', defaultCapacity: 3 },
  { code: 'TRAFALGAR', name: 'Trafalgar Solar', defaultCapacity: 4 },
];

// Agency configurations
const AGENCIES = {
  cjia: {
    name: 'CJIA',
    fullName: 'Cheddi Jagan International Airport',
    icon: Plane,
    color: 'from-sky-500 to-blue-600',
    fields: [
      { id: 'entryDate', label: 'Date', type: 'date', required: true },
      { id: 'arrivals', label: 'Passenger Arrivals', type: 'number', required: true, min: 0 },
      { id: 'departures', label: 'Passenger Departures', type: 'number', required: true, min: 0 },
      { id: 'total', label: 'Total Passengers', type: 'calculated', calculatedFrom: ['arrivals', 'departures'], readonly: true },
      { id: 'cargoArrived', label: 'Cargo Arrived (KG)', type: 'number', required: true, min: 0 },
      { id: 'cargoDeparted', label: 'Cargo Departed (KG)', type: 'number', required: true, min: 0 },
    ]
  },
  gwi: {
    name: 'GWI',
    fullName: 'Guyana Water Inc.',
    icon: Droplets,
    color: 'from-cyan-500 to-teal-600',
    fields: [
      { id: 'nrwPercent', label: 'Non-Revenue Water (NRW) %', type: 'number', required: true, min: 0, max: 100, step: 0.1, highlight: true },
      { id: 'waterProduced', label: 'Water Produced (m3)', type: 'number', required: true, min: 0 },
      { id: 'waterBilled', label: 'Water Billed (m3)', type: 'number', required: true, min: 0 },
      { id: 'activeDisruptions', label: 'Active Service Disruptions', type: 'number', required: true, min: 0 },
      { id: 'disruptionAreas', label: 'Affected Areas (comma separated)', type: 'text', required: false, placeholder: 'e.g., Georgetown North, Linden Highway' },
      { id: 'avgResponseTime', label: 'Avg Response Time (hours)', type: 'number', required: true, min: 0, step: 0.1 },
      { id: 'avgRepairTime', label: 'Avg Time to Repair Leaks (hours)', type: 'number', required: true, min: 0, step: 0.1 },
      { id: 'customerComplaints', label: 'Customer Complaints (Daily)', type: 'number', required: false, min: 0 },
    ]
  },
  gpl: {
    name: 'GPL',
    fullName: 'Guyana Power & Light',
    icon: Zap,
    color: 'from-amber-500 to-orange-600',
    hasDBIS: true, // Flag for DBIS entry mode
    fields: [
      { id: 'currentLoad', label: 'Current System Load (MW)', type: 'number', required: true, min: 0 },
      { id: 'capacity', label: 'Total Capacity (MW)', type: 'number', required: true, min: 0 },
      { id: 'activeOutages', label: 'Active Outages', type: 'number', required: true, min: 0 },
      { id: 'affectedCustomers', label: 'Affected Customers', type: 'number', required: true, min: 0 },
      { id: 'avgRestorationTime', label: 'Avg Restoration Time (hours)', type: 'number', required: true, min: 0, step: 0.1 },
      { id: 'collectionRate', label: 'Revenue Collection Rate %', type: 'number', required: true, min: 0, max: 100, step: 0.1 },
      { id: 'hfoGeneration', label: 'Heavy Fuel Oil Generation %', type: 'number', required: true, min: 0, max: 100 },
      { id: 'lfoGeneration', label: 'Light Fuel Oil Generation %', type: 'number', required: true, min: 0, max: 100 },
      { id: 'solarGeneration', label: 'Solar Generation %', type: 'number', required: true, min: 0, max: 100 },
      { id: 'otherGeneration', label: 'Other Generation %', type: 'number', required: true, min: 0, max: 100 },
    ]
  },
  gcaa: {
    name: 'GCAA',
    fullName: 'Guyana Civil Aviation Authority',
    icon: Shield,
    color: 'from-violet-500 to-purple-600',
    fields: [
      { id: 'activeRegistrations', label: 'Active Aircraft Registrations', type: 'number', required: true, min: 0 },
      { id: 'inspectionsMTD', label: 'Inspections Completed (MTD)', type: 'number', required: true, min: 0 },
      { id: 'inspectionsTarget', label: 'Inspections Target', type: 'number', required: true, min: 0 },
      { id: 'complianceRate', label: 'Compliance Audit Rate %', type: 'number', required: true, min: 0, max: 100, step: 0.1 },
      { id: 'incidentReports', label: 'Incident Reports', type: 'number', required: true, min: 0 },
      { id: 'renewalsPending', label: 'License Renewals Pending', type: 'number', required: true, min: 0 },
      { id: 'auditNotes', label: 'Compliance Notes', type: 'textarea', required: false, placeholder: 'Any additional notes on compliance status...' },
    ]
  }
};

// Agency options for registration dropdown
const AGENCY_OPTIONS = [
  { value: 'cjia', label: 'CJIA - Cheddi Jagan International Airport' },
  { value: 'gwi', label: 'GWI - Guyana Water Inc.' },
  { value: 'gpl', label: 'GPL - Guyana Power & Light' },
  { value: 'gcaa', label: 'GCAA - Guyana Civil Aviation Authority' },
];

// Simulated pending user registrations storage
let PENDING_REGISTRATIONS = [];

// Function to send email notification for new registration
const sendRegistrationNotification = async (userData) => {
  const emailData = {
    to: 'alfonso.dearmas@mpua.gov.gy',
    subject: 'New Account Registration Pending Approval',
    body: `
      A new account registration requires your approval:

      Full Name: ${userData.fullName}
      Email: ${userData.email}
      Username: ${userData.username}
      Agency: ${AGENCY_OPTIONS.find(a => a.value === userData.agency)?.label || userData.agency}
      Registration Date: ${new Date().toLocaleString()}

      Please log in to the Admin Portal to approve or reject this registration.
    `
  };

  console.log('Sending email notification to alfonso.dearmas@mpua.gov.gy:', emailData);
  return true;
};

// Registration Screen Component
const RegistrationScreen = ({ onBack, onSuccess }) => {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    username: '',
    password: '',
    confirmPassword: '',
    agency: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const validateForm = () => {
    const newErrors = {};

    if (!formData.fullName.trim()) {
      newErrors.fullName = 'Full name is required';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'Email is required';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }

    if (!formData.username.trim()) {
      newErrors.username = 'Username is required';
    } else if (formData.username.length < 4) {
      newErrors.username = 'Username must be at least 4 characters';
    } else if (USERS[formData.username]) {
      newErrors.username = 'Username already exists';
    }

    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match';
    }

    if (!formData.agency) {
      newErrors.agency = 'Please select an agency';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);

    const registration = {
      id: Date.now().toString(36).toUpperCase(),
      fullName: formData.fullName,
      email: formData.email,
      username: formData.username,
      password: formData.password,
      agency: formData.agency,
      status: 'pending',
      registeredAt: new Date().toISOString(),
    };

    PENDING_REGISTRATIONS.push(registration);
    await sendRegistrationNotification(registration);
    await new Promise(resolve => setTimeout(resolve, 1500));

    setSubmitting(false);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0f1729] flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="bg-[#1a2438] border border-[#243049] rounded-2xl p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="text-emerald-400" size={32} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Registration Submitted</h2>
            <p className="text-[#94a3b8] mb-6">
              Your account registration has been submitted and is pending approval. You will receive an email at <span className="text-[#d4af37]">{formData.email}</span> once your account has been approved.
            </p>
            <div className="bg-[#0f1729] rounded-lg p-4 mb-6 text-left">
              <div className="flex items-center gap-2 text-amber-400 mb-2">
                <AlertCircle size={16} />
                <span className="text-sm font-medium">Pending Admin Approval</span>
              </div>
              <p className="text-[#94a3b8] text-sm">
                An administrator will review your registration request. This typically takes 1-2 business days.
              </p>
            </div>
            <button
              onClick={onBack}
              className="w-full py-3 bg-[#d4af37] hover:bg-[#e5c04a] text-[#0f1729] font-semibold rounded-lg transition-all duration-300"
            >
              Return to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1729] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#d4af37] mb-2">
            Ministry of Public Utilities and Aviation
          </h1>
          <p className="text-[#94a3b8]">Dashboard Administration Portal</p>
        </div>

        <div className="bg-[#1a2438] border border-[#243049] rounded-2xl p-8">
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-[#94a3b8] hover:text-white transition-colors mb-4"
          >
            <ArrowLeft size={18} />
            <span>Back to Login</span>
          </button>

          <div className="flex justify-center mb-6">
            <div className="p-4 rounded-full bg-[#d4af37]">
              <UserPlus className="text-[#0f1729]" size={32} />
            </div>
          </div>

          <h2 className="text-xl font-semibold text-white text-center mb-6">Create Account</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Full Name</label>
              <input
                type="text"
                value={formData.fullName}
                onChange={(e) => handleChange('fullName', e.target.value)}
                className={`w-full px-4 py-3 bg-[#0f1729] border rounded-lg text-white placeholder-[#64748b] focus:outline-none focus:border-[#d4af37] transition-colors ${errors.fullName ? 'border-red-500' : 'border-[#243049]'}`}
                placeholder="Enter your full name"
              />
              {errors.fullName && (
                <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                  <AlertCircle size={12} />
                  {errors.fullName}
                </p>
              )}
            </div>

            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Email Address</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                className={`w-full px-4 py-3 bg-[#0f1729] border rounded-lg text-white placeholder-[#64748b] focus:outline-none focus:border-[#d4af37] transition-colors ${errors.email ? 'border-red-500' : 'border-[#243049]'}`}
                placeholder="Enter your email"
              />
              {errors.email && (
                <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                  <AlertCircle size={12} />
                  {errors.email}
                </p>
              )}
            </div>

            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Username</label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => handleChange('username', e.target.value)}
                className={`w-full px-4 py-3 bg-[#0f1729] border rounded-lg text-white placeholder-[#64748b] focus:outline-none focus:border-[#d4af37] transition-colors ${errors.username ? 'border-red-500' : 'border-[#243049]'}`}
                placeholder="Choose a username"
              />
              {errors.username && (
                <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                  <AlertCircle size={12} />
                  {errors.username}
                </p>
              )}
            </div>

            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Agency</label>
              <select
                value={formData.agency}
                onChange={(e) => handleChange('agency', e.target.value)}
                className={`w-full px-4 py-3 bg-[#0f1729] border rounded-lg text-white focus:outline-none focus:border-[#d4af37] transition-colors ${errors.agency ? 'border-red-500' : 'border-[#243049]'} ${!formData.agency ? 'text-[#64748b]' : ''}`}
              >
                <option value="">Select your agency</option>
                {AGENCY_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {errors.agency && (
                <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                  <AlertCircle size={12} />
                  {errors.agency}
                </p>
              )}
            </div>

            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => handleChange('password', e.target.value)}
                  className={`w-full px-4 py-3 bg-[#0f1729] border rounded-lg text-white placeholder-[#64748b] focus:outline-none focus:border-[#d4af37] transition-colors pr-12 ${errors.password ? 'border-red-500' : 'border-[#243049]'}`}
                  placeholder="Create a password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {errors.password && (
                <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                  <AlertCircle size={12} />
                  {errors.password}
                </p>
              )}
            </div>

            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Confirm Password</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={(e) => handleChange('confirmPassword', e.target.value)}
                  className={`w-full px-4 py-3 bg-[#0f1729] border rounded-lg text-white placeholder-[#64748b] focus:outline-none focus:border-[#d4af37] transition-colors pr-12 ${errors.confirmPassword ? 'border-red-500' : 'border-[#243049]'}`}
                  placeholder="Confirm your password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-white transition-colors"
                >
                  {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                  <AlertCircle size={12} />
                  {errors.confirmPassword}
                </p>
              )}
            </div>

            <div className="bg-[#0f1729] rounded-lg p-4 mt-4">
              <div className="flex items-start gap-2">
                <Mail className="text-[#d4af37] mt-0.5" size={16} />
                <p className="text-[#94a3b8] text-xs">
                  An administrator will be notified of your registration request. You'll receive an email once your account is approved.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 bg-[#d4af37] hover:bg-[#e5c04a] text-[#0f1729] font-semibold rounded-lg transition-all duration-300 mt-6 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <div className="w-5 h-5 border-2 border-[#0f1729]/30 border-t-[#0f1729] rounded-full animate-spin" />
                  Creating Account...
                </>
              ) : (
                <>
                  <UserPlus size={18} />
                  Create Account
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

// Login Component
const LoginScreen = ({ onLogin, onRegister, error }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    onLogin(username, password);
  };

  return (
    <div className="min-h-screen bg-[#0f1729] flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#d4af37] mb-2">
            Ministry of Public Utilities and Aviation
          </h1>
          <p className="text-[#94a3b8]">Dashboard Administration Portal</p>
        </div>

        <div className="bg-[#1a2438] border border-[#243049] rounded-2xl p-8">
          <div className="flex justify-center mb-6">
            <div className="p-4 rounded-full bg-[#d4af37]">
              <User className="text-[#0f1729]" size={32} />
            </div>
          </div>

          <h2 className="text-xl font-semibold text-white text-center mb-6">Sign In</h2>

          {error && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 mb-4 flex items-center gap-2">
              <AlertCircle className="text-red-400" size={18} />
              <span className="text-red-300 text-sm">{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-[#0f1729] border border-[#243049] rounded-lg text-white placeholder-[#64748b] focus:outline-none focus:border-[#d4af37] transition-colors"
                placeholder="Enter your username"
                required
              />
            </div>

            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-[#0f1729] border border-[#243049] rounded-lg text-white placeholder-[#64748b] focus:outline-none focus:border-[#d4af37] transition-colors pr-12"
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748b] hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 bg-[#d4af37] hover:bg-[#e5c04a] text-[#0f1729] font-semibold rounded-lg transition-all duration-300 mt-6"
            >
              Sign In
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-[#243049]">
            <p className="text-[#94a3b8] text-sm text-center mb-3">Don't have an account?</p>
            <button
              onClick={onRegister}
              className="w-full py-3 bg-[#1a2438] hover:bg-[#243049] text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 border border-[#243049]"
            >
              <UserPlus size={18} />
              Create Account
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-[#243049]">
            <p className="text-[#64748b] text-xs text-center mb-3">Demo Credentials</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-[#0f1729] rounded p-2">
                <span className="text-[#64748b]">CJIA:</span>
                <span className="text-[#94a3b8] ml-1">cjia_admin</span>
              </div>
              <div className="bg-[#0f1729] rounded p-2">
                <span className="text-[#64748b]">GWI:</span>
                <span className="text-[#94a3b8] ml-1">gwi_admin</span>
              </div>
              <div className="bg-[#0f1729] rounded p-2">
                <span className="text-[#64748b]">GPL:</span>
                <span className="text-[#94a3b8] ml-1">gpl_admin</span>
              </div>
              <div className="bg-[#0f1729] rounded p-2">
                <span className="text-[#64748b]">GCAA:</span>
                <span className="text-[#94a3b8] ml-1">gcaa_admin</span>
              </div>
            </div>
            <p className="text-[#64748b] text-xs text-center mt-2">Password: [agency]2024</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// GPL DBIS Data Entry Form Component
const GPLDBISForm = ({ onSubmit, onCancel }) => {
  const [reportDate, setReportDate] = useState('');
  const [stationData, setStationData] = useState(() => {
    const initial = {};
    GPL_POWER_STATIONS.forEach(station => {
      initial[station.code] = { units: '', derated_mw: '', available_mw: '' };
    });
    return initial;
  });
  const [solarData, setSolarData] = useState({
    HAMPSHIRE: GPL_SOLAR_SITES[0].defaultCapacity,
    PROSPECT: GPL_SOLAR_SITES[1].defaultCapacity,
    TRAFALGAR: GPL_SOLAR_SITES[2].defaultCapacity,
  });
  const [peakDemand, setPeakDemand] = useState({
    eveningOnbars: '',
    eveningSuppressed: '',
    dayOnbars: '',
    daySuppressed: '',
  });
  const [operational, setOperational] = useState({
    activeOutages: 0,
    affectedCustomers: 0,
    avgRestorationTime: '',
    collectionRate: '',
  });
  const [generationMix, setGenerationMix] = useState({
    hfo: '',
    lfo: '',
    solar: '',
    other: '',
  });
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  // Calculate totals
  const totals = useMemo(() => {
    let fossilCapacity = 0;
    Object.values(stationData).forEach(station => {
      fossilCapacity += parseFloat(station.available_mw) || 0;
    });

    const renewableCapacity = (parseFloat(solarData.HAMPSHIRE) || 0) +
                              (parseFloat(solarData.PROSPECT) || 0) +
                              (parseFloat(solarData.TRAFALGAR) || 0);

    const totalDBIS = fossilCapacity + renewableCapacity;
    const eveningPeak = parseFloat(peakDemand.eveningOnbars) || 0;
    const generationAvail = fossilCapacity; // Simplified assumption

    const fleetAvailability = totalDBIS > 0 ? (fossilCapacity / totalDBIS) * 100 : 0;
    const reserveMargin = eveningPeak > 0 ? ((generationAvail - eveningPeak) / eveningPeak) * 100 : 0;

    return {
      fossilCapacity: fossilCapacity.toFixed(2),
      renewableCapacity: renewableCapacity.toFixed(2),
      totalDBIS: totalDBIS.toFixed(2),
      fleetAvailability: fleetAvailability.toFixed(1),
      reserveMargin: reserveMargin.toFixed(1),
      generationAvailability: fossilCapacity.toFixed(2),
    };
  }, [stationData, solarData, peakDemand]);

  const handleStationChange = (stationCode, field, value) => {
    setStationData(prev => ({
      ...prev,
      [stationCode]: {
        ...prev[stationCode],
        [field]: value
      }
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Basic validation
    const newErrors = {};
    if (!reportDate) newErrors.reportDate = 'Report date is required';

    // Check if at least one station has data
    const hasStationData = Object.values(stationData).some(s => s.available_mw);
    if (!hasStationData) newErrors.stationData = 'Enter data for at least one power station';

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSubmitting(true);

    const submissionData = {
      reportDate,
      stationData,
      hampshireSolarMwp: solarData.HAMPSHIRE,
      prospectSolarMwp: solarData.PROSPECT,
      trafalgarSolarMwp: solarData.TRAFALGAR,
      eveningPeakOnbars: peakDemand.eveningOnbars || null,
      eveningPeakSuppressed: peakDemand.eveningSuppressed || null,
      dayPeakOnbars: peakDemand.dayOnbars || null,
      dayPeakSuppressed: peakDemand.daySuppressed || null,
      generationAvailability: parseFloat(totals.generationAvailability),
      activeOutages: operational.activeOutages,
      affectedCustomers: operational.affectedCustomers,
      avgRestorationTime: operational.avgRestorationTime || null,
      collectionRate: operational.collectionRate || null,
      hfoGeneration: generationMix.hfo || null,
      lfoGeneration: generationMix.lfo || null,
      solarGeneration: generationMix.solar || null,
      otherGeneration: generationMix.other || null,
      notes,
    };

    await new Promise(resolve => setTimeout(resolve, 1500));
    onSubmit(submissionData);
    setSubmitting(false);
  };

  return (
    <div className="bg-[#1a2438] border border-[#243049] rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-600 p-6">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-white/20">
            <Zap className="text-white" size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">GPL DBIS Daily Report</h2>
            <p className="text-white/80">Demerara-Berbice Interconnected System</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-8">
        {/* Report Date */}
        <div>
          <label className="block text-[#94a3b8] text-sm mb-2">
            Report Date <span className="text-red-400">*</span>
          </label>
          <input
            type="date"
            value={reportDate}
            onChange={(e) => setReportDate(e.target.value)}
            className={`w-full max-w-xs px-4 py-3 bg-[#0f1729] border rounded-lg text-white focus:outline-none focus:border-[#d4af37] transition-colors ${errors.reportDate ? 'border-red-500' : 'border-[#243049]'}`}
          />
          {errors.reportDate && (
            <p className="text-red-400 text-xs mt-1">{errors.reportDate}</p>
          )}
        </div>

        {/* DBIS Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-[#d4af37]/10 border border-[#d4af37]/30 rounded-xl p-4">
            <p className="text-[#d4af37] text-xs font-medium mb-1">Total Fossil Capacity</p>
            <p className="text-2xl font-bold text-[#d4af37]">{totals.fossilCapacity} <span className="text-sm font-normal">MW</span></p>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
            <p className="text-emerald-400 text-xs font-medium mb-1">Renewable Capacity</p>
            <p className="text-2xl font-bold text-emerald-400">{totals.renewableCapacity} <span className="text-sm font-normal">MWp</span></p>
          </div>
          <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4">
            <p className="text-cyan-400 text-xs font-medium mb-1">Total DBIS Capacity</p>
            <p className="text-2xl font-bold text-cyan-400">{totals.totalDBIS} <span className="text-sm font-normal">MW</span></p>
          </div>
          <div className={`rounded-xl p-4 ${parseFloat(totals.reserveMargin) < 15 ? 'bg-red-500/10 border border-red-500/30' : 'bg-emerald-500/10 border border-emerald-500/30'}`}>
            <p className={`text-xs font-medium mb-1 ${parseFloat(totals.reserveMargin) < 15 ? 'text-red-400' : 'text-emerald-400'}`}>Reserve Margin</p>
            <p className={`text-2xl font-bold ${parseFloat(totals.reserveMargin) < 15 ? 'text-red-400' : 'text-emerald-400'}`}>{totals.reserveMargin}<span className="text-sm font-normal">%</span></p>
          </div>
        </div>

        {/* Power Stations Section */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Battery className="text-amber-400" size={20} />
            <h3 className="text-lg font-semibold text-white">Power Stations</h3>
          </div>
          {errors.stationData && (
            <p className="text-red-400 text-sm mb-4">{errors.stationData}</p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#243049]">
                  <th className="text-left text-[#94a3b8] text-sm font-medium py-3 px-2">Station</th>
                  <th className="text-center text-[#94a3b8] text-sm font-medium py-3 px-2">Units</th>
                  <th className="text-center text-[#94a3b8] text-sm font-medium py-3 px-2">Derated (MW)</th>
                  <th className="text-center text-[#94a3b8] text-sm font-medium py-3 px-2">Available (MW)</th>
                </tr>
              </thead>
              <tbody>
                {GPL_POWER_STATIONS.map((station, index) => (
                  <tr key={station.code} className={index % 2 === 0 ? 'bg-[#0f1729]/50' : ''}>
                    <td className="py-2 px-2">
                      <span className="text-white font-medium">{station.code}</span>
                      <span className="text-[#64748b] text-xs ml-2">{station.name}</span>
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        min="0"
                        value={stationData[station.code].units}
                        onChange={(e) => handleStationChange(station.code, 'units', e.target.value)}
                        className="w-20 px-2 py-1.5 bg-[#0f1729] border border-[#243049] rounded text-white text-center text-sm focus:outline-none focus:border-[#d4af37]"
                        placeholder="-"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={stationData[station.code].derated_mw}
                        onChange={(e) => handleStationChange(station.code, 'derated_mw', e.target.value)}
                        className="w-24 px-2 py-1.5 bg-[#0f1729] border border-[#243049] rounded text-white text-center text-sm focus:outline-none focus:border-[#d4af37]"
                        placeholder="-"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={stationData[station.code].available_mw}
                        onChange={(e) => handleStationChange(station.code, 'available_mw', e.target.value)}
                        className="w-24 px-2 py-1.5 bg-[#0f1729] border border-amber-500/50 rounded text-amber-400 text-center text-sm font-medium focus:outline-none focus:border-[#d4af37]"
                        placeholder="-"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#243049]">
                  <td colSpan="3" className="py-3 px-2 text-right text-[#94a3b8] font-medium">Total Fossil Fuel Capacity:</td>
                  <td className="py-3 px-2 text-center text-[#d4af37] font-bold text-lg">{totals.fossilCapacity} MW</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Solar Sites Section */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Sun className="text-emerald-400" size={20} />
            <h3 className="text-lg font-semibold text-white">Solar Sites (Renewable Capacity)</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {GPL_SOLAR_SITES.map(site => (
              <div key={site.code} className="bg-[#0f1729] border border-[#243049] rounded-lg p-4">
                <label className="block text-[#94a3b8] text-sm mb-2">{site.name}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={solarData[site.code]}
                    onChange={(e) => setSolarData(prev => ({ ...prev, [site.code]: e.target.value }))}
                    className="flex-1 px-3 py-2 bg-[#1a2438] border border-emerald-500/50 rounded text-emerald-400 text-center font-medium focus:outline-none focus:border-emerald-400"
                  />
                  <span className="text-[#94a3b8]">MWp</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-right">
            <span className="text-[#94a3b8]">Total Renewable: </span>
            <span className="text-emerald-400 font-bold">{totals.renewableCapacity} MWp</span>
          </div>
        </div>

        {/* Peak Demand Section */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="text-cyan-400" size={20} />
            <h3 className="text-lg font-semibold text-white">Peak Demand</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Evening Peak */}
            <div className="bg-[#0f1729] border border-[#243049] rounded-lg p-4">
              <h4 className="text-[#94a3b8] text-sm font-medium mb-3">Evening Peak</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-[#64748b] text-xs mb-1">On-Bars (MW)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={peakDemand.eveningOnbars}
                    onChange={(e) => setPeakDemand(prev => ({ ...prev, eveningOnbars: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#1a2438] border border-[#243049] rounded text-white focus:outline-none focus:border-[#d4af37]"
                    placeholder="Enter evening on-bars demand"
                  />
                </div>
                <div>
                  <label className="block text-[#64748b] text-xs mb-1">Suppressed (MW)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={peakDemand.eveningSuppressed}
                    onChange={(e) => setPeakDemand(prev => ({ ...prev, eveningSuppressed: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#1a2438] border border-[#243049] rounded text-white focus:outline-none focus:border-[#d4af37]"
                    placeholder="Enter evening suppressed demand"
                  />
                </div>
              </div>
            </div>

            {/* Day Peak */}
            <div className="bg-[#0f1729] border border-[#243049] rounded-lg p-4">
              <h4 className="text-[#94a3b8] text-sm font-medium mb-3">Day Peak</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-[#64748b] text-xs mb-1">On-Bars (MW)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={peakDemand.dayOnbars}
                    onChange={(e) => setPeakDemand(prev => ({ ...prev, dayOnbars: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#1a2438] border border-[#243049] rounded text-white focus:outline-none focus:border-[#d4af37]"
                    placeholder="Enter day on-bars demand"
                  />
                </div>
                <div>
                  <label className="block text-[#64748b] text-xs mb-1">Suppressed (MW)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={peakDemand.daySuppressed}
                    onChange={(e) => setPeakDemand(prev => ({ ...prev, daySuppressed: e.target.value }))}
                    className="w-full px-3 py-2 bg-[#1a2438] border border-[#243049] rounded text-white focus:outline-none focus:border-[#d4af37]"
                    placeholder="Enter day suppressed demand"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Operational Metrics Section */}
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">Operational Metrics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Active Outages</label>
              <input
                type="number"
                min="0"
                value={operational.activeOutages}
                onChange={(e) => setOperational(prev => ({ ...prev, activeOutages: parseInt(e.target.value) || 0 }))}
                className="w-full px-3 py-2 bg-[#0f1729] border border-[#243049] rounded text-white focus:outline-none focus:border-[#d4af37]"
              />
            </div>
            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Affected Customers</label>
              <input
                type="number"
                min="0"
                value={operational.affectedCustomers}
                onChange={(e) => setOperational(prev => ({ ...prev, affectedCustomers: parseInt(e.target.value) || 0 }))}
                className="w-full px-3 py-2 bg-[#0f1729] border border-[#243049] rounded text-white focus:outline-none focus:border-[#d4af37]"
              />
            </div>
            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Avg Restoration (hrs)</label>
              <input
                type="number"
                min="0"
                step="0.1"
                value={operational.avgRestorationTime}
                onChange={(e) => setOperational(prev => ({ ...prev, avgRestorationTime: e.target.value }))}
                className="w-full px-3 py-2 bg-[#0f1729] border border-[#243049] rounded text-white focus:outline-none focus:border-[#d4af37]"
                placeholder="-"
              />
            </div>
            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Collection Rate %</label>
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={operational.collectionRate}
                onChange={(e) => setOperational(prev => ({ ...prev, collectionRate: e.target.value }))}
                className="w-full px-3 py-2 bg-[#0f1729] border border-[#243049] rounded text-white focus:outline-none focus:border-[#d4af37]"
                placeholder="-"
              />
            </div>
          </div>
        </div>

        {/* Generation Mix Section */}
        <div>
          <h3 className="text-lg font-semibold text-white mb-4">Generation Mix (%)</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">HFO %</label>
              <input
                type="number"
                min="0"
                max="100"
                value={generationMix.hfo}
                onChange={(e) => setGenerationMix(prev => ({ ...prev, hfo: e.target.value }))}
                className="w-full px-3 py-2 bg-[#0f1729] border border-[#243049] rounded text-white focus:outline-none focus:border-[#d4af37]"
                placeholder="-"
              />
            </div>
            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">LFO %</label>
              <input
                type="number"
                min="0"
                max="100"
                value={generationMix.lfo}
                onChange={(e) => setGenerationMix(prev => ({ ...prev, lfo: e.target.value }))}
                className="w-full px-3 py-2 bg-[#0f1729] border border-[#243049] rounded text-white focus:outline-none focus:border-[#d4af37]"
                placeholder="-"
              />
            </div>
            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Solar %</label>
              <input
                type="number"
                min="0"
                max="100"
                value={generationMix.solar}
                onChange={(e) => setGenerationMix(prev => ({ ...prev, solar: e.target.value }))}
                className="w-full px-3 py-2 bg-[#0f1729] border border-[#243049] rounded text-white focus:outline-none focus:border-[#d4af37]"
                placeholder="-"
              />
            </div>
            <div>
              <label className="block text-[#94a3b8] text-sm mb-2">Other %</label>
              <input
                type="number"
                min="0"
                max="100"
                value={generationMix.other}
                onChange={(e) => setGenerationMix(prev => ({ ...prev, other: e.target.value }))}
                className="w-full px-3 py-2 bg-[#0f1729] border border-[#243049] rounded text-white focus:outline-none focus:border-[#d4af37]"
                placeholder="-"
              />
            </div>
          </div>
        </div>

        {/* Notes Section */}
        <div>
          <label className="block text-[#94a3b8] text-sm mb-2">Notes (Optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full px-4 py-3 bg-[#0f1729] border border-[#243049] rounded-lg text-white placeholder-[#64748b] focus:outline-none focus:border-[#d4af37]"
            placeholder="Any additional notes about today's DBIS report..."
          />
        </div>

        {/* Submit Buttons */}
        <div className="flex gap-4 pt-6 border-t border-[#243049]">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 bg-[#243049] hover:bg-[#2d3a52] text-white font-semibold rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 py-3 bg-[#d4af37] hover:bg-[#e5c04a] text-[#0f1729] font-semibold rounded-lg transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <div className="w-5 h-5 border-2 border-[#0f1729]/30 border-t-[#0f1729] rounded-full animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Save size={18} />
                Submit DBIS Report
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

// Standard Data Entry Form Component
const DataEntryForm = ({ agency, onSubmit, onCancel }) => {
  const config = AGENCIES[agency];
  const Icon = config.icon;
  const [formData, setFormData] = useState({});
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const getCalculatedValue = (field) => {
    if (field.type === 'calculated' && field.calculatedFrom) {
      const sum = field.calculatedFrom.reduce((acc, fieldId) => {
        return acc + (parseInt(formData[fieldId]) || 0);
      }, 0);
      return sum;
    }
    return formData[field.id] || '';
  };

  const handleChange = (fieldId, value) => {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
    if (errors[fieldId]) {
      setErrors(prev => ({ ...prev, [fieldId]: null }));
    }
  };

  const validateForm = () => {
    const newErrors = {};
    config.fields.forEach(field => {
      if (field.type === 'calculated') return;
      if (field.required && !formData[field.id] && formData[field.id] !== 0) {
        newErrors[field.id] = 'This field is required';
      }
      if (field.type === 'number' && formData[field.id] !== undefined) {
        const value = parseFloat(formData[field.id]);
        if (field.min !== undefined && value < field.min) {
          newErrors[field.id] = `Minimum value is ${field.min}`;
        }
        if (field.max !== undefined && value > field.max) {
          newErrors[field.id] = `Maximum value is ${field.max}`;
        }
      }
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    const submissionData = { ...formData };
    config.fields.forEach(field => {
      if (field.type === 'calculated') {
        submissionData[field.id] = getCalculatedValue(field);
      }
    });

    setSubmitting(true);
    await new Promise(resolve => setTimeout(resolve, 1500));
    onSubmit(submissionData);
    setSubmitting(false);
  };

  return (
    <div className="bg-[#1a2438] border border-[#243049] rounded-2xl overflow-hidden">
      <div className={`bg-gradient-to-r ${config.color} p-6`}>
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-xl bg-white/20">
            <Icon className="text-white" size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">{config.name}</h2>
            <p className="text-white/80">{config.fullName}</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6">
        <div className="flex items-center gap-2 mb-6 text-[#94a3b8]">
          <Calendar size={16} />
          <span className="text-sm">Data Entry for: {formData.entryDate ? new Date(formData.entryDate).toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Select a date'}</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {config.fields.map(field => (
            <div key={field.id} className={field.type === 'textarea' ? 'md:col-span-2' : ''}>
              <label className={`block text-sm mb-2 ${field.highlight ? 'text-[#d4af37] font-semibold' : 'text-[#94a3b8]'}`}>
                {field.label}
                {field.required && !field.readonly && <span className="text-red-400 ml-1">*</span>}
                {field.readonly && <span className="text-[#64748b] ml-1">(auto-calculated)</span>}
              </label>

              {field.type === 'textarea' ? (
                <textarea
                  value={formData[field.id] || ''}
                  onChange={(e) => handleChange(field.id, e.target.value)}
                  placeholder={field.placeholder}
                  rows={3}
                  className={`w-full px-4 py-3 bg-[#0f1729] border rounded-lg text-white placeholder-[#64748b] focus:outline-none focus:border-[#d4af37] transition-colors ${
                    errors[field.id] ? 'border-red-500' : 'border-[#243049]'
                  }`}
                />
              ) : field.type === 'calculated' ? (
                <input
                  type="number"
                  value={getCalculatedValue(field)}
                  readOnly
                  className="w-full px-4 py-3 bg-[#243049] border border-[#243049] rounded-lg text-[#d4af37] font-semibold cursor-not-allowed"
                />
              ) : field.type === 'date' ? (
                <input
                  type="date"
                  value={formData[field.id] || ''}
                  onChange={(e) => handleChange(field.id, e.target.value)}
                  className={`w-full px-4 py-3 bg-[#0f1729] border rounded-lg text-white focus:outline-none focus:border-[#d4af37] transition-colors ${
                    errors[field.id] ? 'border-red-500' : 'border-[#243049]'
                  }`}
                />
              ) : (
                <input
                  type={field.type}
                  value={formData[field.id] || ''}
                  onChange={(e) => handleChange(field.id, e.target.value)}
                  placeholder={field.placeholder}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  className={`w-full px-4 py-3 bg-[#0f1729] border rounded-lg text-white placeholder-[#64748b] focus:outline-none focus:border-[#d4af37] transition-colors ${
                    errors[field.id] ? 'border-red-500' : 'border-[#243049]'
                  } ${field.highlight ? 'border-[#d4af37]/50' : ''}`}
                />
              )}

              {errors[field.id] && (
                <p className="text-red-400 text-xs mt-1 flex items-center gap-1">
                  <AlertCircle size={12} />
                  {errors[field.id]}
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="flex gap-4 mt-8 pt-6 border-t border-[#243049]">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-3 bg-[#243049] hover:bg-[#2d3a52] text-white font-semibold rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 py-3 bg-[#d4af37] hover:bg-[#e5c04a] text-[#0f1729] font-semibold rounded-lg transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <div className="w-5 h-5 border-2 border-[#0f1729]/30 border-t-[#0f1729] rounded-full animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Save size={18} />
                Submit Data
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

// Success Modal
const SuccessModal = ({ agency, isDBIS, onClose }) => {
  const config = AGENCIES[agency];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-6">
      <div className="bg-[#1a2438] border border-[#243049] rounded-2xl p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="text-emerald-400" size={32} />
        </div>
        <h3 className="text-2xl font-bold text-white mb-2">
          {isDBIS ? 'DBIS Report Submitted' : 'Data Submitted Successfully'}
        </h3>
        <p className="text-[#94a3b8] mb-6">
          {isDBIS
            ? `GPL DBIS daily report for ${new Date().toLocaleDateString()} has been recorded.`
            : `${config.name} metrics for ${new Date().toLocaleDateString()} have been recorded and will be reflected in the dashboard.`
          }
        </p>
        <div className="bg-[#0f1729] rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between text-sm">
            <span className="text-[#94a3b8]">Submission Time</span>
            <span className="text-white">{new Date().toLocaleTimeString()}</span>
          </div>
          <div className="flex items-center justify-between text-sm mt-2">
            <span className="text-[#94a3b8]">Reference ID</span>
            <span className="text-[#d4af37] font-mono">{isDBIS ? 'DBIS' : agency.toUpperCase()}-{Date.now().toString(36).toUpperCase()}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-full py-3 bg-[#d4af37] hover:bg-[#e5c04a] text-[#0f1729] font-semibold rounded-lg transition-all duration-300"
        >
          Continue
        </button>
      </div>
    </div>
  );
};

// Submission History Component
const SubmissionHistory = ({ agency }) => {
  const history = [
    { date: '2024-01-25', time: '09:15 AM', user: 'Admin', status: 'success' },
    { date: '2024-01-24', time: '08:45 AM', user: 'Admin', status: 'success' },
    { date: '2024-01-23', time: '09:30 AM', user: 'Admin', status: 'success' },
    { date: '2024-01-22', time: '10:00 AM', user: 'Admin', status: 'success' },
    { date: '2024-01-21', time: '09:00 AM', user: 'Admin', status: 'success' },
  ];

  return (
    <div className="bg-[#1a2438] border border-[#243049] rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
        <History size={20} className="text-[#d4af37]" />
        Recent Submissions
      </h3>
      <div className="space-y-3">
        {history.map((item, i) => (
          <div key={i} className="flex items-center justify-between py-3 border-b border-[#243049] last:border-0">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <div>
                <p className="text-white text-sm">{item.date}</p>
                <p className="text-[#64748b] text-xs">{item.time} by {item.user}</p>
              </div>
            </div>
            <span className="text-emerald-400 text-xs font-medium bg-emerald-500/20 px-2 py-1 rounded">
              Submitted
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// Agency Selector for Ministry Admin
const AgencySelector = ({ selectedAgency, onSelect }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-3 px-4 py-3 bg-[#1a2438] border border-[#243049] rounded-lg text-white hover:border-[#d4af37] transition-colors w-full"
      >
        {selectedAgency ? (
          <>
            {React.createElement(AGENCIES[selectedAgency].icon, { size: 20, className: 'text-[#d4af37]' })}
            <span>{AGENCIES[selectedAgency].name} - {AGENCIES[selectedAgency].fullName}</span>
          </>
        ) : (
          <span className="text-[#64748b]">Select an agency to enter data...</span>
        )}
        <ChevronDown className={`ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`} size={20} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#1a2438] border border-[#243049] rounded-lg overflow-hidden z-10">
          {Object.entries(AGENCIES).map(([key, agency]) => (
            <button
              key={key}
              onClick={() => { onSelect(key); setIsOpen(false); }}
              className="flex items-center gap-3 px-4 py-3 w-full text-left hover:bg-[#243049] transition-colors"
            >
              <div className={`p-2 rounded-lg bg-gradient-to-br ${agency.color}`}>
                {React.createElement(agency.icon, { size: 16, className: 'text-white' })}
              </div>
              <div>
                <p className="text-white font-medium">{agency.name}</p>
                <p className="text-[#64748b] text-sm">{agency.fullName}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

// Main Admin Dashboard Component
export default function MinistryDashboardAdmin() {
  const [user, setUser] = useState(null);
  const [loginError, setLoginError] = useState('');
  const [selectedAgency, setSelectedAgency] = useState(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [submittedAgency, setSubmittedAgency] = useState(null);
  const [showRegistration, setShowRegistration] = useState(false);
  const [gplEntryMode, setGplEntryMode] = useState('excel'); // 'dbis', 'excel', or 'basic' - default to Excel upload

  const handleLogin = (username, password) => {
    const userRecord = USERS[username];
    if (userRecord && userRecord.password === password) {
      if (userRecord.status === 'pending') {
        setLoginError('Your account is pending approval. Please wait for an administrator to approve your registration.');
        return;
      }
      setUser({ username, ...userRecord });
      setLoginError('');
      if (userRecord.agency !== 'all') {
        setSelectedAgency(userRecord.agency);
      }
    } else {
      setLoginError('Invalid username or password');
    }
  };

  const handleLogout = () => {
    setUser(null);
    setSelectedAgency(null);
  };

  const handleSubmit = (data) => {
    console.log('Submitted data for', selectedAgency, ':', data);
    setSubmittedAgency(selectedAgency);
    setShowSuccess(true);
  };

  const handleSuccessClose = () => {
    setShowSuccess(false);
    if (user.agency === 'all') {
      setSelectedAgency(null);
    }
  };

  if (showRegistration) {
    return (
      <RegistrationScreen
        onBack={() => setShowRegistration(false)}
        onSuccess={() => setShowRegistration(false)}
      />
    );
  }

  if (!user) {
    return (
      <LoginScreen
        onLogin={handleLogin}
        onRegister={() => setShowRegistration(true)}
        error={loginError}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0f1729]">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        * { font-family: 'Plus Jakarta Sans', sans-serif; }
      `}</style>

      {/* Header */}
      <header className="bg-[#0f1729]/80 backdrop-blur-md border-b border-[#243049] sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-[#d4af37]">
                Ministry of Public Utilities and Aviation
              </h1>
              <p className="text-[#94a3b8] text-sm">Data Entry Administration</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-white font-medium">{user.name}</p>
                <p className="text-[#64748b] text-xs">{user.role}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-[#d4af37] flex items-center justify-center">
                <User className="text-[#0f1729]" size={20} />
              </div>
              <button
                onClick={handleLogout}
                className="p-2 rounded-lg bg-[#1a2438] hover:bg-[#243049] border border-[#243049] transition-colors"
                title="Sign Out"
              >
                <LogOut className="text-[#94a3b8]" size={20} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Welcome Banner */}
        <div className="bg-[#d4af37]/10 border border-[#d4af37]/30 rounded-2xl p-6 mb-8">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-[#d4af37]/20">
              <FileText className="text-[#d4af37]" size={24} />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white mb-1">Daily Data Entry Portal</h2>
              <p className="text-[#94a3b8]">
                Enter today's operational metrics for {user.agency === 'all' ? 'any agency' : AGENCIES[user.agency].fullName}.
                All submissions are timestamped and logged for audit purposes.
              </p>
            </div>
          </div>
        </div>

        {/* Agency Selector (for Ministry Admin only) */}
        {user.agency === 'all' && !selectedAgency && (
          <div className="mb-8">
            <label className="block text-[#94a3b8] text-sm mb-2">Select Agency</label>
            <AgencySelector selectedAgency={selectedAgency} onSelect={setSelectedAgency} />
          </div>
        )}

        {/* GPL Form Type Toggle */}
        {selectedAgency === 'gpl' && (
          <div className="mb-6">
            <div className="flex items-center gap-2 bg-[#1a2438] border border-[#243049] rounded-lg p-2 w-fit">
              <button
                onClick={() => setGplEntryMode('excel')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                  gplEntryMode === 'excel'
                    ? 'bg-[#d4af37] text-[#0f1729]'
                    : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                <Upload size={16} />
                Excel Upload
              </button>
              <button
                onClick={() => setGplEntryMode('dbis')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  gplEntryMode === 'dbis'
                    ? 'bg-[#d4af37] text-[#0f1729]'
                    : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                Manual Entry
              </button>
              <button
                onClick={() => setGplEntryMode('basic')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  gplEntryMode === 'basic'
                    ? 'bg-[#d4af37] text-[#0f1729]'
                    : 'text-[#94a3b8] hover:text-white'
                }`}
              >
                Basic
              </button>
            </div>
            {gplEntryMode === 'excel' && (
              <p className="text-sm text-[#94a3b8] mt-2">
                Upload the daily DBIS Excel file received via email
              </p>
            )}
          </div>
        )}

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Data Entry Form */}
          <div className="lg:col-span-2">
            {selectedAgency ? (
              selectedAgency === 'gpl' ? (
                gplEntryMode === 'excel' ? (
                  <GPLExcelUpload
                    onSuccess={(data) => {
                      console.log('Excel upload success:', data);
                      setSubmittedAgency('gpl');
                      setShowSuccess(true);
                    }}
                    onCancel={() => user.agency === 'all' ? setSelectedAgency(null) : null}
                  />
                ) : gplEntryMode === 'dbis' ? (
                  <GPLDBISForm
                    onSubmit={handleSubmit}
                    onCancel={() => user.agency === 'all' ? setSelectedAgency(null) : null}
                  />
                ) : (
                  <DataEntryForm
                    agency={selectedAgency}
                    onSubmit={handleSubmit}
                    onCancel={() => user.agency === 'all' ? setSelectedAgency(null) : null}
                  />
                )
              ) : (
                <DataEntryForm
                  agency={selectedAgency}
                  onSubmit={handleSubmit}
                  onCancel={() => user.agency === 'all' ? setSelectedAgency(null) : null}
                />
              )
            ) : (
              <div className="bg-[#1a2438] border border-[#243049] rounded-2xl p-12 text-center">
                <div className="w-16 h-16 rounded-full bg-[#243049] flex items-center justify-center mx-auto mb-4">
                  <FileText className="text-[#64748b]" size={32} />
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">No Agency Selected</h3>
                <p className="text-[#94a3b8]">Please select an agency from the dropdown above to begin entering data.</p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Current Date/Time */}
            <div className="bg-[#1a2438] border border-[#243049] rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <Clock className="text-[#d4af37]" size={20} />
                <h3 className="text-lg font-semibold text-white">Current Session</h3>
              </div>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-[#94a3b8]">Date</span>
                  <span className="text-white">{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#94a3b8]">Time</span>
                  <span className="text-white">{new Date().toLocaleTimeString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#94a3b8]">Logged in as</span>
                  <span className="text-[#d4af37]">{user.username}</span>
                </div>
              </div>
            </div>

            {/* Submission History */}
            {selectedAgency && <SubmissionHistory agency={selectedAgency} />}

            {/* Quick Tips */}
            <div className="bg-[#1a2438] border border-[#243049] rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Quick Tips</h3>
              <ul className="space-y-3 text-sm text-[#94a3b8]">
                <li className="flex items-start gap-2">
                  <span className="text-[#d4af37] mt-1">*</span>
                  Fields marked with * are required
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#d4af37] mt-1">*</span>
                  Submit data before 10:00 AM for same-day dashboard updates
                </li>
                {selectedAgency === 'gpl' && (
                  <>
                    <li className="flex items-start gap-2">
                      <span className="text-[#d4af37] mt-1">*</span>
                      <strong>Excel Upload:</strong> Drag and drop the daily DBIS email attachment
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-[#d4af37] mt-1">*</span>
                      Manual Entry for station-by-station data
                    </li>
                  </>
                )}
                <li className="flex items-start gap-2">
                  <span className="text-[#d4af37] mt-1">*</span>
                  Contact IT support for technical issues
                </li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#243049] mt-12">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <p className="text-[#64748b] text-sm text-center">
            Ministry of Public Utilities and Aviation - Data Entry Portal v2.0 - Government of Guyana
          </p>
        </div>
      </footer>

      {/* Success Modal */}
      {showSuccess && submittedAgency && (
        <SuccessModal
          agency={submittedAgency}
          isDBIS={submittedAgency === 'gpl' && useDBISForm}
          onClose={handleSuccessClose}
        />
      )}
    </div>
  );
}
