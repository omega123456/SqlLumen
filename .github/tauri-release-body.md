### Features
- Table data and query results share one data view, so grid, form and text views behave the same in both.

### Fixes
- Deleting rows from a table whose primary key is BINARY or VARBINARY works again.
- Rows deleted while a table page reloads stay hidden, and the filter is disabled during reloads and row actions.
- Opening an edit no longer races a table page fetch; an open edit closes when the fetch starts.
- Table editing follows changes to the connection's read-only setting straight away.
- Adding a row to a full table page now warns that the row was saved but is not shown, instead of silently refetching the page.
- The date-time picker positions itself correctly when it opens above its field.

### Improvements
- Switching between grid, form and text views keeps your scroll position and checked rows, for table data and query results.

See release assets for platform installers.
