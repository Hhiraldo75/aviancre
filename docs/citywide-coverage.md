# Citywide screening estimates: coverage

Snapshot of 2026-10-25, from `npm run citywide:refresh`. Screening estimate, not an appraisal; method in [UNDERWRITING.md](UNDERWRITING.md#citywide-screening-estimates).
The estimate and ratio counts are at the benchmarks of the refresh; the app recomputes them from the snapshot.

| | Lots |
|---|---:|
| Commercial lots on the 2025 tax roll (5,302 records) | 4,829 |
| No row in the city parcel layer | 85 |
| Left out: no outline and no tax-roll point | 0 |
| In the snapshot | 4,829 |
| With building area | 3,168 (66%) |
| Apartments and mixed use with a unit count | 1,260 of 1,309 |
| **Estimated** | **3,142** (65%) |
| Skipped: Vacant land: no building to rent | 1,547 |
| Skipped: Utility: not priced from market rents | 50 |
| Skipped: The city record has no building area | 90 |

By land use: Commercial (class II) 1,550 · Commercial/industrial vacant land 1,547 · Mixed use, up to 5 units 711 · Apartments, 6–10 units 377 · Industrial 299 · Apartments, 11+ units 132 · Commercial condo 70 · Mixed use, 6–10 units 62 · Utility 50 · Mixed use, 11+ units 27 · Commercial (class I) 4

Office/retail-coded lots estimated: 50 office and 298 retail from OpenStreetMap tags, 1,229 blended (low confidence).
Priced in a submarket: 1,331; at the metro figures: 1,811.

Median estimate ÷ assessed by property type (1.0× vs peers):

| Type | Median | Parcels |
|---|---:|---:|
| Office/retail blend | 1.39× | 1,229 |
| Mixed use | 1.61× | 780 |
| Apartments | 1.54× | 499 |
| Retail | 1.46× | 298 |
| Industrial | 2.22× | 286 |
| Office | 0.60× | 50 |

Map colors, estimate ÷ assessed vs peers:

| Band | Parcels | Share |
|---|---:|---:|
| Well below peers (under 0.75×) | 894 | 28.5% |
| Below peers (0.75–0.90×) | 409 | 13.0% |
| In line with peers (0.90–1.10×) | 488 | 15.5% |
| Above peers (1.10–1.33×) | 492 | 15.7% |
| Well above peers (1.33× or more) | 859 | 27.3% |
| No assessment | 0 | 0.0% |

Sources:

- City of Providence Open Data – 2025 Property Tax Roll: https://data.providenceri.gov/resource/6ub4-iebe.json
- City of Providence ArcGIS Online – Parcels with CAMA (Parcel_Zoning_FL): https://services6.arcgis.com/wv9mHoqblhTsnqdG/arcgis/rest/services/Parcel_Zoning_FL/FeatureServer/0
- City of Providence ArcGIS Online – Providence Neighborhoods: https://services6.arcgis.com/wv9mHoqblhTsnqdG/arcgis/rest/services/Providence_Neighborhoods_(Polygon_Layer)/FeatureServer/0
- OpenStreetMap contributors (ODbL), via the Overpass API: https://overpass-api.de/api/interpreter
