# GramCare AI — Product Context

## Identity
**Name:** GramCare AI  
**Tagline:** Say what's wrong. We'll send help.  
**Role:** Educational healthcare prototype for rural and weak-connectivity communities.

## What it does
A browser-based healthcare access tool backed by a portable C HTTP server (`server.c`). Users can:
- Request ambulance or doctor/ASHA help via voice (Hindi/English) or typed input, with offline queuing when the network is down
- Check vital signs (heart rate, SpO₂, temperature) and get NORMAL / REVIEW / URGENT attention flags
- Create and list patient records
- Browse a demo medicine/health store with prescription-locked items
- View emergency alerts with demo ETA tracking
- Use the site fully offline via a service worker (`sw.js`) that precaches core assets

## Target users
- Residents of rural areas with weak or unavailable internet (primary: India — Hindi/English bilingual, emergency numbers 112/108)
- ASHA workers and community health volunteers
- Anyone needing basic digital health support without reliable connectivity

## Technical constraints
- Backend: single-file C HTTP server, port 8080, Windows (winsock2) + Linux/macOS compatible
- Frontend: vanilla HTML/CSS/JS, no build step, service worker for offline mode
- Static files served from `public/`
- Must run on `http://localhost:8080` or HTTPS (service worker requirement)
- Educational prototype — not medical advice, not a real emergency service

## Design mode
**Primary: Operate** — visitors complete tasks (request help, check vitals, register patients, browse store). Scanability, consistency, native affordances, and real-world usage (rural, low connectivity) outrank expression.  
**Secondary: Persuade** — the hero section earns trust and action ("Say what's wrong. We'll send help.").

## Current design direction (this session)
- Palette: coffee stained ivory, warm parchment, dark espresso, roasted coffee, faded bronze, soft cream
- Vibe: old school, warm, grounded, trustworthy — parchment-and-ink aesthetic appropriate for rural healthcare
- Scope: rearrange and improve frontend for best appeal, preserve all product truth, content, functions, and technical constraints
