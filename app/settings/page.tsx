import { redirect } from "next/navigation";

import { resolveActiveWorkspace } from "@/lib/auth/active-workspace.server";
import { LOGIN_PATH, REDIRECT_PARAM } from "@/lib/auth/routes";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const resolution = await resolveActiveWorkspace();

  if (resolution.status === "redirect") {
    redirect(`${LOGIN_PATH}?${REDIRECT_PARAM}=${encodeURIComponent("/settings")}`);
  }

  const workspace = resolution.workspace;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-page-title text-[30px] font-semibold tracking-[-0.04em] text-on-surface">
          Settings
        </h1>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">
          Manage your workspace configuration and preferences.
        </p>
      </div>

      {/* Workspace info */}
      <section className="rounded-[24px] border border-outline-variant bg-surface-container-lowest p-6">
        <h2 className="text-lg font-semibold text-on-surface">Workspace</h2>
        <p className="mt-1 text-sm text-on-surface-variant">
          Your current workspace details.
        </p>

        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-outline-variant px-4 py-3">
            <div>
              <p className="text-sm font-medium text-on-surface">Workspace name</p>
              <p className="text-sm text-on-surface-variant">{workspace.name}</p>
            </div>
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">
              business
            </span>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-outline-variant px-4 py-3">
            <div>
              <p className="text-sm font-medium text-on-surface">Workspace ID</p>
              <p className="font-mono text-xs text-on-surface-variant">{workspace.id}</p>
            </div>
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">
              fingerprint
            </span>
          </div>
        </div>
      </section>

      {/* Account actions */}
      <section className="rounded-[24px] border border-outline-variant bg-surface-container-lowest p-6">
        <h2 className="text-lg font-semibold text-on-surface">Account</h2>
        <p className="mt-1 text-sm text-on-surface-variant">
          Manage your authentication and session.
        </p>

        <div className="mt-5">
          <form action="/api/auth/signout" method="POST">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-xl border border-outline-variant px-4 py-2.5 text-sm font-medium text-on-surface transition-colors hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[18px]">logout</span>
              Sign out
            </button>
          </form>
        </div>
      </section>

      {/* Danger zone */}
      <section className="rounded-[24px] border border-rose-200 bg-rose-50/30 p-6">
        <h2 className="text-lg font-semibold text-rose-700">Danger Zone</h2>
        <p className="mt-1 text-sm text-rose-600/80">
          Irreversible and destructive actions.
        </p>

        <div className="mt-5">
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-medium text-rose-700 opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">delete_forever</span>
            Delete workspace (coming soon)
          </button>
        </div>
      </section>
    </div>
  );
}
