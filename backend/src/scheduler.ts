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
    private basePort: number = 9000;

    constructor(configPath?: string) {
        const cfgPath = configPath || path.join(__dirname, '../../gpu_config.json');
        this.loadConfig(cfgPath);
    }

    private loadConfig(configPath: string): void {
        if (!fs.existsSync(configPath)) {
            console.log('[Scheduler] Config not found, single GPU mode');
            return;
        }

        try {
            const content = fs.readFileSync(configPath, 'utf-8');
            const config: GPUConfigFile = JSON.parse(content);

            this.enabled = config.enabled || false;

            if (!this.enabled) {
                console.log('[Scheduler] Disabled in config');
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

            console.log(`[Scheduler] Loaded ${this.gpus.length} GPUs:`);
            this.gpus.forEach(gpu => {
                console.log(`  - Device ${gpu.config.device}: ${gpu.config.name} (weight: ${gpu.config.weight}, port: ${gpu.port})`);
            });

        } catch (error) {
            console.error('[Scheduler] Error loading config:', error);
        }
    }

    isEnabled(): boolean {
        return this.enabled && this.gpus.length > 0;
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
}

export const scheduler = new GPUScheduler();
