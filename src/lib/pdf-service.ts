import { supabase } from './supabase';
import type { PdfDocument } from './supabase';

export class PdfService {
  static async uploadPdfFile(file: File, userId: string, sessionId?: string): Promise<string | null> {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${file.name}`;
    const filePath = `${userId}/${fileName}`;

    const { data, error } = await supabase.storage
      .from('pdf-documents')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      console.error('Error uploading PDF file:', error);
      return null;
    }

    return data.path;
  }

  static async getPdfFileUrl(filePath: string): Promise<string | null> {
    const { data } = await supabase.storage
      .from('pdf-documents')
      .createSignedUrl(filePath, 3600); // 1 hour expiry

    return data?.signedUrl || null;
  }

  static async deletePdfFile(filePath: string): Promise<boolean> {
    const { error } = await supabase.storage
      .from('pdf-documents')
      .remove([filePath]);

    if (error) {
      console.error('Error deleting PDF file:', error);
      return false;
    }

    return true;
  }

  static async createPdfDocument(document: Partial<PdfDocument>): Promise<PdfDocument | null> {
    const { data, error } = await supabase
      .from('pdf_documents')
      .insert([document])
      .select()
      .single();

    if (error) {
      console.error('Error creating PDF document:', error);
      return null;
    }

    return data;
  }

  static async updatePdfDocument(id: string, updates: Partial<PdfDocument>): Promise<PdfDocument | null> {
    const { data, error } = await supabase
      .from('pdf_documents')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating PDF document:', error);
      return null;
    }

    return data;
  }

  static async getPdfDocument(id: string): Promise<PdfDocument | null> {
    const { data, error } = await supabase
      .from('pdf_documents')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching PDF document:', error);
      return null;
    }

    return data;
  }

  static async getUserPdfDocuments(): Promise<PdfDocument[]> {
    const { data, error } = await supabase
      .from('pdf_documents')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching user PDF documents:', error);
      return [];
    }

    return data || [];
  }

  static async getSessionPdfDocuments(sessionId: string): Promise<PdfDocument[]> {
    const { data, error } = await supabase
      .from('pdf_documents')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching session PDF documents:', error);
      return [];
    }

    return data || [];
  }

  static async deletePdfDocument(id: string): Promise<boolean> {
    // First get the document to get the file path
    const document = await this.getPdfDocument(id);
    if (!document) return false;

    // Delete the file from storage
    await this.deletePdfFile(document.file_path);

    // Delete the database record
    const { error } = await supabase
      .from('pdf_documents')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting PDF document:', error);
      return false;
    }

    return true;
  }

  static async extractTextFromPdf(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async function(e) {
        try {
          const typedarray = new Uint8Array(e.target?.result as ArrayBuffer);
          const pdf = await (window as any).pdfjsLib.getDocument(typedarray).promise;
          let fullText = '';

          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n\n';
          }

          resolve(fullText.trim());
        } catch (error) {
          console.error('Error extracting text from PDF:', error);
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
}