# AI Battle Arena

```text
██████╗  █████╗ ████████╗████████╗██╗     ███████╗     █████╗ ██████╗ ███████╗███╗   ██╗ █████╗ 
 ██╔══██╗██╔══██╗╚══██╔══╝╚══██╔══╝██║     ██╔════╝    ██╔══██╗██╔══██╗██╔════╝████╗  ██║██╔══██╗
 ██████╔╝███████║   ██║      ██║   ██║     █████╗      ███████║██████╔╝█████╗  ██╔██╗ ██║███████║
 ██╔══██╗██╔══██║   ██║      ██║   ██║     ██╔══╝      ██╔══██║██╔══██╗██╔══╝  ██║╚██╗██║██╔══██║
 ██████╔╝██║  ██║   ██║      ██║   ███████╗███████╗    ██║  ██║██║  ██║███████╗██║ ╚████║██║  ██║
 ╚═════╝ ╚═╝  ╚═╝   ╚═╝      ╚═╝   ╚══════╝╚══════╝    ╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝
```

AI Battle Arena is a full-stack app for pitting AI models against each other in a live, judge-driven battle. Users can enter a prompt, optionally attach a file, choose two models, and watch the responses stream in real time while a separate judge scores the outcome.

This project combines a React + Vite frontend with an Express + TypeScript backend powered by LangChain integrations for major model providers.

## Features

- Live model-vs-model battles with streaming output
- Optional file attachment support for prompts
- Judge panel with structured scoring and reasoning
- Multiple rounds (1 or 2)
- Saved battle history and rating metadata
- Shareable battle links
- In-memory fallback mode when MongoDB is not configured

## Tech Stack

- Frontend: React, Vite, Tailwind CSS
- Backend: Node.js, Express, TypeScript, Zod
- AI orchestration: LangChain
- Storage: MongoDB (optional), in-memory store fallback

## Project Structure

- `Backend/` — Express API, model registry, battle orchestration, persistence
- `Frontend/` — Vite React app for the battle UI

## Prerequisites

- Node.js 18 or newer
- npm
- API keys for the models you want to use:
  - Groq
  - Cohere
  - Google Gemini
- Optional: MongoDB connection string for history and sharing

## Setup

### 1) Install backend dependencies

```bash
cd Backend
npm install
```

### 2) Configure environment variables

Create a `.env` file in the `Backend` folder:

```env
PORT=3000
CORS_ORIGIN=http://localhost:5173
GOOGLE_API_KEY=your_google_api_key
GROQ_API_KEY=your_groq_api_key
COHERE_API_KEY=your_cohere_api_key
MONGODB_URI=mongodb://localhost:27017/ai-battle-arena
```

Notes:
- If `MONGODB_URI` is empty, the app still works in memory, but history, sharing, and export features are disabled.
- You can also override pricing values if needed using `PRICE_*` environment variables.

### 3) Start the backend

```bash
cd Backend
npm run dev
```

The server will run on `http://localhost:3000` by default.

### 4) Install frontend dependencies

```bash
cd Frontend
npm install
```

### 5) Start the frontend

```bash
cd Frontend
npm run dev
```

Open `http://localhost:5173` in your browser.

## Available Scripts

### Backend

```bash
cd Backend
npm run dev
```

Runs the TypeScript API in watch mode.

### Frontend

```bash
cd Frontend
npm run dev
npm run build
npm run preview
```

## Usage

1. Open the app in the browser.
2. Choose two models to battle.
3. Enter a prompt or attach a file.
4. Optionally select a judge model and round count.
5. Start the battle and monitor the live streamed responses.
6. Review the final verdict and save or share the result.

## Notes

- Model IDs supported by the current backend include Groq, Cohere, and Gemini.
- The app is designed for experimentation and comparison rather than production deployment without additional hardening.

## License

This project currently uses the default package license for the workspace and is intended for local development and experimentation.
