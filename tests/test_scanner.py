import importlib.util
from pathlib import Path
from unittest.mock import patch, MagicMock, mock_open


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "scanner.py"

spec = importlib.util.spec_from_file_location("scanner", MODULE_PATH)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


def test_sheet_tracks_create_playlist_even_without_local_folder():
    playlist = scanner.build_playlist_entry(
        playlist_id="2024-april",
        playlist_name="April 2024",
        folder_year="2024",
        month="APRIL",
        meta={
            "theme": "Spring",
            "keywords": ["apple"],
            "challenge": "test",
            "streamUrl": "https://example.com",
            "tracks": [
                {"trackNo": 1, "artist": "Artist", "title": "Title", "link": "https://example.com/track"}
            ],
        },
        folder_path=None,
        year="2024",
        folder_name="Sim_Selections_APRIL_2024",
        files=[],
    )

    assert playlist["id"] == "2024-april"
    assert playlist["tracks"][0]["artist"] == "Artist"
    assert playlist["tracks"][0]["title"] == "Title"
    assert playlist["tracks"][0]["file"] == ""

def test_clean_string():
    assert scanner.clean_string("Godspeed You! Black Emperor") == "godspeedyoublackemperor"
    assert scanner.clean_string("Sunn O)))") == "sunno"
    assert scanner.clean_string("123-abc!") == "123abc"
    assert scanner.clean_string(None) == ""
    assert scanner.clean_string("") == ""

def test_build_playlist_entry_matches_local_files():
    # Provide local files with punctuation that differs from the metadata
    mock_files = [
        "01. Godspeed You! Black Emperor - Storm.mp3",
        "02. Sunn O))) - It Took the Night to Believe.mp3"
    ]
    
    meta = {
        "tracks": [
            {"trackNo": 1, "artist": "Godspeed You Black Emperor", "title": "Storm"},
            {"trackNo": 2, "artist": "Sunn O", "title": "It Took the Night to Believe"}
        ]
    }
    
    playlist = scanner.build_playlist_entry(
        playlist_id="test-id", playlist_name="Test", folder_year="2024", month="JANUARY",
        meta=meta, folder_path="/mock/path", year="2024", folder_name="Folder", files=mock_files
    )
    
    # Verify the matching algorithm correctly stripped punctuation and matched the local files
    assert playlist["tracks"][0]["file"].endswith("01. Godspeed You! Black Emperor - Storm.mp3")
    assert playlist["tracks"][1]["file"].endswith("02. Sunn O))) - It Took the Night to Believe.mp3")

@patch("urllib.request.urlopen")
def test_resolve_youtube_url_success(mock_urlopen):
    mock_response = MagicMock()
    mock_response.read.return_value = b'<html><body><a href="/watch?v=dQw4w9WgXcQ">Video</a></body></html>'
    mock_urlopen.return_value.__enter__.return_value = mock_response

    result = scanner.resolve_youtube_url("Test Track")
    assert result == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    mock_urlopen.assert_called_once()

@patch("urllib.request.urlopen")
@patch("time.sleep")
def test_resolve_youtube_url_retry_and_fallback(mock_sleep, mock_urlopen):
    # Simulate network failure 3 times
    mock_urlopen.side_effect = Exception("Network Error")
    
    result = scanner.resolve_youtube_url("Test Track")
    
    # Should fallback to search query after 3 retries
    assert "results?search_query=" in result
    assert mock_urlopen.call_count == 3
    assert mock_sleep.call_count == 2

@patch("subprocess.run")
@patch("os.path.exists")
def test_get_audio_duration_success(mock_exists, mock_run):
    scanner.is_ffprobe_available = lambda: True
    mock_exists.return_value = True
    mock_completed_process = MagicMock()
    mock_completed_process.returncode = 0
    mock_completed_process.stdout = "  184.50 \n"
    mock_run.return_value = mock_completed_process

    result = scanner.get_audio_duration("mock_ffprobe_success.mp3")
    assert result == 184.50
    mock_run.assert_called_once()
    assert "ffprobe" in mock_run.call_args[0][0]

def test_get_audio_duration_nonexistent():
    result = scanner.get_audio_duration("")
    assert result is None
    
    result = scanner.get_audio_duration("nonexistent_file.mp3")
    assert result is None

@patch("builtins.open", new_callable=mock_open)
@patch("os.path.exists")
@patch("subprocess.run")
def test_get_audio_duration_mp3_fallback(mock_run, mock_exists, mock_file):
    scanner.is_ffprobe_available = lambda: False
    # Simulate ffprobe failing/missing
    mock_run.side_effect = Exception("ffprobe not found")
    mock_exists.return_value = True
    
    # 500 bytes of mock MP3 data
    # Sync byte 0xFF, second byte 0xFB (MPEG 1 Layer III)
    # Third byte 0x90 (128kbps, 44100Hz, no padding)
    frame = bytearray(500)
    frame[0] = 0xFF
    frame[1] = 0xFB
    frame[2] = 0x90
    mock_file.return_value.read.return_value = bytes(frame)
    
    result = scanner.get_audio_duration("mock_mp3_fallback.mp3")
    # 1152 samples / 44100Hz = ~0.02612 seconds
    assert result is not None
    assert abs(result - 0.02612) < 0.0001

@patch("builtins.open", new_callable=mock_open)
@patch("os.path.exists")
@patch("subprocess.run")
def test_get_audio_duration_mp4_fallback(mock_run, mock_exists, mock_file):
    scanner.is_ffprobe_available = lambda: False
    # Simulate ffprobe failing/missing
    mock_run.side_effect = Exception("ffprobe not found")
    mock_exists.return_value = True
    
    # mvhd signature + version 0 (1 byte) + flags (3 bytes) + creation/mod times (8 bytes)
    # + timescale (4 bytes: 1000 = 0x000003E8) + duration (4 bytes: 3000 = 0x00000BB8)
    mvhd_atom = b'mvhd\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x03\xe8\x00\x00\x0b\xb8'
    mock_file.return_value.read.return_value = mvhd_atom
    
    result = scanner.get_audio_duration("mock_mp4_fallback.mp4")
    # 3000 / 1000 = 3.0 seconds
    assert result == 3.0
