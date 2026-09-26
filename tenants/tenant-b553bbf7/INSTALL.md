# Semantix tenant module — ביוטיקס שופ (tenant-b553bbf7)

Revision 4, 3418 product cards, built 2026-09-25T14:00:46.026Z.

## Install into dashboard-server (once for all Semantix tenants)

Copy `tenants/tenant-b553bbf7/` and `tenants/semantix-registry.mjs` into dashboard-server, and in server.js next to the Garmin routes:

```js
import {createSemantixTenants} from './tenants/semantix-registry.mjs';
const semantixTenants=createSemantixTenants({getDb:async name=>(await getMongoClient()).db(name)});
app.get('/semantix/status',(req,res)=>semantixTenants.statusRoute(req,res));
```

and put `semantixTenants.search` first on `app.post("/search", …)` and `semantixTenants.loadMore` first on `app.get("/search/load-more", …)`.

## Switching on and off in production

- Control document (no restart, read every 15 s): `semantix.tenant_modules` → `{_id:"tenant-b553bbf7", enabled:true, percent:100}`. `enabled:false` switches back to the existing search; `percent:10` sends 10% of sessions to this module. Tenant Studio's “שליטה בפרודקשן” panel writes this document.
- Without a control document: `SEMANTIX_TENANTS=tenant-b553bbf7` switches it on.
- `SEMANTIX_OFF=1` switches every Semantix tenant off (restart).
- Failures fall back to the existing search; 5 failures in a minute pause the tenant for 5 minutes.
- `GET /semantix/status` with header `X-Semantix-Admin: $SEMANTIX_ADMIN_TOKEN` shows each tenant's state, revision, source of the decision, circuit and counters.

Requests for store dbName `woo-beautics-shop-co-il` are answered by this module. Pagination tokens start with `tenant-b553bbf7-v3:`; sessions live in `semantix_tenant_b553bbf7_sessions`. Live price/stock/visibility come from the `products` collection every minute; enriched cards come from snapshot.json — re-export after changes in the studio.
