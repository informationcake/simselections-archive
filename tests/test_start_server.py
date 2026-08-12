import importlib.util
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "scripts" / "start_server.py"

spec = importlib.util.spec_from_file_location("start_server", MODULE_PATH)
start_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(start_server)


def test_do_GET_standard_file():
    # Bypass BaseHTTPRequestHandler __init__ to test do_GET in isolation
    handler = object.__new__(start_server.RangeHTTPRequestHandler)
    handler.path = "/test.json"
    handler.headers = {}
    handler.wfile = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.close_connection = False
    
    with patch("os.path.exists", return_value=True), \
         patch("os.path.isfile", return_value=True), \
         patch("builtins.open", unittest.mock.mock_open(read_data=b'{"test": 1}')):
        
        handler.do_GET()
        
        handler.send_response.assert_called_with(200)
        handler.send_header.assert_any_call('Content-Type', 'application/json')
        handler.wfile.write.assert_called_with(b'{"test": 1}')


def test_do_GET_range_request():
    handler = object.__new__(start_server.RangeHTTPRequestHandler)
    handler.path = "/test.mp3"
    handler.headers = {"Range": "bytes=2-10"}
    handler.wfile = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.close_connection = False
    
    mock_data = b'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    
    with patch("os.path.exists", return_value=True), \
         patch("os.path.isfile", return_value=True), \
         patch("builtins.open", unittest.mock.mock_open(read_data=mock_data)):
        
        handler.do_GET()
        
        handler.send_response.assert_called_with(206)
        handler.send_header.assert_any_call('Content-Type', 'audio/mpeg')
        handler.send_header.assert_any_call('Content-Range', f'bytes 2-10/{len(mock_data)}')
        handler.wfile.write.assert_called_with(mock_data[2:11]) # 2 to 10 inclusive is 9 bytes
