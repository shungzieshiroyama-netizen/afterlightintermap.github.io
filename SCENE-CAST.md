# Scene cast

Characters are roster entries, not map markers. A scene is an existing story ping, with its date, location, status and selected cast.

## Using it

- Open **CHARACTERS → + CHARACTER** to add someone to the current map's roster. Click a roster name or its pencil button to rename it.
- Open a scene by clicking its map ping or its story-ping sidebar row.
- In **SCENE CAST**, search for a name and toggle characters in or out. Selected characters have a check mark and an accessible pressed state.
- To add someone new while editing a scene, type their name and choose **ADD … TO SCENE**. This creates a roster entry and attaches it in one undoable action.
- Removing a character asks for confirmation and removes their credits from active and stored dated scenes. Undo restores both the character and those credits.

Rosters remain scoped to maps, matching existing saved boards and sync documents. Names are limited to 40 characters; blank names are rejected and case-insensitive duplicates reuse existing entries. Legacy character coordinates remain compatible with old saves, but new cast entries have no coordinates and no character markers are rendered or captured.

## Audit and fixes

- Restored character creation after removal of ADD-marker mode had left the cast picker unusable for empty rosters.
- Replaced the obsolete ADD-mode instruction with a searchable, alphabetized picker and inline creation.
- Selection handlers look up current scene objects rather than mutating stale objects captured before a sync update. The open picker refreshes after remote updates.
- Character deletion now scrubs scene references, not just legacy timeline positions.
- History snapshots now include timeline buckets and calendar context. Cross-date scene hide/delete actions now record undo history.
- Screenshot rendering no longer includes obsolete character markers or hidden location/ping pins.
- Removed the inaccurate calendar message claiming positions and pings were cleared on date selection.
- Added roster deletion confirmation, duplicate-name validation, keyboard focus styles, wrapping cast chips and bounded picker/popover scrolling.

## Validation

Run `node tests/timeline-sync.test.js` from the repository. The in-memory two-client suite includes roster creation without coordinates, duplicate/blank validation, renaming, scene assignment, picker filtering/creation, stale-object handling, live sync, date isolation, deletion cleanup and undo for stored scenes.

Also run `node --check app.js` and `git diff --check`.

These are automated tests with a mocked DOM and database, not a full browser visual or production Firebase test. Existing last-writer-wins behavior is unchanged; concurrent edits to the same scene are not merged field by field.
