import { useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import type { TaskSettings } from '../store/useStore';

const API_BASE = 'http://localhost:8888';
const WS_BASE = 'ws://localhost:8888';

export const useApi = () => {
    const { setOptions, updateTask, settings } = useStore();

    const fetchSettings = useCallback(async () => {
        try {
            const resp = await fetch(`${API_BASE}/settings`);
            const data = await resp.json();
            setOptions({
                models: data.models,
                loras: data.loras,
                aspectRatios: data.aspect_ratios,
                performanceOptions: data.performance_options,
                styles: data.styles,
            });
        } catch (err) {
            console.error('Failed to fetch settings:', err);
        }
    }, [setOptions]);

    const generate = useCallback(async (overrideSettings?: Partial<TaskSettings>) => {
        const currentSettings = overrideSettings ? { ...settings, ...overrideSettings } : settings;
        try {
            const resp = await fetch(`${API_BASE}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: currentSettings.prompt,
                    negative_prompt: currentSettings.negativePrompt,
                    style_selections: currentSettings.styleSelections,
                    performance_selection: currentSettings.performanceSelection,
                    aspect_ratios_selection: currentSettings.aspectRatio,
                    image_number: currentSettings.imageNumber,
                    image_seed: currentSettings.seed,
                    guidance_scale: currentSettings.guidanceScale,
                    image_sharpness: currentSettings.imageSharpness,
                    base_model_name: currentSettings.baseModelName,
                    refiner_model_name: currentSettings.refinerModelName,
                    refiner_switch: currentSettings.refinerSwitch,
                    sampler_name: currentSettings.samplerName,
                    scheduler_name: currentSettings.schedulerName,
                }),
            });
            const data = await resp.json();
            return data.task_id;
        } catch (err) {
            console.error('Failed to generate:', err);
            return null;
        }
    }, [settings]);

    useEffect(() => {
        const ws = new WebSocket(`${WS_BASE}/ws`);

        ws.onmessage = (event) => {
            try {
                const updates = JSON.parse(event.data);
                Object.entries(updates).forEach(([taskId, progress]: [string, any]) => {
                    updateTask(taskId, {
                        percentage: progress.progress,
                        status: progress.status,
                        finished: progress.finished,
                        results: progress.results,
                    });
                });
            } catch (err) {
                console.error('WS parse error:', err);
            }
        };

        ws.onopen = () => console.log('Connected to RemGo WebSocket');
        ws.onclose = () => console.log('Disconnected from RemGo WebSocket');

        return () => ws.close();
    }, [updateTask]);

    return { fetchSettings, generate };
};
