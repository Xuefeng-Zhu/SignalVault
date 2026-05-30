"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface AiChatBubbleProps {
  companyName: string;
  companyDomain: string;
}

export function AiChatBubble({ companyName, companyDomain }: AiChatBubbleProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMessage: Message = {
        id: `msg-${Date.now()}-user`,
        role: "user",
        content: text.trim(),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setIsLoading(true);

      try {
        const res = await fetch("/api/ai-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text.trim(),
            companyName,
            companyDomain,
            history: messages.slice(-6).map((m) => ({ role: m.role, content: m.content })),
          }),
        });

        const data = await res.json();
        const assistantMessage: Message = {
          id: `msg-${Date.now()}-assistant`,
          role: "assistant",
          content: data.reply ?? "Sorry, I could not generate a response.",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } catch {
        const errorMessage: Message = {
          id: `msg-${Date.now()}-error`,
          role: "assistant",
          content: "Network error. Please try again.",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [companyName, companyDomain, messages, isLoading],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        className={cn(
          "fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-200 hover:scale-105",
          isOpen
            ? "bg-surface-container-high text-on-surface rotate-0"
            : "bg-primary text-on-primary shadow-[0_16px_30px_-10px_rgba(66,18,222,0.5)]",
        )}
        aria-label={isOpen ? "Close AI chat" : "Open AI chat"}
      >
        <span className="material-symbols-outlined text-[24px]">
          {isOpen ? "close" : "chat"}
        </span>
      </button>

      {/* Chat panel */}
      <div
        className={cn(
          "fixed bottom-24 right-6 z-50 flex w-[380px] flex-col overflow-hidden rounded-[24px] border border-outline-variant bg-surface-container-lowest shadow-[0_24px_60px_-20px_rgba(21,27,45,0.35)] transition-all duration-300",
          isOpen
            ? "pointer-events-auto h-[520px] scale-100 opacity-100"
            : "pointer-events-none h-0 scale-95 opacity-0",
        )}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-outline-variant bg-surface-container-low px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
            <span className="material-symbols-outlined text-[18px] text-primary">smart_toy</span>
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-on-surface">AI Research Assistant</p>
            <p className="text-xs text-on-surface-variant">Ask about {companyName}</p>
          </div>
          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
            BETA
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <span className="material-symbols-outlined text-[36px] text-on-surface-variant/40">forum</span>
              <p className="text-sm text-on-surface-variant">
                Ask me anything about <strong>{companyName}</strong>
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {[
                  `What is ${companyName}'s pricing model?`,
                  `Recent ${companyName} news?`,
                  "Competitive landscape",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(suggestion)}
                    className="rounded-full border border-outline-variant bg-surface-container-low px-3 py-1.5 text-xs text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    msg.role === "user"
                      ? "ml-auto bg-primary text-on-primary"
                      : "mr-auto bg-surface-container-low text-on-surface",
                  )}
                >
                  {msg.content}
                </div>
              ))}
              {isLoading && (
                <div className="mr-auto flex max-w-[85%] items-center gap-2 rounded-2xl bg-surface-container-low px-4 py-3 text-sm text-on-surface-variant">
                  <span className="inline-flex gap-1">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-variant/50 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-variant/50 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-on-surface-variant/50 [animation-delay:300ms]" />
                  </span>
                  <span>Thinking...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-outline-variant bg-surface-container-low p-3">
          <div className="flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-4 py-1">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Ask about ${companyName}...`}
              disabled={isLoading}
              className="flex-1 border-none bg-transparent py-2 text-sm text-on-surface outline-none placeholder:text-on-surface-variant/60 disabled:opacity-50"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isLoading}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-on-primary transition-opacity disabled:opacity-30"
              aria-label="Send message"
            >
              <span className="material-symbols-outlined text-[18px]">send</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
