import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { makeHttp } from "../core/http";
import { idbGet } from "../core/idb";
import { IDB_BEARER_KEY, IDB_DEVICE_CONFIG_KEY, IDB_IDENTITY_KEY, type DeviceConfig } from "../core/import";
import {
  setUnlocked,
} from "../core/index-store";
import { unwrapIdentity, unwrapSecret, type WrappedIdentity } from "../core/identity";

type State =
  | { kind: "loading" }
  | { kind: "needs-import" }
  | { kind: "prompt" }
  | { kind: "trying" }
  | { kind: "error"; message: string };

export function Unlock() {
  const loc = useLocation();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [passphrase, setPassphrase] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const wrapped = await idbGet<WrappedIdentity>("identity", IDB_IDENTITY_KEY);
      if (cancelled) return;
      if (!wrapped) {
        setState({ kind: "needs-import" });
        return;
      }
      setState({ kind: "prompt" });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (state.kind === "needs-import") {
      loc.route("/import", true);
    }
  }, [state.kind, loc]);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    if (!passphrase) {
      setState({ kind: "error", message: "Enter your device passphrase." });
      return;
    }
    setState({ kind: "trying" });

    const wrapped = await idbGet<WrappedIdentity>("identity", IDB_IDENTITY_KEY);
    const wrappedBearer = await idbGet<WrappedIdentity>("identity", IDB_BEARER_KEY);
    const config = await idbGet<DeviceConfig>("identity", IDB_DEVICE_CONFIG_KEY);

    if (!wrapped || !wrappedBearer || !config) {
      setState({ kind: "needs-import" });
      return;
    }

    let identity: string;
    let bearer: string;
    try {
      identity = await unwrapIdentity(wrapped, passphrase);
      bearer = await unwrapSecret(wrappedBearer, passphrase);
    } catch {
      setState({ kind: "error", message: "Wrong passphrase." });
      return;
    }

    const http = makeHttp(config.worker_base_url, bearer);
    await setUnlocked({
      identity,
      recipient: config.recipient,
      http,
    });
    loc.route("/inbox", true);
  };

  if (state.kind === "loading") {
    return (
      <div class="container">
        <p class="dim">Loading…</p>
      </div>
    );
  }

  if (state.kind === "needs-import") {
    return (
      <div class="container">
        <p class="dim">Redirecting to import…</p>
      </div>
    );
  }

  return (
    <>
      <header class="header">
        <h1>Note to Self</h1>
      </header>
      <div class="container stack">
        <div class="card stack">
          <h2 style={{ margin: 0, fontSize: 17 }}>Unlock</h2>
          <p class="dim small" style={{ margin: 0 }}>
            Enter your device passphrase to decrypt the identity in this browser.
          </p>
          <form class="stack" onSubmit={onSubmit}>
            <label>
              Device passphrase
              <input
                type="password"
                autoFocus
                autoComplete="current-password"
                value={passphrase}
                onInput={(e) =>
                  setPassphrase((e.target as HTMLInputElement).value)
                }
                disabled={state.kind === "trying"}
              />
            </label>
            {state.kind === "error" && (
              <p class="error" role="alert">{state.message}</p>
            )}
            <div class="row between">
              <a href="/import" class="small">Import a different bundle</a>
              <button
                type="submit"
                class="primary"
                disabled={state.kind === "trying" || !passphrase}
              >
                {state.kind === "trying" ? "Unlocking…" : "Unlock"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
