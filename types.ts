export interface LawFirm {
  name: string;
  url: string;
  region?: string;
  category?: string; // For grouping (e.g., "Large Firms", "Mid-Tier", "Boutique")
  specialty?: string[]; // Areas of specialty (e.g., ["patient_support", "privacy"])
}

export interface Topic {
  id: string;
  label: string;
  icon: string; // Name of the Lucide icon
}

export type SearchProvider = 'serper' | 'tavily';

export interface ReportConfig {
  startDate: string;
  endDate: string;
  selectedFirms: LawFirm[];
  selectedTopics: Topic[];
  searchProvider: SearchProvider;
}

export interface GeneratedReport {
  htmlContent: string;
  markdownContent: string;
}

export enum LegalAreaId {
  PRIVACY = 'privacy',
  AI = 'ai',
  CYBERSECURITY = 'cybersecurity',
  HEALTH_INFO = 'health_info',
  PATIENT_SUPPORT = 'patient_support',
  CONSENT_TRACKING = 'consent_tracking'
}

export interface SavedReport {
  id: string;
  name: string;
  markdown_content: string;
  html_content: string;
  start_date: string;
  end_date: string;
  selected_firms: string[];
  selected_topics: string[];
  created_at: string;
  updated_at: string;
}