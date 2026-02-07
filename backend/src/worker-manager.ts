/**
 * Worker Manager - Spawns and manages Python GPU workers
 */

import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { GPUState, scheduler } from './scheduler';
import {
    buildFooocusTaskArgs,
    FOOOCUS_ARGS_CONTRACT_VERSION,
    validateFooocusTaskArgs,
} from './fooocus-task-args';

interface WorkerProcess {
    process: ChildProcess;
    gpu: GPUState;
    ready: boolean;
}

class WorkerManager {
    private workers: Map<number, WorkerProcess> = new Map();
    private rootPath: string;
    private pythonPath: string;

    constructor() {
        this.rootPath = path.join(__dirname, '../..');
        // Try to find Python in venv first
        const venvPython = path.join(this.rootPath, 'venv', 'Scripts', 'python.exe');
        const venvPythonUnix = path.join(this.rootPath, 'venv', 'bin', 'python');

        if (fs.existsSync(venvPython)) {
            this.pythonPath = venvPython;
        } else if (fs.existsSync(venvPythonUnix)) {
            this.pythonPath = venvPythonUnix;
        } else {
            this.pythonPath = 'python';
        }

        console.log(`[WorkerManager] Python path: ${this.pythonPath}`);
    }

    async startWorkers(): Promise<void> {
        const gpus = scheduler.getGPUs();

        for (const gpu of gpus) {
            await this.startWorker(gpu);
        }
    }

    private async startWorker(gpu: GPUState): Promise<void> {
        const workerScript = path.join(this.rootPath, 'python_worker.py');

        console.log(`[WorkerManager] Starting worker for GPU ${gpu.config.device} on port ${gpu.port}`);

        const env = {
            ...process.env,
            CUDA_VISIBLE_DEVICES: String(gpu.config.device),
            WORKER_PORT: String(gpu.port),
            WORKER_GPU_ID: String(gpu.config.device),
        };

        const child = spawn(this.pythonPath, [workerScript], {
            cwd: this.rootPath,
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        child.stdout?.on('data', (data) => {
            console.log(`[Worker ${gpu.config.device}] ${data.toString().trim()}`);
        });

        child.stderr?.on('data', (data) => {
            console.error(`[Worker ${gpu.config.device}] ${data.toString().trim()}`);
        });

        child.on('exit', (code) => {
            console.log(`[Worker ${gpu.config.device}] Exited with code ${code}`);
            this.workers.delete(gpu.config.device);
        });

        this.workers.set(gpu.config.device, {
            process: child,
            gpu,
            ready: false,
        });

        // Wait for worker to be ready
        await this.waitForWorker(gpu);
    }

    private async waitForWorker(gpu: GPUState): Promise<void> {
        const maxRetries = 60; // 60 seconds timeout
        const url = `http://127.0.0.1:${gpu.port}/health`;

        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await fetch(url);
                if (response.ok) {
                    console.log(`[WorkerManager] Worker ${gpu.config.device} is ready`);
                    const worker = this.workers.get(gpu.config.device);
                    if (worker) {
                        worker.ready = true;
                    }
                    return;
                }
            } catch {
                // Worker not ready yet
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.error(`[WorkerManager] Worker ${gpu.config.device} failed to start`);
    }

    async submitTask(gpu: GPUState, taskId: string, taskArgs: any): Promise<any> {
        const url = `http://127.0.0.1:${gpu.port}/generate`;

        try {
            // Ensure args are JSON-serializable by parsing/stringifying
            const safeArgs = JSON.parse(JSON.stringify(taskArgs));
            const fooocusArgs = buildFooocusTaskArgs(safeArgs);
            const validation = validateFooocusTaskArgs(fooocusArgs);
            if (!validation.ok) {
                throw new Error(`Invalid fooocus_args: ${validation.reason}`);
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    task_id: taskId,
                    args: safeArgs,
                    fooocus_args: fooocusArgs,
                    fooocus_args_contract_version: FOOOCUS_ARGS_CONTRACT_VERSION,
                }),
            });

            return await response.json();
        } catch (error) {
            console.error(`[WorkerManager] Error submitting task to GPU ${gpu.config.device}:`, error);
            throw error;
        }
    }

    isWorkerReady(device: number): boolean {
        const worker = this.workers.get(device);
        return worker?.ready ?? false;
    }

    stopWorkers(): void {
        for (const [device, worker] of this.workers) {
            console.log(`[WorkerManager] Stopping worker ${device}`);
            worker.process.kill();
        }
        this.workers.clear();
    }
}

export const workerManager = new WorkerManager();
