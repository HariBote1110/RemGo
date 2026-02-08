import { useState, useEffect, useMemo } from 'react';
import { useStore } from './store/useStore';
import { useApi } from './hooks/useApi';
import { Sparkles, History, Send, Settings2, ChevronDown, ChevronUp, ImagePlus, Square, Search } from 'lucide-react';
import type { LoraSettings, TaskSettings } from './store/useStore';

const API_HOSTNAME = window.location.hostname;
const API_BASE = `http://${API_HOSTNAME}:8888`;

function parseMaybeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function parseStyles(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value !== 'string') {
    return [];
  }

  const raw = value.trim();
  if (!raw) {
    return [];
  }

  try {
    const jsonParsed = JSON.parse(raw);
    if (Array.isArray(jsonParsed)) {
      return jsonParsed.filter((v): v is string => typeof v === 'string');
    }
  } catch {
    // Fall back to Python-style list parsing.
  }

  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) {
      return [];
    }
    return inner
      .split(',')
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
  }

  return [raw];
}

function parseAspectRatio(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const match = value.match(/(\d+)\D+(\d+)/);
  if (!match) {
    return null;
  }
  return `${match[1]}×${match[2]}`;
}

function parseLoraEntry(value: unknown): LoraSettings | null {
  if (typeof value !== 'string') {
    return null;
  }

  const parts = value.split(' : ').map((p) => p.trim());
  if (parts.length === 2) {
    const weight = parseMaybeNumber(parts[1]);
    if (weight === null) {
      return null;
    }
    return {
      enabled: true,
      name: parts[0],
      weight,
    };
  }

  if (parts.length === 3) {
    const enabled = parts[0].toLowerCase() === 'true';
    const weight = parseMaybeNumber(parts[2]);
    if (weight === null) {
      return null;
    }
    return {
      enabled,
      name: parts[1],
      weight,
    };
  }

  return null;
}

function parseLorasFromMetadata(metadata: Record<string, unknown>): LoraSettings[] {
  const loraKeys = Object.keys(metadata)
    .filter((k) => k.startsWith('lora_combined_'))
    .sort((a, b) => {
      const aNum = Number(a.replace('lora_combined_', ''));
      const bNum = Number(b.replace('lora_combined_', ''));
      return aNum - bNum;
    });

  const loras: LoraSettings[] = [];
  for (const key of loraKeys) {
    const parsed = parseLoraEntry(metadata[key]);
    if (!parsed || parsed.name === 'None') {
      continue;
    }
    loras.push(parsed);
  }
  return loras;
}

interface ConfigEditorField {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object' | 'unknown';
  default_value: unknown;
  current_value: unknown;
}

function App() {
  const { settings, setSettings, activeTasks, availableOptions } = useStore();
  const { fetchSettings, generate, loadPreset, stopGeneration, fetchHistory, fetchConfigEditor, updateConfigEditor } = useApi();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState<'generate' | 'history' | 'config'>('generate');
  const [historyImages, setHistoryImages] = useState<any[]>([]);
  const [selectedImage, setSelectedImage] = useState<{ url: string; path: string } | null>(null);
  const [imageMetadata, setImageMetadata] = useState<any>(null);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [configFields, setConfigFields] = useState<ConfigEditorField[]>([]);
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({});
  const [configJsonDrafts, setConfigJsonDrafts] = useState<Record<string, string>>({});
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState<string>('');
  const [configQuery, setConfigQuery] = useState('');

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory().then(setHistoryImages);
    }
  }, [activeTab, fetchHistory]);

  useEffect(() => {
    if (activeTab !== 'config') return;
    setConfigLoading(true);
    fetchConfigEditor()
      .then((payload) => {
        if (!payload || !Array.isArray(payload.fields)) {
          setConfigMessage('設定項目の読み込みに失敗しました。');
          return;
        }
        const fields = payload.fields as ConfigEditorField[];
        setConfigFields(fields);
        const values: Record<string, unknown> = {};
        const drafts: Record<string, string> = {};
        fields.forEach((field) => {
          values[field.key] = field.current_value;
          if (field.type === 'array' || field.type === 'object') {
            drafts[field.key] = JSON.stringify(field.current_value, null, 2);
          }
        });
        setConfigValues(values);
        setConfigJsonDrafts(drafts);
        setConfigMessage('');
      })
      .finally(() => {
        setConfigLoading(false);
      });
  }, [activeTab, fetchConfigEditor]);

  const handleGenerate = async () => {
    if (!settings.prompt.trim()) return;
    await generate();
  };

  const handleStop = async () => {
    await stopGeneration();
  };

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPreset = e.target.value;
    loadPreset(newPreset);
  };

  const isProcessing = Object.values(activeTasks).some(t => !t.finished);
  const currentTask = Object.values(activeTasks).find(t => !t.finished) || Object.values(activeTasks).at(-1);
  const availableStyleSet = useMemo(() => new Set(availableOptions.styles), [availableOptions.styles]);
  const selectedAvailableStyles = useMemo(
    () => settings.styleSelections.filter(style => availableStyleSet.has(style)),
    [settings.styleSelections, availableStyleSet]
  );
  const unavailableSelectedStyles = useMemo(
    () => settings.styleSelections.filter(style => !availableStyleSet.has(style)),
    [settings.styleSelections, availableStyleSet]
  );
  const displayedStyles = useMemo(() => {
    const selectedSet = new Set(selectedAvailableStyles);
    const unselected = availableOptions.styles.filter(style => !selectedSet.has(style));
    return [...selectedAvailableStyles, ...unselected].slice(0, 200);
  }, [availableOptions.styles, selectedAvailableStyles]);

  const displayedConfigFields = useMemo(() => {
    const query = configQuery.trim().toLowerCase();
    if (!query) {
      return configFields;
    }
    return configFields.filter((field) => field.key.toLowerCase().includes(query));
  }, [configFields, configQuery]);

  const updateConfigPrimitive = (key: string, value: unknown) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  };

  const updateConfigJson = (key: string, raw: string) => {
    setConfigJsonDrafts((prev) => ({ ...prev, [key]: raw }));
    try {
      const parsed = JSON.parse(raw);
      setConfigValues((prev) => ({ ...prev, [key]: parsed }));
      setConfigMessage('');
    } catch {
      setConfigMessage(`"${key}" のJSONが不正です。`);
    }
  };

  const handleSaveConfig = async () => {
    setConfigSaving(true);
    const resp = await updateConfigEditor(configValues);
    if (resp?.success) {
      setConfigMessage(`保存しました（${resp.updated_keys?.length ?? 0}項目）。反映には再起動が必要です。`);
    } else {
      setConfigMessage(resp?.error ?? '保存に失敗しました。');
    }
    setConfigSaving(false);
  };

  const applyMetadataToSettings = () => {
    if (!imageMetadata || typeof imageMetadata !== 'object') {
      return;
    }

    const metadata = imageMetadata as Record<string, unknown>;
    const updates: Partial<TaskSettings> = {};

    if (typeof metadata.prompt === 'string') {
      updates.prompt = metadata.prompt;
    }
    if (typeof metadata.negative_prompt === 'string') {
      updates.negativePrompt = metadata.negative_prompt;
    }

    const styles = parseStyles(metadata.styles);
    if (styles.length > 0) {
      updates.styleSelections = styles;
    }

    if (typeof metadata.performance === 'string') {
      updates.performanceSelection = metadata.performance;
    }

    const aspectRatio = parseAspectRatio(metadata.resolution);
    if (aspectRatio) {
      updates.aspectRatio = aspectRatio;
    }

    const guidanceScale = parseMaybeNumber(metadata.guidance_scale);
    if (guidanceScale !== null) {
      updates.guidanceScale = guidanceScale;
    }

    const sharpness = parseMaybeNumber(metadata.sharpness);
    if (sharpness !== null) {
      updates.imageSharpness = sharpness;
    }

    if (typeof metadata.base_model === 'string') {
      updates.baseModelName = metadata.base_model;
    }
    if (typeof metadata.refiner_model === 'string') {
      updates.refinerModelName = metadata.refiner_model;
    }

    const refinerSwitch = parseMaybeNumber(metadata.refiner_switch);
    if (refinerSwitch !== null) {
      updates.refinerSwitch = refinerSwitch;
    }

    if (typeof metadata.sampler === 'string') {
      updates.samplerName = metadata.sampler;
    }
    if (typeof metadata.scheduler === 'string') {
      updates.schedulerName = metadata.scheduler;
    }
    if (typeof metadata.vae === 'string') {
      updates.vaeName = metadata.vae;
    }

    const seed = parseMaybeNumber(metadata.seed);
    if (seed !== null) {
      updates.seed = Math.trunc(seed);
      updates.seedRandom = false;
    }

    const clipSkip = parseMaybeNumber(metadata.clip_skip);
    if (clipSkip !== null) {
      updates.clipSkip = Math.trunc(clipSkip);
    }
    const adaptiveCfg = parseMaybeNumber(metadata.adaptive_cfg);
    if (adaptiveCfg !== null) {
      updates.adaptiveCfg = adaptiveCfg;
    }
    const overwriteStep = parseMaybeNumber(metadata.steps);
    if (overwriteStep !== null) {
      updates.overwriteStep = Math.trunc(overwriteStep);
    }
    const overwriteSwitch = parseMaybeNumber(metadata.overwrite_switch);
    if (overwriteSwitch !== null) {
      updates.overwriteSwitch = overwriteSwitch;
    }
    if (typeof metadata.refiner_swap_method === 'string') {
      updates.refinerSwapMethod = metadata.refiner_swap_method;
    }
    const controlnetSoftness = parseMaybeNumber(metadata.controlnet_softness);
    if (controlnetSoftness !== null) {
      updates.controlnetSoftness = controlnetSoftness;
    }
    if (typeof metadata.metadata_scheme === 'string') {
      updates.metadataScheme = metadata.metadata_scheme;
    }

    const loras = parseLorasFromMetadata(metadata);
    if (loras.length > 0) {
      updates.loras = loras;
    }

    setSettings(updates);
    setActiveTab('generate');
    setSelectedImage(null);
  };

  return (
    <div className="min-h-screen p-4 md:p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-premium-accent rounded-2xl shadow-lg shadow-premium-accent/40">
            <Sparkles className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">RemGo</h1>
            <p className="text-white/40 text-sm">Decoupled Architecture Fork</p>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-black/20 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('generate')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'generate' ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/60'}`}
          >
            Generate
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'history' ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/60'}`}
          >
            History
          </button>
          <button
            onClick={() => setActiveTab('config')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'config' ? 'bg-white/10 text-white shadow-sm' : 'text-white/40 hover:text-white/60'}`}
          >
            Config
          </button>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {activeTab === 'generate' ? (
          <>
            {/* Left Side: Controls */}
            <section className="lg:col-span-4 space-y-6">
              <div className="glass-card p-6 space-y-6">

                {/* Preset Selection */}
                <div className="space-y-2">
                  <label className="text-xs font-medium text-white/40">Preset</label>
                  <select
                    value={settings.preset}
                    onChange={handlePresetChange}
                    className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm outline-none"
                    disabled={isProcessing}
                  >
                    {!availableOptions.presets.includes(settings.preset) && settings.preset && (
                      <option value={settings.preset}>{settings.preset}</option>
                    )}
                    {availableOptions.presets.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-4">
                  <label className="text-sm font-medium text-white/60 flex items-center gap-2">
                    Prompt
                  </label>
                  <textarea
                    value={settings.prompt}
                    onChange={(e) => setSettings({ prompt: e.target.value })}
                    placeholder="An astronaut riding a horse in space..."
                    className="w-full h-32 bg-black/40 border border-white/10 rounded-xl p-4 text-white placeholder:text-white/20 focus:ring-2 focus:ring-premium-accent/50 outline-none transition-all resize-none"
                    disabled={isProcessing}
                  />
                </div>

                <div className="space-y-4">
                  <label className="text-sm font-medium text-white/60 flex items-center gap-2">
                    Negative Prompt
                  </label>
                  <textarea
                    value={settings.negativePrompt}
                    onChange={(e) => setSettings({ negativePrompt: e.target.value })}
                    placeholder="Low quality, blurry, distorted..."
                    className="w-full h-20 bg-black/40 border border-white/10 rounded-xl p-4 text-sm text-white placeholder:text-white/20 focus:ring-2 focus:ring-red-500/30 outline-none transition-all resize-none"
                    disabled={isProcessing}
                  />
                </div>

                {/* Styles Selection */}
                {availableOptions.styles.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-white/40">Styles</label>
                      <span className="text-xs text-white/30">
                        {selectedAvailableStyles.length} selected
                        {unavailableSelectedStyles.length > 0 ? ` (${unavailableSelectedStyles.length} unavailable)` : ''}
                      </span>
                    </div>
                    <div className="max-h-32 overflow-y-auto bg-black/20 rounded-lg p-2 space-y-1">
                      {displayedStyles.map(style => (
                        <label key={style} className="flex items-center gap-2 py-1 px-2 rounded hover:bg-white/5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={settings.styleSelections.includes(style)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSettings({ styleSelections: [...settings.styleSelections, style] });
                              } else {
                                setSettings({ styleSelections: settings.styleSelections.filter(s => s !== style) });
                              }
                            }}
                            className="accent-premium-accent"
                            disabled={isProcessing}
                          />
                          <span className="text-xs text-white/70">{style}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-white/40">Performance</label>
                    <select
                      value={settings.performanceSelection}
                      onChange={(e) => setSettings({ performanceSelection: e.target.value })}
                      className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm outline-none"
                      disabled={isProcessing}
                    >
                      {availableOptions.performanceOptions.map(opt => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-white/40">Aspect Ratio</label>
                    <select
                      value={settings.aspectRatio}
                      onChange={(e) => setSettings({ aspectRatio: e.target.value })}
                      className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm outline-none"
                      disabled={isProcessing}
                    >
                      {!availableOptions.aspectRatios.includes(settings.aspectRatio) && (
                        <option value={settings.aspectRatio}>{settings.aspectRatio}</option>
                      )}
                      {availableOptions.aspectRatios.map(opt => (
                        <option key={opt} value={opt}>{opt.replace(/<[^>]*>/g, '').trim()}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Batch Size */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-medium text-white/40">Image Count (Batch Size)</label>
                    <span className="text-xs text-premium-accent">{settings.imageNumber}</span>
                  </div>
                  <input
                    type="range" min="1" max={availableOptions.maxImageNumber} step="1"
                    value={settings.imageNumber}
                    onChange={(e) => setSettings({ imageNumber: parseInt(e.target.value) })}
                    className="w-full accent-premium-accent"
                    disabled={isProcessing}
                  />
                </div>


                {/* Advanced Settings Panel Toggle */}
                <div className="border-t border-white/5 pt-6 space-y-4">
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="w-full flex items-center justify-between text-xs font-bold uppercase tracking-wider text-white/30 hover:text-white/60 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Settings2 className="w-3.5 h-3.5" />
                      Advanced Settings
                    </div>
                    {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showAdvanced && (
                    <div className="space-y-6 pt-2 animate-in fade-in slide-in-from-top-2 duration-300">
                      {/* Seed Settings */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs text-white/50">Seed</label>
                          <label className="flex items-center gap-2 text-xs text-white/50">
                            <input
                              type="checkbox"
                              checked={settings.seedRandom}
                              onChange={(e) => setSettings({ seedRandom: e.target.checked })}
                              className="accent-premium-accent"
                              disabled={isProcessing}
                            />
                            Random
                          </label>
                        </div>
                        {!settings.seedRandom && (
                          <input
                            type="number"
                            value={settings.seed}
                            onChange={(e) => setSettings({ seed: parseInt(e.target.value) || 0 })}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                            placeholder="Enter seed..."
                            disabled={isProcessing}
                          />
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <label className="text-xs text-white/50">Guidance Scale</label>
                            <span className="text-xs text-premium-accent">{settings.guidanceScale}</span>
                          </div>
                          <input
                            type="range" min="1" max="30" step="0.5"
                            value={settings.guidanceScale}
                            onChange={(e) => setSettings({ guidanceScale: parseFloat(e.target.value) })}
                            className="w-full accent-premium-accent"
                            disabled={isProcessing}
                          />
                        </div>

                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <label className="text-xs text-white/50">Image Sharpness</label>
                            <span className="text-xs text-premium-accent">{settings.imageSharpness}</span>
                          </div>
                          <input
                            type="range" min="0" max="10" step="0.5"
                            value={settings.imageSharpness}
                            onChange={(e) => setSettings({ imageSharpness: parseFloat(e.target.value) })}
                            className="w-full accent-premium-accent"
                            disabled={isProcessing}
                          />
                        </div>
                      </div>

                      {/* CLIP Skip */}
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <label className="text-xs text-white/50">CLIP Skip</label>
                          <span className="text-xs text-premium-accent">{settings.clipSkip}</span>
                        </div>
                        <input
                          type="range" min="1" max={availableOptions.clipSkipMax} step="1"
                          value={settings.clipSkip}
                          onChange={(e) => setSettings({ clipSkip: parseInt(e.target.value) })}
                          className="w-full accent-premium-accent"
                          disabled={isProcessing}
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs text-white/50">Base Model</label>
                          <select
                            value={settings.baseModelName}
                            onChange={(e) => setSettings({ baseModelName: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                            disabled={isProcessing}
                          >
                            {availableOptions.models.map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-white/50">Refiner Model</label>
                          <select
                            value={settings.refinerModelName}
                            onChange={(e) => setSettings({ refinerModelName: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                            disabled={isProcessing}
                          >
                            <option value="None">None</option>
                            {availableOptions.models.map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Sampler & Scheduler */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs text-white/50">Sampler</label>
                          <select
                            value={settings.samplerName}
                            onChange={(e) => setSettings({ samplerName: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                            disabled={isProcessing}
                          >
                            {availableOptions.samplers.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-white/50">Scheduler</label>
                          <select
                            value={settings.schedulerName}
                            onChange={(e) => setSettings({ schedulerName: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                            disabled={isProcessing}
                          >
                            {availableOptions.schedulers.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* VAE & Output Format */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs text-white/50">VAE</label>
                          <select
                            value={settings.vaeName}
                            onChange={(e) => setSettings({ vaeName: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                            disabled={isProcessing}
                          >
                            {availableOptions.vaes.map(v => (
                              <option key={v} value={v}>{v}</option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-white/50">Output Format</label>
                          <select
                            value={settings.outputFormat}
                            onChange={(e) => setSettings({ outputFormat: e.target.value })}
                            className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                            disabled={isProcessing}
                          >
                            {availableOptions.outputFormats.map(f => (
                              <option key={f} value={f}>{f.toUpperCase()}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Refiner Switch At */}
                      {settings.refinerModelName !== 'None' && (
                        <div className="space-y-3">
                          <div className="flex justify-between items-center">
                            <label className="text-xs text-white/50">Refiner Switch At</label>
                            <span className="text-xs text-premium-accent">{settings.refinerSwitch.toFixed(2)}</span>
                          </div>
                          <input
                            type="range" min="0.1" max="1.0" step="0.05"
                            value={settings.refinerSwitch}
                            onChange={(e) => setSettings({ refinerSwitch: parseFloat(e.target.value) })}
                            className="w-full accent-premium-accent"
                            disabled={isProcessing}
                          />
                        </div>
                      )}

                      {/* LoRA Settings */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs text-white/50">LoRAs</label>
                          <button
                            type="button"
                            onClick={() => {
                              if (settings.loras.length < availableOptions.defaultLoraCount) {
                                setSettings({ loras: [...settings.loras, { enabled: true, name: 'None', weight: 1.0 }] });
                              }
                            }}
                            className="text-xs text-premium-accent hover:text-premium-accent/80"
                            disabled={isProcessing || settings.loras.length >= availableOptions.defaultLoraCount}
                          >
                            + Add LoRA
                          </button>
                        </div>
                        {settings.loras.length > 0 ? (
                          <div className="space-y-2">
                            {settings.loras.map((lora, idx) => (
                              <div key={idx} className="flex items-center gap-2 bg-black/20 rounded-lg p-2">
                                <input
                                  type="checkbox"
                                  checked={lora.enabled}
                                  onChange={(e) => {
                                    const newLoras = [...settings.loras];
                                    newLoras[idx] = { ...lora, enabled: e.target.checked };
                                    setSettings({ loras: newLoras });
                                  }}
                                  className="accent-premium-accent"
                                  disabled={isProcessing}
                                />
                                <select
                                  value={lora.name}
                                  onChange={(e) => {
                                    const newLoras = [...settings.loras];
                                    newLoras[idx] = { ...lora, name: e.target.value };
                                    setSettings({ loras: newLoras });
                                  }}
                                  className="flex-1 bg-black/40 border border-white/10 rounded p-1 text-xs outline-none"
                                  disabled={isProcessing}
                                >
                                  <option value="None">None</option>
                                  {availableOptions.loras.map(l => (
                                    <option key={l} value={l}>{l}</option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  value={lora.weight}
                                  onChange={(e) => {
                                    const newLoras = [...settings.loras];
                                    newLoras[idx] = { ...lora, weight: parseFloat(e.target.value) || 0 };
                                    setSettings({ loras: newLoras });
                                  }}
                                  min="-2" max="2" step="0.1"
                                  className="w-16 bg-black/40 border border-white/10 rounded p-1 text-xs outline-none"
                                  disabled={isProcessing}
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const newLoras = settings.loras.filter((_, i) => i !== idx);
                                    setSettings({ loras: newLoras });
                                  }}
                                  className="text-red-400 hover:text-red-300 text-xs px-1"
                                  disabled={isProcessing}
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-white/30 italic">No LoRAs configured</p>
                        )}
                      </div>

                      <div className="border-t border-white/10 pt-4 space-y-4">
                        <p className="text-xs font-semibold tracking-wide text-white/60">Expert</p>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-xs text-white/50">Adaptive CFG (TSNR)</label>
                            <input
                              type="number"
                              value={settings.adaptiveCfg}
                              onChange={(e) => setSettings({ adaptiveCfg: parseFloat(e.target.value) || 0 })}
                              step="0.1"
                              className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                              disabled={isProcessing}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs text-white/50">ControlNet Softness</label>
                            <input
                              type="number"
                              value={settings.controlnetSoftness}
                              onChange={(e) => setSettings({ controlnetSoftness: parseFloat(e.target.value) || 0 })}
                              step="0.01"
                              min="0"
                              max="1"
                              className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                              disabled={isProcessing}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-xs text-white/50">Overwrite Steps (-1=auto)</label>
                            <input
                              type="number"
                              value={settings.overwriteStep}
                              onChange={(e) => setSettings({ overwriteStep: parseInt(e.target.value) || -1 })}
                              className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                              disabled={isProcessing}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs text-white/50">Overwrite Switch (-1=auto)</label>
                            <input
                              type="number"
                              value={settings.overwriteSwitch}
                              onChange={(e) => setSettings({ overwriteSwitch: parseFloat(e.target.value) || -1 })}
                              step="0.05"
                              className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                              disabled={isProcessing}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-xs text-white/50">Overwrite Width (-1=off)</label>
                            <input
                              type="number"
                              value={settings.overwriteWidth}
                              onChange={(e) => setSettings({ overwriteWidth: parseInt(e.target.value) || -1 })}
                              className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                              disabled={isProcessing}
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs text-white/50">Overwrite Height (-1=off)</label>
                            <input
                              type="number"
                              value={settings.overwriteHeight}
                              onChange={(e) => setSettings({ overwriteHeight: parseInt(e.target.value) || -1 })}
                              className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                              disabled={isProcessing}
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-xs text-white/50">Refiner Swap Method</label>
                            <select
                              value={settings.refinerSwapMethod}
                              onChange={(e) => setSettings({ refinerSwapMethod: e.target.value })}
                              className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                              disabled={isProcessing}
                            >
                              {availableOptions.refinerSwapMethods.map((m) => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs text-white/50">Metadata Scheme</label>
                            <select
                              value={settings.metadataScheme}
                              onChange={(e) => setSettings({ metadataScheme: e.target.value })}
                              className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                              disabled={isProcessing}
                            >
                              {availableOptions.metadataSchemes.map((m) => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <label className="flex items-center gap-2 text-xs text-white/60">
                            <input
                              type="checkbox"
                              checked={settings.disableSeedIncrement}
                              onChange={(e) => setSettings({ disableSeedIncrement: e.target.checked })}
                              className="accent-premium-accent"
                              disabled={isProcessing}
                            />
                            Disable Seed Increment
                          </label>
                          <label className="flex items-center gap-2 text-xs text-white/60">
                            <input
                              type="checkbox"
                              checked={settings.saveMetadataToImages}
                              onChange={(e) => setSettings({ saveMetadataToImages: e.target.checked })}
                              className="accent-premium-accent"
                              disabled={isProcessing}
                            />
                            Save Metadata to Images
                          </label>
                        </div>

                        <div className="space-y-3 border border-white/10 rounded-lg p-3 bg-black/20">
                          <label className="flex items-center gap-2 text-xs text-white/60">
                            <input
                              type="checkbox"
                              checked={settings.freeuEnabled}
                              onChange={(e) => setSettings({ freeuEnabled: e.target.checked })}
                              className="accent-premium-accent"
                              disabled={isProcessing}
                            />
                            Enable FreeU
                          </label>
                          <div className="grid grid-cols-2 gap-3">
                            <input
                              type="number"
                              value={settings.freeuB1}
                              onChange={(e) => setSettings({ freeuB1: parseFloat(e.target.value) || 0 })}
                              step="0.01"
                              className="w-full bg-black/40 border border-white/10 rounded p-2 text-xs outline-none"
                              disabled={isProcessing}
                            />
                            <input
                              type="number"
                              value={settings.freeuB2}
                              onChange={(e) => setSettings({ freeuB2: parseFloat(e.target.value) || 0 })}
                              step="0.01"
                              className="w-full bg-black/40 border border-white/10 rounded p-2 text-xs outline-none"
                              disabled={isProcessing}
                            />
                            <input
                              type="number"
                              value={settings.freeuS1}
                              onChange={(e) => setSettings({ freeuS1: parseFloat(e.target.value) || 0 })}
                              step="0.01"
                              className="w-full bg-black/40 border border-white/10 rounded p-2 text-xs outline-none"
                              disabled={isProcessing}
                            />
                            <input
                              type="number"
                              value={settings.freeuS2}
                              onChange={(e) => setSettings({ freeuS2: parseFloat(e.target.value) || 0 })}
                              step="0.01"
                              className="w-full bg-black/40 border border-white/10 rounded p-2 text-xs outline-none"
                              disabled={isProcessing}
                            />
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs text-white/50">ADM Scaler (positive / negative / end)</label>
                          <div className="grid grid-cols-3 gap-3">
                            <input
                              type="number"
                              value={settings.admScalerPositive}
                              onChange={(e) => setSettings({ admScalerPositive: parseFloat(e.target.value) || 0 })}
                              step="0.01"
                              className="w-full bg-black/40 border border-white/10 rounded p-2 text-xs outline-none"
                              disabled={isProcessing}
                            />
                            <input
                              type="number"
                              value={settings.admScalerNegative}
                              onChange={(e) => setSettings({ admScalerNegative: parseFloat(e.target.value) || 0 })}
                              step="0.01"
                              className="w-full bg-black/40 border border-white/10 rounded p-2 text-xs outline-none"
                              disabled={isProcessing}
                            />
                            <input
                              type="number"
                              value={settings.admScalerEnd}
                              onChange={(e) => setSettings({ admScalerEnd: parseFloat(e.target.value) || 0 })}
                              step="0.01"
                              className="w-full bg-black/40 border border-white/10 rounded p-2 text-xs outline-none"
                              disabled={isProcessing}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {isProcessing ? (
                  <button
                    onClick={handleStop}
                    className="w-full bg-red-500/20 hover:bg-red-500/30 text-red-500 border border-red-500/50 rounded-xl flex items-center justify-center gap-2 py-4 transition-all"
                  >
                    <Square className="w-5 h-5 fill-current" />
                    Stop Generation
                  </button>
                ) : (
                  <button
                    onClick={handleGenerate}
                    className="w-full premium-button flex items-center justify-center gap-2 py-4"
                  >
                    <Send className="w-5 h-5" />
                    Generate
                  </button>
                )}
              </div>
            </section>

            {/* Right Side: Preview & Gallery */}
            <section className="lg:col-span-8 space-y-6">
              <div className="glass-card min-h-[600px] flex items-center justify-center relative overflow-hidden bg-black/40 backdrop-blur-xl">
                <div className="absolute inset-0 bg-gradient-to-br from-premium-accent/5 to-transparent pointer-events-none" />

                {currentTask ? (
                  <div className="relative w-full h-full flex flex-col items-center justify-center p-4">
                    {currentTask.preview ? (
                      <img
                        src={`data:image/jpeg;base64,${currentTask.preview}`}
                        className="max-h-[80vh] max-w-full object-contain rounded-lg shadow-2xl transition-all duration-300"
                        alt="Preview"
                      />
                    ) : currentTask.results && currentTask.results.length > 0 ? (
                      <img
                        src={`${API_BASE}/images/${currentTask.results[0]}`}
                        className="max-h-[80vh] max-w-full object-contain rounded-lg shadow-2xl"
                        alt="Result"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-4 animate-pulse">
                        <div className="p-8 bg-white/5 rounded-full">
                          <Sparkles className="w-12 h-12 text-premium-accent animate-spin-slow" />
                        </div>
                        <p className="text-white/40 font-mono text-sm">Initializing...</p>
                      </div>
                    )}

                    {/* Progress Overlay */}
                    {!currentTask.finished && (
                      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-md bg-black/60 backdrop-blur-md p-4 rounded-2xl border border-white/10 shadow-xl">
                        <div className="flex justify-between text-xs text-white/80 mb-2 font-medium">
                          <span>{currentTask.status}</span>
                          <span>{Math.round(currentTask.percentage)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-premium-accent transition-all duration-300 shadow-[0_0_10px_rgba(var(--premium-accent),0.5)]"
                            style={{ width: `${currentTask.percentage}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center space-y-4 p-8 text-white/20">
                    <div className="w-24 h-24 mx-auto border-2 border-dashed border-white/10 rounded-2xl flex items-center justify-center">
                      <ImagePlus className="w-10 h-10" strokeWidth={1} />
                    </div>
                    <p className="text-sm">Ready to create masterpieces</p>
                  </div>
                )}
              </div>
            </section>
          </>
        ) : activeTab === 'history' ? (
          /* History Tab */
          <section className="col-span-12 space-y-6">
            <div className="glass-card p-6 min-h-[500px]">
              <h3 className="text-lg font-medium text-white/80 mb-6 flex items-center gap-2">
                <History className="w-5 h-5" />
                Generation History
              </h3>

              {historyImages.length > 0 ? (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                  {historyImages.map((img) => (
                    <div
                      key={img.path}
                      className="group relative aspect-square bg-white/5 rounded-xl overflow-hidden cursor-pointer hover:ring-2 hover:ring-premium-accent transition-all"
                      onClick={() => {
                        setSelectedImage({ url: `${API_BASE}/images/${img.path}`, path: img.path });
                        setImageMetadata(img.metadata);
                        setLoadingMetadata(false);
                      }}
                    >
                      <img
                        src={`${API_BASE}/images/${img.path}`}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                        alt={img.filename}
                      />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 opacity-0 group-hover:opacity-100 transition-opacity">
                        <p className="text-[10px] text-white/70 truncate">{new Date(img.created * 1000).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-white/30">
                  <Search className="w-8 h-8 mb-2" />
                  <p>No history found</p>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="col-span-12 space-y-6">
            <div className="glass-card p-6 min-h-[500px] space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h3 className="text-lg font-medium text-white/80">Config Editor</h3>
                  <p className="text-xs text-white/50">`config_modification_tutorial.txt` のキーを `config.txt` に保存します。</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={configQuery}
                    onChange={(e) => setConfigQuery(e.target.value)}
                    placeholder="キー名で検索"
                    className="bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveConfig}
                    disabled={configSaving || configLoading}
                    className="px-4 py-2 text-xs rounded-lg bg-premium-accent/30 hover:bg-premium-accent/40 border border-premium-accent/40 disabled:opacity-50"
                  >
                    {configSaving ? '保存中...' : 'Save Config'}
                  </button>
                </div>
              </div>

              <p className="text-xs text-yellow-300/80">保存後はバックエンド/ワーカー再起動後に反映されます。</p>
              {configMessage && <p className="text-xs text-white/70">{configMessage}</p>}

              {configLoading ? (
                <p className="text-sm text-white/50">Loading config schema...</p>
              ) : (
                <div className="space-y-3 max-h-[70vh] overflow-auto pr-2">
                  {displayedConfigFields.map((field) => (
                    <div key={field.key} className="bg-black/20 border border-white/10 rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs text-white/80 font-mono">{field.key}</label>
                        <span className="text-[10px] text-white/40">{field.type}</span>
                      </div>

                      {field.type === 'boolean' ? (
                        <label className="flex items-center gap-2 text-xs text-white/70">
                          <input
                            type="checkbox"
                            checked={Boolean(configValues[field.key])}
                            onChange={(e) => updateConfigPrimitive(field.key, e.target.checked)}
                            className="accent-premium-accent"
                          />
                          Enabled
                        </label>
                      ) : field.type === 'number' ? (
                        <input
                          type="number"
                          value={Number(configValues[field.key] ?? 0)}
                          onChange={(e) => updateConfigPrimitive(field.key, parseFloat(e.target.value))}
                          className="w-full bg-black/40 border border-white/10 rounded p-2 text-xs outline-none"
                        />
                      ) : field.type === 'string' ? (
                        <input
                          type="text"
                          value={String(configValues[field.key] ?? '')}
                          onChange={(e) => updateConfigPrimitive(field.key, e.target.value)}
                          className="w-full bg-black/40 border border-white/10 rounded p-2 text-xs outline-none"
                        />
                      ) : (
                        <textarea
                          value={configJsonDrafts[field.key] ?? JSON.stringify(configValues[field.key] ?? field.default_value, null, 2)}
                          onChange={(e) => updateConfigJson(field.key, e.target.value)}
                          className="w-full min-h-24 bg-black/40 border border-white/10 rounded p-2 text-xs font-mono outline-none"
                        />
                      )}
                    </div>
                  ))}
                  {displayedConfigFields.length === 0 && (
                    <p className="text-xs text-white/40">該当キーがありません。</p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </main>

      {/* Lightbox for History with Metadata */}
      {
        selectedImage && (
          <div
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={() => setSelectedImage(null)}
          >
            <div className="flex gap-6 max-h-full max-w-7xl w-full" onClick={(e) => e.stopPropagation()}>
              {/* Image */}
              <div className="flex-1 flex items-center justify-center min-w-0">
                <img
                  src={selectedImage.url}
                  className="max-h-[85vh] max-w-full object-contain rounded-lg shadow-2xl"
                  alt="Full preview"
                />
              </div>
              {/* Metadata Panel */}
              <div className="w-80 bg-black/60 rounded-xl p-4 overflow-y-auto max-h-[85vh] flex-shrink-0">
                <h4 className="text-sm font-medium text-white/80 mb-4">Metadata</h4>
                {loadingMetadata ? (
                  <p className="text-xs text-white/40">Loading...</p>
                ) : imageMetadata ? (
                  <div className="space-y-3 text-xs">
                    {imageMetadata.prompt && (
                      <div>
                        <span className="text-white/40 block">Prompt</span>
                        <span className="text-white/80">{imageMetadata.prompt}</span>
                      </div>
                    )}
                    {imageMetadata.negative_prompt && (
                      <div>
                        <span className="text-white/40 block">Negative Prompt</span>
                        <span className="text-white/80">{imageMetadata.negative_prompt}</span>
                      </div>
                    )}
                    {imageMetadata.styles && (
                      <div>
                        <span className="text-white/40 block">Styles</span>
                        <span className="text-white/80">{typeof imageMetadata.styles === 'string' ? imageMetadata.styles : JSON.stringify(imageMetadata.styles)}</span>
                      </div>
                    )}
                    {imageMetadata.base_model && (
                      <div>
                        <span className="text-white/40 block">Model</span>
                        <span className="text-white/80">{imageMetadata.base_model}</span>
                      </div>
                    )}
                    {imageMetadata.seed && (
                      <div>
                        <span className="text-white/40 block">Seed</span>
                        <span className="text-white/80 font-mono">{imageMetadata.seed}</span>
                      </div>
                    )}
                    {imageMetadata.resolution && (
                      <div>
                        <span className="text-white/40 block">Resolution</span>
                        <span className="text-white/80">{imageMetadata.resolution}</span>
                      </div>
                    )}
                    {imageMetadata.sampler && (
                      <div>
                        <span className="text-white/40 block">Sampler</span>
                        <span className="text-white/80">{imageMetadata.sampler}</span>
                      </div>
                    )}
                    {imageMetadata.scheduler && (
                      <div>
                        <span className="text-white/40 block">Scheduler</span>
                        <span className="text-white/80">{imageMetadata.scheduler}</span>
                      </div>
                    )}
                    {imageMetadata.guidance_scale && (
                      <div>
                        <span className="text-white/40 block">Guidance Scale</span>
                        <span className="text-white/80">{imageMetadata.guidance_scale}</span>
                      </div>
                    )}
                    {imageMetadata.performance && (
                      <div>
                        <span className="text-white/40 block">Performance</span>
                        <span className="text-white/80">{imageMetadata.performance}</span>
                      </div>
                    )}
                    <hr className="border-white/10" />
                    <details className="cursor-pointer">
                      <summary className="text-white/40 text-xs">All Metadata (JSON)</summary>
                      <pre className="mt-2 text-[10px] text-white/60 bg-black/30 p-2 rounded overflow-x-auto">
                        {JSON.stringify(imageMetadata, null, 2)}
                      </pre>
                    </details>
                  </div>
                ) : (
                  <p className="text-xs text-white/40">No metadata found</p>
                )}
                {imageMetadata && (
                  <button
                    onClick={applyMetadataToSettings}
                    className="mt-4 w-full py-2 text-xs bg-premium-accent/20 hover:bg-premium-accent/30 border border-premium-accent/40 rounded-lg transition-colors"
                  >
                    この設定を再利用
                  </button>
                )}
                <button
                  onClick={() => setSelectedImage(null)}
                  className="mt-4 w-full py-2 text-xs bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )
      }
    </div >
  );
}

export default App;
