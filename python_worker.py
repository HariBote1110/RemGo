"""
Python GPU Worker - HTTP server for handling generation requests.
Runs as a separate process with CUDA_VISIBLE_DEVICES set before import.
"""
import os
import sys
import json
import time
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
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
    def log_message(self, format, *args):
        # Suppress default logging
        pass
    
    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data, cls=EnumEncoder).encode('utf-8'))
    
    def do_GET(self):
        if self.path == '/health':
            self.send_json({'status': 'ok', 'gpu': WORKER_GPU_ID})
        else:
            self.send_json({'error': 'Not found'}, 404)
    
    def do_POST(self):
        if self.path == '/generate':
            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)
            
            try:
                data = json.loads(body.decode('utf-8'))
                task_id = data.get('task_id', str(int(time.time() * 1000)))
                task_args = data.get('args', {})
                
                print(f"[Worker {WORKER_GPU_ID}] Processing task {task_id}")
                
                # Build task args from request
                args = self.build_task_args(task_args)
                
                # Create async task
                task = worker.AsyncTask(args=args)
                task.task_id = task_id
                
                # Add to worker queue
                worker.async_tasks.append(task)
                
                # Wait for completion
                results = []
                while True:
                    if len(task.yields) > 0:
                        flag, product = task.yields.pop(0)
                        if flag == 'finish':
                            results = list(product)
                            break
                        elif flag == 'results':
                            results = list(product)
                    time.sleep(0.1)
                
                # Process paths
                processed_results = []
                for p in results:
                    if isinstance(p, str) and 'outputs' in p:
                        rel_path = p.replace('\\', '/').split('outputs/')[-1]
                        processed_results.append(rel_path)
                    else:
                        processed_results.append(str(p))
                
                print(f"[Worker {WORKER_GPU_ID}] Completed task {task_id}")
                self.send_json({
                    'success': True,
                    'task_id': task_id,
                    'results': processed_results
                })
                
            except Exception as e:
                import traceback
                traceback.print_exc()
                self.send_json({
                    'success': False,
                    'error': str(e)
                }, 500)
        else:
            self.send_json({'error': 'Not found'}, 404)
    
    def build_task_args(self, request):
        """Build AsyncTask args from request body."""
        from modules.flags import Performance, MetadataScheme
        
        # Default values
        prompt = request.get('prompt', '')
        negative_prompt = request.get('negative_prompt', '')
        style_selections = request.get('style_selections', ['Fooocus V2', 'Fooocus Enhance', 'Fooocus Sharp'])
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
            None, None, None, None,  # uov/inpaint images
            '',  # outpaint selections
            None,  # inpaint_input_image
            '',  # inpaint_additional_prompt
            None,  # inpaint_mask_image_upload
            config.default_black_out_nsfw,
            1.5, 0.8, 0.3,  # adm scalers
            config.default_cfg_tsnr,
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


def run_server():
    server = HTTPServer(('127.0.0.1', WORKER_PORT), WorkerHandler)
    print(f"[Worker {WORKER_GPU_ID}] Ready on port {WORKER_PORT}")
    server.serve_forever()


if __name__ == '__main__':
    run_server()
