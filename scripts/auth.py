#!/usr/bin/env python3
"""
scripts/auth.py

Authentication and session utilities for SimSelections local development server:
- HMAC-SHA256 session token generation and verification
- Discord OAuth2 token exchange and user profile retrieval
- Artist identity resolution against data/artist_discord_map.json
- Dynamic playback opt-in preference persistence
"""

import os
import re
import json
import time
import hmac
import hashlib
import base64
import urllib.parse
import urllib.request
import threading

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
DISCORD_MAP_PATH = os.path.join(DATA_DIR, "artist_discord_map.json")
DYNAMIC_OPTIN_PATH = os.path.join(DATA_DIR, "dynamic_optin.json")

def load_env_file():
    """
    Loads local environment variables from .env if present.
    """
    env_path = os.path.join(PROJECT_ROOT, ".env")
    if os.path.exists(env_path):
        try:
            with open(env_path, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        k, v = line.split('=', 1)
                        k = k.strip()
                        v = v.strip().strip('\'"')
                        if k not in os.environ:
                            os.environ[k] = v
        except Exception:
            pass

load_env_file()

DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI = os.environ.get("DISCORD_REDIRECT_URI", "http://localhost:8086/api/auth/callback")
JWT_SECRET = os.environ.get("JWT_SECRET", "simselections_local_dev_secret_key_2026")
DISCORD_TESTERS = os.environ.get("DISCORD_TESTERS", "").strip()

def clean_string(s):
    if not s: return ""
    return re.sub(r'[^a-z0-9]', '', s.lower())

def is_tester_allowed(username, discord_id=""):
    """
    Checks if a user is permitted to authenticate as a Discord user during testing.
    - If DISCORD_TESTERS is set: only listed usernames or numeric IDs can log in via Discord.
    - If DISCORD_TESTERS is unset or empty: open to all Discord users (default).
    """
    testers_cfg = os.environ.get("DISCORD_TESTERS", DISCORD_TESTERS).strip()
    if not testers_cfg:
        return True

    allowed_list = [p.strip() for p in testers_cfg.split(',') if p.strip()]
    allowed_names = {clean_string(p) for p in allowed_list}
    allowed_ids = {p for p in allowed_list if p.isdigit()}

    if discord_id and str(discord_id) in allowed_ids:
        return True
    if clean_string(username) in allowed_names:
        return True
    return False

def sign_payload(data_dict):
    """
    Creates a tamper-proof HMAC-SHA256 signed session token string.
    """
    payload_json = json.dumps(data_dict, separators=(',', ':'))
    payload_b64 = base64.urlsafe_b64encode(payload_json.encode('utf-8')).decode('utf-8').rstrip('=')
    signature = hmac.new(JWT_SECRET.encode('utf-8'), payload_b64.encode('utf-8'), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{signature}"

def verify_token(token_str):
    """
    Validates signature and expiration of a signed session token. Returns payload dict or None.
    """
    if not token_str or '.' not in token_str:
        return None
    try:
        payload_b64, signature = token_str.split('.', 1)
        expected_sig = hmac.new(JWT_SECRET.encode('utf-8'), payload_b64.encode('utf-8'), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected_sig):
            return None
        
        padding = len(payload_b64) % 4
        if padding:
            payload_b64 += '=' * (4 - padding)
        payload_json = base64.urlsafe_b64decode(payload_b64.encode('utf-8')).decode('utf-8')
        data = json.loads(payload_json)
        
        if 'exp' in data and time.time() > data['exp']:
            return None
        return data
    except Exception:
        return None

def load_artist_discord_map():
    if os.path.exists(DISCORD_MAP_PATH):
        try:
            with open(DISCORD_MAP_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {"artists": {}, "handle_lookup": {}}

_OPTIN_LOCK = threading.Lock()

def load_dynamic_optins():
    with _OPTIN_LOCK:
        if os.path.exists(DYNAMIC_OPTIN_PATH):
            try:
                with open(DYNAMIC_OPTIN_PATH, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

def save_dynamic_optins(optins):
    with _OPTIN_LOCK:
        os.makedirs(os.path.dirname(DYNAMIC_OPTIN_PATH), exist_ok=True)
        with open(DYNAMIC_OPTIN_PATH, 'w', encoding='utf-8') as f:
            json.dump(optins, f, indent=2)

def update_dynamic_optins_batch(items):
    """
    Atomically updates multiple opt-in items in a single thread-safe operation.
    Each item: {"trackKey": "...", "artist": "...", "optIn": bool}
    """
    with _OPTIN_LOCK:
        dynamic_map = {}
        if os.path.exists(DYNAMIC_OPTIN_PATH):
            try:
                with open(DYNAMIC_OPTIN_PATH, 'r', encoding='utf-8') as f:
                    dynamic_map = json.load(f)
            except Exception:
                dynamic_map = {}

        for it in items:
            track_key = it.get("trackKey") or it.get("file")
            artist_name = it.get("artist", "")
            opt_in = bool(it.get("optIn", True))
            if track_key:
                dynamic_map[track_key] = opt_in
            if artist_name:
                dynamic_map[f"artist:{clean_string(artist_name)}"] = opt_in

        os.makedirs(os.path.dirname(DYNAMIC_OPTIN_PATH), exist_ok=True)
        with open(DYNAMIC_OPTIN_PATH, 'w', encoding='utf-8') as f:
            json.dump(dynamic_map, f, indent=2)

        return dynamic_map

def get_linked_artists_for_user(username, discord_id=""):
    """
    Finds all artist aliases associated with a given Discord username / ID.
    """
    discord_map = load_artist_discord_map()
    handle_lookup = discord_map.get("handle_lookup", {})
    artists_dict = discord_map.get("artists", {})
    
    linked = set()
    c_user = clean_string(username)
    
    if c_user in handle_lookup:
        linked.update(handle_lookup[c_user])
        
    for art_name, info in artists_dict.items():
        if discord_id and discord_id in info.get("discord_ids", []):
            linked.add(art_name)
            continue
        for h in info.get("handles", []):
            if clean_string(h) == c_user:
                linked.add(art_name)
                break
                
    return sorted(list(linked))

def exchange_discord_code(code):
    """
    Exchanges an OAuth2 code with Discord API for access token and fetches user profile.
    """
    token_url = "https://discord.com/api/v10/oauth2/token"
    token_data = urllib.parse.urlencode({
        "client_id": DISCORD_CLIENT_ID,
        "client_secret": DISCORD_CLIENT_SECRET,
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": DISCORD_REDIRECT_URI
    }).encode('utf-8')

    req = urllib.request.Request(token_url, data=token_data, headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "SimSelectionsArchive/1.0"
    })
    with urllib.request.urlopen(req) as resp:
        token_resp = json.loads(resp.read().decode('utf-8'))
        access_token = token_resp.get("access_token")

    user_req = urllib.request.Request("https://discord.com/api/v10/users/@me", headers={
        "Authorization": f"Bearer {access_token}",
        "User-Agent": "SimSelectionsArchive/1.0"
    })
    with urllib.request.urlopen(user_req) as resp:
        return json.loads(resp.read().decode('utf-8'))
