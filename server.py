import http.server
import socketserver
import json
import os
import sys
from urllib.parse import urlsplit

PORT = int(os.environ.get('POMODORO_PORT', 8020))
MAX_POST_BYTES = 5 * 1024 * 1024  # 5 MB
# Caps replicados del cliente (app.js). El cliente no es la única ruta:
# `curl -X POST` local puede saltar la validación JS y persistir basura.
MAX_PROJECTS = 1000
MAX_HISTORY = 100000

# Allow-list para CSRF: el navegador manda Origin en POST cross-origin.
# Si el header está presente y NO matchea, rechazamos.
# Si está ausente (curl, scripts locales) se permite — el server ya está
# bindado a 127.0.0.1 por docker, no expone superficie a LAN.
def _allowed_origins():
    extra = os.environ.get('POMODORO_ALLOWED_ORIGINS', '').split(',')
    base = [f'http://localhost:{PORT}', f'http://127.0.0.1:{PORT}',
            'http://localhost:8020', 'http://127.0.0.1:8020']
    return {o.strip() for o in base + extra if o.strip()}

# Allow-list de Host para mitigar DNS rebinding: un sitio malicioso con
# TTL bajo apunta su dominio a 127.0.0.1 después de que el browser cargó
# el JS atacante, y el browser cree que sigue siendo same-origin contra
# evil.com:8020. Sin chequeo de Host header, GET /data exfiltra el backlog.
def _allowed_hosts():
    extra = os.environ.get('POMODORO_ALLOWED_HOSTS', '').split(',')
    base = [f'localhost:{PORT}', f'127.0.0.1:{PORT}',
            'localhost:8020', '127.0.0.1:8020',
            f'localhost', '127.0.0.1']  # algunos clientes omiten :port en Host
    return {h.strip().lower() for h in base + extra if h.strip()}

ALLOWED_ORIGINS = _allowed_origins()
ALLOWED_HOSTS = _allowed_hosts()

# Allow-list explícita de paths estáticos. Bloquea la lectura local de
# pomodoro_data.json, server.py, .git/* y cualquier otro archivo del WORKDIR
# que SimpleHTTPRequestHandler entregaría por defecto.
STATIC_ALLOWED_PATHS = {
    '/', '/index.html', '/app.js', '/style.css',
    '/assets/favicon.svg', '/assets/logo.svg',
    '/assets/vendor/chart.umd.js',
}

SECURITY_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': (
        "default-src 'self'; "
        "script-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "connect-src 'self'; "
        "base-uri 'none'; "
        "form-action 'none'; "
        "frame-ancestors 'none'"
    ),
}

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
    def end_headers(self):
        # Asegura que CUALQUIER respuesta (incluida la de super().do_GET()
        # que invoca end_headers internamente) lleve los hardening headers.
        for k, v in SECURITY_HEADERS.items():
            self.send_header(k, v)
        super().end_headers()

    def _host_allowed(self):
        host = self.headers.get('Host', '').strip().lower()
        return host in ALLOWED_HOSTS

    def do_GET(self):
        if not self._host_allowed():
            self._reject(421, "host not allowed"); return

        # `self.path` puede traer querystring (`/app.js?v=1.2`) — comparar
        # solo el path normalizado contra la allow-list.
        path_only = urlsplit(self.path).path

        if path_only == '/data':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            if os.path.exists(DATA_FILE):
                with open(DATA_FILE, 'r', encoding='utf-8') as f:
                    self.wfile.write(f.read().encode('utf-8'))
            else:
                self.wfile.write(json.dumps(DEFAULT_DATA).encode('utf-8'))
            return

        # Solo paths estáticos explícitamente permitidos. Cierra la lectura
        # local de pomodoro_data.json, server.py, .git/* etc. vía curl.
        if path_only not in STATIC_ALLOWED_PATHS:
            self._reject(404, "not found"); return
        super().do_GET()

    def _reject(self, code, msg=None):
        self.send_response(code)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        body = json.dumps({"error": msg or "rejected"}).encode('utf-8')
        self.wfile.write(body)

    def do_POST(self):
        if not self._host_allowed():
            self._reject(421, "host not allowed"); return

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
        projects = data.get('projects', [])
        history = data.get('history', [])
        settings = data.get('settings', {})
        if not isinstance(projects, list):
            self._reject(422, "projects must be list"); return
        if not isinstance(history, list):
            self._reject(422, "history must be list"); return
        if not isinstance(settings, dict):
            self._reject(422, "settings must be object"); return
        # Caps server-side replican los del cliente para cortar el bypass
        # `curl -X POST` que mete 4.9 MB de JSON válido pero gigante.
        if len(projects) > MAX_PROJECTS:
            self._reject(422, f"too many projects (max {MAX_PROJECTS})"); return
        if len(history) > MAX_HISTORY:
            self._reject(422, f"too many history entries (max {MAX_HISTORY})"); return

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
