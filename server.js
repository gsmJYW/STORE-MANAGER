const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const serviceAccount = require('./firebase-adminsdk.json');

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

const _ = require('underscore');
const fs = require('fs');
const bodyParser = require('body-parser');
const https = require('https');
const parser = require('node-html-parser');
const express = require('express');
const app = express();

var router = express.Router();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));

function searchNaver(query) {
  return new Promise((resolve, reject) => {
    https.get(`https://search.naver.com/search.naver?query=${query}+스마트스토어`, (resp) => {
      var data = '';

      resp.on('error', (error) => reject(error));
      resp.on('data', (chunk) => data += chunk);
      resp.on('end', () => {
        var document = parser.parse(data);
        var linkElements = document.querySelectorAll('.txt.elss');

        for (var linkElement of linkElements) {
          var url = linkElement.innerText.split('›');

          var baseUrl = url[0];
          var endpoint = url[1];

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
      var data = '';

      res.on('error', (error) => {
        reject(error);
      });
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        var document = parser.parse(data);

        var titleElements = document.getElementsByTagName('title');
        var errorElement = document.querySelector('._141KVzmWyN');

        if (titleElements.length > 0) {
          var storeTitle = titleElements[0].text;

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
      var data = '';

      res.on('error', (error) => reject(error));
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        var document = parser.parse(data);

        var productAmountElement = document.querySelector('._3-WhDl_6j2');
        var productAmount = parseInt(productAmountElement.text.replace(/[^0-9]/g, ''));

        resolve(productAmount);
      });
    }).on('error', (error) => reject(error));
  });
}

function getProductList(storeUrl, productAmount) {
  return new Promise((resolve, reject) => {
    var productList = [];

    for (var page = 0; page < Math.ceil(productAmount / 80); page++) {
      https.get(`https://smartstore.naver.com/${storeUrl}/category/ALL/?st=POPULAR&free=false&dt=LIST&page=${page + 1}&size=80`, (res) => {
        var data = '';

        res.on('error', (error) => reject(error));
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          var document = parser.parse(data);

          var idElements = document.querySelectorAll('._1vVKEk_wsi');
          var titleElements = document.querySelectorAll('._1Zvjahn0GA');
          var priceElements = document.querySelectorAll('._22XUYkkUGJ')
          var soldOutElements = document.querySelectorAll('._1NtVbWcccv')
          var pageElements = document.querySelectorAll('.UWN4IvaQza');

          var productIndex = 0;

          for (var productIndex = 0; productIndex < idElements.length; productIndex++) {
            var page = pageElements.find(element => element.getAttribute('aria-current') == 'true');

            var product = {
              id: parseInt(idElements[productIndex].getAttribute('href').split('/').pop()),
              popularityIndex: (parseInt(page.text) - 1) * 80 + productIndex,
              title: titleElements[productIndex].text.trim(),
              price: parseInt(priceElements[productIndex].text.replace(',', '')),
              isSoldOut: false,
            };

            for (var childNode of soldOutElements[productIndex].childNodes) {
              if (childNode.toString().includes('_1eB0tn9wSc')) {
                product.isSoldOut = true;
              }
            }

            productList.push(product);

            if (productList.length >= productAmount) {
              resolve(productList);
              break;
            }
          }
        });
      }).on('error', (error) => reject(error));
    }
  });
}

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html');
});

app.post('/searchStore', async (req, res) => {
  var query = req.body.query;
  var storeUrl = '';

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
      var endpoint = await searchNaver(query);
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
    var storeTitle = await searchStore(storeUrl);

    endpoint = storeUrl.slice(storeUrl.indexOf('smartstore.naver.com') + 21);
    if (!new RegExp('^[a-z0-9_-]+$').test(endpoint)) {
      endpoint.slice(0, new RegExp('[^a-z0-9_-]+').exec(endpoint).index);
    }

    var doc = db
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

app.get('/:store_url', async (req, res) => {
  var storeUrl = req.params.store_url;

  if (!new RegExp('^[a-z0-9_-]+$').test(storeUrl)) {
    res.sendFile(__dirname + '/views/storeNotFound.html');
    return;
  }

  var querySnapshot = await db
    .collection('smartstore')
    .doc(storeUrl)
    .get();

  var storeTitle = '';

  if (querySnapshot.exists) {
    storeTitle = querySnapshot.get('storeTitle');
  }
  else {
    try {
      storeTitle = await searchStore(`https://smartstore.naver.com/${storeUrl}`);

      var doc = db
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
    var htmlString = data.toString();
    htmlString = htmlString.replaceAll('{store_url}', storeUrl);
    htmlString = htmlString.replaceAll('{store_title}', storeTitle);
    res.send(htmlString);
  });
});

app.post('/:store_url/historyList', async (req, res) => {
  var storeUrl = req.params.store_url;

  var colRefList = [];
  var historyList = [];

  try {
    colRefList = await db
      .collection('smartstore')
      .doc(storeUrl)
      .listCollections();
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error,
    });
  }

  for (var colRef of colRefList) {
    if (!isNaN(colRef.id)) {
      historyList.push(Number(colRef.id));
    }
  }

  res.json({
    result: 'OK',
    historyList: historyList,
  });
})

app.post('/:store_url/update', (req, res) => {
  var storeUrl = req.params.store_url;

  getProductAmount(storeUrl).then((productAmount, productAmountReject) => {
    if (productAmountReject != undefined) {
      res.json({
        result: 'error',
        error: '전체 제품 개수를 가져오는데 실패 하였습니다.',
      })
      return;
    }
    getProductList(storeUrl, productAmount).then((productList, productListReject) => {
      if (productListReject != undefined) {
        res.json({
          result: '제품 정보를 가져오는데 실패 하였습니다.',
          error: error,
        })
        return;
      }

      var now = new Date();

      for (var product of productList) {
        const docRef = db
          .collection('smartstore')
          .doc(storeUrl)
          .collection(now.getTime().toString())
          .doc(product.id.toString());

        docRef.set(product);
      }

      res.json({
        result: 'OK',
        date: Number(now),
        productList: productList,
      });
    }).catch((error) => res.json({ result: 'error', error: error }));
  }).catch((error) => res.json({ result: 'error', error: error }));
});

app.post('/:store_url/:history', async (req, res) => {
  var storeUrl = req.params.store_url;
  var history = req.params.history;

  try {
    var querySnapshot = await db
      .collection('smartstore')
      .doc(storeUrl)
      .collection(history)
      .get();
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error,
    });
  }

  var docList = [];

  for (var doc of querySnapshot.docs) {
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
    history: docList.reverse(),
  });
})

app.listen(80);
