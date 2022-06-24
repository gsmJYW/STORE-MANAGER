import { exit } from 'process'
import cron from 'node-cron'
import fs from 'fs'
import bodyParser from 'body-parser'
import http from 'http'
import https from 'https'
import { parse } from 'node-html-parser'
import express from 'express'
import mysql from 'mysql2/promise'
import fetch from 'node-fetch'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { Builder, By, until } from 'selenium-webdriver'
import chrome, { Options, ServiceBuilder } from 'selenium-webdriver/chrome.js'
import { ensureChromedriver } from 'node-chromedriver-downloader'
import UserAgent from 'user-agents'
import admin from 'firebase-admin'
import { getAuth } from 'firebase-admin/auth'
import serviceAccount from './store-manager-5d527-firebase-adminsdk-2ovpp-f0b6ef3a8a.json' assert { type: 'json' }

class Product {
  constructor(id = 0, title = '', price = 0, popularityIndex = 0, isSoldOut = false, category = null) {
    this.id = id
    this.title = title
    this.price = price
    this.popularityIndex = popularityIndex
    this.isSoldOut = isSoldOut
    this.category = category
  }
}

const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const credentials = {
  key: fs.readFileSync(__dirname + '/ssl/store-manager.kro.kr_20220303F94AA.key.pem'),
  cert: fs.readFileSync(__dirname + '/ssl/store-manager.kro.kr_20220303F94AA.crt.pem'),
}

const args = process.argv.slice(2);

if (args.length < 9) {
  console.error('Parameters not provided: [host] [user] [password] [database] [connection_limit] [n09_b2b_id] [n09_b2b_pwd] [washmart_id] [washmart_pwd]')
  exit(1)
}

const pool = mysql.createPool({
  host: args[0],
  user: args[1],
  password: args[2],
  database: args[3],
  connectionLimit: args[4],
})

const chromedriverBinaryPath = await ensureChromedriver()

const service = new ServiceBuilder(chromedriverBinaryPath).build()
chrome.setDefaultService(service)

const n09B2BId = args[5]
const n09B2BPwd = args[6]

const washmartId = args[7]
const washmartPwd = args[8]

const timeout = 10000

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://store-manager-5d527-default-rtdb.asia-southeast1.firebasedatabase.app',
})

const auth = getAuth()
const conn = await pool.getConnection()

await conn.query(`
  CREATE TABLE IF NOT EXISTS user (
    uid char(28) NOT NULL,
    email varchar(255) NOT NULL,
    name varchar(64) NOT NULL,
    permission tinyint NOT NULL DEFAULT '0',
    loadAll tinyint NOT NULL DEFAULT '0',
    highlightChanges tinyint NOT NULL DEFAULT '1',
    sortMethod tinyint NOT NULL DEFAULT '0',
    firstLoginSecond int NOT NULL,
    lastLoginSecond int NOT NULL,
    PRIMARY KEY (uid)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`)

await conn.query(`
  CREATE TABLE IF NOT EXISTS store (
    url varchar(256) NOT NULL,
    title varchar(256) NOT NULL,
    PRIMARY KEY (url)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`)

await conn.query(`
  CREATE TABLE IF NOT EXISTS bookmark (
    uid char(28) NOT NULL,
    storeUrl varchar(256) NOT NULL,
    PRIMARY KEY (uid,storeUrl),
    KEY storeUrl_idx (storeUrl),
    CONSTRAINT bookmarkStoreUrl FOREIGN KEY (storeUrl) REFERENCES store (url) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='	'
`)

await conn.query(`
  CREATE TABLE IF NOT EXISTS query (
    uid varchar(45) NOT NULL,
    storeUrl varchar(256) NOT NULL,
    day mediumint NOT NULL,
    type tinyint NOT NULL,
    second int NOT NULL,
    amount int NOT NULL,
    PRIMARY KEY (uid,storeUrl,day,type),
    KEY queryStoreUrl_idx (storeUrl),
    CONSTRAINT queryStoreUrl FOREIGN KEY (storeUrl) REFERENCES store (url) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`)

await conn.query(`
  CREATE TABLE IF NOT EXISTS history (
    storeUrl varchar(256) NOT NULL,
    minute int NOT NULL,
    PRIMARY KEY (storeUrl,minute),
    CONSTRAINT historyStoreUrl FOREIGN KEY (storeUrl) REFERENCES store (url) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`)

await conn.query(`
  CREATE TABLE IF NOT EXISTS product (
    storeUrl varchar(256) NOT NULL,
    minute int NOT NULL,
    id bigint NOT NULL,
    title varchar(256) NOT NULL,
    price int NOT NULL,
    popularityIndex int NOT NULL,
    isSoldOut tinyint NOT NULL,
    category varchar(32) DEFAULT NULL,
    PRIMARY KEY (storeUrl,minute,id),
    CONSTRAINT productStoreUrl FOREIGN KEY (storeUrl) REFERENCES store (url) ON DELETE CASCADE ON UPDATE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`)

await conn.query(`
  CREATE TABLE IF NOT EXISTS carWash (
    name varchar(64) NOT NULL,
    category varchar(64) DEFAULT NULL,
    type varchar(64) DEFAULT NULL,
    lat double NOT NULL,
    lon double NOT NULL,
    siDo varchar(32) NOT NULL,
    siGunGu varchar(32) NOT NULL,
    eupMyeonDong varchar(32) NOT NULL,
    ri varchar(32) DEFAULT NULL,
    roadName varchar(64) NOT NULL,
    buildingNo varchar(16) NOT NULL,
    buildingName varchar(64) DEFAULT NULL,
    phone char(14) DEFAULT NULL,
    openAt time DEFAULT NULL,
    closeAt time DEFAULT NULL,
    weekendOpenAt time DEFAULT NULL,
    weekendCloseAt time DEFAULT NULL,
    dayoff varchar(32) DEFAULT NULL,
    businessHours text,
    PRIMARY KEY (roadName,buildingNo)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`)

await conn.query(`
  INSERT IGNORE INTO store VALUES
    ('https://n09.co.kr', '엔공구'),
    ('https://n09b2b.co.kr', '엔공구 B2B'),
    ('https://autowash.co.kr', '오토워시'),
    ('https://hyundai.auton.kr', '카라이프몰'),
    ('https://theclasskorea.co.kr', '더클래스'),
    ('https://autowax.co.kr', '오토왁스'),
    ('https://washmart.co.kr', '워시마트')
`)

conn.release()

app.use(bodyParser.json())
app.use(bodyParser.urlencoded({
  extended: true
}))

app.use('/', express.static('libs'))

app.use((req, res, next) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol
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

app.get('/smartstore/:endpoint', async (req, res) => {
  const storeUrl = `https://smartstore.naver.com/${req.params.endpoint}`

  if (!new RegExp('^[a-z0-9_-]+$').test(req.params.endpoint)) {
    res.sendFile(__dirname + '/views/storeNotFound.html')
    return
  }

  let storeTitle, conn

  try {
    conn = await pool.getConnection()
    const store = (await conn.query(`SELECT * FROM store WHERE url = '${storeUrl}'`))[0][0]

    if (store) {
      storeTitle = store.title
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

      const htmlString = data.toString()
        .replaceAll('$storeUrl', storeUrl)
        .replaceAll('$storeTitle', storeTitle)

      res.send(htmlString)
    })
  }
  catch (error) {
    res.sendFile(__dirname + '/views/storeNotFound.html')
  }
  finally {
    if (conn) {
      conn.release()
    }
  }
})

app.get('/n09', async (req, res) => {
  res.sendFile(__dirname + '/views/n09.html')
})

app.get('/n09/b2b', async (req, res) => {
  res.sendFile(__dirname + '/views/n09B2B.html')
})

app.get('/hyundai/auton', async (req, res) => {
  res.sendFile(__dirname + '/views/carlifemall.html')
})

app.get('/autowash', async (req, res) => {
  res.sendFile(__dirname + '/views/autowash.html')
})

app.get('/theclass', async (req, res) => {
  res.sendFile(__dirname + '/views/theclass.html')
})

app.get('/autowax', async (req, res) => {
  res.sendFile(__dirname + '/views/autowax.html')
})

app.get('/washmart', async (req, res) => {
  res.sendFile(__dirname + '/views/washmart.html')
})

app.get('/carWash', async (req, res) => {
  res.sendFile(__dirname + '/views/carWash.html')
})

app.get('/cjTracking', async (req, res) => {
  res.sendFile(__dirname + '/views/cjTracking.html')
})

app.get('/admin', async (req, res) => {
  res.sendFile(__dirname + '/views/admin.html')
})

app.post('/signin', async (req, res) => {
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)
    const firebaseUser = await auth.getUser(decodedToken.uid)

    const now = await getKST()

    conn = await pool.getConnection()
    await conn.query(`
      INSERT INTO user (uid, email, name, firstLoginSecond, lastLoginSecond) VALUES ('${decodedToken.uid}', '${firebaseUser.email}', '${firebaseUser.displayName}', ${getSecond(now)}, ${getSecond(now)})
      ON DUPLICATE KEY UPDATE user.email = '${firebaseUser.email}', name = '${firebaseUser.displayName}', lastLoginSecond = ${getSecond(now)}
    `)

    const user = (await conn.query(`SELECT * FROM user WHERE uid = '${decodedToken.uid}'`))[0][0]

    res.json({
      result: 'ok',
      user: user,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (conn) {
      conn.release()
    }
  }
})

app.post('/user', async (req, res) => {
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)
    const uid = decodedToken.uid

    conn = await pool.getConnection()
    const user = (await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`))[0][0]

    res.json({
      result: 'ok',
      user: user,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (conn) {
      conn.release()
    }
  }
})

app.post('/user/update', async (req, res) => {
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)

    conn = await pool.getConnection()
    await conn.query(`UPDATE user SET loadAll = ${req.body.loadAll}, highlightChanges = ${req.body.highlightChanges}, sortMethod = ${req.body.sortMethod} WHERE uid = '${decodedToken.uid}'`)

    res.json({ result: 'ok' })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (conn) {
      conn.release()
    }
  }
})

app.post('/user/byEmail', async (req, res) => {
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)

    conn = await pool.getConnection()
    let user = (await conn.query(`SELECT * FROM user WHERE uid = '${decodedToken.uid}'`))[0][0]

    if (user.permission == 0) {
      res.json({ result: 'no permission' })
      return
    }

    user = (await conn.query(`SELECT * FROM user WHERE email = '${req.body.email}'`))[0][0]

    if (!user) {
      res.json({ result: 'user not found' })
      return
    }

    res.json({
      result: 'ok',
      user: user,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (conn) {
      conn.release()
    }
  }
})

app.post('/user/permission', async (req, res) => {
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)

    if (decodedToken.email == req.body.email) {
      res.json({ result: 'self assignment not allowed' })
      return
    }

    conn = await pool.getConnection()
    let user = (await conn.query(`SELECT * FROM user WHERE uid = '${decodedToken.uid}'`))[0][0]

    if (user.permission == 0) {
      res.json({ result: 'no permission' })
      return
    }

    user = (await conn.query(`SELECT * FROM user WHERE email = '${req.body.email}'`))[0][0]

    if (!user) {
      res.json({ result: 'user not found' })
      return
    }
    else if (user.permission == req.body.permission) {
      res.json({ result: 'not changed' })
      return
    }

    await conn.query(`UPDATE user SET permission = ${req.body.permission} WHERE email = '${req.body.email}'`)
    res.json({ result: 'ok' })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (conn) {
      conn.release()
    }
  }
})

app.post('/user/admin', async (req, res) => {
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)

    conn = await pool.getConnection()
    const user = (await conn.query(`SELECT * FROM user WHERE uid = '${decodedToken.uid}'`))[0][0]

    if (user.permission == 0) {
      res.json({ result: 'no permission' })
      return
    }

    const adminList = (await conn.query('SELECT * FROM user WHERE permission = 1'))[0]

    res.json({
      result: 'ok',
      admin: adminList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (conn) {
      conn.release()
    }
  }
})

app.post('/bookmark', async (req, res) => {
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)

    let query = `SELECT bookmark.storeUrl, store.title FROM bookmark INNER JOIN store WHERE uid = '${decodedToken.uid}' AND bookmark.storeUrl = store.url`

    if (req.body.storeUrl) {
      query += ` AND storeUrl = '${req.body.storeUrl}'`
    }

    conn = await pool.getConnection()
    const bookmarkList = (await conn.query(query))[0]

    res.json({
      result: 'ok',
      bookmark: bookmarkList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (conn) {
      conn.release()
    }
  }
})

app.post('/bookmark/update', async (req, res) => {
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)

    conn = await pool.getConnection()
    await conn.query(`REPLACE INTO bookmark (uid, storeUrl) VALUES ('${decodedToken.uid}', '${req.body.storeUrl}')`)

    res.json({ result: 'ok' })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (conn) {
      conn.release()
    }
  }
})

app.post('/bookmark/delete', async (req, res) => {
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)

    conn = await pool.getConnection()
    await conn.query(`DELETE FROM bookmark WHERE uid = '${decodedToken.uid}' AND storeUrl = '${req.body.storeUrl}'`)

    res.json({ result: 'ok' })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (conn) {
      conn.release()
    }
  }
})

app.post('/quota', async (req, res) => {
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)

    const now = await getKST()
    conn = await pool.getConnection()

    const user = (await conn.query(`SELECT * FROM user WHERE uid = '${decodedToken.uid}'`))[0][0]
    const isAdmin = user.permission > 0

    const queryList = (await conn.query(`SELECT * FROM query WHERE uid = '${decodedToken.uid}' AND day = ${getDay(now)}`))[0]

    res.json({
      result: 'ok',
      isAdmin: isAdmin,
      quota: queryList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
  finally {
    if (conn) {
      conn.release()
    }
  }
})

app.post('/excel', async (req, res) => {
  const quotaLimit = 10
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)

    const now = await getKST()

    conn = await pool.getConnection()
    const user = (await conn.query(`SELECT * FROM user WHERE uid = '${decodedToken.uid}'`))[0][0]

    if (user.permission == 0) {
      const sum = (await conn.query(`SELECT SUM(amount) AS amount FROM query WHERE uid='${decodedToken.uid}' AND day = ${getDay(now)} AND type = 3`))[0][0]

      if (sum) {
        if (sum.amount >= quotaLimit) {
          res.json({
            result: 'quota exceeded',
            quotaUsed: sum.amount,
            quotaLimit: quotaLimit,
          })
          return
        }
      }
    }

    await conn.query(`
      INSERT INTO query (uid, storeUrl, day, second, type, amount) VALUES ('${decodedToken.uid}', '${req.body.storeUrl}', ${getDay(now)}, ${getSecond(now)}, 3, 1)
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
    if (conn) {
      conn.release()
    }
  }
})

app.post('/siDo', async (req, res) => {
  let conn

  try {
    conn = await pool.getConnection()
    const result = (await conn.query('SELECT siDo FROM carWash GROUP BY siDo'))[0]

    const siDoList = []

    for (let row of result) {
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
    if (conn) {
      conn.release()
    }
  }
})

app.post('/siGunGu', async (req, res) => {
  let conn

  try {
    conn = await pool.getConnection()
    const result = (await conn.query(`SELECT siGunGu FROM carWash WHERE siDo = '${req.body.siDo}' GROUP BY siGunGu`))[0]

    const siGunGuList = []

    for (let row of result) {
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
    if (conn) {
      conn.release()
    }
  }
})

app.post('/eupMyeonDong', async (req, res) => {
  let conn

  try {
    conn = await pool.getConnection()

    let query = 'SELECT eupMyeonDong FROM carWash'
    const whereClause = []

    if (req.body.siDo) {
      whereClause.push(`siDo = '${req.body.siDo}'`)
    }

    if (req.body.siGunGu) {
      whereClause.push(`siGunGu = '${req.body.siGunGu}'`)
    }

    if (whereClause.length > 0) {
      query += ` WHERE ${whereClause.join(' AND ')}`
    }

    query += ' GROUP BY eupMyeonDong'
    const result = (await conn.query(query))[0]

    const eupMyeonDongList = []

    for (const row of result) {
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
    if (conn) {
      conn.release()
    }
  }
})

app.post('/carWash', async (req, res) => {
  let conn

  try {
    conn = await pool.getConnection()

    let query = 'SELECT * FROM carWash'
    const whereClause = []

    if (req.body.siDo) {
      whereClause.push(`siDo = '${req.body.siDo}'`)
    }

    if (req.body.siGunGu) {
      whereClause.push(`siGunGu = '${req.body.siGunGu}'`)
    }

    if (req.body.eupMyeonDong) {
      whereClause.push(`eupMyeonDong = '${req.body.eupMyeonDong}'`)
    }

    if (whereClause.length > 0) {
      query += ` WHERE ${whereClause.join(' AND ')}`
    }

    const carWashList = (await conn.query(query))[0]

    query = query.replace('*', 'AVG(lat) as lat, AVG(lon) as lon')
    const center = (await conn.query(query))[0][0]

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
    if (conn) {
      conn.release()
    }
  }
})

app.post('/cjTracking', async (req, res) => {
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)

    conn = await pool.getConnection()
    const user = (await conn.query(`SELECT * FROM user WHERE uid = '${decodedToken.uid}'`))[0][0]

    if (user.permission == 0) {
      res.json({ result: 'no permission' })
      return
    }

    const trackingList = await getCJTrackingList(req.body.invcNo)

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

app.post('/smartstore/search', async (req, res) => {
  let storeUrl, endpoint

  if (req.body.query.includes('smartstore.naver.com')) {
    storeUrl = req.body.query

    if (storeUrl.startsWith('http://')) {
      storeUrl = storeUrl.replace('http://', 'https://')
    }

    if (!storeUrl.startsWith('https://')) {
      storeUrl = 'https://' + storeUrl
    }
  }
  else {
    try {
      endpoint = await searchNaver(req.body.query)

      if (!endpoint) {
        res.json({
          result: 'zero results',
          query: req.body.query,
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
    const storeTitle = await searchSmartstore(storeUrl)

    if (!storeTitle) {
      res.json({
        result: 'not smartstore url',
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
    if (conn) {
      conn.release()
    }
  }
})

app.post('/history', async (req, res) => {
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)

    const now = await getKST()
    conn = await pool.getConnection()

    if (req.body.storeUrl == 'https://n09.co.kr' || req.body.storeUrl == 'https://hyundai.auton.kr/') {
      const user = (await conn.query(`SELECT * FROM user WHERE uid = '${decodedToken.uid}'`))[0][0]

      if (user.permission == 0) {
        res.json({ result: 'no permission' })
      }
    }

    await conn.query(`
      INSERT INTO query (uid, storeUrl, day, second, type, amount) VALUES ('${decodedToken.uid}', '${req.body.storeUrl}', ${getDay(now)}, ${getSecond(now)}, 0, 1)
      ON DUPLICATE KEY UPDATE second = ${getSecond(now)}, amount = amount + 1
    `)

    const result = (await conn.query(`SELECT minute FROM history WHERE storeUrl = '${req.body.storeUrl}'`))[0]
    const historyList = []

    for (const history of result) {
      historyList.push(history.minute)
    }

    res.json({
      result: 'ok',
      history: historyList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
    return
  }
  finally {
    if (conn) {
      conn.release()
    }
  }
})

app.post('/product', async (req, res) => {
  const quotaLimit = 100000
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)

    const now = await getKST()

    conn = await pool.getConnection()
    const user = (await conn.query(`SELECT * FROM user WHERE uid = '${decodedToken.uid}'`))[0][0]

    if (user.permission == 0) {
      if (req.body.storeUrl == 'https://n09.co.kr' || req.body.storeUrl == 'https://hyundai.auton.kr/') {
        res.json({ result: 'no permission' })
      }

      const sum = (await conn.query(`SELECT SUM(amount) AS amount FROM query WHERE uid = '${decodedToken.uid}' AND day = ${getDay(now)} AND type = 1`))[0][0]

      if (sum) {
        if (sum.amount >= quotaLimit) {
          res.json({
            result: 'quota exceeded',
            quotaUsed: sum.amount,
            quotaLimit: quotaLimit,
          })
          return
        }
      }
    }

    const productList = (await conn.query(`SELECT * FROM product WHERE storeUrl = '${req.body.storeUrl}' AND minute = ${req.body.minute}`))[0]

    await conn.query(`
      INSERT INTO query (uid, storeUrl, day, second, type, amount) VALUES ('${decodedToken.uid}', '${req.body.storeUrl}', ${getDay(now)}, ${getSecond(now)}, 1, ${productList.length})
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
    if (conn) {
      conn.release()
    }
  }
})

app.post('/product/update', async (req, res) => {
  const quotaLimit = 25000
  let conn

  try {
    const decodedToken = await auth.verifyIdToken(req.body.idToken)

    const now = await getKST()

    conn = await pool.getConnection()
    const user = (await conn.query(`SELECT * FROM user WHERE uid = '${decodedToken.uid}'`))[0][0]

    if (user.permission == 0) {
      const sum = (await conn.query(`SELECT SUM(amount) AS amount FROM query WHERE uid='${decodedToken.uid}' AND day = ${getDay(now)} AND type = 2`))[0][0]

      if (sum) {
        if (sum.amount >= quotaLimit) {
          res.json({
            result: 'quota exceeded',
            quotaUsed: sum.amount,
            quotaLimit: quotaLimit,
          })
          return
        }
      }
    }

    const store = (await conn.query(`SELECT * FROM store WHERE url = '${req.body.storeUrl}'`))[0][0]

    if (!store) {
      res.json({ result: 'no such store' })
      return
    }

    if (user.permission == 0 && !req.body.storeUrl.includes('smartstore.naver.com')) {
      res.json({ result: 'no permission' })
      return
    }

    const history = (await conn.query(`SELECT * FROM history WHERE storeUrl = '${req.body.storeUrl}' AND minute = ${getMinute(now)}`))[0][0]
    let productList

    if (history) {
      productList = (await conn.query(`SELECT * FROM product WHERE storeUrl = '${req.body.storeUrl}' AND minute = ${getMinute(now)}`))[0]
    }
    else {
      productList = await getProductList(req.body.storeUrl)
    }

    await updateProductList(req.body.storeUrl, productList, now)

    await conn.query(`
      INSERT INTO query (uid, storeUrl, day, second, type, amount) VALUES ('${decodedToken.uid}', '${req.body.storeUrl}', ${getDay(now)}, ${getSecond(now)}, 2, ${productList.length})
      ON DUPLICATE KEY UPDATE second = ${getSecond(now)}, amount = amount + ${productList.length}
    `)

    res.json({
      result: 'ok',
      minute: getMinute(now),
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
    if (conn) {
      conn.release()
    }
  }
})

function parseNumber(text) {
  return Number(text.replace(/[^0-9]/g, ''))
}

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
  let now = new Date()
  return new Date(now.getTime() + 1000 * 60 * 60 * 9)
}

function fetchWithRandomUserAgent(url, device = 'desktop', encoding = 'utf-8') {
  return new Promise(async (resolve, reject) => {
    fetch(url, {
      headers: { 'User-Agent': new UserAgent([/Chrome/, { 'deviceCategory': device }]) }
    }).then(async (res) => {
      if (encoding.toLowerCase() == 'euc-kr') {
        const buffer = Buffer.from(await res.arrayBuffer())
        resolve(iconv.decode(buffer, 'euc-kr'))
      }
      else {
        resolve(await res.text())
      }
    }).catch((error) => reject(error))
  })
}

function buildDriver(device = 'desktop') {
  return new Promise(async (resolve, reject) => {
    try {
      const options = new Options()
      options.addArguments(`user-agent=${new UserAgent([/Chrome/, { 'deviceCategory': device }])}`)
      options.addArguments('no-sandbox', 'headless')

      const driver = await new Builder()
        .withCapabilities({ 'pageLoadStrategy': 'none' })
        .forBrowser('chrome')
        .setChromeOptions(options)
        .build()

      resolve(driver)
    }
    catch (error) {
      reject(error)
    }
  })
}

function getCJTrackingList(invcNoList) {
  return new Promise(async (resolve, reject) => {
    const trackingList = []

    for (const invcNo of invcNoList) {
      const tracking = {
        id: invcNo,
        available: false,
        error: false,
      }

      fetchWithRandomUserAgent(`https://www.doortodoor.co.kr/parcel/doortodoor.do?fsp_action=PARC_ACT_002&fsp_cmd=retrieveInvNoACT&invc_no=${invcNo}`, 'mobile').then(async (res) => {
        const document = parse(res)
        const tdList = document.querySelectorAll('.last_b')

        if (!tdList[0].innerText.includes('데이터가 없습니다')) {
          tracking.available = true
          tracking.sender = tdList[1].innerText
          tracking.receiver = tdList[2].innerText
          tracking.product = tdList[3].innerText
        }

        if (!tdList[tdList.length - 1].innerText.includes('데이터가 없습니다')) {
          tracking.state = tdList[5].innerText.trim()
          tracking.lastUpdateAt = tdList[6].innerText
        }

        trackingList.push(tracking)
      }).catch((error) => {
        tracking.error = true
        trackingList.push(tracking)
      }).finally(() => {
        if (trackingList.length >= invcNoList.length) {
          resolve(trackingList)
        }
      })
    }
  })
}

function searchNaver(query) {
  return new Promise(async (resolve, reject) => {
    fetchWithRandomUserAgent(`https://m.search.naver.com/search.naver?query=${query}+스마트스토어`, 'mobile').then(async (res) => {
      const document = parse(res)
      const linkElementList = document.querySelectorAll('.url')

      for (const linkElement of linkElementList) {
        const url = linkElement.innerText.split('›')

        const baseUrl = url[0]
        const endpoint = url[1]

        if (baseUrl == 'smartstore.naver.com') {
          resolve(endpoint)
          return
        }
      }

      resolve(null)
    }).catch((error) => reject(error))
  })
}

function searchSmartstore(storeUrl) {
  return new Promise(async (resolve, reject) => {
    fetchWithRandomUserAgent(storeUrl, 'mobile').then(async (res) => {
      const document = parse(res)

      const titleElement = document.querySelector('title')
      const errorElement = document.querySelector('._141KVzmWyN')

      if (titleElement) {
        const storeTitle = titleElement.innerText

        if (errorElement) {
          reject(new Error(errorElement.innerHTML))
          return
        }

        resolve(storeTitle)
      }

      resolve(null)
    }).catch((error) => reject(error))
  })
}

function getSmartstoreProductList(storeUrl) {
  return new Promise(async (resolve, reject) => {
    fetchWithRandomUserAgent(`${storeUrl}/category/ALL`).then(async (res) => {
      const document = parse(res)

      const productAmountElement = document.querySelector('._3-WhDl_6j2')
      const productAmount = parseNumber(productAmountElement.innerText)

      const productList = []

      for (let page = 1; page <= Math.ceil(productAmount / 80); page++) {
        fetchWithRandomUserAgent(`${storeUrl}/category/ALL/?st=POPULAR&free=false&dt=LIST&page=${page}&size=80`).then(async (res) => {
          const document = parse(res)
          const li = document.querySelectorAll('._3S7Ho5J2Ql')

          li.forEach((item, index) => {
            const product = new Product()

            const href = item.querySelector('a').getAttribute('href')
            product.id = Number(href.split('/').pop())

            product.title = item.querySelector('._1Zvjahn0GA').innerText
            product.price = parseNumber(item.querySelector('._3_9J443eIx').innerText)
            product.popularityIndex = (page - 1) * 80 + index
            product.isSoldOut = item.querySelectorAll('._3Btky8fCyp').length > 0

            productList.push(product)

            if (productList.length >= productAmount) {
              resolve(productList)
            }
          })
        }).catch((error) => reject(error))
      }
    })
  }).catch((error) => reject(error))
}

function getN09ProductList() {
  return new Promise(async (resolve, reject) => {
    fetchWithRandomUserAgent('https://www.n09.co.kr/product/list.html?cate_no=844').then(async (res) => {
      const document = parse(res)

      const productAmountElement = document.querySelector('.prdCount')
      const productAmount = parseNumber(productAmountElement.innerText)

      const productList = []

      for (let page = 1; page <= Math.ceil(productAmount / 112); page++) {
        fetchWithRandomUserAgent(`https://www.n09.co.kr/product/list.html?cate_no=844&sort_method=6&page=${page}`).then(async (res) => {
          const document = parse(res)
          const li = document.querySelectorAll('.item.xans-record-')

          li.forEach((item, index) => {
            const product = new Product()

            const href = item.querySelector('p > strong > a').getAttribute('href')
            product.id = Number(href.split('=')[1].split('&')[0])

            product.title = item.querySelector('p > strong > a > span:nth-child(2)').innerText
            product.price = parseNumber(item.querySelector('li > span[style*="font-size:15px"]').innerText)

            if (!product.price) {
              product.price = 0
            }

            product.popularityIndex = (page - 1) * 112 + index

            const icon = item.querySelector('.icon_img')
            if (icon) {
              product.isSoldOut = icon.getAttribute('alt') == '품절'
            }

            productList.push(product)

            if (productList.length >= productAmount) {
              resolve(productList)
            }
          })
        }).catch((error) => reject(error))
      }
    })
  }).catch((error) => reject(error))
}

function getN09B2BProductList() {
  return new Promise(async (resolve, reject) => {
    let tempDriver

    buildDriver('mobile').then(async (driver) => {
      tempDriver = driver
      await driver.get('https://m.n09b2b.co.kr')

      const idInput = await driver.wait(until.elementLocated(By.css('#member_id')), timeout)
      idInput.sendKeys(n09B2BId)

      const pwdInput = await driver.wait(until.elementLocated(By.css('#member_passwd')), timeout)
      pwdInput.sendKeys(n09B2BPwd)

      const loginButton = await driver.wait(until.elementLocated(By.css('.btnSubmit')), timeout)
      await loginButton.click()

      await driver.wait(until.elementLocated(By.css('.category')), timeout)
      await driver.get('https://m.n09b2b.co.kr/product/search.html?product_price1=0&product_price2=10000000&order_by=favor')

      const productAmountElement = await driver.wait(until.elementLocated(By.css('#titleArea > * > .count')), timeout)
      const productAmount = parseNumber(await productAmountElement.getAttribute('innerText'))

      const productList = []

      for (let page = 1; page <= Math.ceil(productAmount / 120); page++) {
        await driver.get(`https://m.n09b2b.co.kr/product/search.html?product_price1=0&product_price2=10000000&order_by=favor&page=${page}`)
        await driver.wait(until.elementLocated(By.css(`.this[href*="page=${page}"]`)), timeout)

        const body = await driver.wait(until.elementLocated(By.css('body')), timeout)
        const document = parse(await body.getAttribute('innerHTML'))

        document.querySelectorAll('.prdList.grid3 > .xans-record-').forEach((item, index) => {
          const product = new Product()

          const linkElement = item.querySelector('.name > a')
          const idSplit = linkElement.getAttribute('href').split('/category')[0].split('/')
          product.id = Number(idSplit[idSplit.length - 1])

          product.title = linkElement.innerText

          const priceSpan = item.querySelector('.price')
          product.price = parseNumber(priceSpan.innerText)

          product.popularityIndex = (page - 1) * 120 + index

          const icon = item.querySelector('.icon')
          if (icon) {
            product.isSoldOut = icon.getAttribute('alt') == '품절'
          }

          productList.push(product)
        })
      }

      resolve(productList)
    }).catch((error) => reject(error)).finally(() => {
      if (tempDriver) {
        tempDriver.quit()
      }
    })
  })
}

function getAutowashProductList() {
  return new Promise(async (resolve, reject) => {
    fetchWithRandomUserAgent('https://autowash.co.kr/goods/goods_list.php?cateCd=032').then(async (res) => {
      const document = parse(res)
      const linkElementList = document.querySelectorAll('.swiper-slide > a')

      const categoryIdList = []

      for (const linkElement of linkElementList) {
        let categoryId = linkElement.getAttribute('data-cate')

        if (!categoryId) {
          categoryId = linkElement.getAttribute('href').split('cateCd=')[1]
        }

        categoryIdList.push(categoryId)
      }

      let categoryList

      try {
        categoryList = await new Promise(async (resolve, reject) => {
          const categoryList = []
          let categoryAmount = categoryIdList.length

          for (const categoryId of categoryIdList) {
            fetchWithRandomUserAgent(`https://autowash.co.kr/goods/goods_list.php?cateCd=${categoryId}`).then(async (res) => {
              const document = parse(res)
              const productAmount = parseNumber(document.querySelector('.pick_list_num').innerText)

              if (productAmount == 0) {
                categoryAmount--
              }
              else {
                categoryList.push({
                  id: categoryId,
                  title: document.querySelector('.this_category').innerText.trim(),
                  productAmount: productAmount,
                })
              }

              if (categoryList.length >= categoryAmount) {
                resolve(categoryList)
              }
            }).catch((error) => reject(error))
          }
        })
      }
      catch (error) {
        reject(error)
        return
      }

      const productList = []
      let productAmount = 0

      for (const category of categoryList) {
        productAmount += category.productAmount

        fetchWithRandomUserAgent(`https://autowash.co.kr/goods/goods_list.php?cateCd=${category.id}&pageNum=${category.productAmount}&sort=sellcnt`).then(async (res) => {
          const document = parse(res)

          document.querySelectorAll('.main_goods_list > ul > li').forEach((item, index) => {
            const product = new Product()

            product.id = parseNumber(item.querySelector('.item_tit_box > a').getAttribute('href'))
            product.title = item.querySelector('.item_name').innerText
            product.price = parseNumber(item.querySelector('.item_price').innerText)
            product.popularityIndex = index
            product.category = category.title
            product.isSoldOut = item.querySelectorAll('.item_soldout_bg').length > 0

            productList.push(product)
          })

          if (productList.length >= productAmount) {
            resolve(productList)
          }
        }).catch((error) => reject(error))
      }
    })
  }).catch((error) => reject(error))
}

function getCarlifemallProductList() {
  return new Promise(async (resolve, reject) => {
    fetchWithRandomUserAgent('https://hyundai.auton.kr/product/category/category_main?pcid=4441&rootid=4388', 'mobile').then(async (res) => {
      const document = parse(res)
      const linkList = document.querySelectorAll('.tab_title_sub > li > a')

      const categoryIdList = []

      for (const link of linkList) {
        let href = link.getAttribute('href')

        if (!href) {
          continue
        }

        if (href.includes('Redirect')) {
          href = href.slice(href.indexOf('Redirect') + 9)
          const pcid = href.slice(0, href.indexOf(','))

          if (!isNaN(pcid)) {
            const categoryId = Number(pcid)

            if (!categoryIdList.includes(categoryId)) {
              categoryIdList.push(categoryId)
            }
          }
        }
      }

      let categoryList

      try {
        categoryList = await new Promise(async (resolve, reject) => {
          const categoryList = []

          for (const categoryId of categoryIdList) {
            fetchWithRandomUserAgent(`https://hyundai.auton.kr/product/category/category_main?pcid=${categoryId}&rootid=4388`, 'mobile').then(async (res) => {
              const document = parse(res)

              const flex = document.querySelector('.list_top_wrap > .flexleft')
              const active = document.querySelector('.tab_title_sub > li > .active')

              const categoryTitle = active.getAttribute('href').split(`'', '`)[1].split(`'`)[0]
              const productAmount = parseNumber(flex.innerText.trim())

              categoryList.push({
                id: categoryId,
                title: categoryTitle,
                productAmount: productAmount,
              })

              if (categoryList.length >= categoryIdList.length) {
                resolve(categoryList)
              }
            }).catch((error) => reject(error))
          }
        })
      }
      catch (error) {
        reject(error)
        return
      }

      const productList = []
      let productAmount = 0

      for (const category of categoryList) {
        productAmount += category.productAmount

        for (let page = 1; page <= Math.ceil(category.productAmount / 100); page++) {
          fetchWithRandomUserAgent(`https://hyundai.auton.kr/product/category/category_main?pcid=${category.id}&rootid=4388&page=${page}&recodeCount=100&search.orderBy=sellCount&search.order=desc`, 'mobile').then(async (res) => {
            const document = parse(res)

            document.querySelectorAll('.list_content_wrap > ul > li').forEach((item, index) => {
              const product = new Product()

              let href = item.querySelector('a').getAttribute('href')
              href = href.slice(href.indexOf('ProductDetail') + 14)
              product.id = Number(href.slice(0, href.indexOf(',')))

              product.title = item.querySelector('.title').innerText.trim()
              product.price = parseNumber(item.querySelector('.sell_price').innerText)
              product.popularityIndex = (page - 1) * 100 + index
              product.category = category.title

              productList.push(product)

              if (productList.length >= productAmount) {
                resolve(productList)
              }
            })
          }).catch((error) => reject(error))
        }
      }
    }).catch((error) => reject(error))
  })
}

function getTheClassProductList() {
  return new Promise(async (resolve, reject) => {
    fetchWithRandomUserAgent('https://theclasskorea.co.kr/product/list.html?cate_no=43').then(async (res) => {
      const document = parse(res)
      const productAmount = parseNumber(document.querySelector('.prdCount').innerText)

      const productList = []

      for (let page = 1; page <= Math.ceil(productAmount / 30); page++) {
        fetchWithRandomUserAgent(`https://theclasskorea.co.kr/product/list.html?cate_no=43&sort_method=6&page=${page}`).then(async (res) => {
          const document = parse(res)

          document.querySelectorAll('.xans-product-listnormal > ul > li').forEach((item, index) => {
            const product = new Product()

            product.id = Number(item.querySelector('.name > a').getAttribute('href').split('=')[1].split('&')[0])
            product.title = item.querySelector('.name > a > span:nth-last-child(1)').innerText
            product.price = parseNumber(document.querySelector('li[rel="판매가"] > span:nth-child(2)').innerText)
            product.popularityIndex = (page - 1) * 30 + index
            product.isSoldOut = item.querySelectorAll('.soldoutbg.-nodrag.displaynone').length <= 0

            productList.push(product)
          })

          if (productList.length >= productAmount) {
            resolve(productList)
          }
        }).catch((error) => reject(error))
      }
    }).catch((error) => reject(error))
  })
}

function getAutowaxProductList() {
  return new Promise(async (resolve, reject) => {
    fetchWithRandomUserAgent('https://www.autowax.co.kr/goods/goods_list.php?cateCd=001').then(async (res) => {
      const document = parse(res)
      const productAmount = parseNumber(document.querySelector('.tc').innerText)

      const productList = []

      fetchWithRandomUserAgent(`https://www.autowax.co.kr/goods/goods_list.php?cateCd=001&sort=orderCnt%20desc%2Cg.regDt%20desc&pageNum=${productAmount}`).then(async (res) => {
        const document = parse(res)

        document.querySelectorAll('.space').forEach((item, index) => {
          const product = new Product()

          const idElement = item.querySelector('.txt > a')
          if (!idElement) {
            return
          }

          product.id = parseNumber(idElement.getAttribute('href'))
          product.title = item.querySelector('.txt > a > strong').innerText
          product.price = parseNumber(item.querySelector('.cost').innerText)

          const timeSale = item.querySelector('.time_sale_cost')
          if (timeSale) {
            product.price = parseNumber(timeSale.innerText)
          }

          product.popularityIndex = index
          product.isSoldOut = item.querySelectorAll('.ico-soldout-box > img').length > 0

          productList.push(product)
        })

        resolve(productList)
      }).catch((error) => reject(error))
    })
  }).catch((error) => reject(error))
}

function getWashmartProductList() {
  return new Promise(async (resolve, reject) => {
    let tempDriver

    buildDriver().then(async (driver) => {
      tempDriver = driver

      await driver.get('https://washmart.co.kr')

      const idInput = await driver.wait(until.elementLocated(By.css('#member_id')), timeout)
      idInput.sendKeys(washmartId)

      const pwdInput = await driver.wait(until.elementLocated(By.css('#member_passwd')), timeout)
      pwdInput.sendKeys(washmartPwd)

      const loginButton = await driver.wait(until.elementLocated(By.css('.Loginbtn')), timeout)
      await loginButton.click()

      await driver.wait(until.elementLocated(By.css('#xans_myshop_mileage')), timeout)
      await driver.get('https://washmart.co.kr/product/list3.html?cate_no=24&sort_method=6')

      const productAmountElement = await driver.wait(until.elementLocated(By.css('.prdCount')), timeout)
      const productAmount = parseNumber(await productAmountElement.getAttribute('innerText'))

      const productList = []

      for (let page = 1; page <= Math.ceil(productAmount / 60); page++) {
        if (page > 1) {
          await driver.get(`https://washmart.co.kr/product/list3.html?cate_no=24&sort_method=6&page=${page}`)
        }

        await driver.wait(until.elementLocated(By.css(`.this[href*="page=${page}"]`)), timeout)

        const body = await driver.wait(until.elementLocated(By.css('body')), timeout)
        const document = parse(await body.getAttribute('innerHTML'))

        document.querySelectorAll('.item.hovimg.xans-record-').forEach((item, index) => {
          const product = new Product()

          const linkElement = item.querySelector('.name > a')
          const idSplit = linkElement.getAttribute('href').split('/category')[0].split('/')
          product.id = Number(idSplit[idSplit.length - 1])

          product.title = item.querySelector('.name > a > span:nth-last-child(1)').innerText

          const priceElement = item.querySelector('.halfli2')
          if (priceElement) {
            product.price = parseNumber(priceElement.innerText)
          }

          product.popularityIndex = (page - 1) * 60 + index
          product.isSoldOut = item.querySelectorAll('.sold > img').length > 0

          productList.push(product)
        })
      }
      resolve(productList)
    }).catch((error) => reject(error)).finally(() => {
      if (tempDriver) {
        tempDriver.quit()
      }
    })
  })
}

function getProductList(storeUrl) {
  return new Promise(async (resolve, reject) => {
    let productList

    try {
      // 스마트스토어
      if (storeUrl.includes('smartstore.naver.com')) {
        productList = await getSmartstoreProductList(storeUrl)
      }
      else {
        switch (storeUrl) {
          // 엔공구
          case 'https://n09.co.kr':
            productList = await getN09ProductList()
            break

          // 엔공구 B2B
          case 'https://n09b2b.co.kr':
            productList = await getN09B2BProductList()
            break

          // 오토워시
          case 'https://autowash.co.kr':
            productList = await getAutowashProductList()
            break

          // 카라이프몰
          case 'https://hyundai.auton.kr':
            productList = await getCarlifemallProductList()
            break

          // 더클래스
          case 'https://theclasskorea.co.kr':
            productList = await getTheClassProductList()
            break

          // 오토왁스
          case 'https://autowax.co.kr':
            productList = await getAutowaxProductList()
            break

          // 워시마트
          case 'https://washmart.co.kr':
            productList = await getWashmartProductList()
            break

          default:
            throw new Error('no such store')
        }
      }
    }
    catch (error) {
      reject(error)
      return
    }

    productList = productList.filter((value, index, self) =>
      index == self.findIndex((t) => (
        t.id == value.id
      ))
    )

    resolve(productList)
  })
}

function updateProductList(storeUrl, productList, date) {
  return new Promise(async (resolve, reject) => {
    try {
      let query = 'REPLACE INTO product (storeUrl, minute, id, title, price, popularityIndex, isSoldOut, category) VALUES '
      const valueList = []

      for (const product of productList) {
        const title = product.title.replaceAll(/[^0-9A-Za-zㄱ-ㅎㅏ-ㅣ가-힣!@#$%^&*()-_=+\[{\]}\/\\\s]+/g, '')
        const category = product.category ? `'${product.category}'` : null
        valueList.push(`('${storeUrl}', ${getMinute(date)}, ${product.id}, '${title}', ${product.price}, ${product.popularityIndex}, ${product.isSoldOut ? 1 : 0}, ${category})`)
      }

      query += valueList.join(', ')

      await conn.query(query)
      await conn.query(`REPLACE INTO history (storeUrl, minute) VALUES ('${storeUrl}', ${getMinute(date)})`)

      resolve(getMinute(date))
    }
    catch (error) {
      reject(error)
    }
  })
}

cron.schedule('0 * * * *', async () => {
  const now = await getKST()

  if (now.getUTCHours() == 9 || now.getUTCHours() == 18) {
    for (const storeUrl of [
      'https://smartstore.naver.com/n09',
      'https://smartstore.naver.com/selfwash',
      'https://n09.co.kr',
      // 'https://n09b2b.co.kr',
      'https://autowash.co.kr',
      'https://hyundai.auton.kr',
      'https://theclasskorea.co.kr',
      'https://autowax.co.kr',
      'https://washmart.co.kr',
    ]) {
      getProductList(storeUrl).then(async (productList) => {
        await updateProductList(storeUrl, productList, now)
      }).catch(() => { })
    }
  }
})


http.createServer(app).listen(80)
https.createServer(credentials, app).listen(443)
