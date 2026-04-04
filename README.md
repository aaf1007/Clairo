<div align="center">
  <img src="extension/public/verifai/light-mode.png" alt="VerifAI" width="280" />
  <p><em>AI-powered fact-checking, right in your browser.</em></p>
</div>

---

VerifAI is a Chrome extension that lets you fact-check any text on the web instantly. Highlight a claim, right-click, and get a sourced verdict in seconds — powered by Groq for claim extraction and Google Gemini with Search Grounding for verification.

## How It Works

1. Highlight any text on a webpage
2. Right-click → **VerifAI: Verify Text**
3. The popup opens and shows a verdict with per-claim breakdowns and sources

## Project Structure

| Directory | Description |
|-----------|-------------|
| [`extension/`](extension/) | Chrome extension — WXT + React + TypeScript |
| [`server/`](server/) | FastAPI backend — Python, Groq, Gemini |

## Quick Start

### Backend

```bash
cd server
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # Add GROQ_API_KEY and GEMINI_API_KEY
uvicorn app.main:app --reload
```

### Extension

```bash
cd extension
npm install
npm run dev
```

Then open `chrome://extensions` → Developer mode → Load unpacked → select `extension/.output/chrome-mv3-dev/`.

## API Keys

- **Groq** — [console.groq.com](https://console.groq.com) (claim extraction + Whisper transcription)
- **Gemini** — [aistudio.google.com](https://aistudio.google.com) (fact verification with Search Grounding)
