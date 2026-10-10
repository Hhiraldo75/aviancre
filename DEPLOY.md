# Deploying AVIANCRE

AVIANCRE deploys as a static Vite site on Vercel's free (Hobby) plan, from a
public GitHub repo. `vercel.json` holds all the settings; there are no serverless
functions and no environment variables.

- **Public data, straight from the browser:** the Providence Open Data tax roll,
  the city's ArcGIS Online `Parcel_Zoning_FL` (parcels, zoning, overlay and
  historic districts) and RIGIS's FEMA flood layer all allow cross-site requests,
  so the deployed site needs nothing in between.
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
Q='geometry=-71.4128,41.824&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&f=geojson'
curl -s -D - -H "Origin: $APP" "https://services6.arcgis.com/wv9mHoqblhTsnqdG/arcgis/rest/services/Parcel_Zoning_FL/FeatureServer/0/query?$Q&outFields=PIN" | grep -iE 'access-control-allow-origin|"PIN"'   # *, and a PIN
curl -s -D - -H "Origin: $APP" "https://services2.arcgis.com/S8zZg9pg23JUEexQ/arcgis/rest/services/PLAN_DFIRM_Statewide_Flood_Hazard_Areas_2022/FeatureServer/1/query?$Q&outFields=FLD_ZONE" | grep -iE 'access-control-allow-origin|FLD_ZONE'   # *, and FLD_ZONE
```

Then open the site, click a building outside the sample set, and check that the
parcel card shows zoning, overlay districts and flood zone alongside the tax roll.

## Notes

- Vercel's Hobby plan is for personal, non-commercial use.
