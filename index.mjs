
import { initializeApp } from 'firebase/app';

import dateFormat from 'dateformat';
import fs from 'fs';
import bodyParser from 'body-parser';
import https from 'https';
import parser from 'node-html-parser';
import express from 'express';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

initializeApp({
  apiKey: "AIzaSyDevqbIK-lcqYdqbmfBAWGPrSHlJT7F0FQ",
  authDomain: "store-manager-5d527.firebaseapp.com",
  projectId: "store-manager-5d527",
  storageBucket: "store-manager-5d527.appspot.com",
  messagingSenderId: "36522862962",
  appId: "1:36522862962:web:8a9e9b88373a19add095eb",
  measurementId: "G-37DECVWLYX"
});

const credentials = {
  key: fs.readFileSync(__dirname + '/ssl/store-manager.kro.kr_20220303F94AA.key.pem'),
  cert: fs.readFileSync(__dirname + '/ssl/store-manager.kro.kr_20220303F94AA.crt.pem'),
};

const pool = mysql.createPool({
  host: '34.64.248.145',
  user: 'root',
  password: 'gaesugack7328',
  database: 'storeManager',
  connectionLimit: 100,
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));

app.get('/', async (req, res) => {
  res.sendFile(__dirname + '/views/index.html');
});

app.post('/smartstore/search', async (req, res) => {
  let query = req.body.query;
  let storeUrl, endpoint;

  if (query.includes('smartstore.naver.com')) {
    storeUrl = query;

    if (storeUrl.startsWith('http://')) {
      storeUrl = storeUrl.replace('http://', 'https://');
    }

    if (!storeUrl.startsWith('https://')) {
      storeUrl = 'https://' + storeUrl;
    }
  }
  else {
    try {
      endpoint = await searchNaver(query);
      storeUrl = `https://smartstore.naver.com/${endpoint}`;
    }
    catch (error) {
      res.json({
        result: 'error',
        error: error.message == undefined ? error : error.message,
      });
      return;
    }
  }

  let conn;

  try {
    let storeTitle = await searchSmartstore(storeUrl);

    endpoint = storeUrl.slice(storeUrl.indexOf('smartstore.naver.com') + 21);
    if (!new RegExp('^[a-z0-9_-]+$').test(endpoint)) {
      endpoint.slice(0, new RegExp('[^a-z0-9_-]+').exec(endpoint).index);
    }

    conn = await pool.getConnection();
    await conn.query(`REPLACE INTO store (url, title) VALUES ('${storeUrl}', '${storeTitle}')`);

    res.json({
      result: 'OK',
      store_url: endpoint,
      store_title: storeTitle
    });
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
    });
  }
  finally {
    conn.release();
  }
});

app.post('/history', async (req, res) => {
  let storeUrl = req.body.store_url;

  try {
    let conn = await pool.getConnection();
    let result = await conn.query(`SELECT time FROM history WHERE storeUrl = '${storeUrl}' GROUP BY time`);

    let history = [];

    for (let row of result[0]) {
      history.push(row.time);
    }

    res.json({
      result: 'OK',
      history: history,
    });
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
    });
    return;
  }
});

app.post('/productList', async (req, res) => {
  let storeUrl = req.body.store_url;
  let time = req.body.time;
  let conn;

  try {
    conn = await pool.getConnection();
    let result = await conn.query(`SELECT * FROM product WHERE storeUrl = '${storeUrl}' AND time = ${time}`);

    res.json({
      result: 'OK',
      productList: result[0],
    });
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
    });
  }
  finally {
    conn.release();
  }
});

app.get('/smartstore/:endpoint', async (req, res) => {
  let endpoint = req.params.endpoint;
  let storeUrl = `https://smartstore.naver.com/${endpoint}`;

  if (!new RegExp('^[a-z0-9_-]+$').test(endpoint)) {
    res.sendFile(__dirname + '/views/storeNotFound.html');
    return;
  }

  let storeTitle;
  let conn;

  try {
    conn = await pool.getConnection();
    let result = await conn.query(`SELECT * FROM store WHERE url = '${storeUrl}'`);

    if (result[0].length > 0) {
      storeTitle = result[0][0].title;
    }
    else {
      storeTitle = await searchSmartstore(storeUrl);
      await conn.query(`REPLACE INTO store (url, title) VALUES ('${storeUrl}', '${storeTitle}')`);
    }
  }
  catch (error) {
    res.sendFile(__dirname + '/views/storeNotFound.html');
  }
  finally {
    conn.release();
  }

  fs.readFile(__dirname + '/views/store.html', (error, data) => {
    if (error != null) {
      res.json({
        result: 'error',
        error: error.message == undefined ? error : error.message,
      });
      return;
    }

    let htmlString = data.toString();
    htmlString = htmlString.replaceAll('{store_url}', storeUrl);
    htmlString = htmlString.replaceAll('{store_title}', storeTitle);
    res.send(htmlString);
  });
});

app.post('/smartstore/update', async (req, res) => {
  let storeUrl = req.body.store_url;
  let uid = req.body.uid;
  let conn;

  try {
    let now = new Date();
    let time = parseInt(dateFormat(now, 'yyyymmddHHMM'));

    conn = await pool.getConnection();
    let result = await conn.query(`SELECT * FROM history WHERE storeUrl = '${storeUrl}' AND time = ${time}`);

    if (result[0].length > 0) {
      result = await conn.query(`SELECT * FROM product WHERE storeUrl = '${storeUrl}' AND time = ${time}`);

      res.json({
        result: 'OK',
        time: time,
        productList: result[0],
      });
    }
    else {
      let productAmount = await getSmartstoreProductAmount(storeUrl);
      let productList = await getSmartstoreProductList(storeUrl, productAmount)

      let query = 'REPLACE INTO product (storeUrl, time, id, title, price, popularityIndex, isSoldOut) VALUES ';

      for (let product of productList) {
        let productTitle = product.title.replaceAll(/[^0-9A-Za-zㄱ-ㅎㅏ-ㅣ가-힣!@#$%^&*()-_=+\[{\]}\/\\\s]+/g, '');
        query += `('${storeUrl}', ${time}, ${product.id}, '${productTitle}', ${product.price}, ${product.popularityIndex}, ${product.isSoldOut ? 1 : 0}), `;
      }

      query = query.substring(0, query.length - 2);
      await conn.query(query);
      await conn.query(`REPLACE INTO history (storeUrl, time, uid) VALUES ('${storeUrl}', ${time}, '${uid}')`);

      res.json({
        result: 'OK',
        time: time,
        productList: productList,
      });
    }
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
    });
  }
  finally {
    conn.release();
  }
});

app.get('/hyundai/auton', async (req, res) => {
  res.sendFile(__dirname + '/views/carLifeMall.html');
});

app.post('/hyundai/auton/update', async (req, res) => {
  let storeUrl = 'https://hyundai.auton.kr';
  let uid = req.body.uid;
  let conn;

  try {
    let now = new Date();
    let time = parseInt(dateFormat(now, 'yyyymmddHHMM'));

    conn = await pool.getConnection();
    let result = await conn.query(`SELECT * FROM history WHERE storeUrl = '${storeUrl}' AND time = ${time}`);

    if (result[0].length > 0) {
      result = await conn.query(`SELECT * FROM product WHERE storeUrl = '${storeUrl}' AND time = ${time}`);

      res.json({
        result: 'OK',
        time: time,
        productList: result[0],
      });
    }
    else {
      let categoryIdList = [];

      while (categoryIdList <= 0) {
        categoryIdList = await getCarLifeMallCategoryIdList();
      }

      let categoryList = await getCarLifeMallCategoryList(categoryIdList);

      while (true) {
        let tempCategoryIdList = [];

        for (let index = categoryList.length - 1; index >= 0; index--) {
          let category = categoryList[index];

          if (isNaN(category.productAmount)) {
            tempCategoryIdList.push(category.id);
          }
        }

        if (tempCategoryIdList.length > 0) {
          let tempCategoryList = await getCarLifeMallCategoryList(tempCategoryIdList);

          for (let tempCategory of tempCategoryList) {
            for (let category of categoryList) {
              if (category.id == tempCategory.id) {
                category.productAmount = tempCategory.productAmount;
              }
            }
          }
        }
        else {
          break;
        }
      }

      let pageList = [];

      for (let category of categoryList) {
        for (let page = 1; page <= Math.ceil(category.productAmount / 100); page++) {
          pageList.push({
            categoryId: category.id,
            num: page,
          });
        }
      }

      pageList = await getCarLifeMallProductList(pageList);

      while (true) {
        let tempPageList = [];

        for (let page of pageList) {
          if (page.productList.length <= 0) {
            tempPageList.push(page);
          }
        }

        if (tempPageList.length > 0) {
          tempPageList = await getCarLifeMallProductList(tempPageList);

          for (let tempPage of tempPageList) {
            for (let page of pageList) {
              if (tempPage.categoryId == page.categoryId && tempPage.num == page.num) {
                page.productList = tempPage.productList;
              }
            }
          }
        }
        else {
          break;
        }
      }

      let productList = [];

      for (let page of pageList) {
        for (let product of page.productList) {
          if (productList.filter((tempProduct) => tempProduct.id == product.id).length <= 0) {
            productList.push(product);
          }
        }
      }

      let query = 'REPLACE INTO product (storeUrl, time, id, title, price, popularityIndex, isSoldOut) VALUES ';

      for (let product of productList) {
        let productTitle = product.title.replaceAll(/[^0-9A-Za-zㄱ-ㅎㅏ-ㅣ가-힣!@#$%^&*()-_=+\[{\]}\/\\\s]+/g, '');
        query += `('${storeUrl}', ${time}, ${product.id}, '${productTitle}', ${product.price}, ${product.popularityIndex}, ${product.isSoldOut ? 1 : 0}), `;
      }

      query = query.substring(0, query.length - 2);
      await conn.query(query);
      await conn.query(`REPLACE INTO history (storeUrl, time, uid) VALUES ('${storeUrl}', ${time}, '${uid}')`);

      res.json({
        result: 'OK',
        time: time,
        productList: productList,
      });
    }
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
    });
  }
  finally {
    conn.release();
  }
});

function searchNaver(query) {
  return new Promise((resolve, reject) => {
    https.get(`https://search.naver.com/search.naver?query=${query}+스마트스토어`, (resp) => {
      let data = '';

      resp.on('error', (error) => reject(error));
      resp.on('data', (chunk) => data += chunk);
      resp.on('end', () => {
        let document = parser.parse(data);
        let linkElements = document.querySelectorAll('.txt.elss');

        for (let linkElement of linkElements) {
          let url = linkElement.innerText.split('›');

          let baseUrl = url[0];
          let endpoint = url[1];

          if (baseUrl == 'smartstore.naver.com') {
            resolve(endpoint);
          }
        }
        reject('검색된 스토어가 없습니다.');
      });
    }).on('error', (error) => reject(error));
  });
}

function searchSmartstore(storeUrl) {
  return new Promise((resolve, reject) => {
    https.get(storeUrl, (res) => {
      let data = '';

      res.on('error', (error) => {
        reject(error);
      });
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        let document = parser.parse(data);

        let titleElements = document.getElementsByTagName('title');
        let errorElement = document.querySelector('._141KVzmWyN');

        if (titleElements.length > 0) {
          let storeTitle = titleElements[0].text;

          if (errorElement != undefined) {
            reject(errorElement.innerHTML);
          }
          resolve(storeTitle);
        }
        reject('스마트스토어 주소가 아닙니다.');
      });
    }).on('error', (error) => reject(error));
  });
}

function getSmartstoreProductAmount(storeUrl) {
  return new Promise((resolve, reject) => {
    https.get(`${storeUrl}/category/ALL`, (res) => {
      let data = '';

      res.on('error', (error) => reject(error));
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let document = parser.parse(data);

        let productAmountElement = document.querySelector('._3-WhDl_6j2');
        let productAmount = parseInt(productAmountElement.text.replace(/[^0-9]/g, ''));

        resolve(productAmount);
      });
    }).on('error', (error) => reject(error));
  });
}

function getSmartstoreProductList(storeUrl, productAmount) {
  return new Promise((resolve, reject) => {
    let productList = [];

    for (let page = 0; page < Math.ceil(productAmount / 80); page++) {
      https.get(`${storeUrl}/category/ALL/?st=POPULAR&free=false&dt=LIST&page=${page + 1}&size=80`, (res) => {
        let data = '';

        res.on('error', (error) => reject(error));
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let document = parser.parse(data);

          let idElements = document.querySelectorAll('._1vVKEk_wsi');
          let titleElements = document.querySelectorAll('._1Zvjahn0GA');
          let priceElements = document.querySelectorAll('._22XUYkkUGJ')
          let soldOutElements = document.querySelectorAll('._1NtVbWcccv')
          let pageElements = document.querySelectorAll('.UWN4IvaQza');

          for (let productIndex = 0; productIndex < idElements.length; productIndex++) {
            try {
              let page = pageElements.find(element => element.getAttribute('aria-current') == 'true');

              let product = {
                id: parseInt(idElements[productIndex].getAttribute('href').split('/').pop()),
                popularityIndex: (parseInt(page.text) - 1) * 80 + productIndex,
                title: titleElements[productIndex].text.trim(),
                price: parseInt(priceElements[productIndex].text.replace(',', '')),
                isSoldOut: false,
              };

              for (let childNode of soldOutElements[productIndex].childNodes) {
                if (childNode.toString().includes('_1eB0tn9wSc')) {
                  product.isSoldOut = true;
                }
              }
              productList.push(product);
            }
            catch (error) {
              continue;
            }
            finally {
              productAmount--;
            }

            if (productAmount <= 0) {
              resolve(productList);
            }
          }
        });
      }).on('error', (error) => reject(error));
    }
  });
}

function getCarLifeMallCategoryIdList() {
  return new Promise((resolve, reject) => {
    https.get('https://hyundai.auton.kr/product/category/category_main?pcid=3478&rootid=3439', (res) => {
      let data = '';

      res.on('error', (error) => reject(error));
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let document = parser.parse(data);
        let links = document.getElementsByTagName('a');

        let catergoryIdList = [];

        for (let link of links) {
          let href = link.getAttribute('href');

          if (href == undefined) {
            continue;
          }

          if (href.includes('Redirect')) {
            href = href.slice(href.indexOf('Redirect') + 9);
            let pcid = href.slice(0, href.indexOf(','));

            if (!isNaN(pcid)) {
              let catergoryId = parseInt(pcid);

              if (!catergoryIdList.includes(catergoryId)) {
                catergoryIdList.push(catergoryId);
              }
            }
          }
        }
        resolve(catergoryIdList);
      });
    }).on('error', (error) => reject(error));
  });
}

function getCarLifeMallCategoryList(categoryIdList) {
  return new Promise((resolve, reject) => {
    let categoryList = [];

    for (let categoryId of categoryIdList) {
      https.get(`https://hyundai.auton.kr/product/category/category_main?pcid=${categoryId}&rootid=3439`, (res) => {
        let data = '';

        res.on('error', (error) => reject(error));
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let document = parser.parse(data);
          let flex = document.querySelector('.list_top_wrap');

          try {
            let flexText = flex.innerText.trim();
            let productAmount = parseInt(flexText.slice(3, flexText.indexOf('개')));

            categoryList.push({
              id: categoryId,
              productAmount: productAmount,
            });
          }
          catch {
            categoryList.push({
              id: categoryId,
              productAmount: NaN,
            });
          }
          finally {
            if (categoryList.length >= categoryIdList.length) {
              resolve(categoryList);
            }
          }
        });
      }).on('error', (error) => reject(error));
    }
  });
}

function getCarLifeMallProductList(pageList) {
  return new Promise((resolve, reject) => {
    let pages = 0;

    for (let page of pageList) {
      let productList = [];

      https.get(`https://hyundai.auton.kr/product/category/category_main?pcid=${page.categoryId}&rootid=3439&page=${page.num}&recodeCount=100&search.orderBy=sellCount&search.order=desc`, (res) => {
        let data = '';

        res.on('error', (error) => reject(error));
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let document = parser.parse(data);

          let idElements = document.getElementsByTagName('a');
          let titleElements = document.querySelectorAll('.title');
          let priceElements = document.querySelectorAll('.sell_price');

          let idList = [];

          for (let idElement of idElements) {
            let href = idElement.getAttribute('href');

            if (href == undefined) {
              continue;
            }

            if (href.includes('ProductDetail')) {
              href = href.slice(href.indexOf('ProductDetail') + 14);
              href = href.slice(0, href.indexOf(','));

              if (!isNaN(href)) {
                idList.push(parseInt(href));
              }
            }
          }

          for (let productIndex = 0; productIndex < idList.length; productIndex++) {
            let product = {
              id: idList[productIndex],
              title: titleElements[productIndex].innerText.trim(),
              price: parseInt(priceElements[productIndex].innerText.replace(/[^\d.]/g, '')),
              popularityIndex: 0,
              isSoldOut: false,
            };
            productList.push(product);
          }

          page.productList = productList;
          pages++;

          if (pages >= pageList.length) {
            resolve(pageList);
          }
        });
      }).on('error', (error) => reject(error));
    }
  });
}

https.createServer(credentials, app).listen(443);
