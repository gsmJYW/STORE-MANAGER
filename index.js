const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./firebase-adminsdk.json');

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const fs = require('fs');
const bodyParser = require('body-parser');
const https = require('https');
const parser = require('node-html-parser');
const express = require('express');
const app = express();

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

  try {
    let storeTitle = await searchStore(storeUrl);

    endpoint = storeUrl.slice(storeUrl.indexOf('smartstore.naver.com') + 21);
    if (!new RegExp('^[a-z0-9_-]+$').test(endpoint)) {
      endpoint.slice(0, new RegExp('[^a-z0-9_-]+').exec(endpoint).index);
    }

    let doc = db
      .collection('smartstore')
      .doc(endpoint)

    doc.set({ storeTitle: storeTitle });

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
});

app.get('/smartstore/:store_url', async (req, res) => {
  let storeUrl = req.params.store_url;

  if (!new RegExp('^[a-z0-9_-]+$').test(storeUrl)) {
    res.sendFile(__dirname + '/views/storeNotFound.html');
    return;
  }

  let querySnapshot = await db
    .collection('smartstore')
    .doc(storeUrl)
    .get();

  let storeTitle;

  if (querySnapshot.exists) {
    storeTitle = querySnapshot.get('storeTitle');
  }
  else {
    try {
      storeTitle = await searchStore(`https://smartstore.naver.com/${storeUrl}`);

      let doc = db
        .collection('smartstore')
        .doc(storeUrl)

      doc.set({ storeTitle: storeTitle });
    }
    catch (error) {
      res.sendFile(__dirname + '/views/storeNotFound.html');
      return;
    }
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

app.post('/smartstore/:store_url/update', async (req, res) => {
  let storeUrl = req.params.store_url;

  try {
    let productAmount = await getProductAmount(storeUrl);
    let productList = await getProductList(storeUrl, productAmount)

    let now = new Date();

    for (let product of productList) {
      let doc = db
        .collection('smartstore')
        .doc(storeUrl)
        .collection(now.getTime().toString())
        .doc(product.id.toString());

      doc.set(product);
    }

    res.json({
      result: 'OK',
      date: Number(now),
      productList: productList,
    });
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
    });
  }
});

app.post('/smartstore/:store_url/historyList', async (req, res) => {
  let storeUrl = req.params.store_url;

  let colRefList;
  let historyList = [];

  try {
    colRefList = await db
      .collection('smartstore')
      .doc(storeUrl)
      .listCollections();
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
    });
    return;
  }

  for (let colRef of colRefList) {
    if (!isNaN(colRef.id)) {
      historyList.push(Number(colRef.id));
    }
  }

  res.json({
    result: 'OK',
    historyList: historyList,
  });
});

app.post('/smartstore/:store_url/:history', async (req, res) => {
  let storeUrl = req.params.store_url;
  let history = req.params.history;

  let querySnapshot;

  try {
    querySnapshot = await db
      .collection('smartstore')
      .doc(storeUrl)
      .collection(history)
      .orderBy('id', 'desc')
      .get();
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message == undefined ? error : error.message,
    });
    return;
  }

  let docList = [];

  for (let doc of querySnapshot.docs) {
    docList.push({
      id: doc.get('id'),
      title: doc.get('title'),
      price: doc.get('price'),
      isSoldOut: doc.get('isSoldOut'),
      popularityIndex: doc.get('popularityIndex'),
    });
  }

  res.json({
    result: 'OK',
    history: docList,
  });
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

function searchStore(storeUrl) {
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

function getProductAmount(storeUrl) {
  return new Promise((resolve, reject) => {
    https.get(`https://smartstore.naver.com/${storeUrl}/category/ALL`, (res) => {
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

function getProductList(storeUrl, productAmount) {
  return new Promise((resolve, reject) => {
    let productList = [];

    for (let page = 0; page < Math.ceil(productAmount / 80); page++) {
      https.get(`https://smartstore.naver.com/${storeUrl}/category/ALL/?st=POPULAR&free=false&dt=LIST&page=${page + 1}&size=80`, (res) => {
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

app.listen(80);
