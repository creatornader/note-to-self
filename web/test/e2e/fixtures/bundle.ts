// Static export bundle fixture for e2e. Uses the same pinned identity that
// the unit tests use (web/test/fixtures/ciphertext/sample.identity). The
// worker_base_url points at the Playwright base URL so requests are intercepted
// in-process via page.route().

export const FIXTURE_IDENTITY =
  "AGE-SECRET-KEY-165DD2KMPNETXTLP8A7S7GUHDPFGXQR47UJFTKJXQ39KMWX09YJFQTT7WTE";
export const FIXTURE_RECIPIENT =
  "age125se5v8yqnpk20gvnflc9mcf4ncxt032e38qy8mf2q0wmtf2eayqqv0708";
export const FIXTURE_TOKEN = "nts_e2e_fixture_token_v1";
export const WORKER_ORIGIN = "http://worker.e2e";

export const FIXTURE_BUNDLE = {
  v: 1 as const,
  identity: FIXTURE_IDENTITY,
  recipient: FIXTURE_RECIPIENT,
  config: {
    storage: {
      backend: "r2",
      path: "/tmp/nts",
      r2: {
        bucket: "nts-e2e",
        endpoint: "https://example.r2.cloudflarestorage.com",
        access_key_id: "AKID",
        secret_access_key: "SECRET",
      },
      worker_base_url: WORKER_ORIGIN,
    },
    notify: null,
  },
};
