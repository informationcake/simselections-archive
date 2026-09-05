import os
import sys
import shutil
import subprocess
import argparse
import secrets
from dotenv import load_dotenv

load_dotenv()

def process_audio(input_file, rel_path, out_dir):
    """Encrypts audio using AES-128 HLS."""
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
    """Compresses video into the output directory."""
    out_file = os.path.join(out_dir, rel_path)
    # Ensure it's an mp4 output
    out_file = os.path.splitext(out_file)[0] + ".mp4"
    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    
    print(f"Compressing video: {rel_path} -> {out_file}")
    
    # Basic compression: h264, CRF 28, fast preset
    cmd = [
        "ffmpeg", "-y", "-i", input_file,
        "-c:v", "libx264", "-crf", "28", "-preset", "fast",
        "-c:a", "aac", "-b:a", "128k",
        out_file
    ]
    
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
    except subprocess.CalledProcessError as e:
        print(f"Error compressing video {input_file}: {e}")

def main():
    parser = argparse.ArgumentParser(description="Process media into HLS encrypted chunks and compress videos.")
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
