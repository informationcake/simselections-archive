import { state, events } from './state.js';
import { initAudioContext, showAudioVisualizer, showVideoPlayer } from './visualizer.js';
import { playlistData } from './metadata.js';
import { startClustermapPulseLoop } from './clustermap.js';
import { canTrackPlay } from './optin.js';

let audio = null;
let video = null;
let btnPlayPause = null;
let btnPrev = null;
let btnNext = null;
let btnRepeat = null;
let btnMute = null;
let volumeIcon = null;
let progressSliderWrapper = null;
let progressFill = null;
let progressHandle = null;
let timeCurrent = null;
let timeTotal = null;
let volumeSliderWrapper = null;
let volumeFill = null;
let playerTrackTitle = null;
let playerTrackArtist = null;
let vinylDisc = null;
let fallbackTitle = null;
let fallbackArtist = null;
let nowPlayingFallback = null;
let isDraggingSeek = false;
let isDraggingVolume = false;

/**
 * Initializes DOM element references for the player module and sets up listeners.
 */
export function initPlayerElements() {
    audio = document.getElementById('audio-element');
    video = document.getElementById('video-element');
    btnPlayPause = document.getElementById('btn-play-pause');
    btnPrev = document.getElementById('btn-prev');
    btnNext = document.getElementById('btn-next');
    btnRepeat = document.getElementById('btn-repeat');
    btnMute = document.getElementById('btn-mute');
    volumeIcon = document.getElementById('volume-icon');
    progressSliderWrapper = document.getElementById('progress-slider-wrapper');
    progressFill = document.getElementById('progress-fill');
    progressHandle = document.getElementById('progress-handle');
    timeCurrent = document.getElementById('time-current');
    timeTotal = document.getElementById('time-total');
    volumeSliderWrapper = document.getElementById('volume-slider-wrapper');
    volumeFill = document.getElementById('volume-fill');
    playerTrackTitle = document.getElementById('player-track-title');
    playerTrackArtist = document.getElementById('player-track-artist');
    vinylDisc = document.getElementById('vinyl-disc');
    fallbackTitle = document.getElementById('fallback-title');
    fallbackArtist = document.getElementById('fallback-artist');
    nowPlayingFallback = document.getElementById('now-playing-fallback');

    setupPlayerEventListeners();
}

/**
 * Plays a specific track from the currently active playlist by its index.
 * @param {number} index - The index of the track in the playlist.
 */
export function playTrack(index) {
    if (!state.currentPlaylist || index < 0 || index >= state.currentPlaylist.tracks.length) return;

    const track = state.currentPlaylist.tracks[index];

    // Check if user is in View-Only mode / not logged into Discord
    if (window.AUTH_STATE && window.AUTH_STATE.canPlayAudio === false) {
        return;
    }

    if (!canTrackPlay(track)) {
        return;
    }

    if (!state.isNavigatingHistory) {
        if (state.playingPlaylist && state.currentTrackIndex !== -1) {
            state.playbackHistory.push({
                playlist: state.playingPlaylist,
                trackIndex: state.currentTrackIndex
            });
            if (state.playbackHistory.length > 50) {
                state.playbackHistory.shift();
            }
        }
    }
    state.isNavigatingHistory = false;

    state.playingPlaylist = state.currentPlaylist;
    state.currentTrackIndex = index;

    events.emit('TRACK_CHANGED', { track, index, playlist: state.playingPlaylist });

    const base = window.SIMSELECTIONS_AUDIO_BASE || '';
    const mediaUrl = base + (base && !base.endsWith('/') ? '/' : '') + track.file.split('/').map(encodeURIComponent).join('/');
    const cleanFile = (track.file || '').split('?')[0].split('#')[0];
    const isVideo = /\.(mp4|webm|ogg|mov)$/i.test(cleanFile);
    state.currentMediaType = isVideo ? 'video' : 'audio';

    stopCurrentMedia();

    const hlsUrl = mediaUrl.replace(/\.(mp3|wav|flac|aac|m4a|mp4|webm|ogg|mov|mkv|avi)(\?.*)?$/i, '/index.m3u8$2');

    if (isVideo) {
        showVideoPlayer();
        const playVideo = () => {
            video.play()
                .then(() => updatePlayState(true))
                .catch(err => {
                    console.error("Video playback error:", err);
                    showAudioVisualizer();
                    updatePlayState(false);
                });
        };
        
        if (window.Hls && Hls.isSupported()) {
            if (window.hlsVideoInstance) {
                window.hlsVideoInstance.destroy();
            }
            window.hlsVideoInstance = new Hls();
            window.hlsVideoInstance.loadSource(hlsUrl);
            window.hlsVideoInstance.attachMedia(video);
            window.hlsVideoInstance.on(Hls.Events.MANIFEST_PARSED, playVideo);
            window.hlsVideoInstance.on(Hls.Events.ERROR, function(event, data) {
                if (data.fatal) {
                    console.error("Video HLS fatal error", data);
                    switch(data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            window.hlsVideoInstance.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            window.hlsVideoInstance.recoverMediaError();
                            break;
                        default:
                            window.hlsVideoInstance.destroy();
                            break;
                    }
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = hlsUrl;
            video.addEventListener('loadedmetadata', playVideo);
        } else {
            console.error("HLS not supported for video");
            showAudioVisualizer();
            updatePlayState(false);
        }
    } else {
        const playAudio = () => {
            audio.play()
                .then(() => {
                    initAudioContext();
                    updatePlayState(true);
                    showAudioVisualizer();
                })
                .catch(err => {
                    console.error("Audio playback error:", err);
                    updatePlayState(false);
                });
        };

        if (window.Hls && Hls.isSupported()) {
            if (window.hlsInstance) {
                window.hlsInstance.destroy();
            }
            window.hlsInstance = new Hls();
            window.hlsInstance.loadSource(hlsUrl);
            window.hlsInstance.attachMedia(audio);
            window.hlsInstance.on(Hls.Events.MANIFEST_PARSED, playAudio);
            window.hlsInstance.on(Hls.Events.ERROR, function(event, data) {
                if (data.fatal) {
                    console.error("HLS error:", data);
                    // Skip to next track on fatal network errors instead of just stopping
                    setTimeout(() => playNextTrack(), 500);
                }
            });
        } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari fallback
            audio.src = hlsUrl;
            audio.onerror = function() {
                console.error("Audio error in Safari fallback");
                setTimeout(() => playNextTrack(), 500);
            };
            audio.addEventListener('loadedmetadata', playAudio, { once: true });
        } else {
            // Final fallback to original url if HLS completely unsupported
            audio.src = mediaUrl;
            audio.onerror = function() {
                console.error("Audio error in final fallback");
                setTimeout(() => playNextTrack(), 500);
            };
            playAudio();
        }
    }

    // Update Player Info
    playerTrackTitle.textContent = track.title;
    playerTrackArtist.textContent = track.artist;
    fallbackTitle.textContent = track.title;
    fallbackArtist.textContent = track.artist;

    if (track.link) {
        playerTrackTitle.classList.add('has-link');
        playerTrackTitle.title = "View Link (Bandcamp/Soundcloud/YouTube)";
    } else {
        playerTrackTitle.classList.remove('has-link');
        playerTrackTitle.removeAttribute('title');
    }


}

/**
 * Completely stops media playback and resets the audio/video elements.
 */
export function stopCurrentMedia() {
    if (!audio) initPlayerElements();

    if (window.hlsInstance) {
        window.hlsInstance.destroy();
        window.hlsInstance = null;
    }
    if (window.hlsVideoInstance) {
        window.hlsVideoInstance.destroy();
        window.hlsVideoInstance = null;
    }

    audio.pause();
    audio.currentTime = 0;
    audio.src = '';
    audio.removeAttribute('src');
    audio.load();

    video.pause();
    video.currentTime = 0;
    video.src = '';
    video.removeAttribute('src');
    video.load();
}

/**
 * Pauses the currently active media (audio or video).
 */
export function pauseCurrentMedia() {
    if (!audio) initPlayerElements();
    const activeMedia = state.currentMediaType === 'video' ? video : audio;
    if (activeMedia) {
        activeMedia.pause();
        updatePlayState(false);
    }
}

/**
 * Resumes playback of the currently active media.
 */
export function resumeCurrentMedia() {
    if (!audio) initPlayerElements();
    const activeMedia = state.currentMediaType === 'video' ? video : audio;
    if (activeMedia) {
        activeMedia.play().then(() => {
            if (state.currentMediaType === 'audio') {
                initAudioContext();
                showAudioVisualizer();
            } else {
                showVideoPlayer();
            }
            updatePlayState(true);
        }).catch(err => console.error('Playback resume failed:', err));
    }
}

/**
 * Advances playback to the next track, handling shuffle and repeat states.
 */
export function playNextTrack() {
    if (state.isShuffleAll) {
        playRandomFromAll();
        return;
    }
    
    if (!state.currentPlaylist || state.currentPlaylist.tracks.length === 0) return;
    
    const maxAttempts = state.currentPlaylist.tracks.length;
    let attempts = 0;

    let nextIdx = state.currentTrackIndex;
    let track;
    do {
        nextIdx++;
        if (nextIdx >= state.currentPlaylist.tracks.length) {
            if (state.isRepeat) {
                nextIdx = 0; // Loop playlist
            } else {
                updatePlayState(false);
                return; // Stop at end
            }
        }
        track = state.currentPlaylist.tracks[nextIdx];
        attempts++;
        if (attempts > maxAttempts) {
            updatePlayState(false);
            return;
        }
    } while (!canTrackPlay(track));
    playTrack(nextIdx);
}

/**
 * Selects and plays a random track from the entire library.
 */
export function playRandomFromAll() {
    if (typeof playlistData === 'undefined' || playlistData.length === 0) return;
    
    const maxAttempts = 100;
    let attempts = 0;
    let randPlaylist, randTrackIdx, track;
    
    do {
        randPlaylist = playlistData[Math.floor(Math.random() * playlistData.length)];
        if (!randPlaylist.tracks || randPlaylist.tracks.length === 0) {
            attempts++;
            continue;
        }
        randTrackIdx = Math.floor(Math.random() * randPlaylist.tracks.length);
        track = randPlaylist.tracks[randTrackIdx];
        attempts++;
        if (attempts > maxAttempts) {
            updatePlayState(false);
            return;
        }
    } while (!canTrackPlay(track));

    if (typeof window.loadPlaylist === 'function') {
        window.loadPlaylist(randPlaylist);
    }
    if (typeof window.activatePlaylistSelection === 'function') {
        window.activatePlaylistSelection(randPlaylist);
    }
    playTrack(randTrackIdx);
}

/**
 * Updates the visual state (Play/Pause icon) of the main playlist play button.
 */
export function updatePlaylistPlayButtonState() {
    const btnPlay = document.getElementById('btn-playlist-play');
    if (!btnPlay) return;

    const isCurrentPlaylistPlaying = state.isPlaying && state.playingPlaylist && state.currentPlaylist && state.playingPlaylist.id === state.currentPlaylist.id;
    
    if (isCurrentPlaylistPlaying) {
        btnPlay.innerHTML = '<svg class="lucide lucide-pause"><use href="#icon-pause"></use></svg><span>Pause</span>';
    } else {
        btnPlay.innerHTML = '<svg class="lucide lucide-play"><use href="#icon-play"></use></svg><span>Play</span>';
    }
    
    if (typeof lucide !== 'undefined') {
        lucide.createIcons({ root: btnPlay });
    }
}

/**
 * Updates the global player UI state based on whether media is playing or paused.
 * @param {boolean} playing - True if media is currently playing.
 */
export function updatePlayState(playing) {
    state.isPlaying = playing;
    const modeSelect = document.getElementById('visualizer-mode');
    const isOff = modeSelect && modeSelect.value === 'off';

    if (playing) {
        btnPlayPause.querySelector('.play-icon').classList.add('hidden');
        btnPlayPause.querySelector('.pause-icon').classList.remove('hidden');
        vinylDisc.classList.add('playing');
        if (!isOff) {
            nowPlayingFallback.classList.add('hidden');
        } else {
            nowPlayingFallback.classList.remove('hidden');
        }
    } else {
        btnPlayPause.querySelector('.play-icon').classList.remove('hidden');
        btnPlayPause.querySelector('.pause-icon').classList.add('hidden');
        vinylDisc.classList.remove('playing');
        if (!state.audioCtx || isOff) {
            nowPlayingFallback.classList.remove('hidden');
        }
    }
    
    updatePlaylistPlayButtonState();
    
    startClustermapPulseLoop();
}

/**
 * Formats a duration in seconds to a MM:SS string.
 * @param {number} secs - Time in seconds.
 * @returns {string} Formatted time string.
 */
export function formatTime(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

/**
 * Handles the media 'timeupdate' event to update the progress bar and timers.
 */
function handleTimeUpdate() {
    const activeMedia = state.currentMediaType === 'video' ? video : audio;
    if (!isDraggingSeek && activeMedia && activeMedia.duration) {
        const pct = (activeMedia.currentTime / activeMedia.duration) * 100;
        progressFill.style.width = `${pct}%`;
        progressHandle.style.left = `${pct}%`;
        timeCurrent.textContent = formatTime(activeMedia.currentTime);
        timeTotal.textContent = formatTime(activeMedia.duration);
    }
}

/**
 * Handles the media 'durationchange' event to update the total time display.
 */
function handleDurationChange() {
    const activeMedia = state.currentMediaType === 'video' ? video : audio;
    if (activeMedia) {
        timeTotal.textContent = formatTime(activeMedia.duration || 0);
    }
}

/**
 * Sets up all interactive event listeners for the player controls.
 */
function setupPlayerEventListeners() {
    btnPlayPause.addEventListener('click', () => {
        const activeMedia = state.currentMediaType === 'video' ? video : audio;
        const hasActiveMedia = activeMedia && (activeMedia.currentSrc || (state.currentMediaType === 'video' ? video.src : audio.src));

        if (hasActiveMedia) {
            if (state.isPlaying) {
                activeMedia.pause();
                updatePlayState(false);
            } else {
                activeMedia.play().then(() => {
                    if (state.currentMediaType === 'audio') {
                        initAudioContext();
                        showAudioVisualizer();
                    } else {
                        showVideoPlayer();
                    }
                    updatePlayState(true);
                }).catch(() => {
                    updatePlayState(false);
                });
            }
        } else if (state.currentPlaylist && state.currentPlaylist.tracks.length > 0) {
            const targetIndex = (state.currentTrackIndex >= 0 && state.currentTrackIndex < state.currentPlaylist.tracks.length)
                ? state.currentTrackIndex
                : 0;
            playTrack(targetIndex);
        }
    });

    btnPrev.addEventListener('click', () => {
        if (state.isShuffleAll && state.playbackHistory && state.playbackHistory.length > 0) {
            const prev = state.playbackHistory.pop();
            state.isNavigatingHistory = true;
            if (typeof window.loadPlaylist === 'function') {
                window.loadPlaylist(prev.playlist);
            }
            if (typeof window.activatePlaylistSelection === 'function') {
                window.activatePlaylistSelection(prev.playlist);
            }
            playTrack(prev.trackIndex);
            return;
        }

        if (!state.currentPlaylist || state.currentPlaylist.tracks.length === 0) return;
        
        const maxAttempts = state.currentPlaylist.tracks.length;
        let attempts = 0;
        let prevIdx = state.currentTrackIndex;
        let track;
        
        do {
            prevIdx--;
            if (prevIdx < 0) {
                prevIdx = state.currentPlaylist.tracks.length - 1;
            }
            track = state.currentPlaylist.tracks[prevIdx];
            attempts++;
            if (attempts > maxAttempts) {
                updatePlayState(false);
                return;
            }
        } while (!canTrackPlay(track));
        
        playTrack(prevIdx);
    });

    btnNext.addEventListener('click', () => {
        playNextTrack();
    });

    if (btnRepeat) {
        btnRepeat.addEventListener('click', () => {
            state.isRepeat = !state.isRepeat;
            btnRepeat.classList.toggle('active', state.isRepeat);
        });
    }

    window.addEventListener('visualizermodechange', () => {
        updatePlayState(state.isPlaying);
        if (state.currentTrack) {
            if (state.currentTrack.video) {
                showVideoPlayer();
            } else {
                showAudioVisualizer();
            }
        } else {
            showAudioVisualizer();
        }
    });

    // Audio/Video native listeners
    audio.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('timeupdate', handleTimeUpdate);

    audio.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('durationchange', handleDurationChange);

    audio.addEventListener('ended', () => {
        if (audio.currentTime > 0 && audio.duration && Math.abs(audio.currentTime - audio.duration) < 1.5) {
            playNextTrack();
        }
    });

    video.addEventListener('ended', () => {
        if (video.currentTime > 0 && video.duration && Math.abs(video.currentTime - video.duration) < 1.5) {
            playNextTrack();
        }
    });

    // Seek Click
    progressSliderWrapper.addEventListener('click', (e) => {
        const activeMedia = state.currentMediaType === 'video' ? video : audio;
        if (!activeMedia || !activeMedia.src || !activeMedia.duration) return;
        const rect = progressSliderWrapper.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, clickX / rect.width));
        activeMedia.currentTime = percent * activeMedia.duration;
    });

    // Seek Drag
    progressSliderWrapper.addEventListener('mousedown', (e) => { 
        e.preventDefault();
        isDraggingSeek = true; 
    });
    document.addEventListener('mousemove', (e) => {
        const activeMedia = state.currentMediaType === 'video' ? video : audio;
        if (!isDraggingSeek || !activeMedia || !activeMedia.duration) return;
        const rect = progressSliderWrapper.getBoundingClientRect();
        const moveX = e.clientX - rect.left;
        const percent = Math.max(0, Math.min(1, moveX / rect.width));
        progressFill.style.width = `${percent * 100}%`;
        progressHandle.style.left = `${percent * 100}%`;
        timeCurrent.textContent = formatTime(percent * activeMedia.duration);
    });
    document.addEventListener('mouseup', (e) => {
        if (isDraggingSeek) {
            isDraggingSeek = false;
            const activeMedia = state.currentMediaType === 'video' ? video : audio;
            if (activeMedia && activeMedia.duration) {
                const rect = progressSliderWrapper.getBoundingClientRect();
                const releaseX = e.clientX - rect.left;
                const percent = Math.max(0, Math.min(1, releaseX / rect.width));
                activeMedia.currentTime = percent * activeMedia.duration;
            }
        }
    });

    // Volume controls
    function setVolumeFromEvent(e) {
        const rect = volumeSliderWrapper.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const volume = Math.max(0, Math.min(1, clickX / rect.width));
        audio.volume = volume;
        video.volume = volume;
        volumeFill.style.width = `${volume * 100}%`;
        updateVolumeIcon(volume);
        state.lastVolume = volume;
    }

    volumeSliderWrapper.addEventListener('click', setVolumeFromEvent);
    volumeSliderWrapper.addEventListener('mousedown', (e) => { 
        e.preventDefault();
        isDraggingVolume = true; 
    });
    document.addEventListener('mousemove', (e) => {
        if (isDraggingVolume) setVolumeFromEvent(e);
    });
    document.addEventListener('mouseup', () => {
        if (isDraggingVolume) isDraggingVolume = false;
    });

    btnMute.addEventListener('click', () => {
        const currentVol = state.currentMediaType === 'video' ? video.volume : audio.volume;
        if (currentVol > 0) {
            state.lastVolume = currentVol;
            audio.volume = 0;
            video.volume = 0;
            volumeFill.style.width = '0%';
            updateVolumeIcon(0);
        } else {
            audio.volume = state.lastVolume;
            video.volume = state.lastVolume;
            volumeFill.style.width = `${state.lastVolume * 100}%`;
            updateVolumeIcon(state.lastVolume);
        }
    });

    playerTrackTitle.addEventListener('click', () => {
        if (state.currentPlaylist && state.currentTrackIndex !== -1) {
            const track = state.currentPlaylist.tracks[state.currentTrackIndex];
            if (track && track.link) {
                window.open(track.link, '_blank', 'noopener,noreferrer');
            }
        }
    });
}

/**
 * Updates the volume icon based on the current volume level.
 * Replaces the DOM node entirely to ensure Lucide re-renders the new SVG.
 * @param {number} vol - The current volume level (0.0 to 1.0)
 */
function updateVolumeIcon(vol) {
    const currentVolIcon = document.getElementById('volume-icon');
    if (currentVolIcon) {
        const iconName = vol === 0 ? 'volume-x' : (vol < 0.4 ? 'volume' : (vol < 0.7 ? 'volume-1' : 'volume-2'));
        const useTag = currentVolIcon.querySelector('use');
        if (useTag) {
            useTag.setAttribute('href', '#icon-' + iconName);
        }
        currentVolIcon.className = 'lucide lucide-' + iconName;
    }
}
