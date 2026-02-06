import { useState, useEffect } from 'react';
import { useStore } from './store/useStore';
import { useApi } from './hooks/useApi';
import { Sparkles, History, Send, Settings2, ChevronDown, ChevronUp, ImagePlus, Square, Search } from 'lucide-react';

const API_HOSTNAME = window.location.hostname;
const API_BASE = `http://${API_HOSTNAME}:8888`;

function App() {
  const { settings, setSettings, activeTasks, availableOptions } = useStore();
  const { fetchSettings, generate, loadPreset, stopGeneration, fetchHistory } = useApi();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState<'generate' | 'history'>('generate');
  const [historyImages, setHistoryImages] = useState<any[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (activeTab === 'history') {
      fetchHistory().then(setHistoryImages);
    }
  }, [activeTab, fetchHistory]);

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
                    type="range" min="1" max="32" step="1"
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
                      {/* Sampler settings ... */}
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
        ) : (
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
                      onClick={() => setSelectedImage(`${API_BASE}/images/${img.path}`)}
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
        )}
      </main>

      {/* Lightbox for History */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex items-center justify-center p-8 animate-in fade-in duration-200"
          onClick={() => setSelectedImage(null)}
        >
          <img
            src={selectedImage}
            className="max-h-full max-w-full object-contain rounded-lg shadow-2xl"
            alt="Full preview"
          />
        </div>
      )}
    </div>
  );
}

export default App;
