### Features
- Autocomplete for CTE and derived-table aliases: `r.` after a `WITH` clause, or `d.` after a subquery in `FROM`, now suggests that select list's columns.
- Semantic highlighting in the query editor, with MySQL language mode support.

### Fixes
- Non-reserved keywords such as `ACTIVE`, `TYPE` and `OLD` work as column names after a dot (`smp.active`) without a syntax error, and the statement's tables stay known.
- Autocomplete keeps suggesting keywords for statements that follow an unfinished or broken statement.

### Improvements
- Keyword and built-in function completion uses the parser's keyword set and the function signature registry instead of hand-maintained lists.
- Monaco upgraded to 0.57.0, and the editor no longer loads every SQL dialect parser on the main thread.

See release assets for platform installers.
