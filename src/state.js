// Shared Player and Curation state
export const state = {
    currentPlaylist: null,
    playingPlaylist: null, // Tracks the playlist that is currently playing audio/video
    currentTrackIndex: -1,
    isPlaying: false,
    isShuffleAll: false, // true = shuffle across all playlists
    isRepeat: false, // true = repeat playlist/track, false = no repeat
    lastVolume: 1.0,

    // Web Audio API State
    audioCtx: null,
    analyser: null,
    sourceNode: null,
    animationId: null,
    currentMediaType: 'audio',

    // Visualizer state
    heatmapHistory: []
};

// ── Lightweight Event Bus ─────────────────────────────────────────────────────
const listeners = {};
export const events = {
    on(event, callback) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(callback);
    },
    emit(event, data) {
        if (listeners[event]) {
            listeners[event].forEach(cb => cb(data));
        }
    }
};

// Expose legacy helpers on window so that stats.js or other external pages can safely reference current state
if (typeof window !== 'undefined') {
    window.getPlayingPlaylist = () => state.playingPlaylist;
    window.getCurrentTrackIndex = () => state.currentTrackIndex;
    window.state = state; // expose state object for easy debugging
}
