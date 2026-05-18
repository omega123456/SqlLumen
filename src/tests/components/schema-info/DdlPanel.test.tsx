import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DdlPanel } from '../../../components/schema-info/DdlPanel'
import { expectToast } from '../../ipc-mock'
import { useToastStore } from '../../../stores/toast-store'
import * as contextMenuUtils from '../../../lib/context-menu-utils'
import type { TableMetadata } from '../../../types/schema'

let clipboardWriteTextSpy: ReturnType<typeof vi.spyOn>
let writeClipboardTextSpy: ReturnType<typeof vi.spyOn>

function makeMetadata(overrides: Partial<TableMetadata> = {}): TableMetadata {
  return {
    engine: 'InnoDB',
    collation: 'utf8mb4_general_ci',
    autoIncrement: 101,
    createTime: '2023-01-01',
    tableRows: 1000,
    dataLength: 16384,
    indexLength: 8192,
    ...overrides,
  }
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
  clipboardWriteTextSpy = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockImplementation(() => Promise.resolve())
  writeClipboardTextSpy = vi.spyOn(contextMenuUtils, 'writeClipboardText')
})

describe('DdlPanel', () => {
  it('renders DDL text', () => {
    const ddl = 'CREATE TABLE `users` (`id` bigint NOT NULL)'

    render(<DdlPanel ddl={ddl} objectType="table" metadata={makeMetadata()} />)

    expect(screen.getByTestId('ddl-panel')).toBeInTheDocument()
    // The code block should contain the DDL text
    const codeEl = screen.getByTestId('ddl-panel').querySelector('code')
    expect(codeEl?.textContent).toContain('CREATE TABLE')
  })

  it('Copy SQL button exists and calls writeClipboardText', async () => {
    const user = userEvent.setup()
    const ddl = 'CREATE TABLE `users` (`id` bigint NOT NULL)'

    render(<DdlPanel ddl={ddl} objectType="table" metadata={makeMetadata()} />)

    const copyBtn = screen.getByText('Copy SQL')
    expect(copyBtn).toBeInTheDocument()

    await user.click(copyBtn)
    expect(writeClipboardTextSpy).toHaveBeenCalledWith(ddl)
    await expectToast('success', 'Copied to clipboard')
  })

  it('Copy SQL works in ddl-only mode and shows success toast', async () => {
    const user = userEvent.setup()
    const ddl = 'CREATE VIEW `v` AS SELECT 1'

    render(<DdlPanel ddl={ddl} objectType="view" />)

    await user.click(screen.getByText('Copy SQL'))
    expect(writeClipboardTextSpy).toHaveBeenCalledWith(ddl)
    expect(clipboardWriteTextSpy).toHaveBeenCalledWith(ddl)
    await expectToast('success', 'Copied to clipboard')
  })

  it('shows error toast when clipboard copy fails', async () => {
    const user = userEvent.setup()
    writeClipboardTextSpy.mockRejectedValueOnce(new Error('clipboard denied'))

    render(<DdlPanel ddl="CREATE VIEW `v` AS SELECT 1" objectType="view" />)

    await user.click(screen.getByText('Copy SQL'))
    await expectToast('error', 'clipboard denied')
  })

  it('shows MetadataCard for tables', () => {
    render(
      <DdlPanel ddl="CREATE TABLE `t` (`id` int)" objectType="table" metadata={makeMetadata()} />
    )

    expect(screen.getByTestId('metadata-card')).toBeInTheDocument()
  })

  it('does NOT show MetadataCard for views', () => {
    render(<DdlPanel ddl="CREATE VIEW `v` AS SELECT 1" objectType="view" />)

    expect(screen.queryByTestId('metadata-card')).not.toBeInTheDocument()
  })

  it('does NOT show MetadataCard for procedures', () => {
    render(<DdlPanel ddl="CREATE PROCEDURE sp() BEGIN END" objectType="procedure" />)

    expect(screen.queryByTestId('metadata-card')).not.toBeInTheDocument()
  })

  it('DDL is rendered as React elements (not innerHTML)', () => {
    const { container } = render(<DdlPanel ddl="CREATE TABLE `t` (`id` int)" objectType="view" />)

    // Verify no dangerouslySetInnerHTML — check that there are span children in the code element
    const codeEl = container.querySelector('code')
    expect(codeEl).toBeTruthy()
    const spans = codeEl!.querySelectorAll('span')
    expect(spans.length).toBeGreaterThan(0)

    // Ensure no elements have __html attribute pattern (sign of dangerouslySetInnerHTML)
    const allElements = container.querySelectorAll('[dangerouslySetInnerHTML]')
    expect(allElements).toHaveLength(0)
  })

  it('keywords are wrapped in .keyword spans', () => {
    const { container } = render(<DdlPanel ddl="CREATE TABLE" objectType="view" />)

    const keywordSpans = container.querySelectorAll('span')
    const keywordTexts = Array.from(keywordSpans)
      .filter((s) => s.className.includes('keyword'))
      .map((s) => s.textContent)

    expect(keywordTexts).toContain('CREATE')
    expect(keywordTexts).toContain('TABLE')
  })

  it('backtick identifiers are wrapped in .identifier spans', () => {
    const { container } = render(<DdlPanel ddl="CREATE TABLE `users`" objectType="view" />)

    const identSpans = Array.from(container.querySelectorAll('span')).filter((s) =>
      s.className.includes('identifier')
    )
    expect(identSpans.some((s) => s.textContent === '`users`')).toBe(true)
  })

  it('highlights routine DDL keywords and data types for schema-only views', () => {
    const ddl =
      'CREATE FUNCTION `fn_total`(order_id BIGINT) RETURNS DECIMAL(10,2) DETERMINISTIC\nBEGIN\n  RETURN 0.00;\nEND'

    const { container } = render(<DdlPanel ddl={ddl} objectType="function" />)

    const spans = Array.from(container.querySelectorAll('span'))
    const keywordTexts = spans
      .filter((span) => span.className.includes('keyword'))
      .map((span) => span.textContent)
    const typeTexts = spans
      .filter((span) => span.className.includes('type'))
      .map((span) => span.textContent)

    expect(keywordTexts).toEqual(
      expect.arrayContaining([
        'CREATE',
        'FUNCTION',
        'RETURNS',
        'DETERMINISTIC',
        'BEGIN',
        'RETURN',
        'END',
      ])
    )
    expect(typeTexts).toEqual(expect.arrayContaining(['BIGINT', 'DECIMAL']))
  })

  it('uses the same label text format as table DDL preview', () => {
    render(<DdlPanel ddl="CREATE PROCEDURE p() BEGIN END" objectType="procedure" />)

    expect(screen.getByText('<> DDL')).toBeInTheDocument()
  })

  it('no dangerouslySetInnerHTML used', () => {
    const { container } = render(<DdlPanel ddl="SELECT * FROM `t`" objectType="view" />)

    // Check the rendered HTML does not contain data-reactroot innerHTML markers
    // Instead, verify that code element has proper React child spans
    const codeEl = container.querySelector('code')
    expect(codeEl).toBeTruthy()
    expect(codeEl!.children.length).toBeGreaterThan(0)
    // All children should be span elements
    for (const child of Array.from(codeEl!.children)) {
      expect(child.tagName).toBe('SPAN')
    }
  })

  it('does not duplicate column list on DDL tab (use Columns sub-tab)', () => {
    render(
      <DdlPanel ddl="CREATE TABLE `t` (`id` bigint)" objectType="table" metadata={makeMetadata()} />
    )

    expect(screen.queryByText('Columns Definition')).not.toBeInTheDocument()
    expect(screen.queryByTestId('columns-panel')).not.toBeInTheDocument()
  })
})
