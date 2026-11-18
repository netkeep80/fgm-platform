// S06A transition alias for the immutable BASE execution verifier.
// Owner S06/#9; remove in S06B after the accepted baseline uses Raster directly.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const raster=fileURLToPath(new URL('../../raster/',import.meta.url));
const args=process.argv.slice(2).map(path=>resolve(path));
execFileSync(process.execPath,[fileURLToPath(new URL('../../raster/scripts/test-v02.mjs',import.meta.url)),...args],
  {cwd:raster,stdio:'inherit'});
