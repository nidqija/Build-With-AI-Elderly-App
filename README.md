# Create a Caption for Your Photos

A straightforward, mobile-friendly web app designed for older adults that turns uploaded photos into four heartfelt, ready-to-share caption options.

## Main Workflow

1. **Choose up to 10 photos** (JPG, PNG, WebP, or GIF, up to 10 MB per photo) with previews and a clearly labelled **Remove** button for each.
2. **Tell us about these photos.** (Optional context field so the AI includes real details without inventing names, places, or events).
3. **Create captions** — examines all uploaded photos together and returns four distinct options displayed vertically:
   - *Simple and warm*
   - *Heartfelt and reflective*
   - *Cheerful and light*
   - *Short and sweet*
4. **Copy this caption** — copies the chosen caption and confirms with **“Caption copied.”**
5. **Create more captions** — generates four fresh caption options while retaining your uploaded photos and notes.

## Visual & Accessibility Design

- Square corners everywhere (`border-radius: 0`) on buttons, inputs, photo previews, and caption cards.
- High-contrast dark text (`#111111`) on a plain light background (`#FFFFFF` / `#F7F5F0`) with a single restrained deep-navy accent colour (`#1B365D`).
- Large typography, generous spacing, full-width rectangular buttons with clear text labels, and no animations, gradients, carousels, or icon-only controls.

## Setup & Running Locally

### 1. Install dependencies

```powershell
npm install
```

### 2. Configure your AI API key (Server-Side)

Copy `.env.example` to `.env` in the project root and set at least one vision-capable provider API key:

```ini
GEMINI_API_KEY=your_gemini_api_key_here
```

*(Alternatively, you can set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in `.env`.)*

- API credentials remain strictly server-side (handled by `/api/captions` in `server/captionsHandler.js`).
- Uploaded photos are processed transiently in memory and never stored on disk or in a database.
- If no API key is configured, the app displays a clear, honest configuration error and never disguises mock output as real results.

### 3. Start the development server

```powershell
npm run dev
```

### 4. Production build & server

```powershell
npm run build
npm start
```
