// Take the staged screenshots from shots.json: for each entry, load the
// game's ?shot= URL, wait for window.__shotReady, and save a JPEG under
// screenshots/. Retries at lower quality until each file is under 256 KiB.
//   node tools/cdp.mjs tools/shots.mjs http://localhost:8080/
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = JSON.parse(readFileSync(new URL('../shots.json', import.meta.url), 'utf8'));
const MAX_BYTES = 262144;

export default async function shots(cdp) {
  const base = process.argv[3] ?? 'http://localhost:8080/';
  for (const shot of SHOTS) {
    const url = base.replace(/\/$/, '') + '/' + shot.query;
    await cdp.eval(`window.location.href = ${JSON.stringify(url)}`);
    await cdp.waitFor('window.__shotReady === true', 30000, 250);
    const path = join(process.cwd(), 'screenshots', shot.name);
    let quality = 82;
    for (;;) {
      await cdp.screenshot(path, 'jpeg', quality);
      const size = statSync(path).size;
      console.log(`${shot.name}: ${size} bytes at quality ${quality}`);
      if (size <= MAX_BYTES || quality <= 40) break;
      quality -= 12;
    }
    if (statSync(path).size > MAX_BYTES) {
      console.error(`FAIL ${shot.name} still over 256 KiB`);
      process.exitCode = 1;
    }
  }
  console.log('shots done');
}
