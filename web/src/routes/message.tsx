import { useEffect, useState } from "preact/hooks";
import { useLocation, useRoute } from "preact-iso";
import { useSignalEffect } from "@preact/signals";
import { decrypt } from "../core/crypto";
import { idbGet, idbPut } from "../core/idb";
import {
  deleteMessage,
  identity as identitySignal,
  index,
  isUnlocked,
  markRead,
  worker as workerSignal,
} from "../core/index-store";

type BodyState =
  | { kind: "loading" }
  | { kind: "loaded"; text: string }
  | { kind: "absent" } // server returned 404 — expected for consumed/expired
  | { kind: "error"; message: string };

interface MessagePayload {
  id?: string;
  content?: string;
  tags?: string[];
  created_at?: string;
}

export function Message() {
  const loc = useLocation();
  const route = useRoute();
  const id = route.params.id;

  const [body, setBody] = useState<BodyState>({ kind: "loading" });
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useSignalEffect(() => {
    void index.value;
  });

  useEffect(() => {
    if (!isUnlocked()) {
      loc.route("/", true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const cached = await idbGet<Uint8Array>("cache_messages", id);
        let ciphertext = cached;
        if (!ciphertext) {
          const http = workerSignal.value;
          if (!http) throw new Error("Session locked");
          const r = await http.getMessage(id);
          if (r.status === 404) {
            if (!cancelled) {
              setBody({ kind: "absent" });
            }
            return;
          }
          if (!r.body) {
            if (!cancelled) {
              setBody({ kind: "error", message: `HTTP ${r.status}` });
            }
            return;
          }
          ciphertext = r.body;
          await idbPut("cache_messages", id, ciphertext);
        }
        const ident = identitySignal.value;
        if (!ident) throw new Error("Session locked");
        const plain = await decrypt(ciphertext, ident);
        const parsed = JSON.parse(
          new TextDecoder().decode(plain),
        ) as MessagePayload;
        if (cancelled) return;
        setBody({ kind: "loaded", text: parsed.content ?? "" });
      } catch (e) {
        if (cancelled) return;
        setBody({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const entry = index.value.messages.find((m) => m.id === id);

  const onMarkRead = async () => {
    await markRead(id);
  };

  const onDelete = async () => {
    await deleteMessage(id);
    loc.route("/inbox", true);
  };

  return (
    <>
      <header class="header">
        <button class="ghost" onClick={() => loc.route("/inbox")}>← Back</button>
        <h1>Message</h1>
        <div class="actions">
          {entry && entry.status === "unread" && (
            <button onClick={onMarkRead}>Mark read</button>
          )}
        </div>
      </header>

      <div class="container stack">
        {!entry && body.kind !== "loading" && (
          <p class="dim">This message is no longer in the local index.</p>
        )}

        {entry && (
          <div class="row" style={{ flexWrap: "wrap" }}>
            <span class={`badge ${entry.status}`}>{entry.status}</span>
            {entry.tags.map((t) => (
              <span key={t} class="tag">#{t}</span>
            ))}
            <span class="faint small">
              {new Date(entry.created_at).toLocaleString()}
            </span>
          </div>
        )}

        {body.kind === "loading" && <p class="dim">Decrypting…</p>}
        {body.kind === "absent" && (
          <p class="dim">
            {entry?.status === "consumed"
              ? "This message was consumed. The encrypted body was removed from the server; only the receipt remains."
              : entry?.status === "expired"
                ? "This message expired. The encrypted body was removed from the server; only the receipt remains."
                : "The encrypted body is no longer on the server."}
          </p>
        )}
        {body.kind === "error" && <p class="error">{body.message}</p>}
        {body.kind === "loaded" && (
          <pre
            class="card"
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "inherit",
              fontSize: 15,
              margin: 0,
            }}
          >
            {body.text}
          </pre>
        )}

        <div class="row between">
          {(() => {
            // "Forget" removes the index receipt for messages whose body is
            // already gone from R2 (consumed or expired). "Delete" removes
            // the body too — only meaningful when the body still exists.
            const isReceiptOnly =
              body.kind === "absent" ||
              entry?.status === "consumed" ||
              entry?.status === "expired";
            const verb = isReceiptOnly ? "Forget" : "Delete";
            const confirmText = isReceiptOnly
              ? "Remove this receipt from the index?"
              : "Delete this message permanently?";
            return !confirmingDelete ? (
              <>
                <span />
                <button
                  class={isReceiptOnly ? "ghost" : "danger"}
                  onClick={() => setConfirmingDelete(true)}
                >
                  {verb}
                </button>
              </>
            ) : (
              <div class="confirm-row" style={{ width: "100%" }}>
                <span class="small">{confirmText}</span>
                <button class="ghost" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </button>
                <button
                  class={isReceiptOnly ? "primary" : "danger"}
                  onClick={onDelete}
                >
                  {verb}
                </button>
              </div>
            );
          })()}
        </div>
      </div>
    </>
  );
}
