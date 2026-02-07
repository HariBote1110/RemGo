"""
Python GPU Worker for RemGo inference runtime.

Modes:
- Legacy HTTP mode (default): exposes /health, /generate, /progress, /stop
- stdio JSON-RPC mode: method names health, generate, progress, stop
"""

import json
import os
import sys
import threading
import time
from enum import Enum
from http.server import BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
import http.server


class EnumEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles Enum types."""

    def default(self, obj):
        if isinstance(obj, Enum):
            return obj.value
        return super().default(obj)


WORKER_PORT = int(os.environ.get('WORKER_PORT', 9000))
WORKER_GPU_ID = int(os.environ.get('WORKER_GPU_ID', 0))
WORKER_RPC_MODE = os.environ.get('WORKER_RPC_MODE', 'http').lower()

FOOOCUS_ARGS_CONTRACT_VERSION = 1
FOOOCUS_ARGS_EXPECTED_LENGTH = 152

TASK_PROGRESS = {}
ACTIVE_TASKS = {}
TASK_LOCK = threading.Lock()

print(f"[Worker {WORKER_GPU_ID}] Starting on port {WORKER_PORT}")
print(f"[Worker {WORKER_GPU_ID}] Mode: {WORKER_RPC_MODE}")
print(f"[Worker {WORKER_GPU_ID}] CUDA_VISIBLE_DEVICES = {os.environ.get('CUDA_VISIBLE_DEVICES', 'not set')}")

import torch

print(f"[Worker {WORKER_GPU_ID}] PyTorch version: {torch.__version__}")
print(f"[Worker {WORKER_GPU_ID}] CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"[Worker {WORKER_GPU_ID}] GPU: {torch.cuda.get_device_name(0)}")

root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, root)
os.chdir(root)

from modules import config
import modules.async_worker as worker
from modules.hash_cache import init_cache

print(f"[Worker {WORKER_GPU_ID}] Initializing config...")
config.update_files()
init_cache(config.model_filenames, config.paths_checkpoints, config.lora_filenames, config.paths_loras)

worker_thread = threading.Thread(target=worker.worker, daemon=True)
worker_thread.start()
print(f"[Worker {WORKER_GPU_ID}] Worker thread started")


def validate_fooocus_args(value):
    if not isinstance(value, list):
        return False, 'fooocus_args must be a list'
    if len(value) != FOOOCUS_ARGS_EXPECTED_LENGTH:
        return False, f'fooocus_args length mismatch: got {len(value)}, expected {FOOOCUS_ARGS_EXPECTED_LENGTH}'
    if not isinstance(value[0], bool):
        return False, 'fooocus_args[0] must be bool'
    if not isinstance(value[1], str):
        return False, 'fooocus_args[1] must be str'
    if not isinstance(value[2], str):
        return False, 'fooocus_args[2] must be str'
    if not isinstance(value[3], list) or not all(isinstance(x, str) for x in value[3]):
        return False, 'fooocus_args[3] must be list[str]'
    if not isinstance(value[6], (int, float)):
        return False, 'fooocus_args[6] must be number'
    if not isinstance(value[8], (int, float)):
        return False, 'fooocus_args[8] must be number'
    if not isinstance(value[9], bool):
        return False, 'fooocus_args[9] must be bool'
    return True, ''


def encode_preview_image(image_data):
    """Encode preview image to base64 JPEG."""
    import base64
    import io
    from PIL import Image
    import numpy as np

    try:
        if image_data is None:
            return None

        if isinstance(image_data, np.ndarray):
            if image_data.dtype in (np.float32, np.float64):
                image_data = (image_data * 255).astype(np.uint8)
            image_data = Image.fromarray(image_data)

        if isinstance(image_data, Image.Image):
            buffered = io.BytesIO()
            image_data.save(buffered, format='JPEG', quality=50)
            return base64.b64encode(buffered.getvalue()).decode('utf-8')
    except Exception as e:
        print(f"[Worker {WORKER_GPU_ID}] Preview encode error: {e}")

    return None


def default_progress(status='Unknown'):
    return {
        'percentage': 0,
        'statusText': status,
        'finished': False,
        'preview': None,
        'results': [],
    }


def set_progress(task_id, payload):
    with TASK_LOCK:
        TASK_PROGRESS[task_id] = payload


def get_progress(task_id):
    with TASK_LOCK:
        return TASK_PROGRESS.get(task_id, default_progress())


def _cleanup_task(task_id):
    time.sleep(60)
    with TASK_LOCK:
        TASK_PROGRESS.pop(task_id, None)
        ACTIVE_TASKS.pop(task_id, None)


def _run_task_to_completion(task_id, args):
    task = worker.AsyncTask(args=args)
    task.task_id = task_id

    with TASK_LOCK:
        ACTIVE_TASKS[task_id] = task

    worker.async_tasks.append(task)

    results = []
    while True:
        if len(task.yields) > 0:
            flag, product = task.yields.pop(0)

            if flag == 'preview':
                percentage, title, image = product
                set_progress(task_id, {
                    'percentage': percentage,
                    'statusText': title,
                    'finished': False,
                    'preview': encode_preview_image(image),
                    'results': [],
                })
            elif flag == 'finish':
                results = list(product)
                break
            elif flag == 'results':
                results = list(product)

        time.sleep(0.1)

    processed_results = []
    for p in results:
        if isinstance(p, str) and 'outputs' in p:
            rel_path = p.replace('\\', '/').split('outputs/')[-1]
            processed_results.append(rel_path)
        else:
            processed_results.append(str(p))

    set_progress(task_id, {
        'percentage': 100,
        'statusText': 'Finished',
        'finished': True,
        'preview': None,
        'results': processed_results,
    })

    return processed_results


def _run_task_async(task_id, args):
    try:
        _run_task_to_completion(task_id, args)
    except Exception as e:
        set_progress(task_id, {
            'percentage': 100,
            'statusText': f'Error: {e}',
            'finished': True,
            'preview': None,
            'results': [],
            'error': str(e),
        })
    finally:
        threading.Thread(target=_cleanup_task, args=(task_id,), daemon=True).start()


def _validate_generate_payload(payload):
    task_id = str(payload.get('task_id', str(int(time.time() * 1000))))
    fooocus_args = payload.get('fooocus_args')
    fooocus_args_contract_version = payload.get('fooocus_args_contract_version')

    if fooocus_args is None:
        raise ValueError('fooocus_args is required')

    if fooocus_args_contract_version != FOOOCUS_ARGS_CONTRACT_VERSION:
        raise ValueError(
            f'fooocus_args contract version mismatch: got {fooocus_args_contract_version}, '
            f'expected {FOOOCUS_ARGS_CONTRACT_VERSION}'
        )

    valid, reason = validate_fooocus_args(fooocus_args)
    if not valid:
        raise ValueError(f'Invalid fooocus_args: {reason}')

    return task_id, fooocus_args


def handle_generate(payload, wait_for_result):
    task_id, args = _validate_generate_payload(payload)
    set_progress(task_id, default_progress('Starting...'))

    if wait_for_result:
        results = _run_task_to_completion(task_id, args)
        threading.Thread(target=_cleanup_task, args=(task_id,), daemon=True).start()
        return {'success': True, 'task_id': task_id, 'results': results}

    thread = threading.Thread(target=_run_task_async, args=(task_id, args), daemon=True)
    thread.start()
    return {'success': True, 'accepted': True, 'task_id': task_id}


def handle_stop():
    stopped = 0

    with TASK_LOCK:
        active_values = list(ACTIVE_TASKS.values())

    for task in active_values:
        try:
            task.last_stop = 'stop'
            stopped += 1
        except Exception:
            pass

    for task in list(worker.async_tasks):
        try:
            task.last_stop = 'stop'
        except Exception:
            pass

    return {'success': True, 'stopped_tasks': stopped}


class WorkerHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, cls=EnumEncoder).encode('utf-8'))

    def do_GET(self):
        if self.path == '/health':
            self.send_json({'status': 'ok', 'gpu': WORKER_GPU_ID})
        elif self.path.startswith('/progress/'):
            task_id = self.path.split('/progress/')[-1]
            self.send_json(get_progress(task_id))
        elif self.path == '/progress':
            with TASK_LOCK:
                self.send_json(dict(TASK_PROGRESS))
        else:
            self.send_json({'error': 'Not found'}, 404)

    def do_POST(self):
        if self.path == '/generate':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            try:
                data = json.loads(body.decode('utf-8'))
                response = handle_generate(data, wait_for_result=True)
                self.send_json(response)
            except Exception as e:
                self.send_json({'success': False, 'error': str(e)}, 500)
        elif self.path == '/stop':
            self.send_json(handle_stop())
        else:
            self.send_json({'error': 'Not found'}, 404)


class ThreadingHTTPServer(ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


def _rpc_write(message):
    sys.stdout.write(f"{json.dumps(message, cls=EnumEncoder)}\\n")
    sys.stdout.flush()


def run_rpc_server():
    print(f"[Worker {WORKER_GPU_ID}] Ready (stdio RPC)", file=sys.stderr)

    for line in sys.stdin:
        raw = line.strip()
        if not raw:
            continue

        try:
            request = json.loads(raw)
            rpc_id = request.get('id')
            method = request.get('method')
            params = request.get('params', {})

            if not isinstance(params, dict):
                raise ValueError('params must be an object')

            if method == 'health':
                result = {'status': 'ok', 'gpu': WORKER_GPU_ID}
            elif method == 'progress':
                task_id = str(params.get('task_id', ''))
                if not task_id:
                    raise ValueError('task_id is required')
                result = get_progress(task_id)
            elif method == 'generate':
                result = handle_generate(params, wait_for_result=False)
            elif method == 'stop':
                result = handle_stop()
            else:
                raise ValueError(f'Unknown method: {method}')

            _rpc_write({'jsonrpc': '2.0', 'id': rpc_id, 'result': result})
        except Exception as e:
            _rpc_write({
                'jsonrpc': '2.0',
                'id': request.get('id') if 'request' in locals() and isinstance(request, dict) else None,
                'error': {'message': str(e)},
            })


def run_http_server():
    server = ThreadingHTTPServer(('127.0.0.1', WORKER_PORT), WorkerHandler)
    print(f"[Worker {WORKER_GPU_ID}] Ready on port {WORKER_PORT}")
    server.serve_forever()


if __name__ == '__main__':
    if WORKER_RPC_MODE == 'stdio':
        run_rpc_server()
    else:
        run_http_server()
