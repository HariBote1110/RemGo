import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface LoraSettings {
    enabled: boolean;
    name: string;
    weight: number;
}

export interface TaskSettings {
    prompt: string;
    negativePrompt: string;
    styleSelections: string[];
    performanceSelection: string;
    aspectRatio: string;
    imageNumber: number;
    seed: number;
    seedRandom: boolean;
    preset: string;
    // Advanced Settings
    guidanceScale: number;
    imageSharpness: number;
    baseModelName: string;
    refinerModelName: string;
    refinerSwitch: number;
    samplerName: string;
    schedulerName: string;
    vaeName: string;
    outputFormat: string;
    clipSkip: number;
    loras: LoraSettings[];
}

export interface TaskProgress {
    percentage: number;
    status: string;
    finished: boolean;
    results: string[];
    preview?: string; // Base64 encoded preview image
}

interface AppState {
    settings: TaskSettings;
    activeTasks: Record<string, TaskProgress>;
    availableOptions: {
        models: string[];
        loras: string[];
        vaes: string[];
        aspectRatios: string[];
        performanceOptions: string[];
        styles: string[];
        presets: string[];
        samplers: string[];
        schedulers: string[];
        outputFormats: string[];
        clipSkipMax: number;
        defaultLoraCount: number;
    };
    setSettings: (settings: Partial<TaskSettings>) => void;
    updateTask: (taskId: string, progress: Partial<TaskProgress>) => void;
    setOptions: (options: Partial<AppState['availableOptions']>) => void;
}

export const useStore = create<AppState>()(
    persist(
        (set) => ({
            settings: {
                prompt: '',
                negativePrompt: '',
                styleSelections: [],
                performanceSelection: "Speed",
                aspectRatio: "1152×896",
                imageNumber: 1,
                seed: -1,
                seedRandom: true,
                preset: 'default',
                guidanceScale: 4.0,
                imageSharpness: 2.0,
                baseModelName: 'Default',
                refinerModelName: 'None',
                refinerSwitch: 0.5,
                samplerName: 'dpmpp_2m_sde_gpu',
                schedulerName: 'karras',
                vaeName: 'Default (model)',
                outputFormat: 'png',
                clipSkip: 2,
                loras: [],
            },
            activeTasks: {},
            availableOptions: {
                models: [],
                loras: [],
                vaes: ['Default (model)'],
                aspectRatios: ["1024×1024", "1152×896", "896×1152", "1216×832", "832×1216", "1344×768", "768×1344"],
                performanceOptions: ["Speed", "Quality", "Extreme Speed", "Lightning", "Hyper-SD"],
                styles: [],
                presets: [],
                samplers: ['dpmpp_2m_sde_gpu', 'euler', 'euler_ancestral'],
                schedulers: ['karras', 'normal', 'exponential'],
                outputFormats: ['png', 'jpeg', 'webp'],
                clipSkipMax: 12,
                defaultLoraCount: 5,
            },
            setSettings: (newSettings) =>
                set((state) => ({ settings: { ...state.settings, ...newSettings } })),
            updateTask: (taskId, progress) =>
                set((state) => ({
                    activeTasks: {
                        ...state.activeTasks,
                        [taskId]: {
                            ...(state.activeTasks[taskId] || {
                                percentage: 0,
                                status: 'Waiting',
                                finished: false,
                                results: [] as string[],
                            }),
                            ...progress
                        }
                    }
                })),
            setOptions: (options) =>
                set((state) => ({ availableOptions: { ...state.availableOptions, ...options } })),
        }),
        {
            name: 'remgo-storage',
            partialize: (state) => ({ settings: state.settings }),
            merge: (persistedState, currentState) => {
                const persisted = persistedState as { settings?: Partial<TaskSettings> };
                return {
                    ...currentState,
                    settings: {
                        ...currentState.settings,
                        ...(persisted?.settings || {}),
                        // Ensure new fields have defaults even if not in persisted state
                        loras: persisted?.settings?.loras ?? currentState.settings.loras,
                        seedRandom: persisted?.settings?.seedRandom ?? currentState.settings.seedRandom,
                        vaeName: persisted?.settings?.vaeName ?? currentState.settings.vaeName,
                        outputFormat: persisted?.settings?.outputFormat ?? currentState.settings.outputFormat,
                        clipSkip: persisted?.settings?.clipSkip ?? currentState.settings.clipSkip,
                    }
                };
            }
        }
    )
);
