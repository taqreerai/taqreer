// Server-side fetch + classification of the model provider's public
// status page (status.claude.com — an Atlassian Statuspage instance;
// status.anthropic.com 302-redirects here). Consumed by GET /api/status,
// which the dashboard status chip + the pre-generate banner + the
// in-deck "slow" caption read so those surfaces reflect REAL upstream
// health instead of a fabricated message.

export type ServerStatusLevel =
  | "operational"
  | "degraded"
  | "down"
  | "unknown";

export type ServerStatus = {
  level: ServerStatusLevel;
  // Raw Statuspage indicator (none/minor/major/critical/maintenance) +
  // its English description — kept for the chip's hover title.
  indicator: string;
  description: string;
};

const STATUS_URL = "https://status.claude.com/api/v2/status.json";

// Statuspage's `indicator` scale → our 3 UI levels.
function classify(indicator: string): ServerStatusLevel {
  switch (indicator) {
    case "none":
      return "operational";
    case "minor":
    case "maintenance":
      return "degraded";
    case "major":
    case "critical":
      return "down";
    default:
      return "unknown";
  }
}

export async function getAnthropicStatus(): Promise<ServerStatus> {
  try {
    const res = await fetch(STATUS_URL, {
      // Server-cached so the status page isn't hammered even though the
      // chip polls; the route below adds its own revalidate too.
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as {
      status?: { indicator?: string; description?: string };
    };
    const indicator = data.status?.indicator ?? "";
    return {
      level: classify(indicator),
      indicator,
      description: data.status?.description ?? "",
    };
  } catch {
    // Status page unreachable / slow → treat as unknown so the UI stays
    // neutral (no fake "all good", no false alarm) rather than throwing.
    return { level: "unknown", indicator: "", description: "" };
  }
}
