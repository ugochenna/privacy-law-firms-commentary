import React, { useState, useEffect } from 'react';
import { X, FileText, Pencil, Trash2, Check, XCircle, Calendar, Building2 } from 'lucide-react';
import { SavedReport } from '../types';
import { getReports, renameReport, deleteReport, isSupabaseConfigured } from '../services/supabaseService';

interface ReportsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectReport: (report: SavedReport) => void;
}

const ReportsPanel: React.FC<ReportsPanelProps> = ({ isOpen, onClose, onSelectReport }) => {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadReports();
    }
  }, [isOpen]);

  const loadReports = async () => {
    if (!isSupabaseConfigured()) {
      setError('Supabase not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await getReports();
      setReports(data);
    } catch (err: any) {
      setError('Failed to load reports: ' + (err.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const handleStartRename = (report: SavedReport) => {
    setEditingId(report.id);
    setEditName(report.name);
  };

  const handleSaveRename = async (id: string) => {
    if (!editName.trim()) return;

    try {
      await renameReport(id, editName.trim());
      setReports(prev => prev.map(r =>
        r.id === id ? { ...r, name: editName.trim() } : r
      ));
      setEditingId(null);
      setEditName('');
    } catch (err: any) {
      setError('Failed to rename report: ' + (err.message || 'Unknown error'));
    }
  };

  const handleCancelRename = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteReport(id);
      setReports(prev => prev.filter(r => r.id !== id));
      setDeleteConfirmId(null);
    } catch (err: any) {
      setError('Failed to delete report: ' + (err.message || 'Unknown error'));
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="bg-fuchsia-100 p-2 rounded-lg">
              <FileText className="w-6 h-6 text-fuchsia-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Saved Reports</h2>
              <p className="text-sm text-gray-500">{reports.length} report{reports.length !== 1 ? 's' : ''} saved</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-6 h-6 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin h-8 w-8 border-2 border-fuchsia-600 border-t-transparent rounded-full"></div>
            </div>
          ) : reports.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="bg-gray-100 p-4 rounded-full mb-4">
                <FileText className="w-12 h-12 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-700">No Reports Yet</h3>
              <p className="text-gray-500 mt-1">Generate a report and save it to see it here.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {reports.map((report) => (
                <div
                  key={report.id}
                  className="bg-gray-50 border border-gray-200 rounded-xl p-4 hover:border-fuchsia-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      {editingId === report.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="flex-1 px-3 py-1.5 border-2 border-fuchsia-300 rounded-lg focus:outline-none focus:border-fuchsia-500"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveRename(report.id);
                              if (e.key === 'Escape') handleCancelRename();
                            }}
                          />
                          <button
                            onClick={() => handleSaveRename(report.id)}
                            className="p-1.5 bg-green-100 text-green-600 rounded-lg hover:bg-green-200"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={handleCancelRename}
                            className="p-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => onSelectReport(report)}
                          className="text-left w-full"
                        >
                          <h3 className="font-semibold text-gray-900 truncate hover:text-fuchsia-600 transition-colors">
                            {report.name}
                          </h3>
                        </button>
                      )}

                      <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-gray-500">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-4 h-4" />
                          {report.start_date} to {report.end_date}
                        </span>
                        <span className="flex items-center gap-1">
                          <Building2 className="w-4 h-4" />
                          {report.selected_firms.length} firm{report.selected_firms.length !== 1 ? 's' : ''}
                        </span>
                      </div>

                      <p className="text-xs text-gray-400 mt-2">
                        Created: {formatDate(report.created_at)}
                      </p>
                    </div>

                    <div className="flex items-center gap-1">
                      {deleteConfirmId === report.id ? (
                        <>
                          <button
                            onClick={() => handleDelete(report.id)}
                            className="px-3 py-1.5 bg-red-100 text-red-600 text-sm font-medium rounded-lg hover:bg-red-200"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="px-3 py-1.5 bg-gray-100 text-gray-600 text-sm font-medium rounded-lg hover:bg-gray-200"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleStartRename(report)}
                            className="p-2 text-gray-500 hover:bg-gray-200 rounded-lg transition-colors"
                            title="Rename"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(report.id)}
                            className="p-2 text-gray-500 hover:bg-red-100 hover:text-red-600 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportsPanel;
