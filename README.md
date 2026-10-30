# GramCare AI

GramCare AI is a healthcare access tool for rural and weak-connectivity communities. It works offline and helps users request emergency assistance, check vital signs, manage patient records, and browse a medicine catalogue.

## Features

- **Emergency assistance**: Request ambulance or doctor/ASHA help via voice or text, with offline queuing
- **Vital signs check**: Assess heart rate, SpO₂, and temperature with clinical attention flags
- **Patient records**: Create and manage patient records
- **Medicine store**: Browse a catalogue of medicines and health devices
- **Offline mode**: Service worker caches the site for use without internet
- **Bilingual**: English and Hindi support

## Run the server

### Windows
```bash
start.bat
```
Or manually:
```bash
gcc server.c -o gramcare.exe -lws2_32
./gramcare.exe
```

### Linux/macOS
```bash
./start.sh
```
Or manually:
```bash
gcc server.c -o gramcare
./gramcare
```

Then open: http://localhost:8080

## Project structure

- `server.c` - main server
- `public/index.html` - browser interface
- `public/style.css` - styling
- `public/app.js` - application logic
- `public/sw.js` - service worker for offline mode
- `public/manifest.json` - PWA manifest
- `start.sh` / `start.bat` - startup scripts

## Important

This is an educational prototype. It does not diagnose, prescribe, contact real doctors/ambulances, or process real medicine purchases. In a real emergency, call 112 or 108.

## Offline mode

The service worker stores the site while online and serves it when offline. Press "Update offline copy" on the site to refresh the cached version.
