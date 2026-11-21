import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

export function buildSceneEffects(target) {
  return build({
    entryPoints: ['web/scene-effects.jsx'],
    outfile: target + '/assets/scene-effects.mjs',
    bundle: true,
    minify: true,
    format: 'esm',
    jsx: 'automatic',
    loader: {'.glsl': 'text'},
    legalComments: 'eof',
    define: {'process.env.NODE_ENV': '"production"'}
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await buildSceneEffects('web');
