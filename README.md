# GramCare AI - C-major rebuild

This version keeps HTML/CSS/JavaScript only for the browser UI and moves the main demo application logic to a portable C HTTP/API server.

## Features handled by C
- Vital-sign validation and NORMAL / REVIEW / URGENT attention flags
- Patient record validation, creation and listing
- Medicine catalogue API and prescription lock metadata
- Emergency alert creation and demo ETA response
- HTTP server and static-file delivery

## Run on Windows (VS Code + GCC / MSYS2)
Open the VS Code terminal in this folder and run:

```bash
gcc server.c -o gramcare.exe -lws2_32
./gramcare.exe
```

Then open: http://localhost:8080

## Run on Linux/macOS
```bash
gcc server.c -o gramcare
./gramcare
```
Then open http://localhost:8080

## Project structure
- `server.c` - main C backend/server
- `public/index.html` - browser structure
- `public/style.css` - responsive modern styling
- `public/app.js` - thin browser bridge to C APIs
- `original_reference.html` - your uploaded original for reference

## Important
This is an educational prototype. It does not diagnose, prescribe, contact real doctors/ambulances, or process real medicine purchases.

## Offline mode, data meter and voice help (v2)
- `public/sw.js` stores the site while online and serves it when offline. Bump `V` in `sw.js` after you change any file, or press "Update offline copy" on the site.
- The Data section shows internet used, data served offline, device storage, and "Simulate no network" for demos. Sizes are response bodies, so they are approximate.
- Voice help: Chrome/Edge speech recognition needs internet. Offline, use the quick buttons or typed box. Requests are queued on the phone and sent automatically when the network returns.
- Service workers need `http://localhost:8080` or HTTPS.
