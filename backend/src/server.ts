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
    list: true, // Enable directory listing for debugging
    // Ensure content type is set correctly
    setHeaders: (res, path, stat) => {
        if (path.endsWith('.png')) {
            res.setHeader('Content-Type', 'image/png');
        } else if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
            res.setHeader('Content-Type', 'image/jpeg');
        }
    }
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

interface GenerateRequestBody {
    prompt?: string;
    negative_prompt?: string;
    image_number?: number;
    image_seed?: number;
    seed_random?: boolean;
    [key: string]: unknown;
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

app.post<{ Body: GenerateRequestBody }>('/generate', async (request) => {
    const taskId = String(Date.now());
    const body = request.body;
    const totalImages = body.image_number || 1;

    activeTasks.set(taskId, {
        percentage: 0,
        statusText: 'Starting',
        results: [],
        finished: false,
    });

    // Broadcast initial status
    broadcastProgress(taskId, activeTasks.get(taskId)!);

    if (scheduler.isEnabled() && totalImages > 0) {
        // Distribute images across GPUs based on weight
        const assignments = scheduler.distributeImages(totalImages);

        if (assignments.length === 0) {
            return { task_id: taskId, status: 'Error', error: 'No GPU available' };
        }

        const status = activeTasks.get(taskId)!;
        const gpuNames = assignments.map(a => `${a.gpu.config.name}(${a.imageCount})`).join(', ');
        status.statusText = `Distributing to ${assignments.length} GPU(s): ${gpuNames}`;
        status.percentage = 5;
        broadcastProgress(taskId, status);

        console.log(`[Generate] Task ${taskId}: Distributing ${totalImages} images to ${assignments.length} GPUs`);
        assignments.forEach(a => {
            console.log(`  - GPU ${a.gpu.config.device} (${a.gpu.config.name}): ${a.imageCount} images`);
        });

        // Mark all assigned GPUs as busy
        assignments.forEach(a => scheduler.markBusy(a.gpu.config.device, true));

        // Create sub-tasks for each GPU with adjusted seed
        let baseSeed = body.image_seed ?? Math.floor(Math.random() * 2147483647);
        if (body.seed_random) {
            baseSeed = Math.floor(Math.random() * 2147483647);
        }

        const subTaskPromises = assignments.map((assignment, idx) => {
            const subTaskBody = {
                ...body,
                image_number: assignment.imageCount,
                image_seed: baseSeed,
                seed_random: false, // Already resolved seed
            };

            // Increment seed for next GPU to avoid duplicates
            baseSeed += assignment.imageCount;

            const subTaskId = `${taskId}_${idx}`;
            return workerManager.submitTask(assignment.gpu, subTaskId, subTaskBody)
                .then(result => ({
                    gpu: assignment.gpu,
                    success: result.success,
                    results: result.results || [],
                    error: result.error,
                }))
                .catch(error => ({
                    gpu: assignment.gpu,
                    success: false,
                    results: [],
                    error: error.message,
                }))
                .finally(() => {
                    scheduler.markBusy(assignment.gpu.config.device, false);
                });
        });

        // Process results as they complete
        let completedCount = 0;
        const allResults: string[] = [];

        Promise.all(subTaskPromises).then(results => {
            const status = activeTasks.get(taskId)!;

            results.forEach((result, idx) => {
                if (result.success) {
                    allResults.push(...result.results);
                } else {
                    console.error(`[Generate] Sub-task ${idx} failed:`, result.error);
                }
            });

            status.results = allResults;
            status.finished = true;
            status.percentage = 100;
            status.statusText = `Finished (${allResults.length}/${totalImages} images)`;
            broadcastProgress(taskId, status);
        });

        return {
            task_id: taskId,
            status: 'Started',
            gpus: assignments.map(a => ({ device: a.gpu.config.device, images: a.imageCount })),
            total_images: totalImages,
        };
    }

    return { task_id: taskId, status: 'Error', error: 'Multi-GPU not enabled or no images requested' };
});

app.get<{ Params: { taskId: string } }>('/status/:taskId', async (request) => {
    const status = activeTasks.get(request.params.taskId);
    if (!status) {
        return { error: 'Task not found' };
    }
    return status;
});

app.get('/history', async () => {
    // Simple file-based history implementation
    try {
        if (!fs.existsSync(outputsPath)) {
            return [];
        }

        const history: any[] = [];
        const entries = fs.readdirSync(outputsPath, { withFileTypes: true });

        // Iterate over date directories (e.g., 2026-02-07)
        for (const entry of entries) {
            if (entry.isDirectory() && entry.name.match(/^\d{4}-\d{2}-\d{2}$/)) {
                const dateDir = path.join(outputsPath, entry.name);
                const files = fs.readdirSync(dateDir);

                for (const file of files) {
                    if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
                        // Create history item
                        // Path should be relative to outputs path for frontend
                        // e.g., "2026-02-07/image_123.png"
                        const relPath = `${entry.name}/${file}`;
                        history.push({
                            path: relPath,
                            url: `/images/${relPath}`,
                            name: file,
                            date: entry.name,
                            timestamp: fs.statSync(path.join(dateDir, file)).mtimeMs
                        });
                    }
                }
            }
        }

        // Sort by timestamp descending and limit to 100
        return history.sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);

    } catch (error) {
        console.error('[History] Error scanning outputs:', error);
        return [];
    }
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

        // Start GPU workers
        // Even if multi-GPU is disabled in config, scheduler will have a default GPU 0 registered
        const gpus = scheduler.getGPUs();
        if (gpus.length > 0) {
            console.log(`[Server] Starting workers for ${gpus.length} GPUs (Multi-GPU: ${scheduler.isEnabled()})`);
            await workerManager.startWorkers();
        } else {
            console.log('[Server] No GPUs found, skipping worker startup');
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
