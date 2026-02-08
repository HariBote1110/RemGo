/**
 * Build Fooocus positional args in TypeScript so Python worker can focus on inference.
 * Python worker still keeps a fallback parser for backward compatibility.
 */

const DEFAULT_STYLES: string[] = [];
const DEFAULT_UOV_METHOD = 'Disabled';
const DEFAULT_REFINER_SWAP_METHOD = 'joint';
const DEFAULT_IP_TYPE = 'ImagePrompt';
const DEFAULT_METADATA_SCHEME = 'fooocus';
const DEFAULT_METADATA_SCHEMES = [DEFAULT_METADATA_SCHEME, 'a1111'];
const DEFAULT_REFINER_SWAP_METHODS = [DEFAULT_REFINER_SWAP_METHOD, 'separate', 'vae'];

const DEFAULT_MAX_LORA_NUMBER = 5;
const DEFAULT_CONTROLNET_IMAGE_COUNT = 4;
const DEFAULT_ENHANCE_TABS = 3;

type GenericRequest = Record<string, unknown>;
type ValidationResult = { ok: true } | { ok: false; reason: string };

export const FOOOCUS_ARGS_CONTRACT_VERSION = 1;
export const FOOOCUS_ARGS_EXPECTED_LENGTH = 152;

function asString(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function asStringArray(value: unknown, fallback: string[]): string[] {
    if (!Array.isArray(value)) {
        return fallback;
    }
    const items = value.filter((item): item is string => typeof item === 'string');
    return items;
}

function normalizeAspectRatio(value: string): string {
    // Python worker expects "W×H" and splits by the multiplication sign.
    return value.replace(/[xX*]/g, '×');
}

function asEnumString(value: unknown, fallback: string, allowed: string[]): string {
    if (typeof value === 'string' && allowed.includes(value)) {
        return value;
    }
    return fallback;
}

function normalizeLoras(value: unknown): Array<[boolean, string, number]> {
    if (!Array.isArray(value)) {
        return [];
    }

    const output: Array<[boolean, string, number]> = [];
    for (const item of value) {
        if (!Array.isArray(item) || item.length < 3) {
            continue;
        }
        const enabled = asBoolean(item[0], false);
        const model = asString(item[1], 'None');
        const weight = asNumber(item[2], 1.0);
        output.push([enabled, model, weight]);
    }
    return output;
}

export function buildFooocusTaskArgs(request: GenericRequest): unknown[] {
    const prompt = asString(request.prompt, '');
    const negativePrompt = asString(request.negative_prompt, '');
    const styleSelections = asStringArray(request.style_selections, DEFAULT_STYLES);
    const performance = asString(request.performance_selection, 'Speed');
    const aspectRatio = normalizeAspectRatio(asString(request.aspect_ratios_selection, '1024×1024'));
    const imageNumber = asNumber(request.image_number, 1);
    const outputFormat = asString(request.output_format, 'png');
    const imageSeed = asNumber(request.image_seed, -1);
    const seedRandom = asBoolean(request.seed_random, true);
    const sharpness = asNumber(request.image_sharpness, 2.0);
    const guidanceScale = asNumber(request.guidance_scale, 4.0);
    const baseModel = asString(request.base_model_name, 'model.safetensors');
    const refinerModel = asString(request.refiner_model_name, 'None');
    const refinerSwitch = asNumber(request.refiner_switch, 0.5);
    const clipSkip = asNumber(request.clip_skip, 2);
    const sampler = asString(request.sampler_name, 'dpmpp_2m_sde_gpu');
    const scheduler = asString(request.scheduler_name, 'karras');
    const vae = asString(request.vae_name, 'Default (model)');
    const loras = normalizeLoras(request.loras);
    const disableSeedIncrement = asBoolean(request.disable_seed_increment, false);
    const admScalerPositive = asNumber(request.adm_scaler_positive, 1.5);
    const admScalerNegative = asNumber(request.adm_scaler_negative, 0.8);
    const admScalerEnd = asNumber(request.adm_scaler_end, 0.3);
    const adaptiveCfg = asNumber(request.adaptive_cfg, 7.0);
    const overwriteStep = asNumber(request.overwrite_step, -1);
    const overwriteSwitch = asNumber(request.overwrite_switch, -1);
    const overwriteWidth = asNumber(request.overwrite_width, -1);
    const overwriteHeight = asNumber(request.overwrite_height, -1);
    const refinerSwapMethod = asEnumString(
        request.refiner_swap_method,
        DEFAULT_REFINER_SWAP_METHOD,
        DEFAULT_REFINER_SWAP_METHODS,
    );
    const controlnetSoftness = asNumber(request.controlnet_softness, 0.25);
    const freeuEnabled = asBoolean(request.freeu_enabled, false);
    const freeuB1 = asNumber(request.freeu_b1, 1.1);
    const freeuB2 = asNumber(request.freeu_b2, 1.2);
    const freeuS1 = asNumber(request.freeu_s1, 0.9);
    const freeuS2 = asNumber(request.freeu_s2, 0.2);
    const saveMetadataToImages = asBoolean(request.save_metadata_to_images, false);
    const metadataScheme = asEnumString(
        request.metadata_scheme,
        DEFAULT_METADATA_SCHEME,
        DEFAULT_METADATA_SCHEMES,
    );

    const args: unknown[] = [
        true,
        prompt,
        negativePrompt,
        styleSelections,
        performance,
        aspectRatio,
        imageNumber,
        outputFormat,
        imageSeed,
        seedRandom,
        sharpness,
        guidanceScale,
        baseModel,
        refinerModel,
        refinerSwitch,
    ];

    for (let i = 0; i < DEFAULT_MAX_LORA_NUMBER; i++) {
        if (i < loras.length) {
            args.push(loras[i][0], loras[i][1], loras[i][2]);
        } else {
            args.push(false, 'None', 1.0);
        }
    }

    args.push(
        true,
        'disabled',
        DEFAULT_UOV_METHOD,
        null,
        [],
        null,
        '',
        null,
        false,
        false,
        disableSeedIncrement,
        false,
        admScalerPositive,
        admScalerNegative,
        admScalerEnd,
        adaptiveCfg,
        clipSkip,
        sampler,
        scheduler,
        vae,
        overwriteStep,
        overwriteSwitch,
        overwriteWidth,
        overwriteHeight,
        -1,
        -1,
        false, false, false, false,
        64, 128,
        refinerSwapMethod,
        controlnetSoftness,
        freeuEnabled,
        freeuB1,
        freeuB2,
        freeuS1,
        freeuS2,
        false, false,
        'None', 1.0, 0.0,
        false, false, 0,
        false,
        saveMetadataToImages,
        metadataScheme,
    );

    for (let i = 0; i < DEFAULT_CONTROLNET_IMAGE_COUNT; i++) {
        args.push(null, 1.0, 1.0, DEFAULT_IP_TYPE);
    }

    args.push(
        false, 0, false, null, false,
        'Disabled',
        'Before First Enhancement',
        'Original Prompts',
    );

    for (let i = 0; i < DEFAULT_ENHANCE_TABS; i++) {
        args.push(
            false, '', '', '', 'None', 'None', 'None',
            0.3, 0.25, 0, false, 'None', 1.0, 0.618, 0, false,
        );
    }

    return args;
}

export function validateFooocusTaskArgs(args: unknown): ValidationResult {
    if (!Array.isArray(args)) {
        return { ok: false, reason: 'fooocus_args must be an array' };
    }

    if (args.length !== FOOOCUS_ARGS_EXPECTED_LENGTH) {
        return {
            ok: false,
            reason: `fooocus_args length mismatch: got ${args.length}, expected ${FOOOCUS_ARGS_EXPECTED_LENGTH}`,
        };
    }

    if (typeof args[0] !== 'boolean') {
        return { ok: false, reason: 'fooocus_args[0] must be boolean' };
    }
    if (typeof args[1] !== 'string') {
        return { ok: false, reason: 'fooocus_args[1] must be string' };
    }
    if (typeof args[2] !== 'string') {
        return { ok: false, reason: 'fooocus_args[2] must be string' };
    }
    if (!Array.isArray(args[3]) || !args[3].every((item) => typeof item === 'string')) {
        return { ok: false, reason: 'fooocus_args[3] must be string[]' };
    }
    if (typeof args[6] !== 'number') {
        return { ok: false, reason: 'fooocus_args[6] must be number' };
    }
    if (typeof args[8] !== 'number') {
        return { ok: false, reason: 'fooocus_args[8] must be number' };
    }
    if (typeof args[9] !== 'boolean') {
        return { ok: false, reason: 'fooocus_args[9] must be boolean' };
    }

    return { ok: true };
}
