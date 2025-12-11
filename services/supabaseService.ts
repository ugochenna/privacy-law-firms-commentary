import { createClient } from '@supabase/supabase-js';
import { SavedReport, GeneratedReport } from '../types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not configured. Reports will not be saved.');
}

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const isSupabaseConfigured = () => !!supabase;

export const saveReport = async (
  report: GeneratedReport,
  name: string,
  startDate: string,
  endDate: string,
  selectedFirms: string[],
  selectedTopics: string[]
): Promise<SavedReport | null> => {
  if (!supabase) {
    console.error('Supabase not configured');
    return null;
  }

  const { data, error } = await supabase
    .from('reports')
    .insert({
      name,
      markdown_content: report.markdownContent,
      html_content: report.htmlContent,
      start_date: startDate,
      end_date: endDate,
      selected_firms: selectedFirms,
      selected_topics: selectedTopics
    })
    .select()
    .single();

  if (error) {
    console.error('Error saving report:', error);
    throw error;
  }

  return data;
};

export const getReports = async (): Promise<SavedReport[]> => {
  if (!supabase) {
    console.error('Supabase not configured');
    return [];
  }

  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching reports:', error);
    throw error;
  }

  return data || [];
};

export const getReportById = async (id: string): Promise<SavedReport | null> => {
  if (!supabase) {
    console.error('Supabase not configured');
    return null;
  }

  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching report:', error);
    throw error;
  }

  return data;
};

export const renameReport = async (id: string, newName: string): Promise<SavedReport | null> => {
  if (!supabase) {
    console.error('Supabase not configured');
    return null;
  }

  const { data, error } = await supabase
    .from('reports')
    .update({ name: newName, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error renaming report:', error);
    throw error;
  }

  return data;
};

export const deleteReport = async (id: string): Promise<boolean> => {
  if (!supabase) {
    console.error('Supabase not configured');
    return false;
  }

  const { error } = await supabase
    .from('reports')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting report:', error);
    throw error;
  }

  return true;
};
