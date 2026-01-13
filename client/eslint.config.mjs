import pluginVue from 'eslint-plugin-vue'
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-plugin-prettier'

export default defineConfig([
  ...pluginVue.configs['flat/recommended'],
  {
    plugins: {
      prettier
    }
  }
])
