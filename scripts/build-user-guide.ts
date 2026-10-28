// Writes docs/USER_GUIDE.md from the in-app guide (src/lookup-manager/ui/guide.ts).
// Run: npx tsx scripts/build-user-guide.ts
import { writeFileSync } from 'node:fs';
import { guideToMarkdown } from '../src/lookup-manager/ui/guide';
import { APP_VERSION } from '../src/lookup-manager/version';

const out = new URL('../docs/USER_GUIDE.md', import.meta.url);
writeFileSync(out, guideToMarkdown(APP_VERSION) + '\n');
console.log(`Wrote ${out.pathname}`);
