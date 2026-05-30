import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRODUCT_NAME = "SignalVault";
const TAGLINE = "Turn public web changes into auditable market intelligence.";

const INTEGRATIONS: { name: string; role: string }[] = [
  { name: "Apify", role: "Web capture" },
  { name: "Box", role: "Evidence archive" },
  { name: "Mastra", role: "Reasoning workflows" },
  { name: "InsForge", role: "Workspace data" },
];

const FEATURES = [
  {
    title: "Capture",
    icon: "radar",
    body: "Monitor pricing, messaging, trust, and product pages the moment they shift in public.",
  },
  {
    title: "Store",
    icon: "inventory_2",
    body: "Preserve HTML, screenshots, and normalized artifacts in a governed evidence trail.",
  },
  {
    title: "Reason",
    icon: "gavel",
    body: "Classify what changed, why it matters, and how the market signal impacts strategy.",
  },
  {
    title: "Deliver",
    icon: "hub",
    body: "Ship concise verdicts, scan summaries, and board-ready briefings without the sprawl.",
  },
] as const;

export default function Home() {
  return (
    <main className="min-h-screen bg-background px-6 py-6 text-on-surface md:px-10 lg:px-12">
      <div className="mx-auto flex max-w-7xl flex-col gap-8">
        <header className="flex items-center justify-between rounded-[24px] border border-outline-variant bg-surface-container-lowest px-6 py-4 shadow-[0_24px_50px_-36px_rgba(21,27,45,0.3)]">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5b3df5] text-white shadow-[0_20px_36px_-28px_rgba(91,61,245,0.95)]">
              <span
                className="material-symbols-outlined text-[18px]"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                security
              </span>
            </div>
            <div>
              <p className="font-page-title text-[20px] font-semibold tracking-[-0.03em] text-on-surface">
                {PRODUCT_NAME}
              </p>
              <p className="font-page-title text-[9px] font-medium uppercase tracking-[0.3em] text-on-surface-variant">
                Market Intelligence
              </p>
            </div>
          </div>

          <Link href="/companies" className={cn(buttonVariants({ variant: "outline" }), "h-10 rounded-full px-4 text-sm font-medium")}>
            Get started
          </Link>
        </header>

        <section className="grid gap-6 rounded-[32px] border border-outline-variant bg-surface-container-lowest p-8 shadow-[0_28px_60px_-40px_rgba(21,27,45,0.32)] lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] lg:items-center">
          <div className="max-w-2xl">
            <h1 className="sr-only">{PRODUCT_NAME}</h1>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.22em] text-primary">
              <span className="material-symbols-outlined text-[16px]">policy</span>
              Evidence-grade monitoring
            </div>

            <p className="mt-6 font-page-title text-[clamp(2.85rem,5vw,4.75rem)] font-semibold leading-[0.95] tracking-[-0.05em] text-on-surface">
              Intelligence that keeps pace with the public web.
            </p>
            <p className="mt-5 max-w-xl text-[17px] leading-7 text-on-surface-variant">{TAGLINE}</p>
            <p className="mt-3 max-w-xl text-[17px] leading-7 text-on-surface-variant">
              Track positioning, packaging, trust, and product moves with an evidence trail your operators and counsel can actually trust.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/companies" className={cn(buttonVariants({ size: "lg" }), "h-11 rounded-full px-6 text-sm font-medium")}>
                Start monitoring
              </Link>
              <Link
                href="/companies"
                className={cn(buttonVariants({ variant: "outline", size: "lg" }), "h-11 rounded-full px-6 text-sm font-medium")}
              >
                View dashboard
              </Link>
            </div>
          </div>

          <aside className="rounded-[28px] bg-sidebar p-1 text-white shadow-[0_34px_70px_-38px_rgba(2,6,23,0.82)]">
            <div className="rounded-[24px] bg-[linear-gradient(180deg,#0b1224_0%,#111c36_100%)] p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/55">
                    Live scan preview
                  </p>
                  <p className="mt-2 font-page-title text-[22px] font-semibold tracking-[-0.03em] text-white">
                    Acme AI
                  </p>
                </div>
                <span className="inline-flex rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-white">
                  82% confidence
                </span>
              </div>

              <div className="mt-6 rounded-[22px] border border-white/10 bg-white/5 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-white/60">Current verdict</p>
                    <p className="mt-1 font-page-title text-[24px] font-semibold tracking-[-0.03em] text-white">
                      Moving upmarket
                    </p>
                  </div>
                  <span className="inline-flex rounded-full bg-rose-500/15 px-3 py-1 text-sm font-medium text-rose-200">
                    Risk 74/100
                  </span>
                </div>

                <div className="mt-5 grid gap-3">
                  {[
                    "Pricing page dropped the free tier.",
                    "Trust center now highlights SOC 2 and HIPAA.",
                    "Careers opened enterprise sales hiring.",
                  ].map((item) => (
                    <div key={item} className="flex items-start gap-3 rounded-2xl bg-white/5 px-4 py-3">
                      <span className="material-symbols-outlined mt-0.5 text-[18px] text-[#b8a8ff]">
                        subdirectory_arrow_right
                      </span>
                      <p className="text-sm leading-6 text-white/80">{item}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </section>

        <section className="rounded-[32px] border border-outline-variant bg-surface-container-lowest px-8 py-10 shadow-[0_24px_50px_-36px_rgba(21,27,45,0.28)]">
          <div className="max-w-3xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-primary">
              Intelligence that holds up in court
            </p>
            <h2 className="mt-3 font-page-title text-[40px] font-semibold tracking-[-0.04em] text-on-surface">
              Preserve the signal, not just the summary.
            </h2>
            <p className="mt-4 text-[17px] leading-7 text-on-surface-variant">
              SignalVault keeps the raw capture, the normalized record, the reasoning layer, and the final verdict connected so every market call can be traced back to source evidence.
            </p>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            {INTEGRATIONS.map((integration) => (
              <span
                key={integration.name}
                className="inline-flex items-center gap-2 rounded-full border border-outline-variant bg-surface-container-low px-4 py-2 text-sm text-on-surface"
              >
                <span className="h-2 w-2 rounded-full bg-primary" />
                {integration.name}
                <span className="text-on-surface-variant">{integration.role}</span>
              </span>
            ))}
          </div>
        </section>

        <section aria-labelledby="workflow-heading">
          <h2 id="workflow-heading" className="sr-only">
            Workflow stages
          </h2>
          <ol className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <article className="h-full rounded-[28px] border border-outline-variant bg-surface-container-lowest p-6 shadow-[0_20px_42px_-34px_rgba(21,27,45,0.28)]">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <span className="material-symbols-outlined text-[20px]">{feature.icon}</span>
                  </div>
                  <h3 className="mt-5 font-page-title text-[24px] font-semibold tracking-[-0.03em] text-on-surface">
                    {feature.title}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-on-surface-variant">{feature.body}</p>
                </article>
              </li>
            ))}
          </ol>
        </section>

        <section
          role="region"
          aria-label="Built on"
          className="rounded-[32px] border border-outline-variant bg-surface-container-lowest px-8 py-10 shadow-[0_24px_50px_-36px_rgba(21,27,45,0.28)]"
        >
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-primary">Built on</p>
            <h2 id="built-on-heading" className="mt-3 font-page-title text-[34px] font-semibold tracking-[-0.04em] text-on-surface">
              A governed stack for evidence-first monitoring.
            </h2>
          </div>
          <ol className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {INTEGRATIONS.map((integration) => (
              <li key={integration.name}>
                <article className="rounded-[24px] border border-outline-variant bg-surface-container-low p-5">
                  <p className="font-page-title text-[20px] font-semibold tracking-[-0.03em] text-on-surface">
                    {integration.name}
                  </p>
                  <p className="mt-2 text-sm text-on-surface-variant">{integration.role}</p>
                </article>
              </li>
            ))}
          </ol>
        </section>

        <section className="overflow-hidden rounded-[32px] bg-sidebar px-8 py-10 text-white shadow-[0_34px_70px_-38px_rgba(2,6,23,0.82)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-white/55">
                Leaner operations
              </p>
              <h2 className="mt-3 font-page-title text-[40px] font-semibold tracking-[-0.04em] text-white">
                Scale your market awareness, not your headcount.
              </h2>
              <p className="mt-4 text-[17px] leading-7 text-white/70">
                Replace tab sprawl and manual screenshot hunts with one system for capture, reasoning, and delivery.
              </p>
            </div>

            <Link href="/companies" className={cn(buttonVariants({ size: "lg" }), "h-11 rounded-full px-6 text-sm font-medium")}>
              Get started
            </Link>
          </div>
        </section>

        <footer className="flex flex-col gap-4 rounded-[24px] border border-outline-variant bg-surface-container-lowest px-6 py-5 text-sm text-on-surface-variant md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#5b3df5] text-white">
              <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                security
              </span>
            </div>
            <div>
              <p className="font-page-title text-base font-semibold text-on-surface">{PRODUCT_NAME}</p>
              <p className="text-xs text-on-surface-variant">Evidence-first market intelligence.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <Link href="/companies" className="transition hover:text-on-surface">
              Dashboard
            </Link>
            <Link href="/claims" className="transition hover:text-on-surface">
              Claims
            </Link>
            <Link href="/integrations" className="transition hover:text-on-surface">
              Integrations
            </Link>
          </div>
        </footer>
      </div>
    </main>
  );
}
