#!/usr/bin/env python3
"""Мини-сервис ответов гостей: POST /api/answers пишет, GET /api/answers отдаёт.

Только стандартная библиотека — на сервере рядом чужой прод, ставить туда pip-
окружение ради двух ручек не хочется. Слушает 127.0.0.1, наружу его выставляет
nginx (см. deploy/nginx-sonechka-sonya.conf).

Хранилище — append-only JSONL: строка на отправку. Гость может нажать «Я приду»
несколько раз, страница /sonechka показывает последний ответ каждой; история
остаётся на случай «а что она выбирала сначала».
"""

import fcntl
import json
import os
import re
import signal
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get('SONECHKA_HOST', '127.0.0.1')
PORT = int(os.environ.get('SONECHKA_PORT', '8787'))
STORE = os.environ.get('SONECHKA_STORE', '/var/lib/sonechka/answers.jsonl')

# Ручка открыта миру без ключа, поэтому пределы жёсткие: тело запроса, длина
# каждого поля, число вариантов и общее число записей в файле.
MAX_BODY = 8 * 1024
MAX_TEXT = 200
MAX_ITEMS = 20
MAX_RECORDS = 5000

GUEST_RE = re.compile(r'^[a-z0-9_-]{1,32}$')


def clean_text(value):
    if not isinstance(value, str):
        return ''
    # \x00 ломает json.loads на чтении, переводы строк рвут JSONL
    return re.sub(r'[\x00-\x1f\x7f]', ' ', value).strip()[:MAX_TEXT]


def clean_list(value):
    if isinstance(value, str):
        value = [v for v in value.split(',')]
    if not isinstance(value, list):
        return []
    out = []
    for item in value[:MAX_ITEMS]:
        text = clean_text(item)
        if text and text not in out:
            out.append(text)
    return out


def normalize(raw):
    guest = clean_text(raw.get('guest')).lower()
    return {
        'ts': datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        'guest': guest if GUEST_RE.match(guest) else '',
        'name': clean_text(raw.get('name')),
        'doll': clean_text(raw.get('doll')),
        'watch': clean_list(raw.get('watch')),
        'drink': clean_list(raw.get('drink')),
    }


def read_records():
    try:
        with open(STORE, 'r', encoding='utf-8') as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            lines = f.readlines()
    except FileNotFoundError:
        return []
    records = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            records.append(json.loads(line))
        except ValueError:
            continue  # битую строку лучше пропустить, чем уронить всю выдачу
    return records


def append_record(record):
    os.makedirs(os.path.dirname(STORE), exist_ok=True)
    # Открываем на 'a+' и считаем строки под тем же замком, что и запись:
    # иначе два одновременных ответа могли бы вдвоём проскочить лимит.
    with open(STORE, 'a+', encoding='utf-8') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        if sum(1 for _ in f) >= MAX_RECORDS:
            return False
        f.write(json.dumps(record, ensure_ascii=False) + '\n')
        f.flush()
        os.fsync(f.fileno())
    return True


class Handler(BaseHTTPRequestHandler):
    server_version = 'sonechka'
    sys_version = ''
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        sys.stderr.write('%s %s\n' % (self.address_string(), fmt % args))

    def send_json(self, code, payload):
        body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def path_is(self, name):
        return self.path.split('?')[0].rstrip('/') == name

    def do_GET(self):
        if self.path_is('/api/answers'):
            self.send_json(200, {'answers': read_records()})
        elif self.path_is('/api/health'):
            self.send_json(200, {'ok': True})
        else:
            self.send_json(404, {'error': 'not found'})

    def do_POST(self):
        if not self.path_is('/api/answers'):
            self.send_json(404, {'error': 'not found'})
            return
        try:
            length = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self.send_json(413, {'error': 'bad body size'})
            return
        try:
            raw = json.loads(self.rfile.read(length).decode('utf-8'))
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {'error': 'bad json'})
            return
        if not isinstance(raw, dict):
            self.send_json(400, {'error': 'bad json'})
            return
        record = normalize(raw)
        if not append_record(record):
            self.send_json(507, {'error': 'store is full'})
            return
        self.send_json(200, {'ok': True, 'answer': record})


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    signal.signal(signal.SIGTERM, lambda *_: server.shutdown())
    sys.stderr.write('sonechka answers api on %s:%d, store %s\n' % (HOST, PORT, STORE))
    server.serve_forever()


if __name__ == '__main__':
    main()
