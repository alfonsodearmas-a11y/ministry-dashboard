// API Service - Production client for Ministry Dashboard
const API_BASE_URL = process.env.REACT_APP_API_URL || '/api/v1';

class ApiService {
  constructor() {
    this.token = localStorage.getItem('authToken');
  }

  setToken(token) {
    this.token = token;
    token ? localStorage.setItem('authToken', token) : localStorage.removeItem('authToken');
  }

  getToken() {
    return this.token || localStorage.getItem('authToken');
  }

  async request(endpoint, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this.getToken()) headers['Authorization'] = `Bearer ${this.getToken()}`;

    const response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
    
    if (response.status === 401) {
      this.setToken(null);
      window.location.href = '/login';
      throw new Error('Session expired');
    }

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // Auth
  async login(username, password) {
    const data = await this.request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    this.setToken(data.token);
    return data;
  }

  async logout() {
    try { await this.request('/auth/logout', { method: 'POST' }); } finally { this.setToken(null); }
  }

  async getProfile() { return this.request('/auth/profile'); }
  
  async changePassword(currentPassword, newPassword) {
    return this.request('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
  }

  // Dashboard
  async getDashboardMetrics() { return this.request('/dashboard/metrics'); }
  async getTrendData(agency, days = 7) { return this.request(`/dashboard/trends/${agency}/${days}`); }

  // Metrics Submission
  async submitCJIAMetrics(data) { return this.request('/metrics/cjia', { method: 'POST', body: JSON.stringify(data) }); }
  async submitGWIMetrics(data) { return this.request('/metrics/gwi', { method: 'POST', body: JSON.stringify(data) }); }
  async submitGPLMetrics(data) { return this.request('/metrics/gpl', { method: 'POST', body: JSON.stringify(data) }); }
  async submitGCAAMetrics(data) { return this.request('/metrics/gcaa', { method: 'POST', body: JSON.stringify(data) }); }
  
  async getSubmissionHistory(agency, limit = 30, offset = 0) {
    return this.request(`/metrics/${agency}/history?limit=${limit}&offset=${offset}`);
  }
  
  async updateMetricStatus(agency, id, status) {
    return this.request(`/metrics/${agency}/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
  }

  // Admin
  async getUsers() { return this.request('/admin/users'); }
  async getAuditLogs(filters = {}) { return this.request(`/admin/audit-logs?${new URLSearchParams(filters)}`); }
  async getAgencies() { return this.request('/agencies'); }
}

export const api = new ApiService();
export default api;
