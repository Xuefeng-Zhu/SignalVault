import Link from "next/link";

import { ContentFallback } from "@/components/content-fallback";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRODUCT_NAME = "SignalVault";
const TAGLINE = "Turn public web changes into auditable market intelligence.";

const INTEGRATIONS: { name: string; role: string }[] = [
  { name: "Apify", role: "Web scraping & snapshots" },
  { name: "Box", role: "Governed evidence storage" },
  { name: "Mastra", role: "AI workflow orchestration" },
  { name: "InsForge", role: "Postgres, auth & realtime" },
];

const EXAMPLE_BRIEF = {
  company: "Acme AI",
  strategyPrediction: "Moving upmarket",
  confidence: 82,
  riskScore: 74,
  summary:
    "Pricing page dropped its free tier, the trust center added SOC 2 and HIPAA, and careers opened enterprise sales roles. The signals point to a deliberate shift toward larger, security-conscious buyers.",
};

const FEATURE_TITLES = ["Capture", "Store", "Reason", "Deliver"] as const;
const FEATURE_ICONS = ["radar", "inventory_2", "gavel", "hub"] as const;

export default function Home() {
  return (
    <main className="min-h-screen bg-background px-6 py-6 text-on-surface md:px-10 lg:px-12">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="glass-card flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-on-primary shadow-[0_16px_32px_-20px_rgba(66,18,222,0.8)]">
              <span className="material-symbols-outlined text-[20px]">shield_lock</span>
            </div>
            <div>
              <p className="font-page-title text-[20px] font-bold tracking-[-0.03em]">
                {PRODUCT_NAME}
              </p>
              <p className="font-label-caps text-label-caps uppercase tracking-[0.18em] text-on-surface-variant">
                Market Intelligence
              </p>
            </div>
          </div>

          <Link
            href="/companies"
            className={cn(buttonVariants({ variant: "outline" }), "rounded-lg px-4")}
          >
            Get started
          </Link>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="glass-card overflow-hidden px-8 py-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/10 bg-primary/10 px-4 py-2 text-label-caps uppercase tracking-[0.08em] text-primary">
              <span className="material-symbols-outlined text-[16px]">policy</span>
              Auditable intelligence for modern GTM teams
            </div>

            <div className="mt-6 max-w-3xl space-y-5">
              <ContentFallback
                as="h1"
                placeholder="Product name unavailable"
                className="sr-only"
              >
                {PRODUCT_NAME}
              </ContentFallback>

              <ContentFallback
                as="p"
                placeholder="Tagline unavailable"
                className="max-w-3xl font-page-title text-[clamp(3rem,6vw,5.25rem)] font-bold leading-[0.95] tracking-[-0.05em] text-on-surface"
              >
                {TAGLINE}
              </ContentFallback>

              <ContentFallback
                as="p"
                placeholder="Tagline unavailable"
                className="max-w-2xl text-[17px] leading-7 text-on-surface-variant"
              >
                Track public positioning, pricing, trust, and product changes with a governed evidence trail your team can defend.
              </ContentFallback>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/companies"
                className={cn(buttonVariants({ variant: "default", size: "lg" }), "rounded-lg px-6")}
              >
                Start monitoring
              </Link>
              <Link
                href="/companies"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "rounded-lg px-6")}
              >
                Try demo scan
              </Link>
            </div>
          </div>

          <aside className="glass-card flex flex-col justify-between gap-6 p-6">
            <div>
              <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
                Intelligence brief preview
              </p>
              <h2 className="mt-3 font-section-title text-[24px] font-semibold text-on-surface">
                {EXAMPLE_BRIEF.company}
              </h2>
              <p className="mt-2 text-body-md text-on-surface-variant">
                {EXAMPLE_BRIEF.summary}
              </p>
            </div>

            <div className="rounded-2xl border border-outline-variant/80 bg-surface-container-low p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-body-sm text-on-surface-variant">Current verdict</p>
                  <p className="mt-1 font-section-title text-section-title text-on-surface">
                    {EXAMPLE_BRIEF.strategyPrediction}
                  </p>
                </div>
                <div className="rounded-full bg-rose-100 px-3 py-1 text-label-caps uppercase tracking-[0.08em] text-rose-700">
                  Risk {EXAMPLE_BRIEF.riskScore}
                </div>
              </div>
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between text-body-sm text-on-surface-variant">
                  <span>Confidence</span>
                  <span>{EXAMPLE_BRIEF.confidence}%</span>
                </div>
                <div className="h-2 rounded-full bg-surface-variant">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${EXAMPLE_BRIEF.confidence}%` }}
                  />
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section aria-labelledby="built-on-heading">
          <h2 id="built-on-heading" className="sr-only">
            Built on
          </h2>
          <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {INTEGRATIONS.map((integration, index) => (
              <li key={integration.name}>
                <article className="glass-card flex min-h-[220px] flex-col gap-4 p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-container text-primary">
                    <span className="material-symbols-outlined text-[22px]">
                      {FEATURE_ICONS[index]}
                    </span>
                  </div>
                  <div>
                    <p className="font-label-caps text-label-caps uppercase tracking-[0.08em] text-primary">
                      {FEATURE_TITLES[index]}
                    </p>
                    <h3 className="mt-2 font-section-title text-[22px] font-semibold text-on-surface">
                      {integration.name}
                    </h3>
                    <p className="mt-2 text-body-md text-on-surface-variant">
                      {integration.role}
                    </p>
                  </div>
                </article>
              </li>
            ))}
          </ol>
        </section>

        <section className="overflow-hidden rounded-[32px] bg-sidebar px-8 py-10 text-white shadow-[0_32px_70px_-38px_rgba(2,6,23,0.8)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <p className="font-label-caps text-label-caps uppercase tracking-[0.12em] text-white/60">
                Evidence-first workflow
              </p>
              <h2 className="font-page-title text-[40px] font-bold leading-tight tracking-[-0.04em] text-white">
                Intelligence that holds up in court.
              </h2>
              <p className="max-w-2xl text-[17px] leading-7 text-white/70">
                Capture the public web, preserve every artifact, reason over the deltas, and ship a briefing your leadership team can actually trust.
              </p>
            </div>

            <Link
              href="/companies"
              className={cn(buttonVariants({ variant: "default", size: "lg" }), "rounded-lg px-6")}
            >
              Get started
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
