import { state } from './state.js';

let audio = null;
let video = null;
let canvas = null;
let ctx = null;
let visualizerModeSelect = null;
let nowPlayingFallback = null;
let dataArray = null;

const HEATMAP_MAX_COLS = 300;

/**
 * Initializes DOM element references for the visualizer module.
 */
export function initVisualizerElements() {
    audio = document.getElementById('audio-element');
    video = document.getElementById('video-element');
    canvas = document.getElementById('visualizer-canvas');
    if (canvas) {
        ctx = canvas.getContext('2d');
    }
    visualizerModeSelect = document.getElementById('visualizer-mode');
    nowPlayingFallback = document.getElementById('now-playing-fallback');
}

/**
 * Sets up the Web Audio API context, analyser node, and begins the render loop.
 */
export function initAudioContext() {
    if (state.audioCtx) return; // Already setup

    if (!audio) initVisualizerElements();

    const AudioContext = window.AudioContext || window.webkitAudioContext;
    state.audioCtx = new AudioContext();
    state.analyser = state.audioCtx.createAnalyser();
    state.analyser.fftSize = 2048; // High resolution for heatmap
    state.analyser.smoothingTimeConstant = 0.82;

    state.sourceNode = state.audioCtx.createMediaElementSource(audio);
    state.sourceNode.connect(state.analyser);
    state.analyser.connect(state.audioCtx.destination);

    // Resize canvas
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Start drawing
    drawVisualizer();
}

/**
 * Resizes the visualizer canvas to match its container's dimensions, accounting for pixel ratio.
 */
export function resizeCanvas() {
    if (!canvas || !ctx) return;
    const rect = canvas.parentNode.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

/**
 * Hides the audio visualizer and shows the native video player element.
 */
export function showVideoPlayer() {
    if (!canvas || !video || !nowPlayingFallback) initVisualizerElements();
    canvas.classList.add('hidden');
    video.classList.add('active');
    nowPlayingFallback.classList.add('hidden');
}

/**
 * Hides the native video player and shows the audio visualizer canvas.
 */
export function showAudioVisualizer() {
    if (!canvas || !video || !nowPlayingFallback) initVisualizerElements();
    canvas.classList.remove('hidden');
    video.classList.remove('active');
    if (!state.audioCtx) {
        nowPlayingFallback.classList.remove('hidden');
    }
}

// Map a 0-1 intensity value to a neon heatmap color (adaptive to theme selection)
/**
 * Maps a frequency intensity value to a theme-appropriate neon color string.
 * @param {number} t - Intensity value from 0.0 to 1.0.
 * @returns {string} rgba color string.
 */
function heatmapColor(t) {
    const isAlt = document.body.classList.contains('theme-alt');
    const isGreyscale = document.body.classList.contains('theme-greyscale');
    if (isGreyscale) {
        // Greyscale (black and white with smooth grey progression)
        const grayVal = Math.floor(10 + t * 245);
        return `rgba(${grayVal}, ${grayVal}, ${grayVal}, 1)`;
    } else if (isAlt) {
        // Emerald / Forest / Gold / Orange alternative theme spectrum
        if (t < 0.15) {
            const p = t / 0.15;
            return `rgba(${Math.floor(p * 5)}, ${Math.floor(p * 45)}, ${Math.floor(p * 20)}, 1)`;
        } else if (t < 0.35) {
            const p = (t - 0.15) / 0.2;
            return `rgba(${Math.floor(5 + p * 11)}, ${Math.floor(45 + p * 140)}, ${Math.floor(20 + p * 109)}, 1)`;
        } else if (t < 0.55) {
            const p = (t - 0.35) / 0.2;
            return `rgba(${Math.floor(16 + p * 218)}, ${Math.floor(185 - p * 6)}, ${Math.floor(129 - p * 121)}, 1)`;
        } else if (t < 0.75) {
            const p = (t - 0.55) / 0.2;
            return `rgba(${Math.floor(234 + p * 15)}, ${Math.floor(179 - p * 64)}, ${Math.floor(8 + p * 14)}, 1)`;
        } else {
            const p = (t - 0.75) / 0.25;
            return `rgba(${Math.floor(249 + p * 6)}, ${Math.floor(115 - p * 52)}, ${Math.floor(22 + p * 213)}, 1)`;
        }
    } else {
        // Cyberpunk Pink / Cyan default theme spectrum
        if (t < 0.15) {
            const p = t / 0.15;
            return `rgba(${Math.floor(p * 10)}, ${Math.floor(p * 20)}, ${Math.floor(p * 60)}, 1)`;
        } else if (t < 0.35) {
            const p = (t - 0.15) / 0.2;
            return `rgba(${Math.floor(10 + p * 0)}, ${Math.floor(20 + p * 140)}, ${Math.floor(60 + p * 152)}, 1)`;
        } else if (t < 0.55) {
            const p = (t - 0.35) / 0.2;
            return `rgba(${Math.floor(6 + p * 160)}, ${Math.floor(160 + p * 22)}, ${Math.floor(212 - p * 60)}, 1)`;
        } else if (t < 0.75) {
            const p = (t - 0.55) / 0.2;
            return `rgba(${Math.floor(166 + p * 70)}, ${Math.floor(182 - p * 110)}, ${Math.floor(152 + p * 1)}, 1)`;
        } else {
            const p = (t - 0.75) / 0.25;
            return `rgba(${Math.floor(236 + p * 19)}, ${Math.floor(72 + p * 183)}, ${Math.floor(153 + p * 102)}, 1)`;
        }
    }
}

/**
 * Main animation loop that reads audio frequency data and renders the selected visualizer mode.
 */
export function drawVisualizer() {
    state.animationId = requestAnimationFrame(drawVisualizer);

    if (!canvas || !ctx || !state.analyser) return;

    const width = canvas.width / window.devicePixelRatio;
    const height = canvas.height / window.devicePixelRatio;
    
    ctx.clearRect(0, 0, width, height);

    const bufferLength = state.analyser.frequencyBinCount;
    if (!dataArray || dataArray.length !== bufferLength) {
        dataArray = new Uint8Array(bufferLength);
    }
    const mode = visualizerModeSelect ? visualizerModeSelect.value : 'bars';

    // Get current theme color variables from DOM
    const bodyStyles = getComputedStyle(document.body);
    const accentColor = bodyStyles.getPropertyValue('--accent').trim() || '#ec4899';
    const accentGlow = bodyStyles.getPropertyValue('--accent-glow').trim() || 'rgba(236, 72, 153, 0.4)';
    const cyanColor = bodyStyles.getPropertyValue('--accent-cyan').trim() || '#06b6d4';
    const cyanGlow = bodyStyles.getPropertyValue('--accent-cyan-glow').trim() || 'rgba(6, 182, 212, 0.4)';
    const purpleColor = bodyStyles.getPropertyValue('--accent-purple').trim() || '#8b5cf6';
    const purpleGlow = bodyStyles.getPropertyValue('--accent-purple-glow').trim() || 'rgba(139, 92, 246, 0.4)';

    if (mode === 'heatmap') {
        // === NEON HEATMAP SPECTROGRAM ===
        state.analyser.getByteFrequencyData(dataArray);
        
        // Use lower 40% of frequency bins (most musically interesting)
        const useBins = Math.floor(bufferLength * 0.4);
        const column = new Uint8Array(useBins);
        for (let i = 0; i < useBins; i++) {
            column[i] = dataArray[i];
        }
        
        state.heatmapHistory.push(column);
        if (state.heatmapHistory.length > HEATMAP_MAX_COLS) {
            state.heatmapHistory.shift();
        }
        
        const cols = state.heatmapHistory.length;
        const colWidth = width / HEATMAP_MAX_COLS;
        const rowHeight = height / useBins;
        
        // Draw each column of history
        for (let c = 0; c < cols; c++) {
            const col = state.heatmapHistory[c];
            const x = (c + (HEATMAP_MAX_COLS - cols)) * colWidth;
            
            for (let r = 0; r < useBins; r++) {
                const intensity = col[r] / 255;
                if (intensity < 0.02) continue; // skip silence
                
                // Flip Y so low freq at bottom
                const y = height - ((r + 1) * rowHeight);
                
                ctx.fillStyle = heatmapColor(intensity);
                ctx.globalAlpha = 0.5 + intensity * 0.5;
                ctx.fillRect(x, y, colWidth + 0.5, rowHeight + 0.5);
            }
        }
        ctx.globalAlpha = 1.0;
        
        // Glow overlay on the leading edge
        if (cols > 0) {
            const edgeX = (HEATMAP_MAX_COLS - 1) * colWidth;
            const glowGrad = ctx.createLinearGradient(edgeX - 30, 0, edgeX + colWidth, 0);
            glowGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
            glowGrad.addColorStop(0.7, cyanGlow.replace('0.4', '0.04').replace('rgba', 'rgba').replace('rgb', 'rgba'));
            glowGrad.addColorStop(1, accentGlow.replace('0.4', '0.08').replace('rgba', 'rgba').replace('rgb', 'rgba'));
            ctx.fillStyle = glowGrad;
            ctx.fillRect(edgeX - 30, 0, 30 + colWidth, height);
        }

        // Subtle horizontal grid lines
        ctx.strokeStyle = cyanGlow.replace('0.4', '0.06');
        ctx.lineWidth = 0.5;
        for (let i = 1; i < 8; i++) {
            const y = (height / 8) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

    } else if (mode === 'wave') {
        // === SINEWAVE ===
        state.analyser.getByteTimeDomainData(dataArray);

        // Draw glow layer
        ctx.lineWidth = 5;
        ctx.strokeStyle = cyanGlow.replace('0.4', '0.15');
        ctx.beginPath();
        const sliceWidth = width / bufferLength;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * height) / 2;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            x += sliceWidth;
        }
        ctx.stroke();

        // Draw sharp layer
        ctx.lineWidth = 2;
        ctx.strokeStyle = cyanColor;
        ctx.shadowBlur = 15;
        ctx.shadowColor = cyanGlow;
        ctx.beginPath();
        x = 0;
        for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * height) / 2;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            x += sliceWidth;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

    } else if (mode === 'circle') {
        // === CIRCULAR PULSE ===
        state.analyser.getByteFrequencyData(dataArray);
        
        let bassSum = 0;
        for(let i=0; i<10; i++) bassSum += dataArray[i];
        const pulse = 1 + (bassSum / 2550) * 0.18;

        const centerX = width / 2;
        const centerY = height / 2;
        const radius = Math.min(centerX, centerY) * 0.42 * pulse;

        // Outer glow ring
        ctx.shadowBlur = 30;
        ctx.shadowColor = accentGlow;
        ctx.strokeStyle = accentGlow.replace('0.4', '0.15');
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius + 35, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Inner disc
        ctx.fillStyle = 'rgba(10, 15, 30, 0.7)';
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius - 10, 0, 2 * Math.PI);
        ctx.fill();

        // Radial frequency spikes
        const numSpikes = 80;
        const isAlt = document.body.classList.contains('theme-alt');
        const isGreyscale = document.body.classList.contains('theme-greyscale');
        for (let i = 0; i < numSpikes; i++) {
            const angle = (i / numSpikes) * Math.PI * 2 - Math.PI / 2;
            const dataIdx = Math.floor((i / numSpikes) * (bufferLength * 0.5));
            const intensity = dataArray[dataIdx] / 255;
            const spikeHeight = intensity * 55;
            
            const x1 = centerX + Math.cos(angle) * radius;
            const y1 = centerY + Math.sin(angle) * radius;
            const x2 = centerX + Math.cos(angle) * (radius + spikeHeight);
            const y2 = centerY + Math.sin(angle) * (radius + spikeHeight);

            // Compute theme-specific spike colors
            let hue;
            if (isAlt) {
                // green -> gold range (120 to 60)
                hue = 120 - (i / numSpikes) * 60;
            } else {
                // cyan -> pink range (180 to 320)
                hue = 180 + (i / numSpikes) * 140;
            }
            
            if (isGreyscale) {
                ctx.strokeStyle = `hsla(0, 0%, ${50 + intensity * 50}%, ${0.4 + intensity * 0.6})`;
            } else {
                ctx.strokeStyle = `hsla(${hue}, 85%, ${50 + intensity * 20}%, ${0.4 + intensity * 0.6})`;
            }
            ctx.lineWidth = 3;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
        }

    } else if (mode === 'particle') {
        // === CYBER WAVE ===
        state.analyser.getByteFrequencyData(dataArray);
        
        const numPoints = 28;
        const spacing = width / (numPoints - 1);
        const points = [];
        
        for (let i = 0; i < numPoints; i++) {
            const dataIdx = Math.floor((i / numPoints) * bufferLength * 0.6);
            const intensity = (dataArray[dataIdx] / 255) * height * 0.55;
            points.push({ x: i * spacing, y: height / 2, intensity });
        }

        // Draw filled area with gradient
        const areaGrad = ctx.createLinearGradient(0, 0, 0, height);
        areaGrad.addColorStop(0, cyanGlow.replace('0.4', '0.08'));
        areaGrad.addColorStop(0.5, purpleGlow.replace('0.4', '0.03'));
        areaGrad.addColorStop(1, accentGlow.replace('0.4', '0.08'));
        
        // Upper wave fill
        ctx.fillStyle = areaGrad;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        for (const p of points) {
            ctx.lineTo(p.x, p.y - p.intensity / 2);
        }
        ctx.lineTo(width, height / 2);
        ctx.fill();

        // Lower wave fill
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        for (const p of points) {
            ctx.lineTo(p.x, p.y + p.intensity / 2);
        }
        ctx.lineTo(width, height / 2);
        ctx.fill();

        // Draw glow nodes
        for (const p of points) {
            const nodeSize = 3 + (p.intensity / height) * 8;
            
            // Top node
            ctx.fillStyle = cyanColor;
            ctx.shadowBlur = 12;
            ctx.shadowColor = cyanGlow;
            ctx.beginPath();
            ctx.arc(p.x, p.y - p.intensity / 2, nodeSize, 0, Math.PI * 2);
            ctx.fill();

            // Bottom node
            ctx.fillStyle = accentColor;
            ctx.shadowColor = accentGlow;
            ctx.beginPath();
            ctx.arc(p.x, p.y + p.intensity / 2, nodeSize, 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
        }

    } else {
        // === NEON FREQUENCY BARS ===
        state.analyser.getByteFrequencyData(dataArray);
        
        const useBars = Math.floor(bufferLength * 0.2);
        const barWidth = width / useBars;

        for (let i = 0; i < useBars; i++) {
            const barHeight = (dataArray[i] / 255) * height * 0.9;
            const x = i * barWidth;
            
            const gradient = ctx.createLinearGradient(x, height, x, height - barHeight);
            gradient.addColorStop(0, purpleColor);
            gradient.addColorStop(0.4, accentColor);
            gradient.addColorStop(1, cyanColor);

            ctx.fillStyle = gradient;
            ctx.fillRect(x, height - barHeight, barWidth - 1, barHeight);
            
            // Bright cap on top of bar
            if (barHeight > 2) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.fillRect(x, height - barHeight, barWidth - 1, 2);
            }
        }
    }
}
