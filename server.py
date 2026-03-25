import http.server
import socketserver
import json
import os
import sys

PORT = 8000

# Ensure CWD is the script's directory (so pomodoro_data.json lives next to server.py)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
os.chdir(SCRIPT_DIR)

DATA_FILE = os.path.join(SCRIPT_DIR, 'pomodoro_data.json')
DEFAULT_DATA = {"projects": [], "history": [], "settings": {"globalBreakDuration": 5}}

# Auto-create data file on first run
if not os.path.exists(DATA_FILE):
    with open(DATA_FILE, 'w', encoding='utf-8') as f:
        json.dump(DEFAULT_DATA, f, indent=2, ensure_ascii=False)
    print(f"Created default data file: {DATA_FILE}")


class PersistenceHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/data':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            if os.path.exists(DATA_FILE):
                with open(DATA_FILE, 'r', encoding='utf-8') as f:
                    self.wfile.write(f.read().encode('utf-8'))
            else:
                self.wfile.write(json.dumps(DEFAULT_DATA).encode('utf-8'))
        else:
            # Serve static files
            super().do_GET()

    def do_POST(self):
        if self.path == '/data':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            
            try:
                data = json.loads(post_data.decode('utf-8'))
                
                # Write to file
                with open(DATA_FILE, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(b'{"status": "success"}')
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                print(f"Error saving data: {e}")
        else:
            self.send_response(404)
            self.end_headers()

if __name__ == "__main__":
    Handler = PersistenceHandler
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving at http://localhost:{PORT}")
        print(f"Data file: {DATA_FILE}")
        print("Ctrl+C to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
