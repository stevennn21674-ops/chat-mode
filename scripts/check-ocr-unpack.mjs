import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { OCR_CORE_FILES, OCR_WORKER_REQUIRES } from '../src/shared/ocr-unpack.ts'

const root = process.argv[2] ? resolve(process.argv[2]) : ''
if (!root) {
  console.error('usage: node --experimental-strip-types scripts/check-ocr-unpack.mjs <app.asar.unpacked>')
  process.exit(1)
}

const worker = join(root, 'node_modules/tesseract.js/src/worker-script/node/index.js')
if (!existsSync(worker)) {
  console.error(`missing worker ${worker}`)
  process.exit(1)
}

const req = createRequire(worker)
let failed = false
for (const name of OCR_WORKER_REQUIRES) {
  try {
    console.log(`ok ${name} ${req.resolve(name)}`)
  } catch (error) {
    failed = true
    const message = error instanceof Error ? error.message : String(error)
    console.error(`MISSING ${name}: ${message}`)
  }
}
for (const file of OCR_CORE_FILES) {
  const path = join(root, 'node_modules/tesseract.js-core', file)
  if (!existsSync(path)) {
    failed = true
    console.error(`MISSING core ${path}`)
  } else {
    console.log(`ok ${file}`)
  }
}
if (failed) process.exit(1)
