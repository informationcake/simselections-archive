import importlib.util
from pathlib import Path
import tempfile
import os
import json

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "compile_discord_map.py"

spec = importlib.util.spec_from_file_location("compile_discord_map", MODULE_PATH)
compiler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compiler)

def test_clean_string():
    assert compiler.clean_string("Sample Test Artist") == "sampletestartist"
    assert compiler.clean_string("Example Artist #1!") == "exampleartist1"
    assert compiler.clean_string("") == ""

def test_normalize_discord_handle():
    # Strip discriminator
    assert compiler.normalize_discord_handle("test.user#6424") == "test.user"
    assert compiler.normalize_discord_handle("mockuser (Nickname)#9679") == "mockuser"
    assert compiler.normalize_discord_handle("@testartist") == "testartist"
    assert compiler.normalize_discord_handle("testartist") == "testartist"
    
    # Filter survey/placeholders
    assert compiler.normalize_discord_handle("Yes") == ""
    assert compiler.normalize_discord_handle("No") == ""
    assert compiler.normalize_discord_handle("N/A") == ""
    assert compiler.normalize_discord_handle("none") == ""
    assert compiler.normalize_discord_handle("https://discord.gg/test") == ""
