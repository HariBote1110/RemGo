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
    adaptiveCfg: number;
    overwriteStep: number;
    overwriteSwitch: number;
    overwriteWidth: number;
    overwriteHeight: number;
    disableSeedIncrement: boolean;
    admScalerPositive: number;
    admScalerNegative: number;
    admScalerEnd: number;
    refinerSwapMethod: string;
    controlnetSoftness: number;
    freeuEnabled: boolean;
    freeuB1: number;
    freeuB2: number;
    freeuS1: number;
    freeuS2: number;
    saveMetadataToImages: boolean;
    metadataScheme: string;
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
        refinerSwapMethods: string[];
        metadataSchemes: string[];
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
                adaptiveCfg: 7.0,
                overwriteStep: -1,
                overwriteSwitch: -1,
                overwriteWidth: -1,
                overwriteHeight: -1,
                disableSeedIncrement: false,
                admScalerPositive: 1.5,
                admScalerNegative: 0.8,
                admScalerEnd: 0.3,
                refinerSwapMethod: 'joint',
                controlnetSoftness: 0.25,
                freeuEnabled: false,
                freeuB1: 1.1,
                freeuB2: 1.2,
                freeuS1: 0.9,
                freeuS2: 0.2,
                saveMetadataToImages: false,
                metadataScheme: 'fooocus',
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
                refinerSwapMethods: ['joint', 'separate', 'vae'],
                metadataSchemes: ['fooocus', 'a1111'],
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
                        adaptiveCfg: persisted?.settings?.adaptiveCfg ?? currentState.settings.adaptiveCfg,
                        overwriteStep: persisted?.settings?.overwriteStep ?? currentState.settings.overwriteStep,
                        overwriteSwitch: persisted?.settings?.overwriteSwitch ?? currentState.settings.overwriteSwitch,
                        overwriteWidth: persisted?.settings?.overwriteWidth ?? currentState.settings.overwriteWidth,
                        overwriteHeight: persisted?.settings?.overwriteHeight ?? currentState.settings.overwriteHeight,
                        disableSeedIncrement: persisted?.settings?.disableSeedIncrement ?? currentState.settings.disableSeedIncrement,
                        admScalerPositive: persisted?.settings?.admScalerPositive ?? currentState.settings.admScalerPositive,
                        admScalerNegative: persisted?.settings?.admScalerNegative ?? currentState.settings.admScalerNegative,
                        admScalerEnd: persisted?.settings?.admScalerEnd ?? currentState.settings.admScalerEnd,
                        refinerSwapMethod: persisted?.settings?.refinerSwapMethod ?? currentState.settings.refinerSwapMethod,
                        controlnetSoftness: persisted?.settings?.controlnetSoftness ?? currentState.settings.controlnetSoftness,
                        freeuEnabled: persisted?.settings?.freeuEnabled ?? currentState.settings.freeuEnabled,
                        freeuB1: persisted?.settings?.freeuB1 ?? currentState.settings.freeuB1,
                        freeuB2: persisted?.settings?.freeuB2 ?? currentState.settings.freeuB2,
                        freeuS1: persisted?.settings?.freeuS1 ?? currentState.settings.freeuS1,
                        freeuS2: persisted?.settings?.freeuS2 ?? currentState.settings.freeuS2,
                        saveMetadataToImages: persisted?.settings?.saveMetadataToImages ?? currentState.settings.saveMetadataToImages,
                        metadataScheme: persisted?.settings?.metadataScheme ?? currentState.settings.metadataScheme,
                    }
                };
            }
        }
    )
);
