import { copyFileSync, mkdirSync, readdirSync, renameSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dist = join(root, 'dist');

const copy = (src, dest) => {
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
};

const copyDir = (srcDir, destDir) => {
  if (!existsSync(srcDir)) return;
  mkdirSync(destDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    const s = join(srcDir, name);
    const d = join(destDir, name);
    if (existsSync(s) && statSync(s).isDirectory()) copyDir(s, d);
    else copy(s, d);
  }
};

// Rename Vite output popup-src.html -> popup.html
const popupSrc = join(dist, 'popup-src.html');
const popupDest = join(dist, 'popup.html');
if (existsSync(popupSrc)) renameSync(popupSrc, popupDest);

// Copy extension assets
copy(join(root, 'manifest.json'), join(dist, 'manifest.json'));
copy(join(root, 'background.js'), join(dist, 'background.js'));
copy(join(root, 'recorder.js'), join(dist, 'recorder.js'));
copy(join(root, 'recorder.html'), join(dist, 'recorder.html'));
copy(join(root, 'EBML.js'), join(dist, 'EBML.js'));
copy(join(root, 'download.js'), join(dist, 'download.js'));
copy(join(root, 'download.html'), join(dist, 'download.html'));
copy(join(root, 'result.html'), join(dist, 'result.html'));
copyDir(join(root, 'images'), join(dist, 'images'));
copyDir(join(root, '_locales'), join(dist, '_locales'));

// Copy built popup back to root so extension can be loaded from root
const popupHtml = join(dist, 'popup.html');
const popupJs = readdirSync(dist).find((f) => f.startsWith('popup-') && f.endsWith('.js'));
const popupCss = readdirSync(dist).find((f) => f.startsWith('popup-') && f.endsWith('.css'));
if (existsSync(popupHtml)) copy(popupHtml, join(root, 'popup.html'));
if (popupJs) copy(join(dist, popupJs), join(root, popupJs));
if (popupCss) copy(join(dist, popupCss), join(root, popupCss));

console.log('Extension files copied to dist/ and popup to root.');
