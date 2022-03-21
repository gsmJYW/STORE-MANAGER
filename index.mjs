import { exit } from 'process'
import dateFormat from 'dateformat'
import fs from 'fs'
import bodyParser from 'body-parser'
import http from 'http'
import https from 'https'
import parser from 'node-html-parser'
import express from 'express'
import mysql from 'mysql2/promise'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import NTPClient from '@destinationstransfers/ntp'

const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import admin from 'firebase-admin'
import { getAuth } from 'firebase-admin/auth'
import serviceAccount from './store-manager-5d527-firebase-adminsdk-2ovpp-f0b6ef3a8a.json'

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

app.get('/visitor', async (req, res) => {
  res.sendFile(__dirname + '/views/visitor.html')
})

app.post('/recentVisitorList', async (req, res) => {
  let idToken = req.body.id_token
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    conn = await pool.getConnection()
    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)

    if (result[0].length > 0) {
      if (result[0][0].permission == 1) {
        result = await conn.query(`SELECT *, GREATEST(date, time) as datetime FROM query GROUP BY uid`)

        res.json({
          result: 'ok',
          visitorList: result[0],
        })

        return
      }
    }

    res.json({ result: 'no permission' })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
})

app.post('/signin', async (req, res) => {
  let idToken = req.body.id_token
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

    res.json({
      result: 'ok',
      uid: uid,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
    })
  }
})

app.post('/user', async (req, res) => {
  let idToken = req.body.id_token
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
      error: error.message == undefined ? error : error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/quota', async (req, res) => {
  let idToken = req.body.id_token
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    let now = await getKST()
    conn = await pool.getConnection()

    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)
    let isAdmin = result[0][0].permission == 1

    result = await conn.query(`SELECT * FROM query WHERE uid = '${uid}' AND date = '${dateFormat(now, 'yyyy-mm-dd', true)}'`)

    res.json({
      result: 'ok',
      isAdmin: isAdmin,
      quota: result[0],
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/user/update', async (req, res) => {
  let idToken = req.body.id_token
  let loadAll = req.body.load_all
  let highlightChanges = req.body.highlight_changes
  let sortMethod = req.body.sort_method
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
      error: error.message == undefined ? error : error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/bookmarkList', async (req, res) => {
  let idToken = req.body.id_token
  let storeUrl = req.body.store_url
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    let query = `SELECT bookmark.storeUrl, store.title FROM bookmark INNER JOIN store WHERE uid = '${uid}' AND bookmark.storeUrl = store.url`

    if (storeUrl != undefined) {
      query += ` AND storeUrl = '${storeUrl}'`
    }

    conn = await pool.getConnection()
    let result = await conn.query(query)

    res.json({
      result: 'ok',
      bookmarkList: result[0],
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/bookmark/update', async (req, res) => {
  let idToken = req.body.id_token
  let storeUrl = req.body.store_url
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
      error: error.message == undefined ? error : error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/bookmark/delete', async (req, res) => {
  let idToken = req.body.id_token
  let storeUrl = req.body.store_url
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
      error: error.message == undefined ? error : error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/save', async (req, res) => {
  let idToken = req.body.id_token
  let storeUrl = req.body.store_url
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    let now = await getKST()

    conn = await pool.getConnection()
    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)

    if (result[0][0].permission == 0) {
      let result = await conn.query(`SELECT SUM(amount) AS amount FROM query WHERE uid='${uid}' AND date = '${dateFormat(now, 'yyyy-mm-dd', true)}' AND type = 3`)

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
      INSERT INTO query (uid, storeUrl, date, time, type, amount) VALUES ('${uid}', '${storeUrl}', '${dateFormat(now, 'yyyy-mm-dd', true)}', '${dateFormat(now, 'HH:MM:ss.l')}', 3, 1)
      ON DUPLICATE KEY UPDATE time = '${dateFormat(now, 'HH:MM:ss.l')}', amount = amount + 1
    `)

    res.json({ result: 'ok' })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
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
      storeUrl = `https://smartstore.naver.com/${endpoint}`
    }
    catch (error) {
      res.json({
        result: 'error',
        error: error.message == undefined ? error : error.message,
      })
      return
    }
  }

  let conn

  try {
    let storeTitle = await searchSmartstore(storeUrl)

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
      store_url: endpoint,
      store_title: storeTitle
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.post('/history', async (req, res) => {
  let idToken = req.body.id_token
  let storeUrl = req.body.store_url

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
      INSERT INTO query (uid, storeUrl, date, time, type, amount) VALUES ('${uid}', '${storeUrl}', '${dateFormat(now, 'yyyy-mm-dd', true)}', '${dateFormat(now, 'HH:MM:ss.l')}', 0, 1)
      ON DUPLICATE KEY UPDATE time = '${dateFormat(now, 'HH:MM:ss.l')}', amount = amount + 1
    `)

    result = await conn.query(`SELECT time FROM history WHERE storeUrl = '${storeUrl}' GROUP BY time`)
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
      error: error.message == undefined ? error : error.message,
    })
    return
  }
})

app.post('/productList', async (req, res) => {
  let idToken = req.body.id_token
  let storeUrl = req.body.store_url
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

      result = await conn.query(`SELECT SUM(amount) AS amount FROM query WHERE uid='${uid}' AND date = '${dateFormat(now, 'yyyy-mm-dd', true)}' AND type = 1`)

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

    result = await conn.query(`SELECT * FROM product WHERE storeUrl = '${storeUrl}' AND time = ${time}`)
    let productList = result[0]

    await conn.query(`
      INSERT INTO query (uid, storeUrl, date, time, type, amount) VALUES ('${uid}', '${storeUrl}', '${dateFormat(now, 'yyyy-mm-dd', true)}', '${dateFormat(now, 'HH:MM:ss.l')}', 1, ${productList.length})
      ON DUPLICATE KEY UPDATE time = '${dateFormat(now, 'HH:MM:ss.l')}', amount = amount + ${productList.length}
    `)

    res.json({
      result: 'ok',
      productList: productList,
    })
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
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
      await conn.query(`
        INSERT INTO store (url, title) VALUES ('${storeUrl}', '${storeTitle}')
        ON DUPLICATE KEY title = '${storeTitle}'
      `)
    }
  }
  catch (error) {
    res.sendFile(__dirname + '/views/storeNotFound.html')
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }

  fs.readFile(__dirname + '/views/smartstore.html', (error, data) => {
    if (error != null) {
      res.json({
        result: 'error',
        error: error.message == undefined ? error : error.message,
      })
      return
    }

    let htmlString = data.toString()
    htmlString = htmlString.replaceAll('{store_url}', storeUrl)
    htmlString = htmlString.replaceAll('{store_title}', storeTitle)
    res.send(htmlString)
  })
})

app.post('/smartstore/update', async (req, res) => {
  let idToken = req.body.id_token
  let storeUrl = req.body.store_url
  let conn

  try {
    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    let now = await getKST()
    let time = parseInt(dateFormat(now, 'yyyymmddHHMM', true))

    conn = await pool.getConnection()
    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)

    if (result[0][0].permission == 0) {
      result = await conn.query(`SELECT SUM(amount) AS amount FROM query WHERE uid='${uid}' AND date = '${dateFormat(now, 'yyyy-mm-dd', true)}' AND type = 2`)

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

    result = await conn.query(`SELECT * FROM history WHERE storeUrl = '${storeUrl}' AND time = ${time}`)
    let productList

    if (result[0].length > 0) {
      result = await conn.query(`SELECT * FROM product WHERE storeUrl = '${storeUrl}' AND time = ${time}`)
      productList = result[0]

      res.json({
        result: 'already exists',
        time: time,
        productList: productList,
      })
    }
    else {
      let productAmount = await getSmartstoreProductAmount(storeUrl)
      productList = await getSmartstoreProductList(storeUrl, productAmount)

      let query = 'REPLACE INTO product (storeUrl, time, id, title, price, popularityIndex, isSoldOut) VALUES '

      for (let product of productList) {
        let productTitle = product.title.replaceAll(/[^0-9A-Za-zㄱ-ㅎㅏ-ㅣ가-힣!@#$%^&*()-_=+\[{\]}\/\\\s]+/g, '')
        query += `('${storeUrl}', ${time}, ${product.id}, '${productTitle}', ${product.price}, ${product.popularityIndex}, ${product.isSoldOut ? 1 : 0}), `
      }

      query = query.substring(0, query.length - 2)
      await conn.query(query)
      await conn.query(`REPLACE INTO history (storeUrl, time) VALUES ('${storeUrl}', ${time})`)

      await conn.query(`
        INSERT INTO query (uid, storeUrl, date, time, type, amount) VALUES ('${uid}', '${storeUrl}', '${dateFormat(now, 'yyyy-mm-dd', true)}', '${dateFormat(now, 'HH:MM:ss.l')}', 2, ${productList.length})
        ON DUPLICATE KEY UPDATE time = '${dateFormat(now, 'HH:MM:ss.l')}', amount = amount + ${productList.length}
      `)

      res.json({
        result: 'ok',
        time: time,
        productList: productList,
      })
    }
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
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
  let idToken = req.body.id_token
  let conn

  try {
    let now = await getKST()
    let time = parseInt(dateFormat(now, 'yyyymmddHHMM', true))

    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    conn = await pool.getConnection()
    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)

    if (result[0][0].permission == 0) {
      res.json({ result: 'no permission' })
      return;
    }

    result = await conn.query(`SELECT * FROM history WHERE storeUrl = '${storeUrl}' AND time = ${time}`)

    if (result[0].length > 0) {
      result = await conn.query(`SELECT * FROM product WHERE storeUrl = '${storeUrl}' AND time = ${time}`)

      res.json({
        result: 'ok',
        time: time,
        productList: result[0],
      })
    }
    else {
      let productAmount = await getN09ProductAmount()
      let productList = await getN09ProductList(productAmount)

      let query = 'REPLACE INTO product (storeUrl, time, id, title, price, popularityIndex, isSoldOut) VALUES '

      for (let product of productList) {
        let productTitle = product.title.replaceAll(/[^0-9A-Za-zㄱ-ㅎㅏ-ㅣ가-힣!@#$%^&*()-_=+\[{\]}\/\\\s]+/g, '')
        query += `('${storeUrl}', ${time}, ${product.id}, '${productTitle}', ${product.price}, ${product.popularityIndex}, ${product.isSoldOut ? 1 : 0}), `
      }

      query = query.substring(0, query.length - 2)
      await conn.query(query)
      await conn.query(`REPLACE INTO history (storeUrl, time) VALUES ('${storeUrl}', ${time})`)

      await conn.query(`
        INSERT INTO query (uid, storeUrl, date, time, type, amount) VALUES ('${uid}', '${storeUrl}', '${dateFormat(now, 'yyyy-mm-dd', true)}', '${dateFormat(now, 'HH:MM:ss.l')}', 2, ${productList.length})
        ON DUPLICATE KEY UPDATE time = '${dateFormat(now, 'HH:MM:ss.l')}', amount = amount + ${productList.length}
      `)

      res.json({
        result: 'ok',
        time: time,
        productList: productList,
      })
    }
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

app.get('/hyundai/auton', async (req, res) => {
  res.sendFile(__dirname + '/views/carLifeMall.html')
})

app.post('/hyundai/auton/update', async (req, res) => {
  let storeUrl = 'https://hyundai.auton.kr'
  let idToken = req.body.id_token
  let conn

  try {
    let now = await getKST()
    let time = parseInt(dateFormat(now, 'yyyymmddHHMM', true))

    let decodedToken = await auth.verifyIdToken(idToken)
    let uid = decodedToken.uid

    conn = await pool.getConnection()
    let result = await conn.query(`SELECT * FROM user WHERE uid = '${uid}'`)

    if (result[0][0].permission == 0) {
      res.json({ result: 'no permission' })
      return;
    }

    result = await conn.query(`SELECT * FROM history WHERE storeUrl = '${storeUrl}' AND time = ${time}`)

    if (result[0].length > 0) {
      result = await conn.query(`SELECT * FROM product WHERE storeUrl = '${storeUrl}' AND time = ${time}`)

      res.json({
        result: 'ok',
        time: time,
        productList: result[0],
      })
    }
    else {
      let categoryIdList = []

      while (categoryIdList <= 0) {
        categoryIdList = await getCarLifeMallCategoryIdList()
      }

      let categoryList = await getCarLifeMallCategoryList(categoryIdList)

      while (true) {
        let tempCategoryIdList = []

        for (let index = categoryList.length - 1; index >= 0; index--) {
          let category = categoryList[index]

          if (isNaN(category.productAmount)) {
            tempCategoryIdList.push(category.id)
          }
        }

        if (tempCategoryIdList.length > 0) {
          let tempCategoryList = await getCarLifeMallCategoryList(tempCategoryIdList)

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

      pageList = await getCarLifeMallProductList(pageList)

      while (true) {
        let tempPageList = []

        for (let page of pageList) {
          if (page.productList.length <= 0) {
            tempPageList.push(page)
          }
        }

        if (tempPageList.length > 0) {
          tempPageList = await getCarLifeMallProductList(tempPageList)

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

      let productList = []

      for (let page of pageList) {
        for (let product of page.productList) {
          if (productList.filter((tempProduct) => tempProduct.id == product.id).length <= 0) {
            productList.push(product)
          }
        }
      }

      console.log(productList)

      let query = 'REPLACE INTO product (storeUrl, time, id, title, price, popularityIndex, isSoldOut, category) VALUES '

      for (let product of productList) {
        let productTitle = product.title.replaceAll(/[^0-9A-Za-zㄱ-ㅎㅏ-ㅣ가-힣!@#$%^&*()-_=+\[{\]}\/\\\s]+/g, '')
        query += `('${storeUrl}', ${time}, ${product.id}, '${productTitle}', ${product.price}, ${product.popularityIndex}, ${product.isSoldOut ? 1 : 0}, '${product.category}'), `
      }

      query = query.substring(0, query.length - 2)
      await conn.query(query)
      await conn.query(`REPLACE INTO history (storeUrl, time) VALUES ('${storeUrl}', ${time})`)

      res.json({
        result: 'ok',
        time: time,
        productList: productList,
      })
    }
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
    })
  }
  finally {
    if (typeof conn == 'object') {
      conn.release()
    }
  }
})

async function getKST() {
  let now = await NTPClient.getNetworkTime()
  let kst = new Date(now.getTime() + 1000 * 60 * 60 * 9)
  return kst
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
        reject('검색된 스토어가 없습니다.')
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
          let storeTitle = titleElements[0].text

          if (errorElement != undefined) {
            reject(errorElement.innerHTML)
          }
          resolve(storeTitle)
        }
        reject('스마트스토어 주소가 아닙니다.')
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
        let productAmount = parseInt(productAmountElement.text.replace(/[^0-9]/g, ''))

        resolve(productAmount)
      })
    }).on('error', (error) => reject(error))
  })
}

function getSmartstoreProductList(storeUrl, productAmount) {
  return new Promise((resolve, reject) => {
    let productList = []

    for (let page = 0; page < Math.ceil(productAmount / 80); page++) {
      https.get(`${storeUrl}/category/ALL/?st=POPULAR&free=false&dt=LIST&page=${page + 1}&size=80`, (res) => {
        let data = ''

        res.on('error', (error) => reject(error))
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          let document = parser.parse(data)

          let idElements = document.querySelectorAll('._1vVKEk_wsi')
          let titleElements = document.querySelectorAll('._1Zvjahn0GA')
          let priceElements = document.querySelectorAll('._22XUYkkUGJ')
          let soldOutElements = document.querySelectorAll('._1NtVbWcccv')
          let pageElements = document.querySelectorAll('.UWN4IvaQza')

          for (let productIndex = 0; productIndex < idElements.length; productIndex++) {
            try {
              let page = pageElements.find(element => element.getAttribute('aria-current') == 'true')

              let product = {
                id: parseInt(idElements[productIndex].getAttribute('href').split('/').pop()),
                popularityIndex: (parseInt(page.text) - 1) * 80 + productIndex,
                title: titleElements[productIndex].text.trim(),
                price: parseInt(priceElements[productIndex].text.replace(',', '')),
                isSoldOut: false,
              }

              for (let childNode of soldOutElements[productIndex].childNodes) {
                if (childNode.toString().includes('_1eB0tn9wSc')) {
                  product.isSoldOut = true
                }
              }
              productList.push(product)
            }
            catch (error) {
              continue
            }
            finally {
              productAmount--
            }

            if (productAmount <= 0) {
              resolve(productList)
            }
          }
        })
      }).on('error', (error) => reject(error))
    }
  })
}

function getCarLifeMallCategoryIdList() {
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

        let catergoryIdList = []

        for (let link of links) {
          let href = link.getAttribute('href')

          if (href == undefined) {
            continue
          }

          if (href.includes('Redirect')) {
            href = href.slice(href.indexOf('Redirect') + 9)
            let pcid = href.slice(0, href.indexOf(','))

            if (!isNaN(pcid)) {
              let catergoryId = parseInt(pcid)

              if (!catergoryIdList.includes(catergoryId)) {
                catergoryIdList.push(catergoryId)
              }
            }
          }
        }
        resolve(catergoryIdList)
      })
    }).on('error', (error) => reject(error))
  })
}

function getCarLifeMallCategoryList(categoryIdList) {
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

            let productAmount = parseInt(flexText.slice(3, flexText.indexOf('개')))

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

function getCarLifeMallProductList(pageList) {
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

            if (href == undefined) {
              continue
            }

            if (href.includes('ProductDetail')) {
              href = href.slice(href.indexOf('ProductDetail') + 14)
              href = href.slice(0, href.indexOf(','))

              if (!isNaN(href)) {
                idList.push(parseInt(href))
              }
            }
          }

          for (let productIndex = 0; productIndex < idList.length; productIndex++) {
            let product = {
              id: idList[productIndex],
              title: titleElements[productIndex].innerText.trim(),
              price: parseInt(priceElements[productIndex].innerText.replace(/[^\d.]/g, '')),
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
        let productAmount = parseInt(productAmountText)
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
            product.id = parseInt(link)

            let statusElements = item.getElementsByTagName('img')
            for (let statusElement of statusElements) {
              if (statusElement.getAttribute('alt').includes('품절')) {
                product.isSoldOut = true
              }
            }

            let spanList = item.getElementsByTagName('span')
            for (let span of spanList) {
              let style = span.getAttribute('style')

              if (style != undefined) {
                if (style.includes('font-size:13px;color:#242424;font-weight:bold;')) {
                  product.title = span.innerText.trim()
                }
              }

              if (span.innerText.endsWith('원')) {
                product.price = parseInt(span.innerText.replace(/[^\d.]/g, ''))
              }
            }

            if (product.price == undefined) {
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

http.createServer(app).listen(80)
https.createServer(credentials, app).listen(443)
