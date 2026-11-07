/**
 * A walkthrough that stops halfway must not look like one that passed. e2e once
 * crashed at a line it could not run, wrote its evidence and exited 0, so the
 * rest of the flow was never covered and nothing said so.
 *
 * Runs scripts/e2e.mjs told to abort at once, and fails if that exits 0. It
 * needs the local stack and the dev server, and it writes to e2e-evidence/, so
 * `git checkout -- e2e-evidence` afterwards. Not in the build for those reasons.
 */
import { spawnSync } from "node:child_process";

const run = spawnSync(process.execPath, ["scripts/e2e.mjs"], {
  env: { ...process.env, E2E_ABORT_HERE: "1" },
  encoding: "utf8",
  timeout: 120000,
});
if (run.status === 0 || run.status === null) {
  console.error(`check:e2e-exit: an aborted e2e exited ${run.status}\n${run.stderr}`);
  process.exit(1);
}
if (!/ABORTED before the end/.test(run.stderr)) {
  console.error(`check:e2e-exit: an aborted e2e did not say so\n${run.stderr}`);
  process.exit(1);
}
console.log(`check:e2e-exit ok: an aborted e2e exits ${run.status} and says so`);
