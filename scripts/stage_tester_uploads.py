import os
import json
import shutil
import argparse
import toml

def get_testers_from_wrangler():
    with open("wrangler.toml", "r") as f:
        data = toml.load(f)
    testers_str = data.get("vars", {}).get("DISCORD_TESTERS", "")
    return [t.strip().lower() for t in testers_str.split(",") if t.strip()]

def get_tester_artists(testers):
    with open("data/artist_discord_map.json", "r") as f:
        discord_map = json.load(f)
    
    artists = discord_map.get("artists", {})
    tester_artists = set()
    
    for clean_name, data in artists.items():
        handles = data.get("handles", [])
        for handle in handles:
            h = handle.lower().split("#")[0]
            if h in testers:
                tester_artists.add(clean_name)
                break
    return tester_artists

def main():
    parser = argparse.ArgumentParser(description="Stage music files for testers")
    parser.add_argument("--music-file-path", type=str, required=True, help="Path to the music directory")
    args = parser.parse_args()
    
    music_dir = args.music_file_path
    staging_dir = os.path.join(os.getcwd(), "r2_upload_temp")
    
    # 1. Get testers
    testers = get_testers_from_wrangler()
    print(f"Found testers in wrangler.toml: {testers}")
    
    # 2. Get canonical artists for testers
    tester_artists = get_tester_artists(testers)
    print(f"Mapped to canonical artists: {tester_artists}")
    
    # 3. Read metadata.js
    metadata_path = "src/metadata.js"
    with open(metadata_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Basic extraction of the JSON array from metadata.js
    start_idx = content.find("=") + 1
    end_idx = content.rfind("];") + 1
    if end_idx == -1: end_idx = len(content)
    
    json_str = content[start_idx:end_idx].strip()
    try:
        playlists = json.loads(json_str)
    except Exception as e:
        print(f"Error parsing metadata.js: {e}")
        return

    # 4. Find and stage tracks
    staged_count = 0
    if os.path.exists(staging_dir):
        shutil.rmtree(staging_dir)
    os.makedirs(staging_dir, exist_ok=True)
    
    for playlist in playlists:
        tracks = playlist.get("tracks", [])
        for track in tracks:
            canon_artists = track.get("canonical_artists", [])
            # Check if any of the track's canonical artists are in our tester list
            if any(a in tester_artists for a in canon_artists):
                file_rel_path = track.get("file", "")
                if not file_rel_path:
                    continue
                    
                src_path = os.path.join(music_dir, file_rel_path)
                if os.path.exists(src_path):
                    dst_path = os.path.join(staging_dir, file_rel_path)
                    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
                    shutil.copy2(src_path, dst_path)
                    staged_count += 1
                else:
                    print(f"File missing on disk: {src_path}")
                    
    print(f"\nDone! Staged {staged_count} tracks for testers into: {staging_dir}")
    print("You can now drag and drop the folders inside 'r2_upload_temp' directly into your R2 bucket.")

if __name__ == "__main__":
    main()
