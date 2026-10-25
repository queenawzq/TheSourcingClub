---
name: deploy-to-production
description: Deploy The Sourcing Club to sourcing-club.com by integrating latest main, reviewing and committing application changes, validating, pushing, monitoring Vercel, and verifying the production UI. Use when asked to deploy or release this application to production.
---

# Deploy to production

Complete the release through visible production verification. Invoking this workflow to deploy authorizes the pull, routine conflict resolution, commit, push to main, and a manual production deployment if the Git integration does not trigger. Respect any narrower user instruction, such as stopping before push.

## Project

- Repository: `queenawzq/TheSourcingClub`; remote `origin`; release branch `main`.
- Run from the developer's checkout. Resolve the repository root with `git rev-parse --show-toplevel` and verify the remote before acting.
- Production: `https://sourcing-club.com`; app entry: `/app.html`.
- Production Vercel project: `the-sourcing-club`, under `queena-s-projects-7cbe4b6f` at the time of creation. Discover current deployment metadata rather than trusting that scope indefinitely.
- The local `.vercel/project.json` and default CLI scope have previously pointed to an older project under `queenas-projects-ebde6959`. Do not manually deploy there without verifying the production domain belongs to that project.

## Integrate and validate

1. Read applicable repository instructions. Inspect branch, tracking status, remotes, tracked diff, and untracked files. Review all current application changes for this release. Exclude secrets, dependencies, temporary output, unrelated documents, and generated artifacts; report meaningful exclusions. This workspace has contained unrelated resumes, spreadsheets, and PDFs under `output/`, `outputs/`, `tmp/`, and artifact directories. Review their content and purpose rather than blindly staging them.
2. Pull latest `origin/main` and integrate it without discarding local work. If uncommitted application changes obstruct the pull, preserve them in an identifiable stash (including relevant untracked files), pull, then apply the stash and verify restoration before dropping it. Do not stash large unrelated artifact directories. If working on another branch, inspect its intended changes and safely integrate into main; do not force-push or reset away others' work.
3. Resolve ordinary merge conflicts by preserving intended behavior on both sides. Ask only if a substantive product choice or destructive action cannot be resolved from context. Check for unresolved Git conflicts.
4. Run `npm run build` (includes CSS token and adapter checks) and `git diff --check`. Run any additional repository-required checks and tests relevant to changed behavior. Do not seed/reset production or run mutation-heavy end-to-end tests against real accounts as a release check.
5. Stage all reviewed application changes with explicit paths, including additions and deletions. Inspect the staged diff for secrets, accidental output, and conflict markers. Commit with an accurate message. If there are no deployable changes, do not fabricate an empty commit: continue to verify the current main release. Record the full commit SHA.
6. Push main to origin. If rejected because main advanced, pull/integrate again, resolve conflicts, repeat affected checks, and push normally.

## Verify or trigger Vercel

1. Query the exact pushed commit's GitHub statuses/checks, for example `gh api repos/queenawzq/TheSourcingClub/commits/<sha>/status`. Follow the Vercel status target to identify the correct project/deployment. A push alone is not deployment success.
2. Monitor with bounded waits and concise progress updates. Verify the deployment's commit, Ready/success status, Production target, and assignment to `sourcing-club.com`. Inspect build logs if it fails. The build command in `vercel.json` also runs `scripts/deploy-migrate.mjs`; migrations may be applied during deployment, so inspect pending migration changes before retrying.
3. If no deployment is triggered after a reasonable observation period (about two minutes), inspect integration/status evidence and manually trigger one deployment of the validated commit on the verified production project. Prefer redeployment from that Git commit; if using a CLI upload, ensure it cannot upload unrelated local artifacts or secrets. Confirm account/project/domain identity first. Never use stale local Vercel linkage as proof of the production target.
4. Do not repeatedly create deployments. Monitor the one triggered and diagnose any failure. Stop for unavailable access or a substantive unresolved failure, reporting exactly what blocked completion.

## Production demo

Refresh or open `https://sourcing-club.com` and the affected app route using available browser tools. Preserve the user's active session and identify which account is actually signed in. Verify the changed behavior visually and, where useful, through the rendered DOM. Check page loading and relevant controls without submitting payments, changing production records, or sending messages merely to prove deployment. If authentication is needed, use the existing login or ask for the required user action; do not claim an authenticated flow was checked when only a public page was accessible.

Leave the verified production page open as a deliverable. Report commit, branch, deployment result, production URL, checks performed, and any unverified behavior. Record whether deployment was automatic or manually triggered. Never equate a completed Stripe transfer with a completed bank payout when checking payments.
