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

app.use('/', router);
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));

router.get('/', function (req, res) {
  res.sendFile(__dirname + '/views/index.html');
});

function getStoreInfo(storeUrl) {
  return new Promise((resolve, reject) => {
    https.get(`https://smartstore.naver.com/${storeUrl}`, (resp) => {
      var data = '';

      resp.on('error', (error) => reject(error));

      resp.on('data', (chunk) => {
        data += chunk;
      });

      resp.on('end', () => {
        var document = parser.parse(data);

        var titleElements = document.getElementsByTagName('title');
        var categoryElements = document.querySelectorAll('._3HQCww4jR6');

        var storeTitle = titleElements[0].text;
        var categoryLink = categoryElements.pop().getAttribute('href');
        var categoryUrl = categoryLink.split('/').pop().split('?')[0];

        resolve({ store_title: storeTitle, category_url: categoryUrl });
      });
    }).on('error', (error) => reject(error));
  });
}

function getProductAmount(storeUrl, categoryUrl) {
  return new Promise((resolve, reject) => {
    https.get(`https://smartstore.naver.com/${storeUrl}/category/${categoryUrl}`, (res) => {
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

function getProductList(storeUrl, categoryUrl, productAmount) {
  return new Promise((resolve, reject) => {
    var productList = [];

    for (var page = 0; page < Math.ceil(productAmount / 80); page++) {
      https.get(`https://smartstore.naver.com/${storeUrl}/category/${categoryUrl}/?st=POPULAR&free=false&dt=LIST&page=${page + 1}&size=80`, (res) => {
        var data = '';

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

app.post('/searchStore', (req, res) => {
  var storeUrl = req.body.store_url;

  https.get(`https://smartstore.naver.com/${storeUrl}`, (resp) => {
    var data = '';

    resp.on('data', (chunk) => data += chunk);
    resp.on('end', () => {
      var document = parser.parse(data);
      var titleElements = document.getElementsByTagName('title');
      var categoryElements = document.querySelectorAll('._3HQCww4jR6');

      if (titleElements.length > 0 && categoryElements.length > 0) {
        var storeTitle = titleElements[0].text;

        var categoryLink = categoryElements.pop().getAttribute('href');
        var categoryUrl = categoryLink.split('/').pop().split('?')[0];

        res.json({ result: 'OK', store_title: storeTitle, category_url: categoryUrl });
      } else {
        res.json({ result: 'error', error: '존재하지 않거나 운영을 중단한 스토어입니다.' });
      }
    });
  }).on('error', (error) => {
    res.json({
      result: 'error',
      error: error.message
    });
  });
});

app.post('/:store_url', async (req, res) => {
  var storeUrl = req.params.store_url;
  var storeTitle = req.body.store_title;

  fs.readFile(__dirname + "/views/store.html", (error, data) => {
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
      error: error.message,
    });
  }

  for (var colRef of colRefList) {
    historyList.push(Number(colRef.id));
  }

  res.json({
    result: 'OK',
    historyList: historyList,
  });
})

app.post('/:store_url/update', (req, res) => {
  var storeUrl = req.params.store_url;

  getStoreInfo(storeUrl).then((storeInfo, storeInfoReject) => {
    if (storeInfoReject != undefined) {
      res.json({
        result: 'error',
        error: error.message,
      })
      return;
    }
    getProductAmount(storeUrl, storeInfo.category_url).then((productAmount, productAmountReject) => {
      if (productAmountReject != undefined) {
        res.json({
          result: 'error',
          error: error.message,
        })
        return;
      }
      getProductList(storeUrl, storeInfo.category_url, productAmount).then((productList, productListReject) => {
        if (productListReject != undefined) {
          res.json({
            result: 'error',
            error: error.message,
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
      });
    });
  });
});

app.post('/:store_url/:history', async (req, res) => {
  var storeUrl = req.params.store_url;
  var history = req.params.history;

  try {
    var querySnapshot = await db
      .collection('smartstore')
      .doc(storeUrl)
      .collection(history)
      .get()
  }
  catch (error) {
    res.json({
      result: 'error',
      error: error.message,
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
