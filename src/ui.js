import { state } from './state.js';
import { FEATURES } from './features.js';
import { playlistData } from './metadata.js';
import { renderStatsDashboard } from './statistics.js';
import { renderChallengesDashboard } from './challenges.js';
import { resizeCanvas } from './visualizer.js';
import { 
    renderClustermapPlot, initializeClustermap, 
    startClustermapPulseLoop, stopClustermapPulseLoop,
    updateSimulationForces, resetClustermapZoom, kickClustermapSimulation
} from './clustermap.js';
import {
    initLibraryElements, initLibrary,
    loadPlaylist, activatePlaylistSelection, updateMetadataCard,
    renderTracklist, clearSearch, performSearch
} from './library.js';
import { escapeHtml, parseAndFormatText } from './utils.js';

/**
 * Initializes references to library DOM elements and sets up event listeners.
 */
export function initUiElements() {
    // Library elements (passed to library.js)
    initLibraryElements({
        libraryTree:      document.getElementById('library-tree'),
        playlistTitle:    document.getElementById('playlist-title'),
        playlistSubtitle: document.getElementById('playlist-subtitle'),
        playlistMeta:     document.getElementById('playlist-meta'),
        shufflePlaylistBtn: document.getElementById('shuffle-playlist-btn'),
        trackCount:       document.getElementById('track-count'),
        tracklistBody:    document.getElementById('tracklist-body'),
        searchInput:      document.getElementById('search-input'),
        clearSearchBtn:   document.getElementById('clear-search'),
        playPlaylistBtn:  document.getElementById('btn-playlist-play'),
    });

    // Password & Discord auth gate
    const passwordOverlay = document.getElementById('password-overlay');
    const passwordForm = document.getElementById('password-form');
    const passwordInput = document.getElementById('archive-password');
    const passwordError = document.getElementById('password-error');
    const CORRECT_HASH = '81eece161c57157ff3360d5edaf1d094794eaf846dc75651dbf28618901531bb';

    const isServerAuthed = Boolean(window.AUTH_STATE && window.AUTH_STATE.authenticated);
    const isLocalUnlocked = localStorage.getItem('simselections_unlocked') === 'true';

    if (isServerAuthed || isLocalUnlocked) {
        if (passwordOverlay) passwordOverlay.classList.add('hidden');
        initializeApp();
    } else {
        if (passwordForm) {
            passwordForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const hashedInput = await sha256(passwordInput.value);
                if (hashedInput === CORRECT_HASH) {
                    try {
                        // Issue view-only session on server
                        await fetch('/api/auth/login-basic', { method: 'POST' });
                    } catch (err) {
                        // Continue locally if offline
                    }
                    localStorage.setItem('simselections_unlocked', 'true');
                    if (window.AUTH_STATE && !window.AUTH_STATE.authenticated) {
                        window.AUTH_STATE.role = 'view_only';
                        window.AUTH_STATE.authenticated = true;
                        window.AUTH_STATE.canPlayAudio = false;
                    }
                    if (passwordOverlay) passwordOverlay.classList.add('hidden');
                    initializeApp();
                } else {
                    if (passwordError) passwordError.classList.remove('hidden');
                    passwordInput.value = '';
                    passwordInput.focus();
                }
            });
        }
    }
}

// ── Feature modules ───────────────────────────────────────────────────────────

/**
 * Initializes optional feature modules (Similarity Map and Statistics) based on the FEATURES config.
 */
function initializeFeatureModules() {
    // 1. Library Feature
    if (!(FEATURES && FEATURES.library)) {
        const libraryToggle = document.getElementById('tab-playlist-view');
        const libraryTreeSection = document.querySelector('.nav-section-title');
        const libraryTree = document.getElementById('library-tree');
        const viewGrid = document.querySelector('.view-grid');
        const contentHeader = document.querySelector('.content-header');
        if (libraryToggle) libraryToggle.classList.add('hidden');
        if (libraryTreeSection) libraryTreeSection.classList.add('hidden');
        if (libraryTree) libraryTree.classList.add('hidden');
        if (viewGrid) viewGrid.remove();
        if (contentHeader) contentHeader.remove();
    }

    // 2. Challenges Feature
    if (!(FEATURES && FEATURES.challenges)) {
        const challengesToggle = document.getElementById('tab-challenges-view');
        const challengesViewContainer = document.getElementById('challenges-view-container');
        if (challengesToggle) challengesToggle.classList.add('hidden');
        if (challengesViewContainer) challengesViewContainer.remove();
    }

    // 3. Cluster Map Feature
    if (FEATURES && FEATURES.clusterMap) {
        initializeClustermap();
        setupSliderListeners();
    } else {
        const clustermapToggle = document.getElementById('tab-clustermap-view');
        const clustermapViewContainer = document.getElementById('clustermap-view-container');
        if (clustermapToggle) clustermapToggle.classList.add('hidden');
        if (clustermapViewContainer) clustermapViewContainer.remove();
    }

    // 4. Statistics Feature
    if (!(FEATURES && FEATURES.statistics)) {
        const statsToggle = document.getElementById('tab-stats-view');
        const statsViewContainer = document.getElementById('stats-view-container');
        if (statsToggle) statsToggle.classList.add('hidden');
        if (statsViewContainer) statsViewContainer.remove();
    }
}

// ── View toggles ──────────────────────────────────────────────────────────────

/**
 * Configures the navigation tabs and handles toggling between different dashboard views.
 */
export function setupViewToggles() {
    const tabPlaylistView = document.getElementById('tab-playlist-view');
    const tabClustermapView = document.getElementById('tab-clustermap-view');
    const tabStatsView = document.getElementById('tab-stats-view');
    const tabChallengesView = document.getElementById('tab-challenges-view');
    const viewGrid = document.querySelector('.view-grid');
    const contentHeader = document.querySelector('.content-header');
    const clustermapViewContainer = document.getElementById('clustermap-view-container');
    const statsViewContainer = document.getElementById('stats-view-container');
    const challengesViewContainer = document.getElementById('challenges-view-container');
    const metadataCard = document.getElementById('playlist-metadata-card');

    const setActiveView = (viewName) => {
        if (tabPlaylistView) tabPlaylistView.classList.toggle('active', viewName === 'playlist');
        if (tabClustermapView) tabClustermapView.classList.toggle('active', viewName === 'clustermap');
        if (tabStatsView) tabStatsView.classList.toggle('active', viewName === 'stats');
        if (tabChallengesView) tabChallengesView.classList.toggle('active', viewName === 'challenges');

        if (viewGrid) viewGrid.classList.toggle('hidden', viewName !== 'playlist');
        if (contentHeader) contentHeader.classList.toggle('hidden', viewName !== 'playlist');
        if (clustermapViewContainer) {
            const isClustermap = viewName === 'clustermap';
            clustermapViewContainer.classList.toggle('hidden', !isClustermap);
            if (isClustermap && typeof startClustermapPulseLoop === 'function') {
                startClustermapPulseLoop();
            } else if (!isClustermap && typeof stopClustermapPulseLoop === 'function') {
                stopClustermapPulseLoop();
            }
        }
        if (statsViewContainer) statsViewContainer.classList.toggle('hidden', viewName !== 'stats');
        if (challengesViewContainer) challengesViewContainer.classList.toggle('hidden', viewName !== 'challenges');
        if (metadataCard) {
            metadataCard.classList.toggle('hidden', viewName !== 'playlist' || !state.currentPlaylist);
        }

        if (viewName === 'playlist') resizeCanvas();
        if (viewName === 'clustermap') initializeClustermap();
        if (viewName === 'stats') renderStatsDashboard();
        if (viewName === 'challenges') renderChallengesDashboard();
    };

    if (tabPlaylistView) tabPlaylistView.addEventListener('click', () => setActiveView('playlist'));
    if (tabClustermapView) tabClustermapView.addEventListener('click', () => setActiveView('clustermap'));
    if (tabStatsView) tabStatsView.addEventListener('click', () => setActiveView('stats'));
    if (tabChallengesView) tabChallengesView.addEventListener('click', () => setActiveView('challenges'));

    // Default view initialization
    if (FEATURES && FEATURES.library && tabPlaylistView) {
        setActiveView('playlist');
    } else if (FEATURES && FEATURES.challenges && tabChallengesView) {
        setActiveView('challenges');
    } else if (FEATURES && FEATURES.clusterMap && tabClustermapView) {
        setActiveView('clustermap');
    } else if (FEATURES && FEATURES.statistics && tabStatsView) {
        setActiveView('stats');
    }
}

// ── Info modal ────────────────────────────────────────────────────────────────

/**
 * Fetches and displays the project information text inside the modal dialog.
 */
export function setupInfoModal() {
    const btnMoreInfo = document.getElementById('btn-more-info');
    const infoModal = document.getElementById('info-modal');
    const btnCloseInfo = document.getElementById('btn-close-info');
    const infoModalBody = document.querySelector('.info-modal-body');

    let mainInfoHTML = '';

    if (!btnMoreInfo || !infoModal || !btnCloseInfo) return;

    if (infoModalBody) {
        fetch('info-text.txt')
            .then(res => {
                if (!res.ok) throw new Error('Failed to load info-text.txt');
                return res.text();
            })
            .then(text => {
                const blocks = text.split(/\n\s*\n/);
                infoModalBody.replaceChildren();
                blocks.forEach(block => {
                    const lines = block.trim().split('\n');
                    if (lines.length >= 2) {
                        const qText = lines[0].trim();
                        const aText = lines.slice(1).join('\n').trim();

                        const qDiv = document.createElement('div');
                        qDiv.className = 'info-question';

                        const qHeading = document.createElement('h3');
                        qHeading.textContent = qText;
                        qDiv.appendChild(qHeading);

                        const qPara = document.createElement('p');
                        const formattedFragment = parseAndFormatText(aText);
                        qPara.appendChild(formattedFragment);

                        qDiv.appendChild(qPara);
                        infoModalBody.appendChild(qDiv);
                    }
                });
                mainInfoHTML = infoModalBody.innerHTML;
            })
            .catch(err => {
                console.warn('Could not load info-text.txt:', err);
                const errorPara = document.createElement('p');
                errorPara.textContent = 'Project information is currently unavailable.';
                infoModalBody.replaceChildren(errorPara);
                mainInfoHTML = infoModalBody.innerHTML;
            });
    }

    btnMoreInfo.addEventListener('click', () => {
        const infoModalHeaderTitle = infoModal.querySelector('.info-modal-header h2');
        if (infoModalHeaderTitle) {
            infoModalHeaderTitle.textContent = 'More Information';
        }
        if (mainInfoHTML) {
            infoModalBody.innerHTML = mainInfoHTML;
        }
        infoModal.classList.remove('hidden');
    });

    const closeModal = () => infoModal.classList.add('hidden');

    btnCloseInfo.addEventListener('click', closeModal);
    infoModal.addEventListener('click', e => { if (e.target === infoModal) closeModal(); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !infoModal.classList.contains('hidden')) closeModal();
    });
}

// ── Playlist play button ──────────────────────────────────────────────────────

/**
 * Configures the main playlist play button behavior to handle play, pause, and resume states.
 */
export function setupPlaylistPlayButton() {
    const btnPlaylistPlay = document.getElementById('btn-playlist-play');
    if (!btnPlaylistPlay) return;

    btnPlaylistPlay.addEventListener('click', () => {
        if (!state.currentPlaylist || state.currentPlaylist.tracks.length === 0) return;

        const isCurrentPlaylistPlaying = state.isPlaying && state.playingPlaylist && state.playingPlaylist.id === state.currentPlaylist.id;

        if (isCurrentPlaylistPlaying) {
            pauseCurrentMedia();
        } else {
            if (state.playingPlaylist && state.playingPlaylist.id === state.currentPlaylist.id && state.currentTrackIndex !== -1) {
                resumeCurrentMedia();
            } else {
                playTrack(0);
            }
        }
    });
}

// ── App initialisation ────────────────────────────────────────────────────────

/**
 * Main application bootstrap function that initializes all modules and loads the initial playlist.
 */
export function initializeApp() {
    initLibrary();
    initializeFeatureModules();
    if (FEATURES && FEATURES.statistics) {
        renderStatsDashboard();
    }
    if (FEATURES && FEATURES.challenges) {
        renderChallengesDashboard();
    }
    setupViewToggles();
    setupInfoModal();
    setupPlaylistPlayButton();
    setupUiEventListeners();

    if (typeof playlistData !== 'undefined' && playlistData.length > 0) {
        const firstPlaylist = playlistData[playlistData.length - 1];
        const monthItem = document.querySelector(`.month-item[data-id="${firstPlaylist.id}"]`);
        if (monthItem) {
            monthItem.classList.add('active');
            const yearNode = monthItem.closest('.year-node');
            if (yearNode) {
                yearNode.classList.add('open');
                const header = yearNode.querySelector('.year-header');
                if (header) header.classList.add('open');
            }
        }
        loadPlaylist(firstPlaylist);
    }
}

// ── SHA-256 helper ────────────────────────────────────────────────────────────

async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Event listeners ───────────────────────────────────────────────────────────

/**
 * Attaches event listeners for global UI elements like search, shuffle, theme toggling, and auth.
 */
function setupUiEventListeners() {
    const searchInput = document.getElementById('search-input');
    const clearSearchBtn = document.getElementById('clear-search');
    const shufflePlaylistBtn = document.getElementById('shuffle-playlist-btn');

    const btnShuffleAll = document.getElementById('btn-shuffle-all');
    if (btnShuffleAll) {
        btnShuffleAll.addEventListener('click', () => {
            if (state.isShuffleAll) {
                state.isShuffleAll = false;
                btnShuffleAll.classList.remove('active');
            } else {
                state.isShuffleAll = true;
                state.isShuffle = false;
                const btnShuffle = document.getElementById('btn-shuffle');
                if (btnShuffle) btnShuffle.classList.remove('active');
                btnShuffleAll.classList.add('active');
                playRandomFromAll();
            }
        });
    }

    if (shufflePlaylistBtn) {
        shufflePlaylistBtn.addEventListener('click', () => {
            if (state.currentPlaylist && state.currentPlaylist.tracks.length > 0) {
                state.isShuffle = true;
                const btnShuffle = document.getElementById('btn-shuffle');
                if (btnShuffle) btnShuffle.classList.add('active');
                const randIdx = Math.floor(Math.random() * state.currentPlaylist.tracks.length);
                playTrack(randIdx);
            }
        });
    }

    // Theme toggle
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
        const savedTheme = localStorage.getItem('player-theme');
        if (savedTheme === 'alt') document.body.classList.add('theme-alt');
        else if (savedTheme === 'greyscale') document.body.classList.add('theme-greyscale');

        themeToggleBtn.addEventListener('click', () => {
            if (document.body.classList.contains('theme-alt')) {
                document.body.classList.remove('theme-alt');
                document.body.classList.add('theme-greyscale');
                localStorage.setItem('player-theme', 'greyscale');
            } else if (document.body.classList.contains('theme-greyscale')) {
                document.body.classList.remove('theme-greyscale');
                localStorage.setItem('player-theme', 'default');
            } else {
                document.body.classList.add('theme-alt');
                localStorage.setItem('player-theme', 'alt');
            }

            if (window.clustermapLoaded && window.clustermapData) renderClustermapPlot(window.clustermapData);

            const statsViewContainer = document.getElementById('stats-view-container');
            const challengesViewContainer = document.getElementById('challenges-view-container');
            if (statsViewContainer && !statsViewContainer.classList.contains('hidden')) renderStatsDashboard();
            if (challengesViewContainer && !challengesViewContainer.classList.contains('hidden')) renderChallengesDashboard();
        });
    }

    // Search
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        if (query.length > 0) {
            clearSearchBtn.classList.remove('hidden');
            performSearch(query);
        } else {
            clearSearch();
        }
    });
    searchInput.addEventListener('focus', () => {
        const query = searchInput.value.toLowerCase().trim();
        if (query.length > 0) performSearch(query);
    });
    searchInput.addEventListener('click', () => {
        const query = searchInput.value.toLowerCase().trim();
        if (query.length > 0) performSearch(query);
    });
    clearSearchBtn.addEventListener('click', () => clearSearch());
}

// ── Shared local helper (used by info modal only) ─────────────────────────────

// ── Window exports ────────────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
    window.loadPlaylist = loadPlaylist;
    window.activatePlaylistSelection = activatePlaylistSelection;
    window.updateMetadataCard = updateMetadataCard;
}

/**
 * Retrieves the current values of the Clustermap physics control sliders.
 * These values are passed into the D3 simulation to adjust physics parameters like repel strength and regularity.
 * @returns {Object} Dictionary containing the parsed values of the physics sliders.
 */
export function getSliderValues() {
    const collab = document.getElementById('ctrl-collab');
    const challenge = document.getElementById('ctrl-challenge');
    const repel = document.getElementById('ctrl-repel');
    const regularity = document.getElementById('ctrl-regularity');

    return {
        collab: collab ? parseFloat(collab.value) : 1.0,
        challenge: challenge ? parseFloat(challenge.value) : 0.15,
        repel: repel ? parseFloat(repel.value) : 10,
        regularity: regularity ? parseFloat(regularity.value) : 0.0
    };
}

/**
 * Attaches event listeners to the Clustermap UI controls (sliders, resets, info modal).
 * This wires up the HTML inputs to trigger updates in the D3 simulation.
 */
export function setupSliderListeners() {
    const sliders = [
        { id: 'ctrl-collab', valId: 'val-collab' },
        { id: 'ctrl-challenge', valId: 'val-challenge' },
        { id: 'ctrl-repel', valId: 'val-repel' },
        { id: 'ctrl-regularity', valId: 'val-regularity' }
    ];

    const defaults = { 'ctrl-collab': 1.0, 'ctrl-challenge': 0.00, 'ctrl-repel': 100, 'ctrl-regularity': 0.00 };

    sliders.forEach(({ id, valId }) => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                const valEl = document.getElementById(valId);
                if (valEl) valEl.textContent = el.value;
                if (typeof updateSimulationForces === 'function') {
                    updateSimulationForces();
                }
            });
            el.addEventListener('dblclick', () => {
                el.value = defaults[id];
                const valEl = document.getElementById(valId);
                if (valEl) valEl.textContent = el.value;
                if (typeof updateSimulationForces === 'function') {
                    updateSimulationForces();
                }
            });
        }
    });

    const layoutSelect = document.getElementById('ctrl-challenge-layout');
    if (layoutSelect) {
        layoutSelect.addEventListener('change', () => {
            if (typeof updateSimulationForces === 'function') {
                updateSimulationForces();
            }
            if (typeof kickClustermapSimulation === 'function') {
                kickClustermapSimulation();
            }
        });
    }

    // Info button using event delegation to survive HTML hot-reloads
    document.body.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'btn-clustermap-info') {
            e.preventDefault();
            e.stopPropagation();

            const infoModal = document.getElementById('info-modal');
            const infoModalBody = document.querySelector('.info-modal-body');
            const infoModalHeaderTitle = infoModal ? infoModal.querySelector('.info-modal-header h2') : null;

            if (infoModal && infoModalBody) {
                if (infoModalHeaderTitle) {
                    infoModalHeaderTitle.textContent = 'Map Layout Controls';
                }
                
                infoModalBody.innerHTML = `
                    <p><strong>Challenge Layout:</strong> Switch between a dense Fibonacci flower or a wide open ring.</p>
                    <p><strong>Collab Attraction:</strong> Pulls tracks by the same artist closer together (elastic links).</p>
                    <p><strong>Challenge Attraction:</strong> Pulls tracks towards their respective challenge month cluster.</p>
                    <p><strong>Map Spread:</strong> Adjusts the repulsive force pushing all tracks away from each other.</p>
                    <p><strong>Regularity:</strong> Slide right to pull frequent submitters to the center; slide left to pull one-time submitters to the center.</p>
                `;
                infoModal.classList.remove('hidden');
            }
        }
    });

    // Reset button
    const btnReset = document.getElementById('reset-clustermap-controls');
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            sliders.forEach(({ id, valId }) => {
                const el = document.getElementById(id);
                const valEl = document.getElementById(valId);
                if (el) {
                    el.value = defaults[id];
                    if (valEl) valEl.textContent = defaults[id];
                }
            });

            if (layoutSelect) layoutSelect.value = 'flower';

            if (typeof resetClustermapZoom === 'function') {
                resetClustermapZoom();
            }
            
            if (typeof updateSimulationForces === 'function') {
                updateSimulationForces();
            }
            
            if (typeof kickClustermapSimulation === 'function') {
                kickClustermapSimulation();
            }
        });
    }
}
