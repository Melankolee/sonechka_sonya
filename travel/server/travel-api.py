#!/usr/bin/env python3
"""API travel-приложения: поездки и их материалы, которые создаются в интерфейсе.

У поездки — название, место, даты и материалы: загруженные файлы (PDF и
фото). Один PDF может быть помечен main — это описание поездки, оно
показывается отдельно над остальными. Других полей нет.

Только стандартная библиотека — как и у сервиса ответов, ставить на общий
сервер pip-окружение ради нескольких ручек незачем. Слушает 127.0.0.1, наружу
его выставляет Caddy (travel/deploy/caddy-travel.caddy).

Вход: POST /api/login сверяет пароль с хешем из AUTH_FILE и ставит cookie
travel_session. Сам токен проверяет Caddy — без него /api/* и /trips/* дают
401. Basic auth не годится: приложение с экрана «Домой» iOS не запоминает его
и спрашивает пароль при каждом запуске, а cookie живёт.

Хранилище — обычные файлы, в том же виде, в каком их читает приложение:

    <data>/trips/index.json                 {"active": "<id>" | null}
    <data>/trips/<id>/trip.json             поездка
    <data>/trips/<id>/documents/<docId>.pdf материалы

Читает их не сервис, а Caddy напрямую (/trips/*): сервис только пишет. Для
разработки GET /trips/* отдаёт и он сам.

Любая правка поездки или её материалов увеличивает version — по нему телефон
понимает, что пора обновить офлайн-копию. Файл после загрузки не меняется:
новый файл — новый id. Поэтому телефон не качает заново то, что у него уже есть.
"""

import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sys
import tempfile
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlsplit

HOST = os.environ.get('TRAVEL_HOST', '127.0.0.1')
PORT = int(os.environ.get('TRAVEL_PORT', '8788'))
DATA = os.environ.get('TRAVEL_DATA', '/var/lib/travel')
TRIPS = os.path.join(DATA, 'trips')
INDEX = os.path.join(TRIPS, 'index.json')
# {"salt", "hash", "token"} — пишет travel/deploy/travel-auth.sh. Нет файла —
# режим разработки: вход принимает любой пароль.
AUTH_FILE = os.environ.get('TRAVEL_AUTH_FILE', '/etc/travel/auth.json')
SESSION_DAYS = 400
# Перебор пароля: после ошибки — пауза, после MAX_FAILS ошибок с адреса за
# FAIL_WINDOW секунд — отказ до конца окна.
MAX_FAILS = 10
FAIL_WINDOW = 15 * 60
FAILS = {}

MAX_JSON = 1024 * 1024
MAX_UPLOAD = 50 * 1024 * 1024
# Запас свободного места, который загрузка не имеет права съесть: диск общий.
KEEP_FREE = 1024 * 1024 * 1024
MAX_DOCS = 60
SHORT = 300

# Записи идут под одним замком: пользователь один, а гонка «два сохранения
# одновременно» без замка дала бы потерянную правку.
LOCK = threading.Lock()

ID_RE = re.compile(r'^[a-z0-9-]{1,64}$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
STATIC_TYPES = {
    '.json': 'application/json; charset=utf-8',
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
}


class ApiError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


# ---------- файлы ----------

def now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def new_id(prefix=''):
    return prefix + secrets.token_hex(5)


def write_json(path, data):
    """Атомарно: Caddy в любой момент читает либо старый файл, либо новый."""
    directory = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(dir=directory, prefix='.tmp-')
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def read_json(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def trip_dir(trip_id):
    if not isinstance(trip_id, str) or not ID_RE.match(trip_id):
        raise ApiError(404, 'Поездка не найдена')
    return os.path.join(TRIPS, trip_id)


def load_trip(trip_id):
    trip = read_json(os.path.join(trip_dir(trip_id), 'trip.json'))
    if trip is None:
        raise ApiError(404, 'Поездка не найдена')
    return trip


def save_trip(trip):
    trip['updatedAt'] = now()
    write_json(os.path.join(trip_dir(trip['id']), 'trip.json'), trip)


def all_trips():
    if not os.path.isdir(TRIPS):
        return []
    out = []
    for name in os.listdir(TRIPS):
        if ID_RE.match(name):
            trip = read_json(os.path.join(TRIPS, name, 'trip.json'))
            if trip:
                out.append(trip)
    return out


def active_id():
    return (read_json(INDEX, {}) or {}).get('active')


def set_active(trip_id):
    write_json(INDEX, {'active': trip_id})


# ---------- чистка входных данных ----------

def text(value, limit=SHORT):
    if not isinstance(value, str):
        return ''
    return re.sub(r'[\x00-\x1f\x7f]', ' ', value).strip()[:limit]


def date(value):
    return value if isinstance(value, str) and DATE_RE.match(value) else ''


def apply_basics(trip, raw):
    title = text(raw.get('title'), 120)
    date_from, date_to = date(raw.get('dateFrom')), date(raw.get('dateTo'))
    if not title:
        raise ApiError(400, 'Нужно название поездки')
    if not date_from or not date_to:
        raise ApiError(400, 'Нужны даты начала и конца')
    if date_to < date_from:
        raise ApiError(400, 'Дата конца раньше даты начала')
    location = raw.get('location') if isinstance(raw.get('location'), dict) else {}
    trip['title'] = title
    trip['location'] = {k: v for k, v in {'country': text(location.get('country')), 'place': text(location.get('place'))}.items() if v}
    trip['dateFrom'] = date_from
    trip['dateTo'] = date_to


# ---------- документы ----------

def sniff(head):
    """Тип файла — по содержимому, а не по тому, что прислал браузер."""
    if head.startswith(b'%PDF-'):
        return 'application/pdf', '.pdf'
    if head.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg', '.jpg'
    if head.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png', '.png'
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP':
        return 'image/webp', '.webp'
    if head[4:8] == b'ftyp' and head[8:12] in (b'heic', b'heix', b'mif1', b'msf1'):
        return 'image/heic', '.heic'
    return None, None


# ---------- вход ----------

def scrypt(password, salt_hex):
    return hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), n=2 ** 14, r=8, p=1).hex()


def check_password(password):
    """Токен сессии при верном пароле, иначе None."""
    auth = read_json(AUTH_FILE)
    if auth is None:
        return 'dev'
    if not isinstance(password, str) or not password:
        return None
    if hmac.compare_digest(scrypt(password, auth['salt']), auth['hash']):
        return auth['token']
    return None


def too_many_fails(ip):
    now_ts = time.time()
    fails = [t for t in FAILS.get(ip, []) if now_ts - t < FAIL_WINDOW]
    FAILS[ip] = fails
    return len(fails) >= MAX_FAILS


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    server_version = 'travel-api'

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.command, fmt % args))

    def send_json(self, code, payload, cookie=None):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(code)
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def body_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        if length > MAX_JSON:
            raise ApiError(413, 'Слишком большой запрос')
        try:
            data = json.loads(self.rfile.read(length) or b'{}')
        except ValueError:
            raise ApiError(400, 'Некорректный JSON')
        if not isinstance(data, dict):
            raise ApiError(400, 'Некорректный JSON')
        return data

    def route(self):
        url = urlsplit(self.path)
        parts = [unquote(p) for p in url.path.strip('/').split('/') if p]
        return parts, parse_qs(url.query)

    def handle_errors(self, fn):
        try:
            fn()
        except ApiError as e:
            self.send_json(e.code, {'error': e.message})
        except Exception as e:  # noqa: BLE001 — сервис не должен падать от одного запроса
            sys.stderr.write('error: %r\n' % e)
            self.send_json(500, {'error': 'Ошибка сервера'})

    def do_GET(self):
        self.handle_errors(self.get)

    def do_POST(self):
        self.handle_errors(self.post)

    def do_PUT(self):
        self.handle_errors(self.put)

    def do_PATCH(self):
        self.handle_errors(self.patch)

    def do_DELETE(self):
        self.handle_errors(self.delete)

    # GET /api/health, /api/trips; /trips/* — только для разработки
    def get(self):
        parts, _ = self.route()
        if parts == ['api', 'health']:
            return self.send_json(200, {'ok': True})
        if parts == ['api', 'trips']:
            trips = sorted(all_trips(), key=lambda t: t.get('dateFrom', ''), reverse=True)
            summary = [{k: t.get(k) for k in ('id', 'title', 'location', 'dateFrom', 'dateTo', 'version')} for t in trips]
            return self.send_json(200, {'active': active_id(), 'trips': summary})
        if parts[:1] == ['trips']:
            return self.static(parts[1:])
        raise ApiError(404, 'Не найдено')

    def static(self, rest):
        if rest == ['index.json'] and not os.path.exists(INDEX):
            return self.send_json(200, {'active': None})
        path = os.path.realpath(os.path.join(TRIPS, *rest))
        if not path.startswith(os.path.realpath(TRIPS) + os.sep) or not os.path.isfile(path):
            raise ApiError(404, 'Не найдено')
        with open(path, 'rb') as f:
            body = f.read()
        self.send_response(200)
        self.send_header('Content-Type', STATIC_TYPES.get(os.path.splitext(path)[1], 'application/octet-stream'))
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(body)

    def login(self):
        # Caddy ставит X-Forwarded-For; сервис слушает только 127.0.0.1.
        ip = (self.headers.get('X-Forwarded-For') or self.client_address[0]).split(',')[0].strip()
        if too_many_fails(ip):
            raise ApiError(429, 'Слишком много попыток. Подожди 15 минут.')
        token = check_password(self.body_json().get('password'))
        if not token:
            FAILS.setdefault(ip, []).append(time.time())
            time.sleep(1)
            raise ApiError(403, 'Неверный пароль')
        FAILS.pop(ip, None)
        cookie = 'travel_session=%s; Max-Age=%d; Path=/; HttpOnly; Secure; SameSite=Lax' % (token, SESSION_DAYS * 86400)
        self.send_json(200, {'ok': True}, cookie)

    def post(self):
        parts, query = self.route()
        if parts == ['api', 'login']:
            return self.login()
        # POST /api/trips — новая поездка; первая сразу становится активной
        if parts == ['api', 'trips']:
            raw = self.body_json()
            with LOCK:
                trip = {'id': new_id('t-'), 'version': 1, 'createdAt': now(), 'documents': []}
                apply_basics(trip, raw)
                os.makedirs(os.path.join(trip_dir(trip['id']), 'documents'), mode=0o755)
                save_trip(trip)
                if not active_id():
                    set_active(trip['id'])
            return self.send_json(201, trip)
        # POST /api/active {"id"}
        if parts == ['api', 'active']:
            trip_id = self.body_json().get('id')
            with LOCK:
                load_trip(trip_id)
                set_active(trip_id)
            return self.send_json(200, {'active': trip_id})
        # POST /api/trips/<id>/documents?title=&main=1 — тело запроса и есть файл
        if len(parts) == 4 and parts[:2] == ['api', 'trips'] and parts[3] == 'documents':
            return self.upload(parts[2], query)
        raise ApiError(404, 'Не найдено')

    def upload(self, trip_id, query):
        length = int(self.headers.get('Content-Length') or 0)
        if length <= 0:
            raise ApiError(400, 'Пустой файл')
        if length > MAX_UPLOAD:
            raise ApiError(413, 'Файл больше 50 МБ')
        if shutil.disk_usage(DATA).free - length < KEEP_FREE:
            raise ApiError(507, 'На сервере закончилось место')
        directory = os.path.join(trip_dir(trip_id), 'documents')
        if not os.path.isdir(directory):
            raise ApiError(404, 'Поездка не найдена')

        # Файл пишется во временный, без замка: загрузка большого PDF по
        # мобильной сети не должна блокировать остальные запросы.
        fd, tmp = tempfile.mkstemp(dir=directory, prefix='.upload-')
        try:
            remaining, head = length, b''
            with os.fdopen(fd, 'wb') as f:
                while remaining:
                    chunk = self.rfile.read(min(remaining, 1024 * 1024))
                    if not chunk:
                        raise ApiError(400, 'Загрузка оборвалась')
                    if len(head) < 16:
                        head += chunk[:16]
                    f.write(chunk)
                    remaining -= len(chunk)
                f.flush()
                os.fsync(f.fileno())
            mime, ext = sniff(head)
            if not mime:
                raise ApiError(415, 'Поддерживаются PDF, JPEG, PNG, WebP и HEIC')
            main = (query.get('main') or [''])[0] == '1'
            if main and mime != 'application/pdf':
                raise ApiError(415, 'Описание поездки — только PDF')

            title = text((query.get('title') or [''])[0], 120) or ('Описание поездки' if main else 'Материал')
            doc_id = new_id('d-')
            with LOCK:
                trip = load_trip(trip_id)
                docs = trip.setdefault('documents', [])
                if len(docs) >= MAX_DOCS:
                    raise ApiError(400, 'Слишком много материалов')
                # Описание одно: новое заменяет прежнее, старый файл удаляется.
                replaced = [d for d in docs if main and d.get('main')]
                os.chmod(tmp, 0o644)
                os.replace(tmp, os.path.join(directory, doc_id + ext))
                doc = {
                    'id': doc_id,
                    'title': title,
                    'file': 'documents/' + doc_id + ext,
                    'mime': mime,
                    'size': length,
                    'uploadedAt': now(),
                }
                if main:
                    doc['main'] = True
                    trip['documents'] = [doc] + [d for d in docs if not d.get('main')]
                else:
                    docs.append(doc)
                trip['version'] += 1
                save_trip(trip)
                for old in replaced:
                    try:
                        os.unlink(os.path.join(trip_dir(trip_id), old['file']))
                    except FileNotFoundError:
                        pass
            return self.send_json(201, trip)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    # PUT /api/trips/<id> {"baseVersion", "trip"} — название, место, даты
    def put(self):
        parts, _ = self.route()
        if len(parts) != 3 or parts[:2] != ['api', 'trips']:
            raise ApiError(404, 'Не найдено')
        raw = self.body_json()
        incoming = raw.get('trip') if isinstance(raw.get('trip'), dict) else {}
        with LOCK:
            trip = load_trip(parts[2])
            if raw.get('baseVersion') != trip['version']:
                # Поездку успели изменить в другом месте — не затираем молча.
                self.send_json(409, {'error': 'Поездку изменили в другом окне. Обновите страницу.', 'trip': trip})
                return
            apply_basics(trip, incoming)
            trip['version'] += 1
            save_trip(trip)
        self.send_json(200, trip)

    # PATCH /api/trips/<id>/documents/<docId> {"title"}
    def patch(self):
        parts, _ = self.route()
        if len(parts) != 5 or parts[:2] != ['api', 'trips'] or parts[3] != 'documents':
            raise ApiError(404, 'Не найдено')
        raw = self.body_json()
        with LOCK:
            trip = load_trip(parts[2])
            doc = next((d for d in trip.get('documents', []) if d['id'] == parts[4]), None)
            if not doc:
                raise ApiError(404, 'Материал не найден')
            doc['title'] = text(raw.get('title'), 120) or doc['title']
            trip['version'] += 1
            save_trip(trip)
        self.send_json(200, trip)

    def delete(self):
        parts, _ = self.route()
        # DELETE /api/trips/<id>
        if len(parts) == 3 and parts[:2] == ['api', 'trips']:
            with LOCK:
                load_trip(parts[2])
                shutil.rmtree(trip_dir(parts[2]))
                if active_id() == parts[2]:
                    rest = sorted(all_trips(), key=lambda t: t.get('dateFrom', ''), reverse=True)
                    set_active(rest[0]['id'] if rest else None)
            return self.send_json(200, {'active': active_id()})
        # DELETE /api/trips/<id>/documents/<docId>
        if len(parts) == 5 and parts[:2] == ['api', 'trips'] and parts[3] == 'documents':
            with LOCK:
                trip = load_trip(parts[2])
                doc = next((d for d in trip.get('documents', []) if d['id'] == parts[4]), None)
                if not doc:
                    raise ApiError(404, 'Материал не найден')
                trip['documents'] = [d for d in trip['documents'] if d['id'] != doc['id']]
                trip['version'] += 1
                save_trip(trip)
                try:
                    os.unlink(os.path.join(trip_dir(parts[2]), doc['file']))
                except FileNotFoundError:
                    pass
            return self.send_json(200, trip)
        raise ApiError(404, 'Не найдено')


def main():
    os.makedirs(TRIPS, mode=0o755, exist_ok=True)
    # Caddy отдаёт index.json как файл: если его нет, приложение увидело бы 404
    # и решило, что сервер недоступен.
    if not os.path.exists(INDEX):
        set_active(None)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    sys.stderr.write('travel api on %s:%d, data %s\n' % (HOST, PORT, DATA))
    server.serve_forever()


if __name__ == '__main__':
    main()
