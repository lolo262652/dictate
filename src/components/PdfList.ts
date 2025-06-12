import { PdfService } from '../lib/pdf-service';
import { PdfViewer } from './PdfViewer';
import type { PdfDocument } from '../lib/supabase';

export class PdfList {
  private container: HTMLElement;
  private documents: PdfDocument[] = [];
  private filteredDocuments: PdfDocument[] = [];
  private pdfViewer: PdfViewer;
  private searchTerm: string = '';

  constructor() {
    this.pdfViewer = new PdfViewer(() => {
      // Callback when PDF viewer is closed
    });
    this.container = this.createContainer();
  }

  private createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'pdf-list-section';
    container.innerHTML = `
      <div class="pdf-list-header">
        <h4><i class="fas fa-file-pdf"></i> Documents PDF</h4>
        <button id="refreshPdfListBtn" class="action-button" title="Actualiser">
          <i class="fas fa-refresh"></i>
        </button>
      </div>
      <div class="pdf-list-content" id="pdfListContent">
        <div class="loading">Chargement...</div>
      </div>
    `;

    const refreshBtn = container.querySelector('#refreshPdfListBtn') as HTMLButtonElement;
    refreshBtn.addEventListener('click', () => this.loadDocuments());

    return container;
  }

  async loadDocuments() {
    const content = this.container.querySelector('#pdfListContent') as HTMLElement;
    content.innerHTML = '<div class="loading">Chargement...</div>';

    this.documents = await PdfService.getUserPdfDocuments();
    this.filteredDocuments = [...this.documents];
    this.renderDocuments();
  }

  // Method to filter documents based on search term from parent component
  filterDocuments(searchTerm: string) {
    this.searchTerm = searchTerm.toLowerCase().trim();
    
    if (!this.searchTerm) {
      this.filteredDocuments = [...this.documents];
    } else {
      this.filteredDocuments = this.documents.filter(doc => {
        const searchableText = [
          doc.title,
          doc.extracted_text
        ].join(' ').toLowerCase();

        return searchableText.includes(this.searchTerm);
      });
    }
    
    this.renderDocuments();
  }

  private highlightSearchTerm(text: string): string {
    if (!this.searchTerm || !text) return text;
    
    const regex = new RegExp(`(${this.searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<span class="highlight">$1</span>');
  }

  private renderDocuments() {
    const content = this.container.querySelector('#pdfListContent') as HTMLElement;

    if (this.filteredDocuments.length === 0) {
      if (this.searchTerm) {
        content.innerHTML = '<div class="no-documents">Aucun document PDF trouvé pour cette recherche</div>';
      } else {
        content.innerHTML = '<div class="no-documents">Aucun document PDF trouvé</div>';
      }
      return;
    }

    content.innerHTML = this.filteredDocuments.map(doc => {
      const highlightedTitle = this.highlightSearchTerm(doc.title);
      
      return `
        <div class="pdf-item" data-pdf-id="${doc.id}">
          <div class="pdf-item-icon">
            <i class="fas fa-file-pdf"></i>
          </div>
          <div class="pdf-item-info">
            <h5 class="pdf-item-title">${highlightedTitle}</h5>
            <div class="pdf-item-meta">
              <span class="pdf-item-date">${new Date(doc.created_at).toLocaleDateString('fr-FR')}</span>
              <span class="pdf-item-size">${this.formatFileSize(doc.file_size)}</span>
              <span class="pdf-item-pages">${doc.page_count} pages</span>
            </div>
          </div>
          <div class="pdf-item-actions">
            <button class="pdf-action-btn view-btn" data-action="view" title="Voir">
              <i class="fas fa-eye"></i>
            </button>
            <button class="pdf-action-btn delete-btn" data-action="delete" title="Supprimer">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Add event listeners
    content.addEventListener('click', this.handleDocumentAction.bind(this));
  }

  private async handleDocumentAction(e: Event) {
    const target = e.target as HTMLElement;
    const button = target.closest('.pdf-action-btn') as HTMLButtonElement;
    
    if (!button) return;

    const pdfItem = button.closest('.pdf-item') as HTMLElement;
    const pdfId = pdfItem.dataset.pdfId!;
    const action = button.dataset.action;
    const document = this.documents.find(d => d.id === pdfId);

    if (!document) return;

    if (action === 'view') {
      await this.pdfViewer.show(document);
    } else if (action === 'delete') {
      if (confirm('Êtes-vous sûr de vouloir supprimer ce document PDF ?')) {
        // Disable the button to prevent multiple clicks
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        
        const success = await PdfService.deletePdfDocument(pdfId);
        
        if (success) {
          // Remove the document from local arrays
          this.documents = this.documents.filter(d => d.id !== pdfId);
          this.filteredDocuments = this.filteredDocuments.filter(d => d.id !== pdfId);
          // Re-render the documents list
          this.renderDocuments();
        } else {
          alert('Erreur lors de la suppression du document');
          // Re-enable the button
          button.disabled = false;
          button.innerHTML = '<i class="fas fa-trash"></i>';
        }
      }
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getElement(): HTMLElement {
    return this.container;
  }
}