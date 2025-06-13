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

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY || '');

// Global variables
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let recordingStartTime: number = 0;
let recordingTimer: number | null = null;
let recordingDuration = 30; // Default 30 minutes
let maxRecordingTime = 30 * 60 * 1000; // 30 minutes in milliseconds
let isRecording = false;
let currentUser: User | null = null;
let currentSession: DictationSession | null = null;
let authModal: AuthModal;
let sessionsList: SessionsList;
let pdfList: PdfList;
let transcriptionProgress: TranscriptionProgress;

// Audio playback variables
let currentAudio: HTMLAudioElement | null = null;
let isPlaying = false;

// Theme management
let isDarkMode = true;

// DOM elements
const recordButton = document.getElementById('recordButton') as HTMLButtonElement;
const recordingStatus = document.getElementById('recordingStatus') as HTMLSpanElement;
const rawTranscription = document.getElementById('rawTranscription') as HTMLDivElement;
const summaryEditor = document.getElementById('summaryEditor') as HTMLDivElement;
const polishedNote = document.getElementById('polishedNote') as HTMLDivElement;
const editorTitle = document.querySelector('.editor-title') as HTMLDivElement;
const durationInput = document.getElementById('durationInput') as HTMLInputElement;
const setDurationButton = document.getElementById('setDurationButton') as HTMLButtonElement;
const uploadAudioButton = document.getElementById('uploadAudioButton') as HTMLButtonElement;
const audioFileUpload = document.getElementById('audioFileUpload') as HTMLInputElement;
const uploadPdfButton = document.getElementById('uploadPdfButton') as HTMLButtonElement;
const pdfFileUpload = document.getElementById('pdfFileUpload') as HTMLInputElement;
const playRecordingButton = document.getElementById('playRecordingButton') as HTMLButtonElement;
const refreshAllButton = document.getElementById('refreshAllButton') as HTMLButtonElement;
const refreshNoteFromSummaryButton = document.getElementById('refreshNoteFromSummaryButton') as HTMLButtonElement;
const copyRawTranscriptionButton = document.getElementById('copyRawTranscriptionButton') as HTMLButtonElement;
const copySummaryButton = document.getElementById('copySummaryButton') as HTMLButtonElement;
const saveSummaryButton = document.getElementById('saveSummaryButton') as HTMLButtonElement;
const copyDetailedNoteButton = document.getElementById('copyDetailedNoteButton') as HTMLButtonElement;
const saveDetailedNoteButton = document.getElementById('saveDetailedNoteButton') as HTMLButtonElement;
const saveAllButton = document.getElementById('saveAllButton') as HTMLButtonElement;
const newButton = document.getElementById('newButton') as HTMLButtonElement;
const themeToggleButton = document.getElementById('themeToggleButton') as HTMLButtonElement;
const logoutButton = document.getElementById('logoutButton') as HTMLButtonElement;

// Audio playback elements
const audioPlaybackControls = document.getElementById('audioPlaybackControls') as HTMLDivElement;
const playPauseBtn = document.getElementById('playPauseBtn') as HTMLButtonElement;
const stopPlaybackBtn = document.getElementById('stopPlaybackBtn') as HTMLButtonElement;
const audioSeeker = document.getElementById('audioSeeker') as HTMLInputElement;
const playbackTitle = document.getElementById('playbackTitle') as HTMLSpanElement;
const playbackTime = document.getElementById('playbackTime') as HTMLSpanElement;
const audioPlayer = document.getElementById('audioPlayer') as HTMLAudioElement;

// Live recording elements
const liveRecordingTitle = document.getElementById('liveRecordingTitle') as HTMLDivElement;
const liveWaveformCanvas = document.getElementById('liveWaveformCanvas') as HTMLCanvasElement;
const liveRecordingTimerDisplay = document.getElementById('liveRecordingTimerDisplay') as HTMLDivElement;

// Tab navigation
const tabButtons = document.querySelectorAll('.tab-button');
const noteContents = document.querySelectorAll('.note-content');
const activeTabIndicator = document.querySelector('.active-tab-indicator') as HTMLElement;

// Waveform visualization
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let dataArray: Uint8Array | null = null;
let animationId: number | null = null;

// Initialize the application
async function initializeApp() {
  console.log('Initializing app...');
  
  // Show loading state
  const appContainer = document.getElementById('mainApp') as HTMLElement;
  appContainer.style.opacity = '0';
  
  // Create loading overlay
  const loadingOverlay = document.createElement('div');
  loadingOverlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: var(--color-bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    transition: opacity 0.5s ease;
  `;
  
  loadingOverlay.innerHTML = `
    <div style="text-align: center;">
      <div style="
        width: 64px;
        height: 64px;
        margin: 0 auto 24px;
        background: linear-gradient(135deg, var(--color-accent), var(--color-accent-alt));
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        color: white;
        animation: loadingPulse 2s ease-in-out infinite;
      ">
        <i class="fas fa-microphone-alt"></i>
      </div>
      <h2 style="
        font-size: 24px;
        font-weight: 600;
        color: var(--color-text);
        margin-bottom: 12px;
        font-family: var(--font-primary);
      ">DICTATEAI</h2>
      <p style="
        font-size: 14px;
        color: var(--color-text-secondary);
        margin-bottom: 32px;
        font-family: var(--font-primary);
      ">Chargement de l'application...</p>
      <div style="
        width: 200px;
        height: 4px;
        background: var(--color-surface);
        border-radius: 2px;
        overflow: hidden;
        margin: 0 auto;
      ">
        <div style="
          height: 100%;
          background: linear-gradient(90deg, var(--color-accent), var(--color-accent-alt));
          border-radius: 2px;
          width: 100%;
          animation: loadingProgress 2s ease-in-out infinite;
        "></div>
      </div>
    </div>
  `;
  
  // Add loading animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes loadingPulse {
      0%, 100% {
        transform: scale(1);
        box-shadow: 0 0 0 0 rgba(130, 170, 255, 0.4);
      }
      50% {
        transform: scale(1.05);
        box-shadow: 0 0 0 20px rgba(130, 170, 255, 0);
      }
    }
    
    @keyframes loadingProgress {
      0% {
        transform: translateX(-100%);
      }
      50% {
        transform: translateX(0%);
      }
      100% {
        transform: translateX(100%);
      }
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(loadingOverlay);
  
  try {
    // Initialize components
    authModal = new AuthModal();
    sessionsList = new SessionsList(loadSession);
    pdfList = new PdfList();
    transcriptionProgress = new TranscriptionProgress();

    // Add sessions list to the page
    const mainContent = document.querySelector('.main-content') as HTMLElement;
    mainContent.parentNode?.insertBefore(sessionsList.getElement(), mainContent);

    // Add PDF list to sessions list
    const sessionsContent = sessionsList.getElement().querySelector('.sessions-content') as HTMLElement;
    sessionsContent.appendChild(pdfList.getElement());

    // Set up authentication
    await setupAuth();
    
    // Set up event listeners
    setupEventListeners();
    setupTabNavigation();
    
    // Initialize theme
    initializeTheme();
    
    // Create a new note by default
    createNewNote();
    
    // Simulate loading time
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Hide loading overlay and show app
    loadingOverlay.style.opacity = '0';
    setTimeout(() => {
      document.body.removeChild(loadingOverlay);
      document.head.removeChild(style);
      appContainer.style.opacity = '1';
      appContainer.classList.add('app-entrance');
    }, 500);
    
    console.log('App initialized successfully');
  } catch (error) {
    console.error('Error initializing app:', error);
    // Hide loading and show error
    loadingOverlay.innerHTML = `
      <div style="text-align: center;">
        <div style="
          width: 64px;
          height: 64px;
          margin: 0 auto 24px;
          background: var(--color-recording);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 24px;
          color: white;
        ">
          <i class="fas fa-exclamation-triangle"></i>
        </div>
        <h2 style="
          font-size: 24px;
          font-weight: 600;
          color: var(--color-text);
          margin-bottom: 12px;
          font-family: var(--font-primary);
        ">Erreur de chargement</h2>
        <p style="
          font-size: 14px;
          color: var(--color-text-secondary);
          font-family: var(--font-primary);
        ">Une erreur est survenue lors du chargement de l'application.</p>
      </div>
    `;
  }
}

async function setupAuth() {
  // Check for existing user
  currentUser = await AuthService.getCurrentUser();
  
  if (currentUser) {
    console.log('User already authenticated:', currentUser.email);
    await sessionsList.loadSessions();
    await pdfList.loadDocuments();
  } else {
    authModal.show();
  }

  // Listen for auth state changes
  AuthService.onAuthStateChange(async (user) => {
    currentUser = user;
    if (user) {
      console.log('User authenticated:', user.email);
      authModal.hide();
      await sessionsList.loadSessions();
      await pdfList.loadDocuments();
    } else {
      console.log('User signed out');
      authModal.show();
      // Clear current session
      currentSession = null;
      createNewNote();
    }
  });
}

function setupEventListeners() {
  // Recording controls
  recordButton.addEventListener('click', toggleRecording);
  setDurationButton.addEventListener('click', setRecordingDuration);
  
  // Audio upload
  uploadAudioButton.addEventListener('click', () => audioFileUpload.click());
  audioFileUpload.addEventListener('change', handleAudioUpload);
  
  // PDF upload
  uploadPdfButton.addEventListener('click', () => pdfFileUpload.click());
  pdfFileUpload.addEventListener('change', handlePdfUpload);
  
  // Playback controls
  playRecordingButton.addEventListener('click', toggleAudioPlayback);
  playPauseBtn.addEventListener('click', toggleAudioPlayback);
  stopPlaybackBtn.addEventListener('click', stopAudioPlayback);
  audioSeeker.addEventListener('input', seekAudio);
  audioPlayer.addEventListener('timeupdate', updatePlaybackTime);
  audioPlayer.addEventListener('ended', () => {
    stopAudioPlayback();
  });
  
  // Action buttons
  refreshAllButton.addEventListener('click', refreshAllFromRaw);
  refreshNoteFromSummaryButton.addEventListener('click', refreshNoteFromSummary);
  copyRawTranscriptionButton.addEventListener('click', () => copyToClipboard(rawTranscription.textContent || ''));
  copySummaryButton.addEventListener('click', () => copyToClipboard(summaryEditor.textContent || ''));
  saveSummaryButton.addEventListener('click', () => saveAsFile(summaryEditor.textContent || '', 'resume.txt'));
  copyDetailedNoteButton.addEventListener('click', () => copyToClipboard(polishedNote.textContent || ''));
  saveDetailedNoteButton.addEventListener('click', () => saveAsFile(polishedNote.textContent || '', 'note-detaillee.txt'));
  saveAllButton.addEventListener('click', saveAllAsZip);
  newButton.addEventListener('click', createNewNote);
  themeToggleButton.addEventListener('click', toggleTheme);
  logoutButton.addEventListener('click', handleLogout);

  // Content editing
  summaryEditor.addEventListener('input', handleSummaryEdit);
  polishedNote.addEventListener('input', handleNoteEdit);
  rawTranscription.addEventListener('input', handleRawEdit);
  editorTitle.addEventListener('input', handleTitleEdit);

  // Placeholder management
  setupPlaceholderManagement();
}

function setupPlaceholderManagement() {
  const editableElements = [summaryEditor, polishedNote, rawTranscription];
  
  editableElements.forEach(element => {
    element.addEventListener('focus', () => {
      if (element.textContent?.trim() === '' || element.classList.contains('placeholder-active')) {
        element.textContent = '';
        element.classList.remove('placeholder-active');
      }
    });
    
    element.addEventListener('blur', () => {
      if (element.textContent?.trim() === '') {
        element.classList.add('placeholder-active');
        element.textContent = element.getAttribute('placeholder') || '';
      }
    });
    
    // Initialize placeholder state
    if (element.textContent?.trim() === '') {
      element.classList.add('placeholder-active');
      element.textContent = element.getAttribute('placeholder') || '';
    }
  });
}

function setupTabNavigation() {
  tabButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      // Remove active class from all tabs and contents
      tabButtons.forEach(btn => btn.classList.remove('active'));
      noteContents.forEach(content => content.classList.remove('active'));
      
      // Add active class to clicked tab and corresponding content
      button.classList.add('active');
      noteContents[index].classList.add('active');
      
      // Update indicator position
      updateTabIndicator(button as HTMLElement);
    });
  });
  
  // Initialize indicator position
  const activeTab = document.querySelector('.tab-button.active') as HTMLElement;
  if (activeTab) {
    updateTabIndicator(activeTab);
  }
}

function updateTabIndicator(activeTab: HTMLElement) {
  const tabNavigation = activeTab.parentElement as HTMLElement;
  const indicator = activeTabIndicator;
  
  const tabRect = activeTab.getBoundingClientRect();
  const navRect = tabNavigation.getBoundingClientRect();
  
  const left = tabRect.left - navRect.left;
  const width = tabRect.width;
  
  indicator.style.left = `${left}px`;
  indicator.style.width = `${width}px`;
}

function initializeTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'light') {
    isDarkMode = false;
    document.body.classList.add('light-mode');
    themeToggleButton.innerHTML = '<i class="fas fa-moon"></i>';
  }
}

function toggleTheme() {
  isDarkMode = !isDarkMode;
  document.body.classList.toggle('light-mode');
  
  if (isDarkMode) {
    themeToggleButton.innerHTML = '<i class="fas fa-sun"></i>';
    localStorage.setItem('theme', 'dark');
  } else {
    themeToggleButton.innerHTML = '<i class="fas fa-moon"></i>';
    localStorage.setItem('theme', 'light');
  }
}

function createNewNote() {
  // Clear current session
  currentSession = null;
  
  // Reset all content
  editorTitle.textContent = 'Nouvelle Note';
  rawTranscription.textContent = '';
  summaryEditor.textContent = '';
  polishedNote.textContent = '';
  
  // Reset placeholder states
  rawTranscription.classList.add('placeholder-active');
  rawTranscription.textContent = rawTranscription.getAttribute('placeholder') || '';
  
  summaryEditor.classList.add('placeholder-active');
  summaryEditor.textContent = summaryEditor.getAttribute('placeholder') || '';
  
  polishedNote.classList.add('placeholder-active');
  polishedNote.textContent = polishedNote.getAttribute('placeholder') || '';
  
  // Hide audio controls
  hideAudioControls();
  
  // Reset recording interface
  resetRecordingInterface();
  
  // Switch to summary tab
  const summaryTab = document.querySelector('[data-tab="summary"]') as HTMLElement;
  if (summaryTab) {
    summaryTab.click();
  }
  
  console.log('Created new note');
}

async function loadSession(session: DictationSession) {
  currentSession = session;
  
  // Update UI with session data
  editorTitle.textContent = session.title;
  
  // Load content and remove placeholder states
  if (session.raw_transcription) {
    rawTranscription.textContent = session.raw_transcription;
    rawTranscription.classList.remove('placeholder-active');
  } else {
    rawTranscription.classList.add('placeholder-active');
    rawTranscription.textContent = rawTranscription.getAttribute('placeholder') || '';
  }
  
  if (session.summary) {
    summaryEditor.textContent = session.summary;
    summaryEditor.classList.remove('placeholder-active');
  } else {
    summaryEditor.classList.add('placeholder-active');
    summaryEditor.textContent = summaryEditor.getAttribute('placeholder') || '';
  }
  
  if (session.detailed_note) {
    polishedNote.textContent = session.detailed_note;
    polishedNote.classList.remove('placeholder-active');
  } else {
    polishedNote.classList.add('placeholder-active');
    polishedNote.textContent = polishedNote.getAttribute('placeholder') || '';
  }
  
  // Load audio if available
  if (session.audio_file_path) {
    try {
      const audioUrl = await StorageService.getAudioFileUrl(session.audio_file_path);
      if (audioUrl) {
        setupAudioPlayback(audioUrl, session.title);
      }
    } catch (error) {
      console.error('Error loading audio:', error);
    }
  } else {
    hideAudioControls();
  }
  
  console.log('Loaded session:', session.title);
}

async function toggleRecording() {
  if (!currentUser) {
    alert('Veuillez vous connecter pour enregistrer');
    return;
  }

  if (isRecording) {
    await stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    // Create a new note for each recording
    createNewNote();
    
    const stream = await navigator.mediaDevices.getUserMedia({ 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 44100
      } 
    });
    
    // Set up audio context for visualization
    setupAudioVisualization(stream);
    
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });
    
    audioChunks = [];
    recordingStartTime = Date.now();
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };
    
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      await processRecording(audioBlob);
      
      // Stop all tracks
      stream.getTracks().forEach(track => track.stop());
      
      // Clean up audio context
      if (audioContext) {
        audioContext.close();
        audioContext = null;
      }
    };
    
    mediaRecorder.start(1000); // Collect data every second
    isRecording = true;
    
    // Update UI for live recording
    updateRecordingUI(true);
    startRecordingTimer();
    
    // Set auto-stop timer
    setTimeout(() => {
      if (isRecording) {
        stopRecording();
      }
    }, maxRecordingTime);
    
  } catch (error) {
    console.error('Error starting recording:', error);
    alert('Erreur lors du démarrage de l\'enregistrement. Vérifiez les permissions du microphone.');
  }
}

async function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    
    // Update UI
    updateRecordingUI(false);
    stopRecordingTimer();
    
    // Stop visualization
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  }
}

function setupAudioVisualization(stream: MediaStream) {
  audioContext = new AudioContext();
  analyser = audioContext.createAnalyser();
  const source = audioContext.createMediaStreamSource(stream);
  
  analyser.fftSize = 256;
  const bufferLength = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufferLength);
  
  source.connect(analyser);
  
  drawWaveform();
}

function drawWaveform() {
  if (!analyser || !dataArray) return;
  
  const canvas = liveWaveformCanvas;
  const ctx = canvas.getContext('2d')!;
  
  // Set canvas size
  canvas.width = canvas.offsetWidth * window.devicePixelRatio;
  canvas.height = canvas.offsetHeight * window.devicePixelRatio;
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  
  const width = canvas.offsetWidth;
  const height = canvas.offsetHeight;
  
  analyser.getByteFrequencyData(dataArray);
  
  ctx.fillStyle = 'transparent';
  ctx.fillRect(0, 0, width, height);
  
  const barWidth = (width / dataArray.length) * 2.5;
  let barHeight;
  let x = 0;
  
  const gradient = ctx.createLinearGradient(0, height, 0, 0);
  gradient.addColorStop(0, 'var(--color-accent)');
  gradient.addColorStop(1, 'var(--color-accent-alt)');
  
  for (let i = 0; i < dataArray.length; i++) {
    barHeight = (dataArray[i] / 255) * height * 0.8;
    
    ctx.fillStyle = gradient;
    ctx.fillRect(x, height - barHeight, barWidth, barHeight);
    
    x += barWidth + 1;
  }
  
  animationId = requestAnimationFrame(drawWaveform);
}

function updateRecordingUI(recording: boolean) {
  const recordingInterface = document.querySelector('.recording-interface') as HTMLElement;
  
  if (recording) {
    recordButton.classList.add('recording');
    recordingInterface.classList.add('is-live');
    
    // Show live recording elements
    liveRecordingTitle.style.display = 'block';
    liveWaveformCanvas.style.display = 'block';
    liveRecordingTimerDisplay.style.display = 'block';
    
    recordingStatus.textContent = 'Recording...';
  } else {
    recordButton.classList.remove('recording');
    recordingInterface.classList.remove('is-live');
    
    // Hide live recording elements
    liveRecordingTitle.style.display = 'none';
    liveWaveformCanvas.style.display = 'none';
    liveRecordingTimerDisplay.style.display = 'none';
    
    recordingStatus.textContent = 'Processing...';
  }
}

function startRecordingTimer() {
  recordingTimer = setInterval(() => {
    const elapsed = Date.now() - recordingStartTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    const centiseconds = Math.floor((elapsed % 1000) / 10);
    
    liveRecordingTimerDisplay.textContent = 
      `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
  }, 10);
}

function stopRecordingTimer() {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
}

async function processRecording(audioBlob: Blob) {
  if (!currentUser) return;
  
  const recordingDurationMs = Date.now() - recordingStartTime;
  const recordingDurationSeconds = Math.floor(recordingDurationMs / 1000);
  
  // Show transcription progress
  transcriptionProgress.show(() => {
    // Cancel callback - could implement cancellation logic here
    console.log('Transcription cancelled by user');
  });
  
  try {
    // Step 1: Create session in database
    transcriptionProgress.setStep(0, 'Création de la session...');
    
    currentSession = await DatabaseService.createSession({
      user_id: currentUser.id,
      title: 'Nouvel Enregistrement',
      raw_transcription: '',
      summary: '',
      detailed_note: '',
      recording_duration: recordingDurationSeconds
    });
    
    if (!currentSession) {
      throw new Error('Impossible de créer la session');
    }
    
    // Step 2: Upload audio file
    transcriptionProgress.setStep(1, 'Téléversement de l\'audio...');
    
    const audioFile = new File([audioBlob], `recording-${currentSession.id}.webm`, { type: 'audio/webm' });
    const audioPath = await StorageService.uploadAudioFile(audioFile, currentUser.id, currentSession.id);
    
    if (!audioPath) {
      throw new Error('Impossible de téléverser l\'audio');
    }
    
    // Update session with audio path
    await DatabaseService.updateSession(currentSession.id, { audio_file_path: audioPath });
    
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
    currentSession = await DatabaseService.updateSession(currentSession.id, {
      title: title || 'Enregistrement',
      raw_transcription: transcription,
      summary: summary,
      detailed_note: detailedNote
    });
    
    if (currentSession) {
      // Update UI
      editorTitle.textContent = currentSession.title;
      
      rawTranscription.textContent = transcription;
      rawTranscription.classList.remove('placeholder-active');
      
      summaryEditor.textContent = summary;
      summaryEditor.classList.remove('placeholder-active');
      
      polishedNote.textContent = detailedNote;
      polishedNote.classList.remove('placeholder-active');
      
      // Set up audio playback
      const audioUrl = await StorageService.getAudioFileUrl(audioPath);
      if (audioUrl) {
        setupAudioPlayback(audioUrl, currentSession.title);
      }
      
      // Refresh sessions list
      await sessionsList.loadSessions();
    }
    
    transcriptionProgress.setSuccess('Enregistrement traité avec succès !');
    
  } catch (error) {
    console.error('Error processing recording:', error);
    transcriptionProgress.setError('Erreur lors du traitement de l\'enregistrement');
    
    // Clean up failed session
    if (currentSession) {
      await DatabaseService.deleteSession(currentSession.id);
      currentSession = null;
    }
  } finally {
    recordingStatus.textContent = 'Ready to record';
  }
}

async function transcribeAudio(audioBlob: Blob): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    // Convert blob to base64
    const arrayBuffer = await audioBlob.arrayBuffer();
    const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "audio/webm",
          data: base64Audio
        }
      },
      "Transcris fidèlement cet enregistrement audio en français. Retourne uniquement le texte transcrit, sans commentaires ni formatage."
    ]);
    
    return result.response.text().trim();
  } catch (error) {
    console.error('Error transcribing audio:', error);
    throw new Error('Erreur lors de la transcription');
  }
}

async function generateTitle(transcription: string): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Génère un titre court et descriptif (maximum 50 caractères) pour cette transcription :

${transcription}

Retourne uniquement le titre, sans guillemets ni formatage.`;
    
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error('Error generating title:', error);
    return 'Enregistrement';
  }
}

async function generateSummary(transcription: string): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Crée un résumé concis et structuré de cette transcription :

${transcription}

Le résumé doit :
- Être en français
- Capturer les points clés et idées principales
- Être organisé avec des puces ou des paragraphes courts
- Faire environ 100-200 mots
- Être facilement modifiable par l'utilisateur

Retourne uniquement le résumé, sans titre ni introduction.`;
    
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error('Error generating summary:', error);
    return 'Erreur lors de la génération du résumé';
  }
}

async function generateDetailedNote(transcription: string): Promise<string> {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Transforme cette transcription en une note détaillée et bien structurée :

${transcription}

La note doit :
- Être en français
- Avoir une structure claire avec des titres et sous-titres
- Développer les idées principales avec des détails
- Être bien formatée et professionnelle
- Inclure tous les points importants de la transcription
- Être facilement modifiable par l'utilisateur

Utilise un formatage markdown simple (titres avec #, listes avec -, etc.).`;
    
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error('Error generating detailed note:', error);
    return 'Erreur lors de la génération de la note détaillée';
  }
}

function setRecordingDuration() {
  const duration = parseInt(durationInput.value);
  if (duration >= 1 && duration <= 120) {
    recordingDuration = duration;
    maxRecordingTime = duration * 60 * 1000;
    alert(`Durée d'enregistrement définie à ${duration} minute(s)`);
  } else {
    alert('Veuillez entrer une durée entre 1 et 120 minutes');
  }
}

async function handleAudioUpload(event: Event) {
  if (!currentUser) {
    alert('Veuillez vous connecter pour téléverser un fichier audio');
    return;
  }

  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  
  if (!file) return;
  
  // Create a new note for the uploaded audio
  createNewNote();
  
  // Show transcription progress
  transcriptionProgress.show();
  
  try {
    // Step 1: Create session
    transcriptionProgress.setStep(0, 'Création de la session...');
    
    currentSession = await DatabaseService.createSession({
      user_id: currentUser.id,
      title: file.name.replace(/\.[^/.]+$/, ""), // Remove file extension
      raw_transcription: '',
      summary: '',
      detailed_note: '',
      recording_duration: 0 // Will be updated after processing
    });
    
    if (!currentSession) {
      throw new Error('Impossible de créer la session');
    }
    
    // Step 2: Upload file
    transcriptionProgress.setStep(1, 'Téléversement du fichier...');
    
    const audioPath = await StorageService.uploadAudioFile(file, currentUser.id, currentSession.id);
    
    if (!audioPath) {
      throw new Error('Impossible de téléverser le fichier');
    }
    
    await DatabaseService.updateSession(currentSession.id, { audio_file_path: audioPath });
    
    // Step 3: Transcribe
    transcriptionProgress.setStep(2, 'Transcription par IA...');
    
    const transcription = await transcribeAudio(file);
    
    // Step 4: Generate title
    transcriptionProgress.setStep(3, 'Génération du titre...');
    
    const title = await generateTitle(transcription);
    
    // Step 5: Generate summary
    transcriptionProgress.setStep(4, 'Création du résumé...');
    
    const summary = await generateSummary(transcription);
    
    // Step 6: Generate detailed note
    transcriptionProgress.setStep(5, 'Rédaction de la note détaillée...');
    
    const detailedNote = await generateDetailedNote(transcription);
    
    // Update session
    currentSession = await DatabaseService.updateSession(currentSession.id, {
      title: title || file.name,
      raw_transcription: transcription,
      summary: summary,
      detailed_note: detailedNote
    });
    
    if (currentSession) {
      // Update UI
      editorTitle.textContent = currentSession.title;
      
      rawTranscription.textContent = transcription;
      rawTranscription.classList.remove('placeholder-active');
      
      summaryEditor.textContent = summary;
      summaryEditor.classList.remove('placeholder-active');
      
      polishedNote.textContent = detailedNote;
      polishedNote.classList.remove('placeholder-active');
      
      // Set up audio playback
      const audioUrl = await StorageService.getAudioFileUrl(audioPath);
      if (audioUrl) {
        setupAudioPlayback(audioUrl, currentSession.title);
      }
      
      // Refresh sessions list
      await sessionsList.loadSessions();
    }
    
    transcriptionProgress.setSuccess('Fichier audio traité avec succès !');
    
  } catch (error) {
    console.error('Error processing uploaded audio:', error);
    transcriptionProgress.setError('Erreur lors du traitement du fichier audio');
    
    // Clean up failed session
    if (currentSession) {
      await DatabaseService.deleteSession(currentSession.id);
      currentSession = null;
    }
  }
  
  // Clear input
  input.value = '';
}

async function handlePdfUpload(event: Event) {
  if (!currentUser) {
    alert('Veuillez vous connecter pour téléverser un PDF');
    return;
  }

  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  
  if (!file) return;
  
  try {
    // Extract text from PDF
    const extractedText = await PdfService.extractTextFromPdf(file);
    
    // Upload PDF file
    const filePath = await PdfService.uploadPdfFile(file, currentUser.id, currentSession?.id);
    
    if (!filePath) {
      throw new Error('Impossible de téléverser le PDF');
    }
    
    // Create PDF document record
    const pdfDocument = await PdfService.createPdfDocument({
      session_id: currentSession?.id,
      user_id: currentUser.id,
      title: file.name,
      file_path: filePath,
      file_size: file.size,
      page_count: 1, // Will be updated if we can get actual page count
      extracted_text: extractedText
    });
    
    if (pdfDocument) {
      alert('PDF téléversé avec succès !');
      await pdfList.loadDocuments();
    }
    
  } catch (error) {
    console.error('Error uploading PDF:', error);
    alert('Erreur lors du téléversement du PDF');
  }
  
  // Clear input
  input.value = '';
}

function setupAudioPlayback(audioUrl: string, title: string) {
  audioPlayer.src = audioUrl;
  playbackTitle.textContent = `Lecture - ${title}`;
  
  // Show playback controls
  audioPlaybackControls.style.display = 'block';
  playRecordingButton.style.display = 'block';
  
  // Update recording interface state
  const recordingInterface = document.querySelector('.recording-interface') as HTMLElement;
  recordingInterface.classList.add('is-playback');
  
  // Load metadata
  audioPlayer.addEventListener('loadedmetadata', () => {
    audioSeeker.max = audioPlayer.duration.toString();
    updatePlaybackTime();
  });
}

function hideAudioControls() {
  audioPlaybackControls.style.display = 'none';
  playRecordingButton.style.display = 'none';
  
  const recordingInterface = document.querySelector('.recording-interface') as HTMLElement;
  recordingInterface.classList.remove('is-playback');
  
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  isPlaying = false;
}

function resetRecordingInterface() {
  const recordingInterface = document.querySelector('.recording-interface') as HTMLElement;
  recordingInterface.classList.remove('is-live', 'is-playback');
  recordingStatus.textContent = 'Ready to record';
}

function toggleAudioPlayback() {
  if (!audioPlayer.src) return;
  
  if (isPlaying) {
    audioPlayer.pause();
    playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
    playPauseBtn.classList.remove('playing');
    isPlaying = false;
  } else {
    audioPlayer.play();
    playPauseBtn.innerHTML = '<i class="fas fa-pause"></i>';
    playPauseBtn.classList.add('playing');
    isPlaying = true;
  }
}

function stopAudioPlayback() {
  audioPlayer.pause();
  audioPlayer.currentTime = 0;
  playPauseBtn.innerHTML = '<i class="fas fa-play"></i>';
  playPauseBtn.classList.remove('playing');
  isPlaying = false;
  updatePlaybackTime();
}

function seekAudio() {
  const seekTime = parseFloat(audioSeeker.value);
  audioPlayer.currentTime = seekTime;
}

function updatePlaybackTime() {
  const current = audioPlayer.currentTime;
  const duration = audioPlayer.duration || 0;
  
  audioSeeker.value = current.toString();
  
  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };
  
  playbackTime.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
}

async function refreshAllFromRaw() {
  const rawText = rawTranscription.textContent?.trim();
  
  if (!rawText || rawTranscription.classList.contains('placeholder-active')) {
    alert('Aucune transcription brute disponible pour la régénération');
    return;
  }
  
  try {
    recordingStatus.textContent = 'Regenerating content...';
    
    // Generate new title
    const title = await generateTitle(rawText);
    editorTitle.textContent = title;
    
    // Generate new summary
    const summary = await generateSummary(rawText);
    summaryEditor.textContent = summary;
    summaryEditor.classList.remove('placeholder-active');
    
    // Generate new detailed note
    const detailedNote = await generateDetailedNote(rawText);
    polishedNote.textContent = detailedNote;
    polishedNote.classList.remove('placeholder-active');
    
    // Update session if exists
    if (currentSession) {
      await DatabaseService.updateSession(currentSession.id, {
        title: title,
        summary: summary,
        detailed_note: detailedNote
      });
      
      await sessionsList.loadSessions();
    }
    
    recordingStatus.textContent = 'Content regenerated successfully';
    setTimeout(() => {
      recordingStatus.textContent = 'Ready to record';
    }, 2000);
    
  } catch (error) {
    console.error('Error regenerating content:', error);
    alert('Erreur lors de la régénération du contenu');
    recordingStatus.textContent = 'Ready to record';
  }
}

async function refreshNoteFromSummary() {
  const summaryText = summaryEditor.textContent?.trim();
  
  if (!summaryText || summaryEditor.classList.contains('placeholder-active')) {
    alert('Aucun résumé disponible pour générer la note détaillée');
    return;
  }
  
  try {
    recordingStatus.textContent = 'Generating detailed note...';
    
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `Développe ce résumé en une note détaillée et bien structurée :

${summaryText}

La note doit :
- Être en français
- Avoir une structure claire avec des titres et sous-titres
- Développer chaque point du résumé avec plus de détails
- Être bien formatée et professionnelle
- Utiliser un formatage markdown simple (titres avec #, listes avec -, etc.)`;
    
    const result = await model.generateContent(prompt);
    const detailedNote = result.response.text().trim();
    
    polishedNote.textContent = detailedNote;
    polishedNote.classList.remove('placeholder-active');
    
    // Update session if exists
    if (currentSession) {
      await DatabaseService.updateSession(currentSession.id, {
        detailed_note: detailedNote
      });
    }
    
    recordingStatus.textContent = 'Detailed note generated successfully';
    setTimeout(() => {
      recordingStatus.textContent = 'Ready to record';
    }, 2000);
    
  } catch (error) {
    console.error('Error generating detailed note from summary:', error);
    alert('Erreur lors de la génération de la note détaillée');
    recordingStatus.textContent = 'Ready to record';
  }
}

async function handleSummaryEdit() {
  if (summaryEditor.classList.contains('placeholder-active')) return;
  
  const summaryText = summaryEditor.textContent?.trim() || '';
  
  if (currentSession) {
    await DatabaseService.updateSession(currentSession.id, {
      summary: summaryText
    });
  }
}

async function handleNoteEdit() {
  if (polishedNote.classList.contains('placeholder-active')) return;
  
  const noteText = polishedNote.textContent?.trim() || '';
  
  if (currentSession) {
    await DatabaseService.updateSession(currentSession.id, {
      detailed_note: noteText
    });
  }
}

async function handleRawEdit() {
  if (rawTranscription.classList.contains('placeholder-active')) return;
  
  const rawText = rawTranscription.textContent?.trim() || '';
  
  if (currentSession) {
    await DatabaseService.updateSession(currentSession.id, {
      raw_transcription: rawText
    });
  }
}

async function handleTitleEdit() {
  const titleText = editorTitle.textContent?.trim() || 'Untitled Note';
  
  if (currentSession) {
    await DatabaseService.updateSession(currentSession.id, {
      title: titleText
    });
    
    await sessionsList.loadSessions();
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(() => {
    // Show temporary feedback
    const originalStatus = recordingStatus.textContent;
    recordingStatus.textContent = 'Copied to clipboard!';
    setTimeout(() => {
      recordingStatus.textContent = originalStatus;
    }, 1500);
  }).catch(err => {
    console.error('Error copying to clipboard:', err);
    alert('Erreur lors de la copie dans le presse-papiers');
  });
}

function saveAsFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function saveAllAsZip() {
  if (!currentSession) {
    alert('Aucune session active à sauvegarder');
    return;
  }
  
  try {
    const zip = new JSZip();
    
    // Add text files
    const rawText = rawTranscription.classList.contains('placeholder-active') ? '' : rawTranscription.textContent || '';
    const summaryText = summaryEditor.classList.contains('placeholder-active') ? '' : summaryEditor.textContent || '';
    const noteText = polishedNote.classList.contains('placeholder-active') ? '' : polishedNote.textContent || '';
    
    if (rawText) zip.file('transcription-brute.txt', rawText);
    if (summaryText) zip.file('resume.txt', summaryText);
    if (noteText) zip.file('note-detaillee.txt', noteText);
    
    // Add audio file if available
    if (currentSession.audio_file_path) {
      try {
        const audioUrl = await StorageService.getAudioFileUrl(currentSession.audio_file_path);
        if (audioUrl) {
          const response = await fetch(audioUrl);
          const audioBlob = await response.blob();
          zip.file('enregistrement.webm', audioBlob);
        }
      } catch (error) {
        console.warn('Could not include audio file in zip:', error);
      }
    }
    
    // Generate and download zip
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentSession.title || 'session'}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
  } catch (error) {
    console.error('Error creating zip file:', error);
    alert('Erreur lors de la création du fichier ZIP');
  }
}

async function handleLogout() {
  try {
    await AuthService.signOut();
    // Auth state change will handle UI updates
  } catch (error) {
    console.error('Error signing out:', error);
    alert('Erreur lors de la déconnexion');
  }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', initializeApp);

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.hidden && isRecording) {
    // Optionally pause recording when page is hidden
    console.log('Page hidden while recording');
  }
});

// Handle beforeunload to warn about unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (isRecording) {
    e.preventDefault();
    e.returnValue = 'Un enregistrement est en cours. Êtes-vous sûr de vouloir quitter ?';
  }
});