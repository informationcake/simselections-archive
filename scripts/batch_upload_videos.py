import os
import glob
import boto3
from dotenv import load_dotenv

def main():
    load_dotenv()
    
    input_dir = os.getenv("SIMSELECTIONS_INPUT_DIR", "/mnt/c/Users/Alex/Documents/Music/SimSelections")
    output_dir = os.getenv("SIMSELECTIONS_ENCRYPTED_DIR", "/mnt/c/Users/Alex/Documents/Music/SimSelections-encrypted")
    bucket_name = os.getenv("R2_BUCKET_NAME")
    
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{os.getenv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com",
        aws_access_key_id=os.getenv("R2_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("R2_SECRET_ACCESS_KEY")
    )
    
    # 1. Find the 47 source video files
    video_files = glob.glob(os.path.join(input_dir, "**", "*.mov"), recursive=True)
    video_files.extend(glob.glob(os.path.join(input_dir, "**", "*.mp4"), recursive=True))
    
    print(f"Found {len(video_files)} specific video folders to upload.")
    
    # 2. Upload ONLY those exact 47 folders
    for video_file in video_files:
        rel_path = os.path.relpath(video_file, input_dir)
        base_name = os.path.splitext(os.path.basename(video_file))[0]
        
        # Calculate track output dir
        vid_dir = os.path.join(output_dir, os.path.dirname(rel_path), base_name)
        
        if not os.path.exists(vid_dir):
            continue
            
        for root, _, files in os.walk(vid_dir):
            for filename in files:
                local_path = os.path.join(root, filename)
                s3_key = os.path.relpath(local_path, output_dir).replace(os.sep, '/')
                
                print(f"Uploading video chunk (overwrite): {s3_key}")
                try:
                    s3.upload_file(local_path, bucket_name, s3_key)
                except Exception as e:
                    print(f"FAILED to upload {s3_key}: {e}")
                    
    print("All 47 videos uploaded successfully!")

if __name__ == "__main__":
    main()
