import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/;

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function isWorkingTreeClean() {
  return runGit(['status', '--porcelain']).length === 0;
}

function normalizeVersion(rawVersion) {
  const match = rawVersion?.trim().match(SEMVER_RE);
  if (!match) {
    throw new Error(`Invalid version "${rawVersion}". Expected x.y.z or vx.y.z.`);
  }

  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function compareVersions(a, b) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);

  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return right[i] - left[i];
  }

  return 0;
}

function versionFromExactGitTag() {
  if (!isWorkingTreeClean()) return null;

  const tags = runGit(['tag', '--points-at', 'HEAD', '--list', 'v[0-9]*.[0-9]*.[0-9]*'])
    .split('\n')
    .map(tag => tag.trim())
    .filter(Boolean)
    .map(normalizeVersion)
    .sort(compareVersions);

  return tags[0] ?? null;
}

function versionFromGitHubRef() {
  const refName = process.env.GITHUB_REF_NAME;
  if (!refName || !SEMVER_RE.test(refName)) return null;
  return normalizeVersion(refName);
}

function requestedVersion() {
  const args = process.argv.slice(2);
  const fromGit = args.includes('--from-git');
  const explicitIndex = args.findIndex(arg => arg === '--version');

  if (explicitIndex !== -1) {
    const explicit = args[explicitIndex + 1];
    if (!explicit) throw new Error('Missing value after --version.');
    return normalizeVersion(explicit);
  }

  if (fromGit) {
    return versionFromGitHubRef() ?? versionFromExactGitTag();
  }

  const positional = args.find(arg => !arg.startsWith('-'));
  if (positional) return normalizeVersion(positional);

  const envVersion = process.env.APP_VERSION ?? process.env.npm_config_app_version;
  if (envVersion) return normalizeVersion(envVersion);

  throw new Error('Provide a version, --version x.y.z, APP_VERSION=x.y.z, or --from-git.');
}

const version = requestedVersion();

if (!version) {
  console.log('No clean exact vX.Y.Z git tag found on HEAD; package version left unchanged.');
  process.exit(0);
}

const root = process.cwd();
const packagePath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const packageJson = readJson(packagePath);

packageJson.version = version;
writeJson(packagePath, packageJson);

if (existsSync(lockPath)) {
  const packageLock = readJson(lockPath);
  packageLock.version = version;
  if (packageLock.packages?.['']) {
    packageLock.packages[''].version = version;
  }
  writeJson(lockPath, packageLock);
}

console.log(`Synced package version to ${version}.`);
