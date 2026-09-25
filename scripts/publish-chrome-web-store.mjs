import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const API_ORIGIN = "https://chromewebstore.googleapis.com";
const ITEM_STATES = new Set([
  "PENDING_REVIEW", "STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS", "REJECTED", "CANCELLED"
]);
class StoreRequestError extends Error {}

export function parseVersion(version) {
  if (typeof version !== "string" || !/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(version)) {
    throw new Error("The version must contain one to four dot-separated integers without leading zeros.");
  }
  const parts = version.split(".").map(Number);
  if (parts.some((part) => part > 65535) || parts.every((part) => part === 0)) {
    throw new Error("Version components must be at most 65535 and cannot all be zero.");
  }
  return [...parts, ...Array(4 - parts.length).fill(0)];
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 4; index += 1) {
    if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
  }
  return 0;
}

function crc32(data) {
  let checksum = 0xffffffff;
  for (const byte of data) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      checksum = (checksum >>> 1) ^ (0xedb88320 & -(checksum & 1));
    }
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

// Accept only the uncompressed ZIP32 format produced by scripts/build.mjs.
// Checking both ZIP directories prevents ambiguity about which manifest is uploaded.
function archiveManifest(archive) {
  const invalid = () => new Error("Invalid release ZIP. Rebuild it with npm run build.");
  if (!Buffer.isBuffer(archive) || archive.length < 22) throw invalid();
  const end = archive.length - 22;
  if (archive.readUInt32LE(end) !== 0x06054b50 || archive.readUInt32LE(end + 4) !== 0 ||
      archive.readUInt16LE(end + 20) !== 0) throw invalid();
  const count = archive.readUInt16LE(end + 10);
  const directorySize = archive.readUInt32LE(end + 12);
  const directoryOffset = archive.readUInt32LE(end + 16);
  if (count === 0 || count !== archive.readUInt16LE(end + 8) ||
      directoryOffset + directorySize !== end) throw invalid();

  let cursor = directoryOffset;
  let localCursor = 0;
  let manifest;
  const names = new Set();
  for (let entry = 0; entry < count; entry += 1) {
    if (cursor + 46 > end || archive.readUInt32LE(cursor) !== 0x02014b50) throw invalid();
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const size = archive.readUInt32LE(cursor + 20);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const localOffset = archive.readUInt32LE(cursor + 42);
    if (flags !== 0x0800 || method !== 0 || size !== archive.readUInt32LE(cursor + 24) ||
        nameLength === 0 || archive.readUInt16LE(cursor + 30) !== 0 ||
        archive.readUInt16LE(cursor + 32) !== 0 || archive.readUInt16LE(cursor + 34) !== 0 ||
        localOffset !== localCursor || cursor + 46 + nameLength > end ||
        localOffset + 30 > directoryOffset) throw invalid();
    const nameBytes = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBytes.toString("utf8");
    if (names.has(name) || name.includes("\\") || name.includes("\0") ||
        name.split("/").some((part) => !part || part === "." || part === "..")) throw invalid();
    names.add(name);
    const dataStart = localOffset + 30 + nameLength;
    const dataEnd = dataStart + size;
    if (dataEnd > directoryOffset || archive.readUInt32LE(localOffset) !== 0x04034b50 ||
        archive.readUInt16LE(localOffset + 6) !== flags || archive.readUInt16LE(localOffset + 8) !== method ||
        archive.readUInt32LE(localOffset + 14) !== checksum ||
        archive.readUInt32LE(localOffset + 18) !== size || archive.readUInt32LE(localOffset + 22) !== size ||
        archive.readUInt16LE(localOffset + 26) !== nameLength || archive.readUInt16LE(localOffset + 28) !== 0 ||
        !archive.subarray(localOffset + 30, dataStart).equals(nameBytes)) throw invalid();
    const data = archive.subarray(dataStart, dataEnd);
    if (crc32(data) !== checksum) throw invalid();
    if (name === "manifest.json") manifest = data;
    localCursor = dataEnd;
    cursor += 46 + nameLength;
  }
  if (cursor !== end || localCursor !== directoryOffset || !manifest) throw invalid();
  try {
    return JSON.parse(manifest.toString("utf8"));
  } catch {
    throw new Error("The release ZIP contains an invalid manifest.json.");
  }
}

export async function verifyReleasePackage(zipPath, version, { readFileImpl = readFile } = {}) {
  parseVersion(version);
  if (typeof zipPath !== "string" || !zipPath.endsWith(".zip")) {
    throw new Error("Provide the release ZIP using --zip.");
  }
  let archive;
  let checksumText;
  try {
    [archive, checksumText] = await Promise.all([
      readFileImpl(zipPath), readFileImpl(`${zipPath}.sha256`, "utf8")
    ]);
  } catch {
    throw new Error("Cannot read the release ZIP and its .sha256 file. Run npm run build first.");
  }
  const checksumMatch = /^([a-fA-F0-9]{64}) {2}([^\r\n]+)\r?\n?$/.exec(checksumText);
  const sha256 = createHash("sha256").update(archive).digest("hex");
  if (!checksumMatch || checksumMatch[2] !== path.basename(zipPath) ||
      checksumMatch[1].toLowerCase() !== sha256) {
    throw new Error("Release ZIP checksum verification failed. Rebuild the release package.");
  }
  const manifest = archiveManifest(archive);
  if (!manifest || manifest.version !== version) {
    throw new Error("The manifest version inside the release ZIP does not match --version.");
  }
  return { archive, version, sha256 };
}

function itemName(publisherId, extensionId) {
  if (typeof publisherId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(publisherId)) {
    throw new Error("Set CWS_PUBLISHER_ID to the publisher ID from the Chrome Web Store dashboard.");
  }
  if (typeof extensionId !== "string" || !/^[a-p]{32}$/.test(extensionId)) {
    throw new Error("Set CWS_EXTENSION_ID to the 32-letter Chrome Web Store extension ID.");
  }
  return `publishers/${publisherId}/items/${extensionId}`;
}

function validateIdentity(response, name, extensionId) {
  if (!response || typeof response !== "object" || Array.isArray(response) ||
      response.name !== name || response.itemId !== extensionId) {
    throw new StoreRequestError("Chrome Web Store returned an unexpected item identity. Check the dashboard before retrying.");
  }
}

function revisionDetails(revision) {
  if (revision === undefined) return undefined;
  if (!revision || !ITEM_STATES.has(revision.state) ||
      (revision.distributionChannels !== undefined && !Array.isArray(revision.distributionChannels))) {
    throw new Error("Chrome Web Store returned an unknown revision status. Check the dashboard before retrying.");
  }
  const versions = (revision.distributionChannels ?? []).map((channel) => {
    if (!channel || typeof channel.crxVersion !== "string") {
      throw new Error("Chrome Web Store returned incomplete revision version information.");
    }
    parseVersion(channel.crxVersion);
    return channel.crxVersion;
  });
  return { state: revision.state, versions };
}

function statusDetails(status) {
  if (!status || typeof status !== "object" || Array.isArray(status)) {
    throw new Error("Chrome Web Store returned an invalid item status.");
  }
  for (const flag of ["warned", "takenDown"]) {
    if (status[flag] !== undefined && typeof status[flag] !== "boolean") {
      throw new Error("Chrome Web Store returned an unknown policy status.");
    }
  }
  return {
    published: revisionDetails(status.publishedItemRevisionStatus),
    submitted: revisionDetails(status.submittedItemRevisionStatus),
    warned: status.warned === true,
    takenDown: status.takenDown === true
  };
}

export function validatePreflight(status, version) {
  parseVersion(version);
  const details = statusDetails(status);
  if (details.warned || details.takenDown) {
    throw new Error("The extension has a policy warning or takedown. Resolve it in the Chrome Web Store dashboard first.");
  }
  if ([details.published, details.submitted].some((revision) =>
    revision && ["PENDING_REVIEW", "STAGED"].includes(revision.state))) {
    throw new Error("A submission is already pending review or staged. Resolve it in the dashboard before publishing another version.");
  }
  if (status.lastAsyncUploadState === "IN_PROGRESS") {
    throw new Error("A previous package upload is still processing. Check its status before starting another upload.");
  }
  for (const revision of [details.published, details.submitted]) {
    for (const previousVersion of revision?.versions ?? []) {
      if (compareVersions(version, previousVersion) <= 0) {
        throw new Error("The release version must be newer than every published and submitted version.");
      }
    }
  }
  return details;
}

function createClient({ accessToken, publisherId, extensionId, fetchImpl = globalThis.fetch,
  requestTimeoutMs = 30_000 }) {
  const name = itemName(publisherId, extensionId);
  if (typeof accessToken !== "string" || !accessToken.trim() || /[\r\n]/.test(accessToken)) {
    throw new Error("Set CWS_ACCESS_TOKEN to a short-lived token with the Chrome Web Store scope.");
  }
  if (typeof fetchImpl !== "function" || !Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("Invalid Chrome Web Store client configuration.");
  }
  async function request(operation, { body, timeoutMs = requestTimeoutMs } = {}) {
    const isUpload = operation === "upload";
    const controller = new AbortController();
    let timeout;
    try {
      const result = await Promise.race([
        (async () => {
          const response = await fetchImpl(
            `${API_ORIGIN}${isUpload ? "/upload" : ""}/v2/${name}:${operation}`,
            {
              method: operation === "fetchStatus" ? "GET" : "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                ...(body === undefined ? {} : { "Content-Type": isUpload ? "application/zip" : "application/json" })
              },
              ...(body === undefined ? {} : { body: isUpload ? body : JSON.stringify(body) }),
              redirect: "error",
              signal: controller.signal
            }
          );
          if (!response.ok) return { failure: `HTTP ${Number.isInteger(response.status) ? response.status : "error"}` };
          return { data: await response.json() };
        })(),
        new Promise((resolve) => {
          timeout = setTimeout(() => {
            controller.abort();
            resolve({ failure: "request timed out" });
          }, Math.min(timeoutMs, requestTimeoutMs));
        })
      ]);
      if (result.failure) {
        throw new StoreRequestError(`Chrome Web Store ${operation} failed (${result.failure}). Check the dashboard before retrying; writes are never retried automatically.`);
      }
      validateIdentity(result.data, name, extensionId);
      return result.data;
    } catch (error) {
      // Never print provider response bodies or network errors, which may include credentials.
      if (error instanceof StoreRequestError) throw error;
      throw new Error(`Chrome Web Store ${operation} did not return a valid response. Check the dashboard before retrying; writes are never retried automatically.`);
    } finally {
      clearTimeout(timeout);
    }
  }
  return { request };
}

export async function checkAuthentication(options) {
  const { request } = createClient(options);
  const status = await request("fetchStatus");
  return { authenticated: true, itemId: options.extensionId, ...statusDetails(status) };
}

export async function publishChromeWebStore(options) {
  const { zipPath, version, readFileImpl, sleepImpl = sleep, now = Date.now,
    pollIntervalMs = 5_000, pollTimeoutMs = 120_000, maxPollAttempts = 24 } = options;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0 ||
      !Number.isFinite(pollTimeoutMs) || pollTimeoutMs <= 0 ||
      !Number.isInteger(maxPollAttempts) || maxPollAttempts < 1) {
    throw new Error("Invalid upload polling configuration.");
  }
  const { archive, sha256 } = await verifyReleasePackage(zipPath, version, { readFileImpl });
  const { request } = createClient(options);
  validatePreflight(await request("fetchStatus"), version);
  const upload = await request("upload", { body: archive });
  if (upload.crxVersion !== undefined && upload.crxVersion !== version) {
    throw new Error("Chrome Web Store reported a different uploaded version. Check the dashboard before retrying.");
  }
  let uploadState = upload.uploadState;
  if (uploadState === "SUCCEEDED" && upload.crxVersion === undefined) {
    throw new Error("Chrome Web Store did not confirm the uploaded version. Check the dashboard before retrying.");
  }
  const deadline = now() + pollTimeoutMs;
  for (let attempt = 0; uploadState === "IN_PROGRESS" && attempt < maxPollAttempts; attempt += 1) {
    const remaining = deadline - now();
    if (remaining <= 0) break;
    await sleepImpl(Math.min(pollIntervalMs, remaining));
    const requestRemaining = deadline - now();
    if (requestRemaining <= 0) break;
    const status = await request("fetchStatus", { timeoutMs: requestRemaining });
    validatePreflight({ ...status, lastAsyncUploadState: undefined }, version);
    uploadState = status.lastAsyncUploadState;
  }
  if (uploadState !== "SUCCEEDED") {
    throw new Error("The upload was not confirmed successful within the polling limit. No publish request was sent. Check the dashboard before retrying.");
  }
  const submission = await request("publish", {
    body: { publishType: "DEFAULT_PUBLISH", blockOnWarnings: true }
  });
  if (!["PENDING_REVIEW", "PUBLISHED", "PUBLISHED_TO_TESTERS", "STAGED"].includes(submission.state) ||
      (submission.warningInfo !== undefined &&
        (!submission.warningInfo || (submission.warningInfo.warnings !== undefined &&
          (!Array.isArray(submission.warningInfo.warnings) || submission.warningInfo.warnings.length > 0))))) {
    throw new Error("Chrome Web Store returned an unexpected submission result. Check the dashboard before retrying.");
  }
  return {
    itemId: options.extensionId, version, sha256, state: submission.state,
    message: {
      PENDING_REVIEW: "Submitted for Chrome Web Store review. The update is not live yet.",
      PUBLISHED: "Chrome Web Store reports the update as published. Browser updates may take time.",
      PUBLISHED_TO_TESTERS: "Chrome Web Store reports the update as published to trusted testers.",
      STAGED: "Approved and staged. The update is awaiting publication."
    }[submission.state]
  };
}

export async function runCli(args = process.argv.slice(2), env = process.env) {
  const options = {
    accessToken: env.CWS_ACCESS_TOKEN,
    publisherId: env.CWS_PUBLISHER_ID,
    extensionId: env.CWS_EXTENSION_ID
  };
  if (args.length === 1 && args[0] === "--check-auth") return checkAuthentication(options);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!["--version", "--zip"].includes(flag) || values.has(flag) || !args[index + 1] || args[index + 1].startsWith("--")) {
      throw new Error("Usage: --check-auth OR --version VERSION --zip RELEASE.zip");
    }
    values.set(flag, args[index + 1]);
  }
  if (values.size !== 2) throw new Error("Usage: --check-auth OR --version VERSION --zip RELEASE.zip");
  return publishChromeWebStore({ ...options, version: values.get("--version"), zipPath: values.get("--zip") });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    console.log(JSON.stringify(await runCli(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Chrome Web Store publishing failed.");
    process.exitCode = 1;
  }
}
