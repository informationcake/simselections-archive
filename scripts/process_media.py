"""
process_media.py

This script processes original media files from the input directory into highly-optimized web delivery formats.
- Audio tracks are chunked into 10-second AES-128 encrypted HLS segments (.ts / index.m3u8).
- Video tracks are downscaled (max 1080p), compressed (H.264/AAC), and also chunked into AES-128 HLS segments.
- Original files in the input directory are left completely untouched.
- Outputs are written securely to the encrypted directory.
"""
import os
import sys
import shutil
import subprocess
import argparse
import secrets
from dotenv import load_dotenv

load_dotenv()

def process_audio(input_file, rel_path, out_dir):
    """Encrypts audio using AES-128 HLS.
    Original file remains entirely unmodified in the input directory.
    Output is written to the output directory as chunked .ts and .m3u8 files."""
    # Output is a folder named after the track (without extension)
    base_name = os.path.splitext(os.path.basename(input_file))[0]
    track_out_dir = os.path.join(out_dir, os.path.dirname(rel_path), base_name)
    os.makedirs(track_out_dir, exist_ok=True)
    
    # Generate a random 16-byte key
    key = secrets.token_bytes(16)
    key_file = os.path.join(track_out_dir, "key.key")
    with open(key_file, "wb") as f:
        f.write(key)
        
    # Create keyinfo file for ffmpeg
    keyinfo_file = os.path.join(track_out_dir, "encryption.keyinfo")
    with open(keyinfo_file, "w") as f:
        f.write(f"key.key\n{key_file}\n")
        
    m3u8_file = os.path.join(track_out_dir, "index.m3u8")
    segment_pattern = os.path.join(track_out_dir, "chunk_%03d.ts")
    
    print(f"Encrypting audio: {rel_path} -> {m3u8_file}")
    
    cmd = [
        "ffmpeg", "-y", "-i", input_file,
        "-c:a", "libmp3lame", "-b:a", "320k",
        "-hls_time", "10",
        "-hls_key_info_file", keyinfo_file,
        "-hls_playlist_type", "vod",
        "-hls_segment_filename", segment_pattern,
        m3u8_file
    ]
    
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.remove(keyinfo_file)
    except subprocess.CalledProcessError as e:
        print(f"Error processing audio {input_file}: {e}")

def process_video(input_file, rel_path, out_dir):
    """Compresses video into AES-128 encrypted HLS chunks.
    Original video file remains entirely unmodified in the input directory.
    Output is written to the output directory as chunked .ts and .m3u8 files."""
    # Output is a folder named after the track (without extension)
    base_name = os.path.splitext(os.path.basename(input_file))[0]
    track_out_dir = os.path.join(out_dir, os.path.dirname(rel_path), base_name)
    os.makedirs(track_out_dir, exist_ok=True)
    
    # Generate a random 16-byte key
    key = secrets.token_bytes(16)
    key_file = os.path.join(track_out_dir, "key.key")
    with open(key_file, "wb") as f:
        f.write(key)
        
    # Create keyinfo file for ffmpeg
    keyinfo_file = os.path.join(track_out_dir, "encryption.keyinfo")
    with open(keyinfo_file, "w") as f:
        f.write(f"key.key\n{key_file}\n")
        
    m3u8_file = os.path.join(track_out_dir, "index.m3u8")
    segment_pattern = os.path.join(track_out_dir, "chunk_%03d.ts")
    
    print(f"Encrypting video: {rel_path} -> {m3u8_file}")
    
    # HLS Video compression: limits resolution to 1080p max, maintains aspect ratio
    # 24fps, capped at 2Mbps, 5s chunks, forced keyframes every 5s
    cmd = [
        "ffmpeg", "-y", "-i", input_file,
        "-vf", "scale=-2:'min(1080,ih)'",
        "-c:v", "libx264", "-crf", "28", "-preset", "fast",
        "-r", "24",
        "-maxrate", "2M", "-bufsize", "4M",
        "-g", "120", "-keyint_min", "120", "-sc_threshold", "0",
        "-c:a", "aac", "-b:a", "320k",
        "-hls_time", "5",
        "-hls_key_info_file", keyinfo_file,
        "-hls_playlist_type", "vod",
        "-hls_segment_filename", segment_pattern,
        m3u8_file
    ]
    
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.remove(keyinfo_file)
    except subprocess.CalledProcessError as e:
        print(f"Error compressing video {input_file}: {e}")

def main():
    parser = argparse.ArgumentParser(description="Process media into web-ready formats. Encrypts audio into HLS chunks and compresses video to MP4. Original files are left untouched.")
    parser.add_argument("--input-dir", default=os.getenv("SIMSELECTIONS_INPUT_DIR"), help="Input directory")
    parser.add_argument("--output-dir", default=os.getenv("SIMSELECTIONS_ENCRYPTED_DIR"), help="Output directory")
    args = parser.parse_args()
    
    if not args.input_dir or not args.output_dir:
        print("Error: Missing directory paths. Set them in .env (SIMSELECTIONS_INPUT_DIR, SIMSELECTIONS_ENCRYPTED_DIR) or pass them as arguments.")
        sys.exit(1)
    
    in_dir = os.path.abspath(args.input_dir)
    out_dir = os.path.abspath(args.output_dir)
    
    if not os.path.exists(in_dir):
        print(f"Error: Input directory {in_dir} does not exist.")
        sys.exit(1)
        
    print(f"Scanning {in_dir}...")
    
    audio_exts = {'.mp3', '.wav', '.flac', '.aac', '.m4a'}
    video_exts = {'.mp4', '.webm', '.mov', '.ogg', '.mkv', '.avi'}
    
    count_audio = 0
    count_video = 0
    
    for root, _, files in os.walk(in_dir):
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            input_file = os.path.join(root, file)
            rel_path = os.path.relpath(input_file, in_dir)
            
            if ext in audio_exts:
                process_audio(input_file, rel_path, out_dir)
                count_audio += 1
            elif ext in video_exts:
                process_video(input_file, rel_path, out_dir)
                count_video += 1
                
    print(f"\nProcessing complete!")
    print(f"Audio files encrypted: {count_audio}")
    print(f"Video files compressed: {count_video}")

if __name__ == "__main__":
    main()
