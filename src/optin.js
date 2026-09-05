// ─── Playback Opt-In Resolution Module ───────────────────────────────────────
// Strictly enforces Default Opt-Out:
// All tracks and artists are opted out by default until an artist logs in with Discord
// and explicitly enables playback for their submission(s) in the Artist Dashboard.

let dynamicOverrides = {};
let isLoaded = false;

function cleanArtistName(s) {
    if (!s) return '';
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Asynchronously fetches dynamic opt-in state from the server.
 */
export async function loadOptInList() {
    try {
        const dynResp = await fetch('/api/optin/state');
        if (dynResp.ok) {
            dynamicOverrides = await dynResp.json();
        }
    } catch (e) {
        // Fallback if offline
    }
    isLoaded = true;
}

/**

 * Determines whether a track can play audio/video.
 * Requires an attached media file AND explicit artist opt-in via Discord.
 * @param {Object} track - Track metadata object.
 * @returns {boolean} True if track is explicitly enabled for playback.
 */
export function canTrackPlay(track) {
    if (!track || !track.file) return false;

    // 1. Check dynamic track-level override (key: track.file)
    if (track.file in dynamicOverrides) {
        const optData = dynamicOverrides[track.file];
        if (typeof optData === 'object' && optData !== null) {
            return Boolean(optData.isPlayable);
        }
        return Boolean(optData);
    }

    // Default is strictly OPT-OUT (false)
    return false;
}

/**
 * Determines if the current user has opted in to the track.
 * @param {Object} track - Track metadata object.
 * @param {Array<string>} matchedArtists - List of canonical artist names linked to the current user that match this track.
 * @returns {boolean} True if the user has opted in.
 */
export function hasUserOptedIn(track, matchedArtists) {
    if (!track || !track.file) return false;
    
    const optData = dynamicOverrides[track.file];
    if (optData !== undefined) {
        if (typeof optData === 'object' && optData !== null) {
            if (!optData.optInBy) return false;
            return matchedArtists.some(a => optData.optInBy.includes(a));
        }
        // Legacy boolean
        return Boolean(optData);
    }
    return false;
}

/**
 * Updates dynamic opt-in state locally in real-time.
 */
export function updateLocalOptIn(key, value) {
    dynamicOverrides[key] = value;
}

if (typeof window !== 'undefined') {
    window.loadOptInList = loadOptInList;
    window.canTrackPlay = canTrackPlay;
    window.hasUserOptedIn = hasUserOptedIn;
    window.updateLocalOptIn = updateLocalOptIn;
}
