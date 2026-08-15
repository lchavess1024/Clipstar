import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionRoot = path.join(root, "extension");
const manifestPath = path.join(extensionRoot, "manifest.json");
const packagePath = path.join(root, "package.json");
const errors = [];
const requiredPermissions = ["activeTab", "clipboardWrite", "contextMenus", "scripting", "storage"];
const allowedRuntimeUrls = new Set([
  "https://github.com/lchavess1024",
  "https://github.com/lchavess1024/Clipstar"
]);

const manifest = await readJson(manifestPath, "manifest.json");
const packageJson = await readJson(packagePath, "package.json");

if (manifest) {
  check(manifest.manifest_version === 3, "manifest_version must be 3");
  check(manifest.name === "Clipstar", "manifest name must be Clipstar");
  check(manifest.version === packageJson?.version, "manifest and package versions must match");
  check(
    typeof manifest.description === "string" && Array.from(manifest.description).length <= 132,
    "manifest description must be 132 characters or fewer"
  );
  check(manifest.minimum_chrome_version === "114", "minimum Chrome version must match the storage quota requirement");
  check(!manifest.host_permissions, "host_permissions must stay absent; Clipstar uses activeTab");
  check(!manifest.content_scripts, "static content_scripts must stay absent; injection is user-triggered");
  check(
    JSON.stringify([...(manifest.permissions || [])].sort()) === JSON.stringify(requiredPermissions),
    `permissions must be exactly: ${requiredPermissions.join(", ")}`
  );
  check(
    manifest.background?.service_worker === "background.js" && manifest.background?.type === "module",
    "background service worker must be background.js as a module"
  );

  const referencedFiles = new Set([
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    ...Object.values(manifest.action?.default_icon || {}),
    ...Object.values(manifest.icons || {})
  ]);
  for (const relativePath of referencedFiles) {
    if (relativePath) await checkFile(relativePath);
  }

  for (const [declaredSize, relativePath] of Object.entries(manifest.icons || {})) {
    await checkPngSize(relativePath, Number(declaredSize));
  }
}

const runtimeFiles = await listFiles(extensionRoot);
for (const filePath of runtimeFiles) {
  const relativePath = path.relative(extensionRoot, filePath);
  if (filePath.endsWith(".js")) {
    const source = await readFile(filePath, "utf8");
    const syntax = spawnSync(process.execPath, ["--check", filePath], { encoding: "utf8" });
    if (syntax.status !== 0) errors.push(`${relativePath}: ${syntax.stderr.trim() || "invalid JavaScript"}`);
    for (const match of source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)) {
      try {
        const imported = await stat(path.resolve(path.dirname(filePath), match[1]));
        check(imported.isFile(), `${relativePath}: import ${match[1]} is not a file`);
      } catch (_) {
        errors.push(`${relativePath}: import ${match[1]} is missing`);
      }
    }
  }

  if (/\.(?:js|html|css|json)$/i.test(filePath)) {
    const source = await readFile(filePath, "utf8");
    const forbidden = [
      ["YOUR-USERNAME", "contains a repository placeholder"],
      ["YOUR-REPOSITORY", "contains a repository placeholder"],
      ["Luis Clippings", "contains old public branding"],
      ["<all_urls>", "contains persistent all-site access"],
      ["createElement(\"script\")", "creates a page script element"],
      ["createElement('script')", "creates a page script element"]
    ];
    for (const [needle, message] of forbidden) {
      if (source.includes(needle)) errors.push(`${relativePath}: ${message}`);
    }
    if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(source)) {
      errors.push(`${relativePath}: contains dynamic code evaluation`);
    }
    for (const match of source.matchAll(/https?:\/\/[^"'<>\s)]+/gi)) {
      if (!allowedRuntimeUrls.has(match[0])) {
        errors.push(`${relativePath}: runtime source contains an unapproved remote URL`);
      }
    }
  }
}

const popupHtml = await readFile(path.join(extensionRoot, "popup.html"), "utf8");
const popupJs = await readFile(path.join(extensionRoot, "popup.js"), "utf8");
for (const match of popupJs.matchAll(/byId\("([^"]+)"\)/g)) {
  check(popupHtml.includes(`id="${match[1]}"`), `popup.html is missing #${match[1]}`);
}
for (const match of popupHtml.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (!/^(?:https?:|data:)/.test(match[1])) await checkFile(match[1]);
}
check(
  popupHtml.includes('href="https://github.com/lchavess1024/Clipstar"'),
  "popup.html must link the privacy concern text to the Clipstar GitHub repository"
);
check(
  popupHtml.includes('href="https://github.com/lchavess1024"'),
  "popup.html must link the GitHub icon to the developer's profile"
);

if (errors.length) {
  console.error(`Validation failed with ${errors.length} ${errors.length === 1 ? "error" : "errors"}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Validated ${runtimeFiles.length} runtime files for Clipstar ${manifest.version}.`);
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
    return null;
  }
}

async function checkFile(relativePath) {
  try {
    const details = await stat(path.join(extensionRoot, relativePath));
    check(details.isFile(), `${relativePath} must be a file`);
  } catch (_) {
    errors.push(`${relativePath}: referenced file is missing`);
  }
}

async function checkPngSize(relativePath, expectedSize) {
  try {
    const data = await readFile(path.join(extensionRoot, relativePath));
    const signature = data.subarray(0, 8).toString("hex");
    check(signature === "89504e470d0a1a0a", `${relativePath} must be a PNG`);
    check(
      data.readUInt32BE(16) === expectedSize && data.readUInt32BE(20) === expectedSize,
      `${relativePath} must be ${expectedSize}×${expectedSize}`
    );
  } catch (error) {
    errors.push(`${relativePath}: ${error.message}`);
  }
}

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    if (entry.isFile()) files.push(fullPath);
  }
  return files.sort();
}

function check(condition, message) {
  if (!condition) errors.push(message);
}
