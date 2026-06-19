# PrimeSA_Bot — Session Generator (Animated README)

[![Generate Pair Code](https://img.shields.io/badge/Generate%20Pair%20Code-Click%20Here-brightgreen?style=for-the-badge)]([https://primesa_bot-paircode.onrender.com](https://primesa-bot-26.onrender.com
))

This README has been redesigned to showcase an animated preview and to use the new project naming: "PrimeSA_Bot" (internal name: `primesa_bot`). Replace the placeholder animation assets with your own files to get a live animated preview.

---

Animated preview (local):

- Add a short GIF named `preview-animation.gif` to the project root and it will be displayed here as the animated header.

![Animated Preview](preview-animation.gif)

---

Quick Start

1) Create a Mega.nz account
  [![MEGA - Create Account](https://img.shields.io/badge/MEGA-Create%20Account-red?logo=mega&logoColor=white)](https://mega.nz)

2) Paste your credentials in `mega.js`
  Open `mega.js` and update `email` and `password`:

```js
// mega.js
const auth = {
  email: 'your-email@domain.com',
  password: 'your-strong-password',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246'
};
```

3) Deploy to Render
  [![Render - Deploy](https://img.shields.io/badge/Render-Deploy%20Web%20Service-46E3B7?logo=render&logoColor=white)](https://render.com)
  - Push this project to your Git repository (GitHub/GitLab)
  - On Render: New ➜ Web Service
  - Environment: Node
  - Runtime: Node 20
  - Build Command: `npm install`
  - Start Command: `npm start`
  - Click Create Web Service

---

Branding and animation examples

Images (logo):
- Place your `logo.png` in the project root. In `pair.html`, replace the logo block and use the updated alt/title for accessibility:

```html
<div class="logo">
  <img src="logo.png" alt="PrimeSA_Bot" style="width:100%;height:100%;border-radius:50%" />
</div>
```

Animated header (simple CSS float)
- Add this inside the `<style>` of `pair.html` to create a subtle floating animation for the logo. This gives the page a lightweight animated feel that reads well in the README preview when exported as a GIF.

```css
@keyframes float {
  0% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
  100% { transform: translateY(0); }
}
.logo { animation: float 2.4s ease-in-out infinite; }
```

Lottie / advanced animations
- For richer vector animations, export a Lottie JSON and use a small web player in `pair.html`. Convert a looped Lottie preview to `preview-animation.gif` for the README if you want the GitHub preview to show it inline.

Fonts
- In the `<head>` of `pair.html`, add Google Fonts for Inter or any preferred font:

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
```

Notes
- All occurrences of the old project name were updated in this document:
  - "Mathithibala Bot" → "PrimeSA_Bot"
  - `mathithibala-bot` → `primesa_bot`

If you want the README header to actually animate on GitHub, include an animated GIF (`preview-animation.gif`) in the repo root and it will render inline. Replace the placeholder GIF with your exported animation from the web preview.

Happy pairing! 🚀

