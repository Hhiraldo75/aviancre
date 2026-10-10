# Deploying AVIANCRE

AVIANCRE deploys as a static Vite site plus one serverless function on Vercel's
free (Hobby) plan, from a public GitHub repo. `vercel.json` holds all the settings;
no environment variables are needed.

- **City GIS relay:** `api/pvdgis.ts` runs in Vercel's `iad1` (Washington, D.C.)
  region. `vercel.json` rewrites `/pvdgis/*` to it, so the app uses the same URLs as
  the Vite dev proxy. It forwards only the Providence GIS layer queries the app
  sends and caches good answers for 5 minutes.
- **Unlisted:** every response carries `X-Robots-Tag: noindex, nofollow`, and
  `index.html` has the matching meta tag. There is deliberately no `robots.txt`
  Disallow, because crawlers must be able to fetch a page to see its noindex.
- **Private deals are never deployed.** Git ignores `private-deals/`, and nothing
  in `src/` imports it. Deals imported in the app stay in that browser's local storage.

## 1. Pre-flight (every time, before pushing)

```bash
npm test                 # includes npm run check-private
npm run build            # type check + production build
git ls-files             # review: nothing from private-deals/ except its README
git log --all -i -G'<deal name or id>' --oneline   # for each private deal: must print nothing
git log --all --format='%ae %ce' | sort -u          # only your GitHub noreply address
```

## 2. Create the public GitHub repo (first time)

With the GitHub CLI (`gh auth login` first):

```bash
gh repo create aviancre --public --source . --remote origin --push
```

Or on github.com: **New repository** → name `aviancre`, Public, no README, license or
.gitignore → then:

```bash
git remote add origin https://github.com/<you>/aviancre.git
git push -u origin main
```

## 3. Connect Vercel (first time)

1. On vercel.com, sign in with GitHub. Then **Add New… → Project**, and import `aviancre`.
2. Leave the settings as detected. `vercel.json` sets Vite, `npm run build` and `dist`.
   Add no environment variables.
3. Click **Deploy**. After that, each push to `main` deploys to production.

## 4. Verify the deployment

```bash
APP=https://<project>.vercel.app
curl -sI $APP | grep -i x-robots-tag        # x-robots-tag: noindex, nofollow
curl -s "$APP/pvdgis/server/rest/services/Viewpoint_Base/MapServer/14/query?geometry=-71.4128,41.824&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=PIN&returnGeometry=false&outSR=4326&f=geojson" | head -c 300   # GeoJSON with a PIN
curl -s -o /dev/null -w '%{http_code}\n' "$APP/pvdgis/server/rest/services/Viewpoint_Base/MapServer/14/applyEdits?f=geojson"   # 400
```

Then open the site, click a building outside the sample set, and check that the
parcel card shows zoning and flood zone alongside the tax roll.

## Notes

- Vercel's Hobby plan is for personal, non-commercial use.
- If `src/services/providenceGis.ts` starts using a new GIS layer or query
  parameter, add it to the allowlist in `api/pvdgis.ts`.
  `src/services/pvdgisRelay.test.ts` fails until you do.
- `VITE_PVD_GIS_URL` overrides the GIS base URL at build time, for example to use a
  different relay. It is not needed on Vercel.
