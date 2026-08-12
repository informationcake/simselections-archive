import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch, MagicMock

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "download_sheets.py"

spec = importlib.util.spec_from_file_location("download_sheets", MODULE_PATH)
download_sheets = importlib.util.module_from_spec(spec)
spec.loader.exec_module(download_sheets)

@patch("urllib.request.urlopen")
@patch("builtins.open", new_callable=unittest.mock.mock_open)
@patch("os.makedirs")
@patch("glob.glob", return_value=[])
def test_download_sheet_metadata(mock_glob, mock_makedirs, mock_file, mock_urlopen):
    mock_html_response = MagicMock()
    mock_html_response.read.return_value = b'name: "TestTab", pageUrl: "url", gid: "123"'
    
    mock_csv_response = MagicMock()
    mock_csv_response.read.return_value = b"id,name\n1,Test"
    
    # First call is the HTML view, second call is the CSV export
    mock_urlopen.return_value.__enter__.side_effect = [mock_html_response, mock_csv_response]

    download_sheets.download_sheet_metadata("/tmp/mock_dir")

    mock_makedirs.assert_called_once_with("/tmp/mock_dir", exist_ok=True)
    assert mock_urlopen.call_count == 2
    mock_file.assert_called_once()
    mock_file().write.assert_called_once_with(b"id,name\n1,Test")
