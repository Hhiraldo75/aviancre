# private-deals/

Real deal files live here: rent rolls you import, the deal JSON that
`npm run import` writes, and each deal's underwriting output and AI memo
(`private-deals/<deal-id>/`).

**Nothing in this folder except this README is ever committed.** `.gitignore`
ignores everything else, and the app never imports from here, so nothing in
it ends up in a build or a deploy. Deals imported in the browser stay in that
browser's local storage instead and are never sent anywhere.

## Workflow

    npm run convert -- private-deals/yardi-export.xlsx  # other layouts: writes private-deals/yardi-export-unit-rent-roll.csv
    npm run import -- private-deals/my-rent-roll.xlsx   # validates, writes private-deals/deal-<name>.json
    npm run underwrite -- deal-<name> [--json]          # output goes to private-deals/deal-<name>/
    /underwriting-analyst deal-<name>                    # memo goes to private-deals/deal-<name>/memo.md

The rent roll format is the one `npm run rent-roll` exports (see
`docs/atwells-rent-roll.csv`), as CSV or Excel `.xlsx`.

## Check

`npm run check-private` fails if Git tracks or has staged anything in this
folder besides this README, or if the folder is no longer ignored. `npm test`
runs the same check, and so does every commit: `npm install` points Git at
the tracked `.githooks/` folder (`core.hooksPath`), whose `pre-commit` runs it.

If it fails: `git rm --cached <file>` to untrack the file (it stays on disk).
