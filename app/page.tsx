import Link from "next/link";

import { ContentFallback } from "@/components/content-fallback";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

const PRODUCT_NAME = "SignalVault";
const TAGLINE = "Turn public web changes into auditable market intelligence.";

/**
 * The four integration platforms shown on the architecture strip.
 * Order is significant and asserted by tests (Requirement 2.6):
 * Apify, Box, Mastra, InsForge.
 */
const INTEGRATIONS: { name: string; role: string }[] = [
  { name: "Apify", role: "Web scraping & snapshots" },
  { name: "Box", role: "Governed evidence storage" },
  { name: "Mastra", role: "AI workflow orchestration" },
  { name: "InsForge", role: "Postgres, auth & realtime" },
];

/** Sample intelligence brief previewed on the landing page (Requirement 2.7). */
const EXAMPLE_BRIEF = {
  company: "Acme AI",
  strategyPrediction: "Moving upmarket",
  confidence: 82,
  riskScore: 74,
  summary:
    "Pricing page dropped its free tier, the trust center added SOC 2 and HIPAA, and careers opened enterprise sales roles. The signals point to a deliberate shift toward larger, security-conscious buyers.",
};

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center bg-background px-6 py-16">
      <div className="flex w-full max-w-5xl flex-col items-center gap-16">
        {/* Hero: product name + tagline + dashboard navigation */}
        <section className="flex flex-col items-center gap-6 text-center">
          <ContentFallback
            as="h1"
            placeholder="Product name unavailable"
            className="text-5xl font-bold tracking-tight sm:text-6xl"
          >
            {PRODUCT_NAME}
          </ContentFallback>

          <ContentFallback
            as="p"
            placeholder="Tagline unavailable"
            className="max-w-2xl text-lg text-muted-foreground sm:text-xl"
          >
            {TAGLINE}
          </ContentFallback>

          <Link
            href="/companies"
            aria-label="Open the dashboard"
            className={cn(buttonVariants({ size: "lg" }), "mt-2")}
          >
            Open the dashboard
          </Link>
        </section>

        {/* Architecture strip: integration platforms in fixed order */}
        <section className="w-full" aria-labelledby="integrations-heading">
          <h2
            id="integrations-heading"
            className="mb-6 text-center text-sm font-medium uppercase tracking-widest text-muted-foreground"
          >
            Built on
          </h2>
          <ol className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {INTEGRATIONS.map((integration, index) => (
              <li key={integration.name}>
                <Card className="h-full">
                  <CardContent className="flex flex-col items-center gap-1 p-6 text-center">
                    <span className="text-xs text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="text-lg font-semibold">
                      {integration.name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {integration.role}
                    </span>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ol>
        </section>

        {/* Example output: sample intelligence brief with verdict + risk */}
        <section className="w-full" aria-labelledby="example-brief-heading">
          <h2
            id="example-brief-heading"
            className="mb-6 text-center text-sm font-medium uppercase tracking-widest text-muted-foreground"
          >
            Example output
          </h2>
          <Card className="mx-auto w-full max-w-2xl">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>{EXAMPLE_BRIEF.company}</CardTitle>
                  <CardDescription>Intelligence brief preview</CardDescription>
                </div>
                <Badge variant="destructive">
                  Risk score {EXAMPLE_BRIEF.riskScore}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Strategy prediction
                </span>
                <Badge>{EXAMPLE_BRIEF.strategyPrediction}</Badge>
                <span className="text-sm text-muted-foreground">
                  Confidence {EXAMPLE_BRIEF.confidence}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {EXAMPLE_BRIEF.summary}
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
