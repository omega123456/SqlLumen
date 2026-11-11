import { PLAYWRIGHT_MOCK_TIMESTAMP } from './connections'

export interface PlaywrightUpdateFixture {
  rid: number
  currentVersion: string
  version: string
  date: string
  body: string
  contentLength: number
  installChunkLengths: number[]
  downloadChunkLengths: number[]
  downloadRid: number
}

export const UPDATE_FIXTURE: PlaywrightUpdateFixture = {
  rid: 101,
  currentVersion: '0.1.0',
  version: '0.2.0',
  date: PLAYWRIGHT_MOCK_TIMESTAMP,
  body: 'Mock SqlLumen update for Playwright flows.',
  contentLength: 100,
  installChunkLengths: [50, 50],
  downloadChunkLengths: [100],
  downloadRid: 201,
}
