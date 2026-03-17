# PrepForge — Deployment Guide

## What's in this folder

```
prepforge/
├── src/
│   ├── App.jsx        ← The full app
│   ├── main.jsx       ← React entry point
│   └── index.css      ← iOS-optimised global styles
├── public/
│   ├── favicon.svg
│   ├── apple-touch-icon.png   ← iOS home screen icon
│   ├── pwa-192x192.png
│   └── pwa-512x512.png
├── index.html
├── package.json
├── vite.config.js     ← Vite + PWA config
├── vercel.json        ← Vercel deploy config
└── README.md
```

---

## Option A — Deploy to Vercel (recommended, free)

### Prerequisites
- [Node.js 18+](https://nodejs.org) installed on your computer
- A free [Vercel account](https://vercel.com)

### Steps

**1. Install dependencies**
```bash
cd prepforge
npm install
```

**2. Test locally first (optional)**
```bash
npm run dev
```
Open http://localhost:5173 in your browser to verify everything works.

**3. Build for production**
```bash
npm run build
```

**4. Deploy with Vercel CLI**
```bash
npm install -g vercel
vercel
```
Follow the prompts — accept all defaults. Vercel will give you a URL like:
`https://prepforge-abc123.vercel.app`

**5. Share with your group**
Send anyone the URL. They open it in Safari on iPhone and tap:
> Share → Add to Home Screen → Add

PrepForge installs as a fullscreen app icon on their home screen.

---

## Option B — Deploy via Vercel Dashboard (no CLI)

1. Go to [vercel.com](https://vercel.com) and sign in
2. Click **Add New → Project**
3. Drag and drop the entire `prepforge` folder, OR connect your GitHub repo
4. Vercel auto-detects Vite — click **Deploy**
5. Done. Share the URL.

---

## Option C — Deploy to Netlify (alternative)

```bash
npm install -g netlify-cli
npm run build
netlify deploy --prod --dir=dist
```

---

## Updating the app

Whenever you make changes to `src/App.jsx`:
```bash
npm run build
vercel --prod
```
The app updates instantly for all users — no reinstall needed on their devices.

---

## iOS Install Instructions (send to your users)

1. Open the link in **Safari** (not Chrome)
2. Tap the **Share** button (box with arrow at the bottom)
3. Scroll down and tap **Add to Home Screen**
4. Tap **Add** in the top right
5. PrepForge now appears on your home screen as a full-screen app

---

## Troubleshooting

**"Module not found" error on build**
Run `npm install` again before building.

**App looks wrong on iPhone**
Make sure you're using Safari, not Chrome or Firefox, for the Add to Home Screen step.

**Fonts not loading**
The app uses Google Fonts (DM Sans + Bebas Neue). An internet connection is needed on first load; after that the PWA caches them.
