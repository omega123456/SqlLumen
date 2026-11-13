use super::super::super::types::{BuildPhase, BuildProgress};

const FINALIZING_SQLITE_STEPS: usize = 2;

struct FinalizingSteps {
    done: usize,
    total: usize,
}

pub(super) struct EmbeddingProgressStart {
    pub(super) profile_id: String,
    pub(super) unchanged_tables: usize,
    pub(super) tables_total: usize,
    pub(super) total_embed_batches: usize,
}

pub(super) struct EmbeddingProgressTracker {
    profile_id: String,
    tables_done: usize,
    tables_total: usize,
    total_embed_batches: usize,
    embed_batches_done: usize,
    finalizing: Option<FinalizingSteps>,
}

impl EmbeddingProgressTracker {
    pub(super) fn new(start: EmbeddingProgressStart) -> Self {
        Self {
            profile_id: start.profile_id,
            tables_done: start.unchanged_tables,
            tables_total: start.tables_total,
            total_embed_batches: start.total_embed_batches,
            embed_batches_done: 0,
            finalizing: None,
        }
    }

    pub(super) fn start(&mut self) -> BuildProgress {
        if self.tables_done >= self.tables_total {
            self.finalizing = Some(FinalizingSteps {
                done: 0,
                total: self.total_embed_batches + FINALIZING_SQLITE_STEPS,
            });
        }
        self.current_progress()
    }

    pub(super) fn record_batch(&mut self, table_chunks_in_batch: usize) -> BuildProgress {
        self.tables_done += table_chunks_in_batch;
        self.embed_batches_done += 1;
        if let Some(progress) = self.advance_finalizing() {
            return progress;
        }
        if self.tables_done >= self.tables_total {
            let remaining_batches = self
                .total_embed_batches
                .saturating_sub(self.embed_batches_done);
            self.finalizing = Some(FinalizingSteps {
                done: 0,
                total: remaining_batches + FINALIZING_SQLITE_STEPS,
            });
        }
        self.current_progress()
    }

    pub(super) fn advance_finalizing(&mut self) -> Option<BuildProgress> {
        let steps = self.finalizing.as_mut()?;
        steps.done = (steps.done + 1).min(steps.total);
        Some(self.current_progress())
    }

    fn current_progress(&self) -> BuildProgress {
        match &self.finalizing {
            Some(steps) => BuildProgress {
                profile_id: self.profile_id.clone(),
                phase: BuildPhase::Finalizing,
                tables_done: steps.done,
                tables_total: steps.total,
            },
            None => BuildProgress {
                profile_id: self.profile_id.clone(),
                phase: BuildPhase::Embedding,
                tables_done: self.tables_done,
                tables_total: self.tables_total,
            },
        }
    }
}
