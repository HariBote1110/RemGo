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
}

export interface TaskProgress {
    percentage: number;
    status: string;
    finished: boolean;
    results: string[];
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
                styleSelections: ["Fooocus V2", "Fooocus Enhance", "Fooocus Sharp"],
                performanceSelection: "Speed",
                aspectRatio: "1024*1024",
                imageNumber: 1,
                seed: -1,
            },
            activeTasks: {},
            availableOptions: {
                models: [],
                loras: [],
                aspectRatios: [],
                performanceOptions: [],
                styles: [],
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
