#!/usr/bin/env python3
import os
import re
import csv
import json
import urllib.request
import urllib.parse
import glob
import sys
from concurrent.futures import ThreadPoolExecutor

# Import new shared logic
import collab_utils

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")

if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

try:
    from download_sheets import download_sheet_metadata
except ImportError:  # pragma: no cover - defensive fallback for test imports
    download_sheet_metadata = None

# Override print to safely handle emoji and other unicode chars on consoles with limited encodings
_original_print = print
def print(*args, **kwargs):
    """
    Overrides the built-in print function to automatically flush stdout, 
    ensuring logs are immediately visible in unbuffered environments.
    """
    try:
        _original_print(*args, **kwargs)
    except UnicodeEncodeError:
        sep = kwargs.get('sep', ' ')
        end = kwargs.get('end', '\n')
        file = kwargs.get('file', sys.stdout)
        
        msg = sep.join(str(arg) for arg in args)
        encoding = getattr(file, 'encoding', 'utf-8') or 'utf-8'
        encoded = msg.encode(encoding, errors='replace')
        decoded = encoded.decode(encoding)
        
        # Call original print with replaced character string
        pass_kwargs = {k: v for k, v in kwargs.items() if k not in ['sep', 'end', 'file']}
        _original_print(decoded, end=end, file=file, **pass_kwargs)

# Configuration defaults (parsed in __main__)
MUSIC_DIR = ""
YEARS = []

MONTH_ORDER = {
    "JANUARY": 1, "FEBRUARY": 2, "MARCH": 3, "APRIL": 4, "MAY": 5, "JUNE": 6,
    "JULY": 7, "AUGUST": 8, "SEPTEMBER": 9, "OCTOBER": 10, "NOVEMBER": 11, "DECEMBER": 12
}

def clean_string(s):
    """
    Normalizes a string for fuzzy matching by converting it to lowercase 
    and stripping out all whitespace and non-alphanumeric characters.
    """
    if not s:
        return ""
    # Lowercase and remove all non-alphanumeric characters
    return re.sub(r'[^a-z0-9]', '', s.lower())


typo_warnings = []
filename_warnings = []
naming_warnings = []
sheet_artist_counts = {}
raw_artist_counts = {}

def identify_typo_location(filename_artist, sheet_artist, optin_sets):
    """
    Attempts to identify whether the typo is in the filename or in the Google Sheet,
    by checking which one matches the opt-in list, or has higher frequency in the spreadsheet.
    Returns "sheet" if typo is likely in sheet, "filename" if likely in filename,
    and "unknown" if neither matches.
    """
    global sheet_artist_counts
    
    if optin_sets:
        optin_exact, optin_fuzzy = optin_sets
        
        # Helper to check if any of the split parts of an artist name matches the opt-in list
        def has_optin_match(artist_str):
            if not artist_str:
                return False
            # Split like we do for opt-in checks
            norm = re.sub(r'\b(feat|ft|and|with|vs|versus)\b\.?', '|', artist_str, flags=re.IGNORECASE)
            parts = [p.strip() for p in re.split(r'[&;\|/,]', norm) if p.strip()]
            for p in parts:
                p_fuzzy = clean_string(p)
                if p_fuzzy in optin_fuzzy:
                    return True
            return False

        fn_match = has_optin_match(filename_artist)
        sheet_match = has_optin_match(sheet_artist)
        
        if fn_match and not sheet_match:
            # Filename matches optin (correct), sheet has the typo
            return "sheet"
        elif sheet_match and not fn_match:
            # Sheet matches optin (correct), filename has the typo
            return "filename"

    # Fall back to spreadsheet frequency!
    def get_max_sheet_count(artist_str):
        if not artist_str:
            return 0
        norm = re.sub(r'\b(feat|ft|and|with|vs|versus)\b\.?', '|', artist_str, flags=re.IGNORECASE)
        parts = [p.strip() for p in re.split(r'[&;\|/,]', norm) if p.strip()]
        counts = [sheet_artist_counts.get(clean_string(p), 0) for p in parts]
        return max(counts) if counts else 0

    fn_count = get_max_sheet_count(filename_artist)
    sheet_count = get_max_sheet_count(sheet_artist)
    
    if fn_count > sheet_count:
        # Filename artist is seen more often in the spreadsheet than the spreadsheet artist for this track!
        return "sheet"
    elif sheet_count > fn_count:
        # Sheet artist is seen more often in the spreadsheet than the filename artist
        return "filename"
        
    return "unknown"

def is_different_naming_scheme(artist_a, artist_b):
    """
    Determines if a difference in artist names is just a different naming scheme 
    or missing collaborator (sharing at least one normalized artist part), 
    rather than a suspected typo.
    """
    def split_artists(s):
        if not s:
            return set()
        norm = re.sub(r'\b(feat|ft|and|with|vs|versus)\b\.?', '|', s, flags=re.IGNORECASE)
        parts = re.split(r'[&;\|/,]', norm)
        return {clean_string(p) for p in parts if p.strip()}

    parts_a = split_artists(artist_a)
    parts_b = split_artists(artist_b)
    # If they share at least one cleaned artist part, it's a naming scheme / collab difference
    return len(parts_a.intersection(parts_b)) > 0


def load_optin_artists():
    """
    Reads artist names from playback-optin.txt / optin-playback.txt / opt-in.txt
    in DATA_DIR or PROJECT_ROOT. Returns a tuple (optin_set_exact, optin_set_fuzzy).
    """
    candidate_filenames = ["playback-optin.txt", "optin-playback.txt", "opt-in.txt"]
    candidate_paths = []
    for fname in candidate_filenames:
        candidate_paths.append(os.path.join(DATA_DIR, fname))
        candidate_paths.append(os.path.join(PROJECT_ROOT, fname))

    optin_set_exact = set()
    optin_set_fuzzy = set()
    for path in candidate_paths:
        if os.path.exists(path):
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith('#'):
                            optin_set_exact.add(line)
                            optin_set_fuzzy.add(re.sub(r'[^a-z0-9]', '', line.lower()))
            except Exception as e:
                print(f"Warning: Could not read opt-in file at {path}: {e}")

    return (optin_set_exact, optin_set_fuzzy)


def is_artist_opted_in(artist, optin_sets, context=""):
    """
    Checks if an artist (and all featured/primary artists) have opted in exactly.
    Logs a warning if a fuzzy match is found but an exact match is missing.
    """
    if optin_sets is None:
        return True

    if not optin_sets or len(optin_sets) != 2:
        return False
        
    optin_set_exact, optin_set_fuzzy = optin_sets

    if not optin_set_exact and not optin_set_fuzzy:
        return False

    if not artist:
        return False

    normalized = re.sub(r'\b(feat|ft|and|with|vs|versus)\b\.?', '|', artist, flags=re.IGNORECASE)
    parts = re.split(r'[&;\|/]', normalized)
    
    # Track must have at least one valid part, and all parts must opt in.
    valid_parts = [p.strip() for p in parts if p.strip()]
    if not valid_parts:
        return False

    for p_exact in valid_parts:
        if p_exact in optin_set_exact:
            continue
            
        # If not an exact match, check if it's a formatting/case difference
        p_fuzzy = re.sub(r'[^a-z0-9]', '', p_exact.lower())
        if p_fuzzy in optin_set_fuzzy:
            context_str = f" in {context}" if context else ""
            typo_warnings.append(f"Artist name discrepancy for '{p_exact}'{context_str}. Exact match not found in opt-in list, but a format/case variation exists. Track WILL be opted in.")
            continue
            
        # If it doesn't match at all, they are not opted in
        return False

    return True


def build_playlist_entry(playlist_id, playlist_name, folder_year, month, meta, folder_path, year, folder_name, files, optin_artists=None):
    """
    Constructs a full playlist metadata object by cross-referencing local files 
    with Google Sheets metadata.
    """
    theme = meta.get("theme", "") if meta else ""
    keywords = meta.get("keywords", []) if meta else []
    challenge = meta.get("challenge", "") if meta else ""
    stream_url = meta.get("streamUrl", "") if meta else ""

    tracks = []
    seen_tracks = set()
    consumed_files = set()

    file_candidates = []
    # Collect sheet track artist and title keys early to help resolve multi-hyphen ambiguity
    sheet_tracks = meta.get("tracks", []) if meta else []
    sheet_artists = {clean_string(t.get("artist")) for t in sheet_tracks if t.get("artist")}
    sheet_titles = {clean_string(t.get("title")) for t in sheet_tracks if t.get("title")}

    for f in files:
        file_path = f"{year}/{folder_name}/{f}" if folder_path else ""
        base_name = os.path.splitext(f)[0]
        track_no = 0
        artist = "Unknown Artist"
        title = base_name

        # Extract track number prefix
        match_num = re.match(r'^(\d+)\.\s*(.*)$', base_name)
        if match_num:
            track_no = int(match_num.group(1))
            name_part = match_num.group(2).strip()
        else:
            name_part = base_name

        # Split on ' - ' requiring spaces on both sides to avoid breaking hyphenated names (like sim-sel or ARC19-X)
        parts = re.split(r'\s+-\s+', name_part)
        if len(parts) == 2:
            artist = parts[0].strip()
            title = parts[1].strip()
        elif len(parts) > 2:
            # Handle multiple hyphens (e.g. "Artist A - Artist B - Song Title")
            # We score all possible split options against the spreadsheet metadata to find the correct split
            best_split_idx = 1
            best_score = -1
            for i in range(1, len(parts)):
                artist_cand = " - ".join(parts[:i]).strip()
                title_cand = " - ".join(parts[i:]).strip()
                
                cand_artist_key = clean_string(artist_cand)
                cand_title_key = clean_string(title_cand)
                
                score = 0
                if cand_artist_key in sheet_artists:
                    score += 1
                if cand_title_key in sheet_titles:
                    score += 1
                # Exact match on both is highly weighted
                if cand_artist_key in sheet_artists and cand_title_key in sheet_titles:
                    score += 2
                    
                if score > best_score:
                    best_score = score
                    best_split_idx = i
            
            artist = " - ".join(parts[:best_split_idx]).strip()
            title = " - ".join(parts[best_split_idx:]).strip()

        file_candidates.append({
            "trackNo": track_no,
            "artist": artist,
            "title": title,
            "file": file_path,
            "key": (clean_string(artist), clean_string(title))
        })

    def find_matching_file(track_artist, track_title, track_no):
        """
        Attempts to match a given track artist/title to a local file in the folder 
        using exact string matching on normalized strings (stripped of punctuation/spaces).
        """
        if not file_candidates:
            return ""

        artist_key = clean_string(track_artist)
        title_key = clean_string(track_title)

        # 1. Exact match (Artist + Title)
        if artist_key and title_key:
            for candidate in file_candidates:
                if candidate["file"] in consumed_files:
                    continue
                if candidate["key"] == (artist_key, title_key):
                    consumed_files.add(candidate["file"])
                    return candidate["file"]

        # 2. Track Number + Title match (high confidence fallback)
        if track_no and title_key:
            for candidate in file_candidates:
                if candidate["file"] in consumed_files:
                    continue
                if candidate["trackNo"] == track_no and candidate["key"][1] == title_key:
                    if candidate["key"][0] != artist_key:
                        msg = f"File '{candidate['file']}' matched track '{track_title}' by track number ({track_no}) and title, but artist names differ ('{candidate['artist']}' vs '{track_artist}')."
                        if is_different_naming_scheme(candidate['artist'], track_artist):
                            naming_warnings.append(msg)
                        else:
                            loc = identify_typo_location(candidate['artist'], track_artist, optin_artists)
                            if loc == "filename":
                                filename_warnings.append(msg)
                            else:
                                typo_warnings.append(msg)
                    consumed_files.add(candidate["file"])
                    return candidate["file"]

        # 3. Track Number + Artist match (high confidence fallback)
        if track_no and artist_key:
            for candidate in file_candidates:
                if candidate["file"] in consumed_files:
                    continue
                if candidate["trackNo"] == track_no and candidate["key"][0] == artist_key:
                    if candidate["key"][1] != title_key:
                        msg = f"File '{candidate['file']}' matched track '{track_title}' by track number ({track_no}) and artist, but titles differ ('{candidate['title']}' vs '{track_title}')."
                        typo_warnings.append(msg)
                    consumed_files.add(candidate["file"])
                    return candidate["file"]

        # 4. Artist-only match
        if artist_key:
            for candidate in file_candidates:
                if candidate["file"] in consumed_files:
                    continue
                if candidate["key"][0] == artist_key:
                    consumed_files.add(candidate["file"])
                    return candidate["file"]

        # 5. Title-only match
        if title_key:
            for candidate in file_candidates:
                if candidate["file"] in consumed_files:
                    continue
                if candidate["key"][1] == title_key:
                    if candidate["key"][0] != artist_key:
                        msg = f"File '{candidate['file']}' matched track '{track_title}' by title, but artist names differ ('{candidate['artist']}' vs '{track_artist}')."
                        if is_different_naming_scheme(candidate['artist'], track_artist):
                            naming_warnings.append(msg)
                        else:
                            loc = identify_typo_location(candidate['artist'], track_artist, optin_artists)
                            if loc == "filename":
                                filename_warnings.append(msg)
                            else: # Default to sheet if "sheet" or "unknown"
                                typo_warnings.append(msg)
                    consumed_files.add(candidate["file"])
                    return candidate["file"]

        # 6. Track number-only match
        if track_no:
            for candidate in file_candidates:
                if candidate["file"] in consumed_files:
                    continue
                if candidate["trackNo"] == track_no:
                    # Avoid stealing a file that matches another track in the spreadsheet exactly
                    is_exact_match_for_other = False
                    cand_artist_key = clean_string(candidate["artist"])
                    cand_title_key = clean_string(candidate["title"])
                    for other_track in sheet_tracks:
                        other_artist = (other_track.get("artist") or "").strip()
                        other_title = (other_track.get("title") or "").strip()
                        if clean_string(other_artist) == cand_artist_key and clean_string(other_title) == cand_title_key:
                            is_exact_match_for_other = True
                            break
                    if not is_exact_match_for_other:
                        if clean_string(candidate["artist"]) != artist_key:
                            msg = f"File '{candidate['file']}' matched track '{track_title}' by track number ({track_no}), but artist names differ ('{candidate['artist']}' vs '{track_artist}')."
                            if is_different_naming_scheme(candidate['artist'], track_artist):
                                naming_warnings.append(msg)
                            else:
                                loc = identify_typo_location(candidate['artist'], track_artist, optin_artists)
                                if loc == "filename":
                                    filename_warnings.append(msg)
                                else: # Default to sheet if "sheet" or "unknown"
                                    typo_warnings.append(msg)
                        consumed_files.add(candidate["file"])
                        return candidate["file"]

        return ""

    sheet_tracks = meta.get("tracks", []) if meta else []
    for track in sheet_tracks:
        artist = (track.get("artist") or "Unknown Artist").strip()
        title = (track.get("title") or "").strip()
        if not artist and not title:
            continue

        track_no = track.get("trackNo") or 0
        track_key = (clean_string(artist), clean_string(title))
        if track_key in seen_tracks:
            continue
        seen_tracks.add(track_key)

        matched_file = find_matching_file(artist, title, track_no)
        tracks.append({
            "trackNo": track_no or (len(tracks) + 1),
            "artist": artist,
            "title": title,
            "file": matched_file,
            "link": track.get("link", "") or ""
        })

    for candidate in file_candidates:
        if candidate["file"] in consumed_files:
            continue
        track_key = candidate["key"]
        if track_key in seen_tracks:
            continue
        seen_tracks.add(track_key)

        tracks.append({
            "trackNo": candidate["trackNo"] or (len(tracks) + 1),
            "artist": candidate["artist"],
            "title": candidate["title"],
            "file": candidate["file"],
            "link": ""
        })

    tracks.sort(key=lambda t: (t["trackNo"] if isinstance(t["trackNo"], int) else 999999, t["artist"].lower(), t["title"].lower()))

    if not tracks:
        return None

    return {
        "id": playlist_id,
        "name": playlist_name,
        "year": int(folder_year),
        "month": month,
        "theme": theme,
        "keywords": keywords,
        "challenge": challenge,
        "streamUrl": stream_url,
        "tracks": tracks
    }


def resolve_youtube_url(search_title):
    """
    Attempts to find a YouTube stream URL for a given track title and artist.
    Includes retry logic for network resilience against transient errors.
    """
    import time
    query = urllib.parse.quote(f"{search_title} BennJordan OR alphabasic")
    search_url = f"https://www.youtube.com/results?search_query={query}"
    
    max_retries = 3
    for attempt in range(max_retries):
        try:
            req = urllib.request.Request(
                search_url, 
                headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9'
                }
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                html = response.read().decode('utf-8', errors='ignore')
                
            match = re.search(r'/watch\?v=([a-zA-Z0-9_-]{11})', html)
            if match:
                video_id = match.group(1)
                return f"https://www.youtube.com/watch?v={video_id}"
            break
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"  Warning: Could not resolve YouTube URL for '{search_title}', retrying ({attempt+1}/{max_retries}): {e}")
                time.sleep(2)
            else:
                print(f"  Warning: Could not resolve YouTube URL for '{search_title}' after {max_retries} attempts: {e}")
        
    # Fallback to search URL
    fallback_query = urllib.parse.quote(f"{search_title} BennJordan OR alphabasic")
    return f"https://www.youtube.com/results?search_query={fallback_query}"

_ffprobe_available = None
_duration_cache = {}

def is_ffprobe_available():
    global _ffprobe_available
    if _ffprobe_available is not None:
        return _ffprobe_available
    try:
        import shutil
        _ffprobe_available = shutil.which("ffprobe") is not None
    except Exception:
        _ffprobe_available = False
    return _ffprobe_available

def get_audio_duration(file_path):
    """
    Attempts to retrieve the duration of an audio/video file using ffprobe.
    Falls back to a fast, pure-Python MP3 and MP4/M4A duration parser if ffprobe is not available.
    Returns duration in seconds as a float, or None if it fails.
    """
    if not file_path or not os.path.exists(file_path):
        return None
    
    # Check memory cache first to avoid re-reading files
    if file_path in _duration_cache:
        return _duration_cache[file_path]
    
    duration = None

    # 1. Try ffprobe first (only if system has it)
    if is_ffprobe_available():
        try:
            import subprocess
            cmd = [
                "ffprobe", 
                "-v", "error", 
                "-show_entries", "format=duration", 
                "-of", "default=noprint_wrappers=1:nokey=1", 
                file_path
            ]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
            if result.returncode == 0:
                val = result.stdout.strip()
                if val:
                    duration = float(val)
        except Exception:
            pass

    # 2. Pure-Python Fallbacks for MP3 and MP4/M4A files
    if duration is None:
        _, ext = os.path.splitext(file_path.lower())
        
        if ext == ".mp3":
            try:
                with open(file_path, 'rb') as f:
                    data = f.read()
                idx = 0
                if len(data) < 10:
                    return None
                if data[:3] == b'ID3':
                    size = (data[6] << 21) | (data[7] << 14) | (data[8] << 7) | data[9]
                    idx = 10 + size
                
                total_duration = 0.0
                bitrates_v1_l3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
                bitrates_v2_l3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
                samplerates_v1 = [44100, 48000, 32000, 0]
                samplerates_v2 = [22050, 24000, 16000, 0]
                samplerates_v25 = [11025, 12000, 8000, 0]
                
                while True:
                    idx = data.find(b'\xff', idx)
                    if idx == -1 or idx >= len(data) - 4:
                        break
                    if (data[idx+1] & 0xE0) != 0xE0:
                        idx += 1
                        continue
                    version = (data[idx+1] & 0x18) >> 3
                    layer = (data[idx+1] & 0x06) >> 1
                    bitrate_idx = (data[idx+2] & 0xF0) >> 4
                    samplerate_idx = (data[idx+2] & 0x0C) >> 2
                    padding = (data[idx+2] & 0x02) >> 1
                    
                    if version == 0: samplerates = samplerates_v25
                    elif version == 2: samplerates = samplerates_v2
                    elif version == 3: samplerates = samplerates_v1
                    else:
                        idx += 1
                        continue
                        
                    samplerate = samplerates[samplerate_idx]
                    if samplerate == 0:
                        idx += 1
                        continue
                        
                    if version == 3: bitrates = bitrates_v1_l3
                    else: bitrates = bitrates_v2_l3
                    bitrate = bitrates[bitrate_idx] * 1000
                    if bitrate == 0:
                        idx += 1
                        continue
                        
                    if layer == 1: # Layer III
                        frame_length = 144 * bitrate // samplerate + padding
                        samples_per_frame = 1152 if version == 3 else 576
                    elif layer == 2: # Layer II
                        frame_length = 144 * bitrate // samplerate + padding
                        samples_per_frame = 1152
                    elif layer == 3: # Layer I
                        frame_length = (12 * bitrate // samplerate + padding) * 4
                        samples_per_frame = 384
                    else:
                        idx += 1
                        continue
                    if frame_length <= 0:
                        idx += 1
                        continue
                    total_duration += samples_per_frame / samplerate
                    idx += frame_length
                if total_duration > 0:
                    duration = total_duration
            except Exception:
                pass

        elif ext in (".mp4", ".m4a"):
            try:
                with open(file_path, 'rb') as f:
                    data = f.read()
                idx = data.find(b'mvhd')
                if idx != -1:
                    version = data[idx + 4]
                    if version == 0:
                        timescale = int.from_bytes(data[idx + 16: idx + 20], 'big')
                        duration_ticks = int.from_bytes(data[idx + 20: idx + 24], 'big')
                    elif version == 1:
                        timescale = int.from_bytes(data[idx + 24: idx + 28], 'big')
                        duration_ticks = int.from_bytes(data[idx + 28: idx + 36], 'big')
                    else:
                        timescale = 0
                    if timescale > 0:
                        duration = duration_ticks / timescale
            except Exception:
                pass

    _duration_cache[file_path] = duration
    return duration

def run_scan(music_dir, verbose=False):
    """
    Main execution function. Scans the local music directory, fetches metadata,
    resolves YouTube links, and outputs the final metadata.js file.
    """
    global typo_warnings, filename_warnings, naming_warnings
    typo_warnings = []
    filename_warnings = []
    naming_warnings = []
    optin_artists = load_optin_artists()

    # Map to store month metadata
    meta_map = {}

    # Sync from Google Sheets if needed so the sheet remains the master reference source.
    metadata_files = glob.glob(os.path.join(DATA_DIR, "metadata_*.csv"))
    if not metadata_files:
        print("No local metadata CSVs found; fetching the public Google Sheet metadata...")
        if download_sheet_metadata is not None:
            download_sheet_metadata(DATA_DIR)
        metadata_files = glob.glob(os.path.join(DATA_DIR, "metadata_*.csv"))

    # Parse CSV metadata files
    for filepath in metadata_files:
        filename = os.path.basename(filepath)
        match = re.search(r'metadata_(\d{4})', filename)
        if not match:
            continue
            
        year = match.group(1)
        print(f"Reading {filename}...")
        
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                # Read rows
                reader = csv.reader(f)
                rows = list(reader)
                
            # Dynamically discover start rows of blocks (scanning col 0 for starters)
            blocks = []
            for r_idx, row in enumerate(rows):
                if len(row) > 0 and row[0]:
                    val_clean = row[0].strip().upper()
                    if val_clean in ["JANUARY", "MAY", "SEPTEMBER"]:
                        blocks.append({
                            "start_row": r_idx,
                            "columns": range(4)
                        })
                        if verbose:
                            print(f"  Found block start at Row {r_idx + 1} (Month: {val_clean})")
                        
            for block in blocks:
                start_row = block["start_row"]
                
                for col_idx in block["columns"]:
                    col_offset = col_idx * 4
                    
                    # Check if we have enough elements in row
                    if len(rows[start_row]) > col_offset and rows[start_row][col_offset]:
                        month_name_raw = rows[start_row][col_offset].strip()
                        
                        if month_name_raw.upper() in MONTH_ORDER:
                            month_lower = month_name_raw.lower()
                            playlist_id = f"{year}-{month_lower}"
                            
                            # Extract stream URL
                            stream_raw = ""
                            if len(rows[start_row]) > col_offset + 1:
                                stream_raw = rows[start_row][col_offset + 1].strip()
                                
                            stream_url = ""
                            if stream_raw.startswith("http"):
                                stream_url = stream_raw
                            if not stream_url and stream_raw and download_sheet_metadata:
                                if verbose:
                                    print(f"    Resolving YouTube URL for: {stream_raw}")
                                stream_url = resolve_youtube_url(stream_raw)
                                if verbose:
                                    print(f"    -> {stream_url}")
                                
                            # Parse Theme & Keywords from Theme row (start_row + 1)
                            theme_text = ""
                            if len(rows) > start_row + 1 and len(rows[start_row + 1]) > col_offset:
                                theme_text = rows[start_row + 1][col_offset].strip()
                                
                            theme = ""
                            keywords = []
                            theme_match = re.search(r'Theme:\s*(.*?)(?:\.|\b)\s*Keywords:\s*(.*)$', theme_text, re.IGNORECASE)
                            if theme_match:
                                theme = theme_match.group(1).strip()
                                keywords_raw = theme_match.group(2).split(',')
                                keywords = [kw.strip().strip('.') for kw in keywords_raw if kw.strip()]
                            else:
                                theme_match_simple = re.search(r'Theme:\s*(.*)$', theme_text, re.IGNORECASE)
                                if theme_match_simple:
                                    theme = theme_match_simple.group(1).strip()
                                else:
                                    theme = theme_text
                                    
                            # Parse Optional Challenge from Challenge row (start_row + 2)
                            challenge_text = ""
                            if len(rows) > start_row + 2 and len(rows[start_row + 2]) > col_offset:
                                challenge_text = rows[start_row + 2][col_offset].strip()
                                
                            challenge = ""
                            challenge_match = re.search(r'Optional Challenge:\s*(.*)$', challenge_text, re.IGNORECASE)
                            if challenge_match:
                                challenge = challenge_match.group(1).strip()
                            else:
                                challenge = challenge_text
                                
                            # Parse track rows (from start_row + 4 onwards, up to the next block start)
                            track_entries = []
                            track_links = {}
                            end_row = min(start_row + 60, len(rows))
                            
                            for r_idx in range(start_row + 4, end_row):
                                # Stop if we hit the next block headers dynamically
                                is_next_block = False
                                for b in blocks:
                                    if b["start_row"] != start_row and r_idx == b["start_row"]:
                                        is_next_block = True
                                        break
                                if is_next_block:
                                    break
                                    
                                r = rows[r_idx]
                                if len(r) > col_offset + 2:
                                    artist_val = r[col_offset].strip() if r[col_offset] else ""
                                    title_val = r[col_offset + 1].strip() if r[col_offset + 1] else ""
                                    link_val = r[col_offset + 2].strip() if r[col_offset + 2] else ""
                                    
                                    if artist_val or title_val:
                                        match_key = f"{clean_string(artist_val)}-{clean_string(title_val)}"
                                        if link_val.startswith("http"):
                                            track_links[match_key] = link_val

                                        track_entries.append({
                                            "trackNo": len(track_entries) + 1,
                                            "artist": artist_val,
                                            "title": title_val,
                                            "link": link_val if link_val.startswith("http") else ""
                                        })
                                            
                            meta_map[playlist_id] = {
                                "theme": theme,
                                "keywords": keywords,
                                "challenge": challenge,
                                "tracks": track_entries,
                                "trackLinks": track_links,
                                "streamUrl": stream_url
                            }
        except Exception as e:
            print(f"Warning: Could not parse {filename}: {e}")

    print(f"Loaded metadata for {len(meta_map)} months from spreadsheet CSVs.")

    global sheet_artist_counts
    global raw_artist_counts
    sheet_artist_counts = {}
    raw_artist_counts = {}
    
    for entry in meta_map.values():
        for track in entry.get("tracks", []):
            art = track.get("artist")
            if art:
                # Add to raw artist counts for the new collab heuristic
                clean_raw = collab_utils.clean_string(art)
                if clean_raw:
                    raw_artist_counts[clean_raw] = raw_artist_counts.get(clean_raw, 0) + 1
                    
                # Legacy aggressive split count for typo fallbacks
                norm = re.sub(r'\b(feat|ft|and|with|vs|versus)\b\.?', '|', art, flags=re.IGNORECASE)
                parts = [p.strip() for p in re.split(r'[&;\|/,]', norm) if p.strip()]
                for p in parts:
                    clean_p = clean_string(p)
                    if clean_p:
                        sheet_artist_counts[clean_p] = sheet_artist_counts.get(clean_p, 0) + 1

    # Dynamically discover year directories (4-digit names) inside music_dir
    years = []
    if os.path.exists(music_dir):
        for entry in os.listdir(music_dir):
            if os.path.isdir(os.path.join(music_dir, entry)) and entry.isdigit() and len(entry) == 4:
                years.append(entry)
        years.sort()

    playlists = []

    # Scan music library folders and build playlists from either local files or sheet metadata.
    for year in years:
        year_path = os.path.join(music_dir, year)
        if os.path.exists(year_path):
            entries = os.listdir(year_path)
            folders = [e for e in entries if os.path.isdir(os.path.join(year_path, e)) and e.startswith("Sim_Selections_")]
            
            for folder in folders:
                folder_path = os.path.join(year_path, folder)
                parts = folder.replace("Sim_Selections_", "").split("_")
                month = parts[0]
                folder_year = parts[1] if len(parts) > 1 else year
                
                playlist_id = f"{folder_year}-{month.lower()}"
                playlist_name = f"{month.capitalize()} {folder_year}"
                
                files = sorted([f for f in os.listdir(folder_path) if os.path.isfile(os.path.join(folder_path, f)) and f.lower().endswith((".mp3", ".wav", ".flac", ".m4a", ".mp4", ".mkv", ".webm", ".ogg", ".mov", ".avi"))])
                meta = meta_map.get(playlist_id, {})
                playlist_entry = build_playlist_entry(
                    playlist_id=playlist_id,
                    playlist_name=playlist_name,
                    folder_year=folder_year,
                    month=month,
                    meta=meta,
                    folder_path=folder_path,
                    year=year,
                    folder_name=folder,
                    files=files,
                    optin_artists=optin_artists,
                )
                if playlist_entry:
                    playlists.append(playlist_entry)

    for playlist_id, meta in meta_map.items():
        parts = playlist_id.split("-", 1)
        if len(parts) != 2:
            continue

        year_value = parts[0]
        month = parts[1].upper()
        playlist_name = f"{month.capitalize()} {year_value}"
        playlist_entry = build_playlist_entry(
            playlist_id=playlist_id,
            playlist_name=playlist_name,
            folder_year=year_value,
            month=month,
            meta=meta,
            folder_path=None,
            year=year_value,
            folder_name="",
            files=[],
            optin_artists=optin_artists,
        )
        if playlist_entry:
            existing_ids = {p["id"] for p in playlists}
            if playlist_id not in existing_ids:
                playlists.append(playlist_entry)

    # Sort playlists chronologically
    playlists.sort(key=lambda p: (p["year"], MONTH_ORDER.get(p["month"].upper(), 99)))

    # Scan track durations in parallel using up to 16 threads
    if music_dir and os.path.exists(music_dir):
        tracks_to_scan = []
        file_paths = []
        for playlist in playlists:
            for track in playlist.get("tracks", []):
                file_rel = track.get("file")
                if file_rel:
                    file_abs = os.path.join(music_dir, file_rel)
                    tracks_to_scan.append(track)
                    file_paths.append(file_abs)
                    
        if file_paths:
            with ThreadPoolExecutor(max_workers=16) as executor:
                durations = list(executor.map(get_audio_duration, file_paths))
            
            scanned_count = 0
            for track, dur in zip(tracks_to_scan, durations):
                if dur is not None:
                    track["length"] = round(dur, 2)
                    scanned_count += 1
            if scanned_count > 0:
                print(f"Scanned and matched {scanned_count} actual track durations directly into metadata.")
            else:
                print("Warning: No local track durations could be scanned.")
        else:
            print("Warning: No local tracks found to scan.")
    else:
        print("Warning: No music directory configured. Skipping duration scanning.")

    # Add canonical_artists to each track using the dynamic heuristic
    for p in playlists:
        for t in p.get("tracks", []):
            if t.get("artist"):
                t["canonical_artists"] = collab_utils.get_canonical_artists_for_track(t["artist"], raw_artist_counts)

    # Output to metadata.js
    output_content = f"""// Auto-generated by scanner.py
export const playlistData = {json.dumps(playlists, indent=4)};
if (typeof module !== 'undefined') {{
    module.exports = playlistData;
}}
"""

    output_path = os.path.join(PROJECT_ROOT, "src", "metadata.js")
    if not os.path.exists(os.path.dirname(output_path)):
        output_path = os.path.join(PROJECT_ROOT, "metadata.js")
    with open(output_path, "w", encoding="utf-8") as out_f:
        out_f.write(output_content)

    print(f"Successfully scanned and wrote {len(playlists)} playlists to metadata.js with full Google Sheets metadata and track links!")

    # Print Suspected Typos / Metadata Mismatches in Google Sheet
    if typo_warnings:
        print("\n=== SUSPECTED TYPOS IN GOOGLE SHEET (Fixable) ===")
        for w in sorted(set(typo_warnings)):
            print(f"  WARNING: {w}")

    new_typos = collab_utils.find_typos(raw_artist_counts)
    if new_typos:
        print("\n=== ORPHANED ARTIST PROFILE ALERTS (Very similar names detected) ===")
        for w in new_typos:
            print(f"  ALERT: {w}")

    # Print Suspected Errors in Filename
    if filename_warnings:
        print("\n=== SUSPECTED TYPOS IN FILENAME (Immutable - Matched correctly anyway) ===")
        for w in sorted(set(filename_warnings)):
            print(f"  WARNING: {w}")

    # Print Naming Scheme / Collaborator Differences
    if naming_warnings:
        print("\n=== COLLABORATOR / NAMING SCHEME DIFFERENCES (Matched & Playable - No action required) ===")
        for w in sorted(set(naming_warnings)):
            print(f"  WARNING: {w}")


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description="Scan local directories for MP3 files matching spreadsheet data.")
    parser.add_argument("--music-file-path", default=os.environ.get("music-file-path", ""), help="Path to music library folder")
    parser.add_argument("--verbose", "-v", action="store_true", help="Print verbose output (parsing and URL resolution details)")
    args, _ = parser.parse_known_args()
    MUSIC_DIR = args.music_file_path
    if not MUSIC_DIR:
        print("Warning: Music directory path is not configured. Please set music-file-path environment variable or pass --music-file-path if local audio scanning is needed.")
        
    run_scan(MUSIC_DIR, verbose=args.verbose)
