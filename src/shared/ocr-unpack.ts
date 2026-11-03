/** Runtime packages the tesseract.js Node worker can require. */
export const OCR_RUNTIME_PACKAGES = [
  'tesseract.js',
  'tesseract.js-core',
  'bmp-js',
  'idb-keyval',
  'is-electron',
  'is-url',
  'node-fetch',
  'opencollective-postinstall',
  'regenerator-runtime',
  'wasm-feature-detect',
  'zlibjs',
  'whatwg-url',
  'tr46',
  'webidl-conversions'
]

/** Modules the unpacked Node worker resolves from its own file. */
export const OCR_WORKER_REQUIRES = [
  'node-fetch',
  'whatwg-url',
  'tr46',
  'webidl-conversions',
  'regenerator-runtime',
  'is-url',
  'bmp-js',
  'is-electron',
  'wasm-feature-detect',
  'tesseract.js-core/tesseract-core-simd-lstm',
  'tesseract.js-core/tesseract-core-lstm'
]

/** LSTM builds the worker actually loads. Non-LSTM copies stay out of the installer. */
export const OCR_CORE_FILES = [
  'tesseract-core-simd-lstm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm',
  'tesseract-core-lstm.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-lstm.wasm'
]

export function unpackGaps(builderYaml: string): string[] {
  return OCR_RUNTIME_PACKAGES.filter((name) => !builderYaml.includes(`node_modules/${name}/`))
}

export function excludedCoreFiles(builderYaml: string): string[] {
  if (builderYaml.includes('*.wasm.js')) return [...OCR_CORE_FILES]
  return OCR_CORE_FILES.filter((file) => builderYaml.includes(`tesseract.js-core/${file}`))
}
