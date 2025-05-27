/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {GoogleGenAI, GenerateContentResponse} from '@google/genai';
import {marked} from 'marked';

// Déclaration pour pdf.js si le typage global n'est pas disponible
declare var pdfjsLib: any;

const MODEL_NAME = 'gemini-2.5-flash-preview-04-17';

interface Note {
  id: string;
  rawTranscription: string; // Peut aussi stocker le texte extrait du PDF
  polishedNote: string; // Pour les PDF, contiendra un message placeholder
  summary: string;
  timestamp: number;
  sourceType?: 'audio' | 'pdf'; // Optionnel pour distinguer la source
}

class VoiceNotesApp {
  private genAI: GoogleGenAI;
  private mediaRecorder: MediaRecorder | null = null;
  private recordButton: HTMLButtonElement;
  private recordingStatus: HTMLDivElement;
  private rawTranscription: HTMLDivElement;
  private polishedNote: HTMLDivElement;
  private newButton: HTMLButtonElement;
  private themeToggleButton: HTMLButtonElement;
  private copySummaryButton: HTMLButtonElement;
  private saveSummaryButton: HTMLButtonElement;
  private saveAudioButton: HTMLButtonElement; // Nouveau bouton
  private copyRawTranscriptionButton: HTMLButtonElement;
  private uploadAudioButton: HTMLButtonElement;
  private audioFileUploadInput: HTMLInputElement;
  private uploadPdfButton: HTMLButtonElement;
  private pdfFileUploadInput: HTMLInputElement;
  private durationInput: HTMLInputElement;
  private setDurationButton: HTMLButtonElement;
  private themeToggleIcon: HTMLElement;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private isProcessingFile = false; // Pour gérer l'état de traitement des fichiers
  private currentNote: Note | null = null;
  private currentAudioBlob: Blob | null = null; // Stocke le dernier blob audio
  private stream: MediaStream | null = null;
  private editorTitle: HTMLDivElement;

  private recordingInterface: HTMLDivElement;
  private liveRecordingTitle: HTMLDivElement;
  private liveWaveformCanvas: HTMLCanvasElement | null;
  private liveWaveformCtx: CanvasRenderingContext2D | null = null;
  private liveRecordingTimerDisplay: HTMLDivElement;
  private statusIndicatorDiv: HTMLDivElement | null;

  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private waveformDataArray: Uint8Array | null = null;
  private waveformDrawingId: number | null = null;
  private timerIntervalId: number | null = null;
  private recordingStartTime: number = 0;

  private userDefinedMaxRecordingMinutes: number = 30; // Default, matches input value
  private activeRecordingMaxDurationMs: number | null = null;
  private activeRecordingOriginalMinutesSetting: number | null = null; // Stores the minutes setting used for the current recording
  private maxDurationTimeoutId: number | null = null;

  private isEditingSummary: boolean = false;


  constructor() {
    this.genAI = new GoogleGenAI({
      apiKey: process.env.API_KEY!,
    });

    // Configuration PDF.js Worker
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    } else {
        console.error("pdfjsLib is not defined. PDF processing will not work.");
        // Afficher une erreur à l'utilisateur si pdfjsLib n'est pas chargé
        const statusElement = document.getElementById('recordingStatus');
        if (statusElement) {
            statusElement.textContent = "Erreur: La bibliothèque PDF n'a pas pu être chargée.";
        }
    }


    this.recordButton = document.getElementById(
      'recordButton',
    ) as HTMLButtonElement;
    this.recordingStatus = document.getElementById(
      'recordingStatus',
    ) as HTMLDivElement;
    this.rawTranscription = document.getElementById(
      'rawTranscription',
    ) as HTMLDivElement;
    this.polishedNote = document.getElementById(
      'polishedNote',
    ) as HTMLDivElement;
    this.newButton = document.getElementById('newButton') as HTMLButtonElement;
    this.themeToggleButton = document.getElementById(
      'themeToggleButton',
    ) as HTMLButtonElement;
    this.copySummaryButton = document.getElementById(
        'copySummaryButton',
    ) as HTMLButtonElement;
    this.saveSummaryButton = document.getElementById(
        'saveSummaryButton',
    ) as HTMLButtonElement;
    this.saveAudioButton = document.getElementById( // Récupération du nouveau bouton
        'saveAudioButton',
    ) as HTMLButtonElement;
    this.copyRawTranscriptionButton = document.getElementById(
        'copyRawTranscriptionButton',
    ) as HTMLButtonElement;
    this.uploadAudioButton = document.getElementById(
        'uploadAudioButton',
    ) as HTMLButtonElement;
    this.audioFileUploadInput = document.getElementById(
        'audioFileUpload',
    ) as HTMLInputElement;
    this.uploadPdfButton = document.getElementById(
        'uploadPdfButton',
    ) as HTMLButtonElement;
    this.pdfFileUploadInput = document.getElementById(
        'pdfFileUpload',
    ) as HTMLInputElement;
    this.durationInput = document.getElementById(
        'durationInput',
    ) as HTMLInputElement;
    this.setDurationButton = document.getElementById(
        'setDurationButton',
    ) as HTMLButtonElement;
    this.themeToggleIcon = this.themeToggleButton.querySelector(
      'i',
    ) as HTMLElement;
    this.editorTitle = document.querySelector(
      '.editor-title',
    ) as HTMLDivElement;

    this.recordingInterface = document.querySelector(
      '.recording-interface',
    ) as HTMLDivElement;
    this.liveRecordingTitle = document.getElementById(
      'liveRecordingTitle',
    ) as HTMLDivElement;
    this.liveWaveformCanvas = document.getElementById(
      'liveWaveformCanvas',
    ) as HTMLCanvasElement;
    this.liveRecordingTimerDisplay = document.getElementById(
      'liveRecordingTimerDisplay',
    ) as HTMLDivElement;

    if (this.liveWaveformCanvas) {
      this.liveWaveformCtx = this.liveWaveformCanvas.getContext('2d');
    } else {
      console.warn(
        'Live waveform canvas element not found. Visualizer will not work.',
      );
    }

    if (this.recordingInterface) {
      this.statusIndicatorDiv = this.recordingInterface.querySelector(
        '.status-indicator',
      ) as HTMLDivElement;
    } else {
      console.warn('Recording interface element not found.');
      this.statusIndicatorDiv = null;
    }
    
    this.durationInput.value = String(this.userDefinedMaxRecordingMinutes);

    this.bindEventListeners();
    this.initTheme();
    this.createNewNote(); 

    this.recordingStatus.textContent = 'Prêt à enregistrer ou téléverser.';
  }

  private bindEventListeners(): void {
    this.recordButton.addEventListener('click', () => this.toggleRecording());
    this.newButton.addEventListener('click', () => this.createNewNote());
    this.themeToggleButton.addEventListener('click', () => this.toggleTheme());
    this.copySummaryButton.addEventListener('click', () => this.copySummaryToClipboard());
    this.saveSummaryButton.addEventListener('click', () => this.saveSummaryToFile());
    this.saveAudioButton.addEventListener('click', () => this.saveCurrentAudio()); // Binding du nouveau bouton
    this.copyRawTranscriptionButton.addEventListener('click', () => this.copyRawTranscriptionToClipboard());
    
    this.uploadAudioButton.addEventListener('click', () => this.triggerFileUpload());
    this.audioFileUploadInput.addEventListener('change', (event) => this.handleFileUpload(event));

    this.uploadPdfButton.addEventListener('click', () => this.triggerPdfUpload());
    this.pdfFileUploadInput.addEventListener('change', (event) => this.handlePdfUpload(event));
    
    this.setDurationButton.addEventListener('click', () => this.handleSetDuration());
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  private handleSetDuration(): void {
    if (this.isProcessingFile) {
        this.recordingStatus.textContent = 'Veuillez attendre la fin du traitement en cours.';
        setTimeout(() => {
             if (this.recordingStatus.textContent === 'Veuillez attendre la fin du traitement en cours.') {
                this.recordingStatus.textContent = this.getCurrentBaseStatus();
             }
        }, 3000);
        return;
    }
    if (this.isRecording) {
        const currentRecordingMins = this.activeRecordingOriginalMinutesSetting || this.userDefinedMaxRecordingMinutes;
        this.recordingStatus.textContent = 'La durée ne peut être modifiée pendant l\'enregistrement.';
        setTimeout(() => {
            if (this.recordingStatus.textContent === 'La durée ne peut être modifiée pendant l\'enregistrement.') {
                 this.recordingStatus.textContent = this.getCurrentBaseStatus();
            }
        }, 3000);
        // Revert input to the duration of the active recording if it was changed
        if (this.activeRecordingOriginalMinutesSetting) {
            this.durationInput.value = String(this.activeRecordingOriginalMinutesSetting);
        } else {
            this.durationInput.value = String(this.userDefinedMaxRecordingMinutes);
        }
        return;
    }

    const newDurationMinutes = parseInt(this.durationInput.value, 10);
    if (!isNaN(newDurationMinutes) && newDurationMinutes >= 1 && newDurationMinutes <= 120) { // Max 2 hours
        this.userDefinedMaxRecordingMinutes = newDurationMinutes;
        this.recordingStatus.textContent = `Durée max réglée à ${newDurationMinutes} minutes.`;
    } else {
        this.recordingStatus.textContent = 'Durée invalide. Entrez une valeur entre 1 et 120 minutes.';
        this.durationInput.value = String(this.userDefinedMaxRecordingMinutes); // Reset to last valid global setting
    }
    setTimeout(() => {
        const currentStatus = this.recordingStatus.textContent || "";
        if (currentStatus.startsWith('Durée max réglée') || currentStatus.startsWith('Durée invalide')) {
            this.recordingStatus.textContent = this.getCurrentBaseStatus();
        }
    }, 3000);
  }


  private triggerFileUpload(): void {
    if (this.isRecording) {
      this.displayTemporaryStatus('Veuillez arrêter l\'enregistrement avant de téléverser un fichier audio.', this.getCurrentBaseStatus());
      return;
    }
    if (this.isProcessingFile) {
        this.displayTemporaryStatus('Veuillez attendre la fin du traitement du fichier actuel.', this.getCurrentBaseStatus());
        return;
    }
    this.audioFileUploadInput.click();
  }

  private triggerPdfUpload(): void {
    if (this.isRecording) {
      this.displayTemporaryStatus('Veuillez arrêter l\'enregistrement avant de téléverser un PDF.', this.getCurrentBaseStatus());
      return;
    }
    if (this.isProcessingFile) {
      this.displayTemporaryStatus('Veuillez attendre la fin du traitement du fichier actuel.', this.getCurrentBaseStatus());
      return;
    }
    if (typeof pdfjsLib === 'undefined') {
        this.recordingStatus.textContent = "Erreur: La fonctionnalité PDF n'est pas disponible.";
        console.error("pdfjsLib is not defined. Cannot upload PDF.");
        return;
    }
    this.pdfFileUploadInput.click();
  }

  private displayTemporaryStatus(message: string, revertToStatus: string, duration: number = 3000): void {
    const originalStatus = this.recordingStatus.textContent;
    this.recordingStatus.textContent = message;
    setTimeout(() => {
        if (this.recordingStatus.textContent === message) {
            this.recordingStatus.textContent = revertToStatus;
        }
    }, duration);
  }

  private async handleFileUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];

    if (!file.type.startsWith('audio/')) {
      this.displayTemporaryStatus('Type de fichier non supporté. Veuillez sélectionner un fichier audio.', this.getCurrentBaseStatus());
      input.value = ''; 
      return;
    }
    
    this.isProcessingFile = true;
    this.createNewNote('audio'); 
    this.currentAudioBlob = file; // Stocker le fichier audio téléversé

    const fileName = file.name;
    const lastDotIndex = fileName.lastIndexOf('.');
    const titleWithoutExtension = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
    if (this.editorTitle) {
      this.editorTitle.textContent = titleWithoutExtension.replace(/_/g, ' ');
      this.editorTitle.classList.remove('placeholder-active');
    }


    this.recordingStatus.textContent = 'Traitement du fichier audio téléversé...';
    try {
      await this.processAudio(file, file.type);
    } catch (err) {
      console.error('Error processing uploaded file:', err);
      this.recordingStatus.textContent = 'Erreur lors du traitement du fichier audio.';
      if (this.currentNote) {
        this.currentNote.polishedNote = `Error processing uploaded audio: ${err instanceof Error ? err.message : String(err)}`;
        this.currentNote.summary = '';
      }
      this.isEditingSummary = false;
      this.updatePolishedNoteDisplay();
      await this.generateAndSetDocumentTitleLLM(this.currentNote?.rawTranscription || '');

    } finally {
        this.isProcessingFile = false;
        input.value = ''; 
        if (!this.recordingStatus.textContent?.includes('Erreur')) {
           this.recordingStatus.textContent = this.getCurrentBaseStatus();
        }
    }
  }

  private async handlePdfUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    if (file.type !== 'application/pdf') {
      this.displayTemporaryStatus('Type de fichier non supporté. Veuillez sélectionner un fichier PDF.', this.getCurrentBaseStatus());
      input.value = '';
      return;
    }
    
    this.isProcessingFile = true;
    this.createNewNote('pdf');
    this.currentAudioBlob = null; // Pas d'audio pour les PDF

    const fileName = file.name;
    const lastDotIndex = fileName.lastIndexOf('.');
    const titleWithoutExtension = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
    if (this.editorTitle) {
      this.editorTitle.textContent = titleWithoutExtension.replace(/_/g, ' ');
      this.editorTitle.classList.remove('placeholder-active');
    }

    this.recordingStatus.textContent = 'Traitement du PDF...';
    let extractedText = '';
    try {
      this.recordingStatus.textContent = 'Extraction du texte du PDF...';
      extractedText = await this.extractTextFromPdf(file);

      if (!extractedText || extractedText.trim() === '') {
        this.recordingStatus.textContent = 'Aucun texte n\'a pu être extrait du PDF.';
        if (this.currentNote) {
            this.currentNote.rawTranscription = '';
            this.currentNote.polishedNote = "Aucun texte extrait du PDF.";
            this.currentNote.summary = '';
        }
        this.updateRawTranscriptionDisplay('');
        this.isEditingSummary = false;
        this.updatePolishedNoteDisplay();
        await this.generateAndSetDocumentTitleLLM(''); 
        return;
      }
      
      this.updateRawTranscriptionDisplay(extractedText);
      if (this.currentNote) this.currentNote.rawTranscription = extractedText;

      this.recordingStatus.textContent = 'Génération du résumé du PDF...';
      const summary = await this.generateSummaryLLM(extractedText);
      
      if (this.currentNote) {
        this.currentNote.summary = summary;
        this.currentNote.polishedNote = "Le résumé ci-dessus a été généré à partir du PDF téléversé. Le texte intégral extrait du PDF est disponible dans l'onglet 'Brut'.";
      }
      
      this.isEditingSummary = false;
      this.updatePolishedNoteDisplay();
      await this.generateAndSetDocumentTitleLLM(extractedText);
      this.recordingStatus.textContent = 'Résumé du PDF généré.';

    } catch (err) {
      console.error('Error processing PDF file:', err);
      this.recordingStatus.textContent = 'Erreur lors du traitement du PDF.';
      if (this.currentNote) {
        this.currentNote.rawTranscription = (err instanceof Error ? `Erreur d'extraction PDF: ${err.message}` : `Erreur d'extraction PDF.`);
        this.currentNote.polishedNote = `Erreur lors du traitement du PDF: ${err instanceof Error ? err.message : String(err)}`;
        this.currentNote.summary = '';
      }
      this.updateRawTranscriptionDisplay(this.currentNote?.rawTranscription || '');
      this.isEditingSummary = false;
      this.updatePolishedNoteDisplay();
      await this.generateAndSetDocumentTitleLLM(this.currentNote?.rawTranscription || extractedText);
    } finally {
      this.isProcessingFile = false;
      input.value = '';
       if (!this.recordingStatus.textContent?.includes('Erreur') && !this.recordingStatus.textContent?.includes('Aucun texte')) {
           this.recordingStatus.textContent = this.getCurrentBaseStatus();
        }
    }
  }

  private async extractTextFromPdf(file: File): Promise<string> {
    if (typeof pdfjsLib === 'undefined') {
        console.error("pdfjsLib is not defined. Cannot extract text from PDF.");
        throw new Error("La bibliothèque PDF n'est pas chargée.");
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument(arrayBuffer).promise;
    let fullText = '';

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      fullText += textContent.items.map((item: any) => item.str).join(' ') + '\n';
    }
    return fullText;
  }


  private handleResize(): void {
    if (
      this.isRecording &&
      this.liveWaveformCanvas &&
      this.liveWaveformCanvas.style.display === 'block'
    ) {
      requestAnimationFrame(() => {
        this.setupCanvasDimensions();
      });
    }
  }

  private setupCanvasDimensions(): void {
    if (!this.liveWaveformCanvas || !this.liveWaveformCtx) return;

    const canvas = this.liveWaveformCanvas;
    const dpr = window.devicePixelRatio || 1;

    const rect = canvas.getBoundingClientRect();
    const cssWidth = rect.width;
    const cssHeight = rect.height;

    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    this.liveWaveformCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private initTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      document.body.classList.add('light-mode');
      this.themeToggleIcon.classList.remove('fa-sun');
      this.themeToggleIcon.classList.add('fa-moon');
    } else {
      document.body.classList.remove('light-mode');
      this.themeToggleIcon.classList.remove('fa-moon');
      this.themeToggleIcon.classList.add('fa-sun');
    }
  }

  private toggleTheme(): void {
    document.body.classList.toggle('light-mode');
    if (document.body.classList.contains('light-mode')) {
      localStorage.setItem('theme', 'light');
      this.themeToggleIcon.classList.remove('fa-sun');
      this.themeToggleIcon.classList.add('fa-moon');
    } else {
      localStorage.setItem('theme', 'dark');
      this.themeToggleIcon.classList.remove('fa-moon');
      this.themeToggleIcon.classList.add('fa-sun');
    }
  }

  private async toggleRecording(): Promise<void> {
    if (this.isProcessingFile) {
      this.displayTemporaryStatus('Veuillez attendre la fin du traitement du fichier actuel.', this.getCurrentBaseStatus());
      return;
    }
    if (!this.isRecording) {
      await this.startRecording();
    } else {
      await this.stopRecording();
    }
  }

  private setupAudioVisualizer(): void {
    if (!this.stream || this.audioContext) return;

    this.audioContext = new (window.AudioContext ||
      (window as any).webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyserNode = this.audioContext.createAnalyser();

    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.75;

    const bufferLength = this.analyserNode.frequencyBinCount;
    this.waveformDataArray = new Uint8Array(bufferLength);

    source.connect(this.analyserNode);
  }

  private drawLiveWaveform(): void {
    if (
      !this.analyserNode ||
      !this.waveformDataArray ||
      !this.liveWaveformCtx ||
      !this.liveWaveformCanvas ||
      !this.isRecording
    ) {
      if (this.waveformDrawingId) cancelAnimationFrame(this.waveformDrawingId);
      this.waveformDrawingId = null;
      return;
    }

    this.waveformDrawingId = requestAnimationFrame(() =>
      this.drawLiveWaveform(),
    );
    this.analyserNode.getByteFrequencyData(this.waveformDataArray);

    const ctx = this.liveWaveformCtx;
    const canvas = this.liveWaveformCanvas;

    const logicalWidth = canvas.clientWidth;
    const logicalHeight = canvas.clientHeight;

    ctx.clearRect(0, 0, logicalWidth, logicalHeight);

    const bufferLength = this.analyserNode.frequencyBinCount;
    const numBars = Math.floor(bufferLength * 0.5);

    if (numBars === 0) return;

    const totalBarPlusSpacingWidth = logicalWidth / numBars;
    const barWidth = Math.max(1, Math.floor(totalBarPlusSpacingWidth * 0.7));
    const barSpacing = Math.max(0, Math.floor(totalBarPlusSpacingWidth * 0.3));

    let x = 0;

    const recordingColor =
      getComputedStyle(document.documentElement)
        .getPropertyValue('--color-recording')
        .trim() || '#ff3b30';
    ctx.fillStyle = recordingColor;

    for (let i = 0; i < numBars; i++) {
      if (x >= logicalWidth) break;

      const dataIndex = Math.floor(i * (bufferLength / numBars));
      const barHeightNormalized = this.waveformDataArray[dataIndex] / 255.0;
      let barHeight = barHeightNormalized * logicalHeight;

      if (barHeight < 1 && barHeight > 0) barHeight = 1;
      barHeight = Math.round(barHeight);

      const y = Math.round((logicalHeight - barHeight) / 2);

      ctx.fillRect(Math.floor(x), y, barWidth, barHeight);
      x += barWidth + barSpacing;
    }
  }

  private updateLiveTimer(): void {
    if (!this.isRecording || !this.liveRecordingTimerDisplay || this.activeRecordingMaxDurationMs === null) return;
    const now = Date.now();
    const elapsedMs = now - this.recordingStartTime;

    const totalElapsedSeconds = Math.floor(elapsedMs / 1000);
    const elapsedMinutes = Math.floor(totalElapsedSeconds / 60);
    const elapsedSeconds = totalElapsedSeconds % 60;
    const elapsedHundredths = Math.floor((elapsedMs % 1000) / 10);

    let timerText = `${String(elapsedMinutes).padStart(2, '0')}:${String(elapsedSeconds).padStart(2, '0')}.${String(elapsedHundredths).padStart(2, '0')}`;

    if (this.maxDurationTimeoutId && this.activeRecordingMaxDurationMs) { 
        const remainingMs = Math.max(0, this.activeRecordingMaxDurationMs - elapsedMs);
        const totalRemainingSeconds = Math.floor(remainingMs / 1000);
        const remainingMinutes = Math.floor(totalRemainingSeconds / 60);
        const remainingSeconds = totalRemainingSeconds % 60;
        timerText += ` (Restant: ${String(remainingMinutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')})`;
    }

    this.liveRecordingTimerDisplay.textContent = timerText;
  }

  private startLiveDisplay(): void {
    if (
      !this.recordingInterface ||
      !this.liveRecordingTitle ||
      !this.liveWaveformCanvas ||
      !this.liveRecordingTimerDisplay
    ) {
      console.warn(
        'One or more live display elements are missing. Cannot start live display.',
      );
      return;
    }

    this.recordingInterface.classList.add('is-live');
    this.liveRecordingTitle.style.display = 'block';
    this.liveWaveformCanvas.style.display = 'block';
    this.liveRecordingTimerDisplay.style.display = 'block';

    this.setupCanvasDimensions();

    if (this.statusIndicatorDiv) this.statusIndicatorDiv.style.display = 'none';

    const iconElement = this.recordButton.querySelector(
      '.record-button-inner i',
    ) as HTMLElement;
    if (iconElement) {
      iconElement.classList.remove('fa-microphone');
      iconElement.classList.add('fa-stop');
    }

    const currentTitle = this.editorTitle.textContent?.trim();
    const placeholder =
      this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
    this.liveRecordingTitle.textContent =
      currentTitle && currentTitle !== placeholder
        ? currentTitle
        : 'New Recording';

    this.setupAudioVisualizer();
    this.drawLiveWaveform();

    this.recordingStartTime = Date.now();
    this.updateLiveTimer(); 
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.timerIntervalId = window.setInterval(() => this.updateLiveTimer(), 50);
  }

  private stopLiveDisplay(): void {
    if (
      !this.recordingInterface ||
      !this.liveRecordingTitle ||
      !this.liveWaveformCanvas ||
      !this.liveRecordingTimerDisplay
    ) {
      if (this.recordingInterface)
        this.recordingInterface.classList.remove('is-live');
      return;
    }
    this.recordingInterface.classList.remove('is-live');
    this.liveRecordingTitle.style.display = 'none';
    this.liveWaveformCanvas.style.display = 'none';
    this.liveRecordingTimerDisplay.style.display = 'none';

    if (this.statusIndicatorDiv)
      this.statusIndicatorDiv.style.display = 'block';

    const iconElement = this.recordButton.querySelector(
      '.record-button-inner i',
    ) as HTMLElement;
    if (iconElement) {
      iconElement.classList.remove('fa-stop');
      iconElement.classList.add('fa-microphone');
    }

    if (this.waveformDrawingId) {
      cancelAnimationFrame(this.waveformDrawingId);
      this.waveformDrawingId = null;
    }
    if (this.timerIntervalId) {
      clearInterval(this.timerIntervalId);
      this.timerIntervalId = null;
    }
    if (this.liveWaveformCtx && this.liveWaveformCanvas) {
      this.liveWaveformCtx.clearRect(
        0,
        0,
        this.liveWaveformCanvas.width,
        this.liveWaveformCanvas.height,
      );
    }

    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') {
        this.audioContext
          .close()
          .catch((e) => console.warn('Error closing audio context', e));
      }
      this.audioContext = null;
    }
    this.analyserNode = null;
    this.waveformDataArray = null;
  }

  private async startRecording(): Promise<void> {
    try {
      this.audioChunks = [];
      this.currentAudioBlob = null; // Réinitialiser le blob audio au début de l'enregistrement
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
      if (this.audioContext && this.audioContext.state !== 'closed') {
        await this.audioContext.close();
        this.audioContext = null;
      }

      this.recordingStatus.textContent = 'Demande d\'accès au microphone...';
      this.createNewNote('audio'); // Ensure new note context for recording

      try {
        this.stream = await navigator.mediaDevices.getUserMedia({audio: true});
      } catch (err) {
        console.error('Failed with basic constraints:', err);
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
        });
      }

      try {
        this.mediaRecorder = new MediaRecorder(this.stream, {
          mimeType: 'audio/webm',
        });
      } catch (e) {
        console.error('audio/webm not supported, trying default:', e);
        this.mediaRecorder = new MediaRecorder(this.stream);
      }

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0)
          this.audioChunks.push(event.data);
      };

      this.mediaRecorder.onstop = () => {
        this.stopLiveDisplay();
        const stoppedByTimeout = this.recordingStatus.textContent?.includes(`limite ${this.activeRecordingOriginalMinutesSetting} min`);

        if (this.audioChunks.length > 0) {
          const audioBlob = new Blob(this.audioChunks, {
            type: this.mediaRecorder?.mimeType || 'audio/webm',
          });
          this.currentAudioBlob = audioBlob; // Stocker le blob audio enregistré
          this.isProcessingFile = true; // Set before async operation
          this.processAudio(audioBlob).catch((err) => {
            console.error('Error processing audio:', err);
            const baseStatus = this.getCurrentBaseStatus(); 
            if (stoppedByTimeout) {
                 this.recordingStatus.textContent = `Enregistrement arrêté (limite ${this.activeRecordingOriginalMinutesSetting} min). Erreur de traitement.`;
            } else {
                this.recordingStatus.textContent = 'Erreur lors du traitement de l\'enregistrement';
            }
            setTimeout(() => {
                if (this.recordingStatus.textContent && this.recordingStatus.textContent.includes('Erreur')) {
                    this.recordingStatus.textContent = baseStatus;
                }
            }, 3000);

          }).finally(() => {
            this.isProcessingFile = false;
            if (!this.recordingStatus.textContent?.includes('Erreur')) {
                 this.recordingStatus.textContent = this.getCurrentBaseStatus();
            }
          });
        } else {
          this.currentAudioBlob = null; // Aucun audio capturé
          if (!stoppedByTimeout) { 
             this.recordingStatus.textContent = 'Aucune donnée audio capturée. Veuillez réessayer.';
          }
           this.recordingStatus.textContent = this.getCurrentBaseStatus();
        }

        if (this.stream) {
          this.stream.getTracks().forEach((track) => {
            track.stop();
          });
          this.stream = null;
        }
      };
      
      this.activeRecordingOriginalMinutesSetting = this.userDefinedMaxRecordingMinutes;
      this.activeRecordingMaxDurationMs = this.activeRecordingOriginalMinutesSetting * 60 * 1000;

      this.mediaRecorder.start();
      this.isRecording = true; 

      this.recordButton.classList.add('recording');
      this.recordButton.setAttribute('title', 'Stop Recording');
      this.recordingStatus.textContent = `Enregistrement en cours... (max ${this.activeRecordingOriginalMinutesSetting} minutes)`;


      if (this.maxDurationTimeoutId) {
        clearTimeout(this.maxDurationTimeoutId);
        this.maxDurationTimeoutId = null;
      }
      this.maxDurationTimeoutId = window.setTimeout(() => {
        if (this.isRecording) {
          console.log(`Recording automatically stopped after ${this.activeRecordingOriginalMinutesSetting} minutes.`);
          this.stopRecording(true); 
        }
      }, this.activeRecordingMaxDurationMs);
      
      this.startLiveDisplay(); 


    } catch (error) {
      console.error('Error starting recording:', error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : 'Unknown';

      if (
        errorName === 'NotAllowedError' ||
        errorName === 'PermissionDeniedError'
      ) {
        this.recordingStatus.textContent =
          'Permission du microphone refusée. Veuillez vérifier les paramètres du navigateur et recharger la page.';
      } else if (
        errorName === 'NotFoundError' ||
        (errorName === 'DOMException' &&
          errorMessage.includes('Requested device not found'))
      ) {
        this.recordingStatus.textContent =
          'Aucun microphone trouvé. Veuillez connecter un microphone.';
      } else if (
        errorName === 'NotReadableError' ||
        errorName === 'AbortError' ||
        (errorName === 'DOMException' &&
          errorMessage.includes('Failed to allocate audiosource'))
      ) {
        this.recordingStatus.textContent =
          'Impossible d\'accéder au microphone. Il est peut-être utilisé par une autre application.';
      } else {
        this.recordingStatus.textContent = `Erreur : ${errorMessage}`;
      }

      this.isRecording = false;
      this.currentAudioBlob = null; // Réinitialiser si l'enregistrement échoue au démarrage
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
      if (this.maxDurationTimeoutId) { 
        clearTimeout(this.maxDurationTimeoutId);
        this.maxDurationTimeoutId = null;
      }
      this.activeRecordingMaxDurationMs = null;
      this.activeRecordingOriginalMinutesSetting = null;
      this.recordButton.classList.remove('recording');
      this.recordButton.setAttribute('title', 'Start Recording');
      this.stopLiveDisplay();
      this.recordingStatus.textContent = this.getCurrentBaseStatus(); // Reset status
    }
  }

  private playBeepSound(): void {
    try {
      const beepAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (!beepAudioContext) {
        console.warn('AudioContext not supported, cannot play beep.');
        return;
      }

      const oscillator = beepAudioContext.createOscillator();
      const gainNode = beepAudioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(beepAudioContext.destination);

      gainNode.gain.setValueAtTime(0, beepAudioContext.currentTime); 
      gainNode.gain.linearRampToValueAtTime(0.25, beepAudioContext.currentTime + 0.01); 
      
      oscillator.type = 'sine'; 
      oscillator.frequency.setValueAtTime(880, beepAudioContext.currentTime); 

      oscillator.start(beepAudioContext.currentTime);
      
      gainNode.gain.setValueAtTime(0.25, beepAudioContext.currentTime + 0.15); 
      gainNode.gain.linearRampToValueAtTime(0, beepAudioContext.currentTime + 0.20); 
      oscillator.stop(beepAudioContext.currentTime + 0.20); 

      oscillator.onended = () => {
        beepAudioContext.close().catch(e => console.warn("Error closing beep audio context:", e));
      };
    } catch (error) {
      console.warn('Could not play beep sound:', error);
    }
  }

  private async stopRecording(stoppedByTimeout = false): Promise<void> {
    const currentRecordingMinutes = this.activeRecordingOriginalMinutesSetting || this.userDefinedMaxRecordingMinutes;

    if (stoppedByTimeout) {
      this.playBeepSound(); 
    }

    if (this.maxDurationTimeoutId) {
      clearTimeout(this.maxDurationTimeoutId);
      this.maxDurationTimeoutId = null;
    }

    if (this.mediaRecorder && this.isRecording) {
      try {
        if (stoppedByTimeout) {
            this.recordingStatus.textContent = `Enregistrement arrêté (limite ${currentRecordingMinutes} min). Traitement...`;
        } else {
            // Only update if not already showing timeout message
            if (!this.recordingStatus.textContent?.includes(`limite ${currentRecordingMinutes} min`)) {
               this.recordingStatus.textContent = 'Traitement audio en cours...';
            }
        }
        this.mediaRecorder.stop(); 
      } catch (e) {
        console.error('Error stopping MediaRecorder:', e);
        this.stopLiveDisplay(); 
        this.isProcessingFile = false; // Ensure reset on error
        this.recordingStatus.textContent = this.getCurrentBaseStatus();
      }

      this.isRecording = false; 
      this.recordButton.classList.remove('recording');
      this.recordButton.setAttribute('title', 'Start Recording');
      // stopLiveDisplay is called in mediaRecorder.onstop
    } else {
       if (!this.isRecording) { // If somehow stopRecording is called when not recording
         this.stopLiveDisplay(); 
       }
    }
  }

  private async processAudio(audioBlob: Blob, explicitMimeType?: string): Promise<void> {
    const currentRecordingMinutes = this.activeRecordingOriginalMinutesSetting || this.userDefinedMaxRecordingMinutes;
    const isTimeoutStop = this.recordingStatus.textContent?.includes(`limite ${currentRecordingMinutes} min`);

    // audioBlob is already our currentAudioBlob or will be set as such before calling this for recordings.
    // For uploads, currentAudioBlob is set before calling this.
    // So, this.currentAudioBlob = audioBlob; is somewhat redundant here if called from recording,
    // but harmless if called from upload where it's already set.
    this.currentAudioBlob = audioBlob;


    if (audioBlob.size === 0) {
      if (!isTimeoutStop) {
         this.recordingStatus.textContent = 'Aucune donnée audio capturée. Veuillez réessayer.';
      } else {
         this.recordingStatus.textContent = `Enregistrement arrêté (limite ${currentRecordingMinutes} min). Aucune donnée.`;
      }
      await this.generateAndSetDocumentTitleLLM('');
      return;
    }

    let rawTextForTitle = '';
    try {
      URL.createObjectURL(audioBlob); 
      this.recordingStatus.textContent = 
        (isTimeoutStop ? `Enregistrement arrêté (limite ${currentRecordingMinutes} min). ` : '') +
        'Conversion audio en cours...';


      const reader = new FileReader();
      const readResult = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          try {
            const base64data = reader.result as string;
            const base64Audio = base64data.split(',')[1];
            resolve(base64Audio);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(reader.error);
      });
      reader.readAsDataURL(audioBlob);
      const base64Audio = await readResult;

      if (!base64Audio) throw new Error('Failed to convert audio to base64');

      const mimeType = explicitMimeType || this.mediaRecorder?.mimeType || audioBlob.type || 'audio/webm';
      rawTextForTitle = await this.getTranscription(base64Audio, mimeType);
    } catch (error) {
      console.error('Error in processAudio:', error);
      if (isTimeoutStop) {
        this.recordingStatus.textContent = `Enregistrement arrêté (limite ${currentRecordingMinutes} min). Erreur de traitement.`;
      } else {
        this.recordingStatus.textContent = 'Erreur lors du traitement de l\'enregistrement. Veuillez réessayer.';
      }
      if (this.currentNote) {
        this.currentNote.rawTranscription = '';
        this.currentNote.polishedNote = '';
        this.currentNote.summary = '';
      }
      this.isEditingSummary = false;
      this.updatePolishedNoteDisplay();
    } finally {
        // Title generation should happen after all processing, including error handling
        await this.generateAndSetDocumentTitleLLM(rawTextForTitle || this.currentNote?.rawTranscription || '');
    }
  }

  private updateRawTranscriptionDisplay(text: string): void {
    if (text && text.trim() !== '') {
      this.rawTranscription.textContent = text;
      this.rawTranscription.classList.remove('placeholder-active');
    } else {
      const placeholder = this.rawTranscription.getAttribute('placeholder') || '';
      this.rawTranscription.textContent = placeholder;
      this.rawTranscription.classList.add('placeholder-active');
    }
  }

  private async getTranscription(
    base64Audio: string,
    mimeType: string,
  ): Promise<string> { // Returns the transcription text
    const currentRecordingMinutes = this.activeRecordingOriginalMinutesSetting || this.userDefinedMaxRecordingMinutes;
    const statusPrefix = this.recordingStatus.textContent?.startsWith(`Enregistrement arrêté (limite ${currentRecordingMinutes} min).`) ? `Enregistrement arrêté (limite ${currentRecordingMinutes} min). ` : '';
    let transcriptionText = '';
    try {
      this.recordingStatus.textContent = statusPrefix + 'Obtention de la transcription...';

      const contents = [
        {text: 'Generate a complete, detailed transcript of this audio, identifying different speakers (e.g., Speaker 1, Speaker 2).'},
        {inlineData: {mimeType: mimeType, data: base64Audio}},
      ];

      const response: GenerateContentResponse = await this.genAI.models.generateContent({
        model: MODEL_NAME,
        contents: contents,
      });
      
      transcriptionText = response.text || '';


      if (transcriptionText) {
        this.updateRawTranscriptionDisplay(transcriptionText);
        if (this.currentNote)
          this.currentNote.rawTranscription = transcriptionText;
        
        await this.processTranscriptionOutputs();

      } else {
        this.recordingStatus.textContent = statusPrefix + 'La transcription a échoué ou est vide.';
        this.updateRawTranscriptionDisplay('');
        if (this.currentNote) {
            this.currentNote.polishedNote = '';
            this.currentNote.summary = '';
        }
        this.isEditingSummary = false;
        this.updatePolishedNoteDisplay();
      }
    } catch (error) {
      console.error('Error getting transcription:', error);
      this.recordingStatus.textContent = statusPrefix + 'Erreur lors de l\'obtention de la transcription. Veuillez réessayer.';
      this.updateRawTranscriptionDisplay('');
      if (this.currentNote) {
        this.currentNote.polishedNote = '';
        this.currentNote.summary = '';
      }
      this.isEditingSummary = false;
      this.updatePolishedNoteDisplay();
    }
    return transcriptionText; // Return for title generation even if other processing fails
  }

  private async processTranscriptionOutputs(): Promise<void> {
    const rawText = this.currentNote?.rawTranscription;
    const currentRecordingMinutes = this.activeRecordingOriginalMinutesSetting || this.userDefinedMaxRecordingMinutes;
    const statusPrefix = this.recordingStatus.textContent?.startsWith(`Enregistrement arrêté (limite ${currentRecordingMinutes} min).`) ? `Enregistrement arrêté (limite ${currentRecordingMinutes} min). ` : '';

    if (!rawText || rawText.trim() === '') {
      this.recordingStatus.textContent = statusPrefix + 'Aucune transcription à traiter.';
      if (this.currentNote) {
        this.currentNote.polishedNote = '';
        this.currentNote.summary = '';
      }
      this.isEditingSummary = false;
      this.updatePolishedNoteDisplay();
      return;
    }
    this.recordingStatus.textContent = statusPrefix + 'Polissage de la note & génération du résumé...';

    try {
      const [polishedResult, summaryResult] = await Promise.allSettled([
        this.generatePolishedNoteLLM(rawText),
        this.generateSummaryLLM(rawText),
      ]);

      if (this.currentNote) {
        if (polishedResult.status === 'fulfilled') {
            this.currentNote.polishedNote = polishedResult.value;
        } else {
            console.error('Error polishing note:', polishedResult.reason);
            this.currentNote.polishedNote = `Error polishing note: ${polishedResult.reason instanceof Error ? polishedResult.reason.message : String(polishedResult.reason)}`;
        }

        if (summaryResult.status === 'fulfilled') {
            this.currentNote.summary = summaryResult.value;
        } else {
            console.error('Error generating summary:', summaryResult.reason);
            this.currentNote.summary = `Error generating summary: ${summaryResult.reason instanceof Error ? summaryResult.reason.message : String(summaryResult.reason)}`;
        }
      }
      
      this.isEditingSummary = false; // Ensure edit mode is off before updating display with new data
      this.updatePolishedNoteDisplay();
      this.recordingStatus.textContent = statusPrefix + 'Traitement terminé.';


    } catch (error) { 
      console.error('Error processing transcription outputs:', error);
      this.recordingStatus.textContent = statusPrefix + 'Erreur lors du post-traitement.';
      if (this.currentNote) {
        this.currentNote.polishedNote = '';
        this.currentNote.summary = '';
      }
      this.isEditingSummary = false;
      this.updatePolishedNoteDisplay();
    }
  }

  private async generatePolishedNoteLLM(rawTranscriptionText: string): Promise<string> {
    const prompt = `Take this raw transcription (which may include speaker labels such as "Speaker 1:") and create a polished, well-formatted note. Retain the speaker labels.
                  Remove filler words (um, uh, like), repetitions, and false starts.
                  Correct grammar and sentence structure for clarity.
                  Format any lists or bullet points properly. Use markdown formatting for headings, lists, etc.
                  Maintain all the original content and meaning.

                  Raw transcription:
                  ${rawTranscriptionText}`;
    const contents = [{text: prompt}];

    const response: GenerateContentResponse = await this.genAI.models.generateContent({
      model: MODEL_NAME,
      contents: contents,
    });
    return response.text || '';
  }

  private async generateSummaryLLM(rawTranscriptionText: string): Promise<string> {
    const prompt = `Based on the following text (which could be a transcription with speaker labels or extracted text from a document), provide a concise summary **in French** of the key points, decisions, and action items. Format the summary using markdown.

                  Text:
                  ${rawTranscriptionText}`;
    const contents = [{text: prompt}];
    const response: GenerateContentResponse = await this.genAI.models.generateContent({
      model: MODEL_NAME,
      contents: contents,
    });
    return response.text || '';
  }
  
  private updatePolishedNoteDisplay(): void {
    const polishedNoteDiv = this.polishedNote;
    polishedNoteDiv.innerHTML = ''; 
    polishedNoteDiv.classList.remove('placeholder-active'); 

    let hasAnyContent = false;

    // --- Summary Section with Edit Functionality ---
    const summarySectionContainer = document.createElement('div');
    summarySectionContainer.className = 'summary-section-container';

    const summaryHeader = document.createElement('div');
    summaryHeader.className = 'summary-header';
    
    const summaryTitle = document.createElement('h3');
    const timestamp = this.currentNote ? new Date(this.currentNote.timestamp).toLocaleString('fr-FR') : new Date().toLocaleString('fr-FR');
    summaryTitle.textContent = `Résumé - ${timestamp}`; 
    summaryTitle.style.marginTop = '0'; // Keep this if it's the first child of a section
    summaryHeader.appendChild(summaryTitle);

    const summaryControlsDiv = document.createElement('div');
    summaryControlsDiv.className = 'summary-controls';

    const editSummaryButton = document.createElement('button');
    editSummaryButton.className = 'icon-button summary-edit-button';
    editSummaryButton.title = 'Modifier le résumé';
    editSummaryButton.innerHTML = '<i class="fas fa-edit"></i>';
    editSummaryButton.setAttribute('aria-label', 'Modifier le résumé');

    const saveSummaryChangesButton = document.createElement('button');
    saveSummaryChangesButton.className = 'icon-button summary-save-button';
    saveSummaryChangesButton.title = 'Enregistrer les modifications du résumé';
    saveSummaryChangesButton.innerHTML = '<i class="fas fa-save"></i>';
    saveSummaryChangesButton.setAttribute('aria-label', 'Enregistrer les modifications du résumé');

    const cancelSummaryEditButton = document.createElement('button');
    cancelSummaryEditButton.className = 'icon-button summary-cancel-button';
    cancelSummaryEditButton.title = 'Annuler les modifications du résumé';
    cancelSummaryEditButton.innerHTML = '<i class="fas fa-times-circle"></i>';
    cancelSummaryEditButton.setAttribute('aria-label', 'Annuler les modifications du résumé');

    summaryControlsDiv.appendChild(editSummaryButton);
    summaryControlsDiv.appendChild(saveSummaryChangesButton);
    summaryControlsDiv.appendChild(cancelSummaryEditButton);
    summaryHeader.appendChild(summaryControlsDiv);
    summarySectionContainer.appendChild(summaryHeader);

    const summaryDisplayDiv = document.createElement('div');
    summaryDisplayDiv.className = 'summary-content-display';
    summaryDisplayDiv.setAttribute('aria-live', 'polite');

    const summaryEditTextArea = document.createElement('textarea');
    summaryEditTextArea.className = 'summary-edit-textarea';
    summaryEditTextArea.setAttribute('aria-label', 'Éditeur de résumé Markdown');
    
    summarySectionContainer.appendChild(summaryDisplayDiv);
    summarySectionContainer.appendChild(summaryEditTextArea);
    polishedNoteDiv.appendChild(summarySectionContainer);

    if (this.isEditingSummary) {
        summaryDisplayDiv.style.display = 'none';
        editSummaryButton.style.display = 'none';

        summaryEditTextArea.value = this.currentNote?.summary || '';
        summaryEditTextArea.style.display = 'block';
        saveSummaryChangesButton.style.display = 'inline-block';
        cancelSummaryEditButton.style.display = 'inline-block';
        requestAnimationFrame(() => summaryEditTextArea.focus());
        hasAnyContent = true; // Editing implies content or intent to add
    } else {
        summaryDisplayDiv.style.display = 'block';
        editSummaryButton.style.display = 'inline-block';
        
        summaryEditTextArea.style.display = 'none';
        saveSummaryChangesButton.style.display = 'none';
        cancelSummaryEditButton.style.display = 'none';

        if (this.currentNote?.summary && this.currentNote.summary.trim() !== '') {
            summaryDisplayDiv.innerHTML = marked.parse(this.currentNote.summary);
            hasAnyContent = true;
        } else {
            summaryDisplayDiv.innerHTML = `<p class="placeholder-text"><em>Le résumé en français apparaîtra ici après traitement...</em></p>`;
        }
    }

    editSummaryButton.addEventListener('click', () => {
        this.isEditingSummary = true;
        this.updatePolishedNoteDisplay();
    });

    saveSummaryChangesButton.addEventListener('click', () => {
        if (this.currentNote) {
            this.currentNote.summary = summaryEditTextArea.value;
        }
        this.isEditingSummary = false;
        this.updatePolishedNoteDisplay();
    });

    cancelSummaryEditButton.addEventListener('click', () => {
        this.isEditingSummary = false;
        this.updatePolishedNoteDisplay();
    });
    // --- End of Summary Section ---

    polishedNoteDiv.appendChild(document.createElement('hr'));

    const detailedNoteTitle = document.createElement('h3');
    detailedNoteTitle.textContent = 'Note Détaillée';
    polishedNoteDiv.appendChild(detailedNoteTitle);

    const detailedNoteContentDiv = document.createElement('div');
    detailedNoteContentDiv.className = 'detailed-note-section';
    if (this.currentNote?.polishedNote && this.currentNote.polishedNote.trim() !== '') {
      detailedNoteContentDiv.innerHTML = marked.parse(this.currentNote.polishedNote);
      hasAnyContent = true;
    } else {
      detailedNoteContentDiv.innerHTML = `<p class="placeholder-text"><em>La note détaillée (ou un message contextuel pour les PDF) apparaîtra ici...</em></p>`;
    }
    polishedNoteDiv.appendChild(detailedNoteContentDiv);

    if (!hasAnyContent && (!this.currentNote?.summary || this.currentNote.summary.trim() === '') && (!this.currentNote?.polishedNote || this.currentNote.polishedNote.trim() === '')) {
        if (!this.isEditingSummary) { // Only show main placeholder if not actively editing summary
            const placeholderText = this.currentNote?.sourceType === 'pdf' 
                ? "Le résumé du PDF et les informations apparaîtront ici..." 
                : polishedNoteDiv.getAttribute('placeholder') || 'Your polished notes and summary will appear here...';
            polishedNoteDiv.innerHTML = `<p class="placeholder-text">${placeholderText}</p>`; // This would overwrite the structure if summary is empty AND not editing.
                                                                                             // This logic might need rethinking if it clears the edit controls.
                                                                                             // For now, the hasAnyContent check should mostly handle this.
                                                                                             // If summary is empty, hasAnyContent is false unless editing.
            polishedNoteDiv.classList.add('placeholder-active');
        }
    }
     if (!hasAnyContent && !this.isEditingSummary) { // If truly no content and not editing summary
        const placeholderText = this.currentNote?.sourceType === 'pdf' 
            ? "Le résumé du PDF et les informations apparaîtront ici..." 
            : polishedNoteDiv.getAttribute('placeholder') || 'Your polished notes and summary will appear here...';
        // Clear and set placeholder if nothing else is there
        polishedNoteDiv.innerHTML = `<p class="placeholder-text">${placeholderText}</p>`;
        polishedNoteDiv.classList.add('placeholder-active');
    } else if (!hasAnyContent && this.isEditingSummary) {
        // If editing summary but other parts are empty, don't clear the edit controls.
        // The individual placeholders within summaryDisplayDiv and detailedNoteContentDiv will show.
    }
  }

  private async generateAndSetDocumentTitleLLM(sourceText: string): Promise<void> {
    if (!this.editorTitle) return;

    const defaultPlaceholder = this.editorTitle.getAttribute('placeholder') || 'Untitled Note';

    if (!sourceText || sourceText.trim() === '') {
        this.editorTitle.textContent = defaultPlaceholder;
        this.editorTitle.classList.add('placeholder-active');
        return;
    }

    try {
        const prompt = `Génère un titre français très concis d'une seule ligne (maximum 10-12 mots) pour le texte suivant. Ce titre sera utilisé comme nom de fichier ou titre de document. Priorise les noms, les lieux ou les sujets principaux. Évite les phrases introductives comme "Titre :". Texte :\n\n"${sourceText}"`;
        
        const response: GenerateContentResponse = await this.genAI.models.generateContent({
            model: MODEL_NAME,
            contents: [{text: prompt}],
        });

        let title = (response.text || '').trim();


        if (title) {
            title = title.replace(/^["']|["']$/g, ''); 
            title = title.replace(/\.$/, ''); 
            this.editorTitle.textContent = title;
            this.editorTitle.classList.remove('placeholder-active');
        } else {
            const fallbackTitle = this.currentNote 
                ? `Note (${new Date(this.currentNote.timestamp).toLocaleDateString('fr-FR')})` 
                : defaultPlaceholder;
            this.editorTitle.textContent = fallbackTitle;
            this.editorTitle.classList.add('placeholder-active');
        }
    } catch (error) {
        console.error('Error generating document title:', error);
        const fallbackTitle = this.currentNote 
            ? `Note (${new Date(this.currentNote.timestamp).toLocaleDateString('fr-FR')})` 
            : defaultPlaceholder;
        this.editorTitle.textContent = fallbackTitle;
        this.editorTitle.classList.add('placeholder-active');
    }
  }


  private createNewNote(sourceType?: 'audio' | 'pdf'): void {
    if (this.isRecording) {
      this.stopRecording(false).finally(() => this.resetNoteState(sourceType));
      return; 
    }
    
    if (this.isProcessingFile) {
        console.warn("Creating new note while a file is processing.");
    }
    this.isEditingSummary = false; // Cancel summary edit on new note
    this.resetNoteState(sourceType);
  }

  private resetNoteState(sourceType?: 'audio' | 'pdf'): void {
     if (this.maxDurationTimeoutId) {
        clearTimeout(this.maxDurationTimeoutId);
        this.maxDurationTimeoutId = null;
    }
    this.stopLiveDisplay();

    if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
        this.audioContext.close().catch(e => console.warn("Error closing audio context on new note:", e));
        this.audioContext = null;
    }
    
    this.activeRecordingMaxDurationMs = null;
    this.activeRecordingOriginalMinutesSetting = null;
    this.isEditingSummary = false;
    this.currentAudioBlob = null; // Réinitialiser le blob audio


    this.currentNote = {
      id: `note_${Date.now()}`,
      rawTranscription: '',
      polishedNote: '',
      summary: '',
      timestamp: Date.now(),
      sourceType: sourceType,
    };

    this.updateRawTranscriptionDisplay('');
    this.updatePolishedNoteDisplay(); 

    if (this.editorTitle) {
      const placeholder =
        this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
      this.editorTitle.textContent = placeholder;
      this.editorTitle.classList.add('placeholder-active');
    }
    if (!this.isProcessingFile && !this.isRecording) { 
        this.recordingStatus.textContent = this.getCurrentBaseStatus();
    }
  }
  
  private getCurrentBaseStatus(): string {
    if (this.isRecording) {
        const mins = this.activeRecordingOriginalMinutesSetting || this.userDefinedMaxRecordingMinutes;
        return `Enregistrement en cours... (max ${mins} minutes)`;
    }
    if (this.isProcessingFile) {
        return 'Traitement du fichier en cours...';
    }
    return 'Prêt à enregistrer ou téléverser.';
  }

  private async copySummaryToClipboard(): Promise<void> {
    if (this.isEditingSummary) {
        this.displayTemporaryStatus('Veuillez enregistrer ou annuler la modification du résumé avant de copier.', this.getCurrentBaseStatus());
        return;
    }
    if (!this.currentNote || !this.currentNote.summary || this.currentNote.summary.trim() === '') {
      this.displayTemporaryStatus('Aucun résumé à copier.', this.getCurrentBaseStatus());
      return;
    }

    if (!navigator.clipboard) {
      this.displayTemporaryStatus('La copie dans le presse-papiers n\'est pas supportée par ce navigateur.', this.getCurrentBaseStatus(), 5000);
      return;
    }

    this.recordingStatus.textContent = "Copie du résumé...";
    try {
      await navigator.clipboard.writeText(this.currentNote.summary);
      this.displayTemporaryStatus("Résumé copié dans le presse-papiers !", this.getCurrentBaseStatus(), 5000);
    } catch (error) {
      console.error("Erreur lors de la copie dans le presse-papiers:", error);
      this.displayTemporaryStatus("Échec de la copie du résumé. Veuillez réessayer.", this.getCurrentBaseStatus(), 5000);
    }
  }

  private async copyRawTranscriptionToClipboard(): Promise<void> {
    if (!this.currentNote || !this.currentNote.rawTranscription || this.currentNote.rawTranscription.trim() === '') {
      this.displayTemporaryStatus('Aucune transcription brute à copier.', this.getCurrentBaseStatus());
      return;
    }

    if (!navigator.clipboard) {
      this.displayTemporaryStatus('La copie dans le presse-papiers n\'est pas supportée par ce navigateur.', this.getCurrentBaseStatus(), 5000);
      return;
    }
    
    this.recordingStatus.textContent = "Copie de la transcription brute...";
    try {
      await navigator.clipboard.writeText(this.currentNote.rawTranscription);
      this.displayTemporaryStatus("Transcription brute copiée dans le presse-papiers !", this.getCurrentBaseStatus(), 5000);
    } catch (error) {
      console.error("Erreur lors de la copie de la transcription brute:", error);
      this.displayTemporaryStatus("Échec de la copie de la transcription brute. Veuillez réessayer.", this.getCurrentBaseStatus(), 5000);
    }
  }


  private sanitizeFilename(filename: string): string {
    let sanitized = filename.replace(/\s+/g, '_');
    sanitized = sanitized.replace(/[\\/:*?"<>|#%&{}]/g, '');
    sanitized = sanitized.replace(/__+/g, '_');
    sanitized = sanitized.replace(/^_+|_+$/g, '');
    const maxLength = 200;
    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength);
    }
    return sanitized;
  }

  private saveSummaryToFile(): void {
    if (this.isEditingSummary) {
        this.displayTemporaryStatus('Veuillez enregistrer ou annuler la modification du résumé avant d\'enregistrer.', this.getCurrentBaseStatus());
        return;
    }
    if (!this.currentNote || !this.currentNote.summary || this.currentNote.summary.trim() === '') {
      this.displayTemporaryStatus('Aucun résumé à enregistrer.', this.getCurrentBaseStatus());
      return;
    }

    this.recordingStatus.textContent = "Enregistrement du résumé...";

    let noteTitle = this.editorTitle.textContent?.trim();
    const placeholderTitle = this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
    if (!noteTitle || noteTitle === placeholderTitle) {
        const dateStr = new Date(this.currentNote.timestamp).toLocaleDateString('fr-FR').replace(/\//g, '-');
        noteTitle = this.currentNote.sourceType === 'pdf' ? `Resume_PDF_${dateStr}` : `Note_Vocale_${dateStr}`;
    }
    
    const sanitizedTitle = this.sanitizeFilename(noteTitle);
    const filename = `${sanitizedTitle}_Résumé.txt`;
    const summaryContent = this.currentNote.summary;

    try {
      const blob = new Blob([summaryContent], { type: 'text/plain;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      this.displayTemporaryStatus(`Résumé enregistré : ${filename}`, this.getCurrentBaseStatus(), 5000);
    } catch (error) {
      console.error("Erreur lors de l'enregistrement du fichier :", error);
      this.displayTemporaryStatus("Erreur lors de l'enregistrement du fichier.", this.getCurrentBaseStatus(), 5000);
    }
  }

  private saveCurrentAudio(): void {
    if (this.isEditingSummary) {
        this.displayTemporaryStatus('Veuillez enregistrer ou annuler la modification du résumé avant d\'enregistrer l\'audio.', this.getCurrentBaseStatus());
        return;
    }
    if (!this.currentAudioBlob) {
        this.displayTemporaryStatus("Aucun fichier audio à enregistrer. Enregistrez ou téléversez d'abord de l'audio.", this.getCurrentBaseStatus(), 4000);
        return;
    }

    this.recordingStatus.textContent = "Enregistrement du fichier audio...";

    let noteTitle = this.editorTitle.textContent?.trim();
    const placeholderTitle = this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
    if (!noteTitle || noteTitle === placeholderTitle) {
        const dateStr = new Date(this.currentNote?.timestamp || Date.now()).toLocaleDateString('fr-FR').replace(/\//g, '-');
        noteTitle = `Audio_${dateStr}`;
    }

    const sanitizedTitle = this.sanitizeFilename(noteTitle);
    
    let extension = '.audio'; 
    const mimeType = this.currentAudioBlob.type;
    if (mimeType) {
        if (mimeType.includes('webm')) extension = '.webm';
        else if (mimeType.includes('mpeg')) extension = '.mp3';
        else if (mimeType.includes('wav') || mimeType.includes('wave')) extension = '.wav';
        else if (mimeType.includes('ogg')) extension = '.ogg';
        else if (mimeType.includes('mp4')) extension = '.m4a'; // Common for audio/mp4
        else {
            const specificType = mimeType.split('/')[1];
            if (specificType) extension = `.${specificType.split('+')[0]}`; 
        }
    }

    const filename = `${sanitizedTitle}_Audio${extension}`;

    try {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(this.currentAudioBlob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        this.displayTemporaryStatus(`Fichier audio enregistré : ${filename}`, this.getCurrentBaseStatus(), 5000);
    } catch (error) {
        console.error("Erreur lors de l'enregistrement du fichier audio :", error);
        this.displayTemporaryStatus("Erreur lors de l'enregistrement du fichier audio.", this.getCurrentBaseStatus(), 5000);
    }
  }

}

document.addEventListener('DOMContentLoaded', () => {
  new VoiceNotesApp();

  document
    .querySelectorAll<HTMLElement>('[contenteditable="true"][placeholder]')
    .forEach((el) => {
      const placeholder = el.getAttribute('placeholder')!;

      function updatePlaceholderState() {
        const currentText = el.textContent?.trim();

        if (currentText === '' || currentText === placeholder) {
          if (currentText === '') { 
            el.textContent = placeholder;
          }
          el.classList.add('placeholder-active');
        } else {
          el.classList.remove('placeholder-active');
        }
      }

      updatePlaceholderState(); 

      el.addEventListener('focus', function () {
        if (this.textContent?.trim() === placeholder) {
          this.textContent = '';
          this.classList.remove('placeholder-active');
        }
      });

      el.addEventListener('blur', function () {
        updatePlaceholderState(); 
      });
    });
});

export {};
