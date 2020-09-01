const express = require('express');
const app = express();

// If you need some basic templating, then you can enable Mustache

/*
 * If you need basic templating, you can enable Mustache here
 * Personal preference is just to "upgrade" existing HTML files with templated variables
 * Enabling the view cache after the demo is published
 */
// const mustacheExpress = require('mustache-express');
// app.engine('html', mustacheExpress()); 
// app.set('view engine', 'html');
// app.set('views', __dirname + '/public');
// app.set('view cache', true);

/*
 * Redirect requests to HTTPS by default and set the HSTS header.
 * You will need to disable or modify this if your demo requires plain HTTP
 */
app.enable('trust proxy');
app.use(function (req, res, next) {
  if (req.secure) {
    res.set('Strict-Transport-Security', 'max-age=63072000; inlcudeSubdomains; preload');
    return next();
  }
  
  res.redirect(301, 'https://' + req.headers.host + req.url);
});

// TODO - if you need any server-side routes, add them here

// By default, fall back to serving from the `public` directory
app.use(express.static('public'));
// Once the demo is published, you may want to add some caching headers
// app.use(express.static('public', { maxAge: '1d' } ));

const listener = app.listen(process.env.PORT, function () {
  console.log('Your app is listening on port ' + listener.address().port);
});
