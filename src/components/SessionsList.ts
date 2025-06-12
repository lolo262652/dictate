import { DatabaseService } from '../lib/database';
import type { DictationSession } from '../lib/supabase';

export class SessionsList {
  private container: HTMLElement;
  private sessions: DictationSession[] = [];
  private onSessionSelect: (session: DictationSession) => void;

  constructor(onSessionSelect: (session: DictationSession) => void) {
    this.onSessionSelect = onSessionSelect;
    this.container = this.createContainer();
  }

  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'sessions-list';
    container.innerHTML = `
      <div class="sessions-header">
        <h3>Mes Enregistrements</h3>
        <button id="refreshSessionsBtn" class="action-button" title="Actualiser">
          <i class="fas fa-refresh"></i>
        </button>
      </div>
      <div class="sessions-content" id="sessionsContent">
        <div class="loading">Chargement...</div>
      </div>
    `;

    const refreshBtn = container.querySelector('#refreshSessionsBtn') as HTMLButtonElement;
    refreshBtn.addEventListener('click', () => this.loadSessions());

    return container;
  }

  async loadSessions() {
    const content = this.container.querySelector('#sessionsContent') as HTMLElement;
    content.innerHTML = '<div class="loading">Chargement...</div>';

    try {
      this.sessions = await DatabaseService.getUserSessions();
      this.renderSessions();
    } catch (error) {
      console.error('Error loading sessions:', error);
      content.innerHTML = '<div class="no-sessions">Erreur lors du chargement des sessions</div>';
    }
  }

  private renderSessions() {
    const content = this.container.querySelector('#sessionsContent') as HTMLElement;

    if (this.sessions.length === 0) {
      content.innerHTML = '<div class="no-sessions">Aucun enregistrement trouvé</div>';
      return;
    }

    content.innerHTML = this.sessions.map(session => `
      <div class="session-item" data-session-id="${session.id}">
        <div class="session-info">
          <h4 class="session-title">${session.title}</h4>
          <div class="session-meta">
            <span class="session-date">${new Date(session.created_at).toLocaleDateString('fr-FR')}</span>
            <span class="session-duration">${Math.floor(session.recording_duration / 60)}:${(session.recording_duration % 60).toString().padStart(2, '0')}</span>
          </div>
        </div>
        <div class="session-actions">
          <button class="session-action-btn load-btn" data-action="load" title="Charger">
            <i class="fas fa-folder-open"></i>
          </button>
          <button class="session-action-btn delete-btn" data-action="delete" title="Supprimer">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </div>
    `).join('');

    // Add event listeners
    content.addEventListener('click', this.handleSessionAction.bind(this));
  }

  private async handleSessionAction(e: Event) {
    const target = e.target as HTMLElement;
    const button = target.closest('.session-action-btn') as HTMLButtonElement;
    
    if (!button) return;

    const sessionItem = button.closest('.session-item') as HTMLElement;
    const sessionId = sessionItem.dataset.sessionId!;
    const action = button.dataset.action;
    const session = this.sessions.find(s => s.id === sessionId);

    if (!session) return;

    try {
      if (action === 'load') {
        this.onSessionSelect(session);
      } else if (action === 'delete') {
        if (confirm('Êtes-vous sûr de vouloir supprimer cet enregistrement ?')) {
          // Disable the button to prevent multiple clicks
          button.disabled = true;
          button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
          
          const success = await DatabaseService.deleteSession(sessionId);
          
          if (success) {
            // Remove the session from the local array
            this.sessions = this.sessions.filter(s => s.id !== sessionId);
            // Re-render the sessions list
            this.renderSessions();
          } else {
            alert('Erreur lors de la suppression de la session');
            // Re-enable the button
            button.disabled = false;
            button.innerHTML = '<i class="fas fa-trash"></i>';
          }
        }
      }
    } catch (error) {
      console.error('Error handling session action:', error);
      if (action === 'delete') {
        alert('Erreur lors de la suppression de la session');
        // Re-enable the button
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-trash"></i>';
      }
    }
  }

  getElement(): HTMLElement {
    return this.container;
  }
}