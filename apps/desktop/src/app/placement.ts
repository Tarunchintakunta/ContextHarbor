// Where (and whether) the private answer panel may appear (Part 2, Section 7).

export interface DisplayInfo {
  id: number;
  primary: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface PlacementInput {
  platform: NodeJS.Platform;
  osRelease: string; // os.release()
  displays: DisplayInfo[];
  sharing: boolean; // user appears to be presenting
  mode: "auto" | "primary" | "secondary" | "id";
  displayId?: number;
  trustCaptureExclusion: boolean; // user verified exclusion works for their setup (receiver test)
}

export interface Placement {
  show: boolean;
  displayId: number | null;
  captureExclusion: "supported" | "best-effort" | "unsupported";
  reason: string;
}

/** Capture exclusion support by platform. Never a guarantee; receiver-side tests decide what is claimed. */
export function exclusionSupport(platform: NodeJS.Platform, osRelease: string): Placement["captureExclusion"] {
  if (platform === "win32") {
    // WDA_EXCLUDEFROMCAPTURE needs Windows 10 2004 (build 19041)+.
    const build = Number(osRelease.split(".")[2] ?? 0);
    return build >= 19041 ? "supported" : "unsupported";
  }
  // macOS: NSWindow.sharingType = .none is honored by legacy capture, but ScreenCaptureKit-based sharing
  // (used by current meeting apps on macOS 14+/15+) may still include the window.
  if (platform === "darwin") return "best-effort";
  return "unsupported"; // Linux compositors: no standard exclusion API
}

export function choosePlacement(i: PlacementInput): Placement {
  const support = exclusionSupport(i.platform, i.osRelease);
  const primary = i.displays.find((d) => d.primary) ?? i.displays[0];
  const secondary = i.displays.find((d) => !d.primary);
  const chosen =
    i.mode === "id" ? i.displays.find((d) => d.id === i.displayId) ?? primary
    : i.mode === "primary" ? primary
    : secondary ?? primary; // auto/secondary prefer a non-primary display

  if (!i.sharing) return { show: true, displayId: chosen.id, captureExclusion: support, reason: "not presenting" };
  // Presenting: assume the primary display is the shared surface unless the user pinned another display.
  if (secondary && chosen.id !== primary.id) return { show: true, displayId: chosen.id, captureExclusion: support, reason: "presenting; panel on a non-primary display" };
  if (secondary) return { show: true, displayId: secondary.id, captureExclusion: support, reason: "presenting; moved panel off the likely shared display" };
  if (support === "supported" || (support === "best-effort" && i.trustCaptureExclusion)) {
    return { show: true, displayId: chosen.id, captureExclusion: support, reason: "presenting on single display; relying on capture exclusion" };
  }
  return { show: false, displayId: null, captureExclusion: support, reason: "presenting on the only display and capture exclusion is not verified; panel hidden" };
}
