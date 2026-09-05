import os
import json
import shutil
import re
import argparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
METADATA_PATH = os.path.join(ROOT, "src", "metadata.js")
TEMP_UPLOAD_DIR = os.path.join(ROOT, "r2_upload_temp")

def main():
    # Parse command line arguments
    parser = argparse.ArgumentParser(description="Stage opted-in tracks for R2 upload")
    parser.add_argument("--music-file-path", help="Path to your local music directory")
    args = parser.parse_args()

    # 1. Read metadata.js
    if not os.path.exists(METADATA_PATH):
        print(f"Error: {METADATA_PATH} not found. Run the scanner first.")
        return

    with open(METADATA_PATH, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Extract the playlistData array using regex
    match = re.search(r'export const playlistData\s*=\s*([\s\S]*?);\s*if', content)
    if not match:
        print("Error: Could not extract playlistData from metadata.js")
        return
        
    json_str = match.group(1).strip()
    try:
        playlists = json.loads(json_str)
    except Exception as e:
        print("Error parsing JSON metadata:", e)
        return

    # 2. Get local music directory path
    music_dir = args.music_file_path or os.environ.get("music-file-path")
    if not music_dir:
        music_dir = input("Enter the path to your local music directory (e.g. /mnt/c/...): ").strip()
        
    if not os.path.exists(music_dir):
        print(f"Error: Directory '{music_dir}' does not exist.")
        return

    # 3. Reset the temp directory
    if os.path.exists(TEMP_UPLOAD_DIR):
        shutil.rmtree(TEMP_UPLOAD_DIR)
    os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)

    # 4. Copy opted-in files
    copied_count = 0
    missing_count = 0
    print(f"Loaded {len(playlists)} playlists")
    
    for playlist in playlists:
        for track in playlist.get("tracks", []):
            if track.get("optIn") and track.get("file"):
                src_rel = track["file"]
                src_abs = os.path.join(music_dir, src_rel)
                
                if os.path.exists(src_abs):
                    dest_abs = os.path.join(TEMP_UPLOAD_DIR, src_rel)
                    os.makedirs(os.path.dirname(dest_abs), exist_ok=True)
                    shutil.copy2(src_abs, dest_abs)
                    copied_count += 1
                else:
                    print(f"Warning: Opted-in track missing locally: {src_rel}")
                    missing_count += 1

    print(f"\nDone! Staged {copied_count} opted-in tracks in: {TEMP_UPLOAD_DIR}")
    if missing_count > 0:
        print(f"Note: {missing_count} tracks were opted-in but could not be found locally.")
    print("\nYou can now drag and drop the folders inside 'r2_upload_temp' directly into your R2 bucket.")

if __name__ == "__main__":
    main()
