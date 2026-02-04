import React, { useState, useCallback } from 'react';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, X, Send } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';

export default function GPLExcelUpload({ onSuccess, onCancel }) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Solar inputs (not in Excel, entered manually)
  const [solarData, setSolarData] = useState({
    hampshireSolarMwp: 0,
    prospectSolarMwp: 0,
    trafalgarSolarMwp: 0,
  });
  const [notes, setNotes] = useState('');

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.name.match(/\.(xlsx|xls)$/i)) {
      setFile(droppedFile);
      setError(null);
      setPreview(null);
    } else {
      setError('Please upload an Excel file (.xlsx or .xls)');
    }
  }, []);

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setPreview(null);
    }
  };

  const parseFile = async () => {
    if (!file) return;

    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE}/metrics/gpl/upload/preview`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });

      const result = await response.json();

      if (!result.success) {
        setError(result.error || 'Failed to parse file');
        return;
      }

      setPreview(result.data);
    } catch (err) {
      setError('Failed to upload file: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const submitData = async () => {
    if (!file || !preview) return;

    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('hampshireSolarMwp', solarData.hampshireSolarMwp);
    formData.append('prospectSolarMwp', solarData.prospectSolarMwp);
    formData.append('trafalgarSolarMwp', solarData.trafalgarSolarMwp);
    formData.append('notes', notes || `Uploaded from: ${file.name}`);

    try {
      const token = localStorage.getItem('authToken');
      const response = await fetch(`${API_BASE}/metrics/gpl/upload/submit`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      });

      const result = await response.json();

      if (!result.success) {
        setError(result.error || 'Failed to submit data');
        return;
      }

      if (onSuccess) {
        onSuccess(result.data);
      }
    } catch (err) {
      setError('Failed to submit: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setFile(null);
    setPreview(null);
    setError(null);
    setSolarData({ hampshireSolarMwp: 0, prospectSolarMwp: 0, trafalgarSolarMwp: 0 });
    setNotes('');
  };

  return (
    <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-amber-400" />
          Upload GPL DBIS Excel
        </h3>
        {onCancel && (
          <button onClick={onCancel} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg flex items-center gap-2 text-red-300">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!preview ? (
        <>
          {/* Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
              dragOver
                ? 'border-amber-400 bg-amber-400/10'
                : 'border-slate-600 hover:border-slate-500'
            }`}
          >
            <Upload className={`w-12 h-12 mx-auto mb-4 ${dragOver ? 'text-amber-400' : 'text-slate-500'}`} />
            <p className="text-slate-300 mb-2">
              {file ? file.name : 'Drag and drop your Excel file here'}
            </p>
            <p className="text-slate-500 text-sm mb-4">or</p>
            <label className="inline-block px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-medium rounded-lg cursor-pointer transition-colors">
              Browse Files
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
            {file && (
              <p className="mt-4 text-sm text-slate-400">
                Selected: {file.name} ({(file.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>

          {/* Parse Button */}
          {file && (
            <button
              onClick={parseFile}
              disabled={loading}
              className="mt-4 w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-slate-600 text-black font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Parsing...
                </>
              ) : (
                <>
                  <FileSpreadsheet className="w-5 h-5" />
                  Parse Excel File
                </>
              )}
            </button>
          )}
        </>
      ) : (
        <>
          {/* Preview Section */}
          <div className="space-y-4">
            {/* Report Date */}
            <div className="p-4 bg-slate-700/50 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Report Date</span>
                <span className="text-white font-semibold">{preview.reportDate}</span>
              </div>
            </div>

            {/* Station Summary */}
            <div className="p-4 bg-slate-700/50 rounded-lg">
              <h4 className="text-sm font-medium text-slate-400 mb-3">Station Data</h4>
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                {Object.entries(preview.stationData).map(([code, data]) => (
                  <div key={code} className="flex items-center justify-between p-2 bg-slate-800 rounded">
                    <span className="text-slate-300 text-sm">{code}</span>
                    <span className="text-amber-400 font-medium">{data.available_mw} MW</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-amber-500/20 rounded-lg">
                <div className="text-slate-400 text-sm">Total Available</div>
                <div className="text-2xl font-bold text-amber-400">
                  {preview.meta.calculatedTotalMW} MW
                </div>
              </div>
              <div className="p-4 bg-slate-700/50 rounded-lg">
                <div className="text-slate-400 text-sm">Expected Peak</div>
                <div className="text-2xl font-bold text-white">
                  {preview.summaries.expectedPeakDemand || '—'} MW
                </div>
              </div>
            </div>

            {/* Solar Data (manual entry) */}
            <div className="p-4 bg-slate-700/50 rounded-lg">
              <h4 className="text-sm font-medium text-slate-400 mb-3">Solar Capacity (MWp)</h4>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: 'hampshireSolarMwp', label: 'Hampshire' },
                  { key: 'prospectSolarMwp', label: 'Prospect' },
                  { key: 'trafalgarSolarMwp', label: 'Trafalgar' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="text-xs text-slate-400">{label}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={solarData[key]}
                      onChange={(e) => setSolarData(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                      className="w-full mt-1 px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="text-sm text-slate-400">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any additional notes..."
                className="w-full mt-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded text-white text-sm resize-none"
                rows={2}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={reset}
                className="flex-1 py-3 bg-slate-700 hover:bg-slate-600 text-white font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitData}
                disabled={submitting}
                className="flex-1 py-3 bg-green-500 hover:bg-green-600 disabled:bg-slate-600 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Submit Data
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
