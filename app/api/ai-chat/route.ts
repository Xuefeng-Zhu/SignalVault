import { NextRequest, NextResponse } from "next/server";
import { requireActiveWorkspace } from "@/lib/api/workspace";
import { getModelClient } from "@/lib/adapters/factory";

interface ChatRequestBody {
  message: string;
  companyName: string;
  companyDomain: string;
  history?: Array<{ role: string; content: string }>;
}

export async function POST(request: NextRequest) {
  // Require authenticated user
  const guard = await requireActiveWorkspace();
  if (!guard.ok) {
    return guard.response;
  }

  try {
    const body = (await request.json()) as ChatRequestBody;
    const { message, companyName } = body;

    if (!message || !companyName) {
      return NextResponse.json(
        { error: "Missing required fields: message, companyName" },
        { status: 400 },
      );
    }

    const model = getModelClient();
    const systemPrompt = [
      "You are a competitive intelligence analyst working within SignalVault.",
      "Your job is to answer questions about monitored companies using data from SignalVault's scans,",
      "including pricing changes, product updates, hiring signals, and strategic moves.",
      `The user is asking about: ${companyName} (${body.companyDomain ?? "unknown domain"}).`,
      "Be concise, data-driven, and actionable. If you lack specific data, say so clearly.",
    ].join(" ");

    const messages = (body.history ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
    messages.push({ role: "user" as const, content: message });

    const result = await model.complete({
      system: systemPrompt,
      messages,
      responseSchemaName: "ai-chat",
      timeoutMs: 30_000,
    });

    return NextResponse.json({ reply: result.text });
  } catch {
    return NextResponse.json(
      { error: "Failed to process chat request" },
      { status: 500 },
    );
  }
}
