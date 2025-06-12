import { AuthService } from './src/lib/auth';
import { DatabaseService } from './src/lib/database';
import { StorageService } from './src/lib/storage';
import { AuthModal } from './src/components/AuthModal';
import { SessionsList } from './src/components/SessionsList';
import type { DictationSession } from './src/lib/supabase';
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

  constructor() {
    this.authModal = new AuthModal();
    this.sessionsList = new SessionsList(this.loadSession.bind(this));
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
    } else {
      this.authModal.show();
    }

    this.setupEventListeners();
    this.setupTabNavigation();
    this.setupAudioPlayer();
  }

  private showMainApp() {
    const mainApp = document.getElementById('mainApp') as HTMLElement;
    mainApp.style.display = 'flex';
    document.body.appendChild(this.sessionsList.getElement());
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

    const session: Partial<DictationSession> = {
      user_id: this.currentUser.id,
      title: 'Untitled Note',
      raw_transcription: '',
      summary: '',
      detailed_note: '',
      recording_duration: 0
    };

    const newSession = await DatabaseService.createSession(session);
    if (newSession) {
      this.currentSession = newSession;
      this.sessionsList.loadSessions();
    }
    return newSession;
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
    if (!this.currentUser) return;

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
    if (!this.currentUser || !this.currentSession) return;

    try {
      // Upload audio file
      const audioPath = await StorageService.uploadAudioFile(
        new File([audioBlob], `recording-${Date.now()}.wav`, { type: 'audio/wav' }),
        this.currentUser.id,
        this.currentSession.id
      );

      // Show play button
      const playButton = document.getElementById('playRecordingButton') as HTMLButtonElement;
      playButton.style.display = 'flex';

      // Convert audio to base64 for transcription
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        await this.transcribeAudio(base64Audio, audioPath);
      };
      reader.readAsDataURL(audioBlob);

    } catch (error) {
      console.error('Error processing recording:', error);
      alert('Erreur lors du traitement de l\'enregistrement');
    }
  }

  private async transcribeAudio(base64Audio: string, audioPath?: string | null) {
    if (!this.currentSession) return;

    try {
      // Get API key from environment variables
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('Clé API Gemini manquante. Veuillez configurer VITE_GEMINI_API_KEY dans votre fichier .env');
      }

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

      // Update session in database
      const updates: Partial<DictationSession> = {
        raw_transcription: transcription,
        recording_duration: Math.floor((Date.now() - this.recordingStartTime) / 1000)
      };

      if (audioPath) {
        updates.audio_file_path = audioPath;
      }

      await DatabaseService.updateSession(this.currentSession.id, updates);

      // Generate summary and detailed note
      await this.generateSummaryAndNote(transcription);

    } catch (error) {
      console.error('Error transcribing audio:', error);
      alert('Erreur lors de la transcription: ' + (error as Error).message);
    }
  }

  private async generateSummaryAndNote(transcription: string) {
    if (!this.currentSession) return;

    try {
      // Get API key from environment variables
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey) return;

      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      // Generate summary
      const summaryResult = await model.generateContent([
        `Crée un résumé concis et structuré de ce texte en français. Le résumé doit capturer les points clés et être facilement lisible. Utilise le format Markdown pour la structure.

Texte à résumer:
${transcription}`
      ]);

      const summary = summaryResult.response.text();
      const summaryEditor = document.getElementById('summaryEditor') as HTMLElement;
      summaryEditor.innerHTML = marked(summary) as string;

      // Generate detailed note
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

    } catch (error) {
      console.error('Error generating summary and note:', error);
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
    if (!this.currentUser) return;

    // Create new session if none exists
    if (!this.currentSession) {
      await this.createNewSession();
    }

    try {
      // Store the uploaded file as current audio blob
      this.currentAudioBlob = file;
      
      // Show play button
      const playButton = document.getElementById('playRecordingButton') as HTMLButtonElement;
      playButton.style.display = 'flex';

      // Convert to base64 for transcription
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        await this.transcribeAudio(base64Audio);
      };
      reader.readAsDataURL(file);

    } catch (error) {
      console.error('Error processing uploaded audio:', error);
      alert('Erreur lors du traitement du fichier audio');
    }
  }

  private async processPdfFile(file: File) {
    // Implementation for PDF processing would go here
    // This would extract text from PDF and process it similar to transcription
    console.log('PDF processing not implemented yet');
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
      const rawContent = (document.getElementById('rawTranscription') as HTMLElement).textContent || '';
      if (rawContent.trim()) {
        await this.generateSummaryAndNote(rawContent);
      }
    });

    refreshNoteButton.addEventListener('click', async () => {
      const summaryContent = (document.getElementById('summaryEditor') as HTMLElement).textContent || '';
      if (summaryContent.trim()) {
        await this.generateDetailedNoteFromSummary(summaryContent);
      }
    });
  }

  private async generateDetailedNoteFromSummary(summary: string) {
    if (!this.currentSession) return;

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

    } catch (error) {
      console.error('Error generating detailed note from summary:', error);
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

    titleElement.textContent = 'Untitled Note';
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