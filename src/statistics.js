import { playlistData } from './metadata.js';

let statsResizeObserver = null;
let lengthsResizeObserver = null;
let tooltipEl = null;

function getOrCreateTooltip() {
    if (!tooltipEl) {
        tooltipEl = document.getElementById('stats-d3-tooltip');
        if (!tooltipEl) {
            tooltipEl = document.createElement('div');
            tooltipEl.id = 'stats-d3-tooltip';
            tooltipEl.className = 'stats-d3-tooltip';
            document.body.appendChild(tooltipEl);
        }
    }
    return tooltipEl;
}

function showTooltip(html, event) {
    const tip = getOrCreateTooltip();
    tip.innerHTML = html;
    tip.style.display = 'block';
    const x = event.pageX + 12;
    const y = event.pageY - 28;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
}

function hideTooltip() {
    const tip = getOrCreateTooltip();
    tip.style.display = 'none';
}

function formatSeconds(secs) {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Renders the entire statistics dashboard using D3.js.
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
    if (chartContainer && typeof d3 !== 'undefined') {
        drawSubmissionsChart(chartContainer, orderedMonths);

        if (statsResizeObserver) statsResizeObserver.disconnect();
        statsResizeObserver = new ResizeObserver(() => {
            if (chartContainer.clientWidth > 0 && chartContainer.clientHeight > 0) {
                drawSubmissionsChart(chartContainer, orderedMonths);
            }
        });
        statsResizeObserver.observe(chartContainer);
    }

    const insight = busiestMonth ? `Busiest month: ${busiestMonth.name} with ${busiestMonth.tracks.length} submissions` : '';
    if (insight && chartContainer) {
        chartContainer.setAttribute('data-insight', insight);
    }

    const chartContainer2 = document.getElementById('stats-lengths-chart');
    if (chartContainer2 && typeof d3 !== 'undefined') {
        drawLengthsHistogram(chartContainer2, playlistData);

        if (lengthsResizeObserver) lengthsResizeObserver.disconnect();
        lengthsResizeObserver = new ResizeObserver(() => {
            if (chartContainer2.clientWidth > 0 && chartContainer2.clientHeight > 0) {
                drawLengthsHistogram(chartContainer2, playlistData);
            }
        });
        lengthsResizeObserver.observe(chartContainer2);
    }
}

/**
 * Draws the Monthly Submissions Bar Chart with D3.
 */
function drawSubmissionsChart(container, orderedMonths) {
    container.innerHTML = '';
    const rect = container.getBoundingClientRect();
    const width = Math.floor(rect.width) || container.clientWidth || 600;
    const height = Math.floor(rect.height) || container.clientHeight || 340;

    const margin = { top: 12, right: 12, bottom: 82, left: 38 };
    const innerWidth = Math.max(10, width - margin.left - margin.right);
    const innerHeight = Math.max(10, height - margin.top - margin.bottom);

    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#ec4899';
    const accentCyan = getComputedStyle(document.body).getPropertyValue('--accent-cyan').trim() || '#06b6d4';
    const accentPurple = getComputedStyle(document.body).getPropertyValue('--accent-purple').trim() || '#8b5cf6';
    const colors = [accentCyan, accent, accentPurple];

    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .style('display', 'block');

    const g = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleBand()
        .domain(orderedMonths.map(d => d.name))
        .range([0, innerWidth])
        .padding(0.25);

    const yMax = d3.max(orderedMonths, d => (d.tracks || []).length) || 10;
    const yScale = d3.scaleLinear()
        .domain([0, yMax])
        .nice()
        .range([innerHeight, 0]);

    // Gridlines
    g.append('g')
        .attr('class', 'grid-lines')
        .call(d3.axisLeft(yScale)
            .ticks(4)
            .tickSize(-innerWidth)
            .tickFormat('')
        )
        .selectAll('line')
        .style('stroke', 'rgba(255, 255, 255, 0.06)')
        .style('stroke-dasharray', '2,2');

    g.select('.grid-lines .domain').remove();

    // X Axis
    const xAxisG = g.append('g')
        .attr('transform', `translate(0,${innerHeight})`)
        .call(d3.axisBottom(xScale));

    xAxisG.select('.domain').style('stroke', 'rgba(255, 255, 255, 0.1)');
    xAxisG.selectAll('.tick line').style('stroke', 'rgba(255, 255, 255, 0.1)');
    xAxisG.selectAll('.tick text')
        .style('fill', 'rgba(248, 250, 252, 0.72)')
        .style('font-size', '9.5px')
        .style('font-family', 'inherit')
        .attr('transform', 'rotate(-55)')
        .style('text-anchor', 'end')
        .attr('dx', '-8px')
        .attr('dy', '2px');

    // Y Axis
    const yAxisG = g.append('g')
        .call(d3.axisLeft(yScale).ticks(4));

    yAxisG.select('.domain').remove();
    yAxisG.selectAll('.tick line').remove();
    yAxisG.selectAll('.tick text')
        .style('fill', 'rgba(248, 250, 252, 0.72)')
        .style('font-size', '10px')
        .style('font-family', 'inherit');

    // Bars
    g.selectAll('.bar')
        .data(orderedMonths)
        .enter()
        .append('rect')
        .attr('class', 'bar')
        .attr('x', d => xScale(d.name))
        .attr('y', d => yScale((d.tracks || []).length))
        .attr('width', xScale.bandwidth())
        .attr('height', d => innerHeight - yScale((d.tracks || []).length))
        .attr('rx', 3)
        .attr('ry', 3)
        .attr('fill', (_, i) => colors[i % colors.length])
        .style('cursor', 'pointer')
        .style('transition', 'opacity 0.2s ease, filter 0.2s ease')
        .on('mouseenter', function (event, d) {
            d3.select(this)
                .style('opacity', '0.85')
                .style('filter', 'brightness(1.2)');
            const count = (d.tracks || []).length;
            showTooltip(`<strong>${d.name}</strong><br>${count} submission${count === 1 ? '' : 's'}`, event);
        })
        .on('mousemove', function (event) {
            const tip = getOrCreateTooltip();
            tip.style.left = `${event.pageX + 12}px`;
            tip.style.top = `${event.pageY - 28}px`;
        })
        .on('mouseleave', function () {
            d3.select(this)
                .style('opacity', '1')
                .style('filter', 'none');
            hideTooltip();
        });
}

/**
 * Draws the Track Length Distribution Histogram with Mean & Median lines using D3.
 */
function drawLengthsHistogram(container, playlists) {
    container.innerHTML = '';
    const rect = container.getBoundingClientRect();
    const width = Math.floor(rect.width) || container.clientWidth || 600;
    const height = Math.floor(rect.height) || container.clientHeight || 340;

    const secondsList = [];
    playlists.forEach(playlist => {
        (playlist.tracks || []).forEach(track => {
            if (track.length && !isNaN(track.length) && track.length > 0) {
                secondsList.push(track.length);
            }
        });
    });

    if (secondsList.length === 0) {
        container.innerHTML = `<div class="empty-state" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);"><svg class="lucide lucide-info"><use href="#icon-info"></use></svg><p>No track lengths available</p></div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons({ root: container });
        return;
    }

    const margin = { top: 18, right: 12, bottom: 28, left: 36 };
    const innerWidth = Math.max(10, width - margin.left - margin.right);
    const innerHeight = Math.max(10, height - margin.top - margin.bottom);

    const meanSeconds = secondsList.reduce((sum, val) => sum + val, 0) / secondsList.length;
    const sortedSecs = [...secondsList].sort((a, b) => a - b);
    const midSecs = Math.floor(sortedSecs.length / 2);
    const medianSeconds = sortedSecs.length % 2 !== 0 ? sortedSecs[midSecs] : (sortedSecs[midSecs - 1] + sortedSecs[midSecs]) / 2;

    const binSize = 10;
    const maxSeconds = Math.max(...secondsList);
    const numBins = Math.ceil(maxSeconds / binSize);
    const binCounts = Array(numBins).fill(0);

    secondsList.forEach(s => {
        const idx = Math.floor(s / binSize);
        if (idx >= 0 && idx < numBins) binCounts[idx]++;
    });

    const bins = [];
    for (let i = 0; i < numBins; i++) {
        const start = i * binSize;
        const end = (i + 1) * binSize;
        bins.push({
            startMinutes: start / 60.0,
            endMinutes: end / 60.0,
            centerMinutes: (start + binSize / 2.0) / 60.0,
            rangeLabel: `${formatSeconds(start)} - ${formatSeconds(end)}`,
            count: binCounts[i]
        });
    }

    const accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#ec4899';
    const accentCyan = getComputedStyle(document.body).getPropertyValue('--accent-cyan').trim() || '#06b6d4';
    const accentPurple = getComputedStyle(document.body).getPropertyValue('--accent-purple').trim() || '#8b5cf6';

    const maxMinutes = Math.ceil(maxSeconds / 60);

    const svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .style('display', 'block');

    const g = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3.scaleLinear()
        .domain([0, maxMinutes])
        .range([0, innerWidth]);

    const yMax = d3.max(binCounts) || 5;
    const yScale = d3.scaleLinear()
        .domain([0, yMax])
        .nice()
        .range([innerHeight, 0]);

    // Gridlines
    g.append('g')
        .attr('class', 'grid-lines')
        .call(d3.axisLeft(yScale)
            .ticks(5)
            .tickSize(-innerWidth)
            .tickFormat('')
        )
        .selectAll('line')
        .style('stroke', 'rgba(255, 255, 255, 0.06)')
        .style('stroke-dasharray', '2,2');

    g.select('.grid-lines .domain').remove();

    // X Axis
    const xAxis = d3.axisBottom(xScale)
        .ticks(Math.min(maxMinutes, 12))
        .tickFormat(m => `${m}:00`);

    const xAxisG = g.append('g')
        .attr('transform', `translate(0,${innerHeight})`)
        .call(xAxis);

    xAxisG.select('.domain').style('stroke', 'rgba(255, 255, 255, 0.1)');
    xAxisG.selectAll('.tick line').style('stroke', 'rgba(255, 255, 255, 0.1)');
    xAxisG.selectAll('.tick text')
        .style('fill', 'rgba(248, 250, 252, 0.72)')
        .style('font-size', '10px')
        .style('font-family', 'inherit');

    // Y Axis
    const yAxisG = g.append('g')
        .call(d3.axisLeft(yScale).ticks(5));

    yAxisG.select('.domain').remove();
    yAxisG.selectAll('.tick line').remove();
    yAxisG.selectAll('.tick text')
        .style('fill', 'rgba(248, 250, 252, 0.72)')
        .style('font-size', '10px')
        .style('font-family', 'inherit');

    // Histogram Bars
    const barWidth = Math.max(1, (innerWidth / (maxMinutes * 60 / binSize)) - 1);

    g.selectAll('.hist-bar')
        .data(bins)
        .enter()
        .append('rect')
        .attr('class', 'hist-bar')
        .attr('x', d => xScale(d.startMinutes))
        .attr('y', d => yScale(d.count))
        .attr('width', barWidth)
        .attr('height', d => innerHeight - yScale(d.count))
        .attr('fill', accentPurple)
        .attr('rx', 1)
        .style('cursor', 'pointer')
        .style('transition', 'opacity 0.2s ease, fill 0.2s ease')
        .on('mouseenter', function (event, d) {
            d3.select(this)
                .style('fill', accentCyan)
                .style('opacity', '0.9');
            showTooltip(`<strong>Duration:</strong> ${d.rangeLabel}<br><strong>Tracks:</strong> ${d.count}`, event);
        })
        .on('mousemove', function (event) {
            const tip = getOrCreateTooltip();
            tip.style.left = `${event.pageX + 12}px`;
            tip.style.top = `${event.pageY - 28}px`;
        })
        .on('mouseleave', function () {
            d3.select(this)
                .style('fill', accentPurple)
                .style('opacity', '1');
            hideTooltip();
        });

    // Mean Line & Annotation
    const meanX = xScale(meanSeconds / 60.0);
    if (meanX >= 0 && meanX <= innerWidth) {
        g.append('line')
            .attr('x1', meanX)
            .attr('x2', meanX)
            .attr('y1', 0)
            .attr('y2', innerHeight)
            .attr('stroke', accent)
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '4,4');

        g.append('text')
            .attr('x', meanX - 6)
            .attr('y', -6)
            .attr('text-anchor', 'end')
            .attr('fill', accent)
            .style('font-size', '10px')
            .style('font-weight', '600')
            .style('font-family', 'inherit')
            .text(`Mean: ${formatSeconds(meanSeconds)}`);
    }

    // Median Line & Annotation
    const medianX = xScale(medianSeconds / 60.0);
    if (medianX >= 0 && medianX <= innerWidth) {
        g.append('line')
            .attr('x1', medianX)
            .attr('x2', medianX)
            .attr('y1', 0)
            .attr('y2', innerHeight)
            .attr('stroke', accentCyan)
            .attr('stroke-width', 1.5)
            .attr('stroke-dasharray', '2,2');

        g.append('text')
            .attr('x', medianX + 6)
            .attr('y', -6)
            .attr('text-anchor', 'start')
            .attr('fill', accentCyan)
            .style('font-size', '10px')
            .style('font-weight', '600')
            .style('font-family', 'inherit')
            .text(`Median: ${formatSeconds(medianSeconds)}`);
    }
}

// Expose renderStatsDashboard globally
if (typeof window !== 'undefined') {
    window.renderStatsDashboard = renderStatsDashboard;
}
