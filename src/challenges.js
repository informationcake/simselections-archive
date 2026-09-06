import { playlistData } from './metadata.js';
import { escapeHtml } from './utils.js';
import { state, events } from './state.js';

/**
 * Renders the challenges dashboard, displaying a list of monthly playlists with their themes,
 * keywords, and optional challenges.
 */
export function renderChallengesDashboard() {
    const challengesView = document.getElementById('challenges-view-container');
    if (!challengesView || typeof playlistData === 'undefined' || !Array.isArray(playlistData)) return;

    const orderedMonths = [...playlistData].sort((a, b) => {
        const yearDiff = Number(a.year) - Number(b.year);
        if (yearDiff !== 0) return yearDiff;
        const monthOrder = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];
        return monthOrder.indexOf(String(a.month || '').toUpperCase()) - monthOrder.indexOf(String(b.month || '').toUpperCase());
    });



    const monthList = document.getElementById('stats-month-list');
    if (monthList) {
        const displayMonths = [...orderedMonths].reverse();
        monthList.innerHTML = displayMonths.map(playlist => {
            const tracks = playlist.tracks || [];
            const themeText = playlist.theme && playlist.theme.trim() ? playlist.theme : 'None';
            const keywordsText = Array.isArray(playlist.keywords) && playlist.keywords.length > 0
                ? playlist.keywords.join(', ')
                : 'None';
            const challengeText = playlist.challenge && playlist.challenge.trim() ? playlist.challenge : 'None';

            let isCurrent = false;
            if (typeof window.getPlayingPlaylist === 'function') {
                const pPlaylist = window.getPlayingPlaylist();
                if (pPlaylist) {
                    if (pPlaylist.id === 'search-results' && typeof window.getCurrentTrackIndex === 'function') {
                        const trackIdx = window.getCurrentTrackIndex();
                        const activeTrack = pPlaylist.tracks[trackIdx];
                        if (activeTrack && activeTrack.parentPlaylist) {
                            isCurrent = String(playlist.id) === String(activeTrack.parentPlaylist.id);
                        }
                    } else {
                        isCurrent = String(playlist.id) === String(pPlaylist.id);
                    }
                }
            }

            const activeClass = isCurrent ? 'playing-challenge' : '';

            return `
                <div class="stats-month-card ${activeClass}" data-playlist-id="${playlist.id}">
                    <div class="stats-month-top">
                        <div class="stats-month-title-wrap">
                            <h4>${escapeHtml(playlist.name)}</h4>
                            <div class="stats-theme-row">
                                <span class="stats-theme-pill">Theme: ${escapeHtml(themeText)}</span>
                            </div>
                        </div>
                        ${playlist.streamUrl ? `
                            <a href="${playlist.streamUrl}" target="_blank" rel="noopener noreferrer" class="challenge-stream-link" title="Watch Stream" onclick="event.stopPropagation();">
                                <svg class="lucide lucide-link-2"><use href="#icon-link-2"></use></svg> Stream
                            </a>
                        ` : ''}
                    </div>
                    <div class="stats-month-meta">
                        <span>Keywords: ${escapeHtml(keywordsText)}</span>
                    </div>
                    <div class="stats-challenge-block">
                        <div class="stats-challenge-label">Optional challenge</div>
                        <div class="stats-challenge-line">${escapeHtml(challengeText)}</div>
                    </div>
                    <div class="stats-month-submissions">
                        <svg class="lucide lucide-music-4"><use href="#icon-music-4"></use></svg>
                        <span>${tracks.length} submissions</span>
                    </div>
                </div>
            `;
        }).join('');

        monthList.querySelectorAll('.stats-month-card').forEach(card => {
            card.addEventListener('click', () => {
                const playlistId = card.getAttribute('data-playlist-id');
                const targetPlaylist = displayMonths.find(item => String(item.id) === String(playlistId));
                if (targetPlaylist && typeof window.loadPlaylist === 'function') {
                    window.loadPlaylist(targetPlaylist, true);
                }
            });
        });
    }

    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

// ── Event Listeners ──────────────────────────────────────────────────────────
events.on('TRACK_CHANGED', ({ track, playlist }) => {
    let activePlaylist = playlist;
    if (playlist && playlist.id === 'search-results') {
        if (track && track.parentPlaylist) {
            activePlaylist = track.parentPlaylist;
        }
    }
    document.querySelectorAll('.stats-month-card').forEach(card => {
        const playlistId = card.getAttribute('data-playlist-id');
        card.classList.toggle('playing-challenge', activePlaylist && String(playlistId) === String(activePlaylist.id));
    });
});


// Expose renderChallengesDashboard globally
if (typeof window !== 'undefined') {
    window.renderChallengesDashboard = renderChallengesDashboard;
}
