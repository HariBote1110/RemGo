import * as fs from 'fs';
import * as path from 'path';

export interface SettingsPayload {
    models: string[];
    loras: string[];
    vaes: string[];
    presets: string[];
    styles: string[];
    aspect_ratios: string[];
    performance_options: string[];
    samplers: string[];
    schedulers: string[];
    output_formats: string[];
    clip_skip_max: number;
    default_lora_count: number;
    refiner_swap_methods: string[];
    metadata_schemes: string[];
}

function listFilesByExtension(dirPath: string, extension: string): string[] {
    if (!fs.existsSync(dirPath)) {
        return [];
    }
    return fs.readdirSync(dirPath).filter((f) => f.endsWith(extension));
}

function listStyleNames(stylesPath: string): string[] {
    const styles: string[] = [];
    if (!fs.existsSync(stylesPath)) {
        return styles;
    }

    const styleFiles = fs.readdirSync(stylesPath).filter((f) => f.endsWith('.json'));
    for (const file of styleFiles) {
        try {
            const content = fs.readFileSync(path.join(stylesPath, file), 'utf-8');
            const styleData = JSON.parse(content);
            if (Array.isArray(styleData)) {
                styles.push(...styleData.map((s: any) => s?.name).filter(Boolean));
            }
        } catch {
            // Ignore invalid style files and keep loading the rest.
        }
    }
    const unique = Array.from(new Set(styles));

    // Match Python side legal styles that are not stored as JSON style entries.
    for (const special of ['Fooocus V2', 'Random Style']) {
        if (!unique.includes(special)) {
            unique.push(special);
        }
    }

    return unique;
}

export function loadSettings(rootPath: string): SettingsPayload {
    const checkpointsPath = path.join(rootPath, 'models', 'checkpoints');
    const lorasPath = path.join(rootPath, 'models', 'loras');
    const vaesPath = path.join(rootPath, 'models', 'vae');
    const presetsPath = path.join(rootPath, 'presets');
    const stylesPath = path.join(rootPath, 'sdxl_styles');

    const models = listFilesByExtension(checkpointsPath, '.safetensors');
    const loras = listFilesByExtension(lorasPath, '.safetensors');
    const vaes = listFilesByExtension(vaesPath, '.safetensors');

    const presets = fs.existsSync(presetsPath)
        ? fs.readdirSync(presetsPath)
            .filter((f) => f.endsWith('.json') && !f.startsWith('.'))
            .map((f) => f.replace('.json', ''))
        : ['default'];

    let styles = listStyleNames(stylesPath);
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
        refiner_swap_methods: ['joint', 'separate', 'vae'],
        metadata_schemes: ['fooocus', 'a1111'],
    };
}
