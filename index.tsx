/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */

import {GoogleGenAI, GenerateContentResponse} from '@google/genai';
import {marked} from 'marked';

const MODEL_NAME = 'gemini-2.5-flash-preview-04-17';

interface Note {
  id: string;
  rawTranscription: string;
  polishedNote: string;
  summary: string;
  timestamp: number;
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
  private uploadAudioButton: HTMLButtonElement;
  private audioFileUploadInput: HTMLInputElement;
  private durationInput: HTMLInputElement;
  private setDurationButton: HTMLButtonElement;
  private themeToggleIcon: HTMLElement;
  private audioChunks: Blob[] = [];
  private isRecording = false;
  private currentNote: Note | null = null;
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

  private userDefinedMaxRecordingMinutes: number = 20; // Default, matches input value
  private activeRecordingMaxDurationMs: number | null = null;
  private activeRecordingOriginalMinutesSetting: number | null = null; // Stores the minutes setting used for the current recording
  private maxDurationTimeoutId: number | null = null;


  constructor() {
    this.genAI = new GoogleGenAI({
      apiKey: process.env.API_KEY!,
    });

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
    this.uploadAudioButton = document.getElementById(
        'uploadAudioButton',
    ) as HTMLButtonElement;
    this.audioFileUploadInput = document.getElementById(
        'audioFileUpload',
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

    this.recordingStatus.textContent = 'Prêt à enregistrer.';
  }

  private bindEventListeners(): void {
    this.recordButton.addEventListener('click', () => this.toggleRecording());
    this.newButton.addEventListener('click', () => this.createNewNote());
    this.themeToggleButton.addEventListener('click', () => this.toggleTheme());
    this.copySummaryButton.addEventListener('click', () => this.copySummaryToClipboard());
    this.saveSummaryButton.addEventListener('click', () => this.saveSummaryToFile());
    this.uploadAudioButton.addEventListener('click', () => this.triggerFileUpload());
    this.audioFileUploadInput.addEventListener('change', (event) => this.handleFileUpload(event));
    this.setDurationButton.addEventListener('click', () => this.handleSetDuration());
    window.addEventListener('resize', this.handleResize.bind(this));
  }

  private handleSetDuration(): void {
    if (this.isRecording) {
        const currentRecordingMins = this.activeRecordingOriginalMinutesSetting || this.userDefinedMaxRecordingMinutes;
        this.recordingStatus.textContent = 'La durée ne peut être modifiée pendant l\'enregistrement.';
        setTimeout(() => {
            if (this.recordingStatus.textContent === 'La durée ne peut être modifiée pendant l\'enregistrement.') {
                 this.recordingStatus.textContent = `Enregistrement en cours... (max ${currentRecordingMins} minutes)`;
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
            this.recordingStatus.textContent = 'Prêt à enregistrer.';
        }
    }, 3000);
  }


  private triggerFileUpload(): void {
    if (this.isRecording) {
      const currentRecordingMins = this.activeRecordingOriginalMinutesSetting || this.userDefinedMaxRecordingMinutes;
      this.recordingStatus.textContent = 'Veuillezarrêter l\'enregistrement avant de téléverser un fichier.';
      setTimeout(() => {
         if (this.recordingStatus.textContent === 'Veuillezarrêter l\'enregistrement avant de téléverser un fichier.') {
            if (this.maxDurationTimeoutId) { 
                 this.recordingStatus.textContent = `Enregistrement en cours... (max ${currentRecordingMins} minutes)`;
            } else { 
                 this.recordingStatus.textContent = 'Enregistrement en cours...';
            }
         }
      }, 3000);
      return;
    }
    this.audioFileUploadInput.click();
  }

  private async handleFileUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];

      if (!file.type.startsWith('audio/')) {
        this.recordingStatus.textContent = 'Type de fichier non supporté. Veuillez sélectionner un fichier audio.';
        setTimeout(() => {
          if (this.recordingStatus.textContent === 'Type de fichier non supporté. Veuillez sélectionner un fichier audio.') {
            this.recordingStatus.textContent = 'Prêt à enregistrer.';
          }
        }, 3000);
        input.value = ''; 
        return;
      }

      this.createNewNote(); 

      const fileName = file.name;
      const lastDotIndex = fileName.lastIndexOf('.');
      const titleWithoutExtension = lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
      if (this.editorTitle) {
        this.editorTitle.textContent = titleWithoutExtension.replace(/_/g, ' ');
        this.editorTitle.classList.remove('placeholder-active');
      }

      this.recordingStatus.textContent = 'Traitement du fichier téléversé...';
      try {
        await this.processAudio(file, file.type);
      } catch (err) {
        console.error('Error processing uploaded file:', err);
        this.recordingStatus.textContent = 'Erreur lors du traitement du fichier téléversé.';
        this.currentNote!.polishedNote = `Error processing uploaded file: ${err instanceof Error ? err.message : String(err)}`;
        this.currentNote!.summary = '';
        this.updatePolishedNoteDisplay();
      }
      input.value = '';
    }
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
      if (this.stream) {
        this.stream.getTracks().forEach((track) => track.stop());
        this.stream = null;
      }
      if (this.audioContext && this.audioContext.state !== 'closed') {
        await this.audioContext.close();
        this.audioContext = null;
      }

      this.recordingStatus.textContent = 'Demande d\'accès au microphone...';

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
          this.processAudio(audioBlob).catch((err) => {
            console.error('Error processing audio:', err);
            if (stoppedByTimeout) {
                 this.recordingStatus.textContent = `Enregistrement arrêté (limite ${this.activeRecordingOriginalMinutesSetting} min). Erreur de traitement.`;
            } else {
                this.recordingStatus.textContent = 'Erreur lors du traitement de l\'enregistrement';
            }
          });
        } else {
          if (!stoppedByTimeout) { // Only show if not already a timeout message
             this.recordingStatus.textContent = 'Aucune donnée audio capturée. Veuillez réessayer.';
          }
        }

        if (this.stream) {
          this.stream.getTracks().forEach((track) => {
            track.stop();
          });
          this.stream = null;
        }
      };
      
      // Set durations for this specific recording session
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
        // Set status BEFORE mediaRecorder.stop() which is async and triggers onstop
        if (stoppedByTimeout) {
            this.recordingStatus.textContent = `Enregistrement arrêté (limite ${currentRecordingMinutes} min). Traitement...`;
        } else {
            // Check if it was ALREADY a timeout status (e.g. user clicks stop milli-seconds after auto-stop started processing)
            if (!this.recordingStatus.textContent?.includes(`limite ${currentRecordingMinutes} min`)) {
               this.recordingStatus.textContent = 'Traitement audio en cours...';
            }
        }
        this.mediaRecorder.stop(); 
      } catch (e) {
        console.error('Error stopping MediaRecorder:', e);
        this.stopLiveDisplay(); 
      }

      this.isRecording = false; 
      this.recordButton.classList.remove('recording');
      this.recordButton.setAttribute('title', 'Start Recording');
      // onstop handler will manage further UI (stopLiveDisplay if not already) and audio processing.
    } else {
       if (!this.isRecording) {
         this.stopLiveDisplay(); 
       }
    }
  }

  private async processAudio(audioBlob: Blob, explicitMimeType?: string): Promise<void> {
    const currentRecordingMinutes = this.activeRecordingOriginalMinutesSetting || this.userDefinedMaxRecordingMinutes;
    const isTimeoutStop = this.recordingStatus.textContent?.includes(`limite ${currentRecordingMinutes} min`);

    if (audioBlob.size === 0) {
      if (!isTimeoutStop) {
         this.recordingStatus.textContent = 'Aucune donnée audio capturée. Veuillez réessayer.';
      }
      return;
    }

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
      await this.getTranscription(base64Audio, mimeType);
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
      this.updatePolishedNoteDisplay();
    }
  }

  private async getTranscription(
    base64Audio: string,
    mimeType: string,
  ): Promise<void> {
    const currentRecordingMinutes = this.activeRecordingOriginalMinutesSetting || this.userDefinedMaxRecordingMinutes;
    const statusPrefix = this.recordingStatus.textContent?.startsWith(`Enregistrement arrêté (limite ${currentRecordingMinutes} min).`) ? `Enregistrement arrêté (limite ${currentRecordingMinutes} min). ` : '';
    
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

      const transcriptionText = response.text;

      if (transcriptionText) {
        this.rawTranscription.textContent = transcriptionText;
        if (transcriptionText.trim() !== '') {
          this.rawTranscription.classList.remove('placeholder-active');
        } else {
          const placeholder =
            this.rawTranscription.getAttribute('placeholder') || '';
          this.rawTranscription.textContent = placeholder;
          this.rawTranscription.classList.add('placeholder-active');
        }

        if (this.currentNote)
          this.currentNote.rawTranscription = transcriptionText;
        
        await this.processTranscriptionOutputs();

      } else {
        this.recordingStatus.textContent = statusPrefix + 'La transcription a échoué ou est vide.';
        this.rawTranscription.textContent =
          this.rawTranscription.getAttribute('placeholder');
        this.rawTranscription.classList.add('placeholder-active');
        if (this.currentNote) {
            this.currentNote.polishedNote = '';
            this.currentNote.summary = '';
        }
        this.updatePolishedNoteDisplay();
      }
    } catch (error) {
      console.error('Error getting transcription:', error);
      this.recordingStatus.textContent = statusPrefix + 'Erreur lors de l\'obtention de la transcription. Veuillez réessayer.';
      this.rawTranscription.textContent =
        this.rawTranscription.getAttribute('placeholder');
      this.rawTranscription.classList.add('placeholder-active');
      if (this.currentNote) {
        this.currentNote.polishedNote = '';
        this.currentNote.summary = '';
      }
      this.updatePolishedNoteDisplay();
    }
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
            // FIX: Await polishedResult.value to satisfy TypeScript if it infers type as string | Promise<string>
            this.currentNote.polishedNote = await polishedResult.value;
        } else {
            console.error('Error polishing note:', polishedResult.reason);
            this.currentNote.polishedNote = `Error polishing note: ${polishedResult.reason instanceof Error ? polishedResult.reason.message : String(polishedResult.reason)}`;
        }

        if (summaryResult.status === 'fulfilled') {
            // FIX: Await summaryResult.value to satisfy TypeScript if it infers type as string | Promise<string>
            this.currentNote.summary = await summaryResult.value;
        } else {
            console.error('Error generating summary:', summaryResult.reason);
            this.currentNote.summary = `Error generating summary: ${summaryResult.reason instanceof Error ? summaryResult.reason.message : String(summaryResult.reason)}`;
        }
      }
      
      this.updatePolishedNoteDisplay();
      this.extractTitleFromOutputs();
      this.recordingStatus.textContent = 'Traitement terminé. Prêt à enregistrer.';

    } catch (error) { 
      console.error('Error processing transcription outputs:', error);
      this.recordingStatus.textContent = statusPrefix + 'Erreur lors du post-traitement.';
      if (this.currentNote) {
        this.currentNote.polishedNote = '';
        this.currentNote.summary = '';
      }
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
    const prompt = `Based on the following transcription with speaker labels, provide a concise summary **in French** of the key points, decisions, and action items. Format the summary using markdown.

                  Raw transcription:
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

    const summaryTitle = document.createElement('h3');
    const timestamp = this.currentNote ? new Date(this.currentNote.timestamp).toLocaleString() : new Date().toLocaleString();
    summaryTitle.textContent = `Summary - ${timestamp}`; 
    summaryTitle.style.marginTop = '0';
    polishedNoteDiv.appendChild(summaryTitle);

    const summaryContentDiv = document.createElement('div');
    summaryContentDiv.className = 'summary-section';
    if (this.currentNote?.summary && this.currentNote.summary.trim() !== '') {
      summaryContentDiv.innerHTML = marked.parse(this.currentNote.summary);
      hasAnyContent = true;
    } else {
      summaryContentDiv.innerHTML = `<p class="placeholder-text"><em>Le résumé en français apparaîtra ici après traitement...</em></p>`;
    }
    polishedNoteDiv.appendChild(summaryContentDiv);
    polishedNoteDiv.appendChild(document.createElement('hr'));

    const detailedNoteTitle = document.createElement('h3');
    detailedNoteTitle.textContent = 'Detailed Note';
    polishedNoteDiv.appendChild(detailedNoteTitle);

    const detailedNoteContentDiv = document.createElement('div');
    detailedNoteContentDiv.className = 'detailed-note-section';
    if (this.currentNote?.polishedNote && this.currentNote.polishedNote.trim() !== '') {
      detailedNoteContentDiv.innerHTML = marked.parse(this.currentNote.polishedNote);
      hasAnyContent = true;
    } else {
      detailedNoteContentDiv.innerHTML = `<p class="placeholder-text"><em>Polished note will appear here after processing...</em></p>`;
    }
    polishedNoteDiv.appendChild(detailedNoteContentDiv);

    if (!hasAnyContent) {
      const placeholderText = polishedNoteDiv.getAttribute('placeholder') || 'Your polished notes and summary will appear here...';
      polishedNoteDiv.innerHTML = `<p class="placeholder-text">${placeholderText}</p>`;
      polishedNoteDiv.classList.add('placeholder-active');
    }
  }

  private extractTitleFromOutputs(): void {
    if (!this.currentNote || !this.editorTitle) return;

    const currentEditorTitle = this.editorTitle.textContent?.trim();
    const placeholderTitle = this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
    if (currentEditorTitle && currentEditorTitle !== placeholderTitle) {
        // Title already set
    } else {
        let noteTitleSet = false;
        const sources = [this.currentNote.polishedNote, this.currentNote.summary];

        for (const sourceText of sources) {
          if (noteTitleSet || !sourceText) continue;

          const lines = sourceText.split('\n').map((l) => l.trim());
          for (const line of lines) { 
            if (line.startsWith('#')) {
              const title = line.replace(/^#+\s+/, '').trim();
              if (title) {
                this.editorTitle.textContent = title;
                this.editorTitle.classList.remove('placeholder-active');
                noteTitleSet = true;
                break;
              }
            }
          }
          if (noteTitleSet) break;

          for (const line of lines) { 
             if (line.length > 0) {
                let potentialTitle = line.replace(/^[\*_\`#\->\s\[\]\(.\d)]+/, ''); 
                potentialTitle = potentialTitle.replace(/[\*_\`#]+$/, ''); 
                potentialTitle = potentialTitle.trim();

                if (potentialTitle.length > 3) { 
                  const maxLength = 60;
                  this.editorTitle.textContent = potentialTitle.substring(0, maxLength) + (potentialTitle.length > maxLength ? '...' : '');
                  this.editorTitle.classList.remove('placeholder-active');
                  noteTitleSet = true;
                  break;
                }
              }
          }
          if (noteTitleSet) break;
        }
        
        if (!noteTitleSet) {
          this.editorTitle.textContent = placeholderTitle;
          this.editorTitle.classList.add('placeholder-active');
        }
    }
  }


  private createNewNote(): void {
    if (this.isRecording) {
      this.stopRecording(false); 
    } else {
        if (this.maxDurationTimeoutId) {
            clearTimeout(this.maxDurationTimeoutId);
            this.maxDurationTimeoutId = null;
        }
        this.stopLiveDisplay(); 
    }

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
    };

    const rawPlaceholder =
      this.rawTranscription.getAttribute('placeholder') || '';
    this.rawTranscription.textContent = rawPlaceholder;
    this.rawTranscription.classList.add('placeholder-active');

    this.updatePolishedNoteDisplay(); 

    if (this.editorTitle) {
      const placeholder =
        this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
      this.editorTitle.textContent = placeholder;
      this.editorTitle.classList.add('placeholder-active');
    }
    this.recordingStatus.textContent = 'Prêt à enregistrer.';
  }

  private async copySummaryToClipboard(): Promise<void> {
    if (!this.currentNote || !this.currentNote.summary || this.currentNote.summary.trim() === '') {
      this.recordingStatus.textContent = 'Aucun résumé à copier.';
      setTimeout(() => {
        if (this.recordingStatus.textContent === 'Aucun résumé à copier.') {
          this.recordingStatus.textContent = 'Prêt à enregistrer.';
        }
      }, 3000);
      return;
    }

    if (!navigator.clipboard) {
      this.recordingStatus.textContent = 'La copie dans le presse-papiers n\'est pas supportée par ce navigateur.';
       setTimeout(() => {
        if (this.recordingStatus.textContent === 'La copie dans le presse-papiers n\'est pas supportée par ce navigateur.') {
          this.recordingStatus.textContent = 'Prêt à enregistrer.';
        }
      }, 5000);
      return;
    }

    this.recordingStatus.textContent = "Copie du résumé...";
    try {
      await navigator.clipboard.writeText(this.currentNote.summary);
      this.recordingStatus.textContent = "Résumé copié dans le presse-papiers !";
    } catch (error) {
      console.error("Erreur lors de la copie dans le presse-papiers:", error);
      this.recordingStatus.textContent = "Échec de la copie du résumé. Veuillez réessayer.";
    }

    setTimeout(() => {
      const currentStatus = this.recordingStatus.textContent;
      if (currentStatus === "Résumé copié dans le presse-papiers !" ||
          currentStatus === "Échec de la copie du résumé. Veuillez réessayer.") {
        this.recordingStatus.textContent = 'Prêt à enregistrer.';
      }
    }, 5000);
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
    if (!this.currentNote || !this.currentNote.summary || this.currentNote.summary.trim() === '') {
      this.recordingStatus.textContent = 'Aucun résumé à enregistrer.';
      setTimeout(() => {
        if (this.recordingStatus.textContent === 'Aucun résumé à enregistrer.') {
          this.recordingStatus.textContent = 'Prêt à enregistrer.';
        }
      }, 3000);
      return;
    }

    this.recordingStatus.textContent = "Enregistrement du résumé...";

    let noteTitle = this.editorTitle.textContent?.trim();
    const placeholderTitle = this.editorTitle.getAttribute('placeholder') || 'Untitled Note';
    if (!noteTitle || noteTitle === placeholderTitle) {
        noteTitle = 'Note_Vocale';
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

      this.recordingStatus.textContent = `Résumé enregistré : ${filename}`;
    } catch (error) {
      console.error("Erreur lors de l'enregistrement du fichier :", error);
      this.recordingStatus.textContent = "Erreur lors de l'enregistrement du fichier.";
    }

    setTimeout(() => {
        const currentStatus = this.recordingStatus.textContent;
        if (currentStatus.startsWith("Résumé enregistré") ||
            currentStatus === "Erreur lors de l'enregistrement du fichier.") {
            this.recordingStatus.textContent = 'Prêt à enregistrer.';
        }
    }, 5000);
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
