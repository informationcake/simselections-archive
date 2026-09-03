#!/usr/bin/env python3
"""
scripts/compile_discord_map.py

Scans all historical submission files (CSV, ODS, reports) across the SimSelections archive,
deconstructs multi-artist collaboration strings into individual atomic artist entities,
normalizes Discord handles, and builds an authoritative identity lookup table:
data/artist_discord_map.json
"""

import os
import sys
import csv
import json
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")
METADATA_JS_PATH = os.path.join(PROJECT_ROOT, "src", "metadata.js")
OUTPUT_JSON_PATH = os.path.join(DATA_DIR, "artist_discord_map.json")

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

def clean_string(s):
    if not s: return ""
    return re.sub(r'[^a-z0-9]', '', s.lower())

def is_collaboration(artist_str):
    """
    Checks if an artist string contains multi-artist collaboration delimiters outside parentheses.
    """
    if not artist_str:
        return False
    # Remove text in parentheses before checking for collaboration words, 
    # UNLESS they contain strong delimiters like / or &
    def strip_safe_parens(match):
        content = match.group(0)
        if bool(re.search(r'[/&;]', content)):
            return content
        return ""
    
    s_no_paren = re.sub(r'\(.*?\)', strip_safe_parens, artist_str)
    return bool(re.search(r'\b(feat|ft|and|with|vs|versus|x)\b|[&;\|/,]', s_no_paren, re.IGNORECASE))

# Artists that contain delimiters but should NOT be split
IGNORE_SPLIT = [
    "err, rawr",
    "err: rawr",
    "err:rawr",
    "err; rawr",
    "err;rawr",
    "a star, a robot"
]

def split_collaborators(artist_str):
    """
    Splits multi-artist strings into individual artist names, ignoring delimiters inside parentheses.
    e.g. "A & B & C" -> ["A", "B", "C"]
    e.g. "truck (but with a leading underscore)" -> ["truck (but with a leading underscore)"]
    """
    if not artist_str:
        return []
    
    # If no delimiters outside parentheses, return as single artist
    def strip_safe_parens(match):
        content = match.group(0)
        if bool(re.search(r'[/&;]', content)):
            return content
        return ""
    
    s_no_paren = re.sub(r'\(.*?\)', strip_safe_parens, artist_str)
    if not bool(re.search(r'\b(feat|ft|and|with|vs|versus|x)\b|[&;\|/,]', s_no_paren, re.IGNORECASE)):
        return [artist_str.strip()]

    # Replace collaboration words outside parentheses
    # Protect parentheses content by replacing temporarily
    parens = []
    def save_paren(match):
        content = match.group(0)
        if bool(re.search(r'[/&;]', content)):
            # Convert parentheses to delimiters so we split on them too!
            return "|" + content[1:-1] + "|"
        parens.append(content)
        return f"__PAREN_{len(parens)-1}__"
    
    protected = re.sub(r'\(.*?\)', save_paren, artist_str)
    
    # Protect specific complex artists that contain delimiters
    for protected_name in IGNORE_SPLIT:
        pattern = re.compile(re.escape(protected_name), re.IGNORECASE)
        protected = pattern.sub(lambda m: m.group(0).replace(",", "___PROTECTED_DELIM___").replace(":", "___PROTECTED_DELIM___").replace(";", "___PROTECTED_DELIM___"), protected)
    
    norm = re.sub(r'\b(feat|ft|and|with|vs|versus|x)\b\.?', '|', protected, flags=re.IGNORECASE)
    parts = [p.strip() for p in re.split(r'[&;\|/,]', norm) if p.strip()]
    
    # Restore parenthetical content
    restored = []
    for p in parts:
        for idx, orig in enumerate(parens):
            p = p.replace(f"__PAREN_{idx}__", orig)
        if p.strip():
            restored.append(p.strip())
            
    return restored

def normalize_discord_handle(handle):
    if not handle:
        return ""
    
    h = handle.strip()
    
    # Filter out survey / placeholder answers
    lower = h.lower()
    if lower in {"yes", "no", "n/a", "na", "none", "idk", "?", "-", ".", "same", "n", "y", "null", "undefined", "true", "false"}:
        return ""
    if lower.startswith("http://") or lower.startswith("https://"):
        return ""
    
    # Strip leading @
    if h.startswith("@"):
        h = h[1:].strip()
        
    # Strip old 4-digit discriminators: e.g. "corey.ostman#6424" -> "corey.ostman"
    if "#" in h:
        parts = h.split("#")
        base = parts[0].strip()
        m_paren = re.match(r'^(.*?)\s*\((.*?)\)$', base)
        if m_paren:
            candidate1 = m_paren.group(1).strip()
            candidate2 = m_paren.group(2).strip()
            h = candidate1 if candidate1 else candidate2
        else:
            h = base

    h = h.strip("'\" \t\r\n")
    return h

def load_atomic_catalog_artists():
    """
    Extracts all individual (atomic) artist names from src/metadata.js by splitting
    collaboration strings into individual human entities.
    """
    if not os.path.exists(METADATA_JS_PATH):
        return set()

    with open(METADATA_JS_PATH, 'r', encoding='utf-8') as f:
        content = f.read()

    m = re.search(r'export const playlistData = (\[.*?\]);', content, re.DOTALL)
    if not m:
        return set()

    try:
        playlists = json.loads(m.group(1))
    except Exception as e:
        print(f"Warning: Could not parse metadata.js JSON: {e}")
        return set()

    atomic_artists = {} # clean_name -> canonical_display_name

    for playlist in playlists:
        for track in playlist.get("tracks", []):
            artist_field = (track.get("artist") or "").strip()
            if not artist_field:
                continue

            if is_collaboration(artist_field):
                individual_artists = split_collaborators(artist_field)
            else:
                individual_artists = [artist_field]

            for art in individual_artists:
                c = clean_string(art)
                if c and c not in atomic_artists:
                    atomic_artists[c] = art

    return atomic_artists

def compile_discord_map(music_dir=""):
    """
    Compiles individual artist-to-Discord mappings by scanning submission CSVs and reports.
    Ensures all top-level artist entities are individual human creators (no bundled collab strings).
    """
    atomic_artists = load_atomic_catalog_artists()
    print(f"Discovered {len(atomic_artists)} individual atomic artist entities in catalog.")

    search_dirs = [DATA_DIR]
    if music_dir and os.path.exists(music_dir):
        search_dirs.append(music_dir)

    artist_to_handles = {} # clean_artist -> { "name": str, "handles": set(), "discord_ids": set() }

    # Initialize all atomic catalog artists
    for c_art, display_name in atomic_artists.items():
        artist_to_handles[c_art] = {
            "name": display_name,
            "handles": set(),
            "discord_ids": set()
        }


    # Discover and parse submission CSVs
    scanned_files = 0
    all_rows = []
    
    for sdir in search_dirs:
        for root, _, files in os.walk(sdir):
            for fname in files:
                if fname.endswith(".csv") and not fname.startswith("."):
                    fpath = os.path.join(root, fname)
                    scanned_files += 1
                    try:
                        with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
                            reader = csv.reader(f)
                            header = [h.strip() for h in next(reader, [])]

                            is_invalid_survey = any("would you like" in h.lower() and "feedback" in h.lower() for h in header)
                            if is_invalid_survey:
                                continue

                            art_idx = -1
                            tit_idx = -1
                            disc_idx = -1
                            disc_id_idx = -1

                            for idx, h in enumerate(header):
                                h_clean = h.lower()
                                if "discord user id" in h_clean:
                                    disc_id_idx = idx
                                elif "discord handle" in h_clean or ("discord" in h_clean and "critique" not in h_clean and "feedback" not in h_clean):
                                    disc_idx = idx
                                elif art_idx == -1 and ("artist" in h_clean or "preferred artist" in h_clean):
                                    art_idx = idx
                                elif tit_idx == -1 and ("title" in h_clean or "art name" in h_clean or "track name" in h_clean or "score name" in h_clean):
                                    tit_idx = idx

                            if art_idx != -1 and (disc_idx != -1 or disc_id_idx != -1):
                                for row in reader:
                                    if not row:
                                        continue
                                    art_val = row[art_idx].strip() if len(row) > art_idx else ""
                                    tit_val = row[tit_idx].strip() if tit_idx != -1 and len(row) > tit_idx else ""
                                    disc_val = row[disc_idx].strip() if disc_idx != -1 and len(row) > disc_idx else ""
                                    disc_id_val = row[disc_id_idx].strip() if disc_id_idx != -1 and len(row) > disc_id_idx else ""

                                    if art_val and (disc_val or disc_id_val):
                                        all_rows.append((art_val, tit_val, disc_val, disc_id_val))
                    except Exception as e:
                        print(f"Warning: Failed to read {fpath}: {e}")

    # Pass 1: Build dynamic aliases from solo tracks
    dynamic_aliases = {}
    for art_val, tit_val, disc_val, disc_id_val in all_rows:
        clean_handle = normalize_discord_handle(disc_val)
        c_handle = clean_string(clean_handle)
        # If this is a solo track (not a collaboration), the handle belongs to this artist
        if c_handle and not is_collaboration(art_val):
            if c_handle not in dynamic_aliases:
                dynamic_aliases[c_handle] = set()
            dynamic_aliases[c_handle].add(art_val)

    # Pass 2: Assign handles correctly even in collaborations
    for art_val, tit_val, disc_val, disc_id_val in all_rows:
        clean_handle = normalize_discord_handle(disc_val)
        c_handle = clean_string(clean_handle)
        
        if not c_handle and not disc_id_val:
            continue

        # Remix title protection
        is_remix_title = bool(re.search(r'\b(remix|rework|reimagining|cover|flip|edit|remake|done redid)\b', tit_val, re.IGNORECASE))
        if is_remix_title and c_handle and c_handle != clean_string(art_val):
            remixer_candidate = None
            for c_art_key, disp_name in atomic_artists.items():
                if c_art_key == c_handle:
                    remixer_candidate = disp_name
                    break
            
            if not remixer_candidate and c_handle in dynamic_aliases:
                remixer_candidate = list(dynamic_aliases[c_handle])[0]

            if remixer_candidate:
                c_remixer = clean_string(remixer_candidate)
                if c_remixer in artist_to_handles:
                    if clean_handle:
                        artist_to_handles[c_remixer]["handles"].add(clean_handle)
                    if disc_id_val:
                        artist_to_handles[c_remixer]["discord_ids"].add(disc_id_val)
            continue

        # Stem provider protection during remix months
        if clean_string(art_val) in {"theflashbulb", "simulation"}:
            if "remix" in tit_val.lower() or "edit" in tit_val.lower() or c_handle not in {"theflashbulb", "bennjordan"}:
                continue

        # Split into constituent atomic artists
        constituents = split_collaborators(art_val) if is_collaboration(art_val) else [art_val]

        # Determine which constituent artist this handle belongs to
        target_artist = None

        # 1. Exact string match between handle and constituent
        for const in constituents:
            if clean_string(const) == c_handle:
                target_artist = const
                break

        # 2. Match against dynamic aliases learned from solo tracks (for collaborations)
        if not target_artist and c_handle in dynamic_aliases and len(constituents) > 1:
            for const in constituents:
                if const in dynamic_aliases[c_handle]:
                    target_artist = const
                    break

        # 3. Default to primary submitting artist
        if not target_artist and len(constituents) > 0:
            first_const = constituents[0]
            if clean_string(first_const) in {"theflashbulb", "simulation"} and len(constituents) > 1:
                target_artist = constituents[1]
            else:
                target_artist = first_const

        if target_artist:
            c_target = clean_string(target_artist)

            if c_target in artist_to_handles:
                if clean_handle:
                    artist_to_handles[c_target]["handles"].add(clean_handle)
                if disc_id_val:
                    artist_to_handles[c_target]["discord_ids"].add(disc_id_val)

    # Build reverse lookup handle_to_artists map
    handle_to_artists = {}
    for c_art, data in artist_to_handles.items():
        canonical_name = data["name"]
        for handle in data["handles"]:
            h_key = clean_string(handle)
            if h_key:
                if h_key not in handle_to_artists:
                    handle_to_artists[h_key] = set()
                handle_to_artists[h_key].add(canonical_name)

    # Format output dictionary with self-documenting metadata and description
    linked_artists_count = 0
    artists_dict = {}

    for c_art, data in sorted(artist_to_handles.items(), key=lambda x: x[1]["name"].lower()):
        name = data["name"]
        handles = sorted(list(data["handles"]))
        discord_ids = sorted(list(data["discord_ids"]))
        if handles or discord_ids:
            linked_artists_count += 1
        artists_dict[name] = {
            "handles": handles,
            "discord_ids": discord_ids
        }

    handle_lookup_dict = {}
    for h_key in sorted(handle_to_artists.keys()):
        handle_lookup_dict[h_key] = sorted(list(handle_to_artists[h_key]))

    output_data = {
        "_description": {
            "purpose": "Authoritative identity mapping between SimSelections music artists and their verified Discord accounts.",
            "sections": {
                "artists": "Maps each canonical music artist name to their verified Discord handles (as submitted) and numerical Discord IDs.",
                "handle_lookup": "Fast lookup index mapping clean normalized Discord usernames (lowercase, alphanumeric) to the canonical artist names they own."
            },
            "how_login_works": "When an artist logs in via Discord OAuth2, the server normalizes their Discord username (removes spaces, punctuation, lowercase) and queries 'handle_lookup' to find all artist aliases they own.",
            "coverage": {
                "total_individual_artists": len(artists_dict),
                "linked_artists_count": linked_artists_count,
                "coverage_percentage": f"{linked_artists_count/len(artists_dict)*100:.1f}%"
            }
        },
        "artists": artists_dict,
        "handle_lookup": handle_lookup_dict
    }

    os.makedirs(os.path.dirname(OUTPUT_JSON_PATH), exist_ok=True)
    with open(OUTPUT_JSON_PATH, "w", encoding="utf-8") as out_f:
        json.dump(output_data, out_f, indent=2)

    print(f"Scanned {scanned_files} CSV reports.")
    print(f"Compiled clean atomic identity map for {len(output_data['artists'])} individual artists.")
    print(f"{linked_artists_count} individual artists successfully linked to Discord handles ({linked_artists_count/len(output_data['artists'])*100:.1f}% coverage).")
    print(f"Saved atomic identity map to: {OUTPUT_JSON_PATH}")
    return output_data

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Compile individual atomic artist to Discord identity map.")
    parser.add_argument("--music-file-path", default=os.environ.get("music-file-path", ""), help="Path to music library folder")
    args, _ = parser.parse_known_args()
    music_dir = args.music_file_path or ""
    if not music_dir:
        print("Notice: No --music-file-path provided. Compiling from repository data/ folder only.")
    compile_discord_map(music_dir)
