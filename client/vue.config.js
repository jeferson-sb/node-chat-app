const path = require('path')
const manifest = require('./public/manifest.json')

module.exports = {
  outputDir: path.resolve(__dirname, '../public'),
  devServer: {
    proxy: {
      '/socket': {
        target:
          process.env.NODE_ENV === 'production'
            ? 'https://serene-hamlet-35525.herokuapp.com/'
            : 'http://localhost:5000/'
      }
    }
  },
  pwa: {
    themeColor: manifest.theme_color
  }
}
