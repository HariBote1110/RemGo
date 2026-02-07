/**
 * RemGo API Server - Fastify + TypeScript
 */

import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import * as path from 'path';
import * as fs from 'fs';
import { scheduler } from './scheduler';
import { workerManager } from './worker-manager';

const rootPath = path.join(__dirname, '../..');
const outputsPath = path.join(rootPath, 'outputs');

// Ensure outputs directory exists
if (!fs.existsSync(outputsPath)) {
    fs.mkdirSync(outputsPath, { recursive: true });
}

const app = Fastify({ logger: true });

// CORS
app.register(cors, { origin: '*' });

// Static files for images
app.register(fastifyStatic, {
    root: outputsPath,
    prefix: '/images/',
});

// WebSocket
app.register(fastifyWebsocket);

// Task state
interface TaskStatus {
    percentage: number;
    statusText: string;
    results: string[];
    finished: boolean;
    gpuDevice?: number;
}

const activeTasks = new Map<string, TaskStatus>();

// Load settings from Python config
function loadSettings(): any {
    // Read available models from models directory
    const checkpointsPath = path.join(rootPath, 'models', 'checkpoints');
    const lorasPath = path.join(rootPath, 'models', 'loras');
    const vaesPath = path.join(rootPath, 'models', 'vae');
    const presetsPath = path.join(rootPath, 'presets');
    const stylesPath = path.join(rootPath, 'sdxl_styles');

    const models = fs.existsSync(checkpointsPath)
        ? fs.readdirSync(checkpointsPath).filter(f => f.endsWith('.safetensors'))
        : [];

    const loras = fs.existsSync(lorasPath)
        ? fs.readdirSync(lorasPath).filter(f => f.endsWith('.safetensors'))
        : [];

    const vaes = fs.existsSync(vaesPath)
        ? fs.readdirSync(vaesPath).filter(f => f.endsWith('.safetensors'))
        : [];

    const presets = fs.existsSync(presetsPath)
        ? fs.readdirSync(presetsPath)
            .filter(f => f.endsWith('.json') && !f.startsWith('.'))
            .map(f => f.replace('.json', ''))
        : ['default'];

    // Load styles from all JSON files in sdxl_styles directory
    let styles: string[] = [];
    if (fs.existsSync(stylesPath)) {
        const styleFiles = fs.readdirSync(stylesPath).filter(f => f.endsWith('.json'));
        for (const file of styleFiles) {
            try {
                const content = fs.readFileSync(path.join(stylesPath, file), 'utf-8');
                const styleData = JSON.parse(content);
                if (Array.isArray(styleData)) {
                    styles = styles.concat(styleData.map((s: any) => s.name).filter(Boolean));
                }
            } catch (e) {
                // Ignore invalid JSON files
            }
        }
    }
    // Add default styles if none found
    if (styles.length === 0) {
        styles = ['Fooocus V2', 'Fooocus Enhance', 'Fooocus Sharp'];
    }

    return {
        models,
        loras,
        vaes: ['Default (model)', ...vaes],
        presets,
        styles,
        aspect_ratios: ['704×1408', '704×1344', '768×1344', '768×1280', '832×1216', '832×1152',
            '896×1152', '896×1088', '960×1088', '960×1024', '1024×1024', '1024×960',
            '1088×960', '1088×896', '1152×896', '1152×832', '1216×832', '1280×768',
            '1344×768', '1344×704', '1408×704'],
        performance_options: ['Speed', 'Quality', 'Extreme Speed'],
        samplers: ['euler', 'euler_ancestral', 'heun', 'dpm_2', 'dpm_2_ancestral',
            'lms', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde',
            'dpmpp_sde_gpu', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_2m_sde_gpu',
            'dpmpp_3m_sde', 'dpmpp_3m_sde_gpu', 'ddpm', 'lcm', 'ddim', 'uni_pc',
            'uni_pc_bh2'],
        schedulers: ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple',
            'ddim_uniform', 'lcm', 'turbo'],
        output_formats: ['png', 'jpg', 'webp'],
        clip_skip_max: 12,
        default_lora_count: 5,
    };
}

// Routes
app.get('/settings', async () => {
    return loadSettings();
});

app.get('/gpus', async () => {
    return {
        multi_gpu_enabled: scheduler.isEnabled(),
        gpu_count: scheduler.getGPUs().length,
        gpus: scheduler.getGPUs().map(gpu => ({
            device: gpu.config.device,
            name: gpu.config.name,
            weight: gpu.config.weight,
            busy: gpu.busy,
            port: gpu.port,
        })),
    };
});

app.post<{ Body: any }>('/generate', async (request) => {
    const taskId = String(Date.now());

    activeTasks.set(taskId, {
        percentage: 0,
        statusText: 'Starting',
        results: [],
        finished: false,
    });

    if (scheduler.isEnabled()) {
        const gpu = scheduler.selectGPU();
        if (gpu) {
            scheduler.markBusy(gpu.config.device, true);
            activeTasks.get(taskId)!.gpuDevice = gpu.config.device;

            // Submit to worker asynchronously
            workerManager.submitTask(gpu, taskId, request.body)
                .then((result) => {
                    const status = activeTasks.get(taskId);
                    if (status) {
                        status.results = result.results || [];
                        status.finished = true;
                        status.percentage = 100;
                        status.statusText = result.success ? 'Finished' : `Error: ${result.error}`;
                    }
                    scheduler.markBusy(gpu.config.device, false);
                })
                .catch((error) => {
                    const status = activeTasks.get(taskId);
                    if (status) {
                        status.finished = true;
                        status.statusText = `Error: ${error.message}`;
                    }
                    scheduler.markBusy(gpu.config.device, false);
                });

            return { task_id: taskId, status: 'Started', gpu: gpu.config.device };
        }
    }

    return { task_id: taskId, status: 'Error', error: 'No GPU available' };
});

app.get<{ Params: { taskId: string } }>('/status/:taskId', async (request) => {
    const status = activeTasks.get(request.params.taskId);
    if (!status) {
        return { error: 'Task not found' };
    }
    return status;
});

app.get('/history', async () => {
    // Read from SQLite database
    const dbPath = path.join(outputsPath, 'metadata.db');
    if (!fs.existsSync(dbPath)) {
        return [];
    }

    // For now, return empty - would need sqlite3 package
    return [];
});

// WebSocket connections for real-time updates
const wsConnections = new Set<any>();

app.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, (socket, req) => {
        wsConnections.add(socket);
        console.log('[WS] Client connected');

        socket.on('message', (message: Buffer) => {
            try {
                const data = JSON.parse(message.toString());
                console.log('[WS] Message received:', data);
            } catch (e) {
                // Ignore invalid JSON
            }
        });

        socket.on('close', () => {
            wsConnections.delete(socket);
            console.log('[WS] Client disconnected');
        });

        socket.on('error', (err: Error) => {
            console.error('[WS] Error:', err);
            wsConnections.delete(socket);
        });
    });
});

// Broadcast to all WebSocket clients
function broadcastProgress(taskId: string, status: TaskStatus) {
    const message = JSON.stringify({
        type: 'progress',
        task_id: taskId,
        ...status,
    });
    wsConnections.forEach((ws) => {
        try {
            ws.send(message);
        } catch (e) {
            // Ignore errors
        }
    });
}

// Health check
app.get('/health', async () => {
    return { status: 'ok' };
});

// Start server
async function start() {
    try {
        console.log('[Server] Starting RemGo API Server...');

        // Start GPU workers if multi-GPU mode enabled
        if (scheduler.isEnabled()) {
            console.log(`[Server] Multi-GPU mode with ${scheduler.getGPUs().length} GPUs`);
            await workerManager.startWorkers();
        } else {
            console.log('[Server] Single-GPU mode');
        }

        await app.listen({ port: 8888, host: '0.0.0.0' });
        console.log('[Server] RemGo API Server running on http://0.0.0.0:8888');
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('[Server] Shutting down...');
    workerManager.stopWorkers();
    process.exit(0);
});

start();
