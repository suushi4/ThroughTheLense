import {cp, mkdir, copyFile, readFile, rm, writeFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {buildSceneEffects} from './build-visuals.mjs';

const publicPages = ['/', '/gallery.html', '/help.html', '/sounds.html', '/privacy.html', '/terms.html'];
const configuredOrigin = process.env.SITE_ORIGIN ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL && 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL);
const normalized = configuredOrigin && new URL(configuredOrigin);
if (normalized && (normalized.protocol !== 'https:' || normalized.username || normalized.password ||
  normalized.pathname !== '/' || normalized.search || normalized.hash)) {
  throw Error('SITE_ORIGIN must be an HTTPS origin without credentials or a path.');
}
const origin = normalized?.origin || 'http://127.0.0.1:8000';
const indexed = Boolean(normalized) && (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production');
await rm('dist', {recursive:true,force:true});
await cp('web', 'dist', {recursive:true, filter: source => !['scene-effects.jsx', 'scene-effects.mjs'].includes(basename(source))});
await buildSceneEffects('dist');
await mkdir('dist/vendor', {recursive:true});
await copyFile('node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'dist/vendor/supabase.js');

for (const route of publicPages) {
  const file = 'dist' + (route === '/' ? '/index.html' : route);
  let html = await readFile(file,'utf8');
  const url = origin + route;
  const meta = indexed ? '' : '\n  <meta name="robots" content="noindex">';
  const social = ['/', '/gallery.html'].includes(route) ? '\n  <meta property="og:url" content="' + url + '">' : '';
  html = html.replace('</head>', '  <link rel="canonical" href="' + url + '">' + meta + social + '\n</head>');
  html = html.replace('content="/media/social-preview.jpg"', 'content="' + origin + '/media/social-preview.jpg"');
  await writeFile(file,html);
}
await writeFile('dist/sitemap.xml','<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  publicPages.map(route => '  <url><loc>' + origin + route + '</loc></url>').join('\n') + '\n</urlset>\n');
await writeFile('dist/robots.txt', 'User-agent: *\n' +
  (normalized ? 'Allow: /\n' : 'Disallow: /\n') +
  (indexed ? 'Sitemap: ' + origin + '/sitemap.xml\n' : ''));
