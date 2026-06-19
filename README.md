# **Knight Bot Session Generator**

[![Generate Pair Code](https://img.shields.io/badge/Generate%20Pair%20Code-Click%20Here-brightgreen?style=for-the-badge)](https://knight-bot-paircode.onrender.com)

---

### Quick Start

- **1) Create a Mega.nz account**  
  [![MEGA - Create Account](https://img.shields.io/badge/MEGA-Create%20Account-red?logo=mega&logoColor=white)](https://mega.nz)

- **2) Paste your credentials in `mega.js`**  
  Open `mega.js` and update `email` and `password`:

```js
// mega.js
const auth = {
  email: 'your-email@domain.com',
  password: 'your-strong-password',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246'
};
```

- **3) Deploy to Render**  
  [![Render - Deploy](https://img.shields.io/badge/Render-Deploy%20Web%20Service-46E3B7?logo=render&logoColor=white)](https://render.com)
  - Push this project to your Git repository (GitHub/GitLab)
  - On Render: New ➜ Web Service
  - Environment: Node
  - Runtime: Node 20
  - Build Command: `npm install`
  - Start Command: `npm start`
  - Click Create Web Service

---

### Branding (images, animation, fonts)

- **Images (logo)**: Place your `logo.png` in the project root. In `pair.html`, replace the logo block with your image:

```html
<div class="logo">
  <img src="logo.png" alt="Knight Bot" style="width:100%;height:100%;border-radius:50%" />
</div>
```

- **Animation (subtle float)**: Add inside the `<style>` of `pair.html`:

```css
@keyframes float { from { transform: translateY(0) } 50% { transform: translateY(-4px) } to { transform: translateY(0) } }
.logo { animation: float 2.4s ease-in-out infinite; }
```

- **Fonts**: In the `<head>` of `pair.html`, add Google Fonts for Inter:

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
```

Your original button link remains unchanged above. 🚀


