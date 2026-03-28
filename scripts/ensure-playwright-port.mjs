import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { pickDevPort, DEV_SERVER_HOST } from './pick-dev-port.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const portFile = path.join(root, '.playwright-dev-port')

const port = await pickDevPort(DEV_SERVER_HOST)
writeFileSync(portFile, `${port}\n`, 'utf8')
