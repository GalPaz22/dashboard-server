# Semantix tenant module — carmella (carmella)

Revision 9, 8355 product cards, built 2026-09-25T07:55:48.663Z.

## Install into dashboard-server (once for all Semantix tenants)

Copy `tenants/carmella/` and `tenants/semantix-registry.mjs` into dashboard-server, and in server.js next to the Garmin routes:

```js
import {createSemantixTenants} from './tenants/semantix-registry.mjs';
const semantixTenants=createSemantixTenants({getDb:async name=>(await getMongoClient()).db(name)});
app.get('/semantix/status',(req,res)=>semantixTenants.statusRoute(req,res));
```

and put `semantixTenants.search` first on `app.post("/search", …)` and `semantixTenants.loadMore` first on `app.get("/search/load-more", …)`.

## Switching on and off in production

- Control document (no restart, read every 15 s): `semantix.tenant_modules` → `{_id:"carmella", enabled:true, percent:100}`. `enabled:false` switches back to the existing search; `percent:10` sends 10% of sessions to this module. Tenant Studio's “שליטה בפרודקשן” panel writes this document.
- Without a control document: `SEMANTIX_TENANTS=carmella` switches it on.
- `SEMANTIX_OFF=1` switches every Semantix tenant off (restart).
- Failures fall back to the existing search; 5 failures in a minute pause the tenant for 5 minutes.
- `GET /semantix/status` with header `X-Semantix-Admin: $SEMANTIX_ADMIN_TOKEN` shows each tenant's state, revision, source of the decision, circuit and counters.

Requests for store dbName `carmella` are answered by this module. Pagination tokens start with `carmella-v3:`; sessions live in `semantix_carmella_sessions`. Live price/stock/visibility come from the `products` collection every minute; enriched cards come from snapshot.json — re-export after changes in the studio.
