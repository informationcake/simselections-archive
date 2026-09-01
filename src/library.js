import { state, events } from './state.js';
import { playlistData } from './metadata.js';
import { playTrack, updatePlaylistPlayButtonState } from './player.js';
import { escapeHtml } from './utils.js';
// ── Module-level DOM references (lazily populated) ────────────────────────────
let libraryTree = null;
let playlistTitle = null;
let playlistSubtitle = null;
let playlistMeta = null;
let shufflePlaylistBtn = null;
let trackCount = null;
let tracklistBody = null;
let searchInput = null;
let clearSearchBtn = null;
let playPlaylistBtn = null;

/**
 * Initializes DOM element references for the library module.
 * @param {Object} refs - Object containing necessary DOM elements.
 */
export function initLibraryElements(refs) {
    libraryTree     = refs.libraryTree;
    playlistTitle   = refs.playlistTitle;
    playlistSubtitle = refs.playlistSubtitle;
    playlistMeta    = refs.playlistMeta;
    shufflePlaylistBtn = refs.shufflePlaylistBtn;
    trackCount      = refs.trackCount;
    tracklistBody   = refs.tracklistBody;
    searchInput     = refs.searchInput;
    clearSearchBtn  = refs.clearSearchBtn;
    playPlaylistBtn = refs.playPlaylistBtn;
}

// ── Library tree ──────────────────────────────────────────────────────────────

/**
 * Builds and renders the library tree navigation grouped by year and month.
 */
export function initLibrary() {
    if (typeof playlistData === 'undefined' || !Array.isArray(playlistData)) {
        console.error('Playlist data not found');
        return;
    }

    // Group playlists by Year
    const yearGroups = {};
    playlistData.forEach(playlist => {
        if (!yearGroups[playlist.year]) {
            yearGroups[playlist.year] = [];
        }
        yearGroups[playlist.year].push(playlist);
    });

    // Render Year Groups
    libraryTree.innerHTML = '';
    const years = Object.keys(yearGroups).sort((a, b) => b - a); // Newest first

    years.forEach((year, idx) => {
        const yearNode = document.createElement('div');
        yearNode.className = `year-node ${idx === 0 ? 'open' : ''}`;

        const yearHeader = document.createElement('div');
        yearHeader.className = `year-header ${idx === 0 ? 'open' : ''}`;
        yearHeader.innerHTML = `
            <span>${year}</span>
            <i data-lucide="chevron-right"></i>
        `;

        const monthList = document.createElement('div');
        monthList.className = 'month-list';

        yearGroups[year].forEach(playlist => {
            const monthItem = document.createElement('div');
            monthItem.className = 'month-item';
            monthItem.dataset.id = playlist.id;
            monthItem.innerHTML = `
                <i data-lucide="music-2"></i>
                <span>${playlist.name.split(' ')[0]}</span>
            `;

            monthItem.addEventListener('click', () => {
                const tabPlaylistView = document.getElementById('tab-playlist-view');
                if (tabPlaylistView && !tabPlaylistView.classList.contains('active')) {
                    tabPlaylistView.click();
                }
                document.querySelectorAll('.month-item').forEach(el => el.classList.remove('active'));
                monthItem.classList.add('active');
                state.isShuffleAll = false;
                const saBtn = document.getElementById('btn-shuffle-all');
                if (saBtn) saBtn.classList.remove('active');
                loadPlaylist(playlist);
            });

            monthList.appendChild(monthItem);
        });

        yearHeader.addEventListener('click', () => {
            const isOpen = yearNode.classList.contains('open');
            if (!isOpen) {
                collapseOtherYears(yearNode);
                
                // Reset scroll position when opening a year, unless it contains the active month
                const hasActiveMonth = monthList.querySelector('.month-item.active');
                if (!hasActiveMonth) {
                    // Use a short timeout to ensure the element is visible before setting scrollTop
                    setTimeout(() => {
                        monthList.scrollTop = 0;
                    }, 10);
                } else {
                    // If it has an active month, ensure it's visible by scrolling to it
                    // Wait for max-height transition to finish
                    setTimeout(() => {
                        const activeItem = monthList.querySelector('.month-item.active');
                        if (activeItem) {
                            activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }
                    }, 300);
                }
            }
            yearNode.classList.toggle('open');
            yearHeader.classList.toggle('open');
        });

        yearNode.appendChild(yearHeader);
        yearNode.appendChild(monthList);
        libraryTree.appendChild(yearNode);
    });

    if (typeof lucide !== 'undefined') {
        lucide.createIcons({ root: libraryTree });
    }
}

/**
 * Collapses all year nodes in the library tree except the one specified.
 * @param {HTMLElement} expandedYearNode - The year node to keep open.
 */
export function collapseOtherYears(expandedYearNode) {
    document.querySelectorAll('.year-node').forEach(node => {
        if (node !== expandedYearNode) {
            node.classList.remove('open');
            const header = node.querySelector('.year-header');
            if (header) header.classList.remove('open');
        }
    });
}

// ── Playlist loading ──────────────────────────────────────────────────────────

/**
 * Highlights the specified playlist in the sidebar and opens its year folder.
 * @param {Object} playlist - The playlist object to activate.
 */
export function activatePlaylistSelection(playlist) {
    if (!playlist) return;
    document.querySelectorAll('.month-item').forEach(el => el.classList.remove('active'));
    const monthItem = document.querySelector(`.month-item[data-id="${playlist.id}"]`);
    if (monthItem) {
        monthItem.classList.add('active');
        const yearNode = monthItem.closest('.year-node');
        if (yearNode) {
            collapseOtherYears(yearNode);
            yearNode.classList.add('open');
            const header = yearNode.querySelector('.year-header');
            if (header) header.classList.add('open');
            
            // Wait for max-height transition to finish before scrolling
            setTimeout(() => {
                monthItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 300);
        }
    }
}

/**
 * Updates the metadata card with the playlist's theme, keywords, and challenges.
 * @param {Object} playlist - The playlist data.
 */
export function updateMetadataCard(playlist) {
    const metadataCard = document.getElementById('playlist-metadata-card');
    if (!metadataCard) return;

    const hasTheme = !!playlist.theme;
    const hasChallenge = !!playlist.challenge;
    let keywordsArr = [];
    if (Array.isArray(playlist.keywords)) {
        keywordsArr = playlist.keywords;
    } else if (typeof playlist.keywords === 'string' && playlist.keywords.trim() !== '') {
        keywordsArr = playlist.keywords.split(/[.,]/).map(k => k.trim()).filter(k => k !== '');
    }
    const hasKeywords = keywordsArr.length > 0;

    if (hasTheme || hasChallenge || hasKeywords) {
        const playlistTab = document.getElementById('tab-playlist-view');
        const isPlaylistViewActive = playlistTab && playlistTab.classList.contains('active');
        metadataCard.classList.toggle('hidden', !isPlaylistViewActive);
        document.getElementById('meta-theme').textContent = playlist.theme || 'None';
        document.getElementById('meta-keywords').textContent = hasKeywords ? keywordsArr.join(' • ') : 'None';
        document.getElementById('meta-challenge').textContent = playlist.challenge || 'None';
    } else {
        metadataCard.classList.add('hidden');
    }
}

/**
 * Loads a playlist into the main view and optionally starts playing it immediately.
 * @param {Object} playlist - The playlist to load.
 * @param {boolean} playImmediately - Whether to start playback upon loading.
 */
export function loadPlaylist(playlist, playImmediately = false) {
    if (state.playingPlaylist && state.currentTrackIndex !== -1) {
        const playingTrack = state.playingPlaylist.tracks[state.currentTrackIndex];
        if (playingTrack) {
            const matchIndex = playlist.tracks.findIndex(t => 
                (playingTrack.file && t.file === playingTrack.file) ||
                (t.title === playingTrack.title && t.artist === playingTrack.artist)
            );
            if (matchIndex !== -1) {
                state.playingPlaylist = playlist;
                state.currentTrackIndex = matchIndex;
            }
        }
    }

    state.currentPlaylist = playlist;
    activatePlaylistSelection(playlist);
    playlistTitle.textContent = playlist.name;
    if (playlistSubtitle) playlistSubtitle.textContent = `Playlist (${playlist.year})`;
    if (playlistMeta) playlistMeta.textContent = `Archive of curation selections for ${playlist.name}`;
    trackCount.textContent = `${playlist.tracks.length} songs`;

    if (shufflePlaylistBtn) shufflePlaylistBtn.disabled = false;
    if (playPlaylistBtn) playPlaylistBtn.disabled = false;

    // Show/hide YouTube stream link
    const streamLinkBtn = document.getElementById('stream-link-btn');
    if (streamLinkBtn) {
        if (playlist.streamUrl) {
            streamLinkBtn.href = playlist.streamUrl;
            streamLinkBtn.classList.remove('hidden');
        } else {
            streamLinkBtn.classList.add('hidden');
        }
    }

    updateMetadataCard(playlist);

    // Update playing-challenge class on stats-month-cards
    let activePlaylist = state.playingPlaylist;
    if (state.playingPlaylist && state.playingPlaylist.id === 'search-results') {
        const playingTrack = state.playingPlaylist.tracks[state.currentTrackIndex];
        if (playingTrack && playingTrack.parentPlaylist) {
            activePlaylist = playingTrack.parentPlaylist;
        }
    }
    document.querySelectorAll('.stats-month-card').forEach(card => {
        const playlistId = card.getAttribute('data-playlist-id');
        card.classList.toggle('playing-challenge', activePlaylist && String(playlistId) === String(activePlaylist.id));
    });

    updatePlaylistPlayButtonState();
    renderTracklist(playlist.tracks);

    if (playImmediately && playlist.tracks.length > 0) {
        playTrack(0);
    }
}

// ── Tracklist rendering ───────────────────────────────────────────────────────

/**
 * Renders the tracklist table for the current playlist or search results.
 * @param {Array} tracks - Array of track objects to display.
 */
export function renderTracklist(tracks) {
    tracklistBody.innerHTML = '';
    
    // Reset scroll position for the tracklist container when rendering a new playlist
    const container = document.querySelector('.tracklist-container');
    if (container) {
        container.scrollTop = 0;
    }

    if (tracks.length === 0) {
        tracklistBody.innerHTML = `
            <tr>
                <td colspan="4" class="empty-state">
                    <i data-lucide="info" class="empty-icon"></i>
                    <p>No tracks found</p>
                </td>
            </tr>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons({ root: tracklistBody });
        return;
    }

    tracks.forEach((track, index) => {
        const row = document.createElement('tr');
        row.className = 'tracklist-row';
        if (state.currentPlaylist && state.currentTrackIndex === index && isCurrentTrackInPlaylist()) {
            row.classList.add('active');
        }

        row.innerHTML = `
            <td class="col-num">${track.trackNo || (index + 1)}</td>
            <td class="col-title">${escapeHtml(track.title)}</td>
            <td class="col-artist">${escapeHtml(track.artist)}</td>
            <td class="col-action">
                ${track.link ? `
                    <a href="${track.link}" target="_blank" rel="noopener noreferrer" class="row-link-btn" title="View Link (Bandcamp/Soundcloud/YouTube)" onclick="event.stopPropagation();">
                        <i data-lucide="external-link"></i>
                        <span>Link</span>
                    </a>
                ` : ''}
                <button class="row-play-btn">
                    <i data-lucide="play-circle"></i>
                </button>
            </td>
        `;

        row.addEventListener('click', () => {
            playTrack(index);
        });

        tracklistBody.appendChild(row);
    });

    if (typeof lucide !== 'undefined') lucide.createIcons({ root: tracklistBody });
}

// ── Search ────────────────────────────────────────────────────────────────────

/**
 * Clears the search input and restores the previously loaded playlist view.
 */
export function clearSearch() {
    if (searchInput) searchInput.value = '';
    if (clearSearchBtn) clearSearchBtn.classList.add('hidden');

    let playlistToLoad = null;
    if (state.playingPlaylist) {
        if (state.playingPlaylist.id === 'search-results') {
            const activeTrack = state.playingPlaylist.tracks[state.currentTrackIndex];
            if (activeTrack && activeTrack.parentPlaylist) {
                playlistToLoad = activeTrack.parentPlaylist;
            }
        } else {
            playlistToLoad = state.playingPlaylist;
        }
    }

    if (playlistToLoad) {
        loadPlaylist(playlistToLoad);
        const playingTrack = state.playingPlaylist.tracks[state.currentTrackIndex];
        if (playingTrack) {
            const matchIndex = playlistToLoad.tracks.findIndex(t => 
                (playingTrack.file && t.file === playingTrack.file) ||
                (t.title === playingTrack.title && t.artist === playingTrack.artist)
            );
            if (matchIndex !== -1) {
                state.currentTrackIndex = matchIndex;
                document.querySelectorAll('.tracklist-row').forEach((row, rIdx) => {
                    row.classList.toggle('active', rIdx === matchIndex);
                });
            }
        }
    } else if (state.currentPlaylist && state.currentPlaylist.id !== 'search-results') {
        loadPlaylist(state.currentPlaylist);
    } else if (playlistData && playlistData.length > 0) {
        loadPlaylist(playlistData[0]);
    } else {
        renderTracklist([]);
    }
}

/**
 * Performs a global search across all playlists for tracks matching the query.
 * @param {string} query - The search term.
 */
export function performSearch(query) {
    if (!playlistData) return;
    const tabPlaylistView = document.getElementById('tab-playlist-view');
    if (tabPlaylistView && !tabPlaylistView.classList.contains('active')) {
        tabPlaylistView.click();
    }

    const q = query.toLowerCase().trim();
    if (!q) {
        clearSearch();
        return;
    }

    const results = [];
    playlistData.forEach(playlist => {
        const themeStr = (playlist.theme || '').toLowerCase();
        const challengeStr = (playlist.challenge || '').toLowerCase();
        const keywordsStr = Array.isArray(playlist.keywords) 
            ? playlist.keywords.join(' ').toLowerCase() 
            : (playlist.keywords || '').toLowerCase();

        playlist.tracks.forEach(track => {
            const title = (track.title || '').toString().toLowerCase();
            const artist = (track.artist || '').toString().toLowerCase();
            if (title.includes(q) || artist.includes(q) || themeStr.includes(q) || challengeStr.includes(q) || keywordsStr.includes(q)) {
                results.push({ ...track, playlistName: playlist.name, parentPlaylist: playlist });
            }
        });
    });

    playlistTitle.textContent = 'Search Results';
    if (playlistSubtitle) playlistSubtitle.textContent = 'Searching library';
    if (playlistMeta) playlistMeta.textContent = `Found ${results.length} matches for "${query}"`;
    trackCount.textContent = `${results.length} results`;

    if (playPlaylistBtn) playPlaylistBtn.disabled = results.length === 0;
    if (shufflePlaylistBtn) shufflePlaylistBtn.disabled = results.length === 0;

    const tempPlaylist = {
        id: 'search-results',
        name: 'Search Results',
        year: '',
        month: '',
        tracks: results
    };

    state.currentPlaylist = tempPlaylist;
    renderTracklist(results);
}



// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Checks if the currently playing track belongs to the currently viewed playlist.
 * @returns {boolean} True if the current track is in the active playlist view.
 */
function isCurrentTrackInPlaylist() {
    if (!state.currentPlaylist || !state.playingPlaylist) return false;
    return state.playingPlaylist.id === state.currentPlaylist.id;
}

// ── Event Listeners ──────────────────────────────────────────────────────────
events.on('TRACK_CHANGED', ({ track, index, playlist }) => {
    // Highlight tracklist row if we are currently viewing the playing playlist
    if (isCurrentTrackInPlaylist()) {
        document.querySelectorAll('.tracklist-row').forEach((row, rIdx) => {
            row.classList.toggle('active', rIdx === index);
        });
    }

    // Update sidebar selection and metadata card
    if (track && track.parentPlaylist) {
        updateMetadataCard(track.parentPlaylist);
        activatePlaylistSelection(track.parentPlaylist);
    }
});

