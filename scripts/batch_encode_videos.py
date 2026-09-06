import os
import glob
import shutil
import process_media
from dotenv import load_dotenv

def main():
    load_dotenv()
    
    input_dir = os.getenv("SIMSELECTIONS_INPUT_DIR", "/mnt/c/Users/Alex/Documents/Music/SimSelections")
    output_dir = os.getenv("SIMSELECTIONS_ENCRYPTED_DIR", "/mnt/c/Users/Alex/Documents/Music/SimSelections-encrypted")
    
    # Find all .mov and .mp4 files
    video_files = glob.glob(os.path.join(input_dir, "**", "*.mov"), recursive=True)
    video_files.extend(glob.glob(os.path.join(input_dir, "**", "*.mp4"), recursive=True))
    
    total = len(video_files)
    print(f"Found {total} video files to process.")
    
    for i, video_file in enumerate(video_files, 1):
        rel_path = os.path.relpath(video_file, input_dir)
        base_name = os.path.splitext(os.path.basename(video_file))[0]
        
        # Calculate track output dir
        track_out_dir = os.path.join(output_dir, os.path.dirname(rel_path), base_name)
        
        print(f"[{i}/{total}] Processing: {rel_path}")
        
        # Skip Aurora Simulation because we already did it perfectly
        if "Aurora Simulation" in base_name:
            print("Skipping Aurora Simulation (already done).")
            continue
            
        # Clean existing local chunks so we don't end up with lingering old chunks
        if os.path.exists(track_out_dir):
            for f in glob.glob(os.path.join(track_out_dir, "chunk_*.ts")):
                try:
                    os.remove(f)
                except OSError as e:
                    print(f"Error removing {f}: {e}")
                    
        # Re-encode using process_media settings
        try:
            process_media.process_video(video_file, rel_path, output_dir)
            print(f"Successfully finished {base_name}")
        except Exception as e:
            print(f"FAILED to process {base_name}: {e}")

if __name__ == "__main__":
    main()
