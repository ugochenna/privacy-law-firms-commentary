export interface LawFirm {
  name: string;
  url: string;
  region?: string;
}

export interface Topic {
  id: string;
  label: string;
  icon: string; // Name of the Lucide icon
}

export interface ReportConfig {
  startDate: string;
  endDate: string;
  selectedFirms: LawFirm[];
  selectedTopics: Topic[];
}

export interface GeneratedReport {
  htmlContent: string;
  markdownContent: string;
}

export enum LegalAreaId {
  PRIVACY = 'privacy',
  AI = 'ai',
  CYBERSECURITY = 'cybersecurity',
  HEALTH_INFO = 'health_info'
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