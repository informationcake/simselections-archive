import os
import boto3
from botocore.config import Config
from dotenv import load_dotenv

load_dotenv()

R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME")

s3 = boto3.client(
    's3',
    endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    config=Config(signature_version='s3v4'),
    region_name='auto'
)

def cleanup():
    print(f"Fetching objects in {R2_BUCKET_NAME} to delete legacy raw files...")
    paginator = s3.get_paginator('list_objects_v2')
    pages = paginator.paginate(Bucket=R2_BUCKET_NAME)
    
    to_delete = []
    
    for page in pages:
        if 'Contents' in page:
            for obj in page['Contents']:
                key = obj['Key']
                ext = key.split('.')[-1].lower()
                if ext in ['mp3', 'mp4', 'wav', 'ogg', 'flac', 'm4a', 'webm']:
                    to_delete.append({'Key': key})
                    print(f"Marking for deletion: {key}")

    if not to_delete:
        print("No legacy files found to delete.")
        return

    print(f"Deleting {len(to_delete)} legacy files...")
    
    # Delete in batches of 1000 (S3 limit)
    for i in range(0, len(to_delete), 1000):
        batch = to_delete[i:i+1000]
        s3.delete_objects(
            Bucket=R2_BUCKET_NAME,
            Delete={'Objects': batch, 'Quiet': True}
        )
        print(f"Deleted batch of {len(batch)} files.")

    print("Cleanup complete!")

if __name__ == '__main__':
    cleanup()
