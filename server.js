// Valid hints prefixed with 
const _HINTS = [
  'UA-Arch',
  'UA-Model',
  'UA-Platform',
  'UA-Platform-Version',
  'UA',
  'UA-Full-Version',
  'UA-Mobile',
];

const express = require('express');
const app = express();

app.enable('trust proxy');
app.use(function (req, res, next) {
  if (req.secure) {
    res.set('Strict-Transport-Security', 'max-age=63072000; inlcudeSubdomains; preload');
    return next();
  }
  
  res.redirect(301, 'https://' + req.headers.host + req.url);
});

app.use(function (req, res, next) {
  let rawCH = [];
  
  if (typeof req.query.uach === 'string') {
    rawCH = [req.query.uach];
  } else if (Array.isArray(req.query.uach)) {
    rawCH = req.query.uach;
  }
  
  const acceptCH = [];
  
  rawCH.forEach((uach) => {
    if (_HINTS.indexOf(uach) >= 0) {
      acceptCH.push(uach);
    }
  });

  res.set('Accept-CH', acceptCH.join(', '));    res.set('Strict-Transport-Security', 'max-age=63072000; inlcudeSubdomains; preload');
  return next();
});

app.get('/', (req, res) => {

  res.sendFile(__dirname + '/public/index.html');
});

app.get('/show-headers', (req, res) => {
  
});

app.use(express.static('public', { maxAge: '1d' } ));

const listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});
