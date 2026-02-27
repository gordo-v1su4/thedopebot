'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Messages } from './messages.js';
import { ChatInput } from './chat-input.js';
import { ChatHeader } from './chat-header.js';
import { Greeting } from './greeting.js';
import { getOpenRouterModels } from '../actions.js';

export function Chat({ chatId, initialMessages = [] }) {
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const [modelCatalog, setModelCatalog] = useState(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelError, setModelError] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const hasNavigated = useRef(false);

  const loadModelCatalog = useCallback(async (forceRefresh = false) => {
    try {
      setModelsLoading(true);
      const catalog = await getOpenRouterModels({ forceRefresh });
      setModelCatalog(catalog);
      setModelError(catalog?.error || '');

      if (!catalog?.enabled || !Array.isArray(catalog.models) || catalog.models.length === 0) {
        setSelectedModel('');
        return;
      }

      const availableModels = new Set(catalog.models.map((m) => m.id));
      const saved = typeof window !== 'undefined' ? localStorage.getItem('thepopebot:selected-model') : null;

      let nextModel = '';
      if (saved && availableModels.has(saved)) {
        nextModel = saved;
      } else if (catalog.recommendedModel && availableModels.has(catalog.recommendedModel)) {
        nextModel = catalog.recommendedModel;
      } else if (catalog.defaultModel && availableModels.has(catalog.defaultModel)) {
        nextModel = catalog.defaultModel;
      } else {
        nextModel = catalog.models[0].id;
      }

      setSelectedModel(nextModel);
      if (typeof window !== 'undefined') {
        localStorage.setItem('thepopebot:selected-model', nextModel);
      }
    } catch (err) {
      setModelError(err.message || 'Failed to load OpenRouter models.');
      setModelCatalog({ enabled: false, models: [] });
      setSelectedModel('');
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModelCatalog(false);
  }, [loadModelCatalog]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/stream/chat',
        body:
          modelCatalog?.enabled && selectedModel
            ? { chatId, llmProvider: modelCatalog.provider || 'openai', llmModel: selectedModel }
            : { chatId },
      }),
    [chatId, modelCatalog?.enabled, modelCatalog?.provider, selectedModel]
  );

  const {
    messages,
    status,
    stop,
    error,
    sendMessage,
    regenerate,
    setMessages,
  } = useChat({
    id: chatId,
    messages: initialMessages,
    transport,
    onError: (err) => console.error('Chat error:', err),
  });

  // After first message sent, update URL and notify sidebar
  useEffect(() => {
    if (!hasNavigated.current && messages.length >= 1 && status !== 'ready' && window.location.pathname !== `/chat/${chatId}`) {
      hasNavigated.current = true;
      window.history.replaceState({}, '', `/chat/${chatId}`);
      window.dispatchEvent(new Event('chatsupdated'));
      // Dispatch again after delay to pick up async title update
      setTimeout(() => window.dispatchEvent(new Event('chatsupdated')), 5000);
    }
  }, [messages.length, status, chatId]);

  const handleSend = () => {
    if (!input.trim() && files.length === 0) return;
    const text = input;
    const currentFiles = files;
    setInput('');
    setFiles([]);

    if (currentFiles.length === 0) {
      sendMessage({ text });
    } else {
      // Build FileUIPart[] from pre-read data URLs (File[] isn't a valid type)
      const fileParts = currentFiles.map((f) => ({
        type: 'file',
        mediaType: f.file.type || 'text/plain',
        url: f.previewUrl,
        filename: f.file.name,
      }));
      sendMessage({ text: text || undefined, files: fileParts });
    }
  };

  const handleRetry = useCallback((message) => {
    if (message.role === 'assistant') {
      regenerate({ messageId: message.id });
    } else {
      // User message — find the next assistant message and regenerate it
      const idx = messages.findIndex((m) => m.id === message.id);
      const nextAssistant = messages.slice(idx + 1).find((m) => m.role === 'assistant');
      if (nextAssistant) {
        regenerate({ messageId: nextAssistant.id });
      } else {
        // No assistant response yet — extract text and resend
        const text =
          message.parts
            ?.filter((p) => p.type === 'text')
            .map((p) => p.text)
            .join('\n') ||
          message.content ||
          '';
        if (text.trim()) {
          sendMessage({ text });
        }
      }
    }
  }, [messages, regenerate, sendMessage]);

  const handleEdit = useCallback((message, newText) => {
    const idx = messages.findIndex((m) => m.id === message.id);
    if (idx === -1) return;
    // Truncate conversation to before this message, then send edited text
    setMessages(messages.slice(0, idx));
    sendMessage({ text: newText });
  }, [messages, setMessages, sendMessage]);

  const handleSelectModel = useCallback((modelId) => {
    setSelectedModel(modelId);
    if (typeof window !== 'undefined') {
      localStorage.setItem('thepopebot:selected-model', modelId);
    }
  }, []);

  const activeModel = useMemo(() => {
    if (modelCatalog?.enabled && selectedModel) return selectedModel;
    if (modelCatalog?.defaultModel) return modelCatalog.defaultModel;
    return '';
  }, [modelCatalog?.enabled, modelCatalog?.defaultModel, selectedModel]);

  return (
    <div className="flex h-svh flex-col">
      <ChatHeader
        chatId={chatId}
        modelPicker={{
          enabled: Boolean(modelCatalog?.enabled),
          loading: modelsLoading,
          models: modelCatalog?.models || [],
          selectedModel,
          onSelectModel: handleSelectModel,
          onRefresh: () => loadModelCatalog(true),
        }}
      />
      {messages.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 md:px-6">
          <div className="w-full max-w-4xl">
            <Greeting />
            {modelError && (
              <div className="mt-3 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-300">
                {modelError}
              </div>
            )}
            {error && (
              <div className="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {error.message || 'Something went wrong. Please try again.'}
              </div>
            )}
            <div className="mt-4">
              <ChatInput
                input={input}
                setInput={setInput}
                onSubmit={handleSend}
                status={status}
                stop={stop}
                files={files}
                setFiles={setFiles}
                activeModel={activeModel}
              />
            </div>
          </div>
        </div>
      ) : (
        <>
          <Messages
            messages={messages}
            status={status}
            onRetry={handleRetry}
            onEdit={handleEdit}
            activeModel={activeModel}
          />
          {modelError && (
            <div className="mx-auto w-full max-w-4xl px-2 md:px-4">
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-2 text-xs text-yellow-300">
                {modelError}
              </div>
            </div>
          )}
          {error && (
            <div className="mx-auto w-full max-w-4xl px-2 md:px-4">
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                {error.message || 'Something went wrong. Please try again.'}
              </div>
            </div>
          )}
          <ChatInput
            input={input}
            setInput={setInput}
            onSubmit={handleSend}
            status={status}
            stop={stop}
            files={files}
            setFiles={setFiles}
            activeModel={activeModel}
          />
        </>
      )}
    </div>
  );
}
