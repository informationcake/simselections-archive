#!/usr/bin/env python3
"""
start_server.py

This script runs a local HTTP development server for testing the web player interface.
It securely serves the static frontend assets while providing mock endpoints for authentication
and Cloudflare worker features so the frontend can be tested locally without needing wrangler.
"""
import os
import re
import urllib.parse
import errno
import argparse
import sys
import json
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# Import local auth helpers
try:
    from auth import (
        DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI, DISCORD_GUILD_ID,
        sign_payload, verify_token, clean_string,
        get_linked_artists_for_user, exchange_discord_code,
        load_dynamic_optins, save_dynamic_optins, update_dynamic_optins_batch,
        is_tester_allowed
    )
except ImportError:
    from scripts.auth import (
        DISCORD_CLIENT_ID, DISCORD_REDIRECT_URI, DISCORD_GUILD_ID,
        sign_payload, verify_token, clean_string,
        get_linked_artists_for_user, exchange_discord_code,
        load_dynamic_optins, save_dynamic_optins, update_dynamic_optins_batch,
        is_tester_allowed
    )

PORT = 8086
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MUSIC_DIR = os.environ.get("music-file-path", "")

class RangeHTTPRequestHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        """
        Injects CORS and Accept-Ranges headers before closing the HTTP headers block.
        """
        # Enable CORS and Range Support headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Credentials', 'true')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def log_message(self, format, *args):
        """
        Suppresses standard HTTP logging to prevent console spam.
        """
        return

    def handle(self):
        """
        Wrapper around standard handler to gracefully catch and suppress broken pipe errors.
        """
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            if getattr(exc, 'errno', None) in {errno.EPIPE, errno.ECONNRESET, errno.EBADF}:
                self.close_connection = True
                return
            raise

    def handle_one_request(self):
        """
        Wrapper around request handler to gracefully catch client disconnect errors.
        """
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            if getattr(exc, 'errno', None) in {errno.EPIPE, errno.ECONNRESET, errno.EBADF}:
                self.close_connection = True
                return
            raise

    def _safe_write(self, data):
        """
        Safely writes data to the client stream and handles potential connection resets.
        """
        try:
            self.wfile.write(data)
            return True
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            if getattr(exc, 'errno', None) in {errno.EPIPE, errno.ECONNRESET, errno.EBADF}:
                self.close_connection = True
                return False
            raise

    def get_session(self):
        """
        Parses and verifies sim_session cookie from request headers.
        """
        cookie_header = self.headers.get('Cookie', '')
        if not cookie_header:
            return None
        cookies = [c.strip() for c in cookie_header.split(';')]
        for c in cookies:
            if c.startswith('sim_session='):
                token = c.split('=', 1)[1]
                return verify_token(token)
        return None

    def send_json(self, status_code, data_dict, set_cookie=None):
        """
        Utility to send JSON response with optional Set-Cookie header.
        """
        payload = json.dumps(data_dict).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        if set_cookie:
            self.send_header('Set-Cookie', set_cookie)
        self.end_headers()
        self._safe_write(payload)

    def do_POST(self):
        """
        Handles incoming POST requests (login, opt-in preferences).
        """
        try:
            parsed_url = urllib.parse.urlparse(self.path)
            url_path = parsed_url.path

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length).decode('utf-8') if content_length > 0 else "{}"
            try:
                post_data = json.loads(body)
            except Exception:
                post_data = {}

            # ─── API: View-Only Basic Login ───
            if url_path == '/api/auth/login-basic':
                session_payload = {
                    "sub": "viewer",
                    "username": "viewer",
                    "role": "view_only",
                    "canPlay": False,
                    "exp": time.time() + (30 * 86400)
                }
                token = sign_payload(session_payload)
                cookie = f"sim_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
                self.send_json(200, {
                    "status": "ok",
                    "role": "view_only",
                    "message": "Logged in with view-only permissions (Playback disabled)."
                }, set_cookie=cookie)
                return

            # ─── API: Batch Update Track Opt-In ───
            if url_path == '/api/optin/batch':
                session = self.get_session()
                if not session or session.get("role") != "discord_user":
                    self.send_json(401, {"error": "unauthorized", "message": "You must be logged in with Discord to manage track playback."})
                    return

                username = session.get("username", "")
                discord_id = session.get("sub", "")
                linked_artists = get_linked_artists_for_user(username, discord_id)

                items = post_data.get("items", [])
                authorized_items = []
                for it in items:
                    art_name = it.get("artist", "")
                    c_art = clean_string(art_name)
                    if any(clean_string(a) == c_art for a in linked_artists) or not linked_artists:
                        authorized_items.append(it)

                update_dynamic_optins_batch(authorized_items)
                self.send_json(200, {
                    "status": "ok",
                    "updatedCount": len(authorized_items)
                })
                return

            # ─── API: Update Track Opt-In (Single) ───
            if url_path == '/api/optin':
                session = self.get_session()
                if not session or session.get("role") != "discord_user":
                    self.send_json(401, {"error": "unauthorized", "message": "You must be logged in with Discord to manage track playback."})
                    return

                username = session.get("username", "")
                discord_id = session.get("sub", "")
                linked_artists = get_linked_artists_for_user(username, discord_id)

                track_key = post_data.get("trackKey") or post_data.get("file")
                artist_name = post_data.get("artist", "")
                opt_in = bool(post_data.get("optIn", True))

                # Validate artist ownership (allow if artist is in linked_artists)
                c_artist = clean_string(artist_name)
                is_authorized = any(clean_string(a) == c_artist for a in linked_artists)

                if not is_authorized and linked_artists:
                    self.send_json(403, {"error": "forbidden", "message": f"You do not have permission to manage tracks for '{artist_name}'."})
                    return

                update_dynamic_optins_batch([{
                    "trackKey": track_key,
                    "artist": artist_name,
                    "optIn": opt_in
                }])

                self.send_json(200, {
                    "status": "ok",
                    "trackKey": track_key,
                    "artist": artist_name,
                    "optIn": opt_in
                })
                return

            self.send_response(404)
            self.end_headers()
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            if getattr(exc, 'errno', None) in {errno.EPIPE, errno.ECONNRESET, errno.EBADF}:
                self.close_connection = True
                return
            raise

    def do_GET(self):
        """
        Handles incoming GET requests. Supports full file delivery and HTTP 206 Partial Content 
        for media streaming and scrubbing, as well as authentication and session APIs.
        """
        try:
            # Parse URL to separate path from query parameters
            parsed_url = urllib.parse.urlparse(self.path)
            url_path = urllib.parse.unquote(parsed_url.path)
            query_params = urllib.parse.parse_qs(parsed_url.query)

            # ─── API: OAuth Discord Login Redirect ───
            if url_path == '/api/auth/discord':
                if not DISCORD_CLIENT_ID:
                    self.send_response(500)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.end_headers()
                    self._safe_write(b"<h1>Discord OAuth Not Configured</h1><p>Please set DISCORD_CLIENT_ID in your .env file.</p>")
                    return

                scope = "identify%20guilds" if DISCORD_GUILD_ID else "identify"
                discord_oauth_url = (
                    f"https://discord.com/oauth2/authorize?client_id={DISCORD_CLIENT_ID}"
                    f"&response_type=code&scope={scope}"
                    f"&redirect_uri={urllib.parse.quote(DISCORD_REDIRECT_URI)}"
                )
                self.send_response(302)
                self.send_header('Location', discord_oauth_url)
                self.end_headers()
                return

            # ─── API: OAuth Discord Callback ───
            if url_path == '/api/auth/callback':
                code = query_params.get('code', [''])[0]
                if not code:
                    self.send_response(400)
                    self.end_headers()
                    self._safe_write(b"Missing authorization code from Discord.")
                    return

                try:
                    user_profile = exchange_discord_code(code)
                    discord_id = user_profile.get("id", "")
                    username = user_profile.get("username", "")
                    global_name = user_profile.get("global_name", "") or username
                    avatar = user_profile.get("avatar", "")
                    avatar_url = f"https://cdn.discordapp.com/avatars/{discord_id}/{avatar}.png" if avatar else "https://cdn.discordapp.com/embed/avatars/0.png"

                    # Check optional testing allowlist
                    is_tester = is_tester_allowed(username, discord_id)
                    role = "discord_user" if is_tester else "view_only"
                    can_play = is_tester

                    session_payload = {
                        "sub": discord_id,
                        "username": username,
                        "global_name": global_name,
                        "avatar_url": avatar_url,
                        "role": role,
                        "canPlay": can_play,
                        "exp": time.time() + (30 * 86400)
                    }
                    token = sign_payload(session_payload)
                    cookie = f"sim_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"

                    redirect_url = '/index.html?auth=success' if is_tester else '/index.html?auth_notice=beta_restricted'
                    self.send_response(302)
                    self.send_header('Set-Cookie', cookie)
                    self.send_header('Location', redirect_url)
                    self.end_headers()
                    return
                except PermissionError:
                    self.send_response(302)
                    self.send_header('Location', '/index.html?auth_error=guild_required')
                    self.end_headers()
                    return
                except Exception as e:
                    self.send_response(500)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.end_headers()
                    self._safe_write(f"<h1>Discord Login Failed</h1><p>{e}</p><p><a href='/'>Return to player</a></p>".encode('utf-8'))
                    return

            # ─── API: Dev Quick-Login Helper ───
            if url_path == '/api/auth/dev-login':
                dev_user = query_params.get('user', ['dev_artist'])[0]
                is_tester = is_tester_allowed(dev_user, "")
                role = "discord_user" if is_tester else "view_only"
                can_play = is_tester

                session_payload = {
                    "sub": f"dev_{clean_string(dev_user)}",
                    "username": dev_user,
                    "global_name": dev_user,
                    "avatar_url": "https://cdn.discordapp.com/embed/avatars/1.png",
                    "role": role,
                    "canPlay": can_play,
                    "exp": time.time() + (30 * 86400)
                }
                token = sign_payload(session_payload)
                cookie = f"sim_session={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
                redirect_url = '/index.html?auth=dev_success' if is_tester else '/index.html?auth_notice=beta_restricted'
                self.send_response(302)
                self.send_header('Set-Cookie', cookie)
                self.send_header('Location', redirect_url)
                self.end_headers()
                return

            # ─── API: Logout ───
            if url_path == '/api/auth/logout':
                cookie = "sim_session=; Path=/; HttpOnly; Max-Age=0"
                self.send_response(302)
                self.send_header('Set-Cookie', cookie)
                self.send_header('Location', '/index.html')
                self.end_headers()
                return

            # ─── API: Current User Profile (/api/me) ───
            if url_path == '/api/me':
                session = self.get_session()
                if not session:
                    self.send_json(200, {
                        "authenticated": False,
                        "role": "guest",
                        "canPlayAudio": False
                    })
                    return

                role = session.get("role", "guest")
                username = session.get("username", "")
                discord_id = session.get("sub", "")
                linked_artists = get_linked_artists_for_user(username, discord_id) if role == "discord_user" else []

                self.send_json(200, {
                    "authenticated": True,
                    "role": role,
                    "canPlayAudio": (role == "discord_user"),
                    "user": {
                        "id": discord_id,
                        "username": username,
                        "global_name": session.get("global_name", username),
                        "avatar_url": session.get("avatar_url", "")
                    },
                    "linked_artists": linked_artists
                })
                return

            # ─── API: Dynamic Opt-in State Dictionary ───
            if url_path == '/api/optin/state':
                optins = load_dynamic_optins()
                self.send_json(200, optins)
                return

            # ─── Static Files & Media Streaming ───
            if url_path == '/':
                url_path = '/index.html'

            # Build local path: route requests to MUSIC_DIR if configured
            rel_path = url_path.lstrip('/')
            first_segment = rel_path.split('/')[0] if rel_path else ""
            is_year_folder = bool(re.match(r'^\d{4}$', first_segment))
            local_path = ""

            if is_year_folder and MUSIC_DIR:
                # Direct relative path in MUSIC_DIR
                c1 = os.path.join(MUSIC_DIR, rel_path)
                if os.path.exists(c1) and os.path.isfile(c1):
                    local_path = c1

            # Fallback to local project directory
            if not local_path:
                local_path = os.path.join(PROJECT_ROOT, rel_path)

            if os.path.exists(local_path) and os.path.isfile(local_path):
                # Resolve Content-Type
                _, ext = os.path.splitext(local_path)
                ext = ext.lower()
                is_audio = ext in {".mp3", ".mp4", ".webm", ".ogg", ".mov", ".wav", ".flac", ".m4a", ".ts", ".m3u8", ".key"}

                # ─── Enforcement: Audio Playback Gating ───
                if is_audio and is_year_folder:
                    session = self.get_session()
                    # 1. Require Discord Authentication
                    if not session or session.get("role") != "discord_user":
                        self.send_json(401, {
                            "error": "discord_auth_required",
                            "message": "Audio playback is strictly restricted to users logged in with Discord."
                        })
                        return

                    # 2. Check Dynamic Opt-In Status (Default Opt-Out)
                    dynamic_map = load_dynamic_optins()
                    
                    # For HLS chunks (e.g. 2024/.../song/index.m3u8), we need to check the original track file path
                    # which is usually 2024/.../song.mp3 (as stored in metadata.js and dynamic_optins.json)
                    # We'll just check if ANY key in dynamic_optins.json matches the directory prefix.
                    rel_dir = os.path.dirname(rel_path)
                    
                    is_opted_in = False
                    for opt_key, opt_val in dynamic_map.items():
                        if opt_val and rel_dir.startswith(os.path.splitext(opt_key)[0]):
                            is_opted_in = True
                            break
                            
                    if not is_opted_in:
                        self.send_json(403, {
                            "error": "track_opted_out",
                            "message": "Playback for this track has not been enabled by the artist."
                        })
                        return

                mime_types = {
                    ".html": "text/html; charset=utf-8",
                    ".css":  "text/css",
                    ".js":   "application/javascript",
                    ".mp3":  "audio/mpeg",
                    ".mp4":  "video/mp4",
                    ".webm": "video/webm",
                    ".ogg":  "video/ogg",
                    ".mov":  "video/quicktime",
                    ".wav":  "audio/wav",
                    ".flac": "audio/flac",
                    ".m4a":  "audio/mp4",
                    ".png":  "image/png",
                    ".jpg":  "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".webp": "image/webp",
                    ".svg":  "image/svg+xml",
                    ".json": "application/json",
                    ".txt":  "text/plain"
                }
                mime = mime_types.get(ext, "application/octet-stream")

                # Read file bytes
                try:
                    with open(local_path, 'rb') as f:
                        bytes_data = f.read()
                except Exception as e:
                    self.send_response(500)
                    self.end_headers()
                    self._safe_write(f"500 Internal Server Error: {e}".encode('utf-8'))
                    return

                file_len = len(bytes_data)

                # Handle Range Header (HTTP 206 Partial Content) for audio scrubbing/seeking
                range_header = self.headers.get('Range')
                if range_header:
                    match = re.match(r'bytes=(\d+)-(\d*)', range_header)
                    if match:
                        start = int(match.group(1))
                        end = int(match.group(2)) if match.group(2) else file_len - 1

                        if start >= file_len:
                            self.send_response(416)
                            self.send_header('Content-Range', f'bytes */{file_len}')
                            self.end_headers()
                            return

                        length = end - start + 1
                        self.send_response(206)
                        self.send_header('Content-Type', mime)
                        self.send_header('Content-Range', f'bytes {start}-{end}/{file_len}')
                        self.send_header('Content-Length', str(length))
                        self.end_headers()
                        self._safe_write(bytes_data[start:end+1])
                        return

                # Default response (HTTP 200 OK)
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(file_len))
                self.end_headers()
                self._safe_write(bytes_data)
            else:
                self.send_response(404)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self._safe_write(f"404 Not Found: {url_path}".encode('utf-8'))
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            if getattr(exc, 'errno', None) in {errno.EPIPE, errno.ECONNRESET, errno.EBADF}:
                self.close_connection = True
                return
            raise

def run():
    """
    Initializes and starts the local HTTPServer instance.
    """
    server_address = ('', PORT)
    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer(server_address, RangeHTTPRequestHandler)
    print(f"Local web server started at http://localhost:{PORT}/")
    if MUSIC_DIR:
        print(f"Streaming audio files from: {MUSIC_DIR}")
    if DISCORD_CLIENT_ID:
        print(f"Discord OAuth2 configured (Client ID: {DISCORD_CLIENT_ID})")
    else:
        print("Notice: Discord OAuth2 not configured. Set DISCORD_CLIENT_ID in .env or use /api/auth/dev-login")
    print("Press Ctrl+C to stop the server.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Run the SimSelections local HTTP server with Discord authentication.")
    parser.add_argument("--music-file-path", default=MUSIC_DIR, help="Path to music library folder")
    args, _ = parser.parse_known_args()
    MUSIC_DIR = args.music_file_path
    if not MUSIC_DIR:
        print("Warning: Music directory path is not configured. Pass --music-file-path to enable audio streaming.")
    run()
