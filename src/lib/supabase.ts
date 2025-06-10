import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type DictationSession = {
  id: string;
  user_id: string;
  title: string;
  audio_file_path?: string;
  raw_transcription: string;
  summary: string;
  detailed_note: string;
  recording_duration: number;
  created_at: string;
  updated_at: string;
};