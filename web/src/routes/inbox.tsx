import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { useSignalEffect } from "@preact/signals";
import {
  index,
  isUnlocked,
  online,
  syncNow,
  syncState,
} from "../core/index-store";

export function formatRelative(now: number, isoTimestamp: string): string {
  const t = new Date(isoTimestamp).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, now - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(t).toLocaleDateString();
}

// Statuses surfaced in the default inbox view. CONSUMED and EXPIRED are
// queue-semantic "done" states whose blobs have already been deleted from
// R2, so they belong behind an opt-in "Show archive" toggle to keep the
// active queue clean.
const ACTIVE_STATUSES = new Set(["unread", "read"]);

export function Inbox() {
  const loc = useLocation();
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [showArchive, setShowArchive] = useState(false);

  useEffect(() => {
    if (!isUnlocked()) {
      loc.route("/", true);
      return;
    }
    setSyncing(true);
    syncNow().finally(() => setSyncing(false));
  }, []);

  // Keep relative timestamps fresh by re-rendering every 30 seconds.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Subscribe to signal changes for re-render — useSignalEffect ensures
  // any read inside this component re-runs when those signals mutate.
  useSignalEffect(() => {
    void index.value;
    void syncState.value;
    void online.value;
  });

  const onSync = async () => {
    setSyncing(true);
    try {
      await syncNow();
    } finally {
      setSyncing(false);
    }
  };

  const allMessages = [...index.value.messages].sort((a, b) => {
    const ta = new Date(a.created_at).getTime() || 0;
    const tb = new Date(b.created_at).getTime() || 0;
    return tb - ta;
  });
  const messages = showArchive
    ? allMessages
    : allMessages.filter((m) => ACTIVE_STATUSES.has(m.status));
  const archiveCount = allMessages.length - allMessages.filter((m) =>
    ACTIVE_STATUSES.has(m.status),
  ).length;

  const lastSync = syncState.value.lastSync;
  const syncLine = !online.value
    ? "Offline — showing cache"
    : lastSync
      ? `Synced ${formatRelative(now, lastSync)}`
      : "Not synced yet";

  return (
    <>
      <header class="header">
        <button class="ghost" onClick={onSync} disabled={syncing} title="Sync">
          <span class={syncing ? "spin" : ""}>↻</span>
        </button>
        <h1>Inbox</h1>
        <div class="actions">
          <button class="primary" onClick={() => loc.route("/compose")}>
            Compose
          </button>
        </div>
      </header>

      <div class="status-bar">
        <span>
          <span class={`status-dot ${online.value ? "online" : "offline"}`} />
          {syncLine}
        </span>
        <span class="faint">
          {messages.length} {messages.length === 1 ? "message" : "messages"}
        </span>
      </div>

      {archiveCount > 0 && (
        <div class="archive-toggle">
          <button class="ghost small" onClick={() => setShowArchive((s) => !s)}>
            {showArchive
              ? `Hide archive (${archiveCount})`
              : `Show archive (${archiveCount})`}
          </button>
        </div>
      )}

      {messages.length === 0 ? (
        <div class="empty">
          <h2>No messages yet</h2>
          <p>Push from the CLI with <code>nts push "…"</code>, or compose one here.</p>
          <p style={{ marginTop: 16 }}>
            <button class="primary" onClick={() => loc.route("/compose")}>
              Compose your first
            </button>
          </p>
        </div>
      ) : (
        <div>
          {messages.map((m) => (
            <a
              key={m.id}
              class="message-row"
              href={`/m/${m.id}`}
            >
              <div class="row between">
                <span class={`badge ${m.status}`}>{m.status}</span>
                <span class="faint small">{formatRelative(now, m.created_at)}</span>
              </div>
              <div class="preview">{m.content_preview || "(no preview)"}</div>
              {m.tags.length > 0 && (
                <div class="row" style={{ flexWrap: "wrap" }}>
                  {m.tags.map((t) => (
                    <span key={t} class="tag">#{t}</span>
                  ))}
                </div>
              )}
            </a>
          ))}
        </div>
      )}
    </>
  );
}
