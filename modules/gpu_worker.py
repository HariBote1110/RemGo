"""
GPU Worker Process Manager.
Uses separate Python subprocesses for each GPU with socket-based IPC.
Each subprocess has CUDA_VISIBLE_DEVICES set before torch import.
"""
import os
import sys
import json
import socket
import threading
import subprocess
import pickle
from dataclasses import dataclass
from typing import Dict, Optional, Any, List
import time
import traceback


@dataclass
class TaskResult:
    task_id: str
    success: bool
    results: list
    error: Optional[str] = None


def find_free_port():
    """Find a free port for IPC."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def gpu_worker_process_main(gpu_device: int, port: int):
    """
    Main entry point for GPU worker subprocess.
    CUDA_VISIBLE_DEVICES must be set before this is called.
    """
    import torch
    
    print(f"[GPU Worker {gpu_device}] Started on CUDA device (visible as 0)")
    print(f"[GPU Worker {gpu_device}] Device name: {torch.cuda.get_device_name(0)}")
    print(f"[GPU Worker {gpu_device}] Listening on port {port}")
    
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
    
    # Set up socket server
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(('127.0.0.1', port))
    server.listen(5)
    
    while True:
        try:
            conn, addr = server.accept()
            
            # Receive task data
            data = b''
            while True:
                chunk = conn.recv(4096)
                if not chunk:
                    break
                data += chunk
                if b'__END__' in data:
                    data = data.replace(b'__END__', b'')
                    break
            
            if not data:
                conn.close()
                continue
            
            task_data = json.loads(data.decode('utf-8'))
            
            if task_data.get('shutdown'):
                print(f"[GPU Worker {gpu_device}] Shutting down")
                conn.send(b'OK')
                conn.close()
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
                
                result = {
                    'task_id': task_id,
                    'success': True,
                    'results': results,
                    'error': None
                }
                print(f"[GPU Worker {gpu_device}] Completed task {task_id}")
                
            except Exception as e:
                print(f"[GPU Worker {gpu_device}] Error processing task {task_id}: {e}")
                traceback.print_exc()
                result = {
                    'task_id': task_id,
                    'success': False,
                    'results': [],
                    'error': str(e)
                }
            
            # Send result back
            conn.send(json.dumps(result).encode('utf-8'))
            conn.close()
                
        except Exception as e:
            print(f"[GPU Worker {gpu_device}] Fatal error: {e}")
            traceback.print_exc()
    
    server.close()


class GPUWorkerManager:
    """Manages GPU worker processes with socket-based IPC."""
    
    def __init__(self):
        self.workers: Dict[int, subprocess.Popen] = {}
        self.worker_ports: Dict[int, int] = {}
        self.pending_results: Dict[str, TaskResult] = {}
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
        
        port = find_free_port()
        self.worker_ports[gpu_device] = port
        
        # Create worker script
        worker_script = f'''
import os
import sys

# Set CUDA_VISIBLE_DEVICES BEFORE importing torch
os.environ['CUDA_VISIBLE_DEVICES'] = '{gpu_device}'

# Set up paths
sys.path.insert(0, r'{self.root_path}')
os.chdir(r'{self.root_path}')

# Now import and run worker
from modules.gpu_worker import gpu_worker_process_main
gpu_worker_process_main({gpu_device}, {port})
'''
        
        # Write temp script
        script_path = os.path.join(self.root_path, f'.gpu_worker_{gpu_device}.py')
        with open(script_path, 'w') as f:
            f.write(worker_script)
        
        # Start subprocess with correct CUDA_VISIBLE_DEVICES
        env = os.environ.copy()
        env['CUDA_VISIBLE_DEVICES'] = str(gpu_device)
        
        process = subprocess.Popen(
            [sys.executable, script_path],
            env=env,
            cwd=self.root_path
        )
        
        self.workers[gpu_device] = process
        print(f"[Manager] Started worker for GPU {gpu_device} on port {port} (PID: {process.pid})")
        
        # Wait a bit for worker to start
        time.sleep(2)
    
    def stop_workers(self) -> None:
        """Stop all worker processes."""
        for device in list(self.workers.keys()):
            try:
                self._send_to_worker(device, {'shutdown': True})
            except:
                pass
        
        for device, process in self.workers.items():
            process.wait(timeout=5)
            if process.poll() is None:
                process.terminate()
        
        self.workers.clear()
        self.worker_ports.clear()
        print("[Manager] All workers stopped")
    
    def _send_to_worker(self, gpu_device: int, data: dict) -> Optional[dict]:
        """Send data to a worker and get response."""
        if gpu_device not in self.worker_ports:
            return None
        
        port = self.worker_ports[gpu_device]
        
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.connect(('127.0.0.1', port))
            sock.send(json.dumps(data).encode('utf-8') + b'__END__')
            
            # Receive response
            response = b''
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                response += chunk
            
            sock.close()
            
            if response:
                return json.loads(response.decode('utf-8'))
            return None
        except Exception as e:
            print(f"[Manager] Error communicating with GPU {gpu_device}: {e}")
            return None
    
    def submit_task(self, gpu_device: int, task_id: str, task_args: list) -> bool:
        """Submit a task to a specific GPU worker."""
        if gpu_device not in self.workers:
            print(f"[Manager] No worker for GPU {gpu_device}")
            return False
        
        # Send task in a thread to avoid blocking
        def send_task():
            result = self._send_to_worker(gpu_device, {
                'task_id': task_id,
                'args': task_args
            })
            if result:
                self.pending_results[task_id] = TaskResult(
                    task_id=result['task_id'],
                    success=result['success'],
                    results=result['results'],
                    error=result.get('error')
                )
        
        thread = threading.Thread(target=send_task, daemon=True)
        thread.start()
        return True
    
    def get_result(self, task_id: str = None, timeout: float = 0) -> Optional[TaskResult]:
        """Get a completed task result."""
        end_time = time.time() + timeout if timeout > 0 else time.time()
        
        while time.time() <= end_time:
            if task_id and task_id in self.pending_results:
                return self.pending_results.pop(task_id)
            elif not task_id and self.pending_results:
                key = next(iter(self.pending_results))
                return self.pending_results.pop(key)
            time.sleep(0.05)
        
        return None
    
    def is_worker_alive(self, gpu_device: int) -> bool:
        """Check if a worker process is alive."""
        if gpu_device in self.workers:
            return self.workers[gpu_device].poll() is None
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
