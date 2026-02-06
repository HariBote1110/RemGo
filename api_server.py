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
    image_sharpness: float = 2.0
    guidance_scale: float = 4.0
    base_model_name: str = "juggernautXL_v8Rundiffusion.safetensors"
    refiner_model_name: str = "None"
    refiner_switch: float = 0.5
    sampler_name: str = "dpmpp_2m_sde_gpu"
    scheduler_name: str = "karras"
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
        "aspect_ratios": [r.replace('*', '×') for r in config.available_aspect_ratios],
        "performance_options": [p.value for p in flags.Performance] if hasattr(flags.Performance, '__iter__') else flags.Performance.values(),
        "styles": legal_style_names
    }

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
        "png", # output_format
        request.image_seed if request.image_seed != -1 else int(time.time()),
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
        1, # clip_skip
        request.sampler_name,
        request.scheduler_name,
        config.default_vae, # vae_name
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
                # status.preview_image = image # Optimization: maybe not send raw image via WS by default
            elif flag == 'results':
                status.results = product
            elif flag == 'finish':
                status.results = product
                status.finished = True
                status.percentage = 100
                status.status_text = "Finished"
        await asyncio.sleep(0.1)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            updates = {tid: {
                "progress": t.percentage, 
                "status": t.status_text,
                "finished": t.finished,
                "results": t.results if t.finished else []
            } for tid, t in active_tasks.items()}
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
