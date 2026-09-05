import os
import boto3
from botocore.config import Config
from dotenv import load_dotenv

load_dotenv()

R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_BUCKET_NAME = os.getenv("R2_BUCKET_NAME")

ENDPOINT_URL = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT_URL,
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    config=Config(signature_version="s3v4"),
    region_name="auto",
)

local_file = "/mnt/c/Users/Alex/Documents/Music/SimSelections/2023/Sim_Selections_JUNE_2023/informationcake - Aurora Simulation.mp4"
r2_key = "2023/Sim_Selections_JUNE_2023/informationcake - Aurora Simulation.mp4"

print(f"Uploading {local_file} to {R2_BUCKET_NAME}/{r2_key}...")
s3.upload_file(
    local_file, 
    R2_BUCKET_NAME, 
    r2_key,
    ExtraArgs={"ContentType": "video/mp4"}
)
print("Uploaded successfully.")
