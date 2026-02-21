# Get User Location + Weather

Small JavaScript project that gets the user’s location from the browser and fetches current weather using WeatherAPI.

## Features

- Request location permission
- Read latitude and longitude
- Show coordinates on screen
- Fetch weather data with those coordinates
- Log API response in console

## Files

- `index.html` – UI
- `script.js` – location + weather logic

## Notes

- Location works only after user permission.
- Geolocation generally needs secure context (`https` or `localhost`).
- API key is hardcoded for learning purpose; use backend env handling in production.
