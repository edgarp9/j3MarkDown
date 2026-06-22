interface StartupMark {
  readonly entryName: string;
  readonly startMs: number;
}

interface StartupMeasure {
  readonly section: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
}

interface StartupProfileWindow {
  __J3MARKDOWN_STARTUP_PROFILE__?: {
    readonly finalPoint: string;
    readonly rows: StartupProfileRow[];
  };
}

interface StartupProfileRow {
  readonly section: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly durationMs: number;
}

const startupProfileEnabled =
  import.meta.env.VITE_STARTUP_PROFILE === "1" &&
  typeof performance !== "undefined";
const startupMarks = new Map<string, StartupMark>();
const startupMeasures: StartupMeasure[] = [];

let nextStartupEntryId = 1;
let hasReportedStartupProfile = false;

export function markStartupPoint(name: string): void {
  if (!startupProfileEnabled || startupMarks.has(name)) {
    return;
  }

  startupMarks.set(name, createStartupMark(name));
}

export function measureStartupBetween(
  section: string,
  startName: string,
  endName: string,
): void {
  if (!startupProfileEnabled) {
    return;
  }

  const start = startupMarks.get(startName);
  const end = startupMarks.get(endName);
  if (!start || !end) {
    return;
  }

  recordStartupMeasure(section, start, end);
}

export function measureStartupFromNavigationStart(
  section: string,
  endName: string,
): void {
  if (!startupProfileEnabled) {
    return;
  }

  const end = startupMarks.get(endName);
  if (!end) {
    return;
  }

  startupMeasures.push({
    section,
    startMs: 0,
    endMs: end.startMs,
    durationMs: end.startMs,
  });
}

export function measureStartupWork<T>(section: string, work: () => T): T {
  if (!startupProfileEnabled) {
    return work();
  }

  const start = createStartupMark(`${section} start`);
  try {
    return work();
  } finally {
    const end = createStartupMark(`${section} end`);
    recordStartupMeasure(section, start, end);
  }
}

export function startStartupSpan(section: string): () => void {
  if (!startupProfileEnabled) {
    return () => {};
  }

  const start = createStartupMark(`${section} start`);
  let didFinish = false;

  return () => {
    if (didFinish) {
      return;
    }

    didFinish = true;
    const end = createStartupMark(`${section} end`);
    recordStartupMeasure(section, start, end);
  };
}

export function reportStartupProfile(finalPointName: string): void {
  if (!startupProfileEnabled || hasReportedStartupProfile) {
    return;
  }

  hasReportedStartupProfile = true;
  const rows = startupMeasures.map((measure) => ({
    section: measure.section,
    startMs: formatMs(measure.startMs),
    endMs: formatMs(measure.endMs),
    durationMs: formatMs(measure.durationMs),
  }));

  (window as StartupProfileWindow).__J3MARKDOWN_STARTUP_PROFILE__ = {
    finalPoint: finalPointName,
    rows,
  };

  console.groupCollapsed(`Startup profile: ${finalPointName}`);
  console.table(rows);
  console.groupEnd();
}

function createStartupMark(name: string): StartupMark {
  const entryName = `j3markdown-startup-${nextStartupEntryId}-${toEntryNameSuffix(name)}`;
  nextStartupEntryId += 1;
  performance.mark(entryName);

  return {
    entryName,
    startMs: readLatestPerformanceEntryStartTime(entryName),
  };
}

function recordStartupMeasure(
  section: string,
  start: StartupMark,
  end: StartupMark,
): void {
  const entryName = `j3markdown-startup-measure-${nextStartupEntryId}-${toEntryNameSuffix(
    section,
  )}`;
  nextStartupEntryId += 1;
  performance.measure(entryName, start.entryName, end.entryName);

  const measuredDuration =
    readLatestPerformanceEntryDuration(entryName) ?? end.startMs - start.startMs;

  startupMeasures.push({
    section,
    startMs: start.startMs,
    endMs: end.startMs,
    durationMs: measuredDuration,
  });
}

function readLatestPerformanceEntryStartTime(entryName: string): number {
  const entries = performance.getEntriesByName(entryName);
  const latestEntry = entries[entries.length - 1];

  return latestEntry?.startTime ?? performance.now();
}

function readLatestPerformanceEntryDuration(entryName: string): number | null {
  const entries = performance.getEntriesByName(entryName);
  const latestEntry = entries[entries.length - 1];

  return latestEntry?.duration ?? null;
}

function formatMs(value: number): number {
  return Math.round(value * 100) / 100;
}

function toEntryNameSuffix(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 64);
}
