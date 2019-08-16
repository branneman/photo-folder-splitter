'use strict'

const DIR_INPUT = `${__dirname}/data/in`
const DIR_OUTPUT = `${__dirname}/data/out`
const DIR_FAIL = `${__dirname}/data/fail`
const GLOB_INPUT = `${DIR_INPUT}/**/*.jpg`
const EXIF_DATEFORMAT = 'YYYY:MM:DD HH:mm:ss'
const DIR_DATEFORMAT = 'YYYY/MM'

const { readFile } = require('fs')
const path = require('path')
const glob = require('glob')
const Exif = require('exif').ExifImage
const moment = require('moment')

const { __: _, map, chain, pipe, prop, assoc } = require('ramda')
const { Future, node, parallel, fork } = require('fluture') // replace with crocks/Async
const Maybe = require('crocks/Maybe')
const safeProp = require('crocks/Maybe/getProp')
const { Just, Nothing } = Maybe

// getPhotos :: str -> Future [str]
const getPhotos = pattern => node(cb => glob(pattern, cb))

// getVinyl :: str -> Future obj
const getVinyl = file =>
  Future((rej, res) => {
    readFile(file, (err, data) =>
      err
        ? rej(err)
        : res({
            path: file,
            contents: data // Buffer
          })
    )
  })

// getSafeExifData :: (*, obj) -> Maybe obj
const getSafeExifData = (err, result) =>
  !err && result.exif && Object.entries(result.exif).length
    ? Maybe.of(result.exif)
    : Nothing()

// getExif :: obj -> Future obj
const getExif = vinyl =>
  Future((rej, res) => {
    new Exif(vinyl.contents, (err, result) =>
      res({
        ...vinyl,
        exif: getSafeExifData(err, result)
      })
    )
  })

// parseExifCreateDate :: str -> Maybe Moment
const parseExifCreateDate = str => {
  const m = moment(str, EXIF_DATEFORMAT)
  return m.isValid() ? Just(m) : Nothing()
}

// getCreateDate :: obj -> obj
const getCreateDate = vinyl => {
  return pipe(
    prop('exif'), //                   obj -> Maybe obj
    chain(safeProp('CreateDate')), //  Maybe obj -> Maybe str
    chain(parseExifCreateDate), //     Maybe str -> Maybe Moment
    assoc('createDate', _, vinyl) //   Maybe Moment -> obj
  )(vinyl)
}

// createDateToDir :: Moment -> str
const createDateToDir = m => m.format(DIR_DATEFORMAT)

// getTargetPath :: obj -> Maybe str -> Maybe str
const getTargetPath = vinyl =>
  map(createDate => {
    const dir = createDateToDir(createDate)
    const file = path.relative(DIR_INPUT, vinyl.path)
    return `${DIR_OUTPUT}/${dir}/${file}`
  })

// copyFile :: obj -> obj
const getCopyAction = vinyl => {
  return {
    source: vinyl.path,
    target: getTargetPath(vinyl)(vinyl.createDate)
  }
}

const quitOnError = err => (console.error(err), process.exit(1))
const printError = err => console.error('ERROR', err)

// processFile :: a -> Future b
const processFile = pipe(
  getVinyl, //            str        -> Future obj
  chain(getExif), //      Future obj -> Future obj
  map(getCreateDate), //  Future obj -> Future obj
  map(getCopyAction) //   Future obj -> Future obj
)

// app :: str -> Future [obj]
const app = pipe(
  getPhotos, //               str          -> Future [str]
  map(chain(processFile)), // Future [str] -> [Future obj]
  chain(parallel(5)) //       [Future obj] -> Future [obj]
)

fork(quitOnError)(console.log)(app(GLOB_INPUT))
