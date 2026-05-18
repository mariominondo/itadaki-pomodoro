import http.server
import socketserver
import json
import os
import sys

PORT = int(os.environ.get('POMODORO_PORT', 8020))
MAX_POST_BYTES = 5 * 1024 * 1024  # 5 MB

# Allow-list para CSRF: el navegador manda Origin en POST cross-origin.
# Si el header está presente y NO matchea, rechazamos.
# Si está ausente (curl, scripts locales) se permite — el server ya está
# bindado a 127.0.0.1 por docker, no expone superficie a LAN.
def _allowed_origins():
    extra = os.environ.get('POMODORO_ALLOWED_ORIGINS', '').split(',')
    base = [f'http://localhost:{PORT}', f'http://127.0.0.1:{PORT}',
            'http://localhost:8020', 'http://127.0.0.1:8020']
    return {o.strip() for o in base + extra if o.strip()}

ALLOWED_ORIGINS = _allowed_origins()

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

    def _reject(self, code, msg=None):
        self.send_response(code)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        body = json.dumps({"error": msg or "rejected"}).encode('utf-8')
        self.wfile.write(body)

    def do_POST(self):
        if self.path != '/data':
            self._reject(404, "not found"); return

        # CSRF: si el navegador manda Origin, debe estar en la allow-list.
        # Bloquea el bypass form-text/plain señalado en la auditoría red-hat.
        origin = self.headers.get('Origin', '').strip()
        if origin and origin not in ALLOWED_ORIGINS:
            self._reject(403, "origin not allowed"); return

        # Content-Length cap: evita DoS por payload gigante (rfile.read OOM).
        try:
            content_length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            self._reject(400, "invalid content-length"); return
        if content_length <= 0 or content_length > MAX_POST_BYTES:
            self._reject(413, f"payload size out of range (max {MAX_POST_BYTES} bytes)"); return

        post_data = self.rfile.read(content_length)
        try:
            data = json.loads(post_data.decode('utf-8'))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            self._reject(400, f"invalid json: {type(e).__name__}"); return

        # Schema mínimo: el root debe ser un dict con las claves esperadas
        # del tipo correcto. Si cliente manda formas raras, no las persistimos.
        if not isinstance(data, dict):
            self._reject(422, "root must be object"); return
        if not isinstance(data.get('projects', []), list):
            self._reject(422, "projects must be list"); return
        if not isinstance(data.get('history', []), list):
            self._reject(422, "history must be list"); return
        if not isinstance(data.get('settings', {}), dict):
            self._reject(422, "settings must be object"); return

        try:
            with open(DATA_FILE, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except OSError as e:
            self._reject(500, "write failed")
            print(f"Error saving data: {type(e).__name__}", file=sys.stderr)
            return

        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"status": "success"}')

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
