import { playlistData } from './metadata.js';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = decodeURIComponent(url.pathname.slice(1));
        
        // Check if the request is targeting an audio folder (starts with a 4-digit year)
        const firstSegment = path.split('/')[0];
        const isYear = /^\d{4}$/.test(firstSegment);
        
        if (isYear) {
            // 1. Enforce opt-in security check
            let isAllowed = false;
            for (const playlist of playlistData) {
                for (const track of playlist.tracks || []) {
                    if (track.file && track.file.toLowerCase() === path.toLowerCase()) {
                        if (track.optIn) {
                            isAllowed = true;
                            break;
                        }
                    }
                }
                if (isAllowed) break;
            }

            if (!isAllowed) {
                return new Response("Forbidden: This track is not opted in for playback.", { 
                    status: 403 
                });
            }

            // 2. Fetch from R2 if allowed
            if (!env.MUSIC_BUCKET) {
                return new Response("Cloudflare R2 Bucket 'MUSIC_BUCKET' binding is missing.", { status: 500 });
            }
            
            const object = await env.MUSIC_BUCKET.get(path);
            if (!object) {
                return new Response(`File not found in R2: ${path}`, { status: 404 });
            }
            
            const headers = new Headers();
            object.writeHttpMetadata(headers);
            headers.set("Accept-Ranges", "bytes");
            headers.set("Access-Control-Allow-Origin", "*");
            headers.set("Cache-Control", "public, max-age=2592000"); // Cache at edge for 30 days
            
            return new Response(object.body, {
                headers,
                status: 200
            });
        }
        
        // Serve static assets for anything else (index.html, src/, etc.)
        return env.ASSETS.fetch(request);
    }
};
