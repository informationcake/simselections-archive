"""
collab_utils.py

This module provides shared text-processing utilities for the SimSelections project.
It is primarily responsible for cleaning and splitting multi-artist collaboration 
strings (e.g., "Artist A feat. Artist B") into atomic artist entities. 

These utilities are shared across multiple scripts (such as scanner.py and 
compile_discord_map.py) to ensure that artist names are consistently parsed and 
normalized both when building the website's metadata and when compiling the 
Discord identity map.
"""

import re
import difflib

def clean_string(s):
    if not s: return ""
    return re.sub(r'[^a-z0-9]', '', s.lower())

def split_collaborators(artist_str, artist_counts=None):
    """
    Splits multi-artist strings into individual artist names dynamically.
    If artist_counts is provided (a dict mapping clean_string(artist) -> count),
    it will use a heuristic to avoid splitting band names that contain 'and' (like "Thomas and the Evil Computer")
    unless one of the constituent parts exists as a standalone artist.
    """
    if not artist_str:
        return []
    
    def strip_safe_parens(match):
        content = match.group(0)
        inner = content[1:-1].strip()
        if bool(re.search(r'[/&;]', content)): return content
        if bool(re.search(r'\b(feat|ft)\b', inner, re.IGNORECASE)): return "|"
        if artist_counts and clean_string(inner) in artist_counts: return "|"
        return ""
    
    s_no_paren = re.sub(r'\(.*?\)', strip_safe_parens, artist_str)
    
    # Check for any collab delimiters
    if not bool(re.search(r'\b(feat|ft|and|with|vs|versus|x)\b|[&;\|/,]', s_no_paren, re.IGNORECASE)):
        return [artist_str.strip()]

    # Temporarily replace parenthetical content so we don't split on things inside them
    parens = []
    def save_paren(match):
        content = match.group(0)
        inner = content[1:-1].strip()
        if bool(re.search(r'[/&;]', content)):
            return "|" + inner + "|"
        if bool(re.search(r'\b(feat|ft)\b', inner, re.IGNORECASE)):
            return "|" + inner + "|"
        if artist_counts and clean_string(inner) in artist_counts:
            return "|" + inner + "|"
            
        parens.append(content)
        return f"__PAREN_{len(parens)-1}__"
    
    protected = re.sub(r'\(.*?\)', save_paren, artist_str)
    
    # Split
    norm = re.sub(r'\b(feat|ft|and|with|vs|versus|x)\b\.?', '|', protected, flags=re.IGNORECASE)
    parts = [p.strip() for p in re.split(r'[&;\|/,]', norm) if p.strip()]
    
    restored_parts = []
    for p in parts:
        for idx, orig in enumerate(parens):
            p = p.replace(f"__PAREN_{idx}__", orig)
        if p.strip():
            restored_parts.append(p.strip())

    # If we have frequency counts, use heuristic for ambiguous splits ('and', '&')
    # If the delimiter was 'feat', 'ft', 'vs', it's almost certainly a collab, but to be safe, 
    # we'll use the heuristic globally: if the parts don't exist standalone, maybe the whole thing is one band.
    # Actually, we should always split 'feat' or 'vs', but let's see if the entire string appears as standalone
    if artist_counts and len(restored_parts) > 1:
        is_collab = False
        for p in restored_parts:
            cp = clean_string(p)
            if cp in artist_counts and cp != clean_string(artist_str):
                is_collab = True
                break
        
        if not is_collab:
            # None of the parts exist standalone! Keep it intact as a band name.
            return [artist_str.strip()]

    return restored_parts

def get_canonical_artists_for_track(artist_str, artist_counts):
    """
    Returns a list of CLEAN canonical artist strings for a track.
    """
    if not artist_str:
        return []
    
    parts = split_collaborators(artist_str, artist_counts)
    return [clean_string(p) for p in parts if clean_string(p)]

def find_typos(artist_counts):
    """
    Compares all canonical standalone artists and returns a list of warnings
    for artists that are extremely similar (likely typos).
    Uses a very strict threshold to avoid false positives between distinct artists with similar names.
    """
    warnings = []
    artists = sorted(list(artist_counts.keys()))
    
    for i in range(len(artists)):
        for j in range(i+1, len(artists)):
            a1 = artists[i]
            a2 = artists[j]
            
            # Skip very short names to prevent noise
            if len(a1) < 5 or len(a2) < 5:
                continue
            
            # Use ratio > 0.94 (very strict) to catch 1-character typos in long strings 
            # while ignoring valid distinct artists that happen to share a word.
            ratio = difflib.SequenceMatcher(None, a1, a2).ratio()
            if ratio > 0.94:
                warnings.append(f"Similar artist names detected: '{a1}' and '{a2}' (Ratio: {ratio:.2f}). These might be fragmented in the database.")
                
    return warnings
