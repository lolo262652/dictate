/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {GoogleGenAI, GenerateContentResponse} from '@google/genai';
import {marked} from 'marked';
import JSZip from 'jszip';

// Déclaration pour pdf.js si le typage global n'est pas disponible
declare var pdfjsLib: any;

const MODEL_NAME = 'gemini-2.5-flash-preview-04-17';

interface Note {
  id: string;
  rawTranscription: string;
  polishedNote: string;
  summary: string;
  timestamp: number;
  sourceType?: 'audio' | 'pdf';
  audioBlob?: Blob;
  audioMimeType?: string;
}

class VoiceNotesApp {
  private genAI: GoogleGenAI;
  private mediaRecorder: MediaRecorder | null = null;
  private recordButton: HTMLButtonElement;
  private recordingStatus: HTMLDivElement;
  
  private summaryEditor: HTMLDivElement; // For editable summary
  private polishedNote: HTMLDivElement; // For read-only detailed note
  private rawTranscription: HTMLDivElement; // For editable raw transcription

  private newButton: HTMLButtonElement;
  private themeToggleButton: HTMLButtonElement;
  private copySummaryButton: HTMLButtonElement;
  private saveSummaryButton: HTMLButtonElement;
  private copyRawTranscriptionButton: HTMLButtonElement;
  private uploadAudioButton: HTMLButtonElement;
  private audioFileUploadInput: HTMLInputElement;
  private uploadPdfButton: HTMLButtonElement;
  private pdfFileUploadInput: HTMLInputElement;
  private durationInput: HTMLInputElement;
  private setDurationButton: HTMLButtonElement;
  private themeToggleIcon: HTMLElement;
  private editorTitle: HTMLDivElement;

  private refreshAllButton: HTMLButtonElement;
  private refreshNoteFromSummaryButton: HTMLButtonElement;
  private saveAllButton: HTMLButtonElement;


  private audioChunks: Blob[] = [];
  private isRecording = false;
  private isProcessingFile = false;
  private currentNote: Note | null = null;
  private stream: MediaStream | null = null;

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

  private userDefinedMaxRecordingMinutes: number = 30;
  private activeRecordingMaxDurationMs: number | null = null;
  private activeRecordingOriginalMinutesSetting: number | null = null;
  private maxDurationTimeoutId: number | null = null;


  constructor() {
    this.genAI = new GoogleGenAI({
      apiKey: process.env.API_KEY!,
    });

    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    } else {
        console.error("pdfjsLib is not defined. PDF processing will not work.");
        const statusElement = document.getElementById('recordingStatus');
        if (statusElement) {
            statusElement.textContent = "Erreur: La bibliothèque PDF n'a pas pu être chargée.";
        }
    }

    this.recordButton = document.getElementById('recordButton') as HTMLButtonElement;
    this.recordingStatus = document.getElementById('recordingStatus') as HTMLDivElement;
    
    this.summaryEditor = document.getElementById('summaryEditor') as HTMLDivElement;
    this.polishedNote = document.getElementById('polishedNote') as HTMLDivElement;
    this.rawTranscription = document.getElementById('rawTranscription') as HTMLDivElement;

    this.newButton = document.getElementById('newButton') as HTMLButtonElement;
    this.themeToggleButton = document.getElementById('themeToggleButton') as HTMLButtonElement;
    this.copySummaryButton = document.getElementById('copySummaryButton') as HTMLButtonElement;
    this.saveSummaryButton = document.getElementById('saveSummaryButton') as HTMLButtonElement;
    this.saveAllButton = document.getElementById('saveAllButton') as HTMLButtonElement;
    this.copyRawTranscriptionButton = document.getElementById('copyRawTranscriptionButton') as HTMLButtonElement;
    
    this.uploadAudioButton = document.getElementById('uploadAudioButton') as HTMLButtonElement;
    this.audioFileUploadInput = document.getElementById('audioFileUpload') as HTMLInputElement;
    this.uploadPdfButton = document.getElementById('uploadPdfButton') as HTMLButtonElement;
    this.pdfFileUploadInput = document.getElementById('pdfFileUpload') as HTMLInputElement;
    this.durationInput = document.getElementById('durationInput') as HTMLInputElement;
    this.setDurationButton = document.getElementById('setDurationButton') as HTMLButtonElement;
    this.themeToggleIcon = this.themeToggleButton.querySelector('i') as HTMLElement;
    this.editorTitle = document.querySelector('.editor-title') as HTMLDivElement;

    this.refreshAllButton = document.getElementById('refreshAllButton') as HTMLButtonElement;
    this.refreshNoteFromSummaryButton = document.getElementById('refreshNoteFromSummaryButton') as HTMLButtonElement;

    this.recordingInterface = document.querySelector('.recording-interface') as HTMLDivElement;
    this.liveRecordingTitle = document.getElementById('liveRecordingTitle') as HTMLDivElement;
    this.liveWaveformCanvas = document.getElementById('liveWaveformCanvas') as HTMLCanvasElement;
    this.liveRecordingTimerDisplay = document.getElementById('liveRecordingTimerDisplay') as HTMLDivElement;

    if (this.liveWaveformCanvas) {
      this.liveWaveformCtx = this.liveWaveformCanvas.getContext('2d');
    } else {
      console.warn('Live waveform canvas element not found. Visualizer will not work.');
    }

    if (this.recordingInterface) {
      this.statusIndicatorDiv = this.recordingInterface.querySelector('.status-indicator') as HTMLDivElement;
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
    this.saveAllButton.addEventListener('click', () => this.saveAllPackage());
    this.copyRawTranscriptionButton.addEventListener('click', () => this.copyRawTranscriptionToClipboard());
    
    this.uploadAudioButton.addEventListener('click', () => this.triggerFileUpload());
    this.audioFileUploadInput.addEventListener('change', (event) => this.handleFileUpload(event));

    this.uploadPdfButton.addEventListener('click', () => this.triggerPdfUpload());
    this.pdfFileUploadInput.addEventListener('change', (event) => this.handlePdfUpload(event));
    
    this.setDurationButton.addEventListener('click', () => this.handleSetDuration());
    this.refreshAllButton.addEventListener('click', () => this.handleRefreshAllFromRawText());
    this.refreshNoteFromSummaryButton.addEventListener('click', () => this.handleRefreshDetailedNoteFromSummary());

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
        this.recordingStatus.textContent = 'La durée ne peut être modifiée pendant l\'enregistrement.';
        setTimeout(() => {
            if (this.recordingStatus.textContent === 'La durée ne peut être modifiée pendant l\'enregistrement.') {
                 this.recordingStatus.textContent = this.getCurrentBaseStatus();
            }
        }, 3000);
        if (this.activeRecordingOriginalMinutesSetting) {
            this.durationInput.value = String(this.activeRecordingOriginalMinutesSetting);
        } else {
            this.durationInput.value = String(this.userDefinedMaxRecordingMinutes);
        }
        return;
    }

    const newDurationMinutes = parseInt(this.durationInput.value, 10);
    if (!isNaN(newDurationMinutes) && newDurationMinutes >= 1 && newDurationMinutes <= 120) {
        this.userDefinedMaxRecordingMinutes = newDurationMinutes;
        this.recordingStatus.textContent = `Durée max réglée à ${newDurationMinutes} minutes.`;
    } else {
        this.recordingStatus.textContent = 'Durée invalide. Entrez une valeur entre 1 et 120 minutes.';
        this.durationInput.value = String(this.userDefinedMaxRecordingMinutes);
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
    this.setButtonsDisabled(true);
    this.createNewNote('audio');

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
        this.currentNote.summary = '';
        this.currentNote.polishedNote = `Error processing uploaded audio: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.updateSummaryEditorDisplay('');
      this.updatePolishedNoteDisplay();
      await this.generateAndSetDocumentTitleLLM(this.currentNote?.rawTranscription || '');
    } finally {
        this.isProcessingFile = false;
        this.setButtonsDisabled(false);
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
    this.setButtonsDisabled(true);
    this.createNewNote('pdf');

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
            this.currentNote.summary = '';
            this.currentNote.polishedNote = "Aucun texte extrait du PDF. Le résumé et la note détaillée ne peuvent être générés.";
        }
        this.updateRawTranscriptionDisplay('');
        this.updateSummaryEditorDisplay('');
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
        this.currentNote.polishedNote = "La note détaillée pour les PDF est contextuelle. Le texte intégral extrait du PDF est dans l'onglet 'Brut' et le résumé est ci-dessus (ou dans l'onglet 'Résumé').";
      }
      this.updateSummaryEditorDisplay(summary);
      this.updatePolishedNoteDisplay();
      await this.generateAndSetDocumentTitleLLM(extractedText);
      this.recordingStatus.textContent = 'Résumé du PDF généré.';

    } catch (err) {
      console.error('Error processing PDF file:', err);
      this.recordingStatus.textContent = 'Erreur lors du traitement du PDF.';
      if (this.currentNote) {
        this.currentNote.rawTranscription = (err instanceof Error ? `Erreur d'extraction PDF: ${err.message}` : `Erreur d'extraction PDF.`);
        this.currentNote.summary = '';
        this.currentNote.polishedNote = `Erreur lors du traitement du PDF: ${err instanceof Error ? err.message : String(err)}`;
      }
      this.updateRawTranscriptionDisplay(this.currentNote?.rawTranscription || '');
      this.updateSummaryEditorDisplay('');
      this.updatePolishedNoteDisplay();
      await this.generateAndSetDocumentTitleLLM(this.currentNote?.rawTranscription || extractedText);
    } finally {
      this.isProcessingFile = false;
      this.setButtonsDisabled(false);
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
    if (this.isRecording && this.liveWaveformCanvas && this.liveWaveformCanvas.style.display === 'block') {
      requestAnimationFrame(() => { this.setupCanvasDimensions(); });
    }
  }

  private setupCanvasDimensions(): void {
    if (!this.liveWaveformCanvas || !this.liveWaveformCtx) return;
    const canvas = this.liveWaveformCanvas;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
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
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.75;
    const bufferLength = this.analyserNode.frequencyBinCount;
    this.waveformDataArray = new Uint8Array(bufferLength);
    source.connect(this.analyserNode);
  }

  private drawLiveWaveform(): void {
    if (!this.analyserNode || !this.waveformDataArray || !this.liveWaveformCtx || !this.liveWaveformCanvas || !this.isRecording) {
      if (this.waveformDrawingId) cancelAnimationFrame(this.waveformDrawingId);
      this.waveformDrawingId = null;
      return;
    }
    this.waveformDrawingId = requestAnimationFrame(() => this.drawLiveWaveform());
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
    const recordingColor = getComputedStyle(document.documentElement).getPropertyValue('--color-recording').trim() || '#ff3b30';
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
    if (!this.recordingInterface || !this.liveRecordingTitle || !this.liveWaveformCanvas || !this.liveRecordingTimerDisplay) {
      console.warn('One or more live display elements are missing. Cannot start live display.');
      return;
    }
    this.recordingInterface.classList.add('is-live');
    this.liveRecordingTitle.style.display = 'block';
    this.liveWaveformCanvas.style.display = 'block';
    this.liveRecordingTimerDisplay.style.display = 'block';
    this.setupCanvasDimensions();
    if (this.statusIndicatorDiv) this.statusIndicatorDiv.style.display = 'none';
    const iconElement = this.recordButton.querySelector('.record-button-inner i') as HTMLElement;
    if (iconElement) {
      iconElement.classList.remove('fa-microphone');
      iconElement.classList.add('fa-stop');
    }
    const currentTitle = this.editorTitle.textContent?.trim();
    const placeholder = this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
    this.liveRecordingTitle.textContent = currentTitle && currentTitle !== placeholder ? currentTitle : 'New Recording';
    this.setupAudioVisualizer();
    this.drawLiveWaveform();
    this.recordingStartTime = Date.now();
    this.updateLiveTimer();
    if (this.timerIntervalId) clearInterval(this.timerIntervalId);
    this.timerIntervalId = window.setInterval(() => this.updateLiveTimer(), 50);
  }

  private stopLiveDisplay(): void {
    if (!this.recordingInterface || !this.liveRecordingTitle || !this.liveWaveformCanvas || !this.liveRecordingTimerDisplay) {
      if (this.recordingInterface) this.recordingInterface.classList.remove('is-live');
      return;
    }
    this.recordingInterface.classList.remove('is-live');
    this.liveRecordingTitle.style.display = 'none';
    this.liveWaveformCanvas.style.display = 'none';
    this.liveRecordingTimerDisplay.style.display = 'none';
    if (this.statusIndicatorDiv) this.statusIndicatorDiv.style.display = 'block';
    const iconElement = this.recordButton.querySelector('.record-button-inner i') as HTMLElement;
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
      this.liveWaveformCtx.clearRect(0, 0, this.liveWaveformCanvas.width, this.liveWaveformCanvas.height);
    }
    if (this.audioContext) {
      if (this.audioContext.state !== 'closed') {
        this.audioContext.close().catch((e) => console.warn('Error closing audio context', e));
      }
      this.audioContext = null;
    }
    this.analyserNode = null;
    this.waveformDataArray = null;
  }

  private async startRecording(): Promise<void> {
    try {
      this.audioChunks = [];
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
      if (this.audioContext && this.audioContext.state !== 'closed') {
        await this.audioContext.close();
        this.audioContext = null;
      }
      this.recordingStatus.textContent = 'Demande d\'accès au microphone...';
      this.createNewNote('audio');
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({audio: true});
      } catch (err) {
        console.error('Failed with basic constraints:', err);
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      }
      try {
        this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm' });
      } catch (e) {
        console.error('audio/webm not supported, trying default:', e);
        this.mediaRecorder = new MediaRecorder(this.stream);
      }
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) this.audioChunks.push(event.data);
      };
      this.mediaRecorder.onstop = () => {
        this.stopLiveDisplay();
        const stoppedByTimeout = this.recordingStatus.textContent?.includes(`limite ${this.activeRecordingOriginalMinutesSetting} min`);
        if (this.audioChunks.length > 0) {
          const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder?.mimeType || 'audio/webm' });
          this.isProcessingFile = true;
          this.setButtonsDisabled(true);
          this.processAudio(audioBlob, this.mediaRecorder?.mimeType || 'audio/webm').catch((err) => { // Pass mimeType explicitly
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
            this.setButtonsDisabled(false);
            if (!this.recordingStatus.textContent?.includes('Erreur')) {
                 this.recordingStatus.textContent = this.getCurrentBaseStatus();
            }
          });
        } else {
          if (!stoppedByTimeout) {
             this.recordingStatus.textContent = 'Aucune donnée audio capturée. Veuillez réessayer.';
          }
           this.recordingStatus.textContent = this.getCurrentBaseStatus();
        }
        if (this.stream) {
          this.stream.getTracks().forEach((track) => { track.stop(); });
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorName = error instanceof Error ? error.name : 'Unknown';
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        this.recordingStatus.textContent = 'Permission du microphone refusée. Veuillez vérifier les paramètres du navigateur et recharger la page.';
      } else if (errorName === 'NotFoundError' || (errorName === 'DOMException' && errorMessage.includes('Requested device not found'))) {
        this.recordingStatus.textContent = 'Aucun microphone trouvé. Veuillez connecter un microphone.';
      } else if (errorName === 'NotReadableError' || errorName === 'AbortError' || (errorName === 'DOMException' && errorMessage.includes('Failed to allocate audiosource'))) {
        this.recordingStatus.textContent = 'Impossible d\'accéder au microphone. Il est peut-être utilisé par une autre application.';
      } else {
        this.recordingStatus.textContent = `Erreur : ${errorMessage}`;
      }
      this.isRecording = false;
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
      this.recordingStatus.textContent = this.getCurrentBaseStatus();
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
    if (stoppedByTimeout) { this.playBeepSound(); }
    if (this.maxDurationTimeoutId) {
      clearTimeout(this.maxDurationTimeoutId);
      this.maxDurationTimeoutId = null;
    }
    if (this.mediaRecorder && this.isRecording) {
      try {
        if (stoppedByTimeout) {
            this.recordingStatus.textContent = `Enregistrement arrêté (limite ${currentRecordingMinutes} min). Traitement...`;
        } else {
            if (!this.recordingStatus.textContent?.includes(`limite ${currentRecordingMinutes} min`)) {
               this.recordingStatus.textContent = 'Traitement audio en cours...';
            }
        }
        this.mediaRecorder.stop();
      } catch (e) {
        console.error('Error stopping MediaRecorder:', e);
        this.stopLiveDisplay();
        this.isProcessingFile = false;
        this.setButtonsDisabled(false);
        this.recordingStatus.textContent = this.getCurrentBaseStatus();
      }
      this.isRecording = false;
      this.recordButton.classList.remove('recording');
      this.recordButton.setAttribute('title', 'Start Recording');
    } else {
       if (!this.isRecording) { this.stopLiveDisplay(); }
    }
  }

  private async processAudio(audioBlob: Blob, explicitMimeType?: string): Promise<void> {
    if (this.currentNote) {
        this.currentNote.audioBlob = audioBlob;
        this.currentNote.audioMimeType = explicitMimeType || this.mediaRecorder?.mimeType || audioBlob.type || 'audio/webm';
    }

    const currentRecordingMinutes = this.activeRecordingOriginalMinutesSetting || this.userDefinedMaxRecordingMinutes;
    const isTimeoutStop = this.recordingStatus.textContent?.includes(`limite ${currentRecordingMinutes} min`);

    if (audioBlob.size === 0) {
      if (!isTimeoutStop) {
         this.recordingStatus.textContent = 'Aucune donnée audio capturée. Veuillez réessayer.';
      } else {
         this.recordingStatus.textContent = `Enregistrement arrêté (limite ${currentRecordingMinutes} min). Aucune donnée.`;
      }
      this.updateRawTranscriptionDisplay('');
      this.updateSummaryEditorDisplay('');
      this.updatePolishedNoteDisplay();
      await this.generateAndSetDocumentTitleLLM('');
      return;
    }

    let rawTextForTitle: string = '';
    try {
      URL.createObjectURL(audioBlob);
      this.recordingStatus.textContent = (isTimeoutStop ? `Enregistrement arrêté (limite ${currentRecordingMinutes} min). ` : '') + 'Conversion audio en cours...';
      const reader = new FileReader();
      const readResult = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          try {
            const base64data = reader.result as string;
            const base64Audio = base64data.split(',')[1];
            resolve(base64Audio);
          } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(reader.error);
      });
      reader.readAsDataURL(audioBlob);
      const base64Audio = await readResult;
      if (!base64Audio) throw new Error('Failed to convert audio to base64');
      const mimeTypeToUse = this.currentNote?.audioMimeType || 'audio/webm'; // Use stored mimetype
      rawTextForTitle = await this.getTranscription(base64Audio, mimeTypeToUse);
    } catch (error) {
      console.error('Error in processAudio:', error);
      const errorStatus = isTimeoutStop ? `Enregistrement arrêté (limite ${currentRecordingMinutes} min). Erreur de traitement.` : 'Erreur lors du traitement de l\'enregistrement. Veuillez réessayer.';
      this.recordingStatus.textContent = errorStatus;
      if (this.currentNote) {
        this.currentNote.rawTranscription = '';
        this.currentNote.summary = '';
        this.currentNote.polishedNote = '';
      }
      this.updateRawTranscriptionDisplay('');
      this.updateSummaryEditorDisplay('');
      this.updatePolishedNoteDisplay();
    } finally {
        await this.generateAndSetDocumentTitleLLM(rawTextForTitle || this.currentNote?.rawTranscription || '');
    }
  }
  
  private updateRawTranscriptionDisplay(text: string): void {
    this.updateContentEditableDiv(this.rawTranscription, text);
  }

  private updateSummaryEditorDisplay(text: string): void {
    this.updateContentEditableDiv(this.summaryEditor, text);
  }

  private updateContentEditableDiv(div: HTMLDivElement, text: string): void {
    if (text && text.trim() !== '') {
      div.textContent = text;
      div.classList.remove('placeholder-active');
    } else {
      const placeholder = div.getAttribute('placeholder') || '';
      div.textContent = placeholder;
      div.classList.add('placeholder-active');
    }
  }


  private async getTranscription(base64Audio: string, mimeType: string): Promise<string> {
    const currentRecordingMinutes = this.activeRecordingOriginalMinutesSetting || this.userDefinedMaxRecordingMinutes;
    const statusPrefix = this.recordingStatus.textContent?.startsWith(`Enregistrement arrêté (limite ${currentRecordingMinutes} min).`) ? `Enregistrement arrêté (limite ${currentRecordingMinutes} min). ` : '';
    let transcriptionText = '';
    try {
      this.recordingStatus.textContent = statusPrefix + 'Obtention de la transcription...';
      const contents = [
        {text: 'Generate a complete, detailed transcript of this audio, identifying different speakers (e.g., Speaker 1, Speaker 2). Ensure the output is plain text.'},
        {inlineData: {mimeType: mimeType, data: base64Audio}},
      ];
      const response: GenerateContentResponse = await this.genAI.models.generateContent({ model: MODEL_NAME, contents: contents });
      transcriptionText = response.text as string; // Cast to string

      if (transcriptionText && this.currentNote) {
        this.currentNote.rawTranscription = transcriptionText;
        this.updateRawTranscriptionDisplay(transcriptionText);
        
        this.recordingStatus.textContent = statusPrefix + 'Génération du résumé...';
        const summary = await this.generateSummaryLLM(transcriptionText);
        this.currentNote.summary = summary;
        this.updateSummaryEditorDisplay(summary);

        this.recordingStatus.textContent = statusPrefix + 'Génération de la note détaillée...';
        const polishedNote = await this.generatePolishedNoteLLM(transcriptionText, summary);
        this.currentNote.polishedNote = polishedNote;
        this.updatePolishedNoteDisplay();
        this.recordingStatus.textContent = statusPrefix + 'Traitement terminé.';
      } else {
        this.recordingStatus.textContent = statusPrefix + 'La transcription a échoué ou est vide.';
        this.updateRawTranscriptionDisplay('');
        this.updateSummaryEditorDisplay('');
        this.updatePolishedNoteDisplay();
        if (this.currentNote) { this.currentNote.rawTranscription = ''; this.currentNote.summary = ''; this.currentNote.polishedNote = '';}
      }
    } catch (error) {
      console.error('Error getting transcription and derived content:', error);
      this.recordingStatus.textContent = statusPrefix + 'Erreur lors de la génération du contenu. Veuillez réessayer.';
      this.updateRawTranscriptionDisplay('');
      this.updateSummaryEditorDisplay('');
      this.updatePolishedNoteDisplay();
      if (this.currentNote) { this.currentNote.rawTranscription = ''; this.currentNote.summary = ''; this.currentNote.polishedNote = '';}
    }
    return transcriptionText;
  }

  private async generatePolishedNoteLLM(rawTranscriptionText: string, summaryContext: string): Promise<string> {
    const prompt = `Based on the following raw transcription AND its accompanying summary, create a polished, well-formatted detailed note IN FRENCH.
                  Retain speaker labels from the raw transcription (e.g., Speaker 1:).
                  Remove filler words (um, uh, like), repetitions, and false starts from the raw transcription content.
                  Correct grammar and sentence structure for clarity.
                  The detailed note should expand on the summary, providing more context and information from the raw transcription, but be consistent with the key points highlighted in the summary.
                  Format any lists or bullet points properly using markdown. Maintain all essential original content and meaning.
                  The output should be in Markdown format.

                  Raw transcription:
                  ${rawTranscriptionText}

                  Summary:
                  ${summaryContext}`;
    const contents = [{text: prompt}];
    const response: GenerateContentResponse = await this.genAI.models.generateContent({ model: MODEL_NAME, contents: contents });
    const noteText = response.text as string; // Cast to string
    return noteText || '';
  }

  private async generateSummaryLLM(rawTranscriptionText: string): Promise<string> {
    const prompt = `Basé sur le texte suivant (qui pourrait être une transcription avec identification des locuteurs ou du texte extrait d'un document), fournissez un résumé concis **en français**.
Le résumé doit inclure :
- Les points clés généraux.
- Les décisions prises.
- Les points d'action généraux (tâches à accomplir).

De plus, à la toute fin du résumé, veuillez explicitement lister sous des titres dédiés :
- Les **points spécifiques abordés durant la discussion/réunion** (par exemple, sous un titre comme "### Points Abordés"). Chaque point doit être formaté comme un élément de liste de tâches Markdown non cochée (par exemple, \`- [ ] Point abordé 1\`). Chaque point doit impérativement apparaître sur sa propre ligne distincte, c'est-à-dire **un seul point par ligne.**
- Les **points spécifiques à réaliser** (par exemple, sous un titre comme "### Actions à Entreprendre"). Chaque point doit être formaté comme un élément de liste de tâches Markdown non cochée (par exemple, \`- [ ] Action à réaliser 1\`). Chaque point doit impérativement apparaître sur sa propre ligne distincte, c'est-à-dire **un seul point par ligne.**

Assurez-vous que ces deux listes de tâches spécifiques soient les dernières sections du résumé et que chaque élément de ces listes soit sur une nouvelle ligne.
Formatez l'ensemble du résumé en utilisant markdown, en structurant clairement toutes les sections demandées.

Texte :
${rawTranscriptionText}`;
    const contents = [{text: prompt}];
    const response: GenerateContentResponse = await this.genAI.models.generateContent({ model: MODEL_NAME, contents: contents });
    const summaryText = response.text as string; // Cast to string
    return summaryText || '';
  }
  
  private updatePolishedNoteDisplay(): void {
    const polishedNoteDiv = this.polishedNote;
    polishedNoteDiv.innerHTML = '';
    polishedNoteDiv.classList.remove('placeholder-active');

    if (this.currentNote?.polishedNote && this.currentNote.polishedNote.trim() !== '') {
      polishedNoteDiv.innerHTML = marked.parse(this.currentNote.polishedNote);
    } else {
      const placeholderText = this.currentNote?.sourceType === 'pdf'
          ? "La note détaillée pour les PDF est contextuelle ou peut être générée si un résumé est fourni."
          : polishedNoteDiv.getAttribute('placeholder') || 'La note détaillée (lecture seule) apparaîtra ici...';
      polishedNoteDiv.innerHTML = `<p class="placeholder-text">${placeholderText}</p>`;
      polishedNoteDiv.classList.add('placeholder-active');
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
        const response: GenerateContentResponse = await this.genAI.models.generateContent({ model: MODEL_NAME, contents: [{text: prompt}] });
        const textFromApi: string = response.text as string; // Cast to string
        let title = textFromApi.trim();
        if (title) {
            title = title.replace(/^["']|["']$/g, '');
            title = title.replace(/\.$/, '');
            this.editorTitle.textContent = title;
            this.editorTitle.classList.remove('placeholder-active');
        } else {
            const fallbackTitle = this.currentNote ? `Note (${new Date(this.currentNote.timestamp).toLocaleDateString('fr-FR')})` : defaultPlaceholder;
            this.editorTitle.textContent = fallbackTitle;
            this.editorTitle.classList.add('placeholder-active');
        }
    } catch (error) {
        console.error('Error generating document title:', error);
        const fallbackTitle = this.currentNote ? `Note (${new Date(this.currentNote.timestamp).toLocaleDateString('fr-FR')})` : defaultPlaceholder;
        this.editorTitle.textContent = fallbackTitle;
        this.editorTitle.classList.add('placeholder-active');
    }
  }

  private createNewNote(sourceType?: 'audio' | 'pdf'): void {
    if (this.isRecording) {
      this.stopRecording(false).finally(() => this.resetNoteState(sourceType));
      return;
    }
    if (this.isProcessingFile) { console.warn("Creating new note while a file is processing."); }
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

    this.currentNote = {
      id: `note_${Date.now()}`,
      rawTranscription: '',
      polishedNote: '',
      summary: '',
      timestamp: Date.now(),
      sourceType: sourceType,
      audioBlob: undefined,
      audioMimeType: undefined,
    };

    this.updateRawTranscriptionDisplay('');
    this.updateSummaryEditorDisplay('');
    this.updatePolishedNoteDisplay();

    if (this.editorTitle) {
      const placeholder = this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
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
    if (this.isProcessingFile) { return 'Traitement du fichier en cours...'; }
    return 'Prêt à enregistrer ou téléverser.';
  }

  private setButtonsDisabled(disabled: boolean): void {
    this.recordButton.disabled = disabled;
    this.uploadAudioButton.disabled = disabled;
    this.uploadPdfButton.disabled = disabled;
    this.newButton.disabled = disabled;
    this.refreshAllButton.disabled = disabled;
    this.refreshNoteFromSummaryButton.disabled = disabled;
    this.saveSummaryButton.disabled = disabled;
    this.saveAllButton.disabled = disabled;
    this.setDurationButton.disabled = disabled;
    this.durationInput.disabled = disabled;
  }

  private async handleRefreshAllFromRawText(): Promise<void> {
    if (!this.currentNote) {
        this.displayTemporaryStatus('Aucune note active à actualiser.', this.getCurrentBaseStatus());
        return;
    }
    const rawTextFromEditor = this.rawTranscription.textContent?.trim() === this.rawTranscription.getAttribute('placeholder')?.trim()
                            ? ''
                            : this.rawTranscription.textContent || '';

    if (!rawTextFromEditor && this.currentNote.sourceType !== 'pdf') {
        this.displayTemporaryStatus('Aucun texte brut à traiter.', this.getCurrentBaseStatus());
        return;
    }
    
    this.isProcessingFile = true;
    this.setButtonsDisabled(true);
    this.recordingStatus.textContent = 'Actualisation de tous les contenus...';

    this.currentNote.rawTranscription = rawTextFromEditor;

    try {
        if (this.currentNote.sourceType === 'pdf') {
            this.recordingStatus.textContent = 'Actualisation du résumé pour le PDF...';
            const summary = await this.generateSummaryLLM(this.currentNote.rawTranscription);
            this.currentNote.summary = summary;
            this.updateSummaryEditorDisplay(summary);
            this.currentNote.polishedNote = "La note détaillée pour les PDF est contextuelle. Le texte intégral extrait du PDF est dans l'onglet 'Brut' et le résumé est ci-dessus (ou dans l'onglet 'Résumé').";
            this.updatePolishedNoteDisplay();
        } else {
            this.recordingStatus.textContent = 'Actualisation du résumé...';
            const summary = await this.generateSummaryLLM(this.currentNote.rawTranscription);
            this.currentNote.summary = summary;
            this.updateSummaryEditorDisplay(summary);

            this.recordingStatus.textContent = 'Actualisation de la note détaillée...';
            const polishedNote = await this.generatePolishedNoteLLM(this.currentNote.rawTranscription, this.currentNote.summary);
            this.currentNote.polishedNote = polishedNote;
            this.updatePolishedNoteDisplay();
        }

        this.recordingStatus.textContent = 'Actualisation du titre du document...';
        await this.generateAndSetDocumentTitleLLM(this.currentNote.rawTranscription);
        this.recordingStatus.textContent = 'Actualisation terminée.';
    } catch (error) {
        console.error('Error during refresh all:', error);
        this.recordingStatus.textContent = 'Erreur lors de l\'actualisation.';
    } finally {
        this.isProcessingFile = false;
        this.setButtonsDisabled(false);
        setTimeout(() => {
             if (this.recordingStatus.textContent === 'Actualisation terminée.' || this.recordingStatus.textContent === 'Erreur lors de l\'actualisation.') {
                this.recordingStatus.textContent = this.getCurrentBaseStatus();
             }
        }, 3000);
    }
}

private async handleRefreshDetailedNoteFromSummary(): Promise<void> {
    if (!this.currentNote) {
        this.displayTemporaryStatus('Aucune note active à actualiser.', this.getCurrentBaseStatus());
        return;
    }
    if (this.currentNote.sourceType === 'pdf') {
        this.displayTemporaryStatus("Cette fonction est optimisée pour les notes audio. Pour les PDF, modifiez le résumé et utilisez 'Tout actualiser'.", this.getCurrentBaseStatus(), 5000);
        return;
    }

    const summaryTextFromEditor = this.summaryEditor.textContent?.trim() === this.summaryEditor.getAttribute('placeholder')?.trim()
                                ? ''
                                : this.summaryEditor.textContent || '';

    if (!summaryTextFromEditor) {
        this.displayTemporaryStatus('Aucun résumé à utiliser pour actualiser la note détaillée.', this.getCurrentBaseStatus());
        return;
    }
    if (!this.currentNote.rawTranscription) {
        this.displayTemporaryStatus('Le texte brut original est manquant pour actualiser la note détaillée.', this.getCurrentBaseStatus());
        return;
    }

    this.isProcessingFile = true;
    this.setButtonsDisabled(true);
    this.recordingStatus.textContent = 'Actualisation de la note détaillée à partir du résumé...';

    this.currentNote.summary = summaryTextFromEditor;

    try {
        const polishedNote = await this.generatePolishedNoteLLM(this.currentNote.rawTranscription, this.currentNote.summary);
        this.currentNote.polishedNote = polishedNote;
        this.updatePolishedNoteDisplay();
        this.recordingStatus.textContent = 'Note détaillée actualisée.';
    } catch (error) {
        console.error('Error refreshing polished note from summary:', error);
        this.recordingStatus.textContent = 'Erreur lors de l\'actualisation de la note détaillée.';
    } finally {
        this.isProcessingFile = false;
        this.setButtonsDisabled(false);
         setTimeout(() => {
             if (this.recordingStatus.textContent === 'Note détaillée actualisée.' || this.recordingStatus.textContent === 'Erreur lors de l\'actualisation de la note détaillée.') {
                this.recordingStatus.textContent = this.getCurrentBaseStatus();
             }
        }, 3000);
    }
}


  private async copySummaryToClipboard(): Promise<void> {
    const summaryText = this.currentNote?.summary || '';
    if (!summaryText || summaryText.trim() === '' || summaryText.trim() === this.summaryEditor.getAttribute('placeholder')?.trim()) {
      this.displayTemporaryStatus('Aucun résumé à copier.', this.getCurrentBaseStatus());
      return;
    }
    if (!navigator.clipboard) {
      this.displayTemporaryStatus('La copie dans le presse-papiers n\'est pas supportée par ce navigateur.', this.getCurrentBaseStatus(), 5000);
      return;
    }
    this.recordingStatus.textContent = "Copie du résumé...";
    try {
      await navigator.clipboard.writeText(summaryText);
      this.displayTemporaryStatus("Résumé copié dans le presse-papiers !", this.getCurrentBaseStatus(), 5000);
    } catch (error) {
      console.error("Erreur lors de la copie du résumé:", error);
      this.displayTemporaryStatus("Échec de la copie du résumé. Veuillez réessayer.", this.getCurrentBaseStatus(), 5000);
    }
  }

  private async copyRawTranscriptionToClipboard(): Promise<void> {
    const rawText = this.currentNote?.rawTranscription || '';
    if (!rawText || rawText.trim() === '' || rawText.trim() === this.rawTranscription.getAttribute('placeholder')?.trim()) {
      this.displayTemporaryStatus('Aucune transcription brute à copier.', this.getCurrentBaseStatus());
      return;
    }
    if (!navigator.clipboard) {
      this.displayTemporaryStatus('La copie dans le presse-papiers n\'est pas supportée par ce navigateur.', this.getCurrentBaseStatus(), 5000);
      return;
    }
    this.recordingStatus.textContent = "Copie de la transcription brute...";
    try {
      await navigator.clipboard.writeText(rawText);
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
    return sanitized || 'Sans_Titre';
  }

  private saveSummaryToFile(): void {
    const summaryContent = this.currentNote?.summary || '';
     if (!summaryContent || summaryContent.trim() === '' || summaryContent.trim() === this.summaryEditor.getAttribute('placeholder')?.trim()) {
      this.displayTemporaryStatus('Aucun résumé à enregistrer.', this.getCurrentBaseStatus());
      return;
    }
    this.recordingStatus.textContent = "Enregistrement du résumé...";
    let noteTitle = this.editorTitle.textContent?.trim();
    const placeholderTitle = this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
    if (!noteTitle || noteTitle === placeholderTitle || noteTitle.toLocaleLowerCase().includes('untitled') || noteTitle.toLocaleLowerCase().includes('sans titre')) {
        const dateStr = new Date(this.currentNote!.timestamp).toLocaleDateString('fr-FR').replace(/\//g, '-');
        noteTitle = this.currentNote!.sourceType === 'pdf' ? `Resume_PDF_${dateStr}` : `Note_Vocale_${dateStr}`;
    }
    const sanitizedTitle = this.sanitizeFilename(noteTitle);
    const filename = `${sanitizedTitle}_Résumé.md`;
    try {
      const blob = new Blob([summaryContent], { type: 'text/markdown;charset=utf-8' });
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

  private getAudioFileExtension(mimeType?: string): string {
    if (!mimeType) return 'bin';
    if (mimeType.startsWith('audio/')) {
        const subtype = mimeType.substring('audio/'.length);
        if (subtype === 'webm') return 'webm';
        if (subtype === 'mpeg') return 'mp3';
        if (subtype === 'wav' || subtype === 'wave' || subtype === 'x-wav') return 'wav';
        if (subtype === 'ogg') return 'ogg';
        if (subtype === 'aac') return 'aac';
        if (subtype === 'mp4') return 'm4a';
        if (subtype.match(/^[a-zA-Z0-9]+$/)) return subtype;
    }
    return 'bin';
  }

  private generateTimestampedNameForZip(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `Note_${year}-${month}-${day}_${hours}-${minutes}-${seconds}.zip`;
  }

  private async saveAllPackage(): Promise<void> {
    if (!this.currentNote) {
      this.displayTemporaryStatus('Aucune note active à sauvegarder.', this.getCurrentBaseStatus());
      return;
    }

    const { audioBlob, audioMimeType, rawTranscription, summary } = this.currentNote;
    const rawTranscriptionText = rawTranscription?.trim() || '';
    const summaryText = summary?.trim() || '';

    if (!audioBlob && !rawTranscriptionText && !summaryText) {
      this.displayTemporaryStatus('Aucun contenu à sauvegarder dans le package.', this.getCurrentBaseStatus());
      return;
    }

    this.isProcessingFile = true;
    this.setButtonsDisabled(true);
    this.recordingStatus.textContent = 'Préparation du package...';

    try {
      const zip = new JSZip();

      if (audioBlob) {
        const audioExtension = this.getAudioFileExtension(audioMimeType);
        zip.file(`audio.${audioExtension}`, audioBlob);
      }

      if (rawTranscriptionText) {
        zip.file('transcription_brute.txt', rawTranscriptionText);
      }

      if (summaryText) {
        zip.file('resume.md', summaryText);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const filename = this.generateTimestampedNameForZip();

      const link = document.createElement('a');
      link.href = URL.createObjectURL(zipBlob);
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      this.displayTemporaryStatus(`Package sauvegardé : ${filename}`, this.getCurrentBaseStatus(), 5000);

    } catch (error) {
      console.error("Erreur lors de la création ou sauvegarde du package ZIP :", error);
      this.displayTemporaryStatus("Erreur lors de la création du package.", this.getCurrentBaseStatus(), 5000);
    } finally {
      this.isProcessingFile = false;
      this.setButtonsDisabled(false);
      if (!this.recordingStatus.textContent?.includes('Erreur') && !this.recordingStatus.textContent?.includes('Package sauvegardé')) {
           this.recordingStatus.textContent = this.getCurrentBaseStatus();
      }
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new VoiceNotesApp();
  document.querySelectorAll<HTMLElement>('[contenteditable="true"][placeholder]').forEach((el) => {
      const placeholder = el.getAttribute('placeholder')!;
      function updatePlaceholderState() {
        const currentText = el.textContent?.trim();
        if (currentText === '' || currentText === placeholder) {
          if (currentText === '') { el.textContent = placeholder; }
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
      el.addEventListener('blur', function () { updatePlaceholderState(); });
    });
});

export {};
