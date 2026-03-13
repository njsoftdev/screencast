import { readFile, writeFile, mkdir } from 'fs/promises';
import { execSync } from 'child_process';
import { resolve } from 'path';

const rootDir = resolve(new URL('..', import.meta.url).pathname);

async function main() {
  const manifestPath = resolve(rootDir, 'manifest.json');

  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  const currentVersion = String(manifest.version || '0.1');
  const inputVersion = (process.argv[2] || '').trim();

  let nextVersion = inputVersion;
  if (!nextVersion) {
    const num = Number.parseFloat(currentVersion);
    const bumped = Number.isFinite(num) ? num + 0.1 : 0.1;
    nextVersion = bumped.toFixed(1);
  }

  manifest.version = nextVersion;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`Manifest version set to ${nextVersion}`);

  console.log('Running build (npm run build)...');
  execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });

  const releaseDir = resolve(rootDir, 'release');
  await mkdir(releaseDir, { recursive: true });

  const zipName = `nj-screencast-${nextVersion}.zip`;
  const zipPath = resolve(releaseDir, zipName);

  console.log(`Creating ZIP: ${zipPath}`);
  const exclude = ['node_modules/*', 'release/*', '.git/*', 'dist/*']
    .map((p) => `-x "${p}"`).join(' ');
  execSync(`zip -r "${zipPath}" . ${exclude}`, { cwd: rootDir, stdio: 'inherit' });
  console.log('Done. Upload this file to Chrome Web Store:');
  console.log(zipPath);
}

main().catch((err) => {
  console.error('Failed to package extension:', err);
  process.exit(1);
});

