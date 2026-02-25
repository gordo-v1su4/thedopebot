'use client';

import { SidebarTrigger } from './ui/sidebar.js';

function formatPrice(model) {
  if (model?.isFree) return 'free';
  if (typeof model?.totalPerM !== 'number' || !Number.isFinite(model.totalPerM)) return 'n/a';
  if (model.totalPerM === 0) return 'free';
  return `$${model.totalPerM.toFixed(3)}/1M`;
}

export function ChatHeader({ chatId, modelPicker }) {
  const enabled = Boolean(modelPicker?.enabled);
  const isLoading = Boolean(modelPicker?.loading);
  const models = Array.isArray(modelPicker?.models) ? modelPicker.models : [];
  const freeModels = models.filter((m) => m.isFree);
  const paidModels = models.filter((m) => !m.isFree);

  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 bg-background px-2 py-1.5 md:px-2">
      {/* Mobile-only: open sidebar sheet */}
      <div className="md:hidden">
        <SidebarTrigger />
      </div>

      {enabled && (
        <div className="ml-auto flex max-w-[70vw] items-center gap-2 md:max-w-[640px]">
          <select
            value={modelPicker?.selectedModel || ''}
            onChange={(e) => modelPicker?.onSelectModel?.(e.target.value)}
            disabled={isLoading || models.length === 0}
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            title="Select chat model"
          >
            {isLoading && <option value="">Loading OpenRouter models…</option>}
            {!isLoading && models.length === 0 && <option value="">No models found</option>}
            {!isLoading && freeModels.length > 0 && (
              <optgroup label="Free models">
                {freeModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id} ({formatPrice(model)})
                  </option>
                ))}
              </optgroup>
            )}
            {!isLoading && paidModels.length > 0 && (
              <optgroup label="Paid models">
                {paidModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id} ({formatPrice(model)})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button
            type="button"
            onClick={() => modelPicker?.onRefresh?.()}
            className="h-8 shrink-0 rounded-md border border-border px-2 text-xs text-muted-foreground hover:text-foreground"
            title="Refresh OpenRouter model list"
          >
            Refresh
          </button>
        </div>
      )}
    </header>
  );
}
