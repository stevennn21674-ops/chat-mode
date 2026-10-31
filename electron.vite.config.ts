import { defineConfig } from 'electron-vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  main: {
    build: {
      sourcemap: false,
      rollupOptions: {
        input: {
          index: resolve(root, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    build: {
      sourcemap: false,
      rollupOptions: {
        input: {
          overlay: resolve(root, 'src/preload/overlay.ts'),
          settings: resolve(root, 'src/preload/settings.ts'),
          voice: resolve(root, 'src/preload/voice.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: resolve(root, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(root, 'src/shared')
      }
    },
    server: {
      fs: {
        allow: [resolve(root, 'src'), root]
      }
    },
    build: {
      sourcemap: false,
      rollupOptions: {
        input: {
          overlay: resolve(root, 'src/renderer/overlay/index.html'),
          settings: resolve(root, 'src/renderer/settings/index.html'),
          voice: resolve(root, 'src/renderer/voice/index.html')
        }
      }
    }
  }
})
