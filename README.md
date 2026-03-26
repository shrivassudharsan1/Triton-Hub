# Triton-Hub

<img width="1512" height="820" alt="image" src="https://github.com/user-attachments/assets/52664a68-e5ac-4c13-9bcc-74cf445553e2" />

A full-stack web application that aggregates **Canvas** and **Gmail** data into a unified student dashboard — with an integrated LLM layer that intelligently parses and surfaces the most relevant information.

---

## Features

- 📚 View UCSD Canvas grades, assignments (due/incomplete and completed), and announcements
- 📧 Gmail integration with smart email filtering
- 🤖 **LLM-powered data parsing** — intelligently processes and structures Canvas and Gmail data for better readability and prioritization
- 🔐 OAuth and manual token authentication support

---

## My Contribution

I integrated a large language model (LLM) pipeline into the backend to parse and interpret raw Canvas and Gmail API responses. Rather than displaying raw data, the LLM layer:

- Extracts actionable insights from assignment descriptions and announcements
- Filters and ranks emails by relevance using a deterministic pre-filter before passing to the model (reducing unnecessary API calls)
- Structures unstructured data into clean, student-friendly summaries

---

## Quick Start

### Manual Token (no setup)

1. Run `npm run dev`
2. Go to **Canvas → Settings → Approved Integrations** and create a new access token
3. Paste the token (and Canvas URL) into the app

### Log in with Canvas (OAuth)

You'll need a Canvas Developer Key from your institution (e.g. UCSD admin).

1. Copy `.env.example` to `.env` and configure:
```
   CANVAS_CLIENT_ID=<Developer Key client ID>
   CANVAS_CLIENT_SECRET=<Developer Key client secret>
   CANVAS_BASE_URL=https://canvas.ucsd.edu
   OAUTH_REDIRECT_URI=http://localhost:5173/oauth/callback
```
2. Add the redirect URI to your Canvas Developer Key settings
3. Start the OAuth server: `npm run server`
4. Start the app: `npm run dev`
5. Click **Log in with Canvas** and complete the flow

---

## Tech Stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** Python (LLM integration), Node.js (OAuth server)
- **APIs:** Canvas LMS API, Gmail API
- **LLM:** Integrated for intelligent data parsing and summarization

---

## Project Structure
```
├── frontend/       # React + TypeScript UI
├── backend/        # Python LLM pipeline + API handlers
└── triton-hub/     # Core application logic
```
