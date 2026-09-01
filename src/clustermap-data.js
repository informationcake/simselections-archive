/**
 * clustermap-data.js
 * 
 * Data processing module for the SimSelections clustering map.
 * Responsible for parsing track metadata, standardizing canonical artist aliases,
 * computing submission frequencies for regularity layouts, and establishing
 * elastic collaboration graphs between tracks.
 */
import { playlistData } from './metadata.js';

let staticDataPrepared = false;
export let allTracks = [];
export let canonicalArtists = {};
export let artistList = [];
export let artistSubmissionCounts = {};
export let artistCollabDegrees = {};

export function getPrimaryArtists(artistStr) {
    if (!artistStr) return [];
    let normalized = artistStr
        .replace(/\b(feat\.?|ft\.?|and|with|vs\.?|versus)\b/gi, '|')
        .replace(/[&;\/\(\)\[\]]/g, '|');
    return normalized.split('|')
        .map(a => a.trim())
        .filter(a => a.length > 0);
}

export function prepareStaticData() {
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
                challenge: playlist.challenge,
                length: track.length || 0
            });
        });
    });

    playlistData.forEach(p => {
        (p.tracks || []).forEach(track => {
            // Find canonical representation of an artist
            const pa = getPrimaryArtists(track.artist);
            pa.forEach(a => {
                const lower = a.toLowerCase();
                if (!canonicalArtists[lower]) {
                    canonicalArtists[lower] = a;
                }
            });
        });
    });

    allTracks.forEach(track => {
        const pa = getPrimaryArtists(track.artist);
        pa.forEach(a => {
            const lower = a.toLowerCase();
            const canonical = canonicalArtists[lower];
            artistSubmissionCounts[canonical] = (artistSubmissionCounts[canonical] || 0) + 1;
        });
    });

    artistList = Array.from(new Set(Object.values(canonicalArtists)));

    // Compute collaboration degrees
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

    // Calculate dynamic metadata for tracks
    allTracks.forEach((track, i) => {
        track.id = i;
        track.primaryCanonicalArtists = getPrimaryArtists(track.artist).map(a => canonicalArtists[a.toLowerCase()]);
        track.submissionFrequency = track.primaryCanonicalArtists.reduce((max, a) => Math.max(max, artistSubmissionCounts[a] || 1), 1);

        // Initial random placement
        track.x = (Math.random() - 0.5) * 400;
        track.y = (Math.random() - 0.5) * 400;
    });

    staticDataPrepared = true;
}
