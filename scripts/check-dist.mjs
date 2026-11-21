// Fails the image build when dist/ would deploy a broken site: required
// pages missing, a JavaScript module with a syntax error, or a page, style
// or module pointing at a local file that does not exist.
// Usage: node scripts/check-dist.mjs [dist]
import {readdir, readFile, stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {dirname, extname, join, posix, relative} from 'node:path';

const root = process.argv[2] || 'dist';
const required = ['index.html', 'journal.html', 'account.html', '404.html', 'privacy.html', 'terms.html',
  'app.mjs', 'diary.mjs', 'account.mjs', 'assets/scene-effects.mjs', 'vendor/supabase.js'];
const problems = [];

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(path));
    else out.push(path);
  }
  return out;
}

async function exists(path) {
  try { return (await stat(path)).isFile(); } catch { return false; }
}

// resolve maps a reference found in `from` to a file inside dist, or null
// for things that are not local files (other sites, data:, anchors, …).
function resolve(from, ref) {
  ref = ref.trim();
  if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(ref) || ref.includes('${') || /[<>"'`\s]/.test(ref)) return null;
  const path = ref.split(/[?#]/)[0];
  if (!path) return null;
  const base = '/' + relative(root, dirname(from)).split('\\').join('/');
  let target = path.startsWith('/') ? path : posix.join(base, path);
  if (target.endsWith('/')) target += 'index.html';
  return join(root, posix.normalize(target));
}

const htmlRefs = /\s(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const moduleRefs = /(?:\bimport|\bexport)\s*(?:[\w*{}\s,$]+\sfrom\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const cssRefs = /url\(\s*["']?([^"')]+)["']?\s*\)|@import\s+["']([^"']+)["']/g;
const bundled = file => file.startsWith(join(root, 'vendor')) || file.startsWith(join(root, 'assets'));

for (const name of required) {
  if (!await exists(join(root, name))) problems.push('missing ' + name);
}
for (const file of await files(root)) {
  const ext = extname(file);
  if (!['.html', '.mjs', '.js', '.css'].includes(ext)) continue;
  const text = await readFile(file, 'utf8');
  const refs = [];
  if (ext === '.html') {
    for (const m of text.matchAll(htmlRefs)) refs.push(m[1]);
    for (const m of text.matchAll(moduleRefs)) refs.push(m[1] || m[2]);
  } else if (ext === '.css') {
    for (const m of text.matchAll(cssRefs)) refs.push(m[1] || m[2]);
  } else if (!bundled(file)) {
    try { execFileSync(process.execPath, ['--check', file], {stdio: 'pipe'}); }
    catch (error) { problems.push(relative(root, file) + ': ' + String(error.stderr).trim().split('\n').slice(0, 4).join(' | ')); }
    // Only relative and absolute specifiers name files; bare ones are packages.
    for (const m of text.matchAll(moduleRefs)) {
      const ref = m[1] || m[2];
      if (/^\.{0,2}\//.test(ref)) refs.push(ref);
    }
  }
  for (const ref of refs) {
    const target = resolve(file, ref);
    if (target && !await exists(target)) problems.push(relative(root, file) + ' → ' + ref + ' (no such file)');
  }
}

if (problems.length) {
  console.error('dist/ check failed: the site would deploy broken.\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('dist/ check passed');
