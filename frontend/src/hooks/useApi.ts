import { useEffect, useCallback } from 'react';
import { useStore } from '../store/useStore';
import type { TaskSettings } from '../store/useStore';

const API_HOSTNAME = window.location.hostname;
const API_BASE = `http://${API_HOSTNAME}:8888`;
const WS_BASE = `ws://${API_HOSTNAME}:8888`;

export const useApi = () => {
    const { setSettings, setOptions, updateTask, settings } = useStore();

    const fetchSettings = useCallback(async () => {
        try {
            const resp = await fetch(`${API_BASE}/settings`);
            const data = await resp.json();
            console.log('Fetched settings:', data);
            setOptions({
                models: data.models,
                loras: data.loras,
                vaes: data.vaes || ['Default (model)'],
                aspectRatios: data.aspect_ratios,
                performanceOptions: data.performance_options,
                styles: data.styles,
                presets: data.presets,
                samplers: data.samplers || [],
                schedulers: data.schedulers || [],
                outputFormats: data.output_formats || ['png', 'jpeg', 'webp'],
                clipSkipMax: data.clip_skip_max || 12,
                defaultLoraCount: data.default_lora_count || 5,
            });
        } catch (err) {
            console.error('Failed to fetch settings:', err);
        }
    }, [setOptions]);

    const loadPreset = useCallback(async (presetName: string) => {
        try {
            const resp = await fetch(`${API_BASE}/presets/${presetName}`);
            const data = await resp.json();
            // Map preset data to settings
            // Note: This mapping needs to align with how data is returned from API
            // and how setSettings expects it.
            // Based on meta_parser.py logic, we need to map keys.
            // For now, let's implement a basic mapping based on known keys.

            // NOTE: The API returns keys like "default_prompt", "default_styles" etc.
            // We need to map them to our TaskSettings keys.

            const newSettings: Partial<TaskSettings> = {};
            if (data.default_prompt !== undefined) newSettings.prompt = data.default_prompt;
            if (data.default_prompt_negative !== undefined) newSettings.negativePrompt = data.default_prompt_negative;
            if (data.default_styles !== undefined) newSettings.styleSelections = data.default_styles;
            if (data.default_performance !== undefined) newSettings.performanceSelection = data.default_performance;
            if (data.default_aspect_ratio !== undefined) newSettings.aspectRatio = data.default_aspect_ratio;
            if (data.default_image_number !== undefined) newSettings.imageNumber = data.default_image_number;
            // newSettings.seed // seed usually isn't in preset default, or is -1

            // Advanced
            if (data.default_cfg_scale !== undefined) newSettings.guidanceScale = data.default_cfg_scale;
            if (data.default_sample_sharpness !== undefined) newSettings.imageSharpness = data.default_sample_sharpness;
            if (data.default_model !== undefined) newSettings.baseModelName = data.default_model;
            if (data.default_refiner !== undefined) newSettings.refinerModelName = data.default_refiner;
            if (data.default_refiner_switch !== undefined) newSettings.refinerSwitch = data.default_refiner_switch;
            if (data.default_sampler !== undefined) newSettings.samplerName = data.default_sampler;
            if (data.default_scheduler !== undefined) newSettings.schedulerName = data.default_scheduler;

            newSettings.preset = presetName;

            setSettings({ ...settings, ...newSettings }); // Update settings in store
            // Wait, setOptions is for availableOptions. We need setSettings.
            // The useApi hook destructured setOptions but not setSettings?
            // Checking line 10: const { setOptions, updateTask, settings } = useStore();
            // I need to add setSettings to destructuring.

        } catch (err) {
            console.error('Failed to load preset:', err);
        }
    }, [settings]);

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
                    seed_random: currentSettings.seedRandom,
                    guidance_scale: currentSettings.guidanceScale,
                    image_sharpness: currentSettings.imageSharpness,
                    base_model_name: currentSettings.baseModelName,
                    refiner_model_name: currentSettings.refinerModelName,
                    refiner_switch: currentSettings.refinerSwitch,
                    sampler_name: currentSettings.samplerName,
                    scheduler_name: currentSettings.schedulerName,
                    vae_name: currentSettings.vaeName,
                    output_format: currentSettings.outputFormat,
                    clip_skip: currentSettings.clipSkip,
                    loras: currentSettings.loras.map(l => [l.enabled, l.name, l.weight]),
                }),
            });
            const data = await resp.json();
            return data.task_id;
        } catch (err) {
            console.error('Failed to generate:', err);
            return null;
        }
    }, [settings]);

    const stopGeneration = useCallback(async () => {
        try {
            await fetch(`${API_BASE}/stop`, { method: 'POST' });
        } catch (err) {
            console.error('Failed to stop generation:', err);
        }
    }, []);

    const fetchHistory = useCallback(async () => {
        try {
            const resp = await fetch(`${API_BASE}/history`);
            return await resp.json();
        } catch (err) {
            console.error('Failed to fetch history:', err);
            return [];
        }
    }, []);

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
                        preview: progress.preview,
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

    return { fetchSettings, generate, loadPreset, stopGeneration, fetchHistory };
};
