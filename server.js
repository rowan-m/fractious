const express = require('express');
const app = express();

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

app.enable('trust proxy');
app.use(function (req, res, next) {
  if (req.secure) {
    return next();
  }
  res.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.redirect('https://' + req.headers.host + req.url);
});

app.get('/', (req, res) => {
  res.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  
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

  res.set('Accept-CH', acceptCH.join(', '));
  res.sendFile(__dirname + '/public/index.html');
});

app.use(express.static('public',
  {
    maxAge: '1d',
    setHeaders: (res, path, stat) => {
      res.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
  }
));

const listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});
