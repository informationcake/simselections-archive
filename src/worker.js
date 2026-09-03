// Base64URL helper for Web Crypto JWTs (UTF-8 safe)
function base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const binString = atob(str);
    const bytes = new Uint8Array(binString.length);
    for (let i = 0; i < binString.length; i++) {
        bytes[i] = binString.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

function base64UrlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let binString = '';
    for (let i = 0; i < bytes.length; i++) {
        binString += String.fromCharCode(bytes[i]);
    }
    return btoa(binString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function cleanString(s) {
    if (!s) return '';
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function signToken(payload, secret) {
    const enc = new TextEncoder();
    const payloadB64 = base64UrlEncode(JSON.stringify(payload));
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
    const signatureHex = Array.from(new Uint8Array(signatureBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    return `${payloadB64}.${signatureHex}`;
}

async function verifyToken(token, secret) {
    if (!token || !token.includes('.')) return null;
    try {
        const [payloadB64, signature] = token.split('.');
        const enc = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            enc.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

        // Convert hex signature back to bytes
        const sigBytes = new Uint8Array(signature.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
        const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payloadB64));
        if (!isValid) return null;

        const payloadJson = base64UrlDecode(payloadB64);
        const data = JSON.parse(payloadJson);
        if (data.exp && Date.now() / 1000 > data.exp) return null;
        return data;
    } catch (e) {
        return null;
    }
}

function getSessionFromCookie(request, secret) {
    const cookieHeader = request.headers.get('Cookie') || '';
    const cookies = cookieHeader.split(';').map(c => c.trim());
    for (const c of cookies) {
        if (c.startsWith('sim_session=')) {
            const token = c.substring('sim_session='.length);
            return verifyToken(token, secret);
        }
    }
    return null;
}

/**
 * Loads dynamic opt-in map from KV or fallback R2 storage.
 */
async function loadDynamicOptins(env) {
    if (env.OPTIN_KV) {
        try {
            const val = await env.OPTIN_KV.get("dynamic_optin_state", "json");
            if (val) return val;
        } catch (e) {}
    }
    if (env.MUSIC_BUCKET) {
        try {
            const obj = await env.MUSIC_BUCKET.get("dynamic_optin.json");
            if (obj) {
                return await obj.json();
            }
        } catch (e) {}
    }
    return {};
}

/**
 * Saves dynamic opt-in map to KV and/or R2 storage.
 */
async function saveDynamicOptins(env, optins) {
    const payload = JSON.stringify(optins, null, 2);
    if (env.OPTIN_KV) {
        try {
            await env.OPTIN_KV.put("dynamic_optin_state", payload);
        } catch (e) {}
    }
    if (env.MUSIC_BUCKET) {
        try {
            await env.MUSIC_BUCKET.put("dynamic_optin.json", payload, {
                httpMetadata: { contentType: "application/json" }
            });
        } catch (e) {}
    }
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = decodeURIComponent(url.pathname.slice(1));
        const jwtSecret = env.JWT_SECRET || "simselections_local_dev_secret_key_2026";
        
        // ─── API: OAuth Discord Redirect ───
        if (url.pathname === '/api/auth/discord') {
            const clientId = env.DISCORD_CLIENT_ID;
            const redirectUri = env.DISCORD_REDIRECT_URI || `${url.origin}/api/auth/callback`;
            if (!clientId) {
                return new Response("Discord OAuth not configured on Worker.", { status: 500 });
            }
            const scope = env.DISCORD_GUILD_ID ? "identify%20guilds" : "identify";
            const discordUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&response_type=code&scope=${scope}&redirect_uri=${encodeURIComponent(redirectUri)}`;
            return Response.redirect(discordUrl, 302);
        }

        // ─── API: OAuth Discord Callback ───
        if (url.pathname === '/api/auth/callback') {
            const code = url.searchParams.get('code');
            if (!code) return new Response("Missing code parameter.", { status: 400 });

            try {
                const clientId = env.DISCORD_CLIENT_ID;
                const clientSecret = env.DISCORD_CLIENT_SECRET;
                const redirectUri = env.DISCORD_REDIRECT_URI || `${url.origin}/api/auth/callback`;

                const tokenResp = await fetch("https://discord.com/api/v10/oauth2/token", {
                    method: "POST",
                    headers: { "Content-Type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        client_id: clientId,
                        client_secret: clientSecret,
                        grant_type: "authorization_code",
                        code,
                        redirect_uri: redirectUri
                    })
                });

                if (!tokenResp.ok) throw new Error("Failed to exchange token with Discord.");
                const tokenData = await tokenResp.json();

                // Verify Discord Server / Guild membership if DISCORD_GUILD_ID is configured
                if (env.DISCORD_GUILD_ID && env.DISCORD_GUILD_ID.trim()) {
                    const targetGuild = env.DISCORD_GUILD_ID.trim();
                    const guildsResp = await fetch("https://discord.com/api/v10/users/@me/guilds", {
                        headers: { Authorization: `Bearer ${tokenData.access_token}` }
                    });
                    if (guildsResp.ok) {
                        const guilds = await guildsResp.json();
                        const isInGuild = Array.isArray(guilds) && guilds.some(g => String(g.id) === targetGuild);
                        if (!isInGuild) {
                            return Response.redirect(`${url.origin}/index.html?auth_error=guild_required`, 302);
                        }
                    } else {
                        return Response.redirect(`${url.origin}/index.html?auth_error=guild_required`, 302);
                    }
                }

                const userResp = await fetch("https://discord.com/api/v10/users/@me", {
                    headers: { Authorization: `Bearer ${tokenData.access_token}` }
                });
                if (!userResp.ok) throw new Error("Failed to fetch user profile from Discord.");
                const user = await userResp.json();

                // Fetch artist mapping to resolve user's linked artists
                let linkedArtists = [];
                try {
                    let mapData = null;
                    if (env.ASSETS) {
                        try {
                            const assetResp = await env.ASSETS.fetch(new Request(new URL('/data/artist_discord_map.json', request.url)));
                            if (assetResp.ok) mapData = await assetResp.json();
                        } catch (e) {}
                    }
                    if (!mapData && env.MUSIC_BUCKET) {
                        try {
                            const mapObj = await env.MUSIC_BUCKET.get("artist_discord_map.json");
                            if (mapObj) mapData = await mapObj.json();
                        } catch (e) {}
                    }
                    if (mapData) {
                        const cUser = cleanString(user.username);
                        const handleLookup = mapData.handle_lookup || {};
                        const artists = mapData.artists || {};
                        const linked = new Set();
                        if (handleLookup[cUser]) {
                            for (const a of handleLookup[cUser]) linked.add(a);
                        }
                        for (const [artName, info] of Object.entries(artists)) {
                            if (info.discord_ids && info.discord_ids.includes(user.id)) linked.add(artName);
                            if (info.handles && info.handles.some(h => cleanString(h) === cUser)) linked.add(artName);
                        }
                        linkedArtists = Array.from(linked);
                    }
                } catch (e) {}

                const avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : "https://cdn.discordapp.com/embed/avatars/0.png";

                // Check optional testing allowlist
                let testersCfg = env.DISCORD_TESTERS;
                if (testersCfg === "undefined" || testersCfg === "null" || testersCfg === "false") {
                    testersCfg = "";
                } else {
                    testersCfg = testersCfg || "";
                }
                
                let isTester = true;
                if (testersCfg.trim()) {
                    const parts = testersCfg.split(',').map(s => s.trim()).filter(Boolean);
                    const allowedNames = new Set(parts.map(p => cleanString(p)));
                    const allowedIds = new Set(parts.filter(p => /^\d+$/.test(p)));
                    isTester = allowedIds.has(user.id) || allowedNames.has(cleanString(user.username));
                }

                const role = isTester ? "discord_user" : "view_only";
                const canPlay = isTester;

                const sessionPayload = {
                    sub: user.id,
                    username: user.username,
                    global_name: user.global_name || user.username,
                    avatar_url: avatarUrl,
                    role: role,
                    canPlay: canPlay,
                    linked_artists: linkedArtists,
                    exp: Math.floor(Date.now() / 1000) + (30 * 86400)
                };

                const sessionToken = await signToken(sessionPayload, jwtSecret);
                const cookie = `sim_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;

                const redirectLocation = isTester ? '/index.html?auth=success' : '/index.html?auth_notice=beta_restricted';

                return new Response(null, {
                    status: 302,
                    headers: {
                        'Location': redirectLocation,
                        'Set-Cookie': cookie
                    }
                });
            } catch (e) {
                return new Response(`Authentication Error: ${e.message}`, { status: 500 });
            }
        }

        // ─── API: Basic View-Only Login ───
        if (url.pathname === '/api/auth/login-basic' && request.method === 'POST') {
            const sessionPayload = {
                sub: "viewer",
                username: "viewer",
                role: "view_only",
                canPlay: false,
                exp: Math.floor(Date.now() / 1000) + (30 * 86400)
            };
            const sessionToken = await signToken(sessionPayload, jwtSecret);
            const cookie = `sim_session=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`;
            return new Response(JSON.stringify({ status: "ok", role: "view_only" }), {
                headers: {
                    'Content-Type': 'application/json',
                    'Set-Cookie': cookie
                }
            });
        }

        // ─── API: Current User Profile ───
        if (url.pathname === '/api/me') {
            const session = await getSessionFromCookie(request, jwtSecret);
            if (!session) {
                return Response.json({ authenticated: false, role: "guest", canPlayAudio: false });
            }
            return Response.json({
                authenticated: true,
                role: session.role || "guest",
                canPlayAudio: (session.role === "discord_user"),
                user: {
                    id: session.sub,
                    username: session.username,
                    global_name: session.global_name || session.username,
                    avatar_url: session.avatar_url || ""
                },
                linked_artists: session.linked_artists || []
            });
        }

        // ─── API: Get Opt-In State ───
        if (url.pathname === '/api/optin/state') {
            const state = await loadDynamicOptins(env);
            return Response.json(state);
        }

        // ─── API: Batch Update Opt-Ins ───
        if (url.pathname === '/api/optin/batch' && request.method === 'POST') {
            const session = await getSessionFromCookie(request, jwtSecret);
            if (!session || session.role !== 'discord_user') {
                return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { 'Content-Type': 'application/json' } });
            }

            const body = await request.json();
            const items = body.items || [];
            const dynamicMap = await loadDynamicOptins(env);

            for (const it of items) {
                const trackKey = it.trackKey || it.file;
                const optIn = Boolean(it.optIn);
                if (trackKey) {
                    dynamicMap[trackKey] = optIn;
                }
            }

            await saveDynamicOptins(env, dynamicMap);
            return Response.json({ status: "ok", updatedCount: items.length });
        }

        // ─── API: Single Update Opt-In ───
        if (url.pathname === '/api/optin' && request.method === 'POST') {
            const session = await getSessionFromCookie(request, jwtSecret);
            if (!session || session.role !== 'discord_user') {
                return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { 'Content-Type': 'application/json' } });
            }

            const body = await request.json();
            const trackKey = body.trackKey || body.file;
            const artist = body.artist;
            const optIn = Boolean(body.optIn);

            const dynamicMap = await loadDynamicOptins(env);
            if (trackKey) {
                dynamicMap[trackKey] = optIn;
            }

            await saveDynamicOptins(env, dynamicMap);
            return Response.json({ status: "ok", trackKey, artist, optIn });
        }

        // ─── API: Logout ───
        if (url.pathname === '/api/auth/logout') {
            return new Response(null, {
                status: 302,
                headers: {
                    'Location': '/index.html',
                    'Set-Cookie': 'sim_session=; Path=/; HttpOnly; Max-Age=0'
                }
            });
        }

        // ─── Audio & Video Streaming (Year Folders: e.g. /2024/...) ───
        const firstSegment = path.split('/')[0];
        const isYear = /^\d{4}$/.test(firstSegment);
        
        if (isYear) {
            // 1. Enforce Discord Authentication Gate
            const session = await getSessionFromCookie(request, jwtSecret);
            if (!session || session.role !== 'discord_user') {
                return new Response(JSON.stringify({
                    error: "discord_auth_required",
                    message: "Audio playback is strictly restricted to users logged in with Discord."
                }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // 2. Enforce Dynamic Opt-In Security Check (Default Opt-Out)
            const dynamicMap = await loadDynamicOptins(env);
            const isOptedIn = Boolean(dynamicMap[path]);

            if (!isOptedIn) {
                return new Response(JSON.stringify({
                    error: "track_opted_out",
                    message: "Forbidden: This track is not opted in for playback."
                }), { 
                    status: 403,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // 3. Fetch from R2 bucket
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
        
        // Serve static assets for anything else (index.html, src/, data/, etc.)
        return env.ASSETS.fetch(request);
    }
};
