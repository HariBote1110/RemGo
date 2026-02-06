import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TaskSettings {
    prompt: string;
    negativePrompt: string;
    styleSelections: string[];
    performanceSelection: string;
    aspectRatio: string;
    imageNumber: number;
    seed: number;
    preset: string; // Added preset field
    // Advanced Settings
    guidanceScale: number;
    imageSharpness: number;
    baseModelName: string;
    refinerModelName: string;
    refinerSwitch: number;
    samplerName: string;
    schedulerName: string;
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
        aspectRatios: string[];
        performanceOptions: string[];
        styles: string[];
        presets: string[]; // Added presets list
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
                styleSelections: [], // Default to empty
                performanceSelection: "Speed",
                aspectRatio: "1152×896", // Adjusted default
                imageNumber: 1,
                seed: -1,
                preset: 'default', // Default preset
                guidanceScale: 4.0,
                imageSharpness: 2.0,
                baseModelName: 'Default',
                refinerModelName: 'None',
                refinerSwitch: 0.5,
                samplerName: 'dpmpp_2m_sde_gpu',
                schedulerName: 'karras',
            },
            activeTasks: {},
            availableOptions: {
                models: [],
                loras: [],
                aspectRatios: ["1024×1024", "1152×896", "896×1152", "1216×832", "832×1216", "1344×768", "768×1344"],
                performanceOptions: ["Speed", "Quality", "Extreme Speed", "Lightning", "Hyper-SD"],
                styles: [],
                presets: [],
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
        }
    )
);
