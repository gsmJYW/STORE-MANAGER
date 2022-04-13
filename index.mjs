import { exit } from 'process'
import fs from 'fs'
import bodyParser from 'body-parser'
import http from 'http'
import https from 'https'
import parser from 'node-html-parser'
import express from 'express'
import mysql from 'mysql2/promise'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import admin from 'firebase-admin'
import { getAuth } from 'firebase-admin/auth'
import serviceAccount from './store-manager-5d527-firebase-adminsdk-2ovpp-f0b6ef3a8a.json' assert { type: 'json' }

const credentials = {
  key: fs.readFileSync(__dirname + '/ssl/store-manager.kro.kr_20220303F94AA.key.pem'),
  cert: fs.readFileSync(__dirname + '/ssl/store-manager.kro.kr_20220303F94AA.crt.pem'),
}

const args = process.argv.slice(2);

if (args.length < 5) {
  console.error('Parameters not provided: [host] [user] [password] [database] [connectionLimit]')
  exit(1)
}

const pool = mysql.createPool({
  host: args[0],
  user: args[1],
  password: args[2],
  database: args[3],
  connectionLimit: args[4],
})

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://store-manager-5d527-default-rtdb.asia-southeast1.firebasedatabase.app',
})

const auth = getAuth()

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({
  extended: true
}))

app.use('/', express.static('libs'))

app.use((req, res, next) => {
  let protocol = req.headers['x-forwarded-proto'] || req.protocol
  if (protocol == 'https') {
    next()
  }
  else {
    res.redirect(`https://${req.hostname}${req.url}`)
  }
})

app.get('/', async (req, res) => {
  res.sendFile(__dirname + '/views/index.html')
})

app.get('/cjTracking', async (req, res) => {
  res.sendFile(__dirname + '/views/cjTracking.html')
})

app.post('/cjTracking', async (req, res) => {
  let invcNoList = req.body.invcNo

  try {
    let trackingList = await getCJTrackingList(invcNoList)

    while (true) {
      let errorList = trackingList.filter((tracking) => tracking.error == true)

      if (errorList.length <= 0) {
        break
      }

      let tempInvcNoList = []

      for (let error of errorList) {
        tempInvcNoList.push(error.id)
      }

      let tempTrackingList = await getCJTrackingList(tempInvcNoList)

      trackingList = trackingList.filter((tracking) => tracking.error == false)
      trackingList.concat(tempTrackingList)
    }

    res.json({
      result: 'ok',
      cjTracking: trackingList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
})

app.get('/carWash', async (req, res) => {
  res.sendFile(__dirname + '/views/carWash.html')
})

app.post('/siDo', async (req, res) => {
  let conn

  try {
    conn = await pool.getConnection()
    let result = await conn.query('SELECT siDo FROM carWash GROUP BY siDo')

    let siDoList = []

    for (let row of result[0]) {
      siDoList.push(row.siDo)
    }

    res.json({
      result: 'ok',
      siDo: siDoList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/siGunGu', async (req, res) => {
  let siDo = req.body.siDo
  let conn

  try {

    conn = await pool.getConnection()
    let result = await conn.query(`SELECT siGunGu FROM carWash WHERE siDo = '${siDo}' GROUP BY siGunGu`)

    let siGunGuList = []

    for (let row of result[0]) {
      siGunGuList.push(row.siGunGu)
    }

    res.json({
      result: 'ok',
      siGunGu: siGunGuList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/eupMyeonDong', async (req, res) => {
  let siDo = req.body.siDo
  let siGunGu = req.body.siGunGu
  let conn

  try {
    conn = await pool.getConnection()

    let query = 'SELECT eupMyeonDong FROM carWash'
    let whereClause = []

    if (siDo) {
      whereClause.push(`siDo = '${siDo}'`)
    }

    if (siGunGu) {
      whereClause.push(`siGunGu = '${siGunGu}'`)
    }

    if (whereClause.length > 0) {
      query += ` WHERE ${whereClause.join(' AND ')}`
    }

    query += ' GROUP BY eupMyeonDong'
    let result = await conn.query(query)

    let eupMyeonDongList = []

    for (let row of result[0]) {
      eupMyeonDongList.push(row.eupMyeonDong)
    }

    res.json({
      result: 'ok',
      eupMyeonDong: eupMyeonDongList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/carWash', async (req, res) => {
  let siDo = req.body.siDo
  let siGunGu = req.body.siGunGu
  let eupMyeonDong = req.body.eupMyeonDong
  let conn

  try {
    conn = await pool.getConnection()

    let query = 'SELECT * FROM carWash'
    let whereClause = []

    if (siDo) {
      whereClause.push(`siDo = '${siDo}'`)
    }

    if (siGunGu) {
      whereClause.push(`siGunGu = '${siGunGu}'`)
    }

    if (eupMyeonDong) {
      whereClause.push(`eupMyeonDong = '${eupMyeonDong}'`)
    }

    if (whereClause.length > 0) {
      query += ` WHERE ${whereClause.join(' AND ')}`
    }

    let result = await conn.query(query)
    let carWashList = result[0]

    query = query.replace('*', 'AVG(lat) as lat, AVG(lon) as lon')
    result = await conn.query(query)
    let center = result[0][0]

    res.json({
      result: 'ok',
      carWash: carWashList,
      center: center,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/signin', async (req, res) => {
  let idToken = req.body.idToken
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid
    let user = await auth.getUser(uid)

    conn = await pool.getConnection()

    await conn.query(`
      INSERT INTO user (uid, email, name) VALUES ('${uid}', '${user.email}', '${user.displayName}')
      ON DUPLICATE KEY UPDATE user.email = '${user.email}', name = '${user.displayName}'
    `)

    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)

    res.json({
      result: 'ok',
      user: result[0][0],
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/user', async (req, res) => {
  let idToken = req.body.idToken
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    conn = await pool.getConnection()
    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)

    res.json({
      result: 'ok',
      user: result[0][0],
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/quota', async (req, res) => {
  let idToken = req.body.idToken
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    let now = await getKST()
    conn = await pool.getConnection()

    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)
    let isAdmin = result[0][0].permission == 1

    result = await conn.query(`SELECT * FROM query WHERE uid = '${uid}' AND day = ${getDay(now)}`)

    res.json({
      result: 'ok',
      isAdmin: isAdmin,
      quota: result[0],
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/user/update', async (req, res) => {
  let idToken = req.body.idToken
  let loadAll = req.body.loadAll
  let highlightChanges = req.body.highlightChanges
  let sortMethod = req.body.sortMethod
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    conn = await pool.getConnection()
    await conn.query(`REPLACE INTO user (uid, loadAll, highlightChanges, sortMethod) VALUES ('${uid}', ${loadAll}, ${highlightChanges}, ${sortMethod})`)

    res.json({ result: 'ok' })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/bookmark', async (req, res) => {
  let idToken = req.body.idToken
  let storeUrl = req.body.storeUrl
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    let query = `SELECT bookmark.storeUrl, store.title FROM bookmark INNER JOIN store WHERE uid = '${uid}' AND bookmark.storeUrl = store.url`

    if (storeUrl) {
      query += ` AND storeUrl = '${storeUrl}'`
    }

    conn = await pool.getConnection()
    let result = await conn.query(query)

    res.json({
      result: 'ok',
      bookmark: result[0],
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/bookmark/update', async (req, res) => {
  let idToken = req.body.idToken
  let storeUrl = req.body.storeUrl
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    let query = `REPLACE INTO bookmark (uid, storeUrl) VALUES ('${uid}', '${storeUrl}')`

    conn = await pool.getConnection()
    await conn.query(query)

    res.json({ result: 'ok' })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/bookmark/delete', async (req, res) => {
  let idToken = req.body.idToken
  let storeUrl = req.body.storeUrl
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    let query = `DELETE FROM bookmark WHERE uid = '${uid}' AND storeUrl = '${storeUrl}'`

    conn = await pool.getConnection()
    await conn.query(query)

    res.json({ result: 'ok' })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/save', async (req, res) => {
  let idToken = req.body.idToken
  let storeUrl = req.body.storeUrl
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    let now = await getKST()

    conn = await pool.getConnection()
    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)

    if (result[0][0].permission == 0) {
      let result = await conn.query(`SELECT SUM(amount) AS amount FROM query WHERE uid='${uid}' AND day = ${getDay(now)} AND type = 3`)

      let quotaLimit = 10

      if (result[0].length > 0) {
        if (result[0][0].amount >= quotaLimit) {
          res.json({
            result: 'quota exceeded',
            quotaUsed: result[0][0].amount,
            quotaLimit: quotaLimit,
          })
          return
        }
      }
    }

    await conn.query(`
      INSERT INTO query (uid, storeUrl, day, second, type, amount) VALUES ('${uid}', '${storeUrl}', ${getDay(now)}, ${getSecond(now)}, 3, 1)
      ON DUPLICATE KEY UPDATE second = ${getSecond(now)}, amount = amount + 1
    `)

    res.json({ result: 'ok' })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/smartstore/search', async (req, res) => {
  let query = req.body.query
  let storeUrl, endpoint

  if (query.includes('smartstore.naver.com')) {
    storeUrl = query

    if (storeUrl.startsWith('http://')) {
      storeUrl = storeUrl.replace('http://', 'https://')
    }

    if (!storeUrl.startsWith('https://')) {
      storeUrl = 'https://' + storeUrl
    }
  }
  else {
    try {
      endpoint = await searchNaver(query)

      if (!endpoint) {
        res.json({
          result: 'zeroResult',
          query: query,
        })
        return
      }

      storeUrl = `https://smartstore.naver.com/${endpoint}`
    }
    catch (error) {
      res.json({
        result: 'error',
        error: error.message,
      })
      return
    }
  }

  let conn

  try {
    let storeTitle = await searchSmartstore(storeUrl)

    if (!storeTitle) {
      res.json({
        result: 'notSmartstoreUrl',
        url: storeUrl,
      })
      return
    }

    endpoint = storeUrl.slice(storeUrl.indexOf('smartstore.naver.com') + 21)
    if (!new RegExp('^[a-z0-9_-]+$').test(endpoint)) {
      endpoint.slice(0, new RegExp('[^a-z0-9_-]+').exec(endpoint).index)
    }

    conn = await pool.getConnection()
    await conn.query(`
      INSERT INTO store (url, title) VALUES ('${storeUrl}', '${storeTitle}')
      ON DUPLICATE KEY UPDATE title = '${storeTitle}'
    `)

    res.json({
      result: 'ok',
      storeUrl: endpoint,
      storeTitle: storeTitle
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/history', async (req, res) => {
  let idToken = req.body.idToken
  let storeUrl = req.body.storeUrl

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    let now = await getKST()
    let conn = await pool.getConnection()

    let result

    if (storeUrl == 'https://n09.co.kr' || storeUrl == 'https://hyundai.auton.kr/') {
      result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)
      if (result[0][0].permission == 0) {
        res.json({ result: 'no permission' })
      }
    }

    await conn.query(`
      INSERT INTO query (uid, storeUrl, day, second, type, amount) VALUES ('${uid}', '${storeUrl}', ${getDay(now)}, ${getSecond(now)}, 0, 1)
      ON DUPLICATE KEY UPDATE second = ${getSecond(now)}, amount = amount + 1
    `)

    result = await conn.query(`SELECT FROM_UNIXTIME(minute * 60) as time FROM history WHERE storeUrl = '${storeUrl}'`)
    let history = []

    for (let row of result[0]) {
      history.push(row.time)
    }

    res.json({
      result: 'ok',
      history: history,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
    return
  }
})

app.post('/product', async (req, res) => {
  let idToken = req.body.idToken
  let storeUrl = req.body.storeUrl
  let time = req.body.time

  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    let now = await getKST()

    conn = await pool.getConnection()
    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)

    if (result[0][0].permission == 0) {
      if (storeUrl == 'https://n09.co.kr' || storeUrl == 'https://hyundai.auton.kr/') {
        res.json({ result: 'no permission' })
      }

      result = await conn.query(`SELECT SUM(amount) AS amount FROM query WHERE uid = '${uid}' AND day = ${getDay(now)} AND type = 1`)

      let quotaLimit = 100000

      if (result[0].length > 0) {
        if (result[0][0].amount >= quotaLimit) {
          res.json({
            result: 'quota exceeded',
            quotaUsed: result[0][0].amount,
            quotaLimit: quotaLimit,
          })
          return
        }
      }
    }

    result = await conn.query(`SELECT * FROM product WHERE storeUrl = '${storeUrl}' AND minute = ${getMinute(new Date(time))}`)
    let productList = result[0]

    await conn.query(`
      INSERT INTO query (uid, storeUrl, day, second, type, amount) VALUES ('${uid}', '${storeUrl}', ${getDay(now)}, ${getSecond(now)}, 1, ${productList.length})
      ON DUPLICATE KEY UPDATE second = ${getSecond(now)}, amount = amount + ${productList.length}
    `)

    res.json({
      result: 'ok',
      product: productList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.get('/smartstore/:endpoint', async (req, res) => {
  let endpoint = req.params.endpoint
  let storeUrl = `https://smartstore.naver.com/${endpoint}`

  if (!new RegExp('^[a-z0-9_-]+$').test(endpoint)) {
    res.sendFile(__dirname + '/views/storeNotFound.html')
    return
  }

  let storeTitle
  let conn

  try {
    conn = await pool.getConnection()
    let result = await conn.query(`SELECT * FROM store WHERE url = '${storeUrl}'`)

    if (result[0].length > 0) {
      storeTitle = result[0][0].title
    }
    else {
      storeTitle = await searchSmartstore(storeUrl)

      if (!storeTitle) {
        throw new Error()
      }

      await conn.query(`
        INSERT INTO store (url, title) VALUES ('${storeUrl}', '${storeTitle}')
        ON DUPLICATE KEY UPDATE title = '${storeTitle}'
      `)
    }

    fs.readFile(__dirname + '/views/smartstore.html', (error, data) => {
      if (error) {
        res.json({
          result: 'error',
          error: error.message,
        })
        return
      }

      let htmlString = data.toString()
      htmlString = htmlString.replaceAll('$storeUrl', storeUrl)
      htmlString = htmlString.replaceAll('$storeTitle', storeTitle)
      res.send(htmlString)
    })
  }
  catch (error) {
    res.sendFile(__dirname + '/views/storeNotFound.html')
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/smartstore/update', async (req, res) => {
  let idToken = req.body.idToken
  let storeUrl = req.body.storeUrl
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    let now = await getKST()

    conn = await pool.getConnection()
    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)

    if (result[0][0].permission == 0) {
      result = await conn.query(`SELECT SUM(amount) AS amount FROM query WHERE uid='${uid}' AND day = ${getDay(now)} AND type = 2`)

      let quotaLimit = 25000

      if (result[0].length > 0) {
        if (result[0][0].amount >= quotaLimit) {
          res.json({
            result: 'quota exceeded',
            quotaUsed: result[0][0].amount,
            quotaLimit: quotaLimit,
          })
          return
        }
      }
    }

    result = await conn.query(`SELECT * FROM history WHERE storeUrl = '${storeUrl}' AND minute = ${getMinute(now)}`)
    let productList

    if (result[0].length > 0) {
      let history = result[0][0]

      result = await conn.query(`SELECT * FROM product WHERE storeUrl = '${storeUrl}' AND minute = ${getMinute(now)}`)
      productList = result[0]

      res.json({
        result: 'already exists',
        time: new Date(history.minute * 60 * 1000),
        product: productList,
      })
      return
    }

    let productAmount = await getSmartstoreProductAmount(storeUrl)
    productList = await getSmartstoreProductList(storeUrl, productAmount)

    let query = 'REPLACE INTO product (storeUrl, minute, id, title, price, popularityIndex, isSoldOut) VALUES '

    for (let product of productList) {
      let productTitle = product.title.replaceAll(/[^0-9A-Za-zㄱ-ㅎㅏ-ㅣ가-힣!@#$%^&*()-_=+\[{\]}\/\\\s]+/g, '')
      query += `('${storeUrl}', '${getMinute(now)}', ${product.id}, '${productTitle}', ${product.price}, ${product.popularityIndex}, ${product.isSoldOut ? 1 : 0}), `
    }

    query = query.substring(0, query.length - 2)
    await conn.query(query)
    await conn.query(`REPLACE INTO history (storeUrl, minute) VALUES ('${storeUrl}', ${getMinute(now)})`)

    await conn.query(`
      INSERT INTO query (uid, storeUrl, day, second, type, amount) VALUES ('${uid}', '${storeUrl}', ${getDay(now)}, ${getSecond(now)}, 2, ${productList.length})
      ON DUPLICATE KEY UPDATE second = ${getSecond(now)}, amount = amount + ${productList.length}
    `)

    res.json({
      result: 'ok',
      time: new Date(getMinute(now) * 60 * 1000),
      product: productList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.get('/n09', async (req, res) => {
  res.sendFile(__dirname + '/views/n09.html')
})

app.post('/n09/update', async (req, res) => {
  let storeUrl = 'https://n09.co.kr'
  let idToken = req.body.idToken
  let conn

  try {
    let now = await getKST()

    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    conn = await pool.getConnection()
    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)

    if (result[0][0].permission == 0) {
      res.json({ result: 'no permission' })
      return;
    }

    result = await conn.query(`SELECT * FROM history WHERE storeUrl = '${storeUrl}' AND minute = ${getMinute(now)}`)
    let productList

    if (result[0].length > 0) {
      let history = result[0][0]

      result = await conn.query(`SELECT * FROM product WHERE storeUrl = '${storeUrl}' AND minute = ${getMinute(now)}`)
      productList = result[0]

      res.json({
        result: 'already exists',
        time: new Date(history.minute * 60 * 1000),
        product: productList,
      })
      return
    }

    let productAmount = await getN09ProductAmount()
    productList = await getN09ProductList(productAmount)

    let query = 'REPLACE INTO product (storeUrl, minute, id, title, price, popularityIndex, isSoldOut) VALUES '

    for (let product of productList) {
      let productTitle = product.title.replaceAll(/[^0-9A-Za-zㄱ-ㅎㅏ-ㅣ가-힣!@#$%^&*()-_=+\[{\]}\/\\\s]+/g, '')
      query += `('${storeUrl}', '${getMinute(now)}', ${product.id}, '${productTitle}', ${product.price}, ${product.popularityIndex}, ${product.isSoldOut ? 1 : 0}), `
    }

    query = query.substring(0, query.length - 2)
    await conn.query(query)
    await conn.query(`REPLACE INTO history (storeUrl, minute) VALUES ('${storeUrl}', ${getMinute(now)})`)

    await conn.query(`
      INSERT INTO query (uid, storeUrl, day, second, type, amount) VALUES ('${uid}', '${storeUrl}', ${getDay(now)}, ${getSecond(now)}, 2, ${productList.length})
      ON DUPLICATE KEY UPDATE second = ${getSecond(now)}, amount = amount + ${productList.length}
    `)

    res.json({
      result: 'ok',
      time: new Date(getMinute(now) * 60 * 1000),
      product: productList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.get('/hyundai/auton', async (req, res) => {
  res.sendFile(__dirname + '/views/carlifemall.html')
})

app.post('/hyundai/auton/update', async (req, res) => {
  let storeUrl = 'https://hyundai.auton.kr'
  let idToken = req.body.idToken
  let conn

  try {
    let now = await getKST()

    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    conn = await pool.getConnection()
    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)

    if (result[0][0].permission == 0) {
      res.json({ result: 'no permission' })
      return;
    }

    result = await conn.query(`SELECT * FROM history WHERE storeUrl = '${storeUrl}' AND minute = ${getMinute(now)}`)
    let productList

    if (result[0].length > 0) {
      let history = result[0][0]

      result = await conn.query(`SELECT * FROM product WHERE storeUrl = '${storeUrl}' AND minute = ${getMinute(now)}`)
      productList = result[0]

      res.json({
        result: 'already exists',
        time: new Date(history.minute * 60 * 1000),
        product: productList,
      })
      return
    }

    let categoryIdList = []

    while (categoryIdList <= 0) {
      categoryIdList = await getCarlifemallCategoryIdList()
    }

    let categoryList = await getCarlifemallCategoryList(categoryIdList)

    while (true) {
      let tempCategoryIdList = []

      for (let index = categoryList.length - 1; index >= 0; index--) {
        let category = categoryList[index]

        if (isNaN(category.productAmount)) {
          tempCategoryIdList.push(category.id)
        }
      }

      if (tempCategoryIdList.length > 0) {
        let tempCategoryList = await getCarlifemallCategoryList(tempCategoryIdList)

        for (let tempCategory of tempCategoryList) {
          for (let category of categoryList) {
            if (category.id == tempCategory.id) {
              category.productAmount = tempCategory.productAmount
            }
          }
        }
      }
      else {
        break
      }
    }

    let pageList = []

    for (let category of categoryList) {
      for (let page = 1; page <= Math.ceil(category.productAmount / 100); page++) {
        pageList.push({
          categoryId: category.id,
          categoryTitle: category.title,
          num: page,
        })
      }
    }

    pageList = await getCarlifemallProductList(pageList)

    while (true) {
      let tempPageList = []

      for (let page of pageList) {
        if (page.productList.length <= 0) {
          tempPageList.push(page)
        }
      }

      if (tempPageList.length > 0) {
        tempPageList = await getCarlifemallProductList(tempPageList)

        for (let tempPage of tempPageList) {
          for (let page of pageList) {
            if (tempPage.categoryId == page.categoryId && tempPage.num == page.num) {
              page.productList = tempPage.productList
            }
          }
        }
      }
      else {
        break
      }
    }

    productList = []

    for (let page of pageList) {
      for (let product of page.productList) {
        if (productList.filter((tempProduct) => tempProduct.id == product.id).length <= 0) {
          productList.push(product)
        }
      }
    }

    let query = 'REPLACE INTO product (storeUrl, minute, id, title, price, popularityIndex, isSoldOut, category) VALUES '

    for (let product of productList) {
      let productTitle = product.title.replaceAll(/[^0-9A-Za-zㄱ-ㅎㅏ-ㅣ가-힣!@#$%^&*()-_=+\[{\]}\/\\\s]+/g, '')
      query += `('${storeUrl}', '${getMinute(now)}', ${product.id}, '${productTitle}', ${product.price}, ${product.popularityIndex}, ${product.isSoldOut ? 1 : 0}, '${product.category}'), `
    }

    query = query.substring(0, query.length - 2)
    await conn.query(query)
    await conn.query(`REPLACE INTO history (storeUrl, minute) VALUES ('${storeUrl}', '${getMinute(now)}')`)

    res.json({
      result: 'ok',
      time: new Date(getMinute(now) * 60 * 1000),
      product: productList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.get('/autowash', async (req, res) => {
  res.sendFile(__dirname + '/views/autowash.html')
})

app.post('/autowash/update', async (req, res) => {
  let storeUrl = 'https://autowash.co.kr'
  let idToken = req.body.idToken
  let conn

  try {
    let now = await getKST()

    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    conn = await pool.getConnection()
    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)

    if (result[0][0].permission == 0) {
      res.json({ result: 'no permission' })
      return;
    }

    result = await conn.query(`SELECT * FROM history WHERE storeUrl = '${storeUrl}' AND minute = ${getMinute(now)}`)
    let productList

    if (result[0].length > 0) {
      let history = result[0][0]

      result = await conn.query(`SELECT * FROM product WHERE storeUrl = '${storeUrl}' AND minute = ${getMinute(now)}`)
      productList = result[0]

      res.json({
        result: 'already exists',
        time: new Date(history.minute * 60 * 1000),
        product: productList,
      })
      return
    }

    let categoryIdList = await getAutowashCategoryIdList()
    let categoryList = await getAutowashCategoryList(categoryIdList)
    productList = await getAutowashProductList(categoryList)

    let query = 'REPLACE INTO product (storeUrl, minute, id, title, price, popularityIndex, isSoldOut, category) VALUES '

    for (let product of productList) {
      let productTitle = product.title.replaceAll(/[^0-9A-Za-zㄱ-ㅎㅏ-ㅣ가-힣!@#$%^&*()-_=+\[{\]}\/\\\s]+/g, '')
      query += `('${storeUrl}', '${getMinute(now)}', ${product.id}, '${productTitle}', ${product.price}, ${product.popularityIndex}, ${product.isSoldOut ? 1 : 0}, '${product.category}'), `
    }

    query = query.substring(0, query.length - 2)
    await conn.query(query)
    await conn.query(`REPLACE INTO history (storeUrl, minute) VALUES ('${storeUrl}', ${getMinute(now)})`)

    await conn.query(`
      INSERT INTO query (uid, storeUrl, day, second, type, amount) VALUES ('${uid}', '${storeUrl}', ${getDay(now)}, ${getSecond(now)}, 2, ${productList.length})
      ON DUPLICATE KEY UPDATE second = ${getSecond(now)}, amount = amount + ${productList.length}
    `)

    res.json({
      result: 'ok',
      time: new Date(getMinute(now) * 60 * 1000),
      product: productList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

function getSecond(date) {
  return parseInt(date.getTime() / 1000)
}

function getMinute(date) {
  return parseInt(date.getTime() / 1000 / 60)
}

function getDay(date) {
  return parseInt(date.getTime() / 1000 / 60 / 60 / 24)
}

async function getKST() {
  // let now = await NTPClient.getNetworkTime(setTimeout(() => {}, 3000), 'ntp.ubuntu.com')
  let now = new Date()
  return new Date(now.getTime() + 1000 * 60 * 60 * 9)
}

function getCJTrackingList(invcNoList) {
  return new Promise((resolve, reject) => {
    let trackingList = []
    let i = 0

    for (let invcNo of invcNoList) {
      let tracking = {
        id: invcNo,
        available: true,
        error: false,
      }

      https.get(`https://www.doortodoor.co.kr/parcel/doortodoor.do?fsp_action=PARC_ACT_002&fsp_cmd=retrieveInvNoACT&invc_no=${invcNo}`, (res) => {
        let data = ''

        res.on('error', (error) => console.log(error))
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          let document = parser.parse(data)
          let contList = document.querySelectorAll('.cont')

          try {
            for (let cont of contList) {
              let contTit = cont.querySelector('.cont_tit')
              let tdList = cont.getElementsByTagName('td')

              if (contTit.innerText.trim() == '조회결과') {
                tracking.receiver = tdList[2].innerText.trim()
                tracking.product = tdList[3].innerText.trim()
              }
              else if (contTit.innerText.trim() == '상품상태 확인') {
                let progress = []

                let trList = cont.getElementsByTagName('tr')
                trList.shift()

                for (let tr of trList) {
                  tdList = tr.getElementsByTagName('td')

                  if (tdList.length < 4) {
                    continue
                  }

                  progress.push({
                    step: tdList[0].innerText.trim(),
                    time: tdList[1].innerText.trim(),
                    place: tdList[3].innerText.trim(),
                  })
                }

                tracking.progress = progress
              }
            }
          }
          catch {
            tracking.available = false
          }
          finally {
            trackingList.push(tracking)

            if (trackingList.length >= invcNoList.length) {
              resolve(trackingList)
            }
          }
        })
      }).on('error', () => {
        tracking.error = true
        trackingList.push(tracking)

        if (trackingList.length >= invcNoList.length) {
          resolve(trackingList)
        }
      })
    }
  })
}

function searchNaver(query) {
  return new Promise((resolve, reject) => {
    https.get(`https://search.naver.com/search.naver?query=${query}+스마트스토어`, (resp) => {
      let data = ''

      resp.on('error', (error) => reject(error))
      resp.on('data', (chunk) => data += chunk)
      resp.on('end', () => {
        let document = parser.parse(data)
        let linkElements = document.querySelectorAll('.txt.elss')

        for (let linkElement of linkElements) {
          let url = linkElement.innerText.split('›')

          let baseUrl = url[0]
          let endpoint = url[1]

          if (baseUrl == 'smartstore.naver.com') {
            resolve(endpoint)
          }
        }
        resolve(null)
      })
    }).on('error', (error) => reject(error))
  })
}

function searchSmartstore(storeUrl) {
  return new Promise((resolve, reject) => {
    https.get(storeUrl, (res) => {
      let data = ''

      res.on('error', (error) => {
        reject(error)
      })
      res.on('data', (chunk) => data += chunk)
      res.on('end', () => {
        let document = parser.parse(data)

        let titleElements = document.getElementsByTagName('title')
        let errorElement = document.querySelector('._141KVzmWyN')

        if (titleElements.length > 0) {
          let storeTitle = titleElements[0].innerText

          if (errorElement) {
            reject(new Error(errorElement.innerHTML))
          }
          resolve(storeTitle)
        }
        resolve(null)
      })
    }).on('error', (error) => reject(error))
  })
}

function getSmartstoreProductAmount(storeUrl) {
  return new Promise((resolve, reject) => {
    https.get(`${storeUrl}/category/ALL`, (res) => {
      let data = ''

      res.on('error', (error) => reject(error))
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        let document = parser.parse(data)

        let productAmountElement = document.querySelector('._3-WhDl_6j2')
        let productAmount = Number(productAmountElement.innerText.replace(/[^0-9]/g, ''))

        resolve(productAmount)
      })
    }).on('error', (error) => reject(error))
  })
}

function getSmartstoreProductList(storeUrl, productAmount) {
  return new Promise((resolve, reject) => {
    let productList = []

    for (let page = 1; page <= Math.ceil(productAmount / 80); page++) {
      https.get(`${storeUrl}/category/ALL/?st=POPULAR&free=false&dt=LIST&page=${page}&size=80`, (res) => {
        let data = ''

        res.on('error', (error) => reject(error))
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          let document = parser.parse(data)
          let li = document.querySelectorAll('._3S7Ho5J2Ql')

          li.forEach((item, index) => {
            let linkElement = item.getElementsByTagName('a')[0]
            let titleElement = item.querySelector('._1Zvjahn0GA')
            let priceElement = item.querySelector('._3_9J443eIx')

            try {
              let product = {
                id: Number(linkElement.getAttribute('href').split('/').pop()),
                popularityIndex: (page - 1) * 80 + index,
                title: titleElement.innerText.trim(),
                price: Number(priceElement.innerText.replace(/[^\d.]/g, '')),
                isSoldOut: false,
              }

              if (item.querySelectorAll('._3Btky8fCyp').length > 0) {
                product.isSoldOut = true
              }

              productList.push(product)
            }
            catch {

            }
            finally {
              productAmount--

              if (productAmount <= 0) {
                resolve(productList)
              }
            }
          })
        })
      }).on('error', (error) => reject(error))
    }
  })
}

function getCarlifemallCategoryIdList() {
  return new Promise((resolve, reject) => {
    https.get('https://hyundai.auton.kr/product/category/category_main?pcid=3478&rootid=3439', (res) => {
      let data = ''

      res.on('error', (error) => reject(error))
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        let document = parser.parse(data)
        let links = document.getElementsByTagName('a')

        let categoryIdList = []

        for (let link of links) {
          let href = link.getAttribute('href')

          if (!href) {
            continue
          }

          if (href.includes('Redirect')) {
            href = href.slice(href.indexOf('Redirect') + 9)
            let pcid = href.slice(0, href.indexOf(','))

            if (!isNaN(pcid)) {
              let categoryId = Number(pcid)

              if (!categoryIdList.includes(categoryId)) {
                categoryIdList.push(categoryId)
              }
            }
          }
        }
        resolve(categoryIdList)
      })
    }).on('error', (error) => reject(error))
  })
}

function getCarlifemallCategoryList(categoryIdList) {
  return new Promise((resolve, reject) => {
    let categoryList = []

    for (let categoryId of categoryIdList) {
      https.get(`https://hyundai.auton.kr/product/category/category_main?pcid=${categoryId}&rootid=3439`, (res) => {
        let data = ''

        res.on('error', (error) => reject(error))
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          let document = parser.parse(data)
          let flex = document.querySelector('.list_top_wrap')
          let activeList = document.querySelectorAll('.active')

          try {
            let flexText = flex.innerText.trim()
            let categoryTitle

            for (let active of activeList) {
              let href = active.getAttribute('href')
              if (href.includes('Redirect')) {
                href = href.split(`'', '`)[1]
                categoryTitle = href.split(`'`)[0]
              }
            }

            let productAmount = Number(flexText.slice(3, flexText.indexOf('개')))

            categoryList.push({
              id: categoryId,
              title: categoryTitle,
              productAmount: productAmount,
            })
          }
          catch {
            categoryList.push({
              id: categoryId,
              title: undefined,
              productAmount: NaN,
            })
          }
          finally {
            if (categoryList.length >= categoryIdList.length) {
              resolve(categoryList)
            }
          }
        })
      }).on('error', (error) => reject(error))
    }
  })
}

function getCarlifemallProductList(pageList) {
  return new Promise((resolve, reject) => {
    let pages = 0

    for (let page of pageList) {
      let productList = []

      https.get(`https://hyundai.auton.kr/product/category/category_main?pcid=${page.categoryId}&rootid=3439&page=${page.num}&recodeCount=100&search.orderBy=sellCount&search.order=desc`, (res) => {
        let data = ''

        res.on('error', (error) => reject(error))
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          let document = parser.parse(data)

          let idElements = document.getElementsByTagName('a')
          let titleElements = document.querySelectorAll('.title')
          let priceElements = document.querySelectorAll('.sell_price')

          let idList = []

          for (let idElement of idElements) {
            let href = idElement.getAttribute('href')

            if (!href) {
              continue
            }

            if (href.includes('ProductDetail')) {
              href = href.slice(href.indexOf('ProductDetail') + 14)
              href = href.slice(0, href.indexOf(','))

              if (!isNaN(href)) {
                idList.push(Number(href))
              }
            }
          }

          for (let productIndex = 0; productIndex < idList.length; productIndex++) {
            let product = {
              id: idList[productIndex],
              title: titleElements[productIndex].innerText.trim(),
              price: Number(priceElements[productIndex].innerText.replace(/[^\d.]/g, '')),
              popularityIndex: (page.num - 1) * 100 + productIndex,
              isSoldOut: false,
              category: page.categoryTitle
            }
            productList.push(product)
          }

          page.productList = productList
          pages++

          if (pages >= pageList.length) {
            resolve(pageList)
          }
        })
      }).on('error', (error) => reject(error))
    }
  })
}

function getN09ProductAmount() {
  return new Promise((resolve, reject) => {
    https.get('https://www.n09.co.kr/product/list.html?cate_no=844', (res) => {
      let data = ''

      res.on('error', (error) => reject(error))
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        let document = parser.parse(data)
        let productAmountElement = document.querySelector('.prdCount')
        let productAmountText = productAmountElement.innerText
        productAmountText = productAmountText.split(' : ')[1]
        productAmountText = productAmountText.split('개')[0]
        let productAmount = Number(productAmountText)
        resolve(productAmount)
      })
    }).on('error', (error) => reject(error))
  })
}

function getN09ProductList(productAmount) {
  return new Promise((resolve, reject) => {
    let pages = Math.ceil(productAmount / 112)
    let productList = []

    for (let page = 1; page <= pages; page++) {
      https.get(`https://www.n09.co.kr/product/list.html?cate_no=844&sort_method=6&page=${page}`, (res) => {
        let data = ''

        res.on('error', (error) => reject(error))
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          let document = parser.parse(data)
          let li = document.querySelectorAll('.item.xans-record-')

          li.forEach((item, index) => {
            let product = {
              isSoldOut: false,
              popularityIndex: (page - 1) * 112 + index,
            }

            let linkElement = item.getElementsByTagName('a')[0]
            let link = linkElement.getAttribute('href')
            link = link.split('=')[1]
            link = link.split('&')[0]
            product.id = Number(link)

            let statusElements = item.getElementsByTagName('img')
            for (let statusElement of statusElements) {
              if (statusElement.getAttribute('alt').includes('품절')) {
                product.isSoldOut = true
              }
            }

            let spanList = item.getElementsByTagName('span')
            for (let span of spanList) {
              let style = span.getAttribute('style')

              if (style) {
                if (style.includes('font-size:13px;color:#242424;font-weight:bold;')) {
                  product.title = span.innerText.trim()
                }
                else if (style.includes('font-size:15px;color:#242424;font-weight:bold;')) {
                  product.price = Number(span.innerText.replace(/[^\d.]/g, ''))
                }
              }
            }

            if (!product.price) {
              product.price = 0
            }

            productList.push(product)

            if (--productAmount <= 0) {
              resolve(productList)
            }
          })
        })
      }).on('error', (error) => reject(error))
    }
  })
}

function getAutowashCategoryIdList() {
  return new Promise((resolve, reject) => {
    https.get('https://autowash.co.kr/goods/goods_list.php?cateCd=032', (res) => {
      let data = ''

      res.on('error', (error) => reject(error))
      res.on('data', (chunk) => {
        data += chunk
      })
      res.on('end', () => {
        let document = parser.parse(data)
        let links = document.getElementsByTagName('a')

        let categoryIdList = []

        for (let link of links) {
          let categoryId = link.getAttribute('data-cate')

          if (!categoryId) {
            let href = link.getAttribute('href')

            if (href.includes('cateCd=')) {
              categoryId = href.split('cateCd=')[1]

              if (categoryId.length != 3) {
                continue
              }
            }
            else {
              continue
            }
          }

          if (categoryIdList.filter((element) => element == categoryId).length <= 0) {
            categoryIdList.push(categoryId)
          }
        }
        resolve(categoryIdList)
      })
    }).on('error', (error) => reject(error))
  })
}

function getAutowashCategoryList(categoryIdList) {
  return new Promise((resolve, reject) => {
    let categoryList = []
    let categories = categoryIdList.length

    for (let categoryId of categoryIdList) {
      https.get(`https://autowash.co.kr/goods/goods_list.php?cateCd=${categoryId}`, (res) => {
        let data = ''

        res.on('error', (error) => reject(error))
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          let document = parser.parse(data)
          let categoryTitleElement = document.querySelector('.this_category')
          let productAmountElement = document.querySelector('.pick_list_num')

          let productAmount = Number(productAmountElement.innerText.replace(/[^\d.]/g, ''))

          if (productAmount == 0) {
            categories--
          }
          else {
            categoryList.push({
              id: categoryId,
              title: categoryTitleElement.innerText.trim(),
              productAmount: productAmount,
            })
          }

          if (categoryList.length >= categories) {
            resolve(categoryList)
          }
        })
      }).on('error', (error) => reject(error))
    }
  })
}

function getAutowashProductList(categoryList) {
  return new Promise((resolve, reject) => {
    let productList = []
    let productAmount = 0

    for (let category of categoryList) {
      productAmount += category.productAmount

      for (let page = 1; page <= Math.ceil(category.productAmount / 100); page++) {
        https.get(`https://autowash.co.kr/goods/goods_list.php?cateCd=${category.id}&page=${page}&start_price=&end_price=&prc_type=0&pageNum=100&sort=sellcnt`, (res) => {
          let data = ''

          res.on('error', (error) => reject(error))
          res.on('data', (chunk) => {
            data += chunk
          })
          res.on('end', () => {
            let document = parser.parse(data)
            let mainGoodsList = document.querySelector('.item_gallery_type.main_goods_list')
            let itemContentList = mainGoodsList.querySelectorAll('.item_cont')

            itemContentList.forEach((itemContent, index) => {
              let id
              let linkElements = itemContent.getElementsByTagName('a')

              for (let linkElement of linkElements) {
                let href = linkElement.getAttribute('href')

                if (href.includes('goodsNo')) {
                  href = href.split('goodsNo=')[1]
                  href = href.split('&')[0]
                  id = Number(href)
                }
              }

              let title = itemContent.querySelector('.item_name').innerText.trim()
              let priceElement = itemContent.querySelector('.item_price')
              let price = Number(priceElement.innerText.replace(/[^\d.]/g, ''))

              let product = {
                id: id,
                title: title,
                price: price,
                popularityIndex: (page - 1) * 100 + index,
                isSoldOut: false,
                category: category.title,
              }

              if (itemContent.querySelectorAll('.item_soldout_bg').length > 0) {
                product.isSoldOut = true
              }

              productList.push(product)
            })

            if (productList.length >= productAmount) {
              resolve(productList)
            }
          })
        }).on('error', (error) => reject(error))
      }
    }
  })
}

http.createServer(app).listen(80)
https.createServer(credentials, app).listen(443)
