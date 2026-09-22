import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const assetsDir = path.resolve('dist/assets');
const files = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir) : [];

let failed = false;

for (const rule of pkg.bundlesize || []) {
  const basePattern = path.basename(rule.path);
  const regex = new RegExp(
    '^' +
      basePattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') +
      '$',
  );
  const matched = files.filter((f) => regex.test(f));

  const maxKB = parseFloat(rule.maxSize);
  const maxBytes = maxKB * 1024;

  if (matched.length === 0) {
    console.error(`FAIL  No files matched ${rule.path}`);
    failed = true;
    continue;
  }

  for (const file of matched) {
    const fullPath = path.join(assetsDir, file);
    const gzBytes = zlib.gzipSync(fs.readFileSync(fullPath)).byteLength;
    const gzKB = (gzBytes / 1024).toFixed(2);

    if (gzBytes <= maxBytes) {
      console.info(
        `PASS  ./dist/assets/${file}: ${gzKB}KB <= maxSize ${rule.maxSize} (gzip)`,
      );
    } else {
      console.error(
        `FAIL  ./dist/assets/${file}: ${gzKB}KB > maxSize ${rule.maxSize} (gzip)`,
      );
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
