import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "scanner.py"

spec = importlib.util.spec_from_file_location("scanner", MODULE_PATH)
scanner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scanner)


def test_is_artist_opted_in():
    exact_set = {
        "informationcake",
        "Benn Jordan",
        "Artist A",
        "Artist B"
    }
    fuzzy_set = {
        "informationcake",
        "bennjordan",
        "artista",
        "artistb"
    }
    optin_sets = (exact_set, fuzzy_set)

    # Informationcake (caps) matches the lowercase version in exact_set via fuzzy fallback
    assert scanner.is_artist_opted_in("Informationcake", optin_sets) is True
    assert scanner.is_artist_opted_in("Benn Jordan", optin_sets) is True
    
    # Other case discrepancies should succeed fuzzy match and be accepted
    assert scanner.is_artist_opted_in("informationcake", optin_sets) is True
    
    # Collabs where ALL opt-in
    assert scanner.is_artist_opted_in("Artist A feat. Artist B", optin_sets) is True
    assert scanner.is_artist_opted_in("Artist B & Artist A", optin_sets) is True
    
    # Collabs where NOT ALL opt-in
    assert scanner.is_artist_opted_in("Artist A feat. Unopted", optin_sets) is False
    
    # Not opted in at all
    assert scanner.is_artist_opted_in("Unopted Artist", optin_sets) is False
    assert scanner.is_artist_opted_in(None, optin_sets) is False


def test_build_playlist_entry_optin_flags():
    mock_files = [
        "01. Informationcake - Track1.mp3",
        "02. Unopted Artist - Track2.mp3"
    ]
    meta = {
        "tracks": [
            {"trackNo": 1, "artist": "Informationcake", "title": "Track1"},
            {"trackNo": 2, "artist": "Unopted Artist", "title": "Track2"}
        ]
    }
    # The actual optin list has "informationcake" in lowercase
    optin_sets = ({"informationcake"}, {"informationcake"})

    playlist = scanner.build_playlist_entry(
        playlist_id="test-optin",
        playlist_name="Test OptIn",
        folder_year="2024",
        month="JANUARY",
        meta=meta,
        folder_path="/mock/path",
        year="2024",
        folder_name="Folder",
        files=mock_files,
        optin_artists=optin_sets
    )

    t1 = playlist["tracks"][0]
    assert t1["artist"] == "Informationcake"
    assert t1["file"].endswith("01. Informationcake - Track1.mp3")
    assert t1["optIn"] is True
    assert t1["canPlay"] is True

    t2 = playlist["tracks"][1]
    assert t2["artist"] == "Unopted Artist"
    # File is preserved in metadata as requested
    assert t2["file"].endswith("02. Unopted Artist - Track2.mp3")
    assert t2["optIn"] is False
    assert t2["canPlay"] is False
