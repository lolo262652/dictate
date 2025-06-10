export class AuthModal {
  private modal: HTMLElement;
  private isSignUp: boolean = false;

  constructor() {
    this.modal = this.createModal();
    document.body.appendChild(this.modal);
  }

  private createModal(): HTMLElement {
    const modal = document.createElement('div');
    modal.className = 'auth-modal';
    modal.innerHTML = `
      <div class="auth-modal-content">
        <div class="auth-modal-header">
          <div class="app-logo-container">
            <h1 class="app-logo">DICTATEAI</h1>
            <div class="app-logo-subtitle">Intelligence Artificielle de Dictée</div>
          </div>
          <h2 id="authTitle">Connexion</h2>
          <p id="authSubtitle">Connectez-vous pour accéder à vos enregistrements</p>
        </div>
        <div class="auth-modal-body">
          <form id="authForm">
            <input 
              type="email" 
              id="emailInput" 
              placeholder="Email"
              required
            />
            <input 
              type="password" 
              id="passwordInput" 
              placeholder="Mot de passe"
              required
            />
            <button type="submit" id="authSubmit" class="auth-submit-btn">
              <i class="fas fa-sign-in-alt"></i>
              <span id="authButtonText">Se connecter</span>
            </button>
          </form>
          <div class="auth-toggle">
            <p>
              <span id="authToggleText">Pas de compte ?</span>
              <button type="button" id="authToggleBtn" class="auth-toggle-btn">
                <span id="authToggleBtnText">Créer un compte</span>
              </button>
            </p>
          </div>
          <div id="authError" class="auth-error" style="display: none;"></div>
        </div>
      </div>
    `;

    // Add event listeners
    const form = modal.querySelector('#authForm') as HTMLFormElement;
    const toggleBtn = modal.querySelector('#authToggleBtn') as HTMLButtonElement;

    form.addEventListener('submit', this.handleSubmit.bind(this));
    toggleBtn.addEventListener('click', this.toggleMode.bind(this));

    return modal;
  }

  private async handleSubmit(e: Event) {
    e.preventDefault();
    
    const email = (document.getElementById('emailInput') as HTMLInputElement).value;
    const password = (document.getElementById('passwordInput') as HTMLInputElement).value;
    const errorDiv = document.getElementById('authError') as HTMLElement;

    try {
      const { AuthService } = await import('../lib/auth');
      
      let result;
      if (this.isSignUp) {
        result = await AuthService.signUp(email, password);
      } else {
        result = await AuthService.signIn(email, password);
      }

      if (result.error) {
        errorDiv.textContent = result.error.message;
        errorDiv.style.display = 'block';
      } else {
        this.hide();
      }
    } catch (error) {
      errorDiv.textContent = 'Une erreur est survenue';
      errorDiv.style.display = 'block';
    }
  }

  private toggleMode() {
    this.isSignUp = !this.isSignUp;
    
    const title = document.getElementById('authTitle') as HTMLElement;
    const subtitle = document.getElementById('authSubtitle') as HTMLElement;
    const buttonText = document.getElementById('authButtonText') as HTMLElement;
    const toggleText = document.getElementById('authToggleText') as HTMLElement;
    const toggleBtnText = document.getElementById('authToggleBtnText') as HTMLElement;
    const submitBtn = document.getElementById('authSubmit') as HTMLElement;

    if (this.isSignUp) {
      title.textContent = 'Créer un compte';
      subtitle.textContent = 'Créez votre compte pour commencer';
      buttonText.textContent = 'Créer un compte';
      toggleText.textContent = 'Déjà un compte ?';
      toggleBtnText.textContent = 'Se connecter';
      submitBtn.innerHTML = '<i class="fas fa-user-plus"></i><span>Créer un compte</span>';
    } else {
      title.textContent = 'Connexion';
      subtitle.textContent = 'Connectez-vous pour accéder à vos enregistrements';
      buttonText.textContent = 'Se connecter';
      toggleText.textContent = 'Pas de compte ?';
      toggleBtnText.textContent = 'Créer un compte';
      submitBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i><span>Se connecter</span>';
    }

    // Clear error
    const errorDiv = document.getElementById('authError') as HTMLElement;
    errorDiv.style.display = 'none';
  }

  show() {
    this.modal.style.display = 'flex';
    setTimeout(() => {
      (document.getElementById('emailInput') as HTMLInputElement).focus();
    }, 100);
  }

  hide() {
    this.modal.style.display = 'none';
  }
}