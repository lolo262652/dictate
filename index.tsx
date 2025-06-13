import { GoogleGenerativeAI } from '@google/generative-ai';
import { marked } from 'marked';
import JSZip from 'jszip';
import { AuthService } from './src/lib/auth';
import { AuthModal } from './src/components/AuthModal';
import { SessionsList } from './src/components/SessionsList';
import { PdfList } from './src/components/PdfList';
import { TranscriptionProgress } from './src/components/TranscriptionProgress';
import { DatabaseService } from './src/lib/database';
import { StorageService } from './src/lib/storage';
import { PdfService } from './src/lib/pdf-service';
import type { DictationSession, PdfDocument } from './src/lib/supabase';
import type { User } from '@supabase/supabase-js';

// Global variables
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let recordingStartTime: number = 0;
let recordingTimer: number | null = null;
let recordingDuration = 30; // Default 30 minutes
let maxRecordingTime = 30 * 60 * 1000; // 30 minutes in milliseconds
let currentAudioBlob: Blob | null = null;
let currentSessionId: string | null = null;
let currentUser: User | null = null;
let liveWaveformAnimationId: number | null = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let dataArray: Uint8Array | null = null;

// UI Components
let authModal: AuthModal;
let sessionsList: SessionsList;
let pdfList: PdfList;
let transcriptionProgress: TranscriptionProgress;

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY || '');

// Microphone status tracking
let microphoneStatus = {
  available: false,
  permission: 'unknown' as 'granted' | 'denied' | 'prompt' | 'unknown',
  error: null as string | null
};

// Check microphone availability and permissions
async function checkMicrophoneStatus(): Promise<void> {
  try {
    // Reset status
    microphoneStatus = {
      available: false,
      permission: 'unknown',
      error: null
    };

    // Check if getUserMedia is supported
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      microphoneStatus.error = 'Votre navigateur ne supporte pas l\'enregistrement audio. Veuillez utiliser un navigateur moderne comme Chrome, Firefox ou Safari.';
      updateMicrophoneUI();
      return;
    }

    // Check if we're on HTTPS or localhost
    const isSecureContext = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost';
    if (!isSecureContext) {
      microphoneStatus.error = 'L\'accès au microphone nécessite une connexion sécurisée (HTTPS). Veuillez accéder à l\'application via HTTPS.';
      updateMicrophoneUI();
      return;
    }

    // Check permissions if available
    if ('permissions' in navigator) {
      try {
        const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        microphoneStatus.permission = permissionStatus.state;
        
        if (permissionStatus.state === 'denied') {
          microphoneStatus.error = 'L\'accès au microphone a été refusé. Veuillez autoriser l\'accès au microphone dans les paramètres de votre navigateur.';
          updateMicrophoneUI();
          return;
        }
      } catch (e) {
        console.log('Permission API not fully supported, will try direct access');
      }
    }

    // Try to enumerate devices to check for microphones
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      if (audioInputs.length === 0) {
        microphoneStatus.error = 'Aucun microphone détecté. Veuillez connecter un microphone et actualiser la page.';
        updateMicrophoneUI();
        return;
      }
    } catch (e) {
      console.log('Could not enumerate devices, will try direct access');
    }

    // Try to get user media to test actual access
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      
      // Success! Clean up the test stream
      stream.getTracks().forEach(track => track.stop());
      
      microphoneStatus.available = true;
      microphoneStatus.permission = 'granted';
      microphoneStatus.error = null;
      
    } catch (error: any) {
      console.error('Microphone access error:', error);
      
      switch (error.name) {
        case 'NotAllowedError':
          microphoneStatus.permission = 'denied';
          microphoneStatus.error = 'L\'accès au microphone a été refusé. Cliquez sur l\'icône de microphone dans la barre d\'adresse pour autoriser l\'accès.';
          break;
        case 'NotFoundError':
          microphoneStatus.error = 'Aucun microphone trouvé. Veuillez connecter un microphone et actualiser la page.';
          break;
        case 'NotReadableError':
          microphoneStatus.error = 'Le microphone est utilisé par une autre application. Fermez les autres applications utilisant le microphone et réessayez.';
          break;
        case 'OverconstrainedError':
          microphoneStatus.error = 'Les paramètres audio demandés ne sont pas supportés par votre microphone.';
          break;
        case 'SecurityError':
          microphoneStatus.error = 'Erreur de sécurité. L\'accès au microphone nécessite une connexion sécurisée (HTTPS).';
          break;
        default:
          microphoneStatus.error = `Erreur d'accès au microphone: ${error.message || 'Erreur inconnue'}`;
      }
    }

    updateMicrophoneUI();
    
  } catch (error) {
    console.error('Error checking microphone status:', error);
    microphoneStatus.error = 'Erreur lors de la vérification du microphone.';
    updateMicrophoneUI();
  }
}

// Update UI based on microphone status
function updateMicrophoneUI(): void {
  const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
  const recordingStatus = document.getElementById('recordingStatus') as HTMLElement;
  
  if (!recordButton || !recordingStatus) return;

  if (microphoneStatus.available) {
    recordButton.disabled = false;
    recordButton.title = 'Commencer l\'enregistrement';
    recordingStatus.textContent = 'Prêt à enregistrer';
    recordButton.style.opacity = '1';
  } else {
    recordButton.disabled = true;
    recordButton.title = microphoneStatus.error || 'Microphone non disponible';
    recordingStatus.textContent = microphoneStatus.error || 'Microphone non disponible';
    recordButton.style.opacity = '0.5';
  }
}

// Show microphone help dialog
function showMicrophoneHelp(): void {
  const helpMessage = microphoneStatus.error || 'Problème d\'accès au microphone';
  
  let instructions = '';
  
  if (microphoneStatus.permission === 'denied') {
    instructions = `
      <h3>Comment autoriser l'accès au microphone :</h3>
      <ol>
        <li>Cliquez sur l'icône de microphone (🎤) ou de cadenas (🔒) dans la barre d'adresse</li>
        <li>Sélectionnez "Autoriser" pour le microphone</li>
        <li>Actualisez la page</li>
      </ol>
      <p><strong>Ou dans les paramètres du navigateur :</strong></p>
      <ul>
        <li><strong>Chrome :</strong> Paramètres → Confidentialité et sécurité → Paramètres du site → Microphone</li>
        <li><strong>Firefox :</strong> Paramètres → Vie privée et sécurité → Permissions → Microphone</li>
        <li><strong>Safari :</strong> Préférences → Sites web → Microphone</li>
      </ul>
    `;
  } else if (!window.isSecureContext && location.protocol !== 'https:') {
    instructions = `
      <h3>Connexion sécurisée requise :</h3>
      <p>L'accès au microphone nécessite une connexion HTTPS pour des raisons de sécurité.</p>
      <p>Veuillez accéder à l'application via une URL HTTPS.</p>
    `;
  } else {
    instructions = `
      <h3>Vérifications à effectuer :</h3>
      <ol>
        <li>Vérifiez qu'un microphone est connecté à votre ordinateur</li>
        <li>Fermez les autres applications utilisant le microphone (Zoom, Teams, etc.)</li>
        <li>Vérifiez les paramètres audio de votre système</li>
        <li>Actualisez la page et réessayez</li>
      </ol>
    `;
  }

  const modal = document.createElement('div');
  modal.className = 'delete-confirmation-modal visible';
  modal.innerHTML = `
    <div class="delete-confirmation-content">
      <div class="delete-confirmation-icon">
        <i class="fas fa-microphone-slash"></i>
      </div>
      <h3 class="delete-confirmation-title">Problème de microphone</h3>
      <div class="delete-confirmation-message" style="text-align: left; max-height: 300px; overflow-y: auto;">
        <p style="margin-bottom: 16px;"><strong>Erreur :</strong> ${helpMessage}</p>
        ${instructions}
      </div>
      <div class="delete-confirmation-actions">
        <button class="delete-confirmation-btn cancel" id="helpCloseBtn">Fermer</button>
        <button class="delete-confirmation-btn confirm" id="helpRetryBtn">Réessayer</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const closeBtn = modal.querySelector('#helpCloseBtn') as HTMLButtonElement;
  const retryBtn = modal.querySelector('#helpRetryBtn') as HTMLButtonElement;

  closeBtn.addEventListener('click', () => {
    modal.remove();
  });

  retryBtn.addEventListener('click', async () => {
    modal.remove();
    await checkMicrophoneStatus();
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

// Enhanced recording functions
async function startRecording(): Promise<void> {
  try {
    // Check microphone status first
    if (!microphoneStatus.available) {
      showMicrophoneHelp();
      return;
    }

    // Get user media with enhanced constraints
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 44100,
        channelCount: 1
      }
    });

    // Setup audio context for waveform visualization
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    dataArray = new Uint8Array(bufferLength);

    // Setup MediaRecorder
    const options: MediaRecorderOptions = {
      mimeType: 'audio/webm;codecs=opus'
    };

    // Fallback for browsers that don't support webm
    if (!MediaRecorder.isTypeSupported(options.mimeType!)) {
      options.mimeType = 'audio/mp4';
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'audio/wav';
      }
    }

    mediaRecorder = new MediaRecorder(stream, options);
    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' });
      currentAudioBlob = audioBlob;
      
      // Stop all tracks
      stream.getTracks().forEach(track => track.stop());
      
      // Clean up audio context
      if (audioContext) {
        audioContext.close();
        audioContext = null;
      }

      // Process the recording
      await processRecording(audioBlob);
    };

    mediaRecorder.onerror = (event) => {
      console.error('MediaRecorder error:', event);
      stopRecording();
      alert('Erreur lors de l\'enregistrement. Veuillez réessayer.');
    };

    // Start recording
    mediaRecorder.start(1000); // Collect data every second
    recordingStartTime = Date.now();
    
    // Update UI
    updateRecordingUI(true);
    startRecordingTimer();
    startLiveWaveform();

    // Auto-stop after max duration
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopRecording();
      }
    }, maxRecordingTime);

  } catch (error: any) {
    console.error('Error starting recording:', error);
    
    // Update microphone status and show help
    await checkMicrophoneStatus();
    
    if (!microphoneStatus.available) {
      showMicrophoneHelp();
    } else {
      alert(`Erreur lors du démarrage de l'enregistrement: ${error.message}`);
    }
  }
}

function stopRecording(): void {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
  
  updateRecordingUI(false);
  stopRecordingTimer();
  stopLiveWaveform();
}

function updateRecordingUI(isRecording: boolean): void {
  const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
  const recordingInterface = document.querySelector('.recording-interface') as HTMLElement;
  const liveTitle = document.getElementById('liveRecordingTitle') as HTMLElement;
  const liveCanvas = document.getElementById('liveWaveformCanvas') as HTMLCanvasElement;
  const liveTimer = document.getElementById('liveRecordingTimerDisplay') as HTMLElement;

  if (isRecording) {
    recordButton.classList.add('recording');
    recordingInterface.classList.add('is-live');
    
    if (liveTitle) {
      liveTitle.style.display = 'block';
      liveTitle.textContent = 'Enregistrement en cours...';
    }
    if (liveCanvas) liveCanvas.style.display = 'block';
    if (liveTimer) liveTimer.style.display = 'block';
  } else {
    recordButton.classList.remove('recording');
    recordingInterface.classList.remove('is-live');
    
    if (liveTitle) liveTitle.style.display = 'none';
    if (liveCanvas) liveCanvas.style.display = 'none';
    if (liveTimer) liveTimer.style.display = 'none';
  }
}

function startRecordingTimer(): void {
  const timerDisplay = document.getElementById('liveRecordingTimerDisplay') as HTMLElement;
  
  recordingTimer = window.setInterval(() => {
    const elapsed = Date.now() - recordingStartTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    const centiseconds = Math.floor((elapsed % 1000) / 10);
    
    if (timerDisplay) {
      timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
    }
    
    // Auto-stop if max duration reached
    if (elapsed >= maxRecordingTime) {
      stopRecording();
    }
  }, 10);
}

function stopRecordingTimer(): void {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
}

function startLiveWaveform(): void {
  const canvas = document.getElementById('liveWaveformCanvas') as HTMLCanvasElement;
  if (!canvas || !analyser || !dataArray) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const draw = () => {
    if (!analyser || !dataArray) return;

    liveWaveformAnimationId = requestAnimationFrame(draw);

    analyser.getByteFrequencyData(dataArray);

    ctx.fillStyle = 'rgba(18, 18, 18, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / dataArray.length) * 2.5;
    let barHeight;
    let x = 0;

    for (let i = 0; i < dataArray.length; i++) {
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

function stopLiveWaveform(): void {
  if (liveWaveformAnimationId) {
    cancelAnimationFrame(liveWaveformAnimationId);
    liveWaveformAnimationId = null;
  }
}

async function processRecording(audioBlob: Blob): Promise<void> {
  if (!currentUser) {
    console.error('No user logged in');
    return;
  }

  const recordingDurationMs = Date.now() - recordingStartTime;
  const recordingDurationSeconds = Math.floor(recordingDurationMs / 1000);

  // Show transcription progress
  transcriptionProgress.show(() => {
    // Cancel callback - could implement cancellation logic here
    console.log('Transcription cancelled by user');
  });

  try {
    // Step 1: Create session
    transcriptionProgress.setStep(0, 'Création de la session...');
    
    const sessionData: Partial<DictationSession> = {
      user_id: currentUser.id,
      title: 'Nouvel enregistrement',
      recording_duration: recordingDurationSeconds,
      raw_transcription: '',
      summary: '',
      detailed_note: ''
    };

    const session = await DatabaseService.createSession(sessionData);
    if (!session) {
      throw new Error('Impossible de créer la session');
    }

    currentSessionId = session.id;

    // Step 2: Upload audio file
    transcriptionProgress.setStep(1, 'Téléversement de l\'audio...');
    
    const audioFile = new File([audioBlob], `recording-${session.id}.webm`, { type: audioBlob.type });
    const audioPath = await StorageService.uploadAudioFile(audioFile, currentUser.id, session.id);
    
    if (!audioPath) {
      throw new Error('Impossible de téléverser le fichier audio');
    }

    // Update session with audio path
    await DatabaseService.updateSession(session.id, { audio_file_path: audioPath });

    // Step 3: Transcribe audio
    transcriptionProgress.setStep(2, 'Transcription par IA...');
    
    const transcription = await transcribeAudio(audioBlob);
    if (!transcription) {
      throw new Error('Impossible de transcrire l\'audio');
    }

    // Step 4: Generate title
    transcriptionProgress.setStep(3, 'Génération du titre...');
    
    const title = await generateTitle(transcription);

    // Step 5: Generate summary
    transcriptionProgress.setStep(4, 'Création du résumé...');
    
    const summary = await generateSummary(transcription);

    // Step 6: Generate detailed note
    transcriptionProgress.setStep(5, 'Rédaction de la note détaillée...');
    
    const detailedNote = await generateDetailedNote(transcription);

    // Update session with all generated content
    const updatedSession = await DatabaseService.updateSession(session.id, {
      title: title || 'Enregistrement sans titre',
      raw_transcription: transcription,
      summary: summary || '',
      detailed_note: detailedNote || ''
    });

    if (updatedSession) {
      // Load the session into the UI
      loadSessionIntoUI(updatedSession);
      
      // Refresh sessions list
      await sessionsList.loadSessions();
      
      transcriptionProgress.setSuccess('Enregistrement traité avec succès !');
    } else {
      throw new Error('Impossible de sauvegarder les résultats');
    }

  } catch (error) {
    console.error('Error processing recording:', error);
    transcriptionProgress.setError(`Erreur lors du traitement: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
  }
}

async function transcribeAudio(audioBlob: Blob): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const arrayBuffer = await audioBlob.arrayBuffer();
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    const result = await model.generateContent([
      {
        inlineData: {
          data: base64Audio,
          mimeType: audioBlob.type
        }
      },
      "Transcris fidèlement cet enregistrement audio en français. Retourne uniquement le texte transcrit, sans commentaires ni formatage."
    ]);
    
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error('Transcription error:', error);
    throw new Error('Erreur lors de la transcription');
  }
}

async function generateTitle(transcription: string): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Génère un titre court et descriptif (maximum 60 caractères) pour cette transcription :

${transcription}

Retourne uniquement le titre, sans guillemets ni formatage.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error('Title generation error:', error);
    return 'Enregistrement sans titre';
  }
}

async function generateSummary(transcription: string): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Crée un résumé concis et structuré de cette transcription :

${transcription}

Le résumé doit :
- Être en français
- Faire 3-5 phrases maximum
- Capturer les points clés
- Être rédigé de manière professionnelle

Retourne uniquement le résumé.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error('Summary generation error:', error);
    return '';
  }
}

async function generateDetailedNote(transcription: string): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Transforme cette transcription en une note détaillée et bien structurée :

${transcription}

La note doit :
- Être en français
- Être bien organisée avec des titres et sous-titres
- Corriger les erreurs grammaticales
- Améliorer la clarté et la lisibilité
- Conserver toutes les informations importantes
- Utiliser le formatage Markdown

Retourne uniquement la note formatée.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error('Detailed note generation error:', error);
    return '';
  }
}

function loadSessionIntoUI(session: DictationSession): void {
  // Update title
  const titleElement = document.querySelector('.editor-title') as HTMLElement;
  if (titleElement) {
    titleElement.textContent = session.title;
  }

  // Update content areas
  const summaryEditor = document.getElementById('summaryEditor') as HTMLElement;
  const polishedNote = document.getElementById('polishedNote') as HTMLElement;
  const rawTranscription = document.getElementById('rawTranscription') as HTMLElement;

  if (summaryEditor) {
    summaryEditor.innerHTML = marked.parse(session.summary || '');
  }
  if (polishedNote) {
    polishedNote.innerHTML = marked.parse(session.detailed_note || '');
  }
  if (rawTranscription) {
    rawTranscription.textContent = session.raw_transcription || '';
  }

  // Show audio playback if available
  if (session.audio_file_path) {
    showAudioPlayback(session.audio_file_path, session.title);
  }

  currentSessionId = session.id;
}

async function showAudioPlayback(audioPath: string, title: string): Promise<void> {
  try {
    const audioUrl = await StorageService.getAudioFileUrl(audioPath);
    if (!audioUrl) return;

    const playbackControls = document.getElementById('audioPlaybackControls') as HTMLElement;
    const audioPlayer = document.getElementById('audioPlayer') as HTMLAudioElement;
    const playbackTitle = document.getElementById('playbackTitle') as HTMLElement;
    const recordingInterface = document.querySelector('.recording-interface') as HTMLElement;

    if (playbackControls && audioPlayer && playbackTitle && recordingInterface) {
      audioPlayer.src = audioUrl;
      playbackTitle.textContent = `Lecture: ${title}`;
      playbackControls.style.display = 'block';
      recordingInterface.classList.add('is-playback');
    }
  } catch (error) {
    console.error('Error setting up audio playback:', error);
  }
}

// Audio playback controls
function setupAudioPlayback(): void {
  const playPauseBtn = document.getElementById('playPauseBtn') as HTMLButtonElement;
  const stopPlaybackBtn = document.getElementById('stopPlaybackBtn') as HTMLButtonElement;
  const audioSeeker = document.getElementById('audioSeeker') as HTMLInputElement;
  const audioPlayer = document.getElementById('audioPlayer') as HTMLAudioElement;
  const playbackTime = document.getElementById('playbackTime') as HTMLElement;

  if (!playPauseBtn || !stopPlaybackBtn || !audioSeeker || !audioPlayer || !playbackTime) return;

  playPauseBtn.addEventListener('click', () => {
    if (audioPlayer.paused) {
      audioPlayer.play();
      playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
      playPauseBtn.classList.add('playing');
    } else {
      audioPlayer.pause();
      playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
      playPauseBtn.classList.remove('playing');
    }
  });

  stopPlaybackBtn.addEventListener('click', () => {
    audioPlayer.pause();
    audioPlayer.currentTime = 0;
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    playPauseBtn.classList.remove('playing');
    hideAudioPlayback();
  });

  audioSeeker.addEventListener('input', () => {
    const seekTime = (parseFloat(audioSeeker.value) / 100) * audioPlayer.duration;
    audioPlayer.currentTime = seekTime;
  });

  audioPlayer.addEventListener('timeupdate', () => {
    if (audioPlayer.duration) {
      const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
      audioSeeker.value = progress.toString();
      
      const currentTime = formatTime(audioPlayer.currentTime);
      const totalTime = formatTime(audioPlayer.duration);
      playbackTime.textContent = `${currentTime} / ${totalTime}`;
    }
  });

  audioPlayer.addEventListener('ended', () => {
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    playPauseBtn.classList.remove('playing');
    audioSeeker.value = '0';
  });
}

function hideAudioPlayback(): void {
  const playbackControls = document.getElementById('audioPlaybackControls') as HTMLElement;
  const recordingInterface = document.querySelector('.recording-interface') as HTMLElement;

  if (playbackControls) {
    playbackControls.style.display = 'none';
  }
  if (recordingInterface) {
    recordingInterface.classList.remove('is-playback');
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// File upload handlers
async function handleAudioUpload(file: File): Promise<void> {
  if (!currentUser) return;

  transcriptionProgress.show();

  try {
    transcriptionProgress.setStep(0, 'Traitement du fichier audio...');

    // Create session
    const sessionData: Partial<DictationSession> = {
      user_id: currentUser.id,
      title: file.name.replace(/\.[^/.]+$/, ''),
      recording_duration: 0,
      raw_transcription: '',
      summary: '',
      detailed_note: ''
    };

    const session = await DatabaseService.createSession(sessionData);
    if (!session) {
      throw new Error('Impossible de créer la session');
    }

    currentSessionId = session.id;

    // Upload file
    transcriptionProgress.setStep(1, 'Téléversement du fichier...');
    const audioPath = await StorageService.uploadAudioFile(file, currentUser.id, session.id);
    if (!audioPath) {
      throw new Error('Impossible de téléverser le fichier');
    }

    await DatabaseService.updateSession(session.id, { audio_file_path: audioPath });

    // Process audio
    transcriptionProgress.setStep(2, 'Transcription par IA...');
    const transcription = await transcribeAudio(file);
    
    transcriptionProgress.setStep(3, 'Génération du titre...');
    const title = await generateTitle(transcription);
    
    transcriptionProgress.setStep(4, 'Création du résumé...');
    const summary = await generateSummary(transcription);
    
    transcriptionProgress.setStep(5, 'Rédaction de la note détaillée...');
    const detailedNote = await generateDetailedNote(transcription);

    const updatedSession = await DatabaseService.updateSession(session.id, {
      title: title || file.name.replace(/\.[^/.]+$/, ''),
      raw_transcription: transcription,
      summary: summary || '',
      detailed_note: detailedNote || ''
    });

    if (updatedSession) {
      loadSessionIntoUI(updatedSession);
      await sessionsList.loadSessions();
      transcriptionProgress.setSuccess('Fichier audio traité avec succès !');
    }

  } catch (error) {
    console.error('Error processing audio file:', error);
    transcriptionProgress.setError(`Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
  }
}

async function handlePdfUpload(file: File): Promise<void> {
  if (!currentUser) return;

  try {
    // Extract text from PDF
    const extractedText = await PdfService.extractTextFromPdf(file);
    
    // Upload PDF file
    const filePath = await PdfService.uploadPdfFile(file, currentUser.id, currentSessionId || undefined);
    if (!filePath) {
      throw new Error('Impossible de téléverser le fichier PDF');
    }

    // Get PDF info
    const pdfDoc = await (window as any).pdfjsLib.getDocument(await file.arrayBuffer()).promise;
    const pageCount = pdfDoc.numPages;

    // Create PDF document record
    const pdfDocument: Partial<PdfDocument> = {
      session_id: currentSessionId || undefined,
      user_id: currentUser.id,
      title: file.name.replace(/\.[^/.]+$/, ''),
      file_path: filePath,
      file_size: file.size,
      page_count: pageCount,
      extracted_text: extractedText
    };

    const createdDoc = await PdfService.createPdfDocument(pdfDocument);
    if (createdDoc) {
      await pdfList.loadDocuments();
      alert('PDF téléversé avec succès !');
    }

  } catch (error) {
    console.error('Error uploading PDF:', error);
    alert(`Erreur lors du téléversement du PDF: ${error instanceof Error ? error.message : 'Erreur inconnue'}`);
  }
}

// Utility functions
function clearCurrentNote(): void {
  const titleElement = document.querySelector('.editor-title') as HTMLElement;
  const summaryEditor = document.getElementById('summaryEditor') as HTMLElement;
  const polishedNote = document.getElementById('polishedNote') as HTMLElement;
  const rawTranscription = document.getElementById('rawTranscription') as HTMLElement;

  if (titleElement) titleElement.textContent = 'Untitled Note';
  if (summaryEditor) summaryEditor.innerHTML = '';
  if (polishedNote) polishedNote.innerHTML = '';
  if (rawTranscription) rawTranscription.textContent = '';

  currentSessionId = null;
  currentAudioBlob = null;
  hideAudioPlayback();
}

function toggleTheme(): void {
  document.body.classList.toggle('light-mode');
  const themeButton = document.getElementById('themeToggleButton') as HTMLButtonElement;
  const icon = themeButton.querySelector('i') as HTMLElement;
  
  if (document.body.classList.contains('light-mode')) {
    icon.className = 'fas fa-moon';
    localStorage.setItem('theme', 'light');
  } else {
    icon.className = 'fas fa-sun';
    localStorage.setItem('theme', 'dark');
  }
}

function setupTabNavigation(): void {
  const tabButtons = document.querySelectorAll('.tab-button');
  const noteContents = document.querySelectorAll('.note-content');
  const activeIndicator = document.querySelector('.active-tab-indicator') as HTMLElement;

  function updateActiveTab(activeButton: HTMLElement): void {
    const activeTab = activeButton.dataset.tab!;
    
    tabButtons.forEach(btn => btn.classList.remove('active'));
    noteContents.forEach(content => content.classList.remove('active'));
    
    activeButton.classList.add('active');
    const activeContent = document.getElementById(getContentId(activeTab));
    if (activeContent) {
      activeContent.classList.add('active');
    }

    // Update indicator position
    const buttonRect = activeButton.getBoundingClientRect();
    const containerRect = activeButton.parentElement!.getBoundingClientRect();
    const left = buttonRect.left - containerRect.left;
    const width = buttonRect.width;
    
    activeIndicator.style.left = `${left}px`;
    activeIndicator.style.width = `${width}px`;
  }

  function getContentId(tab: string): string {
    switch (tab) {
      case 'summary': return 'summaryEditor';
      case 'note': return 'polishedNote';
      case 'raw': return 'rawTranscription';
      default: return 'summaryEditor';
    }
  }

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      updateActiveTab(button as HTMLElement);
    });
  });

  // Initialize first tab
  const firstTab = tabButtons[0] as HTMLElement;
  if (firstTab) {
    updateActiveTab(firstTab);
  }
}

// Copy and save functions
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copié dans le presse-papiers !');
  } catch (error) {
    console.error('Error copying to clipboard:', error);
    showToast('Erreur lors de la copie');
  }
}

function downloadAsFile(content: string, filename: string, mimeType: string = 'text/plain'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function saveAllAsZip(): Promise<void> {
  try {
    const zip = new JSZip();
    
    const titleElement = document.querySelector('.editor-title') as HTMLElement;
    const title = titleElement?.textContent || 'Untitled Note';
    
    const summaryEditor = document.getElementById('summaryEditor') as HTMLElement;
    const polishedNote = document.getElementById('polishedNote') as HTMLElement;
    const rawTranscription = document.getElementById('rawTranscription') as HTMLElement;
    
    const summary = summaryEditor?.textContent || '';
    const detailed = polishedNote?.textContent || '';
    const raw = rawTranscription?.textContent || '';
    
    zip.file('resume.txt', summary);
    zip.file('note_detaillee.md', detailed);
    zip.file('transcription_brute.txt', raw);
    
    if (currentAudioBlob) {
      zip.file('enregistrement.webm', currentAudioBlob);
    }
    
    const content = await zip.generateAsync({ type: 'blob' });
    downloadAsFile(content as any, `${title}.zip`, 'application/zip');
    
    showToast('Archive créée avec succès !');
  } catch (error) {
    console.error('Error creating zip:', error);
    showToast('Erreur lors de la création de l\'archive');
  }
}

function showToast(message: string): void {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: var(--color-accent);
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    z-index: 10000;
    animation: slideInRight 0.3s ease-out;
  `;
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOutRight 0.3s ease-in forwards';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 3000);
}

// Initialize application
async function initializeApp(): Promise<void> {
  // Initialize components
  authModal = new AuthModal();
  sessionsList = new SessionsList((session) => {
    loadSessionIntoUI(session);
  });
  pdfList = new PdfList();
  transcriptionProgress = new TranscriptionProgress();

  // Add sessions list to sidebar
  const mainContent = document.querySelector('.main-content') as HTMLElement;
  if (mainContent) {
    document.body.insertBefore(sessionsList.getElement(), mainContent);
    
    // Add PDF list to sessions list
    const sessionsContent = sessionsList.getElement().querySelector('.sessions-content') as HTMLElement;
    if (sessionsContent) {
      sessionsContent.appendChild(pdfList.getElement());
    }
  }

  // Setup tab navigation
  setupTabNavigation();
  
  // Setup audio playback
  setupAudioPlayback();

  // Check microphone status on load
  await checkMicrophoneStatus();

  // Setup event listeners
  setupEventListeners();

  // Setup auth state listener
  AuthService.onAuthStateChange(async (user) => {
    currentUser = user;
    
    if (user) {
      authModal.hide();
      await sessionsList.loadSessions();
      await pdfList.loadDocuments();
      
      // Show app with entrance animation
      const appContainer = document.getElementById('mainApp') as HTMLElement;
      if (appContainer) {
        appContainer.classList.add('app-entrance');
      }
    } else {
      authModal.show();
    }
  });

  // Load saved theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    const themeButton = document.getElementById('themeToggleButton') as HTMLButtonElement;
    const icon = themeButton?.querySelector('i') as HTMLElement;
    if (icon) icon.className = 'fas fa-moon';
  }

  // Check initial auth state
  const user = await AuthService.getCurrentUser();
  if (!user) {
    authModal.show();
  }
}

function setupEventListeners(): void {
  // Recording button
  const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
  recordButton?.addEventListener('click', async () => {
    if (!microphoneStatus.available) {
      showMicrophoneHelp();
      return;
    }

    if (mediaRecorder && mediaRecorder.state === 'recording') {
      stopRecording();
    } else {
      await startRecording();
    }
  });

  // Duration controls
  const durationInput = document.getElementById('durationInput') as HTMLInputElement;
  const setDurationButton = document.getElementById('setDurationButton') as HTMLButtonElement;
  
  setDurationButton?.addEventListener('click', () => {
    const duration = parseInt(durationInput.value);
    if (duration >= 1 && duration <= 120) {
      recordingDuration = duration;
      maxRecordingTime = duration * 60 * 1000;
      showToast(`Durée définie à ${duration} minute${duration > 1 ? 's' : ''}`);
    }
  });

  // File uploads
  const audioFileUpload = document.getElementById('audioFileUpload') as HTMLInputElement;
  const uploadAudioButton = document.getElementById('uploadAudioButton') as HTMLButtonElement;
  
  uploadAudioButton?.addEventListener('click', () => {
    audioFileUpload.click();
  });
  
  audioFileUpload?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      handleAudioUpload(file);
    }
  });

  const pdfFileUpload = document.getElementById('pdfFileUpload') as HTMLInputElement;
  const uploadPdfButton = document.getElementById('uploadPdfButton') as HTMLButtonElement;
  
  uploadPdfButton?.addEventListener('click', () => {
    pdfFileUpload.click();
  });
  
  pdfFileUpload?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) {
      handlePdfUpload(file);
    }
  });

  // Action buttons
  const themeToggleButton = document.getElementById('themeToggleButton') as HTMLButtonElement;
  themeToggleButton?.addEventListener('click', toggleTheme);

  const newButton = document.getElementById('newButton') as HTMLButtonElement;
  newButton?.addEventListener('click', clearCurrentNote);

  const logoutButton = document.getElementById('logoutButton') as HTMLButtonElement;
  logoutButton?.addEventListener('click', async () => {
    await AuthService.signOut();
    clearCurrentNote();
  });

  // Copy buttons
  const copyRawButton = document.getElementById('copyRawTranscriptionButton') as HTMLButtonElement;
  copyRawButton?.addEventListener('click', () => {
    const rawContent = document.getElementById('rawTranscription') as HTMLElement;
    if (rawContent) {
      copyToClipboard(rawContent.textContent || '');
    }
  });

  const copySummaryButton = document.getElementById('copySummaryButton') as HTMLButtonElement;
  copySummaryButton?.addEventListener('click', () => {
    const summaryContent = document.getElementById('summaryEditor') as HTMLElement;
    if (summaryContent) {
      copyToClipboard(summaryContent.textContent || '');
    }
  });

  const copyDetailedButton = document.getElementById('copyDetailedNoteButton') as HTMLButtonElement;
  copyDetailedButton?.addEventListener('click', () => {
    const detailedContent = document.getElementById('polishedNote') as HTMLElement;
    if (detailedContent) {
      copyToClipboard(detailedContent.textContent || '');
    }
  });

  // Save buttons
  const saveSummaryButton = document.getElementById('saveSummaryButton') as HTMLButtonElement;
  saveSummaryButton?.addEventListener('click', () => {
    const summaryContent = document.getElementById('summaryEditor') as HTMLElement;
    const titleElement = document.querySelector('.editor-title') as HTMLElement;
    const title = titleElement?.textContent || 'Untitled Note';
    
    if (summaryContent) {
      downloadAsFile(summaryContent.textContent || '', `${title}_resume.txt`);
    }
  });

  const saveDetailedButton = document.getElementById('saveDetailedNoteButton') as HTMLButtonElement;
  saveDetailedButton?.addEventListener('click', () => {
    const detailedContent = document.getElementById('polishedNote') as HTMLElement;
    const titleElement = document.querySelector('.editor-title') as HTMLElement;
    const title = titleElement?.textContent || 'Untitled Note';
    
    if (detailedContent) {
      downloadAsFile(detailedContent.textContent || '', `${title}_note_detaillee.md`, 'text/markdown');
    }
  });

  const saveAllButton = document.getElementById('saveAllButton') as HTMLButtonElement;
  saveAllButton?.addEventListener('click', saveAllAsZip);

  // Refresh buttons
  const refreshAllButton = document.getElementById('refreshAllButton') as HTMLButtonElement;
  refreshAllButton?.addEventListener('click', async () => {
    if (!currentSessionId) return;
    
    const rawContent = document.getElementById('rawTranscription') as HTMLElement;
    const transcription = rawContent?.textContent || '';
    
    if (!transcription) {
      showToast('Aucune transcription à traiter');
      return;
    }

    transcriptionProgress.show();
    
    try {
      transcriptionProgress.setStep(0, 'Génération du titre...');
      const title = await generateTitle(transcription);
      
      transcriptionProgress.setStep(1, 'Création du résumé...');
      const summary = await generateSummary(transcription);
      
      transcriptionProgress.setStep(2, 'Rédaction de la note détaillée...');
      const detailedNote = await generateDetailedNote(transcription);

      // Update UI
      const titleElement = document.querySelector('.editor-title') as HTMLElement;
      const summaryEditor = document.getElementById('summaryEditor') as HTMLElement;
      const polishedNote = document.getElementById('polishedNote') as HTMLElement;

      if (titleElement) titleElement.textContent = title;
      if (summaryEditor) summaryEditor.innerHTML = marked.parse(summary);
      if (polishedNote) polishedNote.innerHTML = marked.parse(detailedNote);

      // Update database
      await DatabaseService.updateSession(currentSessionId, {
        title,
        summary,
        detailed_note: detailedNote
      });

      await sessionsList.loadSessions();
      transcriptionProgress.setSuccess('Contenu régénéré avec succès !');
      
    } catch (error) {
      console.error('Error refreshing content:', error);
      transcriptionProgress.setError('Erreur lors de la régénération');
    }
  });

  const refreshNoteButton = document.getElementById('refreshNoteFromSummaryButton') as HTMLButtonElement;
  refreshNoteButton?.addEventListener('click', async () => {
    if (!currentSessionId) return;
    
    const summaryContent = document.getElementById('summaryEditor') as HTMLElement;
    const summary = summaryContent?.textContent || '';
    
    if (!summary) {
      showToast('Aucun résumé à traiter');
      return;
    }

    transcriptionProgress.show();
    
    try {
      transcriptionProgress.setStep(0, 'Rédaction de la note détaillée à partir du résumé...');
      const detailedNote = await generateDetailedNote(summary);

      const polishedNote = document.getElementById('polishedNote') as HTMLElement;
      if (polishedNote) {
        polishedNote.innerHTML = marked.parse(detailedNote);
      }

      await DatabaseService.updateSession(currentSessionId, {
        detailed_note: detailedNote
      });

      transcriptionProgress.setSuccess('Note détaillée mise à jour !');
      
    } catch (error) {
      console.error('Error refreshing note:', error);
      transcriptionProgress.setError('Erreur lors de la mise à jour');
    }
  });

  // Search functionality
  const searchInput = sessionsList.getElement().querySelector('#sessionSearchInput') as HTMLInputElement;
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const searchTerm = (e.target as HTMLInputElement).value;
      pdfList.filterDocuments(searchTerm);
    });
  }
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideInRight {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  @keyframes slideOutRight {
    from {
      transform: translateX(0);
      opacity: 1;
    }
    to {
      transform: translateX(100%);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);