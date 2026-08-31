import importlib.util
from pathlib import Path
import threading
import time
import urllib.request
import urllib.parse
import json
from http.server import ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "start_server.py"

spec = importlib.util.spec_from_file_location("start_server", MODULE_PATH)
start_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(start_server)

def test_full_server_http_lifecycle():
    # Spin up server on an ephemeral port (port 0 selects available free port)
    server = ThreadingHTTPServer(('127.0.0.1', 0), start_server.RangeHTTPRequestHandler)
    port = server.server_address[1]
    base_url = f"http://127.0.0.1:{port}"

    thread = threading.Thread(target=server.serve_forever)
    thread.daemon = True
    thread.start()
    time.sleep(0.1)

    try:
        # 1. Test unauthenticated /api/me
        req = urllib.request.Request(f"{base_url}/api/me")
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            assert data["authenticated"] is False
            assert data["canPlayAudio"] is False
            assert data["role"] == "guest"

        # 2. Test basic password login (View-Only)
        post_req = urllib.request.Request(
            f"{base_url}/api/auth/login-basic",
            data=b"{}",
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(post_req) as resp:
            cookie_header = resp.headers.get("Set-Cookie")
            assert cookie_header is not None
            assert "sim_session=" in cookie_header
            cookie_val = cookie_header.split(";")[0]

        # 3. Test /api/me with View-Only cookie
        view_req = urllib.request.Request(f"{base_url}/api/me", headers={"Cookie": cookie_val})
        with urllib.request.urlopen(view_req) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            assert data["authenticated"] is True
            assert data["role"] == "view_only"
            assert data["canPlayAudio"] is False

        # 4. Test dev login (Simulating Discord user: mock_artist_user)
        # Disable auto redirect to inspect cookie
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None

        opener = urllib.request.build_opener(NoRedirect)
        try:
            resp = opener.open(f"{base_url}/api/auth/dev-login?user=mock_artist_user")
            discord_cookie = resp.headers.get("Set-Cookie").split(";")[0]
        except urllib.error.HTTPError as e:
            if e.code in (302, 303):
                discord_cookie = e.headers.get("Set-Cookie").split(";")[0]
            else:
                raise

        # 5. Test /api/me with Discord user cookie
        disc_req = urllib.request.Request(f"{base_url}/api/me", headers={"Cookie": discord_cookie})
        with urllib.request.urlopen(disc_req) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            assert data["authenticated"] is True
            assert data["role"] == "discord_user"
            assert data["canPlayAudio"] is True
            assert isinstance(data.get("linked_artists"), list)

        # 6. Test toggle opt-in API
        optin_payload = json.dumps({
            "trackKey": "2024/Sim_Selections_MAY_2024/01. Mock Artist - Test Song.mp3",
            "artist": "Mock Artist",
            "optIn": True
        }).encode('utf-8')
        optin_req = urllib.request.Request(
            f"{base_url}/api/optin",
            data=optin_payload,
            headers={"Content-Type": "application/json", "Cookie": discord_cookie}
        )
        with urllib.request.urlopen(optin_req) as resp:
            optin_data = json.loads(resp.read().decode('utf-8'))
            assert optin_data["status"] == "ok"
            assert optin_data["optIn"] is True

    finally:
        server.shutdown()
        server.server_close()
