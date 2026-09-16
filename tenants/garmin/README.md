# Garmin module

`processor.mjs` exports `processGarmin(raw)` and `garminProfile(previous, products)`. `profile.json` contains the current generated tenant policy. The module derives internal search attributes for series, display, solar charging, music storage, materials and size while preserving source badges. Attributes are not display badges.

Music storage is established by an explicit Music model name or affirmative product specification. Square-screen recognition is restricted to Venu Sq. Accessories and treatment plans do not receive watch-family attributes.

This commit only supplies the tenant processor and policy. It does not register a production route, change database bindings, import a catalog, or update the shared search core. The serving pipeline must support `tagDefinitions` and enforce their tags as filters before enabling this tenant. No Studio credentials or catalog data are included.
