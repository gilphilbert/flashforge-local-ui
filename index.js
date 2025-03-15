var path = require('path')
const ffapi = require(path.resolve( __dirname, './ffapi.js' ))

var express = require("express");
const { json } = require('stream/consumers');
var app = express()
var expressWs = require('express-ws')(app);

app.use(express.static('public'))

app.ws('/', function(ws, req) {
  ffapi.setCallback((jsonData) => {
    ws.send(jsonData)
  })
});

app.get('/api/info', (req, res) => {
  const status = ffapi.get.info()
  res.send("{ status: " + status + "}")
})

app.get('/api/status', (req, res) => {
  const status = ffapi.get.status()
  res.send("{ status: " + status + "}")
})

app.get('/api/progress', (req, res) => {
  const status = ffapi.get.progress()
  res.send("{ status: " + status + "}")
})

app.get('/api/temperatures', (req, res) => {
  const status = ffapi.get.temperatures()
  res.send("{ status: " + status + "}")
})

app.get('/api/files', (req, res) => {
  const status = ffapi.get.files()
  res.send("{ status: " + status + "}")
})

app.put('/api/toggle_led', (req, res) => {
  ffapi.set.ledToggle()
  res.send("{ status: \"done\" }")
})

app.get('/api/homeXY', (req, res) => {
  console.log('homingxy')
  ffapi.move.homeXY()
})

app.get('/api/homeZ', (req, res) => {
  console.log('homingz')
  ffapi.move.homeZ()
})

app.get('/api/print/:fullPath', (req, res) => {
  console.log(req.params.fullPath)
  ffapi.files.print(req.params.fullPath)
})

//app.get('/api/delete/:fullPath', (req, res) => {
//  console.log(req.params.fullPath)
//  ffapi.files.delete(req.params.fullPath)
//})

app.get('/api/preheat/:filament', (req, res) => {
  const filament = req.params.filament
  const filaments = ['abs', 'petg', 'pla', 'tpu', 'off']
  if (filaments.includes(filament)) {
   ffapi.printer.preheat(filament)
  }
  res.send('{ status: "done" }')
})

app.get('/api/extrude', (req, res) => {
  // need to check temperature! could use wait?
  ffapi.extrude();
  res.send('{ status: "done" }')
})


app.get('/api/retract', (req, res) => {
  // need to check temperature! could use wait?
  ffapi.retract();
  res.send('{ status: "done" }')
})

/*
app.get('/api/setRelativePosition/:x/:y/:z', (req, res) => {
  ffapi.move.relative({ x: req.params.x, y: req.params.y, z: req.params.z })
})
*/

app.listen(3000);