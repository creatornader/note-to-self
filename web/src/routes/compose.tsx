import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { HttpClient } from "../core/http";
import { idbGet } from "../core/idb";
import {
  IDB_DEVICE_CONFIG_KEY,
  type DeviceConfig,
  type NtfyConfig,
} from "../core/import";
import { isUnlocked, pushNew, worker as workerSignal } from "../core/index-store";

type Priority = "low" | "default" | "high" | "urgent";
type TtlOption = "none" | "1h" | "4h" | "1d" | "7d";

export function parseTags(s: string): string[] {
  return s
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

export function ttlSeconds(opt: TtlOption): number | null {
  switch (opt) {
    case "none":
      return null;
    case "1h":
      return 3600;
    case "4h":
      return 14_400;
    case "1d":
      return 86_400;
    case "7d":
      return 604_800;
  }
}

// Mirror of src/notify.rs::build_body in the CLI. The shape
// "new note · tag1, tag2 · ttl-suffix" must stay byte-identical so a
// notification on your phone looks the same regardless of which client
// published.
export function buildNtfyBody(tags: string[], ttlLabel: string | null): string {
  const parts: string[] = ["new note"];
  if (tags.length > 0) parts.push(tags.join(", "));
  if (ttlLabel) parts.push(`expires in ${ttlLabel}`);
  return parts.join(" · ");
}

export async function fireNtfy(args: {
  http: HttpClient | null;
  ntfy: NtfyConfig | null;
  messageId: string;
  priority: Priority;
  tags: string[];
  ttlLabel: string | null;
  clickBaseUrl?: string;
}): Promise<void> {
  const { http, ntfy, messageId, priority, tags, ttlLabel, clickBaseUrl } = args;
  if (!ntfy || !http) return;
  const body = buildNtfyBody(tags, ttlLabel);
  const click = clickBaseUrl
    ? `${clickBaseUrl.replace(/\/$/, "")}/m/${messageId}`
    : undefined;
  try {
    await http.notify({
      server: ntfy.server,
      topic: ntfy.topic,
      title: "Note to Self",
      priority: priorityValue(priority),
      body,
      ...(ntfy.token ? { token: ntfy.token } : {}),
      ...(click ? { click } : {}),
    });
  } catch {
    // Notification failures are non-fatal; the message has already been
    // pushed to R2 successfully by the time we get here.
  }
}

function priorityValue(p: Priority): string {
  switch (p) {
    case "low":
      return "2";
    case "default":
      return "3";
    case "high":
      return "4";
    case "urgent":
      return "5";
  }
}

export function Compose() {
  const loc = useLocation();
  const [content, setContent] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [ttl, setTtl] = useState<TtlOption>("none");
  const [priority, setPriority] = useState<Priority>("default");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<DeviceConfig | null>(null);

  useEffect(() => {
    if (!isUnlocked()) {
      loc.route("/", true);
      return;
    }
    idbGet<DeviceConfig>("identity", IDB_DEVICE_CONFIG_KEY).then((c) => {
      if (c) setConfig(c);
    });
  }, []);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    if (!content.trim()) {
      setError("Message is empty.");
      return;
    }
    const tags = parseTags(tagsRaw);
    const ttlSecs = ttlSeconds(ttl);
    setSubmitting(true);
    try {
      const messageId = await pushNew({ content, tags, ttl_seconds: ttlSecs });
      void fireNtfy({
        http: workerSignal.value,
        ntfy: config?.ntfy ?? null,
        messageId,
        priority,
        tags,
        ttlLabel: ttl === "none" ? null : ttl,
        clickBaseUrl: window.location.origin,
      });
      loc.route("/inbox", true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <header class="header">
        <button class="ghost" onClick={() => loc.route("/inbox")}>← Cancel</button>
        <h1>Compose</h1>
        <div class="actions">
          <button
            class="primary"
            onClick={onSubmit}
            disabled={submitting || !content.trim()}
          >
            {submitting ? "Sending…" : "Send"}
          </button>
        </div>
      </header>

      <form class="container stack" onSubmit={onSubmit}>
        <label>
          Message
          <textarea
            autoFocus
            rows={6}
            value={content}
            onInput={(e) => setContent((e.target as HTMLTextAreaElement).value)}
            placeholder="A note to your future self…"
          />
        </label>

        <label>
          Tags <span class="faint small">(comma-separated)</span>
          <input
            type="text"
            value={tagsRaw}
            onInput={(e) => setTagsRaw((e.target as HTMLInputElement).value)}
            placeholder="todo, idea, reminder"
            autocomplete="off"
          />
        </label>

        <div class="row" style={{ gap: 16 }}>
          <label style={{ flex: 1 }}>
            TTL
            <select
              value={ttl}
              onChange={(e) =>
                setTtl((e.target as HTMLSelectElement).value as TtlOption)
              }
            >
              <option value="none">No expiry</option>
              <option value="1h">1 hour</option>
              <option value="4h">4 hours</option>
              <option value="1d">1 day</option>
              <option value="7d">7 days</option>
            </select>
          </label>

          <label style={{ flex: 1 }}>
            Notification priority
            <select
              value={priority}
              onChange={(e) =>
                setPriority((e.target as HTMLSelectElement).value as Priority)
              }
            >
              <option value="low">Low</option>
              <option value="default">Default</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
        </div>

        {error && <p class="error" role="alert">{error}</p>}

        {!config?.ntfy && (
          <p class="faint small">
            No ntfy topic configured on this device. The message will still be
            pushed; no notification fires.
          </p>
        )}
      </form>
    </>
  );
}
