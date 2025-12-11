import React, { useState, useEffect } from 'react';
import { FileText, Save, RefreshCw, Search, Download, FileSpreadsheet, ChevronDown, Check, FolderOpen } from 'lucide-react';
import { LEGAL_TOPICS, LAW_FIRMS } from './constants';
import { LawFirm, LegalAreaId, GeneratedReport, SavedReport } from './types';
import TopicCard from './components/TopicCard';
import { generateLegalReport } from './services/claudeService';
import { saveReport, isSupabaseConfigured } from './services/supabaseService';
import ReportsPanel from './components/ReportsPanel';
import SaveReportModal from './components/SaveReportModal';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function App() {
  // Default: Start = Nov 1, 2025, End = Today
  const [startDate, setStartDate] = useState<string>('2025-11-01');
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Date shortcut helper
  const setDateShortcut = (daysAgo: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - daysAgo);
    setStartDate(start.toISOString().split('T')[0]);
    setEndDate(end.toISOString().split('T')[0]);
  };
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([LegalAreaId.PRIVACY]); // Default one selected
  const [selectedFirms, setSelectedFirms] = useState<LawFirm[]>([]);
  const [isFirmDropdownOpen, setIsFirmDropdownOpen] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reports panel and save modal state
  const [isReportsPanelOpen, setIsReportsPanelOpen] = useState(false);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [currentReportId, setCurrentReportId] = useState<string | null>(null);

  const toggleTopic = (id: string) => {
    setSelectedTopicIds(prev => 
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  };

  const toggleFirm = (firm: LawFirm) => {
    setSelectedFirms(prev => {
      const exists = prev.find(f => f.name === firm.name);
      if (exists) {
        return prev.filter(f => f.name !== firm.name);
      } else {
        return [...prev, firm];
      }
    });
  };

  const handleSelectAllFirms = () => {
    if (selectedFirms.length === LAW_FIRMS.length) {
      setSelectedFirms([]);
    } else {
      setSelectedFirms([...LAW_FIRMS]);
    }
  };

  const handleReset = () => {
    setSelectedTopicIds([]);
    setSelectedFirms([]);
    setReport(null);
    setError(null);
    setCurrentReportId(null);
  };

  const handleIdentifyLaws = async () => {
    if (selectedFirms.length === 0) {
      setError("Please select at least one Law Firm.");
      return;
    }
    if (selectedTopicIds.length === 0) {
      setError("Please select at least one Legal Topic.");
      return;
    }

    setLoading(true);
    setError(null);
    setReport(null);
    setCurrentReportId(null);

    try {
      const selectedTopicsList = LEGAL_TOPICS.filter(t => selectedTopicIds.includes(t.id));
      const result = await generateLegalReport({
        startDate,
        endDate,
        selectedFirms,
        selectedTopics: selectedTopicsList
      });
      setReport(result);
    } catch (err: any) {
      setError("Failed to generate report. Please try again. " + (err.message || ""));
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadWord = () => {
    if (!report) return;
    const blob = new Blob(['\ufeff', report.htmlContent], {
      type: 'application/msword'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Legal_Report_${startDate}_${endDate}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getDefaultReportName = () => {
    const topicNames = selectedTopicIds.map(id =>
      LEGAL_TOPICS.find(t => t.id === id)?.label || id
    ).join(', ');
    return `${topicNames} Report - ${startDate} to ${endDate}`;
  };

  const handleSaveReport = async (name: string) => {
    if (!report || !isSupabaseConfigured()) return;

    setSavingReport(true);
    try {
      const savedReport = await saveReport(
        report,
        name,
        startDate,
        endDate,
        selectedFirms.map(f => f.name),
        selectedTopicIds
      );
      if (savedReport) {
        setCurrentReportId(savedReport.id);
        setIsSaveModalOpen(false);
      }
    } catch (err: any) {
      setError('Failed to save report: ' + (err.message || 'Unknown error'));
    } finally {
      setSavingReport(false);
    }
  };

  const handleSelectReport = (savedReport: SavedReport) => {
    setReport({
      markdownContent: savedReport.markdown_content,
      htmlContent: savedReport.html_content
    });
    setStartDate(savedReport.start_date);
    setEndDate(savedReport.end_date);
    setCurrentReportId(savedReport.id);
    setIsReportsPanelOpen(false);
  };

  // Close dropdown when clicking outside (simple implementation)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('#firm-dropdown') && !target.closest('#firm-selector-btn')) {
        setIsFirmDropdownOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  return (
    <div className="min-h-screen pb-20">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-fuchsia-600 p-2 rounded-lg">
              <FileText className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Law Firm Commentaries</h1>
              <p className="text-xs text-gray-500 hidden sm:block">Privacy | AI | Cybersecurity | Health Information</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Filters Section */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            {/* Date Range */}
            <div className="flex flex-col space-y-2">
              <label className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Date Range</label>
              <div className="flex items-center gap-2 border-2 border-gray-200 rounded-lg p-2 hover:border-gray-300 transition-colors bg-white">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="flex-1 outline-none bg-transparent text-gray-900 font-medium placeholder-gray-500"
                  style={{ colorScheme: 'light' }}
                />
                <span className="text-gray-500">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="flex-1 outline-none bg-transparent text-gray-900 font-medium placeholder-gray-500"
                  style={{ colorScheme: 'light' }}
                />
              </div>
              {/* Date Shortcuts */}
              <div className="flex flex-wrap gap-2 mt-2">
                <button
                  onClick={() => setDateShortcut(2)}
                  className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-fuchsia-100 hover:text-fuchsia-700 transition-colors"
                >
                  2 days ago
                </button>
                <button
                  onClick={() => setDateShortcut(3)}
                  className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-fuchsia-100 hover:text-fuchsia-700 transition-colors"
                >
                  3 days ago
                </button>
                <button
                  onClick={() => setDateShortcut(7)}
                  className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-fuchsia-100 hover:text-fuchsia-700 transition-colors"
                >
                  1 week ago
                </button>
                <button
                  onClick={() => setDateShortcut(30)}
                  className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-fuchsia-100 hover:text-fuchsia-700 transition-colors"
                >
                  1 month ago
                </button>
                <button
                  onClick={() => setDateShortcut(90)}
                  className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-fuchsia-100 hover:text-fuchsia-700 transition-colors"
                >
                  3 months ago
                </button>
              </div>
            </div>

            {/* Law Firms Dropdown */}
            <div className="flex flex-col space-y-2 relative">
              <label className="text-sm font-semibold text-gray-900 uppercase tracking-wide">Select Law Firms</label>
              <button 
                id="firm-selector-btn"
                onClick={() => setIsFirmDropdownOpen(!isFirmDropdownOpen)}
                className="flex items-center justify-between w-full border-2 border-gray-200 rounded-lg p-3 bg-white hover:border-gray-300 transition-colors text-left"
              >
                <span className="font-medium text-gray-900 truncate">
                  {selectedFirms.length > 0 ? `${selectedFirms.length} firms selected` : "Select Law Firms"}
                </span>
                <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${isFirmDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              
              {isFirmDropdownOpen && (
                <div id="firm-dropdown" className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-200 rounded-xl shadow-xl z-20 max-h-80 overflow-y-auto">
                  <div className="p-3 sticky top-0 bg-white border-b border-gray-100 flex items-center justify-between z-10 shadow-sm">
                     <div className="flex items-center gap-2">
                        <input 
                           type="checkbox"
                           id="select-all-firms"
                           checked={selectedFirms.length === LAW_FIRMS.length && LAW_FIRMS.length > 0}
                           onChange={handleSelectAllFirms}
                           className="w-4 h-4 text-fuchsia-600 rounded border-gray-300 focus:ring-fuchsia-500 cursor-pointer accent-fuchsia-600"
                        />
                        <label htmlFor="select-all-firms" className="text-sm font-semibold text-black cursor-pointer">Select All</label>
                     </div>
                     <button onClick={() => setSelectedFirms([])} className="text-xs text-gray-500 hover:text-red-600 hover:underline px-2">Clear</button>
                  </div>
                  {LAW_FIRMS.map((firm) => {
                    const isSelected = selectedFirms.some(f => f.name === firm.name);
                    return (
                      <div
                        key={firm.name}
                        onClick={() => toggleFirm(firm)}
                        className={`
                          flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-100 transition-colors border-b border-gray-100 last:border-0 bg-white
                        `}
                      >
                         <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => {}} // handled by parent onClick
                            className="w-4 h-4 text-fuchsia-600 rounded border-gray-300 focus:ring-fuchsia-500 pointer-events-none accent-fuchsia-600"
                        />
                        <div>
                          <p className="text-sm font-medium text-black">{firm.name}</p>
                          {firm.region && <p className="text-xs text-gray-500">{firm.region}</p>}
                        </div>
                      </div>
                    );
                  })}
                  {/* Done Button */}
                  <div className="sticky bottom-0 p-3 bg-white border-t border-gray-200 shadow-lg">
                    <button
                      onClick={() => setIsFirmDropdownOpen(false)}
                      className="w-full py-2 px-4 bg-fuchsia-600 text-white font-semibold rounded-lg hover:bg-fuchsia-700 transition-colors"
                    >
                      Done ({selectedFirms.length} selected)
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-4">
            <div className="h-px bg-gray-200 flex-1"></div>
            <span className="text-sm text-gray-400 font-medium uppercase tracking-wider">Select Legal Areas</span>
            <div className="h-px bg-gray-200 flex-1"></div>
        </div>

        {/* Legal Topics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {LEGAL_TOPICS.map(topic => (
            <TopicCard 
              key={topic.id}
              topic={topic}
              isSelected={selectedTopicIds.includes(topic.id)}
              onToggle={toggleTopic}
            />
          ))}
        </div>

        {/* Action Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setAutoSave(!autoSave)}
              className={`
                relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none
                ${autoSave ? 'bg-fuchsia-600' : 'bg-gray-200'}
              `}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autoSave ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <span className="text-sm font-medium text-fuchsia-700 flex items-center gap-1">
              {autoSave ? <Save className="w-4 h-4" /> : null}
              Auto-Save
            </span>
          </div>

          <div className="flex gap-4 w-full sm:w-auto">
             <button 
              onClick={handleReset}
              className="px-6 py-3 rounded-lg border-2 border-fuchsia-600 text-fuchsia-600 font-semibold hover:bg-fuchsia-50 transition-colors flex items-center gap-2 justify-center w-full sm:w-auto"
            >
              <RefreshCw className="w-5 h-5" />
              Reset
            </button>
            <button 
              onClick={handleIdentifyLaws}
              disabled={loading}
              className="px-8 py-3 rounded-lg bg-gray-500 hover:bg-gray-600 text-white font-semibold shadow-md transition-all transform active:scale-95 flex items-center gap-2 justify-center w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div>
                  Scanning...
                </>
              ) : (
                <>
                  <Search className="w-5 h-5" />
                  Find Commentaries
                </>
              )}
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Report / Dashboard Area */}
        <div className="bg-white rounded-2xl shadow-sm min-h-[400px] border border-gray-100 flex flex-col">
          {!report && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
              <div className="bg-gray-50 p-4 rounded-full mb-6">
                <FileText className="w-16 h-16 text-gray-300" />
              </div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Start Your Research</h2>
              <p className="text-gray-500 max-w-lg">
                Step 1: Select date range, law firms, and legal areas, then click "Identify Laws" to search.
                The AI will scan available commentaries and generate a structured report.
              </p>
            </div>
          )}

          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-6">
              <div className="animate-pulse flex space-x-4">
                 <div className="rounded-full bg-slate-200 h-10 w-10"></div>
                 <div className="flex-1 space-y-6 py-1">
                   <div className="h-2 bg-slate-200 rounded w-64"></div>
                   <div className="space-y-3">
                     <div className="grid grid-cols-3 gap-4">
                       <div className="h-2 bg-slate-200 rounded col-span-2"></div>
                       <div className="h-2 bg-slate-200 rounded col-span-1"></div>
                     </div>
                     <div className="h-2 bg-slate-200 rounded"></div>
                   </div>
                 </div>
              </div>
              <p className="text-gray-500 font-medium">Analyzing commentaries from selected firms...</p>
            </div>
          )}

          {report && (
            <div className="flex-1 p-8 sm:p-12 overflow-x-auto">
              <article className="prose prose-fuchsia max-w-none">
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({node, ...props}) => <h1 className="text-3xl font-bold text-purple-900 border-b pb-2 mb-6" {...props} />,
                    h2: ({node, ...props}) => <h2 className="text-2xl font-semibold text-purple-800 mt-8 mb-4" {...props} />,
                    h3: ({node, ...props}) => <h3 className="text-xl font-medium text-purple-700 mt-6 mb-3" {...props} />,
                    table: ({node, ...props}) => <div className="overflow-x-auto my-6"><table className="min-w-full divide-y divide-gray-200 border border-gray-200" {...props} /></div>,
                    thead: ({node, ...props}) => <thead className="bg-gray-50" {...props} />,
                    th: ({node, ...props}) => <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider" {...props} />,
                    td: ({node, ...props}) => <td className="px-6 py-4 whitespace-normal text-sm text-gray-600 border-t border-gray-100" {...props} />,
                    a: ({node, ...props}) => <a className="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer" {...props} />,
                  }}
                >
                  {report.markdownContent}
                </ReactMarkdown>
              </article>
            </div>
          )}
        </div>

      </main>

      {/* Footer Actions */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-4 py-4 z-40">
        <div className="max-w-7xl mx-auto flex flex-wrap justify-center sm:justify-between items-center gap-4">
          <button
            onClick={() => report && !currentReportId ? setIsSaveModalOpen(true) : null}
            disabled={!report || !!currentReportId}
            className={`flex items-center gap-2 px-6 py-2 rounded-lg border font-medium ${
              report && !currentReportId
                ? 'border-fuchsia-600 text-fuchsia-600 hover:bg-fuchsia-50'
                : 'border-gray-300 text-gray-400 cursor-not-allowed'
            }`}
          >
            <Save className="w-4 h-4" />
            {currentReportId ? 'Saved' : 'Save Report'}
          </button>

          <button
            onClick={() => setIsReportsPanelOpen(true)}
            className="flex items-center gap-2 px-6 py-2 rounded-lg border border-fuchsia-600 text-fuchsia-600 font-medium hover:bg-fuchsia-50"
          >
            <FolderOpen className="w-4 h-4" />
            My Reports
          </button>

          <div className="flex gap-4">
            <button 
              onClick={handleDownloadWord}
              disabled={!report}
              className={`
                flex items-center gap-2 px-6 py-2 rounded-lg border font-medium
                ${report 
                  ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100' 
                  : 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'}
              `}
            >
              <Download className="w-4 h-4" />
              Download Word
            </button>
            <button 
               disabled={!report}
               className={`
                flex items-center gap-2 px-6 py-2 rounded-lg border font-medium
                ${report 
                  ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100' 
                  : 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'}
              `}
            >
              <FileSpreadsheet className="w-4 h-4" />
              Download Excel
            </button>
          </div>
        </div>
      </div>

      {/* Reports Panel Modal */}
      <ReportsPanel
        isOpen={isReportsPanelOpen}
        onClose={() => setIsReportsPanelOpen(false)}
        onSelectReport={handleSelectReport}
      />

      {/* Save Report Modal */}
      <SaveReportModal
        isOpen={isSaveModalOpen}
        onClose={() => setIsSaveModalOpen(false)}
        onSave={handleSaveReport}
        defaultName={getDefaultReportName()}
        saving={savingReport}
      />
    </div>
  );
}

export default App;