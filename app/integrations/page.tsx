import { redirect } from "next/navigation";

import { resolveActiveWorkspace } from "@/lib/auth/active-workspace.server";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/routes";

export const dynamic = "force-dynamic";

interface IntegrationCard {
  provider: string;
  description: string;
  icon: string;
  connected: boolean;
}

export default async function IntegrationsPage() {
  const resolution = await resolveActiveWorkspace();

  if (resolution.status === "redirect") {
    redirect(`${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent("/integrations")}`);
  }

  const integrations: IntegrationCard[] = [
    {
      provider: "Apify",
      description: "Web scraping and data extraction. Captures competitor page HTML and screenshots.",
      icon: "cloud_download",
      connected: !!process.env.APIFY_TOKEN,
    },
    {
      provider: "InsForge Storage",
      description: "Evidence artifact storage. Preserves raw captures, diffs, and intelligence reports.",
      icon: "inventory_2",
      connected: !!(process.env.INSFORGE_API_URL && process.env.INSFORGE_API_KEY),
    },
    {
      provider: "AI Model",
      description: "Model inference for claim extraction, classification, and verdict generation.",
      icon: "psychology",
      connected: !!(process.env.MODEL_API_KEY || process.env.INSFORGE_API_KEY),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-page-title text-[30px] font-semibold tracking-[-0.04em] text-on-surface">
          Integrations
        </h1>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">
          Manage external service connections that power SignalVault&apos;s intelligence pipeline.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {integrations.map((integration) => (
          <article
            key={integration.provider}
            className="rounded-[24px] border border-outline-variant bg-surface-container-lowest p-6 shadow-[0_20px_42px_-34px_rgba(21,27,45,0.28)]"
          >
            <div className="flex items-start justify-between">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <span className="material-symbols-outlined text-[20px]">
                  {integration.icon}
                </span>
              </div>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                  integration.connected
                    ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border border-amber-200 bg-amber-50 text-amber-700"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    integration.connected ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
                {integration.connected ? "Connected" : "Not configured"}
              </span>
            </div>
            <h3 className="mt-4 text-lg font-semibold text-on-surface">
              {integration.provider}
            </h3>
            <p className="mt-2 text-sm leading-6 text-on-surface-variant">
              {integration.description}
            </p>
          </article>
        ))}
      </div>

      <div className="rounded-[20px] border border-outline-variant bg-surface-container-lowest p-6">
        <h2 className="text-lg font-semibold text-on-surface">Configuration</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          Integration credentials are configured via environment variables. See the{" "}
          <code className="rounded bg-surface-container-low px-1.5 py-0.5 text-xs font-mono">.env.local</code>{" "}
          file for required values.
        </p>
        <div className="mt-4 overflow-hidden rounded-xl border border-outline-variant">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-outline-variant bg-surface-container-low">
                <th className="px-4 py-2.5 text-left font-medium text-on-surface-variant">Variable</th>
                <th className="px-4 py-2.5 text-left font-medium text-on-surface-variant">Service</th>
                <th className="px-4 py-2.5 text-left font-medium text-on-surface-variant">Status</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "APIFY_TOKEN", service: "Apify", set: !!process.env.APIFY_TOKEN },
                { name: "INSFORGE_API_URL", service: "InsForge", set: !!process.env.INSFORGE_API_URL },
                { name: "INSFORGE_API_KEY", service: "InsForge", set: !!process.env.INSFORGE_API_KEY },
                { name: "MODEL_API_KEY", service: "AI Model", set: !!process.env.MODEL_API_KEY },
                { name: "MODEL_BASE_URL", service: "AI Model", set: !!process.env.MODEL_BASE_URL },
              ].map((env) => (
                <tr key={env.name} className="border-b border-outline-variant last:border-none">
                  <td className="px-4 py-2.5 font-mono text-xs">{env.name}</td>
                  <td className="px-4 py-2.5 text-on-surface-variant">{env.service}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-medium ${env.set ? "text-emerald-600" : "text-on-surface-variant"}`}>
                      {env.set ? "✓ Set" : "— Not set"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
