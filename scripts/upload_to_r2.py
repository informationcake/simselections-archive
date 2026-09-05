"""
upload_to_r2.py

This script safely deploys the processed, web-ready media from the encrypted directory 
to the production Cloudflare R2 bucket.
- Uses whitelist filtering to only upload tracks belonging to allowed Discord testers.
- Fetches existing keys from R2 to prevent redundant uploads and save bandwidth.
"""
import os
import boto3
import argparse
import json
import toml
from botocore.config import Config
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# R2 Credentials
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME")

if not all([R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID, R2_BUCKET_NAME]):
    print("Error: Missing R2 credentials in .env file.")
    exit(1)

ENDPOINT_URL = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

# Initialize boto3 S3 client
s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    config=Config(signature_version="s3v4"),
    region_name="auto",
)

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

def get_whitelisted_paths():
    """Returns a set of base directories that are allowed to be uploaded."""
    testers = get_testers_from_wrangler()
    tester_artists = get_tester_artists(testers)
    
    with open("src/metadata.js", "r", encoding="utf-8") as f:
        content = f.read()
        
    start_idx = content.find("=") + 1
    end_idx = content.rfind("];") + 1
    if end_idx == -1: end_idx = len(content)
    
    json_str = content[start_idx:end_idx].strip()
    playlists = json.loads(json_str)
    
    allowed_dirs = set()
    
    for playlist in playlists:
        tracks = playlist.get("tracks", [])
        for track in tracks:
            canon_artists = track.get("canonical_artists", [])
            if any(a in tester_artists for a in canon_artists):
                file_rel = track.get("file", "")
                if file_rel:
                    # e.g., '2025/.../song.mp3' -> '2025/.../song'
                    base_dir = os.path.splitext(file_rel)[0].replace("\\", "/")
                    allowed_dirs.add(base_dir)
    return allowed_dirs

def get_existing_objects(bucket_name):
    keys = set()
    paginator = s3.get_paginator('list_objects_v2')
    pages = paginator.paginate(Bucket=bucket_name)
    for page in pages:
        if 'Contents' in page:
            for obj in page['Contents']:
                keys.add(obj['Key'])
    return keys

def is_path_allowed(s3_key, allowed_dirs):
    """Check if the given s3_key falls under any of the allowed base directories."""
    # s3_key might be '2025/.../song/index.m3u8'
    # we check if it starts with '2025/.../song'
    for d in allowed_dirs:
        if s3_key.startswith(d):
            return True
    return False

def upload_directory(local_dir, bucket_name, whitelist_only=False):
    print(f"Fetching existing files from R2 bucket '{bucket_name}'...")
    existing_keys = get_existing_objects(bucket_name)
    print(f"Found {len(existing_keys)} existing files in bucket.")
    
    allowed_dirs = set()
    if whitelist_only:
        allowed_dirs = get_whitelisted_paths()
        print(f"Whitelist mode ON. Found {len(allowed_dirs)} allowed track folders.")
    
    upload_count = 0
    skip_count = 0
    
    for root, dirs, files in os.walk(local_dir):
        for filename in files:
            local_path = os.path.join(root, filename)
            relative_path = os.path.relpath(local_path, local_dir)
            s3_key = relative_path.replace(os.sep, '/')
            
            if whitelist_only and not is_path_allowed(s3_key, allowed_dirs):
                continue
            
            if s3_key in existing_keys:
                print(f"Skipping (already exists): {s3_key}")
                skip_count += 1
                continue
                
            print(f"Uploading: {s3_key}")
            try:
                s3.upload_file(local_path, bucket_name, s3_key)
                upload_count += 1
            except Exception as e:
                print(f"Failed to upload {s3_key}: {e}")
                
    print(f"\nUpload complete! Uploaded {upload_count} files, skipped {skip_count} existing files.")

def main():
    parser = argparse.ArgumentParser(description="Upload processed web-ready media (HLS audio chunks & MP4 videos) to Cloudflare R2")
    parser.add_argument("--input-dir", default=os.getenv("SIMSELECTIONS_ENCRYPTED_DIR"), help="Directory containing the processed delivery files")
    parser.add_argument("--whitelist-only", action="store_true", help="Only upload tracks belonging to whitelisted tester artists")
    args = parser.parse_args()
    
    if not args.input_dir:
        print("Error: Missing input directory. Set SIMSELECTIONS_ENCRYPTED_DIR in .env or pass --input-dir.")
        exit(1)

    if not os.path.exists(args.input_dir):
        print(f"Error: Directory not found: {args.input_dir}")
        exit(1)
        
    upload_directory(args.input_dir, R2_BUCKET_NAME, args.whitelist_only)

if __name__ == "__main__":
    main()
