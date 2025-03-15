//const printerIp = "192.168.50.7"
let printerIP = ""

let connectionStats = {
  controlRequested: false,
  lastResponse: 0,
  lastResponseInterval: false
}

let current = {
  machineStatus: '',
  currentBytes: 0,
  currentFile: '',
}

const net = require('net')
var ON_DEATH = require('death'); //this is intentionally ugly

//interval handler for reconnecting
var intervalConnect = false
const socket = new net.Socket()

//keeps the connection to the printer alive and provides regular updates
let intervalKeepAlive = false

//used to fire callbacks after control is obtained
let controlCallback = false

//this is the "send" callback to send out messages to the attached user (from Express)
let callback;

//set the callback (need to publish this function)
const setCallback = (cb) => {
  callback = cb;
}

//send function (calls thw callback...)
const send = (data) => {
  if (callback) {
    callback(JSON.stringify(data))
  }
}


//settings
const settings = require("settings-store")
settings.init({
  appName:       "FFLocalUI", //required,
  publisherName: "gilphilbert", //optional
  reverseDNS:    "com.gilphilbert.ffui" //required for macOS
})


socket.on('connect', () => {
  clearIntervalConnect()
  console.log("Connected to printer")
  
  //sendCommand(commands.get_control, 'S0')

  connectionStats.lastResponse = Date.now()
  intervalKeepAlive = setInterval(() => {
    get.progress()
    if (Date.now() - connectionStats.lastResponse > 5000) {
      console.log("haven't heard from printer in 5 seconds, restarting connection")
      socket.end()
    }
  }, 1000);
}).on('data', (buf) => {
  connectionStats.lastResponse = Date.now()

  let lines = buf.toString().split('\r\n')

  while (lines.length > 0) {
    cmdLine = lines.shift().split(' ')

    if (cmdLine.length > 0 && cmdLine[0] == 'CMD') {
      switch(cmdLine[1]) {
        case commands.info:
          _machine = {}
          _machine['type'] = lines.shift().split(':')[1].trim()
          _machine['name'] = lines.shift().split(':')[1].trim()
          _machine['firmware'] = lines.shift().split(':')[1].trim()
          _machine['serial'] = lines.shift().split(':')[1].trim()
          _machine['bed'] = {}
          _machine['bed']['x'] = lines[0].split(':')[1]
          _machine['bed']['y'] = lines[0].split(':')[2]
          _machine['bed']['z'] = lines.shift().split(':')[3]
          _machine['toolcount'] = lines.shift().split(':')[1].trim()
          _machine['macaddress'] = lines.shift().trim().split(':').slice(1).join(':')
          _machine['ip'] = printerIP
          lines.shift() //'ok'
          lines.shift() //''
          send({ info: _machine })
          break
        case commands.status:
          _status = { 'endstop': { 'x-max': 0, 'y-max': 0, 'z-min': 0 } }
          _es = lines.shift().split(' ')
          _status['endstop']['x-max'] = parseInt(_es[2])
          _status['endstop']['y-max'] = parseInt(_es[4])
          _status['endstop']['z-min'] = parseInt(_es[6])
          
          _status['machinestatus'] = lines.shift().split(' ')[1]
          _status['movemode'] = lines.shift().split(' ')[1]
          _status['status'] = {}
          _status['status']['s'] = parseInt(lines[0].split(' ')[1].split(':')[1]) // printing status? ready status?
          _status['status']['l'] = parseInt(lines[0].split(' ')[2].split(':')[1]) // ?
          _status['status']['j'] = parseInt(lines[0].split(' ')[3].split(':')[1]) // ?
          _status['status']['f'] = parseInt(lines[0].split(' ')[4].split(':')[1]) // filament runout sensor? // finished?
          lines.shift()
    
          _status['led'] = parseInt(lines.shift().split(' ')[1])
          _status['currentfile'] = lines.shift().split(':')[1].trim()
          lines.shift() //'ok'
          lines.shift() //''
          send({ status: _status })
          break
        case commands.progress:
          _progress = {}
          _b = lines.shift().trim().split(' ')[3].split('/')
          _progress['bytes'] = { current: _b[0], total: _b[1] }
          _l = lines.shift().trim().split(' ').pop().split('/')
          _progress['layers'] = { current: _l[0], total: _l[1] }
          lines.shift() //'ok'
          lines.shift() //''
          send({ progress: _progress })

          get.temperatures()

          if (current.currentBytes != _progress.bytes.current) {
            current.currentBytes = _progress.bytes.current
            setTimeout(() => get.status(), 100) //wait 100ms then request status, prevents colliding with temperatures
          }
        break
        case commands.temperatures:
          _temp = { 'hotend_left': {}, 'hotend_right': {}, 'bed' : {} }
          _temp['hotend_left']['current'] = lines[0].split(' ')[0].split(':')[1].split('/')[0]
          _temp['hotend_left']['target'] = lines[0].split(' ')[0].split(':')[1].split('/')[1]
          _temp['hotend_right']['current'] = lines[0].split(' ')[1].split(':')[1].split('/')[0]
          _temp['hotend_right']['target'] = lines[0].split(' ')[1].split(':')[1].split('/')[1]
          _temp['bed']['current'] = lines[0].split(' ')[2].split(':')[1].split('/')[0]
          _temp['bed']['target'] = lines[0].split(' ')[2].split(':')[1].split('/')[1]
          lines.shift() //'ok'
          lines.shift() //''
          send({ temperatures: _temp })
          break
        case commands.files:
          let files = []
          //first line is 'ok'
          lines.shift()
          //'::' is the file deliniator
          let  _files = lines.shift().split('::')
           //first is garbage (just the letter D!)
          _files.shift()
          //trim the nonsense from the files and resolve
          send({ files: _files.map(file => file.trim().substring(file.trim().indexOf('/data'))) })
          break
        case commands.get_control.substring(0, commands.get_control.indexOf(' ')):
          console.log(lines)
          response = lines[0]
          if (response !== "Control failed.") {
            if (controlCallback) {
              console.log("found callback, calling...")
              controlCallback()
              console.log("clearing callback")
              controlCallback = false
            }
            //console.log("logging out")
            sendCommand(commands.logout)
          } else {
            //we should probably count retries here and not just try forever
            sendCommand(commands.logout)
            sendCommand(commands.get_control)
          }
          break
        default:
          console.log(lines)
      }
    }
  }
}).on('end', () => {
  console.log("Connection to printer::ENDED")
  clearInterval(intervalKeepAlive)
  intervalKeepAlive = false
}).on('close', () => {
  console.log("Connection to printer::CLOSED")
  launchIntervalConnect()
  clearInterval(intervalKeepAlive)
  intervalKeepAlive = false
}).on('error', (e) => {
  console.log(e)
  launchIntervalConnect()
  clearInterval(intervalKeepAlive)
  intervalKeepAlive = false
})

function connect() {
  socket.connect({ port: 8899, host: printerIP })
}

function launchIntervalConnect() {
  if (intervalConnect) return
  intervalConnect = setInterval(connect, 5000)
}

function clearIntervalConnect() {
  if (!intervalConnect) return
  clearInterval(intervalConnect)
  intervalConnect = false
}

function setIP(ipaddress) {
  printerIP = ipaddress
}

//connect()

commands = {
  //get info
  progress: 'M27',
  temperatures: 'M105',
  info: 'M115',
  status: 'M119',
  files: 'M661',

  get_control: 'M601 S1',
  logout: 'M602',

  //set stuff
  moveEnd: 'G1', //USAGE:: G1 F200 E3  <-- sets speed and volume. this is 3mm slowly. use negative values for retraction
  home: 'G28', // USAGE:: G28 [X] [Y] [Z]
  positioning_absolute: 'G90',
  positioning_relative: 'G91',
  set_position: 'G92', // USAGE::    G92 [X] [Y] [Z] [E]      (optionally set X, Y, Z or E - for example, ~G92 X5)
  enable_steppers: 'M17', //enables all steppers
  disable_steppers: 'M18', //disables all steppers
  select_file: 'M23', // USAGE:: M23 /user/file.gcode  <-- include the file to write
  start_print: 'M24', // can also be used to resume a paused print
  pause_print: 'M25',
  delete_file: 'M30', // USAGE:: M30 /user/file.gcode  <-- include file path to delete  /////////////////////////////////// doesn't work!!!
  print_time: 'M31',
  tool_temperature: 'M104', // USAGE:: M104 S220 T0  <-- sets t0 to 220C
  fan_speed: 'M106', // USAGE:: M106 S127  <--  sets fan to 50% (enables fan if not on). Use P0 for hotend, P1 for case fan
  disable_fan: 'M107',
  emergency_stop: 'M112',
  lcd_message: 'M117', // USAGE M117 text message goes here
  bed_temperature: 'M140', // USAGE:: M140 S50  <-- sets bed to 50C
  led_control: 'M146', //undocumented, but toggles the output, need to work out where it's installed
  filament_runout: 'M412', // USAGE:: M140 S50  <-- sets bed to 50C

  start_write: 'M28', //USAGE: M28 <filename>    <--- eg M28 temp.gcode
  end_write: 'M29',

  //custom
  extrude: 'G1 F200 E80',
  retract: 'G1 F200 E-60'
}

//led control: Change LED colour: 'M146 r<red> g<green> b<blue> f0', where <> are numbers 0-255.

//To print from file: 'M650', 'M28 <file size> 0:/user/<file name>', encode the file with base64 and then send 4096 bytes each time, 'M29', 'M23 0:/user/<file name>'
//Update; To send a file with TCP socket to Finder:
// Do not encode with base64, still send 4096 bytes at a time but add 16 bytes at the start
// - The first four bytes should be 0x5a, 0x5a, 0xa5, 0xa5
// - Next four bytes should be a four byte unsigned big endian counter starting at 0
// - Next four bytes should be a four byte unsigned big endian data length (4096, except last packet)
// - The last four bytes should be a big endian CRC32 of the data for that packet
// The last packet has to be padded with 0x00 until the data length is 4096 bytes. The CRC is for the data without padding.

function sendCommand(cmd, control) {
  if (control) {
    controlCallback = () => {
      console.log("running actual command")
      sendCommand(cmd)
    }
    console.log("requesting control")
    socket.write('~' + commands.get_control)
  } else {
    retVal = socket.write("~" + cmd + "\r\n")
    return retVal
  }
}

const get = {
  info: () => {
    return sendCommand(commands.info)
  },
  status: () => {
    return sendCommand(commands.status)
  },
  progress: () => {
    return sendCommand(commands.progress)
  },
  temperatures: () => {
    return sendCommand(commands.temperatures)
  },
  files: () => {
    return sendCommand(commands.files)
  }
}

/*
const move = {
  relative: (positions) => {
    let moveString = ""
    if (positions.x != 0) {
      moveString += "X" + positions.x
    }
    if (positions.y != 0) {
      if (moveString != "") moveSrting += " "
      moveString += "Y" + positions.y
    }
    if (positions.z != 0) {
      if (moveString != "") moveSrting += " "
      moveString += "Z" + positions.z
    }
    sendCommand(commands.moveEnd, moveString)
  },
  homeXY: () => {
    sendCommand(commands.home, 'X Y')
  },
  homeZ: () => {
    sendCommand(commands.home, 'Z')
  }
}
*/

const set = {
  ledToggle: () => {
    //controlCallback = () => {
    //  sendCommand(commands.led_control)
    //}
    //console.log('requesting control')
    //sendCommand(commands.get_control) 
    sendCommand(commands.led_control, true)
  }
}

//both of these require control access
const setTemp = {
  hotend: (targetTemp) => {
    console.log('setting callback for tool temperature')
    controlCallback = () => {
      console.log('setting tool temperature')
      sendCommand(`${commands.tool_temperature} S${targetTemp}`)
    }
    console.log('requesting control')
    sendCommand(commands.get_control) 
  },
  bed: (targetTemp) => {
    controlCallback = () => {
      console.log('setting bed temperature')
      sendCommand(commands.bed_temperature + ` S${targetTemp}`)
    }
    sendCommand(commands.get_control)
  }
}

//both of these require control access
const extrude = function() {
  //how to send both of these in one go?
  controlCallback = () => {
    sendCommand(commands.positioning_relative)
    sendCommand(commands.extrude)  
  }
  sendCommand(commands.get_control) 
}
const retract = function() {
  controlCallback = () => {
    sendCommand(commands.positioning_relative)
    sendCommand(commands.retract)  
  }
  sendCommand(commands.get_control) 
}

//both of these require control access
const files = {
  print: (fullPath) => {
    controlCallback = () => {
      sendCommand(commands.select_file + ' ' + fullPath)
      sendCommand(commands.start_print)
    }
    sendCommand(commands.get_control)
  },
  delete: (fullpath) => { //non functional
    controlCallback = () => {
      sendCommand(commands.delete_file + ' 0:/user' + fullpath) // '0:/user'
    }
    sendCommand(commands.get_control)
  }
}

const printer = {
  preheat: function (filament) {
    let bed = 0
    let hotEnd = 0
    switch (filament) {
      case 'abs':
        hotEnd = 240
        bed = 90
        break
      case 'petg':
        hotEnd = 240
        bed = 80
        break
      case 'pla':
        hotEnd = 210
        bed = 50
        break
      case 'tpu':
        hotEnd = 220
        bed = 60
        break
    }
    console.log('setting callback for preheat')
    controlCallback = () => {
      //sendCommand(`${commands.tool_temperature} S${hotEnd}`)
      sendCommand(`${commands.bed_temperature} S${bed}`)
    }
    console.log('requesting control')
    sendCommand(commands.get_control) 
  }
}

module.exports = {
  get,
  set,
  //move,
  files,
  setTemp,
  setCallback,
  extrude,
  retract,
  printer,
  connect,
  setIP
}

/* states

	STATE_UNKNOWN = 0
	STATE_READY = 1
	STATE_BUILDING = 2
	STATE_SD_BUILDING = 3
	STATE_SD_PAUSED = 4
	STATE_HOMING = 5
	STATE_BUSY = 6
	STATE_WAIT_ON_TEMP = 7

*/
ON_DEATH(function(signal, err) {
  sendCommand(commands.logout)
  //this is super simple, but the printer usually responds in under 500ms, so this should be fine
  setTimeout(() => {
    process.exit()
  }, 500)
})