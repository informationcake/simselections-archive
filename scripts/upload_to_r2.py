import os
import boto3
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

# Initialize boto3 S3 client with Cloudflare R2 configurations
s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    config=Config(signature_version="s3v4"),
    region_name="auto",
)

def get_existing_objects(bucket_name):
    """Retrieve all object keys currently in the bucket to avoid re-uploading."""
    keys = set()
    paginator = s3.get_paginator('list_objects_v2')
    pages = paginator.paginate(Bucket=bucket_name)
    for page in pages:
        if 'Contents' in page:
            for obj in page['Contents']:
                keys.add(obj['Key'])
    return keys

def upload_directory(local_dir, bucket_name):
    print(f"Fetching existing files from R2 bucket '{bucket_name}'...")
    existing_keys = get_existing_objects(bucket_name)
    print(f"Found {len(existing_keys)} existing files in bucket.")
    
    upload_count = 0
    skip_count = 0
    
    for root, dirs, files in os.walk(local_dir):
        for filename in files:
            local_path = os.path.join(root, filename)
            # Create S3 key by removing the local_dir prefix
            # E.g., 'r2_upload_temp/2023/Sim_Selections_JUNE_2023/info.mp3' -> '2023/Sim_Selections_JUNE_2023/info.mp3'
            relative_path = os.path.relpath(local_path, local_dir)
            s3_key = relative_path.replace(os.sep, '/')  # Ensure forward slashes for S3 keys
            
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

if __name__ == "__main__":
    LOCAL_UPLOAD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "r2_upload_temp"))
    if not os.path.exists(LOCAL_UPLOAD_DIR):
        print(f"Error: Directory not found: {LOCAL_UPLOAD_DIR}")
        exit(1)
        
    upload_directory(LOCAL_UPLOAD_DIR, R2_BUCKET_NAME)
