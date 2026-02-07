"""
Python GPU Worker - HTTP server for handling generation requests.
Runs as a separate process with CUDA_VISIBLE_DEVICES set before import.
"""
import os
import sys
import json
import time
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
import http.server
from enum import Enum


class EnumEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles Enum types."""
    def default(self, obj):
        if isinstance(obj, Enum):
            return obj.value
        return super().default(obj)

# Get config from environment
WORKER_PORT = int(os.environ.get('WORKER_PORT', 9000))
WORKER_GPU_ID = int(os.environ.get('WORKER_GPU_ID', 0))

print(f"[Worker {WORKER_GPU_ID}] Starting on port {WORKER_PORT}")
print(f"[Worker {WORKER_GPU_ID}] CUDA_VISIBLE_DEVICES = {os.environ.get('CUDA_VISIBLE_DEVICES', 'not set')}")

# Now import torch and check GPU
import torch
print(f"[Worker {WORKER_GPU_ID}] PyTorch version: {torch.__version__}")
print(f"[Worker {WORKER_GPU_ID}] CUDA available: {torch.cuda.is_available()}")
if torch.cuda.is_available():
    print(f"[Worker {WORKER_GPU_ID}] GPU: {torch.cuda.get_device_name(0)}")

# Import Fooocus modules
root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, root)
os.chdir(root)

from modules import config
import modules.async_worker as worker
from modules.hash_cache import init_cache

# Initialize config
print(f"[Worker {WORKER_GPU_ID}] Initializing config...")
config.update_files()
init_cache(config.model_filenames, config.paths_checkpoints, config.lora_filenames, config.paths_loras)

# Start the worker thread
worker_thread = threading.Thread(target=worker.worker, daemon=True)
worker_thread.start()
print(f"[Worker {WORKER_GPU_ID}] Worker thread started")


class WorkerHandler(BaseHTTPRequestHandler):
    # Class-level storage for task progress
    task_progress = {}
    active_tasks = {}
    FOOOCUS_ARGS_CONTRACT_VERSION = 1
    FOOOCUS_ARGS_EXPECTED_LENGTH = 152
    
    def log_message(self, format, *args):
        # Suppress default logging
        pass
    
    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data, cls=EnumEncoder).encode('utf-8'))

    @classmethod
    def validate_fooocus_args(cls, value):
        if not isinstance(value, list):
            return False, 'fooocus_args must be a list'
        if len(value) != cls.FOOOCUS_ARGS_EXPECTED_LENGTH:
            return False, f'fooocus_args length mismatch: got {len(value)}, expected {cls.FOOOCUS_ARGS_EXPECTED_LENGTH}'
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
    
    @staticmethod
    def encode_preview_image(image_data):
        """Encode preview image to base64 JPEG."""
        import base64
        import io
        from PIL import Image
        import numpy as np
        
        try:
            if image_data is None:
                return None
            
            # Convert numpy array to PIL Image
            if isinstance(image_data, np.ndarray):
                if image_data.dtype == np.float32 or image_data.dtype == np.float64:
                    image_data = (image_data * 255).astype(np.uint8)
                image_data = Image.fromarray(image_data)
            
            if isinstance(image_data, Image.Image):
                buffered = io.BytesIO()
                image_data.save(buffered, format="JPEG", quality=50)
                return base64.b64encode(buffered.getvalue()).decode("utf-8")
        except Exception as e:
            print(f"[Worker {WORKER_GPU_ID}] Preview encode error: {e}")
        
        return None
    
    def do_GET(self):
        if self.path == '/health':
            self.send_json({'status': 'ok', 'gpu': WORKER_GPU_ID})
        elif self.path.startswith('/progress/'):
            # Progress endpoint for polling
            task_id = self.path.split('/progress/')[-1]
            progress = WorkerHandler.task_progress.get(task_id, {
                'percentage': 0,
                'statusText': 'Unknown',
                'finished': False,
                'preview': None,
                'results': []
            })
            self.send_json(progress)
        elif self.path == '/progress':
            # Return all active task progress
            self.send_json(WorkerHandler.task_progress)
        elif self.path.startswith('/metadata'):
            parsed = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(parsed.query)
            filename = query.get('filename', [None])[0]
            if not filename:
                self.send_json({'success': False, 'error': 'filename is required'}, 400)
                return

            try:
                from modules import metadata_db
                metadata = metadata_db.get_metadata(os.path.basename(filename))
                self.send_json({'success': True, 'metadata': metadata})
            except Exception as e:
                self.send_json({'success': False, 'error': str(e)}, 500)
        else:
            self.send_json({'error': 'Not found'}, 404)
    
    def do_POST(self):
        if self.path == '/generate':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            task_id = None
            
            try:
                print(f"[Worker {WORKER_GPU_ID}] DEBUG: Received request, parsing JSON...")
                data = json.loads(body.decode('utf-8'))
                task_id = data.get('task_id', str(int(time.time() * 1000)))
                task_args = data.get('args', {})
                fooocus_args = data.get('fooocus_args')
                fooocus_args_contract_version = data.get('fooocus_args_contract_version')
                
                print(f"[Worker {WORKER_GPU_ID}] DEBUG: Task ID = {task_id}")
                print(f"[Worker {WORKER_GPU_ID}] DEBUG: Building task args...")
                
                # Initialize progress tracking
                WorkerHandler.task_progress[task_id] = {
                    'percentage': 0,
                    'statusText': 'Starting...',
                    'finished': False,
                    'preview': None,
                    'results': []
                }
                
                # Use prebuilt positional args from TypeScript when available.
                # Keep Python builder for backward compatibility.
                if fooocus_args is not None:
                    if fooocus_args_contract_version != WorkerHandler.FOOOCUS_ARGS_CONTRACT_VERSION:
                        raise ValueError(
                            f'fooocus_args contract version mismatch: got {fooocus_args_contract_version}, '
                            f'expected {WorkerHandler.FOOOCUS_ARGS_CONTRACT_VERSION}'
                        )
                    valid, reason = WorkerHandler.validate_fooocus_args(fooocus_args)
                    if not valid:
                        raise ValueError(f'Invalid fooocus_args: {reason}')
                    args = fooocus_args
                else:
                    args = self.build_task_args(task_args)
                
                print(f"[Worker {WORKER_GPU_ID}] DEBUG: Args built, creating AsyncTask...")
                
                # Create async task
                task = worker.AsyncTask(args=args)
                task.task_id = task_id
                
                print(f"[Worker {WORKER_GPU_ID}] DEBUG: AsyncTask created, adding to queue...")
                
                # Add to worker queue
                worker.async_tasks.append(task)
                WorkerHandler.active_tasks[task_id] = task
                
                print(f"[Worker {WORKER_GPU_ID}] DEBUG: Task added, waiting for completion...")
                
                # Wait for completion with progress tracking
                results = []
                while True:
                    if len(task.yields) > 0:
                        flag, product = task.yields.pop(0)
                        print(f"[Worker {WORKER_GPU_ID}] DEBUG: Yield flag = {flag}")
                        
                        if flag == 'preview':
                            # Handle preview/progress updates
                            percentage, title, image = product
                            preview_b64 = self.encode_preview_image(image)
                            WorkerHandler.task_progress[task_id] = {
                                'percentage': percentage,
                                'statusText': title,
                                'finished': False,
                                'preview': preview_b64,
                                'results': []
                            }
                        elif flag == 'finish':
                            results = list(product)
                            break
                        elif flag == 'results':
                            results = list(product)
                    time.sleep(0.1)
                
                print(f"[Worker {WORKER_GPU_ID}] DEBUG: Task completed, processing results...")
                print(f"[Worker {WORKER_GPU_ID}] DEBUG: Raw results = {results}")
                
                # Process paths
                processed_results = []
                for p in results:
                    if isinstance(p, str) and 'outputs' in p:
                        rel_path = p.replace('\\', '/').split('outputs/')[-1]
                        processed_results.append(rel_path)
                    else:
                        processed_results.append(str(p))
                
                print(f"[Worker {WORKER_GPU_ID}] DEBUG: Processed results = {processed_results}")
                print(f"[Worker {WORKER_GPU_ID}] DEBUG: Sending JSON response...")
                
                # Update final progress
                WorkerHandler.task_progress[task_id] = {
                    'percentage': 100,
                    'statusText': 'Finished',
                    'finished': True,
                    'preview': None,
                    'results': processed_results
                }
                
                response_data = {
                    'success': True,
                    'task_id': task_id,
                    'results': processed_results
                }
                
                # Try to serialize first to catch the error
                try:
                    json_str = json.dumps(response_data, cls=EnumEncoder)
                    print(f"[Worker {WORKER_GPU_ID}] DEBUG: JSON serialization OK, length = {len(json_str)}")
                except Exception as json_err:
                    print(f"[Worker {WORKER_GPU_ID}] DEBUG: JSON serialization FAILED: {json_err}")
                    # Find which field causes the issue
                    for key, value in response_data.items():
                        try:
                            json.dumps({key: value}, cls=EnumEncoder)
                        except Exception as field_err:
                            print(f"[Worker {WORKER_GPU_ID}] DEBUG: Field '{key}' failed: {field_err}, type={type(value)}")
                    raise json_err
                
                self.send_json(response_data)
                print(f"[Worker {WORKER_GPU_ID}] Completed task {task_id}")
                
                # Clean up progress after a short delay
                def cleanup():
                    time.sleep(60)
                    WorkerHandler.task_progress.pop(task_id, None)
                    WorkerHandler.active_tasks.pop(task_id, None)
                threading.Thread(target=cleanup, daemon=True).start()
                
            except Exception as e:
                import traceback
                print(f"[Worker {WORKER_GPU_ID}] ERROR: {e}")
                traceback.print_exc()
                if task_id is not None:
                    WorkerHandler.active_tasks.pop(task_id, None)
                self.send_json({
                    'success': False,
                    'error': str(e)
                }, 500)
        elif self.path == '/stop':
            stopped = 0

            # Stop active tasks.
            for _, task in list(WorkerHandler.active_tasks.items()):
                try:
                    task.last_stop = 'stop'
                    stopped += 1
                except Exception:
                    pass

            # Also stop queued tasks.
            for task in list(worker.async_tasks):
                try:
                    task.last_stop = 'stop'
                except Exception:
                    pass

            self.send_json({
                'success': True,
                'stopped_tasks': stopped
            })
        elif self.path == '/metadata_batch':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            try:
                data = json.loads(body.decode('utf-8')) if body else {}
                filenames = data.get('filenames', [])
                if not isinstance(filenames, list):
                    self.send_json({'success': False, 'error': 'filenames must be a list'}, 400)
                    return

                from modules import metadata_db
                result = {}
                for filename in filenames:
                    if not isinstance(filename, str):
                        continue
                    base = os.path.basename(filename)
                    result[base] = metadata_db.get_metadata(base)

                self.send_json({'success': True, 'metadata': result})
            except Exception as e:
                self.send_json({'success': False, 'error': str(e)}, 500)
        else:
            self.send_json({'error': 'Not found'}, 404)

    
    def build_task_args(self, request):
        """Build AsyncTask args from request body."""
        from modules.flags import Performance, MetadataScheme
        
        # Default values
        prompt = request.get('prompt', '')
        negative_prompt = request.get('negative_prompt', '')
        style_selections = request.get('style_selections', [])
        performance = request.get('performance_selection', 'Speed')
        aspect_ratio = request.get('aspect_ratios_selection', '1024×1024')
        image_number = request.get('image_number', 1)
        image_seed = request.get('image_seed', -1)
        seed_random = request.get('seed_random', True)
        sharpness = request.get('image_sharpness', 2.0)
        guidance_scale = request.get('guidance_scale', 4.0)
        base_model = request.get('base_model_name', config.default_base_model_name)
        refiner_model = request.get('refiner_model_name', 'None')
        refiner_switch = request.get('refiner_switch', 0.5)
        sampler = request.get('sampler_name', 'dpmpp_2m_sde_gpu')
        scheduler = request.get('scheduler_name', 'karras')
        vae = request.get('vae_name', 'Default (model)')
        output_format = request.get('output_format', 'png')
        clip_skip = request.get('clip_skip', 2)
        loras = request.get('loras', [])
        
        import modules.flags as flags
        
        args = [
            True,  # generate_image_grid
            prompt,
            negative_prompt,
            style_selections,
            performance,
            aspect_ratio,
            image_number,
            output_format,
            image_seed,
            seed_random,
            sharpness,
            guidance_scale,
            base_model,
            refiner_model,
            refiner_switch,
        ]
        
        # LoRAs
        for i in range(config.default_max_lora_number):
            if i < len(loras) and len(loras[i]) >= 3:
                args.extend([loras[i][0], loras[i][1], loras[i][2]])
            else:
                args.extend([False, 'None', 1.0])
        
        # Additional parameters  
        args.extend([
            True,  # input_image_checkbox
            'disabled',  # current_tab
            flags.uov_list[0],  # uov_method
            None,  # uov_input_image
            [],  # outpaint_selections (must be a list, not string)
            None,  # inpaint_input_image
            '',  # inpaint_additional_prompt
            None,  # inpaint_mask_image_upload
            False,  # disable_preview
            False,  # disable_intermediate_results
            False,  # disable_seed_increment
            config.default_black_out_nsfw,  # black_out_nsfw
            1.5, 0.8, 0.3,  # adm scalers (positive, negative, end)
            config.default_cfg_tsnr,  # adaptive_cfg
            clip_skip,
            sampler,
            scheduler,
            vae,
            -1, -1, -1, -1, -1, -1,  # overwrite params
            False, False, False, False,  # mixing/debugging flags
            64, 128,  # canny thresholds
            flags.refiner_swap_method,
            0.25,  # controlnet_softness
            False, 1.1, 1.2, 0.9, 0.2,  # freeu params
            False, False,  # inpaint flags
            'None', 1.0, 0.0,  # inpaint engine params
            False, False, 0,  # mask params
            config.default_save_only_final_enhanced_image,
            config.default_save_metadata_to_images,
            str(config.default_metadata_scheme) if hasattr(config.default_metadata_scheme, 'value') else config.default_metadata_scheme,
        ])
        
        # ControlNet tasks
        for _ in range(config.default_controlnet_image_count):
            args.extend([None, 1.0, 1.0, flags.default_ip])
        
        # Enhancement
        disabled = 'disabled' if hasattr(flags, 'disabled') else 'Disabled'
        args.extend([
            False, 0, False, None, False,
            disabled,
            flags.enhancement_uov_before,
            flags.enhancement_uov_prompt_type_original,
        ])
        
        # Enhance tabs
        for _ in range(config.default_enhance_tabs):
            args.extend([
                False, '', '', '', 'None', 'None', 'None',
                0.3, 0.25, 0, False, 'None', 1.0, 0.618, 0, False
            ])
        
        return args


class ThreadingHTTPServer(ThreadingMixIn, http.server.HTTPServer):
    """Handle requests in a separate thread."""
    daemon_threads = True


def run_server():
    server = ThreadingHTTPServer(('127.0.0.1', WORKER_PORT), WorkerHandler)
    print(f"[Worker {WORKER_GPU_ID}] Ready on port {WORKER_PORT}")
    server.serve_forever()


if __name__ == '__main__':
    run_server()
