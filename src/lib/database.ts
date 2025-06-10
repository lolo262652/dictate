import { supabase } from './supabase';
import type { DictationSession } from './supabase';

export class DatabaseService {
  static async createSession(session: Partial<DictationSession>): Promise<DictationSession | null> {
    const { data, error } = await supabase
      .from('dictation_sessions')
      .insert([session])
      .select()
      .single();

    if (error) {
      console.error('Error creating session:', error);
      return null;
    }

    return data;
  }

  static async updateSession(id: string, updates: Partial<DictationSession>): Promise<DictationSession | null> {
    const { data, error } = await supabase
      .from('dictation_sessions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating session:', error);
      return null;
    }

    return data;
  }

  static async getSession(id: string): Promise<DictationSession | null> {
    const { data, error } = await supabase
      .from('dictation_sessions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching session:', error);
      return null;
    }

    return data;
  }

  static async getUserSessions(): Promise<DictationSession[]> {
    const { data, error } = await supabase
      .from('dictation_sessions')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching user sessions:', error);
      return [];
    }

    return data || [];
  }

  static async deleteSession(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('dictation_sessions')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting session:', error);
      return false;
    }

    return true;
  }
}