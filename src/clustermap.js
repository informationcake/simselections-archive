/**
 * clustermap.js
 * 
 * Core D3.js physics and rendering engine for the SimSelections clustering map.
 * This module is exclusively responsible for the force-directed graph simulation,
 * SVG node rendering, zooming behavior, and node pulsing animations. 
 * Data parsing and UI logic are handled by clustermap-data.js and ui.js respectively.
 */
import { state } from './state.js';
import { playTrack } from './player.js';
import { playlistData } from './metadata.js';
import { escapeHtml } from './utils.js';
import { 
    allTracks, canonicalArtists, artistList, 
    artistSubmissionCounts, artistCollabDegrees, 
    getPrimaryArtists, prepareStaticData 
} from './clustermap-data.js';
import { getSliderValues } from './ui.js';

let clustermapLoaded = false;
let clustermapData = null;
let highlightedArtist = null;
let clustermapPulseLoopRunning = false;

// D3 state
let simulation = null;
let svgSelection = null;
let zoomBehavior = null;
let containerSize = { width: 800, height: 600 };
let currentZoom = d3.zoomIdentity;
let d3CachedNodes = null;
let d3CachedLinks = null;

// Expose these for external scripts if needed
window.clustermapLoaded = false;
window.clustermapData = [];

export function resetClustermapZoom() {
    if (svgSelection && containerSize.width && zoomBehavior) {
        svgSelection.transition().duration(750).call(
            zoomBehavior.transform,
            d3.zoomIdentity.translate(containerSize.width / 2, containerSize.height / 2).scale(0.3)
        );
    }
}

export function kickClustermapSimulation() {
    if (simulation) simulation.alpha(1).restart();
}

export function initializeClustermap() {
    prepareStaticData();

    const statusBadge = document.getElementById('clustermap-status-badge');
    if (statusBadge) statusBadge.textContent = `${allTracks.length} songs mapped`;

    clustermapData = allTracks;
    window.clustermapData = clustermapData;
    clustermapLoaded = true;
    window.clustermapLoaded = true;

    initD3Plot();
    buildArtistLegend();

    updateSimulationForces();
}

function initD3Plot() {
    const plotDiv = document.getElementById('clustermap-plot-div');
    if (!plotDiv) return;

    // Clear existing
    plotDiv.innerHTML = '';

    // Get container size
    const rect = plotDiv.getBoundingClientRect();
    containerSize.width = rect.width || 800;
    containerSize.height = rect.height || 600;

    // Create SVG
    const svg = d3.select(plotDiv)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .style('overflow', 'hidden');

    svgSelection = svg;

    const g = svg.append('g').attr('class', 'main-group');

    // Zoom setup
    zoomBehavior = d3.zoom()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
            currentZoom = event.transform;
            g.attr('transform', event.transform);
        });

    svg.call(zoomBehavior);

    // Initial transform to center and zoom out slightly so it fits on screen
    svg.call(zoomBehavior.transform, d3.zoomIdentity.translate(containerSize.width / 2, containerSize.height / 2).scale(0.3));

    // Force Simulation Setup
    simulation = d3.forceSimulation(allTracks)
        .force("charge", d3.forceManyBody())
        .force("collide", d3.forceCollide().radius(7))
        // Baseline forces to shape the generic blob into a 1.5 aspect ratio oval
        .force("baseY", d3.forceY(0).strength(0.045))
        .force("baseX", d3.forceX(0).strength(0.03))
        .alphaDecay(0.01) // Lower decay so it runs longer on single clicks
        .on("tick", ticked);

    // Links container
    g.append("g")
        .attr("class", "links")
        .attr("stroke", "#ffffff")
        .attr("stroke-opacity", 0.15)
        .attr("stroke-width", 1.5);

    // Nodes container
    const nodesG = g.append("g")
        .attr("class", "nodes");

    // Tooltip
    const tooltip = d3.select("body").append("div")
        .attr("class", "clustermap-tooltip")
        .style("position", "absolute")
        .style("visibility", "hidden")
        .style("background", "var(--bg-card)")
        .style("color", "var(--text-color)")
        .style("padding", "8px 12px")
        .style("border-radius", "6px")
        .style("font-size", "12px")
        .style("pointer-events", "none")
        .style("box-shadow", "0 4px 12px rgba(0,0,0,0.5)")
        .style("z-index", 1000)
        .style("border", "1px solid var(--border-color)");

    function ticked() {
        if (d3CachedLinks) {
            d3CachedLinks
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);
        }

        if (d3CachedNodes) {
            d3CachedNodes
                .attr("cx", d => d.x)
                .attr("cy", d => d.y);
        }
    }

    renderNodes();

    // Handle resizing
    window.addEventListener('resize', () => {
        const r = plotDiv.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
            containerSize.width = r.width;
            containerSize.height = r.height;
        }
    });
}

export function updateSimulationForces() {
    if (!simulation) return;

    const vals = getSliderValues();

    // Compute Challenge Centroids (Phyllotaxis / Fibonacci flower spiral OR Radial Ring)
    const challengeList = [...new Set(allTracks.map(d => d.playlist))];
    const challengeCentroids = {};
    const layoutStyle = document.getElementById('ctrl-challenge-layout')?.value || 'flower';

    // Sort to keep the timeline/order somewhat consistent
    challengeList.sort(); 
    challengeList.forEach((c, i) => {
        if (layoutStyle === 'flower') {
            // Golden ratio angle (137.5 degrees) creates a natural flower packing
            const angle = i * 2.39996;
            // Radius expands slowly as more items are added (sqrt ensures even density)
            const radius = Math.sqrt(i) * 150;
            challengeCentroids[c] = {
                x: Math.cos(angle) * radius * 1.5, // Multiply X by 1.5 for oval layout
                y: Math.sin(angle) * radius
            };
        } else {
            // Standard circular ring
            const angle = (i / challengeList.length) * 2 * Math.PI;
            const radius = 600; // Fixed wide radius
            challengeCentroids[c] = {
                x: Math.cos(angle) * radius * 1.5, // Multiply X by 1.5 for oval layout
                y: Math.sin(angle) * radius
            };
        }
    });

    // Apply bounding force to prevent flying away when repel is high and attractions are low
    // We use distinct X/Y forces with a 1.5 ratio instead of forceRadial to maintain the oval shape
    simulation.force("boundingX", d3.forceX(0).strength(0.01));
    simulation.force("boundingY", d3.forceY(0).strength(0.015));
    simulation.force("bounding", null); // Remove old circular radial force if it was active

    // Apply forces
    simulation.force("charge", d3.forceManyBody().strength(-vals.repel));

    // Challenge Attraction Forces
    simulation.force("challengeForceX", d3.forceX(d => {
        return challengeCentroids[d.playlist] ? challengeCentroids[d.playlist].x : 0;
    }).strength(vals.challenge > 0 ? vals.challenge * 0.3 : 0));

    simulation.force("challengeForceY", d3.forceY(d => {
        return challengeCentroids[d.playlist] ? challengeCentroids[d.playlist].y : 0;
    }).strength(vals.challenge > 0 ? vals.challenge * 0.3 : 0));

    // Regularity pulls frequent/infrequent submitters based on slider
    const maxFreq = d3.max(allTracks, d => d.submissionFrequency) || 10;
    
    // Custom oval radial force (D3's forceRadial is perfectly circular)
    const regularityStrength = Math.abs(vals.regularity) * 0.4;
    simulation.force("regularityForce", function(alpha) {
        if (regularityStrength === 0) return;
        for (let i = 0, n = allTracks.length; i < n; ++i) {
            const d = allTracks[i];
            const normalized = d.submissionFrequency / maxFreq;
            const targetRadius = vals.regularity > 0 ? (1 - normalized) * 800 : normalized * 800;
            
            // Determine the node's current angle relative to center (0,0)
            const angle = Math.atan2(d.y, d.x);
            // Target an oval by scaling X by 1.5
            const targetX = Math.cos(angle) * targetRadius * 1.5;
            const targetY = Math.sin(angle) * targetRadius;
            
            d.vx += (targetX - d.x) * regularityStrength * alpha;
            d.vy += (targetY - d.y) * regularityStrength * alpha;
        }
    });

    // Always generate links for collabs to visualize the graph structure
    const linksData = [];
    const tracksByArtist = {};
    allTracks.forEach(t => {
        t.primaryCanonicalArtists.forEach(a => {
            if (!tracksByArtist[a]) tracksByArtist[a] = [];
            tracksByArtist[a].push(t);
        });
    });

    // Star topology: link all tracks of an artist to their first track
    Object.values(tracksByArtist).forEach(list => {
        if (list.length > 1) {
            const hub = list[0];
            for (let i = 1; i < list.length; i++) {
                linksData.push({ source: hub.id, target: list[i].id });
            }
        }
    });

    // Update links on DOM
    const linksG = d3.select('.links');
    const links = linksG.selectAll('line').data(linksData, d => {
        const s = typeof d.source === 'object' ? d.source.id : d.source;
        const t = typeof d.target === 'object' ? d.target.id : d.target;
        return s + '-' + t;
    });
    links.enter().append('line');
    links.exit().remove();
    d3CachedLinks = linksG.selectAll('line');

    // Adjust visual opacity based on collab strength
    d3CachedLinks.attr("stroke-opacity", vals.collab > 0 ? 0.15 : 0.05);

    // Apply force only if collab attraction is active
    if (vals.collab > 0) {
        // vals.collab ranges from 0 to 5. Scale strength smoothly up to 0.5.
        const linkStrength = Math.min(1.0, vals.collab * 0.1);
        simulation.force("link", d3.forceLink(linksData).id(d => d.id).distance(20).strength(linkStrength));
    } else {
        simulation.force("link", null);
    }

    // Restart simulation
    simulation.alpha(1).restart();
}

export function renderClustermapPlot(data) {
    if (!svgSelection || !clustermapLoaded) return;

    // In D3 version, we render once and update attributes, but we can call renderNodes
    // to update colors if highlight changes.
    renderNodes();
}

function renderNodes() {
    const bodyStyles = getComputedStyle(document.body);
    const accent = bodyStyles.getPropertyValue('--accent').trim() || '#ec4899';
    const accentCyan = bodyStyles.getPropertyValue('--accent-cyan').trim() || '#06b6d4';

    const artistColorMap = buildArtistColorMap(allTracks, accent, accentCyan);
    const tooltip = d3.select('.clustermap-tooltip');

    const nodesG = d3.select('.nodes');

    const nodeSelection = nodesG.selectAll('.node')
        .data(allTracks, d => d.id);

    const nodeEnter = nodeSelection.enter()
        .append("circle")
        .attr("class", "node")
        .attr("r", 10)
        .call(d3.drag()
            .on("start", (event, d) => {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
            })
            .on("drag", (event, d) => {
                d.fx = event.x;
                d.fy = event.y;
            })
            .on("end", (event, d) => {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
            }));

    // Update visuals
    nodesG.selectAll('.node')
        .attr("fill", d => {
            if (d.primaryCanonicalArtists && d.primaryCanonicalArtists.length > 0) {
                return artistColorMap[d.primaryCanonicalArtists[0]] || accentCyan;
            }
            return accentCyan;
        })
        .attr("opacity", d => (!highlightedArtist || (d.primaryCanonicalArtists && d.primaryCanonicalArtists.includes(highlightedArtist))) ? 0.9 : 0.1)
        .attr("stroke", d => (!highlightedArtist || (d.primaryCanonicalArtists && d.primaryCanonicalArtists.includes(highlightedArtist))) ? "#fff" : "none")
        .attr("stroke-width", d => (!highlightedArtist || (d.primaryCanonicalArtists && d.primaryCanonicalArtists.includes(highlightedArtist))) ? 0.5 : 0)
        .on("mouseover", (event, d) => {
            d3.select(event.currentTarget).attr("r", 14).attr("stroke-width", 2);
            tooltip.html(`<b>${d.title}</b><br/>${d.artist}<br/><span style="opacity:0.7">${d.playlist}</span>`)
                .style("visibility", "visible");
        })
        .on("mousemove", (event) => {
            tooltip.style("top", (event.pageY - 10) + "px")
                .style("left", (event.pageX + 15) + "px");
        })
        .on("mouseout", (event, d) => {
            d3.select(event.currentTarget).attr("r", 10).attr("stroke-width", (!highlightedArtist || (d.primaryCanonicalArtists && d.primaryCanonicalArtists.includes(highlightedArtist))) ? 0.5 : 0);
            tooltip.style("visibility", "hidden");
        })
        .on("click", (event, d) => jumpToTrack(d));
    
    d3CachedNodes = nodesG.selectAll('.node');
}

export function startClustermapPulseLoop() {
    if (clustermapPulseLoopRunning || !clustermapLoaded) return;
    clustermapPulseLoopRunning = true;
    requestAnimationFrame(updatePulseRing);
}

export function stopClustermapPulseLoop() {
    clustermapPulseLoopRunning = false;
}

function updatePulseRing() {
    if (!clustermapLoaded || !clustermapPulseLoopRunning) { 
        clustermapPulseLoopRunning = false; 
        return; 
    }

    const ring = document.getElementById('clustermap-active-pulse-ring');
    const plotDiv = document.getElementById('clustermap-plot-div');
    if (!ring || !plotDiv || !state.playingPlaylist || state.currentTrackIndex < 0) {
        if (ring) ring.classList.add('hidden');
        requestAnimationFrame(updatePulseRing);
        return;
    }

    const track = state.playingPlaylist.tracks[state.currentTrackIndex];
    if (!track || !allTracks) {
        ring.classList.add('hidden');
        requestAnimationFrame(updatePulseRing);
        return;
    }

    let match = allTracks.find(d =>
        (d.file && d.file === track.file) ||
        (d.artist === track.artist && d.title === track.title)
    );

    if (!match || match.x === undefined) {
        ring.classList.add('hidden');
        requestAnimationFrame(updatePulseRing);
        return;
    }

    // Calculate CSS transform scale to accurately place ring
    const k = currentZoom.k;
    const tx = currentZoom.x;
    const ty = currentZoom.y;

    // Use getBoundingClientRect to ensure absolute positioning matches SVG offsets
    const rect = plotDiv.getBoundingClientRect();
    const wrapper = plotDiv.parentElement;
    const wrapRect = wrapper.getBoundingClientRect();

    // tx and ty already include the container center offset from the zoom.transform initialization
    const px = (match.x * k) + tx + (rect.left - wrapRect.left);
    const py = (match.y * k) + ty + (rect.top - wrapRect.top);

    ring.style.left = `${px}px`;
    ring.style.top = `${py}px`;
    ring.classList.remove('hidden');

    requestAnimationFrame(updatePulseRing);
}

function buildArtistColorMap(data, accent, accentCyan) {
    const artists = [...new Set(data.flatMap(d => d.primaryCanonicalArtists || []))];
    const palette = buildPalette(artists.length, accent, accentCyan);
    const map = {};
    artists.forEach((a, i) => { map[a] = palette[i]; });
    return map;
}

function buildPalette(n, accent, accentCyan) {
    const colors = [];
    for (let i = 0; i < n; i++) {
        const hue = (i * 360 / n) % 360;
        colors.push(`hsl(${hue}, 75%, 60%)`);
    }
    return colors;
}

function buildArtistLegend() {
    const listEl = document.getElementById('artist-legend-list');
    const searchEl = document.getElementById('artist-legend-search');
    const clearBtn = document.getElementById('clear-artist-highlight');
    if (!listEl) return;

    const bodyStyles = getComputedStyle(document.body);
    const accent = bodyStyles.getPropertyValue('--accent').trim() || '#ec4899';
    const accentCyan = bodyStyles.getPropertyValue('--accent-cyan').trim() || '#06b6d4';
    const artistColorMap = buildArtistColorMap(allTracks, accent, accentCyan);

    const artistCounts = {};
    allTracks.forEach(d => {
        if (d.primaryCanonicalArtists) {
            d.primaryCanonicalArtists.forEach(a => {
                artistCounts[a] = (artistCounts[a] || 0) + 1;
            });
        }
    });
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
                    renderNodes();
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
            renderNodes();
            render(searchEl ? searchEl.value : '');
        });
    }
}

function jumpToTrack(trackEntry) {
    if (!trackEntry) return;
    if (typeof window.loadPlaylist !== 'function') return;

    for (const playlist of playlistData) {
        let trackIndex = -1;

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

        if (trackIndex === -1 && (playlist.name === trackEntry.playlist || playlist.id === trackEntry.playlistId)) {
            trackIndex = playlist.tracks.findIndex(t =>
                t.title === trackEntry.title &&
                t.artist === trackEntry.artist
            );
        }

        if (trackIndex === -1) {
            trackIndex = playlist.tracks.findIndex(t =>
                t.title === trackEntry.title &&
                t.artist === trackEntry.artist
            );
        }

        if (trackIndex !== -1) {
            window.loadPlaylist(playlist);

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

            playTrack(trackIndex);
            break;
        }
    }
}

if (typeof window !== 'undefined') {
    window.initializeClustermap = initializeClustermap;
    window.renderClustermapPlot = renderClustermapPlot;
    window.startClustermapPulseLoop = startClustermapPulseLoop;
}
