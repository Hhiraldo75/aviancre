---
name: convert-rent-roll
description: Convert a rent roll in a layout the AVIANCRE converter can't handle into the unit rent roll CSV format, run the import check on it, and report its totals against the source file's own totals. Copies values from the file only; never invents any.
argument-hint: <file.csv|file.xlsx>
disable-model-invocation: true
---

# Convert a rent roll

The argument is `$ARGUMENTS`: a rent roll file (`.csv` or `.xlsx`). Your job is to turn it into our **unit rent roll** CSV (one row per apartment, rents per month), or confirm that `npm run convert` already did. **You copy values from the file. You never invent, estimate or fill in a value the file doesn't state.** Anything you can't find is left blank and listed in your report.

If no file was given, list the `.csv` and `.xlsx` files in `private-deals/` and stop.

## Privacy

A rent roll that isn't one of the public samples in `docs/samples/` is a **private deal**:

- Keep it and everything derived from it in `private-deals/` (Git ignores it). If the file is elsewhere, say so and suggest moving it there.
- Never copy any of its values, unit numbers or names into `docs/`, `src/`, any tracked file, your memory, or anything sent to an outside service.
- Never modify the source file.
- In your reply, report totals and counts only. Don't repeat tenant names.

## Procedure

1. **Try the converter: `npm run convert -- <file>`.**
   - It writes the clean CSV (exit 0): report its output (format, totals check, flags, output path, import check) and stop. Don't redo its work by hand.
   - It says the file is already an AVIANCRE rent roll: run `npm run import -- <file> --check` and report.
   - It stops on **blockers** that are choices (a status value or resident marker such as MODEL or DOWN, a charge code, a required column it couldn't find but which exists under another name): these are the user's call. Ask the user (one question per choice, with what the file shows), then continue at step 2 using their answers. Alternatively, the user can map the layout once in the app (Import rent roll), save a preset and download it to `private-deals/rent-roll-presets.json`, after which `npm run convert` handles it.
   - It stops on a **totals mismatch**: find the cause in the file (step 2) and report it. Don't paper over it; write the CSV only if the user accepts the difference.
   - "No header row found": continue at step 2.
2. **Read the file:** `npm run --silent convert -- <file> --dump > private-deals/<name>-dump.txt` prints every non-blank row as `row | cell | cell …`. Read it in chunks. Identify:
   - the title rows (property name, as-of date),
   - the header row or rows and what each column holds,
   - how units are laid out (one row each, or blocks with several charge rows),
   - sections such as current residents, future residents or applicants, and non-revenue units,
   - **the file's own totals**: unit count, occupied/vacant counts, square feet, rent and market rent totals, totals per charge code. These are the cross-check.
3. **Write the clean CSV** next to the source if it's in `private-deals/`, else in `private-deals/`, as `<file name>-unit-rent-roll.csv`. Use exactly the layout of `docs/samples/fernhill-commons-unit-rent-roll.csv`: a title row `<Property name>: unit rent roll`; an `As of YYYY-MM-DD` row if the file gives a date; the Property block (`Asset type,multifamily`, `Units`, `Rentable SF`, then `Class`, `Submarket` and `Address`, blank unless the file states them); then the `Units` title row and this header:

   `Unit,Floor plan,SF,Status,Market rent ($/mo),In-place rent ($/mo),Other income ($/mo),Move-in,Lease end,Balance owed ($),Pre-leased (applicant),Future lease rent ($/mo),Note`

   Rules, the same ones the converter follows:
   - **One row per unit.** Status is `Occupied` or `Vacant` only. A vacant unit's in-place rent and other income are 0.
   - **In-place rent** is the unit's rent charge(s) per month. **Other income** is the sum of its other recurring charges (pet rent, parking, storage, W/D…). Say which charge codes you counted as which.
   - **Rents are monthly.** If the file states annual or per-SF amounts, convert them and say so in the Note column and in your report.
   - **Floor plan:** units are grouped by their (SF, market rent) pair, each group named `<SF> SF` (e.g. `571 SF`) unless the user gives names. The file's own unit type code goes in the Note column (`Unit type <code>`).
   - **Dates** as `YYYY-MM-DD`. A unit on notice to vacate keeps its status, and its lease end becomes the move-out date (say so in the Note).
   - **Pre-leased** is `Yes` only where the file shows a future resident or applicant for that unit.
   - **Future lease rent** is the future resident's monthly rent charge(s), only on a pre-leased unit and only when the file gives it; otherwise blank.
   - **Rentable SF** is the sum of the units' SF unless the file states a total.
   - **Missing values:** leave them blank and list them. A blank required value (SF, market rent, or in-place rent on an occupied unit) makes the import check fail, which is correct: don't fill it in.
   - **Inferred values:** anything not read directly from a cell (a status from a blank tenant, a lease end from a move-out date, a monthly figure from an annual one) is described in that unit's Note.
   - With more than a few dozen units, write a throwaway script in your scratchpad (never in the repo) that reads the file and writes the CSV, rather than typing values. Read the result back to spot-check it against the file.
4. **Run the import check:** `npm run import -- <clean csv> --check`, adding `--class` and `--submarket` if the user gave them. Errors that only ask for the class or submarket are expected when the file doesn't state them. Any other error means the CSV is wrong: fix it and re-run.
5. **Reply** with:
   - the output path,
   - a totals table: Total | Converted | File | match / mismatch / not in file. Rows: units, occupied, vacant, pre-leased, rentable SF, in-place rent (occupied), market rent (vacant), rent + vacant market, other income. Take the converted figures from the import check's output (`… units (… occupied)`, `monthly: in-place rent … occupied + market … vacant = …; other income …; … pre-leased`), not your own arithmetic, and the file's figures from its own totals,
   - every missing value and every inference,
   - the next step: `npm run import -- <clean csv> --class <A|B|C> --submarket <id>`.
