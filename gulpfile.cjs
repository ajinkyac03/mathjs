// @ts-nocheck
const fs = require('fs')
const path = require('path')
const gulp = require('gulp')
const del = require('del')
const log = require('fancy-log')
const webpack = require('webpack')
const babel = require('gulp-babel')
const mkdirp = require('mkdirp')
const docgenerator = require('./tools/docgenerator')
const entryGenerator = require('./tools/entryGenerator')
const validateAsciiChars = require('./tools/validateAsciiChars')

const SRC_DIR = path.join(__dirname, '/src')
const BUNDLE_ENTRY = `${SRC_DIR}/defaultInstance.js`
const HEADER = `${SRC_DIR}/header.js`
const VERSION = `${SRC_DIR}/version.js`
const COMPILE_SRC = `${SRC_DIR}/**/*.?(c)js`
const COMPILE_ENTRY_SRC = `${SRC_DIR}/entry/**/*.js`

const COMPILE_DIR = path.join(__dirname, '/lib')
const COMPILE_BROWSER = `${COMPILE_DIR}/browser`
const COMPILE_CJS = `${COMPILE_DIR}/cjs`
const COMPILE_ESM = `${COMPILE_DIR}/esm` // es modules
const COMPILE_ENTRY_LIB = `${COMPILE_CJS}/entry`

const FILE = 'math.js'

const REF_SRC = SRC_DIR + '/'
const REF_DIR = path.join(__dirname, '/docs')
const REF_DEST = `${REF_DIR}/reference/functions`
const REF_ROOT = `${REF_DIR}/reference`

const MATH_JS = `${COMPILE_BROWSER}/${FILE}`
const COMPILED_HEADER = `${COMPILE_CJS}/header.js`

const PACKAGE_JSON_COMMONJS = '{\n  "type": "commonjs"\n}\n'

const AUTOGENERATED_WARNING = `
// Note: This file is automatically generated when building math.js.
// Changes made in this file will be overwritten.
`

// read the version number from package.json
function getVersion () {
  return JSON.parse(String(fs.readFileSync('./package.json'))).version
}

// generate banner with today's date and correct version
function createBanner () {
  const today = new Date().toISOString().substr(0, 10) // today, formatted as yyyy-mm-dd
  const version = getVersion()

  return String(fs.readFileSync(HEADER))
    .replace('@@date', today)
    .replace('@@version', version)
}

// generate a js file containing the version number
function updateVersionFile (done) {
  const version = getVersion()

  fs.writeFileSync(VERSION, `export const version = '${version}'${AUTOGENERATED_WARNING}`)

  done()
}

const bannerPlugin = new webpack.BannerPlugin({
  banner: createBanner(),
  entryOnly: true,
  raw: true
})

const babelConfig = JSON.parse(String(fs.readFileSync('./.babelrc')))

const webpackConfig = {
  entry: BUNDLE_ENTRY,
  mode: 'production',
  performance: { hints: false }, // to hide the "asset size limit" warning
  output: {
    library: 'math',
    libraryTarget: 'umd',
    libraryExport: 'default',
    path: COMPILE_BROWSER,
    globalObject: 'this',
    filename: FILE
  },
  plugins: [
    bannerPlugin
    // new webpack.optimize.ModuleConcatenationPlugin()
    // TODO: ModuleConcatenationPlugin seems not to work. https://medium.com/webpack/webpack-3-official-release-15fd2dd8f07b
  ],
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            ...babelConfig,
            presets: [
              ['@babel/preset-env', {
                useBuiltIns: 'usage',
                corejs: '3.15'
              }]
            ]
          }
        }
      }
    ]
  },
  devtool: 'source-map',
  cache: true
}

// create a single instance of the compiler to allow caching
const compiler = webpack(webpackConfig)

function bundle (done) {
  // update the banner contents (has a date in it which should stay up to date)
  bannerPlugin.banner = createBanner()

  compiler.run(function (err, stats) {
    if (err) {
      log(err)
      done(err)
    }
    const info = stats.toJson()

    if (stats.hasWarnings()) {
      log('Webpack warnings:\n' + info.warnings.join('\n'))
    }

    if (stats.hasErrors()) {
      log('Webpack errors:\n' + info.errors.join('\n'))
      done(new Error('Compile failed'))
    }

    // create commonjs package.json file
    fs.writeFileSync(path.join(COMPILE_BROWSER, 'package.json'), PACKAGE_JSON_COMMONJS)

    log(`bundled ${MATH_JS}`)

    done()
  })
}

function compileCommonJs () {
  // create a package.json file in the commonjs folder
  mkdirp.sync(COMPILE_CJS)
  fs.writeFileSync(path.join(COMPILE_CJS, 'package.json'), PACKAGE_JSON_COMMONJS)

  return gulp.src(COMPILE_SRC)
    .pipe(babel())
    .pipe(gulp.dest(COMPILE_CJS))
}

function compileESModules () {
  return gulp.src(COMPILE_SRC)
    .pipe(babel({
      ...babelConfig,
      presets: [
        ['@babel/preset-env', {
          modules: false,
          targets: {
            esmodules: true
          }
        }]
      ]
    }))
    .pipe(gulp.dest(COMPILE_ESM))
}

function compileEntryFiles () {
  return gulp.src(COMPILE_ENTRY_SRC)
    .pipe(babel())
    .pipe(gulp.dest(COMPILE_ENTRY_LIB))
}

function writeCompiledHeader (cb) {
  fs.writeFileSync(COMPILED_HEADER, createBanner())
  cb()
}

function validateAscii (done) {
  const Reset = '\x1b[0m'
  const BgRed = '\x1b[41m'

  validateAsciiChars.getAllFiles(SRC_DIR)
    .map(validateAsciiChars.validateChars)
    .forEach(function (invalidChars) {
      invalidChars.forEach(function (res) {
        console.log(res.insideComment ? '' : BgRed,
          'file:', res.filename,
          'ln:' + res.ln,
          'col:' + res.col,
          'inside comment:', res.insideComment,
          'code:', res.c,
          'character:', String.fromCharCode(res.c),
          Reset
        )
      })
    })

  done()
}

async function generateDocs (done) {
  const all = await import('file://' + REF_SRC + 'defaultInstance.js')
  const functionNames = Object.keys(all)
    .filter(key => typeof all[key] === 'function')

  docgenerator.cleanup(REF_DEST, REF_ROOT)
  docgenerator.iteratePath(functionNames, REF_SRC, REF_DEST, REF_ROOT)

  done()
}

function generateEntryFiles (done) {
  entryGenerator.generateEntryFiles().then(() => {
    done()
  })
}

/**
 * Remove generated files
 *
 * @returns {Promise<string[]> | *}
 */
function clean () {
  return del([
    // legacy compiled files
    './es/',

    // generated browser bundle, esm code, and commonjs code
    './lib/',

    // generated source files
    'src/**/*.generated.js'
  ])
}

gulp.task('browser', bundle)

gulp.task('clean', clean)

gulp.task('docs', generateDocs)

// check whether any of the source files contains non-ascii characters
gulp.task('validate:ascii', validateAscii)

// The watch task (to automatically rebuild when the source code changes)
gulp.task('watch', function watch () {
  const files = ['package.json', 'src/**/*.js']
  const options = {
    // ignore version.js else we get an infinite loop since it's updated during bundle
    ignored: /version\.js/,
    ignoreInitial: false,
    delay: 100
  }

  gulp.watch(files, options, gulp.parallel(bundle, compileCommonJs))
})

// The default task (called when you run `gulp`)
gulp.task('default', gulp.series(
  clean,
  updateVersionFile,
  generateEntryFiles,
  compileCommonJs,
  compileEntryFiles,
  compileESModules, // Must be after generateEntryFiles
  writeCompiledHeader,
  bundle,
  generateDocs
))
