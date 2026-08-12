#!/usr/bin/env python3
import urllib.request
import urllib.parse
import re
import os
import glob
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(PROJECT_ROOT, "data")

# URL of sheet htmlview
URL = "https://docs.google.com/spreadsheets/d/15snlcc09WOV4PZj_W2aOCA9zyIFJQ6YKlGVYPuz77iI/htmlview"
SHEET_ID = "15snlcc09WOV4PZj_W2aOCA9zyIFJQ6YKlGVYPuz77iI"


def download_sheet_metadata(output_dir=DATA_DIR):
    """
    Fetches playlist metadata and configurations from the public Google Sheet CSV exports,
    and caches them locally for the scanner.
    """
    os.makedirs(output_dir, exist_ok=True)
    req = urllib.request.Request(URL, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as response:
            html = response.read().decode('utf-8')
    except Exception as e:
        print(f"Failed to fetch spreadsheet htmlview: {e}")
        return []

    pattern = r'name:\s*"([^"]+)",\s*pageUrl:\s*"[^"]+",\s*gid:\s*"([^"]+)"'
    matches = re.findall(pattern, html)

    print(f"Found {len(matches)} tab items in the spreadsheet.")

    if not matches:
        print("No tabs found via regex. The HTML structure might have changed.")
        return []

    for f in glob.glob(os.path.join(output_dir, "metadata_*.csv")):
        try:
            os.remove(f)
        except OSError:
            pass

    downloaded_files = []
    for name, gid in matches:
        try:
            name = bytes(name, "utf-8").decode("unicode_escape")
        except Exception:
            pass

        clean_name = re.sub(r'[\\/*?:"<>|]', '_', name)
        print(f"Exporting tab '{name}' (GID: {gid})...")

        csv_url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={gid}&cachebust={int(time.time())}"
        output_path = os.path.join(output_dir, f"metadata_{clean_name}.csv")

        try:
            csv_req = urllib.request.Request(csv_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(csv_req) as csv_resp:
                with open(output_path, 'wb') as out_f:
                    out_f.write(csv_resp.read())
            downloaded_files.append(output_path)
            print(f"Saved to {output_path}")
        except Exception as e:
            print(f"Failed to download tab '{name}': {e}")

    print("All tabs downloaded successfully!")
    return downloaded_files


if __name__ == "__main__":
    download_sheet_metadata()
