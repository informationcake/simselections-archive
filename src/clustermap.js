import { state } from './state.js';
import { playTrack } from './player.js';
import { playlistData } from './metadata.js';
import { escapeHtml } from './utils.js';
// ─── Clustermap / Similarity Map ────────────────────────────────────────────────────
// This module handles the interactive audio-similarity scatter plot built with
// Plotly.  It is only initialised when FEATURES.clusterMap === true.
// ─────────────────────────────────────────────────────────────────────────────

let clustermapLoaded = false;
let clustermapData = null;
let highlightedArtist = null;
let clustermapPulseLoopRunning = false;
let staticDataPrepared = false;
let allTracks = [];
let getPrimaryArtists = null;
let canonicalArtists = {};
let artistList = [];
let artistSubmissionCounts = {};
let artistCollabDegrees = {};

function prepareStaticData() {
    if (staticDataPrepared) return;

    allTracks = [];
    playlistData.forEach(playlist => {
        const tracks = playlist.tracks || [];
        tracks.forEach(track => {
            allTracks.push({
                trackNo: track.trackNo,
                artist: track.artist || 'Unknown Artist',
                title: track.title || 'Untitled',
                file: track.file || '',
                playlist: playlist.name,
                playlistId: playlist.id,
                year: playlist.year,
                month: playlist.month,
                theme: playlist.theme,
                challenge: playlist.challenge
            });
        });
    });

    getPrimaryArtists = (artistStr) => {
        if (!artistStr) return [];
        let normalized = artistStr
            .replace(/\b(feat\.?|ft\.?|and|with|vs\.?|versus)\b/gi, '|')
            .replace(/[&;\/]/g, '|');
        return normalized.split('|')
            .map(a => a.trim())
            .filter(a => a.length > 0);
    };

    allTracks.forEach(track => {
        const pa = getPrimaryArtists(track.artist);
        pa.forEach(a => {
            const lower = a.toLowerCase();
            if (!canonicalArtists[lower]) {
                canonicalArtists[lower] = a;
            }
            const canonical = canonicalArtists[lower];
            artistSubmissionCounts[canonical] = (artistSubmissionCounts[canonical] || 0) + 1;
        });
    });

    artistList = Array.from(new Set(Object.values(canonicalArtists)));

    // Compute collaboration degrees (number of unique collaborators) for each artist
    const collaboratorsMap = {};
    artistList.forEach(a => collaboratorsMap[a] = new Set());
    allTracks.forEach(track => {
        const pa = getPrimaryArtists(track.artist).map(a => canonicalArtists[a.toLowerCase()]);
        if (pa.length > 1) {
            pa.forEach(a1 => {
                pa.forEach(a2 => {
                    if (a1 && a2 && a1 !== a2) {
                        collaboratorsMap[a1].add(a2);
                    }
                });
            });
        }
    });
    artistList.forEach(a => {
        artistCollabDegrees[a] = collaboratorsMap[a].size;
    });

    staticDataPrepared = true;
}

// ── Public API (also attached to window for cross-module access) ──────────────

/**
 * Fetches the Clustermap coordinate data and initializes the Plotly similarity map.
 */
/**
 * Helper to generate Clustermap-style 2D coordinates for all tracks dynamically.
 * Clusters tracks by primary artist, collaboration connections, and shared challenges.
 */
function generateClustermapData() {
    prepareStaticData();

    const sliderCollab = document.getElementById('ctrl-collab');
    const sliderChallenge = document.getElementById('ctrl-challenge');
    const sliderRepel = document.getElementById('ctrl-repel');
    const sliderRegularity = document.getElementById('ctrl-regularity');

    const collabFactor = sliderCollab ? parseFloat(sliderCollab.value) : 1.0;
    const challengeFactor = sliderChallenge ? parseFloat(sliderChallenge.value) : 0.15;
    const repelFactor = sliderRepel ? parseFloat(sliderRepel.value) : 0;
    const regularityFactor = sliderRegularity ? parseFloat(sliderRegularity.value) : 0.0;

    const artistCoords = {};

    // Find max submissions across catalog to normalize regularity pull
    const maxSubmissions = Math.max(...Object.values(artistSubmissionCounts), 1);
    const totalArtists = artistList.length || 1;

    // Position artists in a golden spiral initially
    artistList.forEach((artist, index) => {
        const phi = index * 137.5 * Math.PI / 180;
        const r = 1.0 * Math.sqrt(index + 1); 
        artistCoords[artist] = { x: r * Math.cos(phi), y: r * Math.sin(phi) };
    });

    // Compute collaboration strengths
    const collabStrengths = {};
    allTracks.forEach(track => {
        const pa = getPrimaryArtists(track.artist).map(a => canonicalArtists[a.toLowerCase()]);
        for (let i = 0; i < pa.length; i++) {
            for (let j = i + 1; j < pa.length; j++) {
                const a1 = pa[i];
                const a2 = pa[j];
                if (a1 && a2 && a1 !== a2) {
                    const key = a1 < a2 ? `${a1}|||${a2}` : `${a2}|||${a1}`;
                    collabStrengths[key] = (collabStrengths[key] || 0) + collabFactor;
                }
            }
        }
    });

    // Run force-directed layout (reduced to 30 iterations for fast live adjustments)
    const iterations = 30;
    const kRepel = repelFactor;
    const kAttract = 0.05;
    const kOrigin = 0.015;

    for (let step = 0; step < iterations; step++) {
        const forces = {};
        artistList.forEach(a => forces[a] = { x: 0, y: 0 });

        // Repel all artists
        for (let i = 0; i < artistList.length; i++) {
            const a1 = artistList[i];
            const p1 = artistCoords[a1];
            for (let j = i + 1; j < artistList.length; j++) {
                const a2 = artistList[j];
                const p2 = artistCoords[a2];

                const dx = p1.x - p2.x;
                const dy = p1.y - p2.y;
                const actDist = Math.sqrt(dx * dx + dy * dy) + 0.01;
                const distSq = dx * dx + dy * dy + 400;

                if (actDist < 200) {
                    const f = kRepel / distSq;
                    const fx = (dx / actDist) * f;
                    const fy = (dy / actDist) * f;

                    forces[a1].x += fx;
                    forces[a1].y += fy;
                    forces[a2].x -= fx;
                    forces[a2].y -= fy;
                }
            }
        }

        // Attract collaborating artists
        Object.entries(collabStrengths).forEach(([key, strength]) => {
            const [a1, a2] = key.split('|||');
            if (artistCoords[a1] && artistCoords[a2]) {
                const p1 = artistCoords[a1];
                const p2 = artistCoords[a2];

                const dx = p1.x - p2.x;
                const dy = p1.y - p2.y;
                const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;

                const f = kAttract * dist * strength;
                const fx = (dx / dist) * f;
                const fy = (dy / dist) * f;

                forces[a1].x -= fx;
                forces[a1].y -= fy;
                forces[a2].x += fx;
                forces[a2].y += fy;
            }
        });

        artistList.forEach(a => {
            const p = artistCoords[a];
            const hasCollab = (artistCollabDegrees[a] || 0) > 0 && (collabFactor > 0.01);
            const submissions = artistSubmissionCounts[a] || 1;
            
            if (hasCollab) {
                const kRegularity = regularityFactor * (submissions - 1);
                // Scale origin pull by collabFactor to pull collabs to the center
                const totalOriginPull = (kOrigin * collabFactor) + kRegularity;
                forces[a].x -= p.x * totalOriginPull;
                forces[a].y -= p.y * totalOriginPull;
            } else {
                // Solo artists (or all artists when collab attraction is 0) are directed to a target shell that shrinks with regularity
                const baseTargetR = 30 + (collabFactor - 1.0) * 3.0;
                const dist = Math.sqrt(p.x * p.x + p.y * p.y) + 0.01;
                const kShell = 0.08; 
                const targetR = Math.max(0, baseTargetR - regularityFactor * 45.0 * (submissions - 1));
                const f = kShell * (dist - targetR);
                forces[a].x -= (p.x / dist) * f;
                forces[a].y -= (p.y / dist) * f;
            }
        });

        // Update coordinates with cooling
        const cooling = 1 - (step / iterations);
        artistList.forEach(a => {
            artistCoords[a].x += forces[a].x * 0.5 * cooling;
            artistCoords[a].y += forces[a].y * 0.5 * cooling;
        });
    }

    // Compute monthly playlist centroids dynamically based on current artist layout coords
    const playlistCoords = {};
    playlistData.forEach(playlist => {
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        const tracks = playlist.tracks || [];
        tracks.forEach(track => {
            const primaryArtists = getPrimaryArtists(track.artist);
            primaryArtists.forEach(a => {
                const canonical = canonicalArtists[a.toLowerCase()];
                if (canonical && artistCoords[canonical]) {
                    sumX += artistCoords[canonical].x;
                    sumY += artistCoords[canonical].y;
                    count++;
                }
            });
        });
        if (count > 0) {
            playlistCoords[playlist.name] = { x: sumX / count, y: sumY / count };
        }
    });

    // Map tracks to cluster positions
    return allTracks.map(track => {
        const pa = getPrimaryArtists(track.artist).map(a => canonicalArtists[a.toLowerCase()]);
        let baseX = 0;
        let baseY = 0;
        let validArtistsCount = 0;

        pa.forEach(a => {
            if (a && artistCoords[a]) {
                baseX += artistCoords[a].x;
                baseY += artistCoords[a].y;
                validArtistsCount++;
            }
        });

        if (validArtistsCount > 0) {
            baseX /= validArtistsCount;
            baseY /= validArtistsCount;
        }

        // Collab Attraction: Pull tracks with multiple artists (collabs) visually to the center,
        // and push single artist tracks (solos) visually toward the edge.
        if (pa.length > 1) {
            // It's a collaboration track. Max pull to center is 85%.
            const pullToCenter = Math.min(0.85, Math.max(0, (collabFactor - 1.0) * 0.25)); 
            if (pullToCenter > 0) {
                baseX *= (1 - pullToCenter);
                baseY *= (1 - pullToCenter);
            }
        } else {
            // It's a solo track. Push it to the edge.
            const pushToEdge = Math.max(0, (collabFactor - 1.0) * 3.5); 
            if (pushToEdge > 0) {
                const trackDist = Math.sqrt(baseX * baseX + baseY * baseY) + 0.001;
                baseX += (baseX / trackDist) * pushToEdge;
                baseY += (baseY / trackDist) * pushToEdge;
            }
        }

        // Pull tracks towards their monthly playlist centroid dynamically based on challengeFactor (Month Attraction)
        const pCoord = playlistCoords[track.playlist];
        if (pCoord) {
            const blend = Math.min(0.85, challengeFactor * 1.5); // Cap at 85% blend so they don't completely merge
            baseX = baseX * (1 - blend) + pCoord.x * blend;
            baseY = baseY * (1 - blend) + pCoord.y * blend;
        }

        // Apply tanh compression to keep coordinates bounded and avoid excessive empty margins
        const dist = Math.sqrt(baseX * baseX + baseY * baseY);
        if (dist > 0) {
            const maxRadius = 40;  // Limit coordinate range to a 40-unit radius
            const scale = 25;      // Keep central cluster expansion linear
            const newDist = maxRadius * Math.tanh(dist / scale);
            baseX = (baseX / dist) * newDist;
            baseY = (baseY / dist) * newDist;
        }

        return {
            ...track,
            x: baseX,
            y: baseY
        };
    });
}

let slidersWired = false;

function setupSliderListeners() {
    if (slidersWired) return;
    
    const sliderCollab = document.getElementById('ctrl-collab');
    const sliderChallenge = document.getElementById('ctrl-challenge');
    const sliderRepel = document.getElementById('ctrl-repel');
    const sliderRegularity = document.getElementById('ctrl-regularity');
    const btnReset = document.getElementById('reset-clustermap-controls');
    
    if (!sliderCollab) return;
    
    const sliders = [
        { el: sliderCollab, valId: 'val-collab', defaultVal: "1.0" },
        { el: sliderRepel, valId: 'val-repel', defaultVal: "0" },
        { el: sliderRegularity, valId: 'val-regularity', defaultVal: "0.000" }
    ];
    
    sliders.forEach(({ el, valId }) => {
        el.addEventListener('input', () => {
            const valEl = document.getElementById(valId);
            if (valEl) valEl.textContent = el.value;
            try {
                const data = generateClustermapData();
                clustermapData = data;
                renderClustermapPlot(data);
            } catch (err) {
                console.error('Error updating similarity map on control change:', err);
            }
        });
    });

    if (btnReset) {
        btnReset.addEventListener('click', () => {
            sliders.forEach(({ el, valId, defaultVal }) => {
                el.value = defaultVal;
                const valEl = document.getElementById(valId);
                if (valEl) valEl.textContent = defaultVal;
            });
            try {
                const data = generateClustermapData();
                clustermapData = data;
                renderClustermapPlot(data);
            } catch (err) {
                console.error('Error resetting similarity map controls:', err);
            }
        });
    }
    
    slidersWired = true;
}

export function initializeClustermap() {
    const statusBadge = document.getElementById('clustermap-status-badge');
    if (statusBadge) statusBadge.textContent = 'Generating clustering map...';

    setupSliderListeners();

    try {
        const data = generateClustermapData();
        clustermapData = data;
        clustermapLoaded = true;
        if (statusBadge) statusBadge.textContent = `${data.length} songs mapped`;
        renderClustermapPlot(data);
        buildArtistLegend(data);
    } catch (err) {
        console.error('Error generating similarity map:', err);
        if (statusBadge) statusBadge.textContent = 'Similarity map unavailable';
    }
}

/**
 * Renders or updates the interactive Plotly scatter plot with the provided data.
 * @param {Array} data - Array of track coordinate objects.
 */
export function renderClustermapPlot(data) {
    const plotDiv = document.getElementById('clustermap-plot-div');
    if (!plotDiv || typeof Plotly === 'undefined') return;

    const bodyStyles = getComputedStyle(document.body);
    const accent = bodyStyles.getPropertyValue('--accent').trim() || '#ec4899';
    const accentCyan = bodyStyles.getPropertyValue('--accent-cyan').trim() || '#06b6d4';

    const artistColorMap = buildArtistColorMap(data, accent, accentCyan);

    const filteredData = highlightedArtist
        ? data.filter(d => d.artist === highlightedArtist)
        : data;

    const x = filteredData.map(d => d.x);
    const y = filteredData.map(d => d.y);
    const colors = filteredData.map(d => artistColorMap[d.artist] || accentCyan);
    const text = filteredData.map(d => `${d.title} – ${d.artist}<br>${d.playlist || ''}`);

    const trace = {
        type: 'scatter',
        mode: 'markers',
        x, y,
        text,
        hoverinfo: 'text',
        marker: {
            size: 7,
            color: colors,
            opacity: 0.82,
            line: { width: 0 }
        }
    };

    const layout = {
        margin: { t: 8, r: 8, b: 8, l: 8 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        showlegend: false,
        dragmode: 'pan',
        hovermode: 'closest',
        xaxis: { showgrid: false, zeroline: false, visible: false },
        yaxis: { showgrid: false, zeroline: false, visible: false }
    };

    Plotly.newPlot(plotDiv, [trace], layout, {
        responsive: true,
        displayModeBar: false,
        scrollZoom: true
    });

    plotDiv.on('plotly_click', evt => {
        const pt = evt.points[0];
        if (!pt) return;
        const clicked = filteredData[pt.pointIndex];
        if (!clicked) return;
        jumpToTrack(clicked);
    });
}

/**
 * Starts the animation loop for the "now playing" pulse ring indicator on the map.
 */
export function startClustermapPulseLoop() {
    if (clustermapPulseLoopRunning || !clustermapLoaded) return;
    clustermapPulseLoopRunning = true;
    requestAnimationFrame(updatePulseRing);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Builds a mapping of artist names to specific theme colors for the scatter plot.
 * @param {Array} data - Clustermap dataset.
 * @param {string} accent - Primary accent color.
 * @param {string} accentCyan - Secondary accent color.
 * @returns {Object} Dictionary mapping artists to color strings.
 */
function buildArtistColorMap(data, accent, accentCyan) {
    const artists = [...new Set(data.map(d => d.artist))];
    const palette = buildPalette(artists.length, accent, accentCyan);
    const map = {};
    artists.forEach((a, i) => { map[a] = palette[i]; });
    return map;
}

/**
 * Generates an array of equidistant HSL colors for artist grouping.
 * @param {number} n - Number of colors to generate.
 * @param {string} accent - Primary accent.
 * @param {string} accentCyan - Secondary accent.
 * @returns {Array} Array of color strings.
 */
function buildPalette(n, accent, accentCyan) {
    const colors = [];
    for (let i = 0; i < n; i++) {
        const hue = (i * 360 / n) % 360;
        colors.push(`hsl(${hue}, 75%, 60%)`);
    }
    return colors;
}

/**
 * Renders the interactive artist legend and search filter next to the similarity map.
 * @param {Array} data - Clustermap dataset.
 */
function buildArtistLegend(data) {
    const listEl = document.getElementById('artist-legend-list');
    const searchEl = document.getElementById('artist-legend-search');
    const clearBtn = document.getElementById('clear-artist-highlight');
    if (!listEl) return;

    const bodyStyles = getComputedStyle(document.body);
    const accent = bodyStyles.getPropertyValue('--accent').trim() || '#ec4899';
    const accentCyan = bodyStyles.getPropertyValue('--accent-cyan').trim() || '#06b6d4';
    const artistColorMap = buildArtistColorMap(data, accent, accentCyan);

    const artistCounts = {};
    data.forEach(d => { artistCounts[d.artist] = (artistCounts[d.artist] || 0) + 1; });
    const sorted = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]);

    function render(filter = '') {
        const q = filter.toLowerCase();
        listEl.innerHTML = '';
        sorted
            .filter(([name]) => !q || name.toLowerCase().includes(q))
            .forEach(([name, count]) => {
                const item = document.createElement('div');
                item.className = 'artist-legend-item' + (highlightedArtist === name ? ' active' : '');
                item.innerHTML = `
                    <span class="artist-legend-left">
                        <span class="artist-color-indicator" style="background:${artistColorMap[name]}"></span>
                        ${escapeHtml(name)}
                    </span>
                    <span class="artist-track-count">${count}</span>
                `;
                item.addEventListener('click', () => {
                    highlightedArtist = highlightedArtist === name ? null : name;
                    if (clearBtn) clearBtn.classList.toggle('hidden', !highlightedArtist);
                    renderClustermapPlot(data);
                    render(searchEl ? searchEl.value : '');
                });
                listEl.appendChild(item);
            });
    }

    render();
    if (searchEl) searchEl.addEventListener('input', () => render(searchEl.value));
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            highlightedArtist = null;
            clearBtn.classList.add('hidden');
            renderClustermapPlot(data);
            render(searchEl ? searchEl.value : '');
        });
    }
}

/**
 * Locates a clicked track in the library and immediately starts playback.
 * @param {Object} trackEntry - The track data object clicked on the map.
 */
function jumpToTrack(trackEntry) {
    if (!trackEntry) return;
    if (typeof window.loadPlaylist !== 'function') return;

    for (const playlist of playlistData) {
        let trackIndex = -1;

        // Try matching exactly by file, title, and artist first to resolve collisions
        if (trackEntry.file) {
            trackIndex = playlist.tracks.findIndex(t => 
                t.file === trackEntry.file && 
                t.title === trackEntry.title && 
                t.artist === trackEntry.artist
            );
            if (trackIndex === -1) {
                trackIndex = playlist.tracks.findIndex(t => t.file && t.file === trackEntry.file);
            }
        }

        // Fallback to title and artist match within the target playlist
        if (trackIndex === -1 && (playlist.name === trackEntry.playlist || playlist.id === trackEntry.playlistId)) {
            trackIndex = playlist.tracks.findIndex(t => 
                t.title === trackEntry.title && 
                t.artist === trackEntry.artist
            );
        }

        // Global fallback to title and artist match
        if (trackIndex === -1) {
            trackIndex = playlist.tracks.findIndex(t => 
                t.title === trackEntry.title && 
                t.artist === trackEntry.artist
            );
        }

        if (trackIndex !== -1) {
            // Load playlist
            window.loadPlaylist(playlist);

            // Sync active sidebar item
            const monthItem = document.querySelector(`.month-item[data-id="${playlist.id}"]`);
            if (monthItem) {
                document.querySelectorAll('.month-item').forEach(el => el.classList.remove('active'));
                monthItem.classList.add('active');
                const yearNode = monthItem.closest('.year-node');
                if (yearNode) {
                    yearNode.classList.add('open');
                    const header = yearNode.querySelector('.year-header');
                    if (header) header.classList.add('open');
                }
            }

            // Play/select track (handles audio play or UI update for non-opted-in tracks)
            playTrack(trackIndex);
            break;
        }
    }
}

/**
 * Animation loop that continuously positions the pulse ring over the currently playing track's coordinates.
 */
function updatePulseRing() {
    if (!clustermapLoaded) { clustermapPulseLoopRunning = false; return; }

    const ring = document.getElementById('clustermap-active-pulse-ring');
    const plotDiv = document.getElementById('clustermap-plot-div');
    if (!ring || !plotDiv || !state.playingPlaylist || state.currentTrackIndex < 0) {
        if (ring) ring.classList.add('hidden');
        requestAnimationFrame(updatePulseRing);
        return;
    }

    const track = state.playingPlaylist.tracks[state.currentTrackIndex];
    if (!track || !clustermapData) {
        ring.classList.add('hidden');
        requestAnimationFrame(updatePulseRing);
        return;
    }

    let match = null;
    if (track.file) {
        match = clustermapData.find(d => d.file && d.file === track.file);
    }
    if (!match) {
        match = clustermapData.find(d => 
            d.artist === track.artist && 
            d.title === track.title && 
            (d.playlist === state.playingPlaylist.name || d.playlistId === state.playingPlaylist.id)
        );
    }
    if (!match) {
        match = clustermapData.find(d => d.artist === track.artist && d.title === track.title);
    }

    if (!match) {
        ring.classList.add('hidden');
        requestAnimationFrame(updatePulseRing);
        return;
    }

    // Get Plotly pixel coordinates for the matched data point
    const gd = plotDiv._fullLayout;
    if (!gd || !gd.xaxis || !gd.yaxis || !gd._size) {
        ring.classList.add('hidden');
        requestAnimationFrame(updatePulseRing);
        return;
    }
    
    const xAxis = gd.xaxis;
    const yAxis = gd.yaxis;
    
    // Calculate coordinates relative to #clustermap-plot-div
    const px = xAxis.l2p(match.x) + gd._size.l;
    const py = yAxis.l2p(match.y) + gd._size.t;
    
    // Offset by the difference between #clustermap-plot-div and the .clustermap-plot-wrapper (offsetParent)
    const wrapper = plotDiv.parentElement;
    if (wrapper) {
        const rectDiv = plotDiv.getBoundingClientRect();
        const rectWrap = wrapper.getBoundingClientRect();
        ring.style.left = `${px + rectDiv.left - rectWrap.left}px`;
        ring.style.top = `${py + rectDiv.top - rectWrap.top}px`;
        ring.classList.remove('hidden');
    } else {
        ring.style.left = `${px}px`;
        ring.style.top = `${py}px`;
        ring.classList.remove('hidden');
    }

    requestAnimationFrame(updatePulseRing);
}


// ── Window exports for cross-module use ──────────────────────────────────────
if (typeof window !== 'undefined') {
    window.initializeClustermap = initializeClustermap;
    window.renderClustermapPlot = renderClustermapPlot;
    window.startClustermapPulseLoop = startClustermapPulseLoop;
    Object.defineProperty(window, 'clustermapLoaded', { get: () => clustermapLoaded });
    Object.defineProperty(window, 'clustermapData', { get: () => clustermapData });
}
