import { initUiElements } from './ui.js';
import { loadOptInList } from './optin.js';

document.addEventListener('DOMContentLoaded', async () => {
    await loadOptInList();

    // Initialize all DOM references and wire up event listeners.
    // Auth check + app bootstrap are handled inside initUiElements → setupUiEventListeners.
    initUiElements();

    // Refresh Lucide icons after DOM is populated
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
});