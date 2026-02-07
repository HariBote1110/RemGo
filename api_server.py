import os
import sys
import threading
import time
import asyncio
from typing import List, Optional
from fastapi import FastAPI, WebSocket, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import uvicorn

# Fooocus root directory
root = os.path.dirname(os.path.abspath(__file__))
sys.path.append(root)
os.chdir(root)

import fooocus_version
from modules import config
from modules.hash_cache import init_cache
import modules.async_worker as worker
import modules.flags as flags
import ldm_patched.modules.model_management as model_management

app = FastAPI(title=f"RemGo API v{fooocus_version.version}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount outputs folder for image serving
if not os.path.exists('outputs'):
    os.makedirs('outputs')
app.mount("/images", StaticFiles(directory="outputs"), name="images")

# Task state management
class TaskRequest(BaseModel):
    prompt: str
    negative_prompt: Optional[str] = ""
    style_selections: List[str] = ["Fooocus V2", "Fooocus Enhance", "Fooocus Sharp"]
    performance_selection: str = "Speed"
    aspect_ratios_selection: str = "1024×1024"
    image_number: int = 1
    image_seed: int = -1
    seed_random: bool = True
    image_sharpness: float = 2.0
    guidance_scale: float = 4.0
    base_model_name: str = "juggernautXL_v8Rundiffusion.safetensors"
    refiner_model_name: str = "None"
    refiner_switch: float = 0.5
    sampler_name: str = "dpmpp_2m_sde_gpu"
    scheduler_name: str = "karras"
    vae_name: str = "Default (model)"
    output_format: str = "png"
    clip_skip: int = 2
    loras: List[List] = [] # [[enabled, name, weight], ...]

class TaskStatus:
    def __init__(self):
        self.percentage = 0
        self.status_text = "Idle"
        self.preview_image = None
        self.results = []
        self.finished = False

active_tasks = {} # task_id -> TaskStatus
task_queue = []

try:
    from modules.sdxl_styles import legal_style_names
except ImportError:
    legal_style_names = []

@app.get("/settings")
async def get_settings():
    return {
        "models": config.model_filenames,
        "loras": config.lora_filenames,
        "vaes": [flags.default_vae] + config.vae_filenames,
        "aspect_ratios": [r.replace('*', '×') for r in config.available_aspect_ratios],
        "performance_options": [p.value for p in flags.Performance] if hasattr(flags.Performance, '__iter__') else flags.Performance.values(),
        "styles": legal_style_names,
        "presets": config.available_presets,
        "samplers": flags.sampler_list,
        "schedulers": flags.scheduler_list,
        "output_formats": flags.OutputFormat.list(),
        "clip_skip_max": flags.clip_skip_max,
        "default_lora_count": config.default_max_lora_number
    }

@app.get("/presets")
async def get_presets():
    return {"presets": config.available_presets}

@app.get("/presets/{name}")
async def get_preset_details(name: str):
    try:
        content = config.try_get_preset_content(name)
        return content
    except Exception as e:
        raise HTTPException(status_code=404, detail="Preset not found")

def build_async_task_args(request: TaskRequest):
    # This must match AsyncTask.__init__ in modules/async_worker.py
    # We provide default values for many Gradio-specific parameters
    from modules.flags import disabled
    
    args = [
        False, # generate_image_grid
        request.prompt,
        request.negative_prompt,
        request.style_selections,
        request.performance_selection,
        request.aspect_ratios_selection.replace('*', '×'),
        request.image_number,
        request.output_format, # output_format
        request.image_seed if not request.seed_random and request.image_seed != -1 else int(time.time()),
        False, # read_wildcards_in_order
        request.image_sharpness,
        request.guidance_scale,
        request.base_model_name,
        request.refiner_model_name,
        request.refiner_switch,
    ]
    
    # LoRAs (up to default_max_lora_number)
    for i in range(config.default_max_lora_number):
        if i < len(request.loras):
            args.extend(request.loras[i])
        else:
            args.extend([False, "None", 1.0])
            
    # Input Image related (defaulting many to disabled/None)
    args.extend([
        False, # input_image_checkbox
        "uov", # current_tab
        disabled, # uov_method
        None, # uov_input_image
        [], # outpaint_selections
        None, # inpaint_input_image
        "", # inpaint_additional_prompt
        None, # inpaint_mask_image_upload
        False, # disable_preview
        False, # disable_intermediate_results
        False, # disable_seed_increment
        config.default_black_out_nsfw,
        1.5, # adm_scaler_positive
        0.8, # adm_scaler_negative
        0.3, # adm_scaler_end
        config.default_cfg_tsnr, # adaptive_cfg
        request.clip_skip, # clip_skip
        request.sampler_name,
        request.scheduler_name,
        request.vae_name, # vae_name
        -1, # overwrite_step
        -1, # overwrite_switch
        -1, # overwrite_width
        -1, # overwrite_height
        -1, # overwrite_vary_strength
        -1, # overwrite_upscale_strength
        False, # mixing_image_prompt_and_vary_upscale
        False, # mixing_image_prompt_and_inpaint
        False, # debugging_cn_preprocessor
        False, # skipping_cn_preprocessor
        64, # canny_low_threshold
        128, # canny_high_threshold
        flags.refiner_swap_method,
        0.25, # controlnet_softness
        False, # freeu_enabled
        1.1, # freeu_b1
        1.2, # freeu_b2
        0.9, # freeu_s1
        0.2, # freeu_s2
        False, # debugging_inpaint_preprocessor
        False, # inpaint_disable_initial_latent
        "None", # inpaint_engine
        1.0, # inpaint_strength
        0.0, # inpaint_respective_field
        False, # inpaint_advanced_masking_checkbox
        False, # invert_mask_checkbox
        0, # inpaint_erode_or_dilate
        config.default_save_only_final_enhanced_image, # save_final_enhanced_image_only
        config.default_save_metadata_to_images, # save_metadata_to_images
        flags.MetadataScheme(config.default_metadata_scheme), # metadata_scheme
    ])
    
    # ControlNet tasks
    for _ in range(config.default_controlnet_image_count):
        args.extend([None, 1.0, 1.0, flags.default_ip])
        
    args.extend([
        False, # debugging_dino
        0, # dino_erode_or_dilate
        False, # debugging_enhance_masks_checkbox
        None, # enhance_input_image
        False, # enhance_checkbox
        disabled, # enhance_uov_method
        flags.enhancement_uov_before, # enhance_uov_processing_order
        flags.enhancement_uov_prompt_type_original, # enhance_uov_prompt_type
    ])
    
    # Enhance tabs
    for _ in range(config.default_enhance_tabs):
        args.extend([
            False, "", "", "", "None", "None", "None", 
            0.3, 0.25, 0, False, "None", 1.0, 0.618, 0, False
        ])
        
    return args

@app.post("/generate")
async def generate_image(request: TaskRequest):
    task_id = str(int(time.time() * 1000))
    active_tasks[task_id] = TaskStatus()
    
    task_args = build_async_task_args(request)
    task = worker.AsyncTask(args=task_args)
    task.task_id = task_id # Attach our ID
    
    worker.async_tasks.append(task)
    
    
    asyncio.create_task(monitor_task(task))
    
    return {"task_id": task_id, "status": "Started"}

@app.post("/stop")
async def stop_generation():
    # Stop pending tasks
    while len(worker.async_tasks) > 0:
        worker.async_tasks.pop(0)

    # Stop current task
    # We need a way to signal the worker thread to stop.
    # Currently async_worker.py checks 'last_stop' in some places but mostly relies on exception handling.
    # A robust implementation would require ldm_patched.modules.model_management.interrupt_current_processing()
    try:
        model_management.interrupt_current_processing()
        return {"status": "Stopping"}
    except Exception as e:
        return {"status": "Error stopping", "detail": str(e)}

@app.get("/history")
async def get_history():
    history = []
    outputs_dir = os.path.join(root, 'outputs')
    if os.path.exists(outputs_dir):
        # Walk through date directories
        for date_dir in os.listdir(outputs_dir):
            date_path = os.path.join(outputs_dir, date_dir)
            if os.path.isdir(date_path):
                for filename in os.listdir(date_path):
                    if filename.endswith(('.png', '.jpg', '.jpeg', '.webp')):
                        filepath = os.path.join(date_dir, filename)
                        full_path = os.path.join(date_path, filename)
                        history.append({
                            "filename": filename,
                            "path": filepath.replace('\\', '/'), # Relative path for serving
                            "created": os.path.getctime(full_path)
                        })
    # Sort by creation time descending
    history.sort(key=lambda x: x['created'], reverse=True)
    return history

@app.get("/history/metadata/{date_dir}/{filename}")
async def get_image_metadata(date_dir: str, filename: str):
    """Get metadata from log.html for an image file."""
    import re
    import urllib.parse
    
    outputs_dir = os.path.join(root, 'outputs')
    log_path = os.path.join(outputs_dir, date_dir, 'log.html')
    
    if not os.path.exists(log_path):
        # Fallback: try to read from image metadata
        return await get_image_metadata_from_file(date_dir, filename)
    
    try:
        with open(log_path, 'r', encoding='utf-8') as f:
            html_content = f.read()
        
        # Find the div containing this image
        # The image name is in the div id attribute (with _ instead of .)
        image_id = filename.replace('.', '_')
        
        # Find the button onclick with metadata for this image
        # Pattern: div id="filename"...to_clipboard('encoded_json')
        pattern = rf'<div id="{re.escape(image_id)}"[^>]*>.*?to_clipboard\(\'([^\']+)\'\)'
        match = re.search(pattern, html_content, re.DOTALL)
        
        if match:
            encoded_json = match.group(1)
            decoded_json = urllib.parse.unquote(encoded_json)
            metadata = json.loads(decoded_json)
            return {"metadata": metadata, "scheme": "fooocus_log"}
        else:
            return {"metadata": None, "scheme": None}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read metadata: {str(e)}")

async def get_image_metadata_from_file(date_dir: str, filename: str):
    """Fallback: Get metadata embedded in an image file."""
    from PIL import Image
    from modules.meta_parser import read_info_from_image, get_metadata_parser
    
    outputs_dir = os.path.join(root, 'outputs')
    image_path = os.path.join(outputs_dir, date_dir, filename)
    
    if not os.path.exists(image_path):
        raise HTTPException(status_code=404, detail="Image not found")
    
    try:
        with Image.open(image_path) as img:
            parameters, metadata_scheme = read_info_from_image(img)
            
            if parameters is None:
                return {"metadata": None, "scheme": None}
            
            result = {}
            if metadata_scheme:
                try:
                    parser = get_metadata_parser(metadata_scheme)
                    if isinstance(parameters, str):
                        result = parser.to_json(parameters)
                    elif isinstance(parameters, dict):
                        result = parameters
                except Exception:
                    result = parameters if isinstance(parameters, dict) else {"raw": parameters}
            else:
                result = parameters if isinstance(parameters, dict) else {"raw": parameters}
            
            return {
                "metadata": result,
                "scheme": metadata_scheme.value if metadata_scheme else None
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read metadata: {str(e)}")

def process_path(p):
    if isinstance(p, str):
        # Normalize path separators
        p = p.replace('\\', '/')
        # Check if it is in outputs folder
        if 'outputs/' in p:
            # Extract relative path from outputs
            rel_path = p.split('outputs/')[-1]
            return rel_path
    return p

async def monitor_task(task):
    task_id = task.task_id
    status = active_tasks[task_id]
    
    while not status.finished:
        if len(task.yields) > 0:
            flag, product = task.yields.pop(0)
            if flag == 'preview':
                percentage, title, image = product
                status.percentage = percentage
                status.status_text = title
                if isinstance(image, str): # Base64 string ? No, it's likely a PIL image or numpy array passed here?
                    # In async_worker.py: yield_result calls log() which returns path, OR for preview it might return something else.
                    # Actually async_worker.py preview yield is: ['preview', (current_progress, '...', y)]
                    # where y is None or prompt text or something.
                    # Wait, let's check async_worker.py Callback.
                    # "async_task.yields.append(['preview', (int(current_progress...), 'Sampling step...', y)])"
                    # 'y' comes from callback(step, x0, x, total_steps, y). 
                    # We might need to encode it to base64 if it is a tensor/array.
                    pass
                status.preview_image = image 
            elif flag == 'results':
                status.results = [process_path(p) for p in product]
            elif flag == 'finish':
                status.results = [process_path(p) for p in product]
                status.finished = True
                status.percentage = 100
                status.status_text = "Finished"
        await asyncio.sleep(0.1)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    import base64
    import io
    from PIL import Image
    import numpy as np

    try:
        while True:
            updates = {}
            for tid, t in active_tasks.items():
                preview_b64 = None
                if t.preview_image is not None:
                    try:
                        # Handle different image types
                        img_data = t.preview_image
                        
                        # Convert numpy array to PIL Image
                        if isinstance(img_data, np.ndarray):
                             # Normalize if float
                            if img_data.dtype == np.float32 or img_data.dtype == np.float64:
                                img_data = (img_data * 255).astype(np.uint8)
                            img_data = Image.fromarray(img_data)

                        if isinstance(img_data, Image.Image):
                            buffered = io.BytesIO()
                            img_data.save(buffered, format="JPEG", quality=50) # Low quality for preview
                            preview_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
                    except Exception as e:
                        print(f"Preview encoding error: {e}")
                
                updates[tid] = {
                    "progress": t.percentage, 
                    "status": t.status_text,
                    "finished": t.finished,
                    "results": t.results if t.finished else [],
                    "preview": preview_b64
                }
            
            await websocket.send_json(updates)
            await asyncio.sleep(0.5)
    except Exception:
        pass

def run_api_server(host="0.0.0.0", port=8888):
    uvicorn.run(app, host=host, port=port)

if __name__ == "__main__":
    try:
        # Initialize Fooocus environment
        import args_manager
        args = args_manager.args
        config.update_files()
        
        # Device information for debugging
        try:
            import torch
            if torch.backends.mps.is_available():
                print("Target Device: macOS MPS (Metal Performance Shaders) detected.")
            elif torch.cuda.is_available():
                print(f"Target Device: CUDA ({torch.cuda.get_device_name(0)}) detected.")
            else:
                print("Target Device: CPU")
        except Exception:
            pass

        if args.gpu_device_id is not None:
            os.environ['CUDA_VISIBLE_DEVICES'] = str(args.gpu_device_id)

        # Initialize and download models if necessary
        from modules.hash_cache import init_cache
        from modules.model_downloader import download_models
        
        config.default_base_model_name, config.checkpoint_downloads = download_models(
            config.default_base_model_name, config.previous_default_models, config.checkpoint_downloads,
            config.embeddings_downloads, config.lora_downloads, config.vae_downloads)

        config.update_files()
        print(f"Current Working Directory: {os.getcwd()}")
        print(f"Checkpoints paths: {config.paths_checkpoints}")
        for p in config.paths_checkpoints:
            if os.path.exists(p):
                print(f"Contents of {p}: {os.listdir(p)}")
            else:
                print(f"Path does not exist: {p}")
        print(f"Models found: {config.model_filenames}")
        
        init_cache(config.model_filenames, config.paths_checkpoints, config.lora_filenames, config.paths_loras)
        
        from modules.sdxl_styles import legal_style_names
        
        print(f"Starting RemGo API Server on http://0.0.0.0:8888")
        run_api_server()
    except Exception as e:
        import traceback
        print("CRITICAL ERROR DURING INITIALIZATION:")
        traceback.print_exc()
        sys.exit(1)
