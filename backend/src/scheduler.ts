/**
 * GPU Scheduler - Weighted round-robin algorithm
 */

import * as fs from 'fs';
import * as path from 'path';

export interface GPUConfig {
    device: number;
    name: string;
    weight: number;
}

export interface GPUConfigFile {
    enabled: boolean;
    distribute?: boolean; // New option for distributed processing
    gpus: GPUConfig[];
}

export interface GPUState {
    config: GPUConfig;
    busy: boolean;
    port: number;
    currentWeight: number;
}

export class GPUScheduler {
    private gpus: GPUState[] = [];
    private enabled: boolean = false;
    private distribute: boolean = true; // Default to true
    private basePort: number = 9000;

    constructor(configPath?: string) {
        const cfgPath = configPath || path.join(__dirname, '../../gpu_config.json');
        this.loadConfig(cfgPath);
    }

    private loadConfig(configPath: string): void {
        if (!fs.existsSync(configPath)) {
            console.log('[Scheduler] Config not found, using default single GPU');
            this.addDefaultGPU();
            return;
        }

        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            const config: GPUConfigFile = JSON.parse(content);

            this.enabled = config.enabled || false;
            this.distribute = config.distribute !== undefined ? config.distribute : true;

            if (!this.enabled) {
                console.log('[Scheduler] Multi-GPU disabled in config, using single GPU');
                this.addDefaultGPU();
                return;
            }

            config.gpus.forEach((gpu, index) => {
                this.gpus.push({
                    config: gpu,
                    busy: false,
                    port: this.basePort + index,
                    currentWeight: gpu.weight,
                });
            });

            console.log(`[Scheduler] Loaded ${this.gpus.length} GPUs (Distribute: ${this.distribute}):`);
            this.gpus.forEach(gpu => {
                console.log(`  - Device ${gpu.config.device}: ${gpu.config.name} (weight: ${gpu.config.weight}, port: ${gpu.port})`);
            });

        } catch (error) {
            console.error('[Scheduler] Error loading config:', error);
            this.addDefaultGPU();
        }
    }

    private addDefaultGPU(): void {
        this.gpus.push({
            config: {
                device: 0,
                name: 'Default GPU',
                weight: 1
            },
            busy: false,
            port: this.basePort,
            currentWeight: 1,
        });
    }

    isEnabled(): boolean {
        return this.enabled && this.gpus.length > 0;
    }

    isDistributeEnabled(): boolean {
        return this.distribute;
    }

    getGPUs(): GPUState[] {
        return this.gpus;
    }

    /**
     * Select next GPU using weighted round-robin
     */
    selectGPU(): GPUState | null {
        if (!this.enabled || this.gpus.length === 0) {
            return null;
        }

        // Find GPU with highest remaining weight that is not busy
        let bestIdx = -1;
        let bestWeight = -1;

        for (let i = 0; i < this.gpus.length; i++) {
            const gpu = this.gpus[i];
            if (!gpu.busy && gpu.currentWeight > bestWeight) {
                bestIdx = i;
                bestWeight = gpu.currentWeight;
            }
        }

        // If all busy, find one with highest weight anyway
        if (bestIdx === -1) {
            for (let i = 0; i < this.gpus.length; i++) {
                if (this.gpus[i].currentWeight > bestWeight) {
                    bestIdx = i;
                    bestWeight = this.gpus[i].currentWeight;
                }
            }
        }

        if (bestIdx === -1) {
            return this.gpus[0];
        }

        // Decrement weight
        this.gpus[bestIdx].currentWeight--;

        // Reset all weights if all are zero
        if (this.gpus.every(g => g.currentWeight <= 0)) {
            this.gpus.forEach(g => {
                g.currentWeight = g.config.weight;
            });
        }

        return this.gpus[bestIdx];
    }

    markBusy(device: number, busy: boolean): void {
        const gpu = this.gpus.find(g => g.config.device === device);
        if (gpu) {
            gpu.busy = busy;
        }
    }

    getGPUByDevice(device: number): GPUState | undefined {
        return this.gpus.find(g => g.config.device === device);
    }

    /**
     * Get all available (non-busy) GPUs
     */
    getAvailableGPUs(): GPUState[] {
        return this.gpus.filter(g => !g.busy);
    }

    /**
     * Distribute image count across GPUs based on weight
     * Returns array of { gpu, imageCount } assignments
     */
    distributeImages(totalImages: number): Array<{ gpu: GPUState; imageCount: number }> {
        const available = this.getAvailableGPUs();

        // If no GPUs available, use all GPUs
        const gpusToUse = available.length > 0 ? available : this.gpus;

        if (gpusToUse.length === 0) {
            return [];
        }

        // If distribute is disabled or only 1 image/GPU, assign all to first GPU
        if (!this.distribute || totalImages <= 1 || gpusToUse.length === 1) {
            // If distribute is disabled, prefer the GPU with highest weight (most powerful)
            // or the first one if all weights are equal
            if (!this.distribute) {
                // Find most powerful GPU
                const bestGpu = gpusToUse.reduce((prev, current) =>
                    (prev.config.weight > current.config.weight) ? prev : current
                );
                return [{ gpu: bestGpu, imageCount: totalImages }];
            }
            return [{ gpu: gpusToUse[0], imageCount: totalImages }];
        }

        // Calculate total weight
        const totalWeight = gpusToUse.reduce((sum, g) => sum + g.config.weight, 0);

        // Distribute based on weight proportion
        const assignments: Array<{ gpu: GPUState; imageCount: number }> = [];
        let remaining = totalImages;

        for (let i = 0; i < gpusToUse.length; i++) {
            const gpu = gpusToUse[i];
            const isLast = i === gpusToUse.length - 1;

            if (isLast) {
                // Last GPU gets remaining
                if (remaining > 0) {
                    assignments.push({ gpu, imageCount: remaining });
                }
            } else {
                // Calculate proportion (round down)
                const count = Math.floor(totalImages * gpu.config.weight / totalWeight);
                if (count > 0) {
                    assignments.push({ gpu, imageCount: count });
                    remaining -= count;
                }
            }
        }

        return assignments.filter(a => a.imageCount > 0);
    }
}

export const scheduler = new GPUScheduler();
