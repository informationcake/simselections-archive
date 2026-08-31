import { initUiElements } from './ui.js';
import { loadOptInList } from './optin.js';
import { initAuthAndDashboard } from './dashboard.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Fetch live authentication & session state
    await initAuthAndDashboard();

    // 2. Fetch opt-in lists & dynamic overrides
    await loadOptInList();

    // 3. Initialize UI elements & event listeners
    initUiElements();

    // 4. Refresh Lucide icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
});