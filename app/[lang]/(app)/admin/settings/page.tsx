// Admin > Settings (server). Gates on admin, loads the DB-backed runtime config
// (presets, tier knobs, the free-credit amount) + the live Anthropic model list,
// and renders the interactive client. Editing here propagates everywhere with no
// deploy (lib/config/runtime-config.ts).

import { requireAdminPage } from "@/lib/api/admin-context";
import { prisma } from "@/lib/prisma";
import {
  ensureFresh,
  getAllPresets,
  getTiers,
} from "@/lib/config/runtime-config";
import { ALL_FLOWS } from "@/lib/credits/cost";
import { listModels } from "@/lib/anthropic/models";
import { SettingsClient } from "@/components/admin/SettingsClient";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  await requireAdminPage();
  await ensureFresh();

  const [models, settings] = await Promise.all([
    listModels(),
    prisma.platformSettings.findUnique({
      where: { id: "singleton" },
      select: { configVersion: true, imageCredits: true, regenBaseCredits: true },
    }),
  ]);

  return (
    <SettingsClient
      presets={getAllPresets()}
      tiers={getTiers()}
      models={models}
      flows={[...ALL_FLOWS]}
      configVersion={settings?.configVersion ?? 0}
      imageCredits={settings?.imageCredits ?? 5}
      regenBaseCredits={settings?.regenBaseCredits ?? 70}
    />
  );
}
