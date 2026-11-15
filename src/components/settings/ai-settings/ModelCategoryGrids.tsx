import { ChatCircleTextIcon, DatabaseIcon, CheckIcon } from '@phosphor-icons/react'
import type { Icon } from '@phosphor-icons/react'
import type { AiModelInfo } from '../../../lib/ai-commands'
import { isActivationKey } from '../../../lib/input-events'
import { joinClassNames } from '../../../lib/class-names'
import type { ModelCategories, ModelFetch } from './ai-settings-model'

type ModelCardState = 'idle' | 'selected'

const MODEL_CARD_STATE_CLASSES: Record<ModelCardState, string> = {
  idle: 'border-transparent bg-light-surface-container-high hover:bg-light-card-hover dark:bg-dark-surface-container-high dark:hover:bg-dark-card-hover',
  selected:
    'border-light-primary bg-light-card-accent-hover hover:bg-light-card-hover dark:border-dark-primary dark:bg-dark-card-accent-hover dark:hover:bg-dark-card-hover',
}

function modelCardStateOf(isSelected: boolean): ModelCardState {
  if (isSelected) return 'selected'
  return 'idle'
}

interface ModelCardProps {
  model: AiModelInfo
  isSelected: boolean
  onSelectModel: (id: string) => void
}

function ModelCard({ model, isSelected, onSelectModel }: ModelCardProps) {
  const state = modelCardStateOf(isSelected)
  return (
    <div className="relative">
      <div
        className={joinClassNames([
          'w-45 cursor-pointer truncate rounded-card border-2 px-3 py-2 text-size-caption text-light-on-surface shadow-light-elevated transition-border-color-background-shadow duration-150 dark:text-dark-on-surface dark:shadow-dark-elevated',
          MODEL_CARD_STATE_CLASSES[state],
        ])}
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
      </div>
      {isSelected && (
        <CheckIcon
          size={14}
          weight="bold"
          className="pointer-events-none absolute top-1.5 right-1.5 text-light-primary dark:text-dark-primary"
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
    <div className="flex flex-col gap-3" data-testid={`ai-category-${categoryKey}`}>
      <div className="flex flex-row items-center gap-2">
        <IconComponent
          size={16}
          weight="regular"
          className="size-4 shrink-0 text-light-on-surface-variant dark:text-dark-on-surface-variant"
        />
        <span
          id={labelId}
          className="text-size-caption font-semibold text-light-on-surface-variant dark:text-dark-on-surface-variant"
          data-testid={`ai-category-${categoryKey}-label`}
        >
          {label}
        </span>
        <span
          className="rounded-control bg-light-surface-container-high px-1.5 py-0.5 text-size-caption text-light-on-surface-variant dark:bg-dark-surface-container-high dark:text-dark-on-surface-variant"
          data-testid={`ai-category-${categoryKey}-count`}
        >
          {models.length}
        </span>
      </div>
      {models.length > 0 ? (
        <div
          className="flex flex-wrap gap-2"
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
        <div
          className="rounded-control bg-light-surface-container-high p-3 text-size-caption text-light-on-surface-variant dark:bg-dark-surface-container-high dark:text-dark-on-surface-variant"
          data-testid={`ai-${categoryKey}-empty-state`}
        >
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
        <div
          className="mt-1 text-size-caption text-light-on-surface-variant dark:text-dark-on-surface-variant"
          data-testid={loadingTestId}
        >
          {loadingText}
        </div>
      )}
      {modelFetch.error && (
        <div
          className="mt-1 text-size-caption text-light-error dark:text-dark-error"
          data-testid={errorTestId}
        >
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
    <div className="flex flex-col gap-6" data-testid="ai-model-categories">
      <ModelCategorySection
        categoryKey="chat"
        label="Chat models"
        icon={ChatCircleTextIcon}
        models={categories.chatModels}
        selectedModelId={selection.chatModel}
        onSelectModel={selection.onSelectChatModel}
        emptyText="No chat models found"
      />

      <div className="border-t border-light-stroke-divider dark:border-dark-stroke-divider" />

      <div className="flex flex-col gap-3" data-testid="ai-embedding-models-region">
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
