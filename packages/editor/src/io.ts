// The editor's side of the dev server (server.ts): load the document, save text and layout,
// load profiles, and receive file changes made outside the editor (SSE).
import type { Diagnostic, UseDecl } from "@spider/core";
import type { LoadedProfile } from "@spider/engine";
import type { ResolvedProfile } from "@spider/profile-schema";

export interface Doc {
  name: string;
  text: string;
  layout: string | null;
}

/** A profile as loaded for one set of `use` declarations (diagnostics point at those spans). */
export interface ProfileCache {
  key: string;
  profile: ResolvedProfile;
  diagnostics: Diagnostic[];
  uses: UseDecl[];
}

export const profileKey = (uses: UseDecl[]): string => JSON.stringify(uses.map((u) => [u.profile, u.version, u.alias]));

/** Profile diagnostics point at `use` spans from when they were loaded; move them to the current spans. */
export function remapProfileDiagnostics(cache: ProfileCache, uses: UseDecl[]): Diagnostic[] {
  return cache.diagnostics.map((d) => {
    const i = cache.uses.findIndex((u) => u.span.start === d.span?.start && u.span.end === d.span?.end);
    const span = i >= 0 ? uses[i]?.span : undefined;
    return span ? { ...d, span } : d;
  });
}

export async function fetchDoc(): Promise<Doc> {
  return (await (await fetch("/api/doc")).json()) as Doc;
}

export class ServerIO {
  /** Last text / layout JSON written (or received): unchanged content is not saved again. */
  savedText = "";
  savedLayout = "";
  /** Saves in flight. */
  saving = 0;

  /** `onSaving` runs whenever `saving` changes. */
  constructor(private readonly onSaving: () => void) {}

  async putText(text: string): Promise<void> {
    if (text === this.savedText) return;
    this.savedText = text;
    await this.track(fetch("/api/text", { method: "PUT", body: text }));
  }

  async putLayout(json: string): Promise<void> {
    if (json === this.savedLayout) return;
    this.savedLayout = json;
    await this.track(fetch("/api/layout", { method: "PUT", body: json }));
  }

  private async track(p: Promise<Response>): Promise<void> {
    this.saving++;
    this.onSaving();
    try {
      await p;
    } finally {
      this.saving--;
      this.onSaving();
    }
  }

  /** Profile for `uses`, reusing `current` when the declarations are the same. */
  async profile(uses: UseDecl[], current: ProfileCache | undefined): Promise<LoadedProfile & { cache: ProfileCache }> {
    const key = profileKey(uses);
    let cache = current?.key === key ? current : undefined;
    if (!cache) {
      const res = await fetch("/api/profile", { method: "POST", body: JSON.stringify(uses) });
      const { profile, diagnostics } = (await res.json()) as { profile: ResolvedProfile; diagnostics: Diagnostic[] };
      cache = { key, profile, diagnostics, uses };
    }
    return { profile: cache.profile, diagnostics: remapProfileDiagnostics(cache, uses), cache };
  }

  /** File changes made outside the editor. */
  listen(on: { text(text: string): void; layout(layout: string): void }): void {
    const events = new EventSource("/api/events");
    events.addEventListener("text", (e) => {
      const { text } = JSON.parse((e as MessageEvent<string>).data) as { text: string };
      this.savedText = text;
      on.text(text);
    });
    events.addEventListener("layout", (e) => {
      const { layout } = JSON.parse((e as MessageEvent<string>).data) as { layout: string };
      this.savedLayout = layout;
      on.layout(layout);
    });
  }
}
