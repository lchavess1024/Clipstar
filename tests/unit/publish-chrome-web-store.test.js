import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  checkAuthentication, compareVersions, parseVersion, publishChromeWebStore,
  runCli, validatePreflight, verifyReleasePackage
} from "../../scripts/publish-chrome-web-store.mjs";

const extensionId = "hbgkgbmefkghajcmngcichciohckbkgj";
const publisherId = "bad675f9-6a41-4b7c-849f-7e15fba1be63";
const name = `publishers/${publisherId}/items/${extensionId}`;
const identity = { name, itemId: extensionId };
const published = {
  ...identity,
  publishedItemRevisionStatus: {
    state: "PUBLISHED", distributionChannels: [{ crxVersion: "1.2.0", deployPercentage: 100 }]
  }
};

function checksum(data) {
  let value = 0xffffffff;
  for (const byte of data) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zip(entries = [["manifest.json", JSON.stringify({ manifest_version: 3, version: "1.2.1" })]]) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [filename, content] of entries) {
    const filenameBytes = Buffer.from(filename);
    const data = Buffer.from(content);
    const crc = checksum(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filenameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filenameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, filenameBytes, data);
    centrals.push(central, filenameBytes);
    offset += local.length + filenameBytes.length + data.length;
  }
  const centralData = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralData, end]);
}

function packageReader(archive = zip(), checksumOverride) {
  const digest = createHash("sha256").update(archive).digest("hex");
  return async (filename) => filename.endsWith(".sha256")
    ? checksumOverride ?? `${digest}  clipstar-v1.2.1.zip\n`
    : archive;
}

function scenario(responses, overrides = {}) {
  const requests = [];
  let time = 0;
  return {
    requests,
    options: {
      accessToken: "sensitive-test-access-token", publisherId, extensionId,
      version: "1.2.1", zipPath: "release/clipstar-v1.2.1.zip",
      readFileImpl: packageReader(),
      sleepImpl: async (milliseconds) => { time += milliseconds; },
      now: () => time,
      fetchImpl: async (url, init) => {
        requests.push({ url, ...init });
        assert.ok(responses.length > 0, "Unexpected extra API request");
        const response = responses.shift();
        if (response instanceof Error) throw response;
        if (typeof response === "function") return response(url, init);
        return { ok: true, status: 200, json: async () => response };
      },
      ...overrides
    }
  };
}

const upload = (uploadState = "SUCCEEDED", extra = {}) => ({
  ...identity, uploadState, ...(uploadState === "SUCCEEDED" ? { crxVersion: "1.2.1" } : {}), ...extra
});
const submission = (state = "PENDING_REVIEW") => ({ ...identity, state });

test("Chrome versions compare numerically and normalize omitted zero components", () => {
  assert.equal(compareVersions("1.10", "1.9.9999"), 1);
  assert.equal(compareVersions("1.2", "1.2.0.0"), 0);
  assert.deepEqual(parseVersion("0.1"), [0, 1, 0, 0]);
  for (const value of ["0", "0.0.0.0", "01.2", "1.02", "1.65536", "1.2.3.4.5", "1.2-beta", "1e2", undefined]) {
    assert.throws(() => parseVersion(value));
  }
});

test("verifies checksum, checksum filename and the manifest inside the actual archive", async () => {
  const result = await verifyReleasePackage("release/clipstar-v1.2.1.zip", "1.2.1", { readFileImpl: packageReader() });
  assert.equal(result.version, "1.2.1");
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  const archive = zip();
  const digest = createHash("sha256").update(archive).digest("hex");
  for (const checksumText of [`${"0".repeat(64)}  clipstar-v1.2.1.zip\n`, `${digest}  other.zip\n`]) {
    await assert.rejects(verifyReleasePackage("clipstar-v1.2.1.zip", "1.2.1", {
      readFileImpl: packageReader(archive, checksumText)
    }), /checksum/);
  }
  await assert.rejects(verifyReleasePackage("clipstar-v1.2.1.zip", "1.2.2", {
    readFileImpl: packageReader()
  }), /manifest version/);
});

test("rejects malformed, duplicate, non-root and ambiguous ZIP manifests", async () => {
  const brokenLocalName = zip();
  brokenLocalName[30] = "M".charCodeAt(0);
  const brokenCrc = zip();
  brokenCrc[30 + "manifest.json".length + 2] ^= 1;
  const invalidArchives = [
    Buffer.from("not a ZIP"), brokenLocalName, brokenCrc,
    zip([["nested/manifest.json", '{"version":"1.2.1"}']]),
    zip([["manifest.json", '{"version":"1.2.1"}'], ["manifest.json", '{"version":"1.2.1"}']]),
    zip([["manifest.json", "invalid json"]])
  ];
  for (const archive of invalidArchives) {
    await assert.rejects(verifyReleasePackage("clipstar-v1.2.1.zip", "1.2.1", {
      readFileImpl: packageReader(archive)
    }), /ZIP|manifest/);
  }
});

test("package verification always precedes any network request", async () => {
  const { options, requests } = scenario([], { readFileImpl: packageReader(zip(), "wrong checksum") });
  await assert.rejects(publishChromeWebStore(options), /checksum/);
  assert.equal(requests.length, 0);
});

test("preflight rejects policy flags, active submissions, ongoing uploads and unknown states", () => {
  for (const override of [
    { warned: true }, { takenDown: true }, { warned: "false" },
    { submittedItemRevisionStatus: { state: "PENDING_REVIEW" } },
    { submittedItemRevisionStatus: { state: "STAGED" } },
    { submittedItemRevisionStatus: { state: "FUTURE_STATE" } },
    { submittedItemRevisionStatus: { state: "REJECTED", distributionChannels: [{}] } },
    { lastAsyncUploadState: "IN_PROGRESS" }
  ]) {
    assert.throws(() => validatePreflight({ ...published, ...override }, "1.2.1"));
  }
  for (const previous of ["1.2.1", "1.2.1.0", "1.3"]) {
    assert.throws(() => validatePreflight({
      ...published,
      submittedItemRevisionStatus: { state: "REJECTED", distributionChannels: [{ crxVersion: previous }] }
    }, "1.2.1"), /newer/);
  }
  assert.throws(() => validatePreflight(published, "1.2.0"), /newer/);
  assert.doesNotThrow(() => validatePreflight(published, "1.2.1"));
});

test("synchronous upload is submitted with blocking warnings and reports pending review honestly", async () => {
  const { options, requests } = scenario([published, upload(), submission()]);
  const result = await publishChromeWebStore(options);
  assert.equal(result.state, "PENDING_REVIEW");
  assert.match(result.message, /not live yet/);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].method, "GET");
  assert.equal(requests[1].url, `https://chromewebstore.googleapis.com/upload/v2/${name}:upload`);
  assert.equal(requests[1].method, "POST");
  assert.equal(requests[1].headers["Content-Type"], "application/zip");
  assert.ok(Buffer.isBuffer(requests[1].body));
  assert.deepEqual(JSON.parse(requests[2].body), { publishType: "DEFAULT_PUBLISH", blockOnWarnings: true });
  assert.equal(requests[2].redirect, "error");
  assert.ok(!JSON.stringify(result).includes(options.accessToken));
});

test("async upload waits for the documented IN_PROGRESS to SUCCEEDED transition", async () => {
  const { options, requests } = scenario([
    published, upload("IN_PROGRESS"),
    { ...published, lastAsyncUploadState: "IN_PROGRESS" },
    { ...published, lastAsyncUploadState: "SUCCEEDED" }, submission("PUBLISHED")
  ]);
  const result = await publishChromeWebStore(options);
  assert.equal(result.state, "PUBLISHED");
  assert.deepEqual(requests.map((request) => request.method), ["GET", "POST", "GET", "GET", "POST"]);
});

test("never publishes after an unknown, failed, missing or mismatched upload result", async () => {
  for (const response of [
    upload("FAILED"), upload("NOT_FOUND"), upload("UPLOAD_IN_PROGRESS"),
    { ...identity }, upload("SUCCEEDED", { crxVersion: undefined }),
    upload("SUCCEEDED", { crxVersion: "9.0" })
  ]) {
    const { options, requests } = scenario([published, response]);
    await assert.rejects(publishChromeWebStore(options));
    assert.equal(requests.length, 2);
  }
  for (const state of ["FAILED", "NOT_FOUND", undefined]) {
    const { options, requests } = scenario([published, upload("IN_PROGRESS"), {
      ...published, lastAsyncUploadState: state
    }]);
    await assert.rejects(publishChromeWebStore(options), /not confirmed successful/);
    assert.equal(requests.length, 3);
  }
});

test("polling has both an elapsed-time limit and an attempt limit", async () => {
  const progress = { ...published, lastAsyncUploadState: "IN_PROGRESS" };
  const elapsed = scenario([published, upload("IN_PROGRESS"), progress], {
    pollTimeoutMs: 10_000, pollIntervalMs: 5_000
  });
  await assert.rejects(publishChromeWebStore(elapsed.options), /polling limit/);
  assert.equal(elapsed.requests.length, 3);
  const attempts = scenario([published, upload("IN_PROGRESS"), progress, progress], {
    pollIntervalMs: 0, maxPollAttempts: 2
  });
  await assert.rejects(publishChromeWebStore(attempts.options), /polling limit/);
  assert.equal(attempts.requests.length, 4);
});

test("a concurrent submission during upload processing prevents publication", async () => {
  const { options, requests } = scenario([published, upload("IN_PROGRESS"), {
    ...published, lastAsyncUploadState: "SUCCEEDED",
    submittedItemRevisionStatus: { state: "PENDING_REVIEW" }
  }]);
  await assert.rejects(publishChromeWebStore(options), /already pending/);
  assert.equal(requests.length, 3);
});

test("HTTP and network write failures are sanitized and never retried", async () => {
  const secret = "sensitive-test-access-token";
  for (const failure of [
    new Error(`Chrome Web Store malicious error: ${secret}`),
    async () => ({ ok: false, status: 503, json: async () => ({ error: { message: secret } }) })
  ]) {
    const { options, requests } = scenario([published, failure]);
    await assert.rejects(publishChromeWebStore(options), (error) => {
      assert.ok(!error.message.includes(secret));
      assert.match(error.message, /before retrying/);
      return true;
    });
    assert.equal(requests.length, 2);
  }
  const { options, requests } = scenario([published, upload(), new Error(secret)]);
  await assert.rejects(publishChromeWebStore(options), (error) => !error.message.includes(secret));
  assert.equal(requests.length, 3);
});

test("an unresponsive API is bounded and does not result in subsequent writes", async () => {
  const { options, requests } = scenario([() => new Promise(() => {})], { requestTimeoutMs: 5 });
  await assert.rejects(publishChromeWebStore(options), /timed out/);
  assert.equal(requests.length, 1);
});

test("identity mismatch, unknown submission states and returned warnings fail closed", async () => {
  const wrongItem = scenario([{ ...published, itemId: "a".repeat(32) }]);
  await assert.rejects(publishChromeWebStore(wrongItem.options), /identity/);
  assert.equal(wrongItem.requests.length, 1);
  for (const response of [submission("REJECTED"), submission("UNKNOWN"), {
    ...submission(), warningInfo: { warnings: [{ description: "sensitive-test-access-token" }] }
  }]) {
    const { options } = scenario([published, upload(), response]);
    await assert.rejects(publishChromeWebStore(options), (error) => {
      assert.ok(!error.message.includes(options.accessToken));
      assert.match(error.message, /unexpected submission/);
      return true;
    });
  }
});

test("authentication check is read-only and returns only identity and useful status", async () => {
  const { options, requests } = scenario([{
    ...published, publicKey: "not-needed", submittedItemRevisionStatus: { state: "PENDING_REVIEW" }
  }]);
  const result = await checkAuthentication(options);
  assert.equal(result.authenticated, true);
  assert.equal(result.itemId, extensionId);
  assert.equal(result.submitted.state, "PENDING_REVIEW");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, "GET");
  assert.equal(result.publicKey, undefined);
  assert.ok(!JSON.stringify(result).includes(options.accessToken));
});

test("CLI rejects ambiguous or incomplete invocations before contacting the store", async () => {
  for (const args of [[], ["--version", "1.2.1"], ["--unknown"], ["--check-auth", "--zip", "file.zip"],
    ["--version", "1.2.1", "--version", "1.2.2", "--zip", "file.zip"]]) {
    await assert.rejects(runCli(args, {}), /Usage/);
  }
  await assert.rejects(runCli(["--check-auth"], {}), /CWS_PUBLISHER_ID/);
});
