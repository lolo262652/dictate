import { AuthService } from './src/lib/auth';
import { DatabaseService } from './src/lib/database';
import { StorageService } from './src/lib/storage';
import { PdfService } from './src/lib/pdf-service';
import { AuthModal } from './src/components/AuthModal';
import { SessionsList } from './src/components/SessionsList';
import { PdfList } from './src/components/PdfList';
import { TranscriptionProgress } from './src/components/TranscriptionProgress';
import type { DictationSession, PdfDocument } from './src/lib/supabase';
import type { User } from '@supabase/supabase-js';

// Import existing functionality
import { GoogleGenerativeAI } from '@google/generative-ai';
import { marked } from 'marked';
import JSZip from 'jszip';

class DictationApp {
  private currentUser: User | null = null;
  private currentSession: DictationSession | null = null;
  private authModal: AuthModal;
  private sessionsList: SessionsList;
  private pdfList: PdfList;
  private transcriptionProgress: TranscriptionProgress;
  private isRecording = false;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private recordingStartTime = 0;
  private recordingDuration = 30 * 60; // 30 minutes default
  private recordingTimer: number | null = null;
  private liveWaveformCanvas: HTMLCanvasElement | null = null;
  private liveWaveformContext: CanvasRenderingContext2D | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animationId: number | null = null;
  private currentAudioBlob: Blob | null = null;
  private audioPlayer: HTMLAudioElement | null = null;
  private playbackTimer: number | null = null;
  private isProcessing = false;

  constructor() {
    this.authModal = new AuthModal();
    this.sessionsList = new SessionsList(this.loadSession.bind(this));
    this.pdfList = new PdfList();
    this.transcriptionProgress = new TranscriptionProgress();
    this.initializeApp();
  }

  private async initializeApp() {
    // Check authentication state
    AuthService.onAuthStateChange((user) => {
      this.currentUser = user;
      if (user) {
        this.authModal.hide();
        this.showMainApp();
        this.sessionsList.loadSessions();
        this.pdfList.loadDocuments();
        this.updatePdfPreviewButton();
      } else {
        this.authModal.show();
        this.hideMainApp();
      }
    });

    // Check if user is already authenticated
    const user = await AuthService.getCurrentUser();
    if (user) {
      this.currentUser = user;
      this.showMainApp();
      this.sessionsList.loadSessions();
      this.pdfList.loadDocuments();
      this.updatePdfPreviewButton();
    } else {
      this.authModal.show();
    }

    this.setupEventListeners();
    this.setupTabNavigation();
    this.setupAudioPlayer();
    this.setupSearchIntegration();
  }

  private setupSearchIntegration() {
    // Get the search input from the sessions list
    const sessionsElement = this.sessionsList.getElement();
    const searchInput = sessionsElement.querySelector('#sessionSearchInput') as HTMLInputElement;
    
    if (searchInput) {
      // Listen for search input changes and apply to PDF list as well
      searchInput.addEventListener('input', (e) => {
        const searchTerm = (e.target as HTMLInputElement).value;
        this.pdfList.filterDocuments(searchTerm);
      });

      // Also listen for clear button
      const clearBtn = sessionsElement.querySelector('#searchClearBtn') as HTMLButtonElement;
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          this.pdfList.filterDocuments('');
        });
      }
    }
  }

  private showMainApp() {
    const mainApp = document.getElementById('mainApp') as HTMLElement;
    mainApp.style.display = 'flex';
    
    // Add sessions list
    document.body.appendChild(this.sessionsList.getElement());
    
    // Add PDF list to sessions list
    const sessionsContent = this.sessionsList.getElement().querySelector('.sessions-content') as HTMLElement;
    sessionsContent.appendChild(this.pdfList.getElement());
    
    setTimeout(() => {
      mainApp.classList.add('app-entrance');
    }, 100);
  }

  private hideMainApp() {
    const mainApp = document.getElementById('mainApp') as HTMLElement;
    mainApp.style.display = 'none';
    mainApp.classList.remove('app-entrance');
    const sessionsList = this.sessionsList.getElement();
    if (sessionsList.parentNode) {
      sessionsList.parentNode.removeChild(sessionsList);
    }
  }

  private async loadSession(session: DictationSession) {
    this.currentSession = session;
    
    // Update UI with session data
    const titleElement = document.querySelector('.editor-title') as HTMLElement;
    const summaryEditor = document.getElementById('summaryEditor') as HTMLElement;
    const polishedNote = document.getElementById('polishedNote') as HTMLElement;
    const rawTranscription = document.getElementById('rawTranscription') as HTMLElement;

    titleElement.textContent = session.title;
    summaryEditor.innerHTML = session.summary || '';
    polishedNote.innerHTML = session.detailed_note || '';
    rawTranscription.innerHTML = session.raw_transcription || '';

    // Show play button if audio exists
    const playButton = document.getElementById('playRecordingButton') as HTMLButtonElement;
    if (session.audio_file_path) {
      playButton.style.display = 'flex';
    } else {
      playButton.style.display = 'none';
    }

    // Update placeholders
    this.updatePlaceholders();
  }

  private async saveCurrentSession() {
    if (!this.currentUser || !this.currentSession) return;

    const titleElement = document.querySelector('.editor-title') as HTMLElement;
    const summaryEditor = document.getElementById('summaryEditor') as HTMLElement;
    const polishedNote = document.getElementById('polishedNote') as HTMLElement;
    const rawTranscription = document.getElementById('rawTranscription') as HTMLElement;

    const updates: Partial<DictationSession> = {
      title: titleElement.textContent || 'Untitled Note',
      summary: summaryEditor.innerHTML,
      detailed_note: polishedNote.innerHTML,
      raw_transcription: rawTranscription.innerHTML
    };

    const updatedSession = await DatabaseService.updateSession(this.currentSession.id, updates);
    if (updatedSession) {
      this.currentSession = updatedSession;
    }
  }

  private async createNewSession(): Promise<DictationSession | null> {
    if (!this.currentUser) return null;

    // Generate title with current date
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    const timeStr = now.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    });
    const defaultTitle = `Enregistrement du ${dateStr} à ${timeStr}`;

    const session: Partial<DictationSession> = {
      user_id: this.currentUser.id,
      title: defaultTitle,
      raw_transcription: '',
      summary: '',
      detailed_note: '',
      recording_duration: 0
    };

    const newSession = await DatabaseService.createSession(session);
    if (newSession) {
      this.currentSession = newSession;
      this.sessionsList.loadSessions();
      
      // Update the title in the UI
      const titleElement = document.querySelector('.editor-title') as HTMLElement;
      titleElement.textContent = defaultTitle;
    }
    return newSession;
  }

  private async generateSessionTitle(transcription: string): Promise<string> {
    try {
      // Get API key from environment variables
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        // Fallback to date-based title if no API key
        const now = new Date();
        const dateStr = now.toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        });
        return `Enregistrement du ${dateStr}`;
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const result = await model.generateContent([
        `Crée un titre court et descriptif (maximum 60 caractères) pour cet enregistrement en français. Le titre doit résumer le contenu principal en une phrase courte et claire. Ne pas inclure de guillemets ou de ponctuation finale.

Texte de l'enregistrement:
${transcription.substring(0, 1000)}...`
      ]);

      let generatedTitle = result.response.text().trim();
      
      // Remove quotes if present
      generatedTitle = generatedTitle.replace(/^["']|["']$/g, '');
      
      // Limit length
      if (generatedTitle.length > 60) {
        generatedTitle = generatedTitle.substring(0, 57) + '...';
      }

      // Add date
      const now = new Date();
      const dateStr = now.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit'
      });
      
      return `${generatedTitle} (${dateStr})`;

    } catch (error) {
      console.error('Error generating title:', error);
      // Fallback to date-based title
      const now = new Date();
      const dateStr = now.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
      return `Enregistrement du ${dateStr}`;
    }
  }

  private setupEventListeners() {
    // Logout button
    const logoutButton = document.getElementById('logoutButton') as HTMLButtonElement;
    logoutButton.addEventListener('click', async () => {
      await AuthService.signOut();
    });

    // New button
    const newButton = document.getElementById('newButton') as HTMLButtonElement;
    newButton.addEventListener('click', async () => {
      await this.createNewSession();
      this.clearAllContent();
    });

    // Play recording button
    const playRecordingButton = document.getElementById('playRecordingButton') as HTMLButtonElement;
    playRecordingButton.addEventListener('click', async () => {
      await this.playCurrentRecording();
    });

    // PDF Preview button
    const previewPdfButton = document.getElementById('previewPdfButton') as HTMLButtonElement;
    previewPdfButton.addEventListener('click', () => {
      this.showPdfPreviewModal();
    });

    // Auto-save on content changes
    const titleElement = document.querySelector('.editor-title') as HTMLElement;
    const summaryEditor = document.getElementById('summaryEditor') as HTMLElement;
    const polishedNote = document.getElementById('polishedNote') as HTMLElement;
    const rawTranscription = document.getElementById('rawTranscription') as HTMLElement;

    [titleElement, summaryEditor, polishedNote, rawTranscription].forEach(element => {
      element.addEventListener('input', () => {
        if (this.currentSession) {
          this.saveCurrentSession();
        }
      });
    });

    // Recording functionality
    this.setupRecordingControls();
    
    // Theme toggle
    this.setupThemeToggle();
    
    // File uploads
    this.setupFileUploads();
    
    // Copy and save buttons
    this.setupCopyAndSaveButtons();
  }

  private async updatePdfPreviewButton() {
    const previewButton = document.getElementById('previewPdfButton') as HTMLButtonElement;
    
    if (!this.currentUser) {
      previewButton.style.display = 'none';
      return;
    }

    // Check if user has any PDFs
    const documents = await PdfService.getUserPdfDocuments();
    if (documents.length > 0) {
      previewButton.style.display = 'flex';
    } else {
      previewButton.style.display = 'none';
    }
  }

  private showPdfPreviewModal() {
    // Create a modal to show PDF list
    const modal = document.createElement('div');
    modal.className = 'pdf-viewer-modal pdf-viewer-visible';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="pdf-viewer-overlay"></div>
      <div class="pdf-viewer-content">
        <div class="pdf-viewer-header">
          <h3>Mes Documents PDF</h3>
          <div class="pdf-viewer-controls">
            <button class="action-button" id="closePdfListModal" title="Fermer">
              <i class="fas fa-times"></i>
            </button>
          </div>
        </div>
        <div class="pdf-viewer-body">
          <div id="pdfListModalContent" style="width: 100%; padding: 20px; overflow-y: auto;">
            <div class="loading">Chargement des documents...</div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close button functionality
    const closeBtn = modal.querySelector('#closePdfListModal') as HTMLButtonElement;
    const overlay = modal.querySelector('.pdf-viewer-overlay') as HTMLElement;
    
    const closeModal = () => {
      modal.classList.remove('pdf-viewer-visible');
      setTimeout(() => {
        if (modal.parentNode) {
          modal.parentNode.removeChild(modal);
        }
      }, 300);
    };

    closeBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', closeModal);

    // Load PDF documents
    this.loadPdfDocumentsInModal(modal);
  }

  private async loadPdfDocumentsInModal(modal: HTMLElement) {
    const content = modal.querySelector('#pdfListModalContent') as HTMLElement;
    
    try {
      const documents = await PdfService.getUserPdfDocuments();
      
      if (documents.length === 0) {
        content.innerHTML = `
          <div style="text-align: center; color: var(--color-text-secondary); padding: 40px;">
            <i class="fas fa-file-pdf" style="font-size: 48px; margin-bottom: 16px; opacity: 0.5;"></i>
            <p>Aucun document PDF trouvé</p>
            <p style="font-size: 14px; margin-top: 8px;">Utilisez le bouton de téléversement PDF pour ajouter des documents.</p>
          </div>
        `;
        return;
      }

      content.innerHTML = documents.map(doc => `
        <div class="pdf-item" style="margin-bottom: 12px; cursor: pointer;" data-pdf-id="${doc.id}">
          <div class="pdf-item-icon">
            <i class="fas fa-file-pdf"></i>
          </div>
          <div class="pdf-item-info" style="flex: 1;">
            <h5 class="pdf-item-title">${doc.title}</h5>
            <div class="pdf-item-meta">
              <span class="pdf-item-date">${new Date(doc.created_at).toLocaleDateString('fr-FR')}</span>
              <span class="pdf-item-size">${this.formatFileSize(doc.file_size)}</span>
              <span class="pdf-item-pages">${doc.page_count} pages</span>
            </div>
          </div>
          <div class="pdf-item-actions">
            <button class="pdf-action-btn view-btn" data-action="view" title="Voir en plein écran">
              <i class="fas fa-expand"></i>
            </button>
            <button class="pdf-action-btn download-btn" data-action="download" title="Télécharger">
              <i class="fas fa-download"></i>
            </button>
          </div>
        </div>
      `).join('');

      // Add event listeners for PDF actions
      content.addEventListener('click', async (e) => {
        const target = e.target as HTMLElement;
        const button = target.closest('.pdf-action-btn') as HTMLButtonElement;
        const pdfItem = target.closest('.pdf-item') as HTMLElement;
        
        if (!pdfItem) return;
        
        const pdfId = pdfItem.dataset.pdfId!;
        const document = documents.find(d => d.id === pdfId);
        if (!document) return;

        if (button) {
          const action = button.dataset.action;
          if (action === 'view') {
            // Close the modal first
            modal.classList.remove('pdf-viewer-visible');
            setTimeout(() => {
              if (modal.parentNode) {
                modal.parentNode.removeChild(modal);
              }
            }, 300);
            // Then show the PDF viewer
            await this.pdfList.showPdfViewer(document);
          } else if (action === 'download') {
            await this.downloadPdf(document);
          }
        } else {
          // Clicked on the PDF item itself - show quick preview
          await this.showPdfQuickPreviewInModal(document, pdfItem, modal);
        }
      });

    } catch (error) {
      console.error('Error loading PDF documents:', error);
      content.innerHTML = `
        <div style="text-align: center; color: var(--color-recording); padding: 40px;">
          <i class="fas fa-exclamation-triangle" style="font-size: 48px; margin-bottom: 16px;"></i>
          <p>Erreur lors du chargement des documents</p>
        </div>
      `;
    }
  }

  private async showPdfQuickPreviewInModal(document: PdfDocument, pdfItem: HTMLElement, modal: HTMLElement) {
    // Check if preview is already shown
    const existingPreview = pdfItem.querySelector('.pdf-quick-preview');
    if (existingPreview) {
      existingPreview.remove();
      return;
    }

    // Create preview container
    const previewContainer = document.createElement('div');
    previewContainer.className = 'pdf-quick-preview';
    previewContainer.innerHTML = `
      <div class="pdf-quick-preview-header">
        <span class="pdf-quick-preview-title">Aperçu - ${document.title}</span>
        <button class="pdf-quick-preview-close" title="Fermer">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div class="pdf-quick-preview-content">
        <div class="pdf-quick-preview-loading">
          <i class="fas fa-spinner fa-spin"></i>
          <span>Chargement de l'aperçu...</span>
        </div>
      </div>
      <div class="pdf-quick-preview-actions">
        <button class="pdf-quick-preview-btn" data-action="fullscreen">
          <i class="fas fa-expand"></i>
          Plein écran
        </button>
        <button class="pdf-quick-preview-btn" data-action="download">
          <i class="fas fa-download"></i>
          Télécharger
        </button>
      </div>
    `;

    // Insert after the pdf item
    pdfItem.insertAdjacentElement('afterend', previewContainer);

    // Add event listeners
    const closeBtn = previewContainer.querySelector('.pdf-quick-preview-close') as HTMLButtonElement;
    closeBtn.addEventListener('click', () => previewContainer.remove());

    const actionBtns = previewContainer.querySelectorAll('.pdf-quick-preview-btn');
    actionBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const action = (e.currentTarget as HTMLElement).dataset.action;
        if (action === 'fullscreen') {
          // Close the modal first
          modal.classList.remove('pdf-viewer-visible');
          setTimeout(() => {
            if (modal.parentNode) {
              modal.parentNode.removeChild(modal);
            }
          }, 300);
          // Then show the PDF viewer
          await this.pdfList.showPdfViewer(document);
        } else if (action === 'download') {
          await this.downloadPdf(document);
        }
      });
    });

    // Load PDF preview
    try {
      const pdfUrl = await PdfService.getPdfFileUrl(document.file_path);
      if (pdfUrl) {
        const content = previewContainer.querySelector('.pdf-quick-preview-content') as HTMLElement;
        content.innerHTML = `
          <iframe 
            src="${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0" 
            class="pdf-quick-preview-frame"
            frameborder="0">
          </iframe>
        `;
      } else {
        throw new Error('Impossible de charger le PDF');
      }
    } catch (error) {
      console.error('Error loading PDF preview:', error);
      const content = previewContainer.querySelector('.pdf-quick-preview-content') as HTMLElement;
      content.innerHTML = `
        <div class="pdf-quick-preview-error">
          <i class="fas fa-exclamation-triangle"></i>
          <span>Erreur lors du chargement de l'aperçu</span>
        </div>
      `;
    }

    // Animate in
    setTimeout(() => {
      previewContainer.classList.add('visible');
    }, 10);
  }

  private async downloadPdf(document: PdfDocument) {
    try {
      const pdfUrl = await PdfService.getPdfFileUrl(document.file_path);
      if (pdfUrl) {
        const a = document.createElement('a');
        a.href = pdfUrl;
        a.download = document.title;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Error downloading PDF:', error);
      alert('Erreur lors du téléchargement du PDF');
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private setupRecordingControls() {
    const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
    const durationInput = document.getElementById('durationInput') as HTMLInputElement;
    const setDurationButton = document.getElementById('setDurationButton') as HTMLButtonElement;

    recordButton.addEventListener('click', () => {
      if (this.isRecording) {
        this.stopRecording();
      } else {
        this.startRecording();
      }
    });

    setDurationButton.addEventListener('click', () => {
      const minutes = parseInt(durationInput.value, 10);
      if (minutes >= 1 && minutes <= 120) {
        this.recordingDuration = minutes * 60;
      }
    });
  }

  private async startRecording() {
    if (!this.currentUser || this.isProcessing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream);
      this.audioChunks = [];

      // Create new session if none exists
      if (!this.currentSession) {
        await this.createNewSession();
      }

      this.mediaRecorder.ondataavailable = (event) => {
        this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/wav' });
        this.currentAudioBlob = audioBlob;
        await this.processRecording(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.recordingStartTime = Date.now();

      this.updateRecordingUI();
      this.startRecordingTimer();
      this.setupLiveWaveform(stream);

    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Erreur lors du démarrage de l\'enregistrement');
    }
  }

  private stopRecording() {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      this.updateRecordingUI();
      this.stopRecordingTimer();
      this.stopLiveWaveform();
    }
  }

  private async processRecording(audioBlob: Blob) {
    if (!this.currentUser || !this.currentSession || this.isProcessing) return;

    this.isProcessing = true;

    // Show progress indicator
    this.transcriptionProgress.show(() => {
      this.isProcessing = false;
    });

    try {
      // Step 1: Upload audio file
      this.transcriptionProgress.setStep(0, 'Téléversement du fichier audio...');
      
      const audioPath = await StorageService.uploadAudioFile(
        new File([audioBlob], `recording-${Date.now()}.wav`, { type: 'audio/wav' }),
        this.currentUser.id,
        this.currentSession.id
      );

      // Show play button
      const playButton = document.getElementById('playRecordingButton') as HTMLButtonElement;
      playButton.style.display = 'flex';

      // Step 2: Convert audio to base64 for transcription
      this.transcriptionProgress.setStep(1, 'Préparation de la transcription...');
      
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        await this.transcribeAudio(base64Audio, audioPath);
      };
      reader.readAsDataURL(audioBlob);

    } catch (error) {
      console.error('Error processing recording:', error);
      this.transcriptionProgress.setError('Erreur lors du traitement de l\'enregistrement');
      this.isProcessing = false;
    }
  }

  private async transcribeAudio(base64Audio: string, audioPath?: string | null) {
    if (!this.currentSession || !this.isProcessing) return;

    try {
      // Get API key from environment variables
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('Clé API Gemini manquante. Veuillez configurer VITE_GEMINI_API_KEY dans votre fichier .env');
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      // Step 2: Transcription
      this.transcriptionProgress.setStep(1, 'Transcription en cours...');

      const result = await model.generateContent([
        "Transcris cet audio en français. Retourne uniquement le texte transcrit, sans commentaires additionnels.",
        {
          inlineData: {
            mimeType: "audio/wav",
            data: base64Audio
          }
        }
      ]);

      const transcription = result.response.text();
      
      // Update UI and database
      const rawTranscription = document.getElementById('rawTranscription') as HTMLElement;
      rawTranscription.innerHTML = transcription;

      // Step 3: Generate title
      this.transcriptionProgress.setStep(2, 'Génération du titre...');
      
      const smartTitle = await this.generateSessionTitle(transcription);
      
      // Update title in UI
      const titleElement = document.querySelector('.editor-title') as HTMLElement;
      titleElement.textContent = smartTitle;

      // Update session in database
      const updates: Partial<DictationSession> = {
        title: smartTitle,
        raw_transcription: transcription,
        recording_duration: Math.floor((Date.now() - this.recordingStartTime) / 1000)
      };

      if (audioPath) {
        updates.audio_file_path = audioPath;
      }

      await DatabaseService.updateSession(this.currentSession.id, updates);

      // Update current session object
      this.currentSession = { ...this.currentSession, ...updates };

      // Refresh sessions list to show new title
      this.sessionsList.loadSessions();

      // Generate summary and detailed note
      await this.generateSummaryAndNote(transcription);

    } catch (error) {
      console.error('Error transcribing audio:', error);
      this.transcriptionProgress.setError('Erreur lors de la transcription: ' + (error as Error).message);
      this.isProcessing = false;
    }
  }

  private async generateSummaryAndNote(transcription: string) {
    if (!this.currentSession || !this.isProcessing) return;

    try {
      // Get API key from environment variables
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) return;

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      // Step 4: Generate summary
      this.transcriptionProgress.setStep(3, 'Création du résumé...');

      const summaryResult = await model.generateContent([
        `Crée un résumé concis et structuré de ce texte en français. Le résumé doit capturer les points clés et être facilement lisible. Utilise le format Markdown pour la structure.

Texte à résumer:
${transcription}`
      ]);

      const summary = summaryResult.response.text();
      const summaryEditor = document.getElementById('summaryEditor') as HTMLElement;
      summaryEditor.innerHTML = marked(summary) as string;

      // Step 5: Generate detailed note
      this.transcriptionProgress.setStep(4, 'Rédaction de la note détaillée...');

      const noteResult = await model.generateContent([
        `Transforme ce texte en une note détaillée et bien structurée en français. Organise le contenu de manière logique avec des titres, sous-titres et points clés. Utilise le format Markdown pour une présentation claire.

Texte à structurer:
${transcription}`
      ]);

      const detailedNote = noteResult.response.text();
      const polishedNote = document.getElementById('polishedNote') as HTMLElement;
      polishedNote.innerHTML = marked(detailedNote) as string;

      // Update database
      await DatabaseService.updateSession(this.currentSession.id, {
        summary: summaryEditor.innerHTML,
        detailed_note: polishedNote.innerHTML
      });

      this.updatePlaceholders();

      // Show success
      this.transcriptionProgress.setSuccess('Traitement terminé avec succès !');
      this.isProcessing = false;

    } catch (error) {
      console.error('Error generating summary and note:', error);
      this.transcriptionProgress.setError('Erreur lors de la génération du contenu');
      this.isProcessing = false;
    }
  }

  private updateRecordingUI() {
    const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
    const recordingInterface = document.querySelector('.recording-interface') as HTMLElement;
    const liveTitle = document.getElementById('liveRecordingTitle') as HTMLElement;
    const liveCanvas = document.getElementById('liveWaveformCanvas') as HTMLElement;
    const liveTimer = document.getElementById('liveRecordingTimerDisplay') as HTMLElement;

    if (this.isRecording) {
      recordButton.classList.add('recording');
      recordingInterface.classList.add('is-live');
      liveTitle.style.display = 'block';
      liveCanvas.style.display = 'block';
      liveTimer.style.display = 'block';
      
      const icon = recordButton.querySelector('i') as HTMLElement;
      icon.className = 'fas fa-stop';
    } else {
      recordButton.classList.remove('recording');
      recordingInterface.classList.remove('is-live');
      liveTitle.style.display = 'none';
      liveCanvas.style.display = 'none';
      liveTimer.style.display = 'none';
      
      const icon = recordButton.querySelector('i') as HTMLElement;
      icon.className = 'fas fa-microphone';
    }
  }

  private startRecordingTimer() {
    const timerDisplay = document.getElementById('liveRecordingTimerDisplay') as HTMLElement;
    
    this.recordingTimer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
      const minutes = Math.floor(elapsed / 60);
      const seconds = elapsed % 60;
      const centiseconds = Math.floor(((Date.now() - this.recordingStartTime) % 1000) / 10);
      
      timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
      
      if (elapsed >= this.recordingDuration) {
        this.stopRecording();
      }
    }, 10);
  }

  private stopRecordingTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  private setupLiveWaveform(stream: MediaStream) {
    this.liveWaveformCanvas = document.getElementById('liveWaveformCanvas') as HTMLCanvasElement;
    this.liveWaveformContext = this.liveWaveformCanvas.getContext('2d');
    
    if (!this.liveWaveformContext) return;

    this.audioContext = new AudioContext();
    this.analyser = this.audioContext.createAnalyser();
    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.analyser);

    this.analyser.fftSize = 256;
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!this.isRecording || !this.liveWaveformContext || !this.analyser) return;

      this.animationId = requestAnimationFrame(draw);
      this.analyser.getByteFrequencyData(dataArray);

      const canvas = this.liveWaveformCanvas!;
      const ctx = this.liveWaveformContext;
      
      ctx.fillStyle = 'rgba(18, 18, 18, 0.3)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height * 0.8;
        
        const gradient = ctx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
        gradient.addColorStop(0, '#82aaff');
        gradient.addColorStop(1, '#c792ea');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        
        x += barWidth + 1;
      }
    };

    draw();
  }

  private stopLiveWaveform() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  private setupAudioPlayer() {
    this.audioPlayer = document.getElementById('audioPlayer') as HTMLAudioElement;
    const playPauseBtn = document.getElementById('playPauseBtn') as HTMLButtonElement;
    const stopPlaybackBtn = document.getElementById('stopPlaybackBtn') as HTMLButtonElement;
    const audioSeeker = document.getElementById('audioSeeker') as HTMLInputElement;
    const playbackTime = document.getElementById('playbackTime') as HTMLElement;

    playPauseBtn.addEventListener('click', () => {
      if (this.audioPlayer!.paused) {
        this.audioPlayer!.play();
        playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
        playPauseBtn.classList.add('playing');
      } else {
        this.audioPlayer!.pause();
        playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
        playPauseBtn.classList.remove('playing');
      }
    });

    stopPlaybackBtn.addEventListener('click', () => {
      this.audioPlayer!.pause();
      this.audioPlayer!.currentTime = 0;
      playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
      playPauseBtn.classList.remove('playing');
      this.hideAudioPlayer();
    });

    audioSeeker.addEventListener('input', () => {
      const seekTime = (parseFloat(audioSeeker.value) / 100) * this.audioPlayer!.duration;
      this.audioPlayer!.currentTime = seekTime;
    });

    this.audioPlayer.addEventListener('timeupdate', () => {
      if (this.audioPlayer!.duration) {
        const progress = (this.audioPlayer!.currentTime / this.audioPlayer!.duration) * 100;
        audioSeeker.value = progress.toString();
        
        const currentTime = this.formatTime(this.audioPlayer!.currentTime);
        const duration = this.formatTime(this.audioPlayer!.duration);
        playbackTime.textContent = `${currentTime} / ${duration}`;
      }
    });

    this.audioPlayer.addEventListener('ended', () => {
      playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
      playPauseBtn.classList.remove('playing');
      audioSeeker.value = '0';
      this.hideAudioPlayer();
    });
  }

  private async playCurrentRecording() {
    if (!this.currentSession || !this.currentSession.audio_file_path) {
      // Try to play the current audio blob if available
      if (this.currentAudioBlob) {
        const audioUrl = URL.createObjectURL(this.currentAudioBlob);
        this.audioPlayer!.src = audioUrl;
        this.showAudioPlayer();
        return;
      }
      return;
    }

    try {
      const audioUrl = await StorageService.getAudioFileUrl(this.currentSession.audio_file_path);
      if (audioUrl) {
        this.audioPlayer!.src = audioUrl;
        this.showAudioPlayer();
      }
    } catch (error) {
      console.error('Error loading audio file:', error);
      alert('Erreur lors du chargement du fichier audio');
    }
  }

  private showAudioPlayer() {
    const audioPlaybackControls = document.getElementById('audioPlaybackControls') as HTMLElement;
    const recordingInterface = document.querySelector('.recording-interface') as HTMLElement;
    
    audioPlaybackControls.style.display = 'block';
    recordingInterface.classList.add('is-playback');
  }

  private hideAudioPlayer() {
    const audioPlaybackControls = document.getElementById('audioPlaybackControls') as HTMLElement;
    const recordingInterface = document.querySelector('.recording-interface') as HTMLElement;
    
    audioPlaybackControls.style.display = 'none';
    recordingInterface.classList.remove('is-playback');
  }

  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
  }

  private setupTabNavigation() {
    const tabNav = document.querySelector(".tab-navigation") as HTMLElement;
    const tabButtons = tabNav.querySelectorAll(".tab-button");
    const activeTabIndicator = tabNav.querySelector(".active-tab-indicator") as HTMLElement;
    const noteContents = document.querySelectorAll(".note-content");

    function setActiveTab(activeButton: HTMLElement, skipAnimation = false) {
      if (!activeButton || !activeTabIndicator) return;

      tabButtons.forEach((btn) => btn.classList.remove("active"));
      activeButton.classList.add("active");

      const tabName = activeButton.getAttribute("data-tab");
      noteContents.forEach((content) => content.classList.remove("active"));

      let targetContentId;
      if (tabName === "summary") {
        targetContentId = "summaryEditor";
      } else if (tabName === "note") {
        targetContentId = "polishedNote";
      } else if (tabName === "raw") {
        targetContentId = "rawTranscription";
      }

      if (targetContentId) {
        const targetContentDiv = document.getElementById(targetContentId);
        if (targetContentDiv) {
          targetContentDiv.classList.add("active");
        }
      }

      const originalTransition = activeTabIndicator.style.transition;
      if (skipAnimation) {
        activeTabIndicator.style.transition = "none";
      } else {
        activeTabIndicator.style.transition = "";
      }

      activeTabIndicator.style.left = `${activeButton.offsetLeft}px`;
      activeTabIndicator.style.width = `${activeButton.offsetWidth}px`;

      if (skipAnimation) {
        activeTabIndicator.offsetHeight;
        activeTabIndicator.style.transition = originalTransition;
      }
    }

    tabButtons.forEach((button) => {
      button.addEventListener("click", (e) => {
        setActiveTab(e.currentTarget as HTMLElement);
      });
    });

    const initiallyActiveButton = tabNav.querySelector(".tab-button.active") as HTMLElement;
    if (initiallyActiveButton) {
      requestAnimationFrame(() => {
        setActiveTab(initiallyActiveButton, true);
      });
    }

    window.addEventListener("resize", () => {
      requestAnimationFrame(() => {
        const currentActiveButton = tabNav.querySelector(".tab-button.active") as HTMLElement;
        if (currentActiveButton) {
          setActiveTab(currentActiveButton, true);
        }
      });
    });
  }

  private setupThemeToggle() {
    const themeToggleButton = document.getElementById('themeToggleButton') as HTMLButtonElement;
    const icon = themeToggleButton.querySelector('i') as HTMLElement;
    
    themeToggleButton.addEventListener('click', () => {
      document.body.classList.toggle('light-mode');
      const isLightMode = document.body.classList.contains('light-mode');
      
      if (isLightMode) {
        icon.className = 'fas fa-moon';
      } else {
        icon.className = 'fas fa-sun';
      }
      
      localStorage.setItem('theme', isLightMode ? 'light' : 'dark');
    });

    // Load saved theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.body.classList.add('light-mode');
      icon.className = 'fas fa-moon';
    }
  }

  private setupFileUploads() {
    // Audio upload
    const uploadAudioButton = document.getElementById('uploadAudioButton') as HTMLButtonElement;
    const audioFileUpload = document.getElementById('audioFileUpload') as HTMLInputElement;

    uploadAudioButton.addEventListener('click', () => {
      audioFileUpload.click();
    });

    audioFileUpload.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        await this.processUploadedAudio(file);
      }
    });

    // PDF upload
    const uploadPdfButton = document.getElementById('uploadPdfButton') as HTMLButtonElement;
    const pdfFileUpload = document.getElementById('pdfFileUpload') as HTMLInputElement;

    uploadPdfButton.addEventListener('click', () => {
      pdfFileUpload.click();
    });

    pdfFileUpload.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        await this.processPdfFile(file);
      }
    });
  }

  private async processUploadedAudio(file: File) {
    if (!this.currentUser || this.isProcessing) return;

    // Create new session if none exists
    if (!this.currentSession) {
      await this.createNewSession();
    }

    this.isProcessing = true;

    // Show progress indicator
    this.transcriptionProgress.show(() => {
      this.isProcessing = false;
    });

    try {
      // Store the uploaded file as current audio blob
      this.currentAudioBlob = file;
      
      // Show play button
      const playButton = document.getElementById('playRecordingButton') as HTMLButtonElement;
      playButton.style.display = 'flex';

      // Step 1: File ready
      this.transcriptionProgress.setStep(0, 'Fichier audio chargé');

      // Convert to base64 for transcription
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        await this.transcribeAudio(base64Audio);
      };
      reader.readAsDataURL(file);

    } catch (error) {
      console.error('Error processing uploaded audio:', error);
      this.transcriptionProgress.setError('Erreur lors du traitement du fichier audio');
      this.isProcessing = false;
    }
  }

  private async processPdfFile(file: File) {
    if (!this.currentUser || this.isProcessing) return;

    this.isProcessing = true;

    // Show progress indicator
    this.transcriptionProgress.show(() => {
      this.isProcessing = false;
    });

    try {
      // Step 1: Extract text from PDF
      this.transcriptionProgress.setStep(0, 'Extraction du texte du PDF...');
      const extractedText = await PdfService.extractTextFromPdf(file);
      
      // Step 2: Upload PDF file
      this.transcriptionProgress.setStep(1, 'Téléversement du PDF...');
      const filePath = await PdfService.uploadPdfFile(file, this.currentUser.id, this.currentSession?.id);
      
      if (!filePath) {
        throw new Error('Erreur lors du téléversement du fichier PDF');
      }

      // Get PDF info
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const typedarray = new Uint8Array(e.target?.result as ArrayBuffer);
          const pdf = await (window as any).pdfjsLib.getDocument(typedarray).promise;
          
          // Create PDF document record
          const pdfDocument: Partial<PdfDocument> = {
            user_id: this.currentUser!.id,
            session_id: this.currentSession?.id,
            title: file.name,
            file_path: filePath,
            file_size: file.size,
            page_count: pdf.numPages,
            extracted_text: extractedText
          };

          const createdDocument = await PdfService.createPdfDocument(pdfDocument);
          
          if (createdDocument) {
            // Refresh PDF list
            this.pdfList.loadDocuments();
            
            // Update PDF preview button visibility
            this.updatePdfPreviewButton();
            
            // If we have a current session, process the extracted text
            if (this.currentSession && extractedText.trim()) {
              // Create new session if none exists
              if (!this.currentSession) {
                await this.createNewSession();
              }

              // Update raw transcription with extracted text
              const rawTranscription = document.getElementById('rawTranscription') as HTMLElement;
              rawTranscription.innerHTML = extractedText;

              // Step 3: Generate title
              this.transcriptionProgress.setStep(2, 'Génération du titre...');
              const smartTitle = await this.generateSessionTitle(extractedText);
              
              // Update title in UI
              const titleElement = document.querySelector('.editor-title') as HTMLElement;
              titleElement.textContent = smartTitle;

              // Update session in database
              await DatabaseService.updateSession(this.currentSession.id, {
                title: smartTitle,
                raw_transcription: extractedText
              });

              // Update current session object
              this.currentSession = { ...this.currentSession, title: smartTitle, raw_transcription: extractedText };

              // Refresh sessions list to show new title
              this.sessionsList.loadSessions();

              // Generate summary and detailed note from PDF text
              await this.generateSummaryAndNote(extractedText);
            } else {
              this.transcriptionProgress.setSuccess('PDF téléversé avec succès !');
              this.isProcessing = false;
            }
          }
        } catch (error) {
          console.error('Error processing PDF:', error);
          this.transcriptionProgress.setError('Erreur lors du traitement du PDF');
          this.isProcessing = false;
        }
      };
      reader.readAsArrayBuffer(file);

    } catch (error) {
      console.error('Error processing PDF file:', error);
      this.transcriptionProgress.setError('Erreur lors du traitement du fichier PDF: ' + (error as Error).message);
      this.isProcessing = false;
    }
  }

  private setupCopyAndSaveButtons() {
    // Copy buttons
    const copyRawButton = document.getElementById('copyRawTranscriptionButton') as HTMLButtonElement;
    const copySummaryButton = document.getElementById('copySummaryButton') as HTMLButtonElement;
    const copyDetailedButton = document.getElementById('copyDetailedNoteButton') as HTMLButtonElement;

    copyRawButton.addEventListener('click', () => {
      const content = document.getElementById('rawTranscription') as HTMLElement;
      this.copyToClipboard(content.textContent || '');
    });

    copySummaryButton.addEventListener('click', () => {
      const content = document.getElementById('summaryEditor') as HTMLElement;
      this.copyToClipboard(content.textContent || '');
    });

    copyDetailedButton.addEventListener('click', () => {
      const content = document.getElementById('polishedNote') as HTMLElement;
      this.copyToClipboard(content.textContent || '');
    });

    // Save buttons
    const saveSummaryButton = document.getElementById('saveSummaryButton') as HTMLButtonElement;
    const saveDetailedButton = document.getElementById('saveDetailedNoteButton') as HTMLButtonElement;
    const saveAllButton = document.getElementById('saveAllButton') as HTMLButtonElement;

    saveSummaryButton.addEventListener('click', () => {
      const content = document.getElementById('summaryEditor') as HTMLElement;
      const title = (document.querySelector('.editor-title') as HTMLElement).textContent || 'summary';
      this.downloadText(content.textContent || '', `${title}-summary.txt`);
    });

    saveDetailedButton.addEventListener('click', () => {
      const content = document.getElementById('polishedNote') as HTMLElement;
      const title = (document.querySelector('.editor-title') as HTMLElement).textContent || 'note';
      this.downloadText(content.textContent || '', `${title}-detailed.txt`);
    });

    saveAllButton.addEventListener('click', () => {
      this.downloadAllContent();
    });

    // Refresh buttons
    const refreshAllButton = document.getElementById('refreshAllButton') as HTMLButtonElement;
    const refreshNoteButton = document.getElementById('refreshNoteFromSummaryButton') as HTMLButtonElement;

    refreshAllButton.addEventListener('click', async () => {
      if (this.isProcessing) return;
      
      const rawContent = (document.getElementById('rawTranscription') as HTMLElement).textContent || '';
      if (rawContent.trim()) {
        this.isProcessing = true;
        this.transcriptionProgress.show(() => {
          this.isProcessing = false;
        });
        
        this.transcriptionProgress.setStep(2, 'Génération du titre...');
        await this.generateSummaryAndNote(rawContent);
      }
    });

    refreshNoteButton.addEventListener('click', async () => {
      if (this.isProcessing) return;
      
      const summaryContent = (document.getElementById('summaryEditor') as HTMLElement).textContent || '';
      if (summaryContent.trim()) {
        this.isProcessing = true;
        this.transcriptionProgress.show(() => {
          this.isProcessing = false;
        });
        
        this.transcriptionProgress.setStep(4, 'Génération de la note détaillée...');
        await this.generateDetailedNoteFromSummary(summaryContent);
      }
    });
  }

  private async generateDetailedNoteFromSummary(summary: string) {
    if (!this.currentSession || !this.isProcessing) return;

    try {
      // Get API key from environment variables
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) return;

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const result = await model.generateContent([
        `Développe ce résumé en une note détaillée et bien structurée en français. Ajoute des détails pertinents, des exemples et une structure logique avec des titres et sous-titres. Utilise le format Markdown.

Résumé à développer:
${summary}`
      ]);

      const detailedNote = result.response.text();
      const polishedNote = document.getElementById('polishedNote') as HTMLElement;
      polishedNote.innerHTML = marked(detailedNote) as string;

      // Update database
      await DatabaseService.updateSession(this.currentSession.id, {
        detailed_note: polishedNote.innerHTML
      });

      this.updatePlaceholders();
      this.transcriptionProgress.setSuccess('Note détaillée générée avec succès !');
      this.isProcessing = false;

    } catch (error) {
      console.error('Error generating detailed note from summary:', error);
      this.transcriptionProgress.setError('Erreur lors de la génération de la note détaillée');
      this.isProcessing = false;
    }
  }

  private copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      // Could add a toast notification here
      console.log('Copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  }

  private downloadText(content: string, filename: string) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private async downloadAllContent() {
    if (!this.currentSession) return;

    const zip = new JSZip();
    const title = (document.querySelector('.editor-title') as HTMLElement).textContent || 'session';
    
    // Add text files
    const rawContent = (document.getElementById('rawTranscription') as HTMLElement).textContent || '';
    const summaryContent = (document.getElementById('summaryEditor') as HTMLElement).textContent || '';
    const detailedContent = (document.getElementById('polishedNote') as HTMLElement).textContent || '';

    zip.file(`${title}-raw.txt`, rawContent);
    zip.file(`${title}-summary.txt`, summaryContent);
    zip.file(`${title}-detailed.txt`, detailedContent);

    // Add audio file if available
    if (this.currentSession.audio_file_path) {
      try {
        const audioUrl = await StorageService.getAudioFileUrl(this.currentSession.audio_file_path);
        if (audioUrl) {
          const response = await fetch(audioUrl);
          const audioBlob = await response.blob();
          zip.file(`${title}-audio.wav`, audioBlob);
        }
      } catch (error) {
        console.error('Error adding audio to zip:', error);
      }
    } else if (this.currentAudioBlob) {
      // Add current audio blob if no stored file
      zip.file(`${title}-audio.wav`, this.currentAudioBlob);
    }

    // Generate and download zip
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title}-complete.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private clearAllContent() {
    const titleElement = document.querySelector('.editor-title') as HTMLElement;
    const summaryEditor = document.getElementById('summaryEditor') as HTMLElement;
    const polishedNote = document.getElementById('polishedNote') as HTMLElement;
    const rawTranscription = document.getElementById('rawTranscription') as HTMLElement;
    const playButton = document.getElementById('playRecordingButton') as HTMLButtonElement;

    // Generate new title with current date
    const now = new Date();
    const dateStr = now.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    const timeStr = now.toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    });
    const newTitle = `Enregistrement du ${dateStr} à ${timeStr}`;

    titleElement.textContent = newTitle;
    summaryEditor.innerHTML = '';
    polishedNote.innerHTML = '';
    rawTranscription.innerHTML = '';
    playButton.style.display = 'none';

    // Clear audio references
    this.currentAudioBlob = null;
    this.hideAudioPlayer();

    this.updatePlaceholders();
  }

  private updatePlaceholders() {
    const summaryEditor = document.getElementById('summaryEditor') as HTMLElement;
    const polishedNote = document.getElementById('polishedNote') as HTMLElement;
    const rawTranscription = document.getElementById('rawTranscription') as HTMLElement;

    // Update placeholder visibility based on content
    [summaryEditor, polishedNote, rawTranscription].forEach(element => {
      if (element.textContent?.trim()) {
        element.classList.remove('placeholder-active');
      } else {
        element.classList.add('placeholder-active');
      }
    });
  }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  new DictationApp();
});