import { NextRequest, NextResponse } from "next/server";

import { isDemoModeEnabled } from "@/lib/auth/routes";

interface ChatRequestBody {
  message: string;
  companyName: string;
  companyDomain: string;
  history?: Array<{ role: string; content: string }>;
}

const DEMO_KNOWLEDGE: Record<string, Record<string, string>> = {
  dropbox: {
    pricing:
      "Dropbox offers several plans: Basic (free, 2GB), Plus ($11.99/mo, 2TB), Professional ($19.99/mo, 3TB), and Business plans starting at $15/user/mo. They recently introduced Dash AI as an add-on for enterprise customers at $10/user/mo.",
    news: "Recent developments include the launch of Dash AI (an AI-powered universal search tool), expansion of their enterprise compliance certifications, aggressive hiring in ML/AI roles, and a partnership with NVIDIA for GPU-accelerated file processing.",
    competitive:
      "Dropbox competes with Google Drive, OneDrive, and Box in cloud storage. Their differentiation strategy is pivoting toward AI-powered content intelligence via Dash AI, targeting enterprise users who need cross-platform search and automated workflows.",
    general:
      "Dropbox (dropbox.com) is a cloud storage and collaboration platform founded in 2007. They serve over 700M users. Their recent strategy focuses on AI integration through Dash AI, moving from simple file sync to an intelligent content platform.",
  },
  onedrive: {
    pricing:
      "OneDrive offers 5GB free, Microsoft 365 Personal ($6.99/mo, 1TB), Family ($9.99/mo, 6TB), and Business plans starting at $5/user/mo (Plan 1, 1TB). E5 enterprise plans include advanced compliance and Copilot AI features.",
    news: "Microsoft is integrating Copilot AI deeply into OneDrive, enabling natural language file search, automatic summarization, and content generation. New compliance features target government (GCC High, FedRAMP) and healthcare (HIPAA) markets.",
    competitive:
      "OneDrive's competitive advantage is deep integration with Microsoft 365, Teams, and SharePoint. The Copilot AI integration gives them a unique position for enterprise customers already in the Microsoft ecosystem.",
    general:
      "OneDrive is Microsoft's cloud storage service, integrated into Windows and Microsoft 365. With 400M+ users, it's the second-largest cloud storage provider. Their strategy focuses on enterprise AI through Copilot and Microsoft Graph APIs.",
  },
  "google-drive": {
    pricing:
      "Google Drive offers 15GB free (shared with Gmail/Photos), Google One plans at $1.99/mo (100GB), $2.99/mo (200GB), $9.99/mo (2TB), and Workspace Business plans starting at $7.20/user/mo with pooled storage.",
    news: "Google is embedding Gemini AI throughout Drive and Workspace. New features include AI-powered file organization, natural language search across all documents, and Duet AI for content creation directly within Docs, Sheets, and Slides.",
    competitive:
      "Google Drive's strength is integration with the Workspace suite and Gemini AI. They lead in education (Google Workspace for Education) and compete aggressively on price. Their AI-first approach targets creative and knowledge workers.",
    general:
      "Google Drive is Google's cloud storage platform, part of Google Workspace. Used by 3B+ people worldwide, it's the largest cloud storage service. Current strategy emphasizes Gemini AI integration for intelligent document management and collaboration.",
  },
};

function generateDemoReply(message: string, companyName: string): string {
  const lower = message.toLowerCase();
  const companyKey = companyName.toLowerCase().replace(/\s+/g, "-");
  const fallback = DEMO_KNOWLEDGE["dropbox"] as Record<string, string>;
  const knowledge: Record<string, string> = (DEMO_KNOWLEDGE[companyKey] as Record<string, string> | undefined) ?? fallback;

  if (lower.includes("pric") || lower.includes("cost") || lower.includes("plan")) {
    return knowledge["pricing"] ?? "";
  }
  if (lower.includes("news") || lower.includes("recent") || lower.includes("latest") || lower.includes("update")) {
    return knowledge["news"] ?? "";
  }
  if (lower.includes("compet") || lower.includes("landscape") || lower.includes("rival") || lower.includes("vs")) {
    return knowledge["competitive"] ?? "";
  }
  if (lower.includes("what is") || lower.includes("tell me about") || lower.includes("overview")) {
    return knowledge["general"] ?? "";
  }
  if (lower.includes("risk") || lower.includes("threat")) {
    return `Based on our analysis, ${companyName}'s main risks include: aggressive AI feature expansion that could commoditize adjacent services, potential pricing changes that signal market repositioning, and enterprise compliance investments that indicate upmarket targeting. Our confidence in the "moving upmarket" strategy prediction is currently moderate-to-high.`;
  }
  if (lower.includes("recommend") || lower.includes("should") || lower.includes("action")) {
    return `Recommended actions for monitoring ${companyName}: 1) Track pricing page changes weekly for plan restructuring signals. 2) Monitor their job postings for AI/ML hiring patterns. 3) Watch developer documentation for new API capabilities. 4) Set alerts for security/compliance certification announcements. 5) Compare feature releases against your own product roadmap.`;
  }

  return `${knowledge["general"] ?? ""}\n\nIs there something specific about ${companyName} you'd like to know? I can help with pricing analysis, recent news, competitive positioning, risk assessment, or recommended monitoring actions.`;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ChatRequestBody;
    const { message, companyName } = body;

    if (!message || !companyName) {
      return NextResponse.json(
        { error: "Missing required fields: message, companyName" },
        { status: 400 },
      );
    }

    if (isDemoModeEnabled(process.env.DEMO_MODE)) {
      const reply = generateDemoReply(message, companyName);
      return NextResponse.json({ reply });
    }

    // In production mode, this would call the InsForge AI Gateway or OpenRouter.
    // For now, fall back to the demo knowledge base.
    const reply = generateDemoReply(message, companyName);
    return NextResponse.json({ reply });
  } catch {
    return NextResponse.json(
      { error: "Failed to process chat request" },
      { status: 500 },
    );
  }
}
