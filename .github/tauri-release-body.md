### Highlights
- Major refactor of the whole application: new MySQL driver, new styling system and shared data-view components. Most of the code was restructured under the hood.

### Features
- MySQL connections now run on a new driver (`mysql_async`), replacing the previous one.
- UNSIGNED values, including `AUTO_INCREMENT` columns, are read and shown correctly.
- SQL dump and table-data SQL INSERT exports run in UTC and carry a time-zone header, so they restore the same way on any server.

### Fixes
- Text columns with a `_bin` collation, and MariaDB JSON columns, are no longer treated as binary data.
- Autocomplete suggestion rows now render with correct padding.
- Fixed a stale "in progress" state after a failed or cancelled schema index build.
- The date/time picker no longer flashes in the top-left corner when it opens.
- Job progress polling no longer sends overlapping requests or reports finished twice.
- Errors that were silently ignored are now written to the log.

### Improvements
- The interface now uses Tailwind styling with paired light and dark themes. The look is unchanged.
- Table data and query results share one set of grid, form and editing components, so they behave the same way.
- Time and duration handling now uses `date-fns` for consistent date display.
- Internal cleanup: code-readability refactors, stricter linting and more tests.

See release assets for platform installers.
