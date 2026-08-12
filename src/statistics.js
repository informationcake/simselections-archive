import { playlistData } from './metadata.js';

let globalChartResizeObserver = null;
let globalLengthsResizeObserver = null;

/**
 * Renders the statistics dashboard chart and metrics by aggregating track data across all playlists.
 * Initializes a Plotly bar chart and sets up a ResizeObserver for responsiveness.
 */
export function renderStatsDashboard() {
    const statsView = document.getElementById('stats-view-container');
    if (!statsView || typeof playlistData === 'undefined' || !Array.isArray(playlistData)) return;

    const orderedMonths = [...playlistData].sort((a, b) => {
        const yearDiff = Number(a.year) - Number(b.year);
        if (yearDiff !== 0) return yearDiff;
        const monthOrder = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
        return monthOrder.indexOf(String(a.month || '').toUpperCase()) - monthOrder.indexOf(String(b.month || '').toUpperCase());
    });

    const totalSubmissions = orderedMonths.reduce((sum, playlist) => sum + (playlist.tracks || []).length, 0);
    const linkedCount = orderedMonths.reduce((sum, playlist) => sum + (playlist.tracks || []).filter(track => track.link && track.link.trim()).length, 0);
    const busiestMonth = orderedMonths.reduce((best, playlist) => {
        if (!best || (playlist.tracks || []).length > (best.tracks || []).length) return playlist;
        return best;
    }, null);

    const statsMonthCount = document.getElementById('stats-month-count');
    const statsSubmissionCount = document.getElementById('stats-submission-count');
    const statsLinkedCount = document.getElementById('stats-linked-count');
    if (statsMonthCount) statsMonthCount.textContent = orderedMonths.length;
    if (statsSubmissionCount) statsSubmissionCount.textContent = totalSubmissions;
    if (statsLinkedCount) statsLinkedCount.textContent = linkedCount;

    const chartContainer = document.getElementById('stats-chart');
    if (chartContainer && typeof Plotly !== 'undefined') {
        const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#ec4899';
        const accentCyan = getComputedStyle(document.body).getPropertyValue('--accent-cyan').trim() || '#06b6d4';
        const accentPurple = getComputedStyle(document.body).getPropertyValue('--accent-purple').trim() || '#8b5cf6';
        const trace = {
            type: 'bar',
            x: orderedMonths.map(playlist => playlist.name),
            y: orderedMonths.map(playlist => (playlist.tracks || []).length),
            marker: { color: orderedMonths.map((_, index) => index % 3 === 0 ? accentCyan : index % 3 === 1 ? accent : accentPurple) },
            hovertemplate: '%{x}<br>%{y} submissions<extra></extra>',
            hoverinfo: 'none'
        };

        Plotly.newPlot(chartContainer, [trace], {
            margin: { t: 12, r: 18, b: 70, l: 38 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            autosize: true,
            dragmode: false,
            hovermode: true,
            xaxis: {
                showgrid: false,
                zeroline: false,
                tickfont: { size: 10, color: 'rgba(248,250,252,0.72)' },
                title: '',
                automargin: true
            },
            yaxis: {
                showgrid: true,
                gridcolor: 'rgba(255,255,255,0.08)',
                zeroline: false,
                rangemode: 'tozero',
                tickfont: { color: 'rgba(248,250,252,0.72)' }
            },
            showlegend: false
        }, {
            responsive: false,
            displayModeBar: false
        });

        // Clean up any existing observer
        if (globalChartResizeObserver) {
            globalChartResizeObserver.disconnect();
        }

        // Track both width and height to trigger resizes on horizontal and vertical adjustments
        let lastWidth = chartContainer.clientWidth;
        let lastHeight = chartContainer.clientHeight;

        globalChartResizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            const currentWidth = entry.contentRect.width;
            const currentHeight = entry.contentRect.height;

            // Trigger if width or height changes by more than 2 pixels
            if (Math.abs(currentWidth - lastWidth) > 2 || Math.abs(currentHeight - lastHeight) > 2) {
                lastWidth = currentWidth;
                lastHeight = currentHeight;

                window.requestAnimationFrame(() => {
                    if (chartContainer && chartContainer.clientHeight > 0 && chartContainer.clientWidth > 0) {
                        Plotly.Plots.resize(chartContainer);
                    }
                });
            }
        });

        // Start observing
        globalChartResizeObserver.observe(chartContainer);
    }

    const insight = busiestMonth ? `Busiest month: ${busiestMonth.name} with ${busiestMonth.tracks.length} submissions` : '';
    if (insight && chartContainer) {
        chartContainer.setAttribute('data-insight', insight);
    }

    const chartContainer2 = document.getElementById('stats-lengths-chart');
    if (chartContainer2 && typeof Plotly !== 'undefined') {
        const accentPurple = getComputedStyle(document.body).getPropertyValue('--accent-purple').trim() || '#8b5cf6';

        // Extract track length directly from in-memory playlistData
        const secondsList = [];
        playlistData.forEach(playlist => {
            (playlist.tracks || []).forEach(track => {
                if (track.length && !isNaN(track.length) && track.length > 0) {
                    secondsList.push(track.length);
                }
            });
        });

        if (secondsList.length === 0) {
            chartContainer2.innerHTML = `<div class="empty-state" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);"><i data-lucide="info" style="margin-bottom:8px;width:24px;height:24px;"></i><p>No track lengths available</p></div>`;
            if (typeof lucide !== 'undefined') lucide.createIcons({ root: chartContainer2 });
            return;
        }

        // Calculate mean and median in seconds
        const meanSeconds = secondsList.reduce((sum, val) => sum + val, 0) / secondsList.length;
        const sortedSecs = [...secondsList].sort((a, b) => a - b);
        const midSecs = Math.floor(sortedSecs.length / 2);
        const medianSeconds = sortedSecs.length % 2 !== 0 ? sortedSecs[midSecs] : (sortedSecs[midSecs - 1] + sortedSecs[midSecs]) / 2;

        // Format helper function to convert raw seconds to M:SS
        function formatSeconds(secs) {
            const m = Math.floor(secs / 60);
            const s = Math.floor(secs % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        }

        // Pre-bin the data for a custom bar chart (10 second bins)
        const maxSeconds = Math.max(...secondsList);
        const binSize = 10; // 10 seconds
        const numBins = Math.ceil(maxSeconds / binSize);
        const binCounts = Array(numBins).fill(0);

        secondsList.forEach(s => {
            const idx = Math.floor(s / binSize);
            if (idx >= 0 && idx < numBins) {
                binCounts[idx]++;
            }
        });

        const binCenters = [];
        const hoverTexts = [];
        for (let i = 0; i < numBins; i++) {
            const start = i * binSize;
            const end = (i + 1) * binSize;
            binCenters.push((start + binSize / 2.0) / 60.0); // in minutes (bin center)
            hoverTexts.push(`${formatSeconds(start)} - ${formatSeconds(end)}`);
        }

        const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#ec4899';
        const accentCyan = getComputedStyle(document.body).getPropertyValue('--accent-cyan').trim() || '#06b6d4';

        // Position shapes and annotations linearly in minutes
        const mean = meanSeconds / 60.0;
        const median = medianSeconds / 60.0;

        const shapes = [
            {
                type: 'line',
                x0: mean,
                y0: 0,
                x1: mean,
                y1: 1,
                yref: 'paper',
                line: {
                    color: accent,
                    width: 1.5,
                    dash: 'dash'
                }
            },
            {
                type: 'line',
                x0: median,
                y0: 0,
                x1: median,
                y1: 1,
                yref: 'paper',
                line: {
                    color: accentCyan,
                    width: 1.5,
                    dash: 'dot'
                }
            }
        ];

        const annotations = [
            {
                x: mean,
                y: 0.15,
                yref: 'paper',
                text: `Mean: ${formatSeconds(meanSeconds)}`,
                showarrow: false,
                xanchor: 'right',
                yanchor: 'top',
                font: {
                    size: 10,
                    color: accent
                },
                bgcolor: 'rgba(3, 2, 6, 0.85)',
                bordercolor: 'rgba(255,255,255,0.08)',
                borderwidth: 1,
                borderpad: 4
            },
            {
                x: median,
                y: 0.30,
                yref: 'paper',
                text: `Median: ${formatSeconds(medianSeconds)}`,
                showarrow: false,
                xanchor: 'left',
                yanchor: 'top',
                font: {
                    size: 10,
                    color: accentCyan
                },
                bgcolor: 'rgba(3, 2, 6, 0.85)',
                bordercolor: 'rgba(255,255,255,0.08)',
                borderwidth: 1,
                borderpad: 4
            }
        ];

        const trace2 = {
            type: 'bar',
            x: binCenters, // Use numerical x-axis
            y: binCounts,
            hovertext: hoverTexts,
            textposition: 'none',
            marker: {
                color: accentPurple,
                line: {
                    color: 'rgba(255, 255, 255, 0.08)',
                    width: 1
                }
            },
            hovertemplate: 'Duration: %{hovertext}<br>Tracks: %{y}<extra></extra>'
        };

        const maxMinutes = Math.ceil(maxSeconds / 60);
        const tickvals = [];
        const ticktext = [];
        for (let m = 0; m <= maxMinutes; m++) {
            tickvals.push(m);
            ticktext.push(`${m}:00`);
        }

        Plotly.newPlot(chartContainer2, [trace2], {
            margin: { t: 12, r: 18, b: 50, l: 38 },
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            autosize: true,
            dragmode: false,
            hovermode: true,
            bargap: 0.05,
            shapes: shapes,
            annotations: annotations,
            xaxis: {
                type: 'linear',
                showgrid: false,
                zeroline: false,
                tickvals: tickvals,
                ticktext: ticktext,
                range: [0, maxMinutes],
                tickfont: { size: 10, color: 'rgba(248,250,252,0.72)' },
                title: { text: 'Duration', font: { size: 11, color: 'rgba(248,250,252,0.72)' } },
                automargin: true
            },
            yaxis: {
                showgrid: true,
                gridcolor: 'rgba(255,255,255,0.08)',
                zeroline: false,
                rangemode: 'tozero',
                tickfont: { color: 'rgba(248,250,252,0.72)' }
            },
            showlegend: false
        }, {
            responsive: false,
            displayModeBar: false
        });

        // Set up ResizeObserver for the histogram
        if (globalLengthsResizeObserver) {
            globalLengthsResizeObserver.disconnect();
        }

        let lastWidth = chartContainer2.clientWidth;
        let lastHeight = chartContainer2.clientHeight;

        globalLengthsResizeObserver = new ResizeObserver((entries) => {
            const entry = entries[0];
            const currentWidth = entry.contentRect.width;
            const currentHeight = entry.contentRect.height;

            if (Math.abs(currentWidth - lastWidth) > 2 || Math.abs(currentHeight - lastHeight) > 2) {
                lastWidth = currentWidth;
                lastHeight = currentHeight;

                window.requestAnimationFrame(() => {
                    if (chartContainer2 && chartContainer2.clientHeight > 0 && chartContainer2.clientWidth > 0) {
                        Plotly.Plots.resize(chartContainer2);
                    }
                });
            }
        });

        globalLengthsResizeObserver.observe(chartContainer2);
    }
}

// Expose renderStatsDashboard globally
if (typeof window !== 'undefined') {
    window.renderStatsDashboard = renderStatsDashboard;
}
