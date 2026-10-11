# Campus Lost and Found - Frontend

Static single-page app (HTML, CSS, vanilla JavaScript, no build step). It talks to the REST API in the separate repository `campus-lost-found-backend`.

## Run locally

1. Start the backend (`mvn spring-boot:run`, port 8080).
2. Serve this folder on port 5500 (VS Code Live Server, or `python3 -m http.server 5500`).
3. Open http://localhost:5500

## Configure

Edit `js/config.js` and set `API_URL` to your deployed backend URL (no trailing slash).

## Deploy on Netlify

1. Open app.netlify.com, choose Add new site, then Import an existing project, and pick this GitHub repo.
2. Leave the build command empty and set the publish directory to `/` (or `.`). Deploy.
3. Copy the site URL (like `https://your-name.netlify.app`) into the backend's `CORS_ORIGIN` variable.

Routing uses `#/` URLs, so no rewrite rules are needed.
