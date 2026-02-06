import { useState, useEffect } from 'react';
import { useStore } from './store/useStore';
import { useApi } from './hooks/useApi';
import { Sparkles, Image as ImageIcon, History, Send, Settings2, ChevronDown, ChevronUp } from 'lucide-react';

const API_HOSTNAME = window.location.hostname;
const API_BASE = `http://${API_HOSTNAME}:8888`;

function App() {
  const { settings, setSettings, activeTasks, availableOptions } = useStore();
  const { fetchSettings, generate } = useApi();
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleGenerate = async () => {
    if (!settings.prompt.trim()) return;
    await generate();
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

        <div className="flex items-center gap-2">
          <div className="px-3 py-1 glass-panel text-xs font-medium text-white/60">
            API: Connected
          </div>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Side: Controls */}
        <section className="lg:col-span-5 space-y-6">
          <div className="glass-card p-6 space-y-6">
            <div className="space-y-4">
              <label className="text-sm font-medium text-white/60 flex items-center gap-2">
                Prompt
              </label>
              <textarea
                value={settings.prompt}
                onChange={(e) => setSettings({ prompt: e.target.value })}
                placeholder="An astronaut riding a horse in space..."
                className="w-full h-24 bg-black/40 border border-white/10 rounded-xl p-4 text-white placeholder:text-white/20 focus:ring-2 focus:ring-premium-accent/50 outline-none transition-all resize-none"
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
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-white/40">Performance</label>
                <select
                  value={settings.performanceSelection}
                  onChange={(e) => setSettings({ performanceSelection: e.target.value })}
                  className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-sm outline-none"
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
                >
                  {availableOptions.aspectRatios.map(opt => (
                    <option key={opt} value={opt}>{opt.replace(/<.*>/, '')}</option>
                  ))}
                </select>
              </div>
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
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs text-white/50">Base Model</label>
                      <select
                        value={settings.baseModelName}
                        onChange={(e) => setSettings({ baseModelName: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
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
                      >
                        <option value="None">None</option>
                        {availableOptions.models.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs text-white/50">Sampler</label>
                      <select
                        value={settings.samplerName}
                        onChange={(e) => setSettings({ samplerName: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                      >
                        <option value="dpmpp_2m_sde_gpu">dpmpp_2m_sde_gpu</option>
                        <option value="dpmpp_2m_sde">dpmpp_2m_sde</option>
                        <option value="dpmpp_sde">dpmpp_sde</option>
                        <option value="euler">euler</option>
                        <option value="euler_ancestral">euler_ancestral</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs text-white/50">Scheduler</label>
                      <select
                        value={settings.schedulerName}
                        onChange={(e) => setSettings({ schedulerName: e.target.value })}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-2 text-xs outline-none"
                      >
                        <option value="karras">karras</option>
                        <option value="normal">normal</option>
                        <option value="simple">simple</option>
                        <option value="sgm_uniform">sgm_uniform</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleGenerate}
              className="w-full premium-button flex items-center justify-center gap-2 py-4"
            >
              <Send className="w-5 h-5" />
              Generate
            </button>
          </div>

          {/* Active Tasks / History (simplified) */}
          <div className="glass-card p-6">
            <h3 className="text-sm font-medium text-white/60 mb-4 flex items-center gap-2">
              <History className="w-4 h-4" />
              Active Tasks
            </h3>
            <div className="space-y-4">
              {Object.entries(activeTasks).filter(([_, t]) => !(t as any).finished).map(([id, task]) => (
                <div key={id} className="glass-panel p-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-white/40">{(task as any).status}</span>
                    <span className="text-premium-accent font-medium">{(task as any).percentage}%</span>
                  </div>
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-premium-accent transition-all duration-300"
                      style={{ width: `${(task as any).percentage}%` }}
                    />
                  </div>
                </div>
              ))}
              {Object.values(activeTasks).filter((t) => !t.finished).length === 0 && (
                <p className="text-white/20 text-xs text-center py-4">No active tasks</p>
              )}
            </div>
          </div>
        </section>

        {/* Right Side: Preview & Gallery */}
        <section className="lg:col-span-7 space-y-6">
          <div className="glass-card min-h-[500px] flex items-center justify-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-premium-accent/5 to-transparent pointer-events-none" />

            {/* Display first result of the most recent task for now */}
            {Object.values(activeTasks).at(-1)?.results.length ? (
              <img
                src={`${API_BASE}/images/${Object.values(activeTasks).at(-1)?.results[0]}`}
                className="max-h-full max-w-full object-contain z-10 p-4"
                alt="Generated"
              />
            ) : (
              <div className="text-center space-y-3 p-8 text-white/20">
                <ImageIcon className="w-12 h-12 mx-auto" strokeWidth={1} />
                <p className="text-sm">Generated images will appear here</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-4 gap-4">
            {/* Gallery placeholder */}
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="glass-card aspect-square bg-white/5 border-dashed border-white/10" />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
