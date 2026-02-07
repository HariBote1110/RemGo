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
import { loadSettings } from './settings-loader';

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
    preview?: string | null; // Base64 encoded preview image
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

// Routes
app.get('/settings', async () => {
    return loadSettings(rootPath);
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

// Poll progress from Python workers and broadcast to WebSocket clients
function startProgressPolling(taskId: string, assignments: { gpu: GPUState; imageCount: number }[]): ReturnType<typeof setInterval> {
    const pollInterval = 500; // Poll every 500ms

    console.log(`[ProgressPoll] Starting polling for task ${taskId} with ${assignments.length} GPU(s)`);

    return setInterval(async () => {
        const status = activeTasks.get(taskId);
        if (!status || status.finished) {
            return;
        }

        // Poll progress from each GPU worker
        for (const assignment of assignments) {
            const subTaskId = `${taskId}_${assignments.indexOf(assignment)}`;
            const url = `http://127.0.0.1:${assignment.gpu.port}/progress/${subTaskId}`;

            try {
                const response = await fetch(url);
                if (response.ok) {
                    const progress = await response.json() as {
                        percentage: number;
                        statusText: string;
                        finished: boolean;
                        preview: string | null;
                        results: string[];
                    };

                    console.log(`[ProgressPoll] Task ${subTaskId}: ${progress.percentage}% - ${progress.statusText} (preview: ${progress.preview ? 'yes' : 'no'})`);

                    // Update task status with the latest progress
                    if (progress.percentage > status.percentage || progress.preview) {
                        status.percentage = Math.max(status.percentage, progress.percentage);
                        status.statusText = progress.statusText || status.statusText;
                        status.preview = progress.preview;

                        // Broadcast progress to WebSocket clients
                        broadcastProgress(taskId, status);
                    }
                } else {
                    console.log(`[ProgressPoll] Failed to fetch progress from ${url}: ${response.status}`);
                }
            } catch (e) {
                console.log(`[ProgressPoll] Error polling ${url}:`, e);
            }
        }
    }, pollInterval);
}

// Import GPUState type from scheduler
import type { GPUState } from './scheduler';


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

        // Start progress polling for this task
        const pollIntervalId = startProgressPolling(taskId, assignments);

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
            // Stop progress polling
            clearInterval(pollIntervalId);

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
            status.preview = null; // Clear preview on finish
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
    // Scans both flat files and date subdirectories in outputs
    try {
        if (!fs.existsSync(outputsPath)) {
            return [];
        }

        const history: any[] = [];
        const entries = fs.readdirSync(outputsPath, { withFileTypes: true });

        for (const entry of entries) {
            // Check files directly in outputs directory
            if (entry.isFile() && (entry.name.endsWith('.png') || entry.name.endsWith('.jpg') || entry.name.endsWith('.jpeg') || entry.name.endsWith('.webp'))) {
                const filePath = path.join(outputsPath, entry.name);
                const stats = fs.statSync(filePath);
                history.push({
                    filename: entry.name,
                    path: entry.name,
                    created: stats.mtimeMs / 1000, // Convert to seconds for frontend
                    metadata: null
                });
            }
            // Also check date subdirectories (e.g., 2026-02-07)
            else if (entry.isDirectory() && entry.name.match(/^\d{4}-\d{2}-\d{2}$/)) {
                const dateDir = path.join(outputsPath, entry.name);
                const files = fs.readdirSync(dateDir);

                for (const file of files) {
                    if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.webp')) {
                        const relPath = `${entry.name}/${file}`;
                        const filePath = path.join(dateDir, file);
                        const stats = fs.statSync(filePath);
                        history.push({
                            filename: file,
                            path: relPath,
                            created: stats.mtimeMs / 1000,
                            metadata: null
                        });
                    }
                }
            }
        }

        // Sort by creation time descending and limit to 500
        return history.sort((a, b) => b.created - a.created).slice(0, 500);

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
    wsConnections.forEach((socketStream: any) => {
        try {
            // FastifyのSocketStreamでは、実際のWebSocketはsocket.socketにある
            const ws = socketStream.socket || socketStream;
            if (typeof ws.send === 'function') {
                ws.send(message);
            }
        } catch (e) {
            // Ignore send errors
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
