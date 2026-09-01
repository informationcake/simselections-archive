// ─── Discord Auth & Artist Dashboard Module ──────────────────────────────────
import { playlistData } from './metadata.js';
import { canTrackPlay, updateLocalOptIn } from './optin.js';

export let authState = {
    authenticated: false,
    role: 'guest', // 'discord_user' | 'view_only' | 'guest'
    canPlayAudio: false,
    user: null,
    linked_artists: []
};

/**
 * Initializes authentication state from server /api/me and configures dashboard UI.
 */
export async function initAuthAndDashboard() {
    try {
        const resp = await fetch('/api/me');
        if (resp.ok) {
            authState = await resp.json();
        }
    } catch (e) {
        console.warn('Could not fetch auth state from server:', e);
    }

    if (typeof window !== 'undefined') {
        window.AUTH_STATE = authState;
    }

    renderAuthHeader();
    setupDashboardEventListeners();

    // Check for login query parameter in URL (e.g. ?auth=success, ?auth_notice=beta_restricted, or ?auth_error=guild_required)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('auth') === 'success' || urlParams.get('auth') === 'dev_success') {
        window.history.replaceState({}, document.title, window.location.pathname);
        showToast('Successfully connected with Discord!', 'success');
        if (authState.linked_artists && authState.linked_artists.length > 0) {
            setTimeout(() => {
                openArtistDashboard();
            }, 600);
        }
    } else if (urlParams.get('auth_notice') === 'beta_restricted') {
        window.history.replaceState({}, document.title, window.location.pathname);
        showToast('Discord login is currently in private testing. You are connected in View-Only mode.', 'info');
    } else if (urlParams.get('auth_error') === 'guild_required') {
        window.history.replaceState({}, document.title, window.location.pathname);
        showToast('Login failed: You must be a member of the Discord server to log in.', 'error');
    }
}

/**
 * Renders user profile / login buttons in the sidebar (below logo, above search).
 */
export function renderAuthHeader() {
    const container = document.getElementById('auth-sidebar-container') || document.getElementById('auth-header-container');
    if (!container) return;

    container.innerHTML = '';

    if (authState.authenticated && authState.role === 'discord_user') {
        const user = authState.user || {};
        const card = document.createElement('div');
        card.className = 'sidebar-user-card';
        card.innerHTML = `
            <div class="sidebar-user-info">
                <img src="${user.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png'}" class="user-avatar" alt="Avatar">
                <span class="user-name">${user.global_name || user.username}</span>
                <a href="/api/auth/logout" class="btn btn-logout-small" title="Log Out">
                    <i data-lucide="log-out"></i>
                </a>
            </div>
            ${authState.linked_artists.length > 0 ? `
                <button class="btn btn-artist-dash-sidebar" id="btn-open-artist-dash" title="Manage your tracks and playback permissions">
                    <i data-lucide="sliders-horizontal"></i> Artist Dashboard
                </button>
            ` : ''}
        `;
        container.appendChild(card);

        const btnDash = card.querySelector('#btn-open-artist-dash');
        if (btnDash) {
            btnDash.addEventListener('click', openArtistDashboard);
        }
    } else {
        // View-only / unauthenticated guest mode
        container.innerHTML = `
            <div class="sidebar-viewonly-card">
                <div class="view-only-row">
                    <div class="view-only-badge">
                        <i data-lucide="eye"></i> View-Only Mode
                    </div>
                    ${authState.authenticated ? `
                        <a href="/api/auth/logout" class="btn btn-logout-small" title="Log Out / Switch Account">
                            <i data-lucide="log-out"></i>
                        </a>
                    ` : ''}
                </div>
                <a href="/api/auth/discord" class="btn btn-discord-sidebar" title="Login with Discord to enable audio playback">
                    <i data-lucide="disc"></i> Login with Discord
                </a>
            </div>
        `;
    }

    if (window.lucide) {
        window.lucide.createIcons();
    }
}

/**
 * Opens and renders the Artist Dashboard modal.
 */
export function openArtistDashboard() {
    const modal = document.getElementById('artist-dashboard-modal');
    if (!modal) return;

    renderArtistDashboardContent();
    modal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
}

export function closeArtistDashboard() {
    const modal = document.getElementById('artist-dashboard-modal');
    if (modal) modal.classList.add('hidden');
}

/**
 * Finds all tracks in the catalog that belong to the user's linked artists.
 */
function getUserTracks() {
    if (!authState.linked_artists || authState.linked_artists.length === 0) return [];

    const linkedSet = new Set(authState.linked_artists.map(a => a.toLowerCase().replace(/[^a-z0-9]/g, '')));
    const tracksFound = [];

    playlistData.forEach(playlist => {
        (playlist.tracks || []).forEach(track => {
            if (!track.artist) return;
            const cleanArt = track.artist.toLowerCase().replace(/[^a-z0-9]/g, '');

            // Check if user is linked to primary artist or collaboration
            let isMatch = linkedSet.has(cleanArt);
            if (!isMatch) {
                const normCollab = track.artist.replace(/\b(feat|ft|and|with|vs|versus)\b\.?/gi, '|');
                const parts = normCollab.split(/[&;\|/,]/).map(p => p.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
                isMatch = parts.some(p => p && linkedSet.has(p));
            }

            if (isMatch) {
                tracksFound.push({
                    playlistId: playlist.id,
                    playlistTitle: playlist.title,
                    year: playlist.year,
                    month: playlist.month,
                    track: track
                });
            }
        });
    });

    return tracksFound;
}

/**
 * Renders the content inside the Artist Dashboard modal.
 */
function renderArtistDashboardContent() {
    const content = document.getElementById('artist-dashboard-content');
    if (!content) return;

    const user = authState.user || {};
    const linkedArtists = authState.linked_artists || [];
    const userTracks = getUserTracks();

    content.innerHTML = `
        <div class="dash-header">
            <div class="dash-user-info">
                <img src="${user.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png'}" class="dash-avatar" alt="Avatar">
                <div>
                    <h2 class="dash-title">${user.global_name || user.username}</h2>
                    <div class="dash-claimed-artists">
                        Verified Artist Profiles: <strong>${linkedArtists.join(', ')}</strong>
                    </div>
                </div>
            </div>
            <button class="modal-close-btn" id="btn-close-dash">
                <i data-lucide="x"></i>
            </button>
        </div>

        <div class="dash-summary-bar">
            <div class="dash-stat">
                <span class="dash-stat-num">${userTracks.length}</span>
                <span class="dash-stat-label">Total Submissions Found</span>
            </div>
            <div class="dash-batch-actions">
                <button class="btn btn-batch btn-enable-all" id="btn-enable-all-tracks">
                    <i data-lucide="check-circle"></i> Enable All Tracks
                </button>
                <button class="btn btn-batch btn-disable-all" id="btn-disable-all-tracks">
                    <i data-lucide="x-circle"></i> Disable All Tracks
                </button>
            </div>
        </div>

        <div class="dash-track-list">
            ${userTracks.length === 0 ? `
                <div class="dash-empty-state">
                    <i data-lucide="music"></i>
                    <p>No tracks currently matched to your verified artist aliases in this catalog.</p>
                </div>
            ` : userTracks.map(item => {
                const tr = item.track;
                const hasFile = Boolean(tr.file);
                const isOptedIn = canTrackPlay(tr);
                
                return `
                    <div class="dash-track-row" data-file="${tr.file || ''}" data-artist="${tr.artist}">
                        <div class="dash-track-meta">
                            <span class="dash-badge-month">${item.month} ${item.year}</span>
                            <div class="dash-track-titles">
                                <span class="dash-track-name">${tr.title}</span>
                                <span class="dash-track-artist">${tr.artist}</span>
                            </div>
                        </div>
                        <div class="dash-track-toggle-wrapper">
                            ${hasFile ? `
                                <label class="switch-toggle" title="Toggle Public Audio Playback for this submission">
                                    <input type="checkbox" class="optin-toggle" ${isOptedIn ? 'checked' : ''} data-file="${tr.file || ''}" data-artist="${tr.artist}">
                                    <span class="slider-round"></span>
                                </label>
                                <span class="status-label ${isOptedIn ? 'status-on' : 'status-off'}">${isOptedIn ? 'Playback ON' : 'Playback OFF'}</span>
                            ` : `
                                <div class="dash-no-file-badge">
                                    <span>No File Available</span>
                                </div>
                            `}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;

    // Attach listeners
    const closeBtn = content.querySelector('#btn-close-dash');
    if (closeBtn) closeBtn.addEventListener('click', closeArtistDashboard);

    const enableAllBtn = content.querySelector('#btn-enable-all-tracks');
    if (enableAllBtn) {
        enableAllBtn.addEventListener('click', async () => {
            // Instantly update DOM checkboxes and labels for immediate visual feedback
            content.querySelectorAll('.optin-toggle').forEach(input => {
                input.checked = true;
                const row = input.closest('.dash-track-row');
                const label = row.querySelector('.status-label');
                if (label) {
                    label.textContent = 'Playback ON';
                    label.className = 'status-label status-on';
                }
            });

            await toggleAllUserTracks(userTracks, true);
            showToast('All your tracks have been enabled for public playback!', 'success');
        });
    }

    const disableAllBtn = content.querySelector('#btn-disable-all-tracks');
    if (disableAllBtn) {
        disableAllBtn.addEventListener('click', async () => {
            // Instantly update DOM checkboxes and labels for immediate visual feedback
            content.querySelectorAll('.optin-toggle').forEach(input => {
                input.checked = false;
                const row = input.closest('.dash-track-row');
                const label = row.querySelector('.status-label');
                if (label) {
                    label.textContent = 'Playback OFF';
                    label.className = 'status-label status-off';
                }
            });

            await toggleAllUserTracks(userTracks, false);
            showToast('All your tracks have been disabled for public playback.', 'info');
        });
    }

    content.querySelectorAll('.optin-toggle').forEach(input => {
        input.addEventListener('change', async (e) => {
            const file = e.target.getAttribute('data-file');
            const artist = e.target.getAttribute('data-artist');
            const isChecked = e.target.checked;
            const row = e.target.closest('.dash-track-row');
            const label = row.querySelector('.status-label');

            if (label) {
                label.textContent = isChecked ? 'Playback ON' : 'Playback OFF';
                label.className = `status-label ${isChecked ? 'status-on' : 'status-off'}`;
            }

            const success = await toggleTrackOptIn(file, artist, isChecked);
            if (success) {
                showToast(`Updated playback for "${row.querySelector('.dash-track-name').textContent}"`, 'success');
            }
        });
    });
}

/**
 * Atomically updates all tracks for the current user in a single request.
 */
async function toggleAllUserTracks(userTracks, optIn) {
    const items = userTracks
        .filter(item => item.track && item.track.file)
        .map(item => ({
            trackKey: item.track.file,
            artist: item.track.artist,
            optIn: optIn
        }));

    // Update in-memory opt-in state immediately
    items.forEach(it => {
        updateLocalOptIn(it.trackKey, it.optIn);
        if (it.artist) {
            updateLocalOptIn(`artist:${it.artist.toLowerCase().replace(/[^a-z0-9]/g, '')}`, it.optIn);
        }
    });

    try {
        const resp = await fetch('/api/optin/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });
        return resp.ok;
    } catch (e) {
        console.error('Failed to batch update opt-in state:', e);
        return false;
    }
}

/**
 * Calls server API to update track opt-in preference.
 */
async function toggleTrackOptIn(trackFile, artist, optIn) {
    updateLocalOptIn(trackFile, optIn);

    try {
        const resp = await fetch('/api/optin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackKey: trackFile, artist, optIn })
        });
        return resp.ok;
    } catch (e) {
        console.error('Failed to update opt-in state on server:', e);
        return false;
    }
}

function setupDashboardEventListeners() {
    const modal = document.getElementById('artist-dashboard-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeArtistDashboard();
        });
    }
}

/**
 * Lightweight modern toast notifications.
 */
function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-show');
    }, 10);

    setTimeout(() => {
        toast.classList.remove('toast-show');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
