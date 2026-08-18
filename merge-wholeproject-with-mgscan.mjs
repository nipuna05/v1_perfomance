import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Fixes a real gap flagged directly: the whole-project sweep (measure.mjs) only ever produces
// ONE generic "Page Load - Management Scan" line for the entire feature, which makes it look
// like Management Scan has no real interaction coverage when in fact it has the deepest
// coverage of anything in this suite (measure-mgscan-full.mjs's 30+ step per-role flows).
// This merges the whole-project page-load sweep with the latest Management Scan combined
// results into ONE report so "whole project performance" actually shows both.
//
// Usage: node merge-wholeproject-with-mgscan.mjs <wholeProjectFile> <mgscanCombinedFile> <outFile>

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(__dirname, 'results');

const [, , wpFile, msFile, outFile] = process.argv;
if (!wpFile || !msFile || !outFile) {
  console.error('Usage: node merge-wholeproject-with-mgscan.mjs <wholeProjectFile> <mgscanCombinedFile> <outFile>');
  process.exit(1);
}

function load(f) { return JSON.parse(fs.readFileSync(path.join(resultsDir, f), 'utf-8')); }

const wp = load(wpFile);
const ms = load(msFile);

const wpRoles = new Set(wp.results.map(r => r.role));
const collisions = ms.results.filter(r => wpRoles.has(r.role));
if (collisions.length > 0) {
  console.error(`Role name collision(s) between whole-project and Management Scan results: ${collisions.map(r => r.role).join(', ')} - refusing to silently merge, rename one side first.`);
  process.exit(1);
}

const combined = {
  runLabel: 'whole-project-with-mgscan-detail',
  runTimestamp: wp.runTimestamp,
  baseUrl: wp.baseUrl,
  results: [
    ...wp.results,
    ...ms.results.map(r => ({ ...r, role: `Management Scan - ${r.role}` })),
  ],
};

fs.writeFileSync(path.join(resultsDir, outFile), JSON.stringify(combined, null, 2));
console.log(`Saved merged whole-project + Management Scan report to results/${outFile}`);
console.log(`Roles included: ${combined.results.map(r => r.role).join(', ')}`);
console.log(`Note: Management Scan data is from ${msFile} (dated separately from the whole-project sweep) - re-run measure-mgscan-full.mjs for a same-day pairing if that matters for a future comparison.`);
