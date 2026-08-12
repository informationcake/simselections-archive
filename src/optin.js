// ─── Playback Opt-In Resolution Module ───────────────────────────────────────
// Dynamically fetches playback opt-in artist names from the server and provides
// helpers to evaluate whether an artist or track is permitted to play audio.

let optInArtists = new Set();
let isLoaded = false;

function cleanArtistName(s) {
    if (!s) return '';
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseOptInText(text) {
    const lines = text.split('\n');
    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
            const lower = trimmed.toLowerCase();
            const clean = cleanArtistName(trimmed);
            optInArtists.add(lower);
            if (clean) optInArtists.add(clean);
        }
    });
}

/**
 * Asynchronously fetches the opt-in text file from the server.
 * Checks multiple candidate relative paths for max compatibility.
 */
export async function loadOptInList() {
    const candidatePaths = [
        'data/optin-playback.txt',
        '/data/optin-playback.txt',
        'data/playback-optin.txt',
        'data/opt-in.txt',
        '/data/playback-optin.txt',
        '/data/opt-in.txt'
    ];

    optInArtists.clear();

    for (const path of candidatePaths) {
        try {
            const response = await fetch(path);
            if (response.ok) {
                const text = await response.text();
                parseOptInText(text);
                isLoaded = true;
                break;
            }
        } catch (err) {
            // Try next candidate path
        }
    }
}

/**
 * Checks if a given artist (or any of their featured/primary artists) is opted in.
 * @param {string} artistStr - Artist name from track metadata.
 * @returns {boolean} True if artist is listed in opt-in list.
 */
export function isArtistOptedIn(artistStr) {
    if (!artistStr) return false;

    const lower = artistStr.trim().toLowerCase();
    const clean = cleanArtistName(artistStr);

    if (optInArtists.has(lower) || optInArtists.has(clean)) {
        return true;
    }

    // Split primary artists / collaborations (feat., ft., &, and, etc.)
    const normalized = artistStr
        .replace(/\b(feat\.?|ft\.?|and|with|vs\.?|versus)\b/gi, '|')
        .replace(/[&;\/]/g, '|');

    const parts = normalized.split('|');
    for (const part of parts) {
        const pLower = part.trim().toLowerCase();
        const pClean = cleanArtistName(part);
        if (pLower && optInArtists.has(pLower)) return true;
        if (pClean && optInArtists.has(pClean)) return true;
    }

    return false;
}

/**
 * Determines whether a track can play audio/video.
 * Requires both an attached media file AND artist opt-in.
 * @param {Object} track - Track metadata object.
 * @returns {boolean} True if track is eligible for audio/video playback.
 */
export function canTrackPlay(track) {
    if (!track || !track.file) return false;
    if (track.optIn === true) return true;
    return isArtistOptedIn(track.artist);
}

/**
 * Expose direct setter for testing or manual overrides.
 * @param {Array<string>} list - Array of artist names.
 */
export function setOptInArtists(list) {
    optInArtists.clear();
    if (Array.isArray(list)) {
        list.forEach(a => {
            if (a) {
                optInArtists.add(a.trim().toLowerCase());
                optInArtists.add(cleanArtistName(a));
            }
        });
    }
    isLoaded = true;
}

if (typeof window !== 'undefined') {
    window.loadOptInList = loadOptInList;
    window.isArtistOptedIn = isArtistOptedIn;
    window.canTrackPlay = canTrackPlay;
}
