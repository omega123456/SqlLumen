import net from 'node:net'

export const DEV_SERVER_HOST = '127.0.0.1'
export const PREFERRED_DEV_PORT = 1420

const MAX_EXTRA = 50

/**
 * @param {string} [host]
 * @param {number} [preferredPort]
 * @returns {Promise<number>}
 */
export function pickDevPort(host = DEV_SERVER_HOST, preferredPort = PREFERRED_DEV_PORT) {
  return new Promise((resolve, reject) => {
    let port = preferredPort

    const tryListen = () => {
      if (port >= preferredPort + MAX_EXTRA) {
        reject(
          new Error(`No free TCP port from ${preferredPort} to ${preferredPort + MAX_EXTRA - 1} on ${host}`),
        )
        return
      }

      const server = net.createServer()
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          port++
          tryListen()
        } else {
          reject(err)
        }
      })
      server.listen(port, host, () => {
        server.close(() => {
          resolve(port)
        })
      })
    }

    tryListen()
  })
}
