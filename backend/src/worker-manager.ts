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
    rpc: WorkerRpcClient;
}

export interface WorkerProgress {
    percentage: number;
    statusText: string;
    finished: boolean;
    preview: string | null;
    results: string[];
    error?: string;
}

interface JsonRpcSuccess {
    jsonrpc: '2.0';
    id: number;
    result: unknown;
}

interface JsonRpcError {
    jsonrpc: '2.0';
    id: number;
    error: {
        code?: number;
        message?: string;
        data?: unknown;
    };
}

type JsonRpcResponse = JsonRpcSuccess | JsonRpcError;

class WorkerRpcClient {
    private nextId = 1;
    private stdoutBuffer = '';
    private pending = new Map<number, {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        timeout: ReturnType<typeof setTimeout>;
    }>();
    private gpuId: number;

    constructor(private readonly child: ChildProcess, gpuId: number) {
        this.gpuId = gpuId;
        this.child.stdout?.setEncoding('utf-8');
        this.child.stdout?.on('data', (chunk: string) => this.handleStdout(chunk));
        this.child.on('exit', () => this.closeWithError(new Error('Worker process exited')));
    }

    private handleStdout(chunk: string): void {
        this.stdoutBuffer += chunk;
        const lines = this.stdoutBuffer.split(/\r?\n/);
        this.stdoutBuffer = lines.pop() ?? '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            let parsed: unknown;
            try {
                parsed = JSON.parse(trimmed);
            } catch {
                console.log(`[Worker ${this.gpuId}] ${trimmed}`);
                continue;
            }

            const message = parsed as Partial<JsonRpcResponse>;
            if (message.jsonrpc !== '2.0' || typeof message.id !== 'number') {
                console.log(`[Worker ${this.gpuId}] ${trimmed}`);
                continue;
            }

            const pending = this.pending.get(message.id);
            if (!pending) {
                continue;
            }

            clearTimeout(pending.timeout);
            this.pending.delete(message.id);

            if ('error' in message && message.error) {
                const errorMessage = message.error.message || 'RPC request failed';
                pending.reject(new Error(errorMessage));
            } else {
                pending.resolve((message as JsonRpcSuccess).result);
            }
        }
    }

    private closeWithError(error: Error): void {
        for (const [, pending] of this.pending) {
            clearTimeout(pending.timeout);
            pending.reject(error);
        }
        this.pending.clear();
    }

    request<T>(method: string, params: Record<string, unknown>, timeoutMs = 10000): Promise<T> {
        const id = this.nextId++;
        const payload = JSON.stringify({
            jsonrpc: '2.0',
            id,
            method,
            params,
        });

        const stdin = this.child.stdin;
        if (!stdin || stdin.destroyed || !stdin.writable) {
            return Promise.reject(new Error('Worker stdin is not writable'));
        }

        return new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`RPC timeout: ${method}`));
            }, timeoutMs);

            this.pending.set(id, { resolve: (v) => resolve(v as T), reject, timeout });

            stdin.write(`${payload}\n`, (err) => {
                if (err) {
                    clearTimeout(timeout);
                    this.pending.delete(id);
                    reject(err);
                }
            });
        });
    }
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
            WORKER_RPC_MODE: 'stdio',
        };

        const child = spawn(this.pythonPath, [workerScript], {
            cwd: this.rootPath,
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        child.stderr?.on('data', (data) => {
            console.error(`[Worker ${gpu.config.device}] ${data.toString().trim()}`);
        });

        const rpc = new WorkerRpcClient(child, gpu.config.device);
        child.on('exit', (code) => {
            console.log(`[Worker ${gpu.config.device}] Exited with code ${code}`);
            this.workers.delete(gpu.config.device);
        });

        this.workers.set(gpu.config.device, {
            process: child,
            gpu,
            ready: false,
            rpc,
        });

        // Wait for worker to be ready
        await this.waitForWorker(gpu);
    }

    private async waitForWorker(gpu: GPUState): Promise<void> {
        const maxRetries = 60; // 60 seconds timeout

        for (let i = 0; i < maxRetries; i++) {
            try {
                const worker = this.workers.get(gpu.config.device);
                if (!worker) {
                    break;
                }
                const response = await worker.rpc.request<{ status: string }>('health', {}, 2000);
                if (response.status === 'ok') {
                    console.log(`[WorkerManager] Worker ${gpu.config.device} is ready`);
                    worker.ready = true;
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
        try {
            // Ensure args are JSON-serializable by parsing/stringifying
            const safeArgs = JSON.parse(JSON.stringify(taskArgs));
            const fooocusArgs = buildFooocusTaskArgs(safeArgs);
            const validation = validateFooocusTaskArgs(fooocusArgs);
            if (!validation.ok) {
                throw new Error(`Invalid fooocus_args: ${validation.reason}`);
            }

            const worker = this.workers.get(gpu.config.device);
            if (!worker) {
                throw new Error(`Worker ${gpu.config.device} not found`);
            }

            await worker.rpc.request('generate', {
                task_id: taskId,
                fooocus_args: fooocusArgs,
                fooocus_args_contract_version: FOOOCUS_ARGS_CONTRACT_VERSION,
            }, 15000);

            const timeoutAt = Date.now() + 1000 * 60 * 30;
            while (Date.now() < timeoutAt) {
                const progress = await this.fetchProgress(gpu, taskId);
                if (progress.finished) {
                    return {
                        success: !progress.error,
                        task_id: taskId,
                        results: progress.results || [],
                        error: progress.error,
                    };
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            throw new Error(`Task ${taskId} timed out`);
        } catch (error) {
            console.error(`[WorkerManager] Error submitting task to GPU ${gpu.config.device}:`, error);
            throw error;
        }
    }

    async fetchProgress(gpu: GPUState, taskId: string): Promise<WorkerProgress> {
        const worker = this.workers.get(gpu.config.device);
        if (!worker) {
            throw new Error(`Worker ${gpu.config.device} not found`);
        }

        return worker.rpc.request<WorkerProgress>('progress', { task_id: taskId }, 5000);
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

    async stopGeneration(): Promise<{ requested: number; success: number }> {
        let requested = 0;
        let success = 0;

        for (const [device, worker] of this.workers) {
            if (!worker.ready) {
                continue;
            }

            requested++;
            try {
                const response = await worker.rpc.request<{ success?: boolean }>('stop', {}, 5000);
                if (response.success) {
                    success++;
                } else {
                    console.warn(`[WorkerManager] Stop failed for worker ${device}`);
                }
            } catch (error) {
                console.warn(`[WorkerManager] Stop request error for worker ${device}:`, error);
            }
        }

        return { requested, success };
    }

}

export const workerManager = new WorkerManager();
