import type { ProbeFn } from '../types'
import { execFile } from 'node:child_process'
import { PROBE_TIMEOUT_MS } from '../constants'

/**
 * Last-resort liveness check: run `<bin> --version` with no shell and a hard
 * timeout. Never called when a package record already proves installation.
 */
export const probeBinary: ProbeFn = bin => new Promise((resolve) => {
  execFile(bin, ['--version'], { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error) => {
    resolve(!error)
  })
})
