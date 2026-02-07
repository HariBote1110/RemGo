"""
GPU Worker Process Manager.
Manages separate processes for each GPU, with inter-process communication via queues.
"""
import os
import sys
import json
import multiprocessing as mp
from multiprocessing import Process, Queue
from dataclasses import dataclass
from typing import Dict, Optional, Any
import time
import traceback


@dataclass
class TaskResult:
    task_id: str
    success: bool
    results: list
    error: Optional[str] = None


def gpu_worker_process(gpu_device: int, task_queue: Queue, result_queue: Queue, root_path: str):
    """
    Worker process that runs on a specific GPU.
    Each process has CUDA_VISIBLE_DEVICES set to only see its assigned GPU.
    """
    # Set CUDA_VISIBLE_DEVICES before importing torch
    os.environ['CUDA_VISIBLE_DEVICES'] = str(gpu_device)
    
    # Set up paths
    sys.path.insert(0, root_path)
    os.chdir(root_path)
    
    # Now we can import torch and other modules
    import torch
    
    print(f"[GPU Worker {gpu_device}] Started on CUDA device (visible as 0)")
    print(f"[GPU Worker {gpu_device}] Device name: {torch.cuda.get_device_name(0)}")
    
    # Import Fooocus modules
    from modules import config
    import modules.async_worker as worker
    from modules.hash_cache import init_cache
    
    # Initialize config
    config.update_files()
    init_cache(config.model_filenames, config.paths_checkpoints, config.lora_filenames, config.paths_loras)
    
    # Start the worker thread
    worker_thread = worker.threading.Thread(target=worker.worker, daemon=True)
    worker_thread.start()
    
    print(f"[GPU Worker {gpu_device}] Ready to process tasks")
    
    while True:
        try:
            # Wait for a task
            task_data = task_queue.get()
            
            if task_data is None:
                # Shutdown signal
                print(f"[GPU Worker {gpu_device}] Shutting down")
                break
            
            task_id = task_data['task_id']
            task_args = task_data['args']
            
            print(f"[GPU Worker {gpu_device}] Processing task {task_id}")
            
            try:
                # Create async task
                task = worker.AsyncTask(args=task_args)
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
                
                result_queue.put(TaskResult(
                    task_id=task_id,
                    success=True,
                    results=results
                ))
                print(f"[GPU Worker {gpu_device}] Completed task {task_id}")
                
            except Exception as e:
                print(f"[GPU Worker {gpu_device}] Error processing task {task_id}: {e}")
                traceback.print_exc()
                result_queue.put(TaskResult(
                    task_id=task_id,
                    success=False,
                    results=[],
                    error=str(e)
                ))
                
        except Exception as e:
            print(f"[GPU Worker {gpu_device}] Fatal error: {e}")
            traceback.print_exc()


class GPUWorkerManager:
    """Manages GPU worker processes."""
    
    def __init__(self):
        self.workers: Dict[int, Process] = {}
        self.task_queues: Dict[int, Queue] = {}
        self.result_queue: Queue = mp.Queue()
        self.pending_tasks: Dict[str, int] = {}  # task_id -> gpu_device
        self.root_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    
    def start_workers(self, gpu_configs: list) -> None:
        """Start worker processes for each configured GPU."""
        for gpu_config in gpu_configs:
            device = gpu_config.device
            self.start_worker(device)
    
    def start_worker(self, gpu_device: int) -> None:
        """Start a worker process for a specific GPU."""
        if gpu_device in self.workers:
            print(f"[Manager] Worker for GPU {gpu_device} already running")
            return
        
        task_queue = mp.Queue()
        self.task_queues[gpu_device] = task_queue
        
        process = Process(
            target=gpu_worker_process,
            args=(gpu_device, task_queue, self.result_queue, self.root_path),
            daemon=True
        )
        process.start()
        self.workers[gpu_device] = process
        print(f"[Manager] Started worker for GPU {gpu_device}")
    
    def stop_workers(self) -> None:
        """Stop all worker processes."""
        for device, queue in self.task_queues.items():
            queue.put(None)  # Shutdown signal
        
        for device, process in self.workers.items():
            process.join(timeout=5)
            if process.is_alive():
                process.terminate()
        
        self.workers.clear()
        self.task_queues.clear()
        print("[Manager] All workers stopped")
    
    def submit_task(self, gpu_device: int, task_id: str, task_args: list) -> bool:
        """Submit a task to a specific GPU worker."""
        if gpu_device not in self.task_queues:
            print(f"[Manager] No worker for GPU {gpu_device}")
            return False
        
        self.pending_tasks[task_id] = gpu_device
        self.task_queues[gpu_device].put({
            'task_id': task_id,
            'args': task_args
        })
        return True
    
    def get_result(self, timeout: float = 0) -> Optional[TaskResult]:
        """Get a completed task result."""
        try:
            result = self.result_queue.get(timeout=timeout)
            if result.task_id in self.pending_tasks:
                del self.pending_tasks[result.task_id]
            return result
        except:
            return None
    
    def is_worker_alive(self, gpu_device: int) -> bool:
        """Check if a worker process is alive."""
        if gpu_device in self.workers:
            return self.workers[gpu_device].is_alive()
        return False


# Global manager instance
_manager: Optional[GPUWorkerManager] = None


def get_manager() -> GPUWorkerManager:
    """Get or create the global worker manager."""
    global _manager
    if _manager is None:
        _manager = GPUWorkerManager()
    return _manager


def start_gpu_workers(gpu_configs: list) -> None:
    """Start GPU workers from config list."""
    get_manager().start_workers(gpu_configs)


def stop_gpu_workers() -> None:
    """Stop all GPU workers."""
    get_manager().stop_workers()


def submit_task(gpu_device: int, task_id: str, task_args: list) -> bool:
    """Submit a task to a GPU worker."""
    return get_manager().submit_task(gpu_device, task_id, task_args)
