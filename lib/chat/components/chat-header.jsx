'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { SidebarTrigger } from './ui/sidebar.js';

const CAPABILITY_DEFS = [
  {
    key: 'supportsVision',
    short: 'VIS',
    label: 'Vision input',
    className: 'border-sky-400/40 bg-sky-500/10 text-sky-300',
  },
  {
    key: 'supportsVideo',
    short: 'VID',
    label: 'Video support',
    className: 'border-cyan-400/40 bg-cyan-500/10 text-cyan-300',
  },
  {
    key: 'supportsImageGeneration',
    short: 'IMG',
    label: 'Image generation',
    className: 'border-orange-400/40 bg-orange-500/10 text-orange-300',
  },
  {
    key: 'supportsReasoning',
    short: 'THINK',
    label: 'Reasoning',
    className: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
  },
  {
    key: 'supportsTools',
    short: 'TOOLS',
    label: 'Tool calls',
    className: 'border-violet-400/40 bg-violet-500/10 text-violet-300',
  },
];

function formatPrice(model) {
  if (model?.isFree) return 'FREE';
  if (typeof model?.totalPerM !== 'number' || !Number.isFinite(model.totalPerM)) return 'N/A';
  if (model.totalPerM === 0) return 'FREE';
  return `$${model.totalPerM.toFixed(3)}/1M`;
}

function formatContext(model) {
  const value = Number(model?.contextLength || 0);
  if (!value) return null;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M ctx`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k ctx`;
  return `${value} ctx`;
}

function CapabilityBadge({ short, label, className }) {
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${className}`}
      title={label}
    >
      {short}
    </span>
  );
}

function CapabilityBadges({ model }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {CAPABILITY_DEFS.filter((def) => model?.[def.key]).map((def) => (
        <CapabilityBadge key={def.key} short={def.short} label={def.label} className={def.className} />
      ))}
      <span
        className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${
          model?.isFree
            ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300'
            : 'border-zinc-500/50 bg-zinc-500/10 text-zinc-300'
        }`}
      >
        {formatPrice(model)}
      </span>
    </div>
  );
}

function ModelLegend() {
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 p-2">
      {CAPABILITY_DEFS.map((def) => (
        <CapabilityBadge key={def.key} short={def.short} label={def.label} className={def.className} />
      ))}
      <span className="inline-flex items-center rounded border border-emerald-400/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
        FREE
      </span>
      <span className="inline-flex items-center rounded border border-zinc-500/50 bg-zinc-500/10 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
        $/1M
      </span>
    </div>
  );
}

function FilterChip({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center rounded border px-2 py-1 text-[11px] font-medium transition-colors ${
        active
          ? 'border-foreground/40 bg-foreground/10 text-foreground'
          : 'border-border bg-background text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

export function ChatHeader({ chatId, modelPicker }) {
  const enabled = Boolean(modelPicker?.enabled);
  const isLoading = Boolean(modelPicker?.loading);
  const models = Array.isArray(modelPicker?.models) ? modelPicker.models : [];
  const selectedModel = modelPicker?.selectedModel || '';
  const selected = models.find((m) => m.id === selectedModel) || null;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeFilters, setActiveFilters] = useState(() => ({
    freeOnly: false,
    paidOnly: false,
    ...Object.fromEntries(CAPABILITY_DEFS.map((def) => [def.key, false])),
  }));
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const filteredModels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return models.filter((model) => {
      if (needle) {
        const matchesQuery =
          model.id.toLowerCase().includes(needle) ||
          String(model.name || '').toLowerCase().includes(needle) ||
          String(model.provider || '').toLowerCase().includes(needle) ||
          String(model.description || '').toLowerCase().includes(needle);
        if (!matchesQuery) return false;
      }

      if (activeFilters.freeOnly && !model.isFree) return false;
      if (activeFilters.paidOnly && model.isFree) return false;
      for (const def of CAPABILITY_DEFS) {
        if (activeFilters[def.key] && !model[def.key]) return false;
      }
      return true;
    });
  }, [models, query, activeFilters]);

  const toggleFilter = (key) => {
    setActiveFilters((prev) => {
      if (key === 'freeOnly') {
        return { ...prev, freeOnly: !prev.freeOnly, paidOnly: false };
      }
      if (key === 'paidOnly') {
        return { ...prev, paidOnly: !prev.paidOnly, freeOnly: false };
      }
      return { ...prev, [key]: !prev[key] };
    });
  };

  const clearFilters = () => {
    setActiveFilters({
      freeOnly: false,
      paidOnly: false,
      ...Object.fromEntries(CAPABILITY_DEFS.map((def) => [def.key, false])),
    });
  };

  const anyFilterActive = useMemo(() => {
    return Object.values(activeFilters).some(Boolean);
  }, [activeFilters]);

  const selectModel = (modelId) => {
    modelPicker?.onSelectModel?.(modelId);
    setOpen(false);
  };

  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 bg-background px-2 py-1.5 md:px-2">
      <div className="md:hidden">
        <SidebarTrigger />
      </div>

      {enabled && (
        <div ref={containerRef} className="ml-auto w-full max-w-[900px]">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="h-8 min-w-0 max-w-[70vw] rounded-md border border-border bg-background px-2 text-left text-xs text-foreground hover:bg-muted/40 md:max-w-[640px]"
              title="Select model"
            >
              <span className="block truncate">
                {selected ? selected.id : isLoading ? 'Loading OpenRouter models…' : 'Select model'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => modelPicker?.onRefresh?.()}
              className="h-8 shrink-0 rounded-md border border-border px-2 text-xs text-muted-foreground hover:text-foreground"
              title="Refresh OpenRouter model list"
            >
              Refresh
            </button>
          </div>

          {selected && (
            <div className="mt-1.5 flex items-center justify-end gap-2">
              <CapabilityBadges model={selected} />
              {formatContext(selected) && (
                <span className="text-[10px] text-muted-foreground">{formatContext(selected)}</span>
              )}
            </div>
          )}

          {open && (
            <div className="absolute right-2 top-12 z-50 w-[min(96vw,760px)] rounded-lg border border-border bg-background/95 p-3 shadow-2xl backdrop-blur">
              <div className="flex items-center gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models..."
                  className="h-9 w-full rounded-md border border-border bg-muted/20 px-3 text-sm outline-none focus:border-ring"
                />
                <button
                  type="button"
                  onClick={() => modelPicker?.onRefresh?.()}
                  className="h-9 shrink-0 rounded-md border border-border px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  Reload
                </button>
              </div>

              <div className="mt-2">
                <ModelLegend />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-md border border-border/60 bg-muted/20 p-2">
                {CAPABILITY_DEFS.map((def) => (
                  <FilterChip
                    key={def.key}
                    active={activeFilters[def.key]}
                    label={def.short}
                    onClick={() => toggleFilter(def.key)}
                  />
                ))}
                <FilterChip active={activeFilters.freeOnly} label="FREE" onClick={() => toggleFilter('freeOnly')} />
                <FilterChip active={activeFilters.paidOnly} label="PAID" onClick={() => toggleFilter('paidOnly')} />
                {anyFilterActive && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>

              <div className="mt-2 max-h-[56vh] overflow-y-auto rounded-md border border-border/60">
                {isLoading && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Loading models…</div>
                )}
                {!isLoading && filteredModels.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">No models match your search.</div>
                )}
                {!isLoading &&
                  filteredModels.map((model) => (
                    <button
                      type="button"
                      key={model.id}
                      onClick={() => selectModel(model.id)}
                      className={`w-full border-b border-border/50 px-3 py-2 text-left hover:bg-muted/30 ${
                        model.id === selectedModel ? 'bg-muted/40' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">{model.id}</div>
                          {model.description && (
                            <div className="mt-0.5 max-h-8 overflow-hidden text-xs text-muted-foreground">{model.description}</div>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <CapabilityBadges model={model} />
                          {formatContext(model) && (
                            <div className="mt-1 text-[10px] text-muted-foreground">{formatContext(model)}</div>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
