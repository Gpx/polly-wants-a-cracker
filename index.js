const debug = require('debug')('polly')
const program = require('commander')
const fetch = require('node-fetch')
const express = require('express')
const bodyParser = require('body-parser')
const multer = require('multer')
const HAR = require('har')
const { chunk } = require('lodash')
const fs = require('fs')

program
  .version('1.0.0')
  .option('-s, --session <session>', 'session name')
  .option(
    '-m, --mode <mode>',
    'how to run the server, can be "record" or "replay"',
    m => m,
    'replay'
  )
  .option('-p, --port <n>', 'port where the server runs', parseInt, 1234)
  .parse(process.argv)

const log = new HAR.Log({
  version: 1.2,
  creator: new HAR.Creator({ name: 'Polly wants a cracker', version: '1.0.0' }),
})

function getReqHeaders(headers) {
  return chunk(headers, 2).map(
    ([name, value]) => new HAR.Header({ name, value })
  )
}

function getResponseHeaders(headers) {
  return Array.from(headers.entries()).reduce(
    (h, [key, value]) => ({ ...h, [key]: value }),
    {}
  )
}

function getResponseHeadersToHAR(headers) {
  const plainHeaders = getResponseHeaders(headers)
  return Object.keys(plainHeaders).map(
    name => new HAR.Header({ name, value: plainHeaders[name] })
  )
}

function logEntry(req, response, data) {
  log.addEntry(
    new HAR.Entry({
      startedDateTime: new Date(),
      request: new HAR.Request({
        url: req.path,
        headers: getReqHeaders(req.headers),
      }),
      response: new HAR.Response({
        status: response.status,
        statusText: response.statusText,
        content: new HAR.Content({ text: data }),
        headers: getResponseHeadersToHAR(response.headers),
      }),
    })
  )
}

function makeRequest(req) {
  const options = {
    method: req.method,
    headers: req.headers,
    redirect: 'follow',
  }
  if (!['HEAD', 'GET'].includes(req.method))
    options.body = JSON.stringify(req.body)
  const url = `http://sandbox-backend.travelperk.com${req.path}`
  return fetch(url, options)
}

function forwardResponse(res, response, data) {
  res
    .status(response.status)
    .set(getResponseHeaders(response.headers))
    .set('content-encoding', 'identity')
    .send(data)
}

function forwardRecoredResponse(req, res) {
  const { response } = session.entries[counter]
  counter++
  res
    .status(response.status)
    .set(getResponseHeaders(response.headers))
    .set('content-encoding', 'identity')
    .send(response.content.text)
}

const app = express()
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))
const upload = multer()

let session
let counter = 0
if (program.mode === 'replay') {
  const har = fs.readFileSync(`./${program.session}.har`, 'utf8')
  session = JSON.parse(har)
}

app.all('*', upload.array(), async (req, res) => {
  try {
    debug(`received request for ${req.method} ${req.path}`)
    if (program.mode === 'replay') {
      forwardRecoredResponse(req, res)
    } else {
      const response = await makeRequest(req)
      const data = await response.text()
      logEntry(req, response, data)
      forwardResponse(res, response, data)
    }
  } catch (e) {
    debug(e)
    res.send('There was a failure')
  }
})

debug(`staring server on port ${program.port} in mode ${program.mode}`)
app.listen(program.port, () =>
  debug(`server started on port ${program.port} in mode ${program.mode}`)
)

function handleExit() {
  if (program.mode === 'replay') return

  fs.writeFileSync(
    `./${program.session}.har`,
    JSON.stringify(log, undefined, 2),
    'utf8'
  )
}

process.stdin.resume()
process.on('SIGINT', process.exit)
process.on('exit', handleExit)
