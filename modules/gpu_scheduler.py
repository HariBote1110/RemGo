"""
Multi-GPU weighted scheduler for distributing tasks across CUDA devices.
Uses weighted round-robin algorithm to balance load based on GPU performance.
"""
import json
import os
import threading
from dataclasses import dataclass
from typing import List, Optional
import queue

import torch


@dataclass
class GPUConfig:
    device: int
    name: str
    weight: int


class GPUScheduler:
    """Weighted round-robin GPU scheduler."""
    
    def __init__(self, config_path: str = None):
        self.gpus: List[GPUConfig] = []
        self.enabled = False
        self._lock = threading.Lock()
        self._current_weights: List[int] = []
        self._task_queues: dict[int, queue.Queue] = {}
        self._gpu_busy: dict[int, bool] = {}
        
        if config_path is None:
            config_path = os.path.join(os.path.dirname(__file__), '..', 'gpu_config.json')
        
        self._load_config(config_path)
    
    def _load_config(self, config_path: str) -> None:
        """Load GPU configuration from JSON file."""
        if not os.path.exists(config_path):
            print(f"[GPU Scheduler] Config not found: {config_path}")
            self._auto_detect_gpus()
            return
        
        try:
            with open(config_path, 'r') as f:
                config = json.load(f)
            
            self.enabled = config.get('enabled', False)
            
            if not self.enabled:
                print("[GPU Scheduler] Disabled in config")
                return
            
            for gpu_conf in config.get('gpus', []):
                gpu = GPUConfig(
                    device=gpu_conf['device'],
                    name=gpu_conf.get('name', f'GPU {gpu_conf["device"]}'),
                    weight=gpu_conf.get('weight', 1)
                )
                self.gpus.append(gpu)
                self._task_queues[gpu.device] = queue.Queue()
                self._gpu_busy[gpu.device] = False
            
            self._current_weights = [gpu.weight for gpu in self.gpus]
            
            print(f"[GPU Scheduler] Loaded {len(self.gpus)} GPUs:")
            for gpu in self.gpus:
                print(f"  - Device {gpu.device}: {gpu.name} (weight: {gpu.weight})")
                
        except Exception as e:
            print(f"[GPU Scheduler] Error loading config: {e}")
            self._auto_detect_gpus()
    
    def _auto_detect_gpus(self) -> None:
        """Auto-detect available CUDA GPUs."""
        if not torch.cuda.is_available():
            print("[GPU Scheduler] CUDA not available")
            return
        
        device_count = torch.cuda.device_count()
        if device_count <= 1:
            print(f"[GPU Scheduler] Single GPU detected, scheduler disabled")
            return
        
        self.enabled = True
        for i in range(device_count):
            name = torch.cuda.get_device_name(i)
            # Default weight based on memory
            memory = torch.cuda.get_device_properties(i).total_memory
            weight = max(1, int(memory / (4 * 1024 ** 3)))  # 1 weight per 4GB
            
            gpu = GPUConfig(device=i, name=name, weight=weight)
            self.gpus.append(gpu)
            self._task_queues[i] = queue.Queue()
            self._gpu_busy[i] = False
        
        self._current_weights = [gpu.weight for gpu in self.gpus]
        
        print(f"[GPU Scheduler] Auto-detected {len(self.gpus)} GPUs:")
        for gpu in self.gpus:
            print(f"  - Device {gpu.device}: {gpu.name} (weight: {gpu.weight})")
    
    def select_gpu(self) -> Optional[int]:
        """Select next GPU using weighted round-robin."""
        if not self.enabled or not self.gpus:
            return None
        
        with self._lock:
            # Find GPU with highest remaining weight that is not busy
            best_idx = -1
            best_weight = -1
            
            for i, gpu in enumerate(self.gpus):
                if not self._gpu_busy[gpu.device] and self._current_weights[i] > best_weight:
                    best_idx = i
                    best_weight = self._current_weights[i]
            
            if best_idx == -1:
                # All GPUs busy, find one with highest weight
                for i, gpu in enumerate(self.gpus):
                    if self._current_weights[i] > best_weight:
                        best_idx = i
                        best_weight = self._current_weights[i]
            
            if best_idx == -1:
                return self.gpus[0].device
            
            # Decrement weight
            self._current_weights[best_idx] -= 1
            
            # Reset all weights if all are zero
            if all(w <= 0 for w in self._current_weights):
                self._current_weights = [gpu.weight for gpu in self.gpus]
            
            return self.gpus[best_idx].device
    
    def mark_busy(self, device: int, busy: bool = True) -> None:
        """Mark a GPU as busy or free."""
        with self._lock:
            self._gpu_busy[device] = busy
    
    def is_busy(self, device: int) -> bool:
        """Check if a GPU is busy."""
        with self._lock:
            return self._gpu_busy.get(device, False)
    
    def get_free_gpu(self) -> Optional[int]:
        """Get a free GPU, or None if all are busy."""
        with self._lock:
            for gpu in self.gpus:
                if not self._gpu_busy[gpu.device]:
                    return gpu.device
            return None
    
    def get_gpu_count(self) -> int:
        """Get number of configured GPUs."""
        return len(self.gpus)


# Global scheduler instance
_scheduler: Optional[GPUScheduler] = None


def get_scheduler() -> GPUScheduler:
    """Get or create the global GPU scheduler."""
    global _scheduler
    if _scheduler is None:
        _scheduler = GPUScheduler()
    return _scheduler


def is_multi_gpu_enabled() -> bool:
    """Check if multi-GPU mode is enabled."""
    return get_scheduler().enabled


def select_gpu() -> Optional[int]:
    """Select next GPU for task execution."""
    return get_scheduler().select_gpu()


def mark_gpu_busy(device: int, busy: bool = True) -> None:
    """Mark GPU as busy/free."""
    get_scheduler().mark_busy(device, busy)
