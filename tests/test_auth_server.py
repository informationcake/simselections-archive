import importlib.util
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
import json
import time

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "start_server.py"

spec = importlib.util.spec_from_file_location("start_server", MODULE_PATH)
start_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(start_server)

def test_token_signing_and_verification():
    payload = {"sub": "12345", "username": "mockuser", "role": "discord_user", "exp": time.time() + 3600}
    token = start_server.sign_payload(payload)
    assert token is not None
    assert "." in token
    
    # Valid token verification
    verified = start_server.verify_token(token)
    assert verified is not None
    assert verified["username"] == "mockuser"
    assert verified["role"] == "discord_user"
    
    # Tampered token verification fails
    tampered = token[:-4] + "abcd"
    assert start_server.verify_token(tampered) is None
    
    # Expired token verification fails
    expired_payload = {"sub": "12345", "username": "mockuser", "role": "discord_user", "exp": time.time() - 100}
    expired_token = start_server.sign_payload(expired_payload)
    assert start_server.verify_token(expired_token) is None

def test_api_me_unauthenticated():
    handler = object.__new__(start_server.RangeHTTPRequestHandler)
    handler.path = "/api/me"
    handler.headers = {}
    handler.wfile = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.close_connection = False

    handler.do_GET()

    handler.send_response.assert_called_with(200)
    args, _ = handler.wfile.write.call_args
    data = json.loads(args[0].decode('utf-8'))
    assert data["authenticated"] is False
    assert data["canPlayAudio"] is False
    assert data["role"] == "guest"

def test_api_me_authenticated_discord():
    token = start_server.sign_payload({
        "sub": "999",
        "username": "mockuser",
        "role": "discord_user",
        "canPlay": True,
        "exp": time.time() + 3600
    })
    
    handler = object.__new__(start_server.RangeHTTPRequestHandler)
    handler.path = "/api/me"
    handler.headers = {"Cookie": f"sim_session={token}"}
    handler.wfile = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.close_connection = False

    with patch.object(start_server, "get_linked_artists_for_user", return_value=["Mock Artist"]):
        handler.do_GET()

        handler.send_response.assert_called_with(200)
        args, _ = handler.wfile.write.call_args
        data = json.loads(args[0].decode('utf-8'))
        assert data["authenticated"] is True
        assert data["role"] == "discord_user"
        assert data["canPlayAudio"] is True
        assert "Mock Artist" in data["linked_artists"]

def test_audio_gating_blocks_unauthenticated():
    handler = object.__new__(start_server.RangeHTTPRequestHandler)
    handler.path = "/2024/Sim_Selections_MAY_2024/01.mp3"
    handler.headers = {}
    handler.wfile = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.close_connection = False

    with patch("os.path.exists", return_value=True), \
         patch("os.path.isfile", return_value=True):
        handler.do_GET()
        
        handler.send_response.assert_called_with(401)
        args, _ = handler.wfile.write.call_args
        data = json.loads(args[0].decode('utf-8'))
        assert data["error"] == "discord_auth_required"

def test_audio_gating_blocks_view_only():
    token = start_server.sign_payload({
        "sub": "viewer",
        "username": "viewer",
        "role": "view_only",
        "canPlay": False,
        "exp": time.time() + 3600
    })
    
    handler = object.__new__(start_server.RangeHTTPRequestHandler)
    handler.path = "/2024/Sim_Selections_MAY_2024/01.mp3"
    handler.headers = {"Cookie": f"sim_session={token}"}
    handler.wfile = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.close_connection = False

    with patch("os.path.exists", return_value=True), \
         patch("os.path.isfile", return_value=True):
        handler.do_GET()
        
        handler.send_response.assert_called_with(401)
        args, _ = handler.wfile.write.call_args
        data = json.loads(args[0].decode('utf-8'))
        assert data["error"] == "discord_auth_required"

def test_audio_gating_allows_discord_user_when_opted_in():
    token = start_server.sign_payload({
        "sub": "12345",
        "username": "testuser",
        "role": "discord_user",
        "canPlay": True,
        "exp": time.time() + 3600
    })
    
    handler = object.__new__(start_server.RangeHTTPRequestHandler)
    handler.path = "/2024/Sim_Selections_MAY_2024/01.mp3"
    handler.headers = {"Cookie": f"sim_session={token}"}
    handler.wfile = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.close_connection = False

    mock_audio = b'ID3\x03\x00\x00\x00' + b'\x00' * 50
    with patch("os.path.exists", return_value=True), \
         patch("os.path.isfile", return_value=True), \
         patch.object(start_server, "load_dynamic_optins", return_value={"2024/Sim_Selections_MAY_2024/01.mp3": True}), \
         patch("builtins.open", unittest.mock.mock_open(read_data=mock_audio)):
        handler.do_GET()
        
        handler.send_response.assert_called_with(200)
        handler.send_header.assert_any_call('Content-Type', 'audio/mpeg')
        handler.wfile.write.assert_called_with(mock_audio)

def test_audio_gating_blocks_opted_out_track_for_discord_user():
    token = start_server.sign_payload({
        "sub": "12345",
        "username": "testuser",
        "role": "discord_user",
        "canPlay": True,
        "exp": time.time() + 3600
    })
    
    handler = object.__new__(start_server.RangeHTTPRequestHandler)
    handler.path = "/2024/Sim_Selections_MAY_2024/01.mp3"
    handler.headers = {"Cookie": f"sim_session={token}"}
    handler.wfile = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.close_connection = False

    with patch("os.path.exists", return_value=True), \
         patch("os.path.isfile", return_value=True), \
         patch.object(start_server, "load_dynamic_optins", return_value={}):
        handler.do_GET()
        
        handler.send_response.assert_called_with(403)
        args, _ = handler.wfile.write.call_args
        data = json.loads(args[0].decode('utf-8'))
        assert data["error"] == "track_opted_out"

def test_dev_login_redirect():
    handler = object.__new__(start_server.RangeHTTPRequestHandler)
    handler.path = "/api/auth/dev-login?user=testuser"
    handler.headers = {}
    handler.wfile = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.close_connection = False

    handler.do_GET()

    handler.send_response.assert_called_with(302)
    handler.send_header.assert_any_call('Location', '/index.html?auth=dev_success')

def test_logout_clears_cookie():
    handler = object.__new__(start_server.RangeHTTPRequestHandler)
    handler.path = "/api/auth/logout"
    handler.headers = {}
    handler.wfile = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.close_connection = False

    handler.do_GET()

    handler.send_response.assert_called_with(302)
    handler.send_header.assert_any_call('Set-Cookie', 'sim_session=; Path=/; HttpOnly; Max-Age=0')

def test_tester_allowlist():
    with patch.dict("os.environ", {"DISCORD_TESTERS": "tester1,123456789"}):
        assert start_server.is_tester_allowed("tester1", "999") is True
        assert start_server.is_tester_allowed("stranger", "123456789") is True
        assert start_server.is_tester_allowed("randomuser", "88888") is False

    with patch.dict("os.environ", {"DISCORD_TESTERS": ""}):
        assert start_server.is_tester_allowed("anyone", "111") is True

def test_check_user_in_guild():
    from auth import check_user_in_guild
    # When guild_id is empty, returns True
    assert check_user_in_guild("dummy_token", "") is True

    # When guild API returns matching guild
    mock_resp = MagicMock()
    mock_resp.read.return_value = json.dumps([{"id": "111222333"}, {"id": "444555666"}]).encode('utf-8')
    mock_resp.__enter__.return_value = mock_resp
    
    with patch("urllib.request.urlopen", return_value=mock_resp):
        assert check_user_in_guild("dummy_token", "111222333") is True
        assert check_user_in_guild("dummy_token", "999999999") is False
