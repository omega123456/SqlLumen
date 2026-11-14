import { ChatCircleTextIcon, DatabaseIcon, CheckIcon } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import type { AiModelInfo } from '../../../lib/ai-commands'
import { isActivationKey } from '../../../lib/input-events'
import { ElevatedSurface } from '../../common/ElevatedSurface'
import type { ModelCategories, ModelFetch } from './ai-settings-model'
import styles from '../AiSettings.module.css'

interface ModelCardProps {
  model: AiModelInfo
  isSelected: boolean
  onSelectModel: (id: string) => void
}

function ModelCard({ model, isSelected, onSelectModel }: ModelCardProps) {
  const selectedClassName = isSelected ? ` ${styles.modelCardSelected}` : ''
  return (
    <div className={styles.cardWrapper}>
      <ElevatedSurface
        className={`${styles.modelCard}${selectedClassName}`}
        onClick={() => onSelectModel(model.id)}
        onKeyDown={(event) => {
          if (!isActivationKey(event.key)) return
          event.preventDefault()
          onSelectModel(model.id)
        }}
        tabIndex={0}
        role="radio"
        aria-checked={isSelected}
        data-testid={`ai-model-card-${model.id}`}
        title={model.name ?? model.id}
      >
        {model.name ?? model.id}
      </ElevatedSurface>
      {isSelected && (
        <CheckIcon
          size={14}
          weight="bold"
          className={styles.cardCheckmark}
          data-testid={`ai-model-check-${model.id}`}
        />
      )}
    </div>
  )
}

interface ModelCategorySectionProps {
  categoryKey: string
  label: string
  icon: Icon
  models: AiModelInfo[]
  selectedModelId: string
  onSelectModel: (id: string) => void
  emptyText: string
}

function ModelCategorySection({
  categoryKey,
  label,
  icon: IconComponent,
  models,
  selectedModelId,
  onSelectModel,
  emptyText,
}: ModelCategorySectionProps) {
  const labelId = `ai-category-${categoryKey}-label`

  return (
    <div className={styles.categorySection} data-testid={`ai-category-${categoryKey}`}>
      <div className={styles.categoryHeader}>
        <IconComponent size={16} weight="regular" className={styles.categoryIcon} />
        <span
          id={labelId}
          className={styles.categoryLabel}
          data-testid={`ai-category-${categoryKey}-label`}
        >
          {label}
        </span>
        <span className={styles.categoryBadge} data-testid={`ai-category-${categoryKey}-count`}>
          {models.length}
        </span>
      </div>
      {models.length > 0 ? (
        <div
          className={styles.modelGrid}
          data-testid={`ai-${categoryKey}-model-grid`}
          role="radiogroup"
          aria-labelledby={labelId}
        >
          {models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              isSelected={selectedModelId === model.id}
              onSelectModel={onSelectModel}
            />
          ))}
        </div>
      ) : (
        <div className={styles.categoryEmptyState} data-testid={`ai-${categoryKey}-empty-state`}>
          {emptyText}
        </div>
      )}
    </div>
  )
}

export function FetchStatus({
  modelFetch,
  loadingTestId,
  errorTestId,
  loadingText,
}: {
  modelFetch: ModelFetch
  loadingTestId: string
  errorTestId: string
  loadingText: string
}) {
  return (
    <>
      {modelFetch.loading && (
        <div className={styles.modelLoading} data-testid={loadingTestId}>
          {loadingText}
        </div>
      )}
      {modelFetch.error && (
        <div className={styles.modelError} data-testid={errorTestId}>
          {modelFetch.error}
        </div>
      )}
    </>
  )
}

interface ModelSelection {
  chatModel: string
  embeddingModel: string
  onSelectChatModel: (modelId: string) => void
  onSelectEmbeddingModel: (modelId: string) => void
}

interface ModelCategoryGridsProps {
  categories: ModelCategories
  embeddingFetch: ModelFetch
  selection: ModelSelection
}

export function ModelCategoryGrids({
  categories,
  embeddingFetch,
  selection,
}: ModelCategoryGridsProps) {
  if (!categories.show) return null
  return (
    <div className={styles.categorySections} data-testid="ai-model-categories">
      <ModelCategorySection
        categoryKey="chat"
        label="Chat models"
        icon={ChatCircleTextIcon}
        models={categories.chatModels}
        selectedModelId={selection.chatModel}
        onSelectModel={selection.onSelectChatModel}
        emptyText="No chat models found"
      />

      <div className={styles.sectionDivider} />

      <div className={styles.categorySection} data-testid="ai-embedding-models-region">
        <FetchStatus
          modelFetch={embeddingFetch}
          loadingTestId="ai-embedding-models-loading"
          errorTestId="ai-embedding-models-error"
          loadingText="Loading embedding models..."
        />

        <ModelCategorySection
          categoryKey="embedding"
          label="Embedding models"
          icon={DatabaseIcon}
          models={categories.embeddingModels}
          selectedModelId={selection.embeddingModel}
          onSelectModel={selection.onSelectEmbeddingModel}
          emptyText="No embedding models found"
        />
      </div>
    </div>
  )
}
