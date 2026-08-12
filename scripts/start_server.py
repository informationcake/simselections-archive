#!/usr/bin/env python3
import os
import re
import urllib.parse
import errno
import argparse
import sys
from http.server import HTTPServer, ThreadingHTTPServer, BaseHTTPRequestHandler

PORT = 8086
MUSIC_DIR = os.environ.get("music-file-path", "")

class RangeHTTPRequestHandler(BaseHTTPRequestHandler):
    def end_headers(self):
        """
        Injects CORS and Accept-Ranges headers before closing the HTTP headers block.
        """
        # Enable CORS and Range Support headers
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def log_message(self, format, *args):
        """
        Suppresses standard HTTP logging to prevent console spam.
        """
        return

    def handle(self):
        """
        Wrapper around standard handler to gracefully catch and suppress broken pipe errors.
        """
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            if getattr(exc, 'errno', None) in {errno.EPIPE, errno.ECONNRESET, errno.EBADF}:
                self.close_connection = True
                return
            raise

    def handle_one_request(self):
        """
        Wrapper around request handler to gracefully catch client disconnect errors.
        """
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            if getattr(exc, 'errno', None) in {errno.EPIPE, errno.ECONNRESET, errno.EBADF}:
                self.close_connection = True
                return
            raise

    def _safe_write(self, data):
        """
        Safely writes data to the client stream and handles potential connection resets.
        """
        try:
            self.wfile.write(data)
            return True
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            if getattr(exc, 'errno', None) in {errno.EPIPE, errno.ECONNRESET, errno.EBADF}:
                self.close_connection = True
                return False
            raise

    def do_GET(self):
        """
        Handles incoming GET requests. Supports full file delivery and HTTP 206 Partial Content 
        for media streaming and scrubbing.
        """
        try:
            # Parse URL to separate path from query parameters
            parsed_url = urllib.parse.urlparse(self.path)
            url_path = urllib.parse.unquote(parsed_url.path)
            if url_path == '/':
                url_path = '/index.html'
                
            # Build local path: route requests to MUSIC_DIR if configured
            rel_path = url_path.lstrip('/')
            segments = [s for s in rel_path.split('/') if s]
            local_path = ""

            if MUSIC_DIR:
                # Direct relative path in MUSIC_DIR
                c1 = os.path.join(MUSIC_DIR, rel_path)
                if os.path.exists(c1) and os.path.isfile(c1):
                    local_path = c1

            # Fallback to local project directory
            if not local_path:
                local_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), rel_path)
            
            if os.path.exists(local_path) and os.path.isfile(local_path):
                # Resolve Content-Type
                _, ext = os.path.splitext(local_path)
                ext = ext.lower()
                mime_types = {
                    ".html": "text/html; charset=utf-8",
                    ".css":  "text/css",
                    ".js":   "application/javascript",
                    ".mp3":  "audio/mpeg",
                    ".mp4":  "video/mp4",
                    ".webm": "video/webm",
                    ".ogg":  "video/ogg",
                    ".mov":  "video/quicktime",
                    ".png":  "image/png",
                    ".jpg":  "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".webp": "image/webp",
                    ".svg":  "image/svg+xml",
                    ".json": "application/json",
                    ".txt":  "text/plain"
                }
                mime = mime_types.get(ext, "application/octet-stream")
                
                # Read file bytes
                try:
                    with open(local_path, 'rb') as f:
                        bytes_data = f.read()
                except Exception as e:
                    self.send_response(500)
                    self.end_headers()
                    self._safe_write(f"500 Internal Server Error: {e}".encode('utf-8'))
                    return
                    
                file_len = len(bytes_data)
                
                # Handle Range Header (HTTP 206 Partial Content) for audio scrubbing/seeking
                range_header = self.headers.get('Range')
                if range_header:
                    match = re.match(r'bytes=(\d+)-(\d*)', range_header)
                    if match:
                        start = int(match.group(1))
                        end = int(match.group(2)) if match.group(2) else file_len - 1
                        
                        if start >= file_len:
                            self.send_response(416)
                            self.send_header('Content-Range', f'bytes */{file_len}')
                            self.end_headers()
                            return
                        
                        length = end - start + 1
                        self.send_response(206)
                        self.send_header('Content-Type', mime)
                        self.send_header('Content-Range', f'bytes {start}-{end}/{file_len}')
                        self.send_header('Content-Length', str(length))
                        self.end_headers()
                        self._safe_write(bytes_data[start:end+1])
                        return
                
                # Default response (HTTP 200 OK)
                self.send_response(200)
                self.send_header('Content-Type', mime)
                self.send_header('Content-Length', str(file_len))
                self.end_headers()
                self._safe_write(bytes_data)
            else:
                self.send_response(404)
                self.send_header('Content-Type', 'text/plain')
                self.end_headers()
                self._safe_write(f"404 Not Found: {url_path}".encode('utf-8'))
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            if getattr(exc, 'errno', None) in {errno.EPIPE, errno.ECONNRESET, errno.EBADF}:
                self.close_connection = True
                return
            raise

def run():
    """
    Initializes and starts the local HTTPServer instance.
    """
    server_address = ('', PORT)
    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer(server_address, RangeHTTPRequestHandler)
    print(f"Local web server started at http://localhost:{PORT}/")
    if MUSIC_DIR:
        print(f"Streaming audio files from: {MUSIC_DIR}")
    print("Press Ctrl+C to stop the server.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server...")
        httpd.server_close()

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Run the SimSelections local HTTP server.")
    parser.add_argument("--music-file-path", default=MUSIC_DIR, help="Path to music library folder")
    args, _ = parser.parse_known_args()
    MUSIC_DIR = args.music_file_path
    if not MUSIC_DIR:
        print("Warning: Music directory path is not configured. Please set music-file-path environment variable or pass --music-file-path if playback is needed.")
    run()
