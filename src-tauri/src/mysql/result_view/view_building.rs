use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpecMode {
    Strict,
    Lenient,
}

#[derive(Debug)]
pub struct ResolvedSpec {
    pub effective: ResultViewSpec,
    pub(super) sort: Option<(usize, SortDirection)>,
    pub(super) filters: Vec<CompiledFilter>,
}

impl ResolvedSpec {
    pub(super) fn is_identity(&self) -> bool {
        self.sort.is_none() && self.filters.is_empty()
    }
}

pub fn resolve_spec(
    spec: &ResultViewSpec,
    columns: &[ColumnMeta],
    mode: SpecMode,
) -> Result<ResolvedSpec, String> {
    let position = |name: &str| columns.iter().position(|column| column.name == name);

    let mut effective = ResultViewSpec::default();
    let mut sort = None;
    if let Some(requested) = &spec.sort {
        match position(&requested.column) {
            Some(index) => {
                sort = Some((index, requested.direction));
                effective.sort = Some(requested.clone());
            }
            None if mode == SpecMode::Strict => {
                return Err(format!(
                    "Column '{}' not found in result set",
                    requested.column
                ));
            }
            None => {}
        }
    }

    let mut filters = Vec::with_capacity(spec.filters.len());
    for condition in &spec.filters {
        let Some(index) = position(&condition.column) else {
            continue;
        };
        match compile_filter(condition, index, columns) {
            Ok(compiled) => {
                filters.push(compiled);
                effective.filters.push(condition.clone());
            }
            Err(error) if mode == SpecMode::Strict => return Err(error),
            Err(error) => {
                tracing::warn!(error = %error, column = %condition.column, "dropping filter condition from re-run view spec");
            }
        }
    }

    Ok(ResolvedSpec {
        effective,
        sort,
        filters,
    })
}

pub fn build_view(
    rows: &[SharedRow],
    tombstones: &BTreeSet<u32>,
    resolved: &ResolvedSpec,
) -> Option<Arc<Vec<u32>>> {
    let keeps_stored_order = resolved.is_identity() && tombstones.is_empty();
    if keeps_stored_order {
        return None;
    }
    let mut indices: Vec<u32> = (0..rows.len() as u32)
        .filter(|row_index| !tombstones.contains(row_index))
        .filter(|&row_index| {
            let row = &rows[row_index as usize];
            resolved.filters.iter().all(|filter| filter.matches(row))
        })
        .collect();
    if let Some((column, direction)) = resolved.sort {
        indices.sort_by(|&left, &right| {
            let va = rows[left as usize].get(column).unwrap_or(&Value::Null);
            let vb = rows[right as usize].get(column).unwrap_or(&Value::Null);
            let ordering = compare_json_values(va, vb);
            match direction {
                SortDirection::Asc => ordering,
                SortDirection::Desc => ordering.reverse(),
            }
        });
    }
    Some(Arc::new(indices))
}

pub async fn apply_initial_view(
    mut stored: StoredResult,
    spec: Option<ResultViewSpec>,
) -> Result<StoredResult, String> {
    let Some(spec) = spec.filter(|spec_text| !spec_text.is_empty()) else {
        return Ok(stored);
    };
    tokio::task::spawn_blocking(move || {
        let resolved = resolve_spec(&spec, &stored.columns, SpecMode::Lenient)?;
        stored.view = build_view(&stored.rows, &stored.tombstones, &resolved);
        stored.view_spec = resolved.effective;
        Ok(stored)
    })
    .await
    .map_err(|error| {
        tracing::error!(error = %error, "initial view build task failed");
        format!("View build task failed: {error}")
    })?
}

pub fn view_len(stored: &StoredResult) -> usize {
    match &stored.view {
        Some(view) => view.len(),
        None => stored.rows.len(),
    }
}

pub fn slice_window(stored: &StoredResult, offset: usize, limit: usize) -> ResultWindow {
    let len = view_len(stored);
    let offset = offset.min(len);
    let end = offset + limit.min(MAX_WINDOW_ROWS).min(len - offset);
    let base_indices: Vec<u32> = match &stored.view {
        Some(view) => view[offset..end].to_vec(),
        None => (offset as u32..end as u32).collect(),
    };
    let rows = base_indices
        .iter()
        .map(|&row_index| Arc::clone(&stored.rows[row_index as usize]))
        .collect();
    ResultWindow {
        offset,
        rows,
        base_indices,
    }
}

pub fn first_window(stored: &StoredResult) -> ResultWindow {
    slice_window(stored, 0, FIRST_WINDOW_ROWS)
}

pub fn view_rows(stored: &StoredResult) -> Vec<SharedRow> {
    match &stored.view {
        Some(view) => view
            .iter()
            .map(|&row_index| Arc::clone(&stored.rows[row_index as usize]))
            .collect(),
        None => (*stored.rows).clone(),
    }
}
