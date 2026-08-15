import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(root, "extension");
const stageRoot = path.join(root, "dist", "clipstar");
const releaseRoot = path.join(root, "release");
const validation = spawnSync(process.execPath, [path.join(root, "scripts", "validate.mjs")], {
  cwd: root,
  encoding: "utf8",
  stdio: "inherit"
});

if (validation.status !== 0) process.exit(validation.status || 1);

const manifest = JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));
const archiveName = `clipstar-v${manifest.version}.zip`;
const archivePath = path.join(releaseRoot, archiveName);
const checksumPath = path.join(releaseRoot, `${archiveName}.sha256`);

await rm(path.join(root, "dist"), { recursive: true, force: true });
await rm(archivePath, { force: true });
await rm(checksumPath, { force: true });
await mkdir(stageRoot, { recursive: true });
await mkdir(releaseRoot, { recursive: true });

for (const relativePath of [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "icons",
  "lib"
]) {
  await cp(path.join(extensionRoot, relativePath), path.join(stageRoot, relativePath), {
    recursive: true
  });
}

const stagedPaths = await listFiles(stageRoot);
if (!stagedPaths.includes("manifest.json")) {
  throw new Error("The release archive does not contain manifest.json at its root.");
}

const archive = await createZip(stageRoot, stagedPaths);
await writeFile(archivePath, archive);

const checksum = createHash("sha256").update(archive).digest("hex");
await writeFile(checksumPath, `${checksum}  ${archiveName}\n`);
console.log(`Built release/${archiveName}`);
console.log(`SHA-256 ${checksum}`);

async function listFiles(directory) {
  const files = [];

  async function walk(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => compareText(left.name, right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push(path.relative(directory, absolutePath).split(path.sep).join("/"));
      } else {
        throw new Error(`Unsupported staged entry: ${absolutePath}`);
      }
    }
  }

  await walk(directory);
  return files.sort(compareText);
}

async function createZip(directory, relativePaths) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;

  for (const relativePath of relativePaths) {
    const name = Buffer.from(relativePath, "utf8");
    const data = await readFile(path.join(directory, ...relativePath.split("/")));
    const checksum = crc32(data);
    assertZip32(data.length, `File is too large for a ZIP32 archive: ${relativePath}`);
    assertZip16(name.length, `File name is too long for a ZIP archive: ${relativePath}`);
    assertZip32(localOffset, "Release archive is too large for ZIP32.");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0x5c21, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x0314, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5c21, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);

    localRecords.push(localHeader, name, data);
    centralRecords.push(centralHeader, name);
    localOffset += localHeader.length + name.length + data.length;
  }

  assertZip16(relativePaths.length, "Release archive has too many files for ZIP32.");
  const centralDirectory = Buffer.concat(centralRecords);
  assertZip32(localOffset, "Release archive is too large for ZIP32.");
  assertZip32(centralDirectory.length, "ZIP central directory is too large for ZIP32.");

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(relativePaths.length, 8);
  endOfCentralDirectory.writeUInt16LE(relativePaths.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(localOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localRecords, centralDirectory, endOfCentralDirectory]);
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

function assertZip16(value, message) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) throw new Error(message);
}

function assertZip32(value, message) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) throw new Error(message);
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
