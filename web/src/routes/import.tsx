import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { makeHttp } from "../core/http";
import {
  BundleValidationError,
  captureTokenFromHash,
  importBundle,
} from "../core/import";
import { setUnlocked } from "../core/index-store";

type Step = "idle" | "parsed" | "token" | "wrapped" | "stored" | "done";
type FormError = { field: string; message: string } | null;

export function Import() {
  const loc = useLocation();

  const captured = useMemo(
    () =>
      typeof window !== "undefined"
        ? captureTokenFromHash(window.location, window.history)
        : { token: null, scrubbed: false },
    [],
  );

  const [bundleText, setBundleText] = useState("");
  const [exportPassphrase, setExportPassphrase] = useState("");
  const [devicePassphrase, setDevicePassphrase] = useState("");
  const [confirmDevicePassphrase, setConfirmDevicePassphrase] = useState("");
  const [manualToken, setManualToken] = useState("");
  const [error, setError] = useState<FormError>(null);
  const [step, setStep] = useState<Step>("idle");
  const [submitting, setSubmitting] = useState(false);

  const token = captured.token ?? manualToken;
  const isArmored = bundleText.trimStart().startsWith("-----BEGIN AGE");
  const canSubmit =
    bundleText.length > 0 &&
    devicePassphrase.length > 0 &&
    devicePassphrase === confirmDevicePassphrase &&
    token.length > 0 &&
    !submitting;

  useEffect(() => {
    if (captured.token) setStep("token");
  }, [captured.token]);

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    setError(null);
    if (devicePassphrase !== confirmDevicePassphrase) {
      setError({
        field: "confirmDevicePassphrase",
        message: "Device passphrases do not match.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const result = await importBundle({
        bundleText,
        exportPassphrase: isArmored ? exportPassphrase : undefined,
        devicePassphrase,
        bearerToken: token,
      });
      setStep("stored");
      // Auto-unlock on the freshly imported bundle so the user goes straight
      // to the inbox. We already have the plaintext identity + token in scope
      // from importBundle's return value; no need to round-trip through IDB.
      await setUnlocked({
        identity: result.bundle.identity,
        recipient: result.config.recipient,
        http: makeHttp(result.config.worker_base_url, token),
      });
      setStep("done");
      loc.route("/inbox", true);
    } catch (e) {
      if (e instanceof BundleValidationError) {
        setError({ field: e.field, message: e.message });
        if (e.field === "exportPassphrase" || e.field === "bundleText") {
          setStep("idle");
        }
      } else {
        setError({
          field: "root",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const checkClass = (active: boolean, fail = false) =>
    fail ? "fail" : active ? "done" : "";

  return (
    <>
      <header class="header">
        <h1>Import bundle</h1>
      </header>

      <div class="container stack">
        {captured.scrubbed && (
          <p class="small dim">
            Enrollment token captured from the URL and scrubbed from history.
          </p>
        )}

        <form class="card stack" onSubmit={onSubmit}>
          <label>
            Paste bundle (output of <code>nts export</code> or{" "}
            <code>nts export --passphrase</code>)
            <textarea
              spellcheck={false}
              autocomplete="off"
              value={bundleText}
              onInput={(e) => {
                const v = (e.target as HTMLTextAreaElement).value;
                setBundleText(v);
                setStep(v.length > 0 ? "parsed" : "idle");
              }}
              placeholder='{"v": 1, "identity": "AGE-SECRET-KEY-...", ...}'
              rows={6}
            />
          </label>

          {isArmored && (
            <label>
              Export passphrase
              <input
                type="password"
                autocomplete="off"
                value={exportPassphrase}
                onInput={(e) =>
                  setExportPassphrase((e.target as HTMLInputElement).value)
                }
              />
            </label>
          )}

          {!captured.token && (
            <label>
              Device token (from <code>nts device add</code>)
              <input
                type="text"
                spellcheck={false}
                autocomplete="off"
                placeholder="nts_…"
                value={manualToken}
                onInput={(e) =>
                  setManualToken((e.target as HTMLInputElement).value)
                }
              />
            </label>
          )}

          <label>
            New device passphrase
            <input
              type="password"
              autocomplete="new-password"
              value={devicePassphrase}
              onInput={(e) =>
                setDevicePassphrase((e.target as HTMLInputElement).value)
              }
            />
          </label>

          <label>
            Confirm device passphrase
            <input
              type="password"
              autocomplete="new-password"
              value={confirmDevicePassphrase}
              onInput={(e) =>
                setConfirmDevicePassphrase(
                  (e.target as HTMLInputElement).value,
                )
              }
            />
          </label>

          {error && (
            <p class="error" role="alert">
              <span class="faint small">{error.field}: </span>
              {error.message}
            </p>
          )}

          <ul class="checklist">
            <li class={checkClass(bundleText.length > 0)}>Bundle pasted</li>
            <li class={checkClass(token.length > 0)}>Token captured</li>
            <li
              class={checkClass(
                step === "wrapped" || step === "stored" || step === "done",
              )}
            >
              Identity wrapped
            </li>
            <li class={checkClass(step === "stored" || step === "done")}>
              Stored in browser
            </li>
          </ul>

          <div class="row between">
            <a href="/" class="small">Cancel</a>
            <button type="submit" class="primary" disabled={!canSubmit}>
              {submitting ? "Importing…" : "Import + unlock"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
