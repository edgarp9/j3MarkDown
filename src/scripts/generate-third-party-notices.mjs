#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const TAURI_DIR = path.join(ROOT_DIR, "src-tauri");
const NOTICE_PATH = path.join(ROOT_DIR, "THIRD-PARTY-NOTICES.txt");
const CHECK_MODE = process.argv.includes("--check");
const WINDOWS_RELEASE_TARGET = "x86_64-pc-windows-msvc";
const MAX_NOTICE_FILE_BYTES = 512 * 1024;

function main() {
  const npmEntries = getNpmLicenseEntries();
  const rustEntries = getRustRuntimeLicenseEntries();
  const entries = [...npmEntries, ...rustEntries];

  assertNoBlockedLicenses(entries);

  const noticeText = renderNoticeFile({ npmEntries, rustEntries });

  if (CHECK_MODE) {
    checkNoticeFile(noticeText);
    return;
  }

  writeFileSync(NOTICE_PATH, noticeText, "utf8");
  console.log(`Wrote ${path.relative(ROOT_DIR, NOTICE_PATH)}`);
}

function getNpmLicenseEntries() {
  const output = runCommand(
    "corepack",
    ["pnpm", "licenses", "list", "--prod", "--json"],
    ROOT_DIR,
  );
  const licenses = JSON.parse(output);
  const entries = [];

  for (const license of Object.keys(licenses).sort(compareText)) {
    for (const packageInfo of licenses[license]) {
      const packagePaths = Array.isArray(packageInfo.paths) ? packageInfo.paths : [];

      entries.push({
        ecosystem: "npm",
        name: packageInfo.name,
        versions: normalizeVersions(packageInfo.versions),
        license,
        description: packageInfo.description ?? "",
        homepage: packageInfo.homepage ?? "",
        repository: "",
        author: packageInfo.author ?? "",
        noticeFiles: readNoticeFilesFromDirectories(packagePaths),
      });
    }
  }

  return entries.sort(compareEntries);
}

function getRustRuntimeLicenseEntries() {
  const output = runCommand(
    "cargo",
    [
      "metadata",
      "--format-version",
      "1",
      "--locked",
      "--filter-platform",
      WINDOWS_RELEASE_TARGET,
    ],
    TAURI_DIR,
  );
  const metadata = JSON.parse(output);
  const runtimePackageIds = collectRustRuntimePackageIds(metadata);
  const packagesById = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const entries = [];

  for (const packageId of runtimePackageIds) {
    const packageInfo = packagesById.get(packageId);

    if (!packageInfo || !packageInfo.source) {
      continue;
    }

    const packageRoot = path.dirname(packageInfo.manifest_path);
    const noticeFiles = readNoticeFilesFromDirectories([packageRoot]);
    addCargoLicenseFile(noticeFiles, packageInfo, packageRoot);

    entries.push({
      ecosystem: "cargo",
      name: packageInfo.name,
      versions: packageInfo.version,
      license: packageInfo.license ?? "UNKNOWN",
      description: packageInfo.description ?? "",
      homepage: packageInfo.homepage ?? "",
      repository: packageInfo.repository ?? "",
      author: Array.isArray(packageInfo.authors)
        ? packageInfo.authors.join(", ")
        : "",
      noticeFiles,
    });
  }

  return entries.sort(compareEntries);
}

function collectRustRuntimePackageIds(metadata) {
  const nodesById = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const seen = new Set();
  const queue = [];
  const rootNode = nodesById.get(metadata.resolve.root);

  if (!rootNode) {
    throw new Error("Cargo metadata did not include the root resolve node.");
  }

  enqueueNormalDependencies(rootNode, queue);

  while (queue.length > 0) {
    const packageId = queue.shift();

    if (seen.has(packageId)) {
      continue;
    }

    seen.add(packageId);
    const node = nodesById.get(packageId);

    if (node) {
      enqueueNormalDependencies(node, queue);
    }
  }

  return [...seen].sort(compareText);
}

function enqueueNormalDependencies(node, queue) {
  for (const dependency of node.deps ?? []) {
    if (hasNormalDependencyKind(dependency.dep_kinds)) {
      queue.push(dependency.pkg);
    }
  }
}

function hasNormalDependencyKind(depKinds) {
  return (depKinds ?? []).some((depKind) => depKind.kind === null);
}

function addCargoLicenseFile(noticeFiles, packageInfo, packageRoot) {
  if (!packageInfo.license_file) {
    return;
  }

  const licenseFilePath = path.isAbsolute(packageInfo.license_file)
    ? packageInfo.license_file
    : path.join(packageRoot, packageInfo.license_file);

  if (!existsSync(licenseFilePath)) {
    return;
  }

  const text = readNoticeFile(licenseFilePath);
  if (!text) {
    return;
  }

  const name = path.basename(licenseFilePath);
  if (noticeFiles.some((file) => file.name === name && file.text === text)) {
    return;
  }

  noticeFiles.push({ name, text });
}

function readNoticeFilesFromDirectories(directories) {
  const files = [];
  const seen = new Set();

  for (const directory of directories) {
    if (!directory || !existsSync(directory)) {
      continue;
    }

    for (const fileName of getRootNoticeFileNames(directory)) {
      const filePath = path.join(directory, fileName);
      const text = readNoticeFile(filePath);

      if (!text) {
        continue;
      }

      const key = `${fileName}\n${text}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      files.push({ name: fileName, text });
    }
  }

  return files.sort((left, right) => compareText(left.name, right.name));
}

function getRootNoticeFileNames(directory) {
  return readdirSync(directory)
    .filter((fileName) => isNoticeFileName(fileName))
    .filter((fileName) => statSync(path.join(directory, fileName)).isFile())
    .sort(compareText);
}

function isNoticeFileName(fileName) {
  const lowerName = fileName.toLowerCase();

  return (
    /^licen[cs]e($|[._-])/u.test(lowerName) ||
    /^copying($|[._-])/u.test(lowerName) ||
    /^notice($|[._-])/u.test(lowerName) ||
    /^copyright($|[._-])/u.test(lowerName)
  );
}

function readNoticeFile(filePath) {
  const stats = statSync(filePath);

  if (stats.size > MAX_NOTICE_FILE_BYTES) {
    return `Notice file omitted because it is larger than ${MAX_NOTICE_FILE_BYTES} bytes: ${path.basename(filePath)}`;
  }

  return readFileSync(filePath, "utf8")
    .replace(/\r\n?/gu, "\n")
    .replace(/\u0000/gu, "")
    .trim();
}

function assertNoBlockedLicenses(entries) {
  const blockedEntries = entries.filter((entry) => {
    return !entry.license || /\b(?:AGPL|GPL|LGPL)\b/iu.test(entry.license);
  });

  if (blockedEntries.length === 0) {
    return;
  }

  const names = blockedEntries
    .map((entry) => `${entry.ecosystem}:${entry.name}@${entry.versions} (${entry.license})`)
    .join("\n  ");

  throw new Error(
    `Manual license review is required before release for:\n  ${names}`,
  );
}

function renderNoticeFile({ npmEntries, rustEntries }) {
  const allEntries = [...npmEntries, ...rustEntries];
  const licenses = [...new Set(allEntries.map((entry) => entry.license))].sort(compareText);
  const mplEntries = allEntries.filter((entry) => /\bMPL-2\.0\b/u.test(entry.license));

  return [
    "Third-Party Notices for j3Markdown",
    "",
    "This file is generated by scripts/generate-third-party-notices.mjs.",
    "Do not edit this file manually. Run `corepack pnpm licenses:generate` after dependency changes.",
    "",
    "Scope",
    "-----",
    `- npm production dependencies from package.json and pnpm-lock.yaml: ${npmEntries.length}`,
    `- Rust runtime dependencies for ${WINDOWS_RELEASE_TARGET} from src-tauri/Cargo.lock: ${rustEntries.length}`,
    "- Development and build tools are outside this runtime notice unless they are redistributed.",
    "",
    "Detected License Expressions",
    "----------------------------",
    ...licenses.map((license) => `- ${license}`),
    "",
    "MPL Source Availability",
    "-----------------------",
    ...renderMplSourceAvailability(mplEntries),
    "",
    "npm Production Dependencies",
    "---------------------------",
    ...renderEntries(npmEntries),
    "",
    `Rust Runtime Dependencies (${WINDOWS_RELEASE_TARGET})`,
    "------------------------------------------------",
    ...renderEntries(rustEntries),
    "",
  ].join("\n");
}

function renderMplSourceAvailability(entries) {
  if (entries.length === 0) {
    return ["No runtime dependency currently reports an MPL-2.0 license expression."];
  }

  return [
    "The following runtime dependencies report an MPL-2.0 license expression.",
    "Source code for npm packages is available from the package registry or listed homepage.",
    "Source code for Cargo packages is available from crates.io, the listed repository, or the Cargo registry source package for the version shown here.",
    "",
    ...entries.map((entry) => {
      const source = entry.repository || entry.homepage || "package registry source";
      return `- ${entry.ecosystem}:${entry.name}@${entry.versions} (${entry.license}) - ${source}`;
    }),
  ];
}

function renderEntries(entries) {
  return entries.flatMap((entry) => {
    const lines = [
      "-------------------------------------------------------------------------------",
      `Package: ${entry.name}`,
      `Version(s): ${entry.versions}`,
      `Ecosystem: ${entry.ecosystem}`,
      `License: ${entry.license}`,
    ];

    appendOptionalLine(lines, "Author", entry.author);
    appendOptionalLine(lines, "Homepage", entry.homepage);
    appendOptionalLine(lines, "Repository", entry.repository);
    appendOptionalLine(lines, "Description", entry.description);

    if (entry.noticeFiles.length === 0) {
      lines.push(
        "",
        "Package license or notice text was not found in the installed package root.",
      );
      return lines;
    }

    for (const noticeFile of entry.noticeFiles) {
      lines.push("", `--- ${noticeFile.name} ---`, noticeFile.text);
    }

    return lines;
  });
}

function appendOptionalLine(lines, label, value) {
  if (value) {
    lines.push(`${label}: ${value}`);
  }
}

function checkNoticeFile(expectedText) {
  if (!existsSync(NOTICE_PATH)) {
    throw new Error("THIRD-PARTY-NOTICES.txt is missing. Run `corepack pnpm licenses:generate`.");
  }

  const actualText = readFileSync(NOTICE_PATH, "utf8").replace(/\r\n?/gu, "\n");

  if (actualText !== expectedText) {
    throw new Error("THIRD-PARTY-NOTICES.txt is stale. Run `corepack pnpm licenses:generate`.");
  }

  console.log("THIRD-PARTY-NOTICES.txt is up to date.");
}

function normalizeVersions(versions) {
  return Array.isArray(versions) ? versions.join(", ") : String(versions ?? "");
}

function compareEntries(left, right) {
  return (
    compareText(left.name, right.name) ||
    compareText(left.versions, right.versions) ||
    compareText(left.license, right.license)
  );
}

function compareText(left, right) {
  return String(left).localeCompare(String(right), "en");
}

function runCommand(command, args, cwd) {
  const invocation = getCommandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}\n${result.stderr}`,
    );
  }

  return result.stdout;
}

function getCommandInvocation(command, args) {
  if (process.platform === "win32" && command === "corepack") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }

  return { command, args };
}

main();
