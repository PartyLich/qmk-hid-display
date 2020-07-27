#!/usr/bin/env node
'use strict';

const hid = require('node-hid');
const os = require('os-utils')
const request = require('request');
const batteryLevel = require('battery-level');
const loudness = require('loudness')

// the node-audio-windows version is much faster on windows, but loudness handles other os's better, so let's get the best of both worlds
let winAudio
try {
  winAudio = require('node-audio-windows').volume
} catch (err) {
  // do nothing
}


// Keyboard info
const KEYBOARD_NAME = "Lily58";
const KEYBOARD_USAGE_ID =  0x61;
const KEYBOARD_USAGE_PAGE = 0xFF60;
const KEYBOARD_UPDATE_TIME = 1000;

// Info screen types
const SCREEN_PERF = 0;
const SCREEN_STOCK = 1;
const SCREEN_WEATHER = 2;
const screens = ["", "", ""];
let currentScreenIndex = 0;

let keyboard = null;
let screenBuffer = null;
let screenLastUpdate = null;

// Helper function to wait a few milliseconds using a promise
function wait(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    })
}

async function startPerfMonitor() {
  while (true) {
      const [
        cpuUsagePercent,
        usedMemoryPercent,
        volumeLevelPercent,
        batteryPercent,
      ] = await Promise.all([
        new Promise((resolve) => os.cpuUsage((usage) => resolve(usage * 100))),
        100 - (os.freememPercentage() * 100),
        (os.platform() === 'darwin' ? loudness.getVolume() : winAudio.getVolume() * 100),
        (await batteryLevel()) * 100,
      ])

    const screen = [
      ['CPU:', cpuUsagePercent],
      ['RAM:', usedMemoryPercent],
      ['VOL:', volumeLevelPercent],
      ['BAT:', batteryPercent],
    ]

    const maxTitleSize = Math.max(...screen.map(([header]) => header.length))
    const barGraphSize = 21 - maxTitleSize - 3

    // Set this to be the latest performance info
    screens[SCREEN_PERF] = screen.map(([header, percent], index) => {
      const numBlackTiles = barGraphSize * (percent / 100)
      return `${header} ${'\u0008'.repeat(Math.ceil(numBlackTiles))}${' '.repeat(barGraphSize - numBlackTiles)}|${title(index, 0)}`
    }).join('')

    await wait(KEYBOARD_UPDATE_TIME)
  }
}

async function startStockMonitor() {
    // Set the stocks that we want to show
    const stocks = new Map();
    let counter = 0;
    stocks.set('MSFT', 0);
    stocks.set('TSLA', 0);
    stocks.set('GOOG', 0);
    stocks.set('FB', 0);

    // The regex used to grab the price from the yahoo stocks page
    const priceRegex = /"currentPrice":({[^}]+})/;

    function getStocks() {
        const promises = [];
        for (const [key, value] of stocks) {
            promises.push(new Promise((resolve) => {
                // Get the stock price page for the current stock
                request(`https://finance.yahoo.com/quote/${key}/`, (err, res, body) => {
                    // Parse out the price and update the map
                    const result = priceRegex.exec(body);
                    if (result && result.length > 1) {
                        let price = JSON.parse(result[1]).raw;
                        price = price.toFixed(2);
                        stocks.set(key, price);
                    }
                    resolve();
                });
            }));
        }

        // Wait for all the stocks to be updated
        return Promise.all(promises);
    };

    // Just keep updating the data forever
    while (true) {
        // Get the current stock prices
        if (counter % 10 === 0) {
            await getStocks();
        }
        counter++;

        // Create a screen using the stock data
        const lines = [];
        for (const [key, value] of stocks) {
            const line = `${key.padEnd(5)}: $${value}`;
            lines.push(`${line}${' '.repeat(16 - line.length)}|  ${title(lines.length, 1)} `);
        }

        // Set this to be the latest stock info
        screens[SCREEN_STOCK] = lines.join('');

        // Pause a bit before requesting more info
        await wait(KEYBOARD_UPDATE_TIME);
    }
}

// Get the current weather conditions from yahoo news
function getWeather() {
    // Regex's for reading out the weather info from the yahoo page
    const tempRegex = /"temperature":({[^}]+})/;
    const condRegex = /"conditionDescription":"([^"]+)"/;
    const rainRegex = /"precipitationProbability":([^,]+),/;

    return new Promise((resolve) => {
        const url = `https://www.yahoo.com/news/weather/united-states/st-augustine/st-augustine-12771497`;
        request(url, (err, res, body) => {
            const weather = {};
          try {
            const temp = tempRegex.exec(body);
            weather.temp = JSON.parse(temp[1]);

            const cond = condRegex.exec(body);
            weather.desc = cond[1];

            const rain = rainRegex.exec(body);
            weather.rain = rain[1];

            resolve(weather);
          } catch(err) {
            reject(err);
          }
        });
    });
}

async function startWeatherMonitor() {
    // Used for scrolling long weather descriptions
    let lastWeather = null;
    let lastWeatherDescIndex = 0;

    // Just keep updating the data forever
    while (true) {
      try {
        // Get the current weather for Seattle
        const weather = await getWeather();
            let description = weather.desc;

            // If we are trying to show the same weather description more than once, and it is longer than 9
            // Which is all that will fit in our space, lets scroll it.
            if (lastWeather && weather.desc == lastWeather.desc && weather.desc.length > 9) {
                // Move the string one character over
                lastWeatherDescIndex++;
                description = description.slice(lastWeatherDescIndex, lastWeatherDescIndex + 9);
                if (lastWeatherDescIndex > weather.desc.length - 9) {
                    // Restart back at the beginning
                    lastWeatherDescIndex = -1; // minus one since we increment before we show
                }
            } else {
                lastWeatherDescIndex = 0;
            }
            lastWeather = weather;

            // Create the new screen
            const screen =
                `desc: ${description}${' '.repeat(Math.max(0, 9 - ('' + description).length))} |  ${title(0, 2)} ` +
                `temp: ${weather.temp.now}${' '.repeat(Math.max(0, 9 - ('' + weather.temp.now).length))} |  ${title(1, 2)} ` +
                `high: ${weather.temp.high}${' '.repeat(Math.max(0, 9 - ('' + weather.temp.high).length))} |  ${title(2, 2)} ` +
                `rain: ${weather.rain}%${' '.repeat(Math.max(0, 8 - ('' + weather.rain).length))} |  ${title(3, 2)} `;

            // Set this to be the latest weather info
            screens[SCREEN_WEATHER] = screen;
      } catch (e) {
        // do nothing
      }

        // Pause a bit before requesting more info
        await wait(KEYBOARD_UPDATE_TIME);
    }
}

function title(i, titleIndex) {
    // Return the character that indicates the title part from the font data
    if (i === 3) {
        return '\u00DE';
    }
    return String.fromCharCode((0x9A - titleIndex) + i * 32);
}

async function sendToKeyboard(screen) {
    // If we are already buffering a screen to the keyboard just quit early.
    // Or if there is no update from what we sent last time.
    if (screenBuffer || screenLastUpdate === screen) {
        return;
    }

    screenLastUpdate = screen;

    // Convert the screen string into raw bytes
    screenBuffer = [];
    for (let i = 0; i < screen.length; i++) {
        screenBuffer.push(screen.charCodeAt(i));
    }

    // Split the bytes into 4 lines that we will send one at a time
    // This is to prevent hitting the 32 length limit on the connection
    const lines = [];
    lines.push([0].concat(screenBuffer.slice(0, 21)));
    lines.push([0].concat(screenBuffer.slice(21, 42)));
    lines.push([0].concat(screenBuffer.slice(42, 63)));
    lines.push([0].concat(screenBuffer.slice(63, 84)));

    // Loop through and send each line after a small delay to allow the
    // keyboard to store it ready to send to the slave side once full.
    let index = 0;
    for (const line of lines) {
        if (os.platform() === 'darwin'){
          await wait(100);
        }
        keyboard.write(line);
        if (os.platform() === 'darwin') {
          await wait(100);
        } else {
          await wait(20);
        }
    }

    // We have sent the screen data, so clear it ready for the next one
    screenBuffer = null;
}

function updateKeyboardScreen() {
    // If we don't have a connection to a keyboard yet, look now
    if (!keyboard) {
        // Search all devices for a matching keyboard
        const devices = hid.devices();
        for (const d of devices) {
            if (d.product === KEYBOARD_NAME && d.usage === KEYBOARD_USAGE_ID && d.usagePage === KEYBOARD_USAGE_PAGE) {
                // Create a new connection and store it as the keyboard
                keyboard = new hid.HID(d.path);
                console.log(`Keyboard connection established.`);

                // Listen for data from the keyboard which indicates the screen to show
                keyboard.on('data', (e) => {
                    // Check that the data is a valid screen index and update the current one
                    if (e[0] >= 1 && e[0] <= screens.length) {
                        currentScreenIndex = e[0] - 1;
                        console.log(`Keyboard requested screen index: ${currentScreenIndex}`);
                    }
                });

                // On the initial connection write our special sequence
                // 1st byte - unused and thrown away on windows see bug in node-hid
                // 2nd byte - 1 to indicate a new connection
                // 3rd byte - number of screens the keyboard can scroll through
                keyboard.write([0, 1, screens.length]);
                break;
            }
        }
    }

    // If we have a connection to a keyboard and a valid screen
    if (keyboard && screens[currentScreenIndex].length === 84) {
        // Send that data to the keyboard
        sendToKeyboard(screens[currentScreenIndex]);
    }
}

// Start the monitors that collect the info to display
startPerfMonitor();
startStockMonitor();
startWeatherMonitor();

// Update the data on the keyboard with the current info screen every second
setInterval(updateKeyboardScreen, KEYBOARD_UPDATE_TIME);
