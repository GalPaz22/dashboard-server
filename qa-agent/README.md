# QA Agent — בדיקת איכות חיפוש ותיקון שורשי

סוכן שבודק את איכות החיפוש אצל כל לקוח פעיל, שופט עם מודל אם התוצאות טובות,
ומאבחן **תיקון שורשי אוניברסלי** לכל כשל — בלי הארדקוד של רשימות מילות-מפתח.

## דרישות
- השרת (`server.js`) צריך לרוץ מקומית (ברירת מחדל `http://localhost:8080`, לפי `PORT` ב-`.env`).
  אם כבוי: `./start-with-restart.sh`.
- `.env` בשורש הפרויקט עם `MONGODB_URI` ו-`ANTHROPIC_API_KEY` (כבר קיימים).

## שלב 1 — הרצת בדיקה (read-only, לא כותב ל-DB)
```bash
node qa-agent/run.mjs                      # כל הלקוחות הפעילים
node qa-agent/run.mjs --stores manoVino    # לקוח יחיד
node qa-agent/run.mjs --stores manoVino --limit 8
```
נוצר `qa-agent/reports/<timestamp>/` עם `report.md` (קריא) ו-`report.json` (למכונה).

מקורות השאילתות פר-לקוח: חיפושים אחרונים (`queries`), שאילתות נפוצות, ומוצרים פופולריים (`product_clicks`).

## שלב 2 — אישור והחלה
בדוק את `report.md`. סמן תיקונים לאישור באחת משתי דרכים:
- ערוך `report.json` וקבע `"approved": true` בתיקונים הרצויים, ואז:
  ```bash
  node qa-agent/apply.mjs qa-agent/reports/<ts>/report.json --all-approved --commit
  ```
- או ציין IDs ישירות:
  ```bash
  node qa-agent/apply.mjs qa-agent/reports/<ts>/report.json --approve manoVino-001,manoVino-004 --commit
  ```
בלי `--commit` זו הרצת יבש (מדפיסה before/after בלי לכתוב).

## מנופי תיקון
| מנוף | מה משתנה | הוחל אוטומטית |
|------|----------|----------------|
| `context_rule` | `users.users.context` — הוראת NL אוניברסלית ל-LLM | כן |
| `product_retag` | `<db>.products` — `category/type/softCategory` של מוצרים ספציפיים | כן |
| `config_change` | `credentials.softCategories/categories/type/colors/softCategoryBoosts` | כן |
| `algorithm` | שינוי בקוד החיפוש ב-`server.js` | **לא** — TODO ידני |

## בטיחות
- `run.mjs` לעולם לא כותב ל-DB.
- כל כתיבה ב-`apply.mjs --commit` מגובה קודם ל-`backup.json` (revert אפשרי).
- אידמפוטנטי: תיקון שכבר הוחל מדולג.
- שינוי קונפיג נכנס לתוקף תוך ~5 דק' (TTL של store-config cache ב-server.js).

## Revert ידני
`backup.json` מכיל את הערך הקודם לכל תיקון (`scope`, `apiKey`/`store`, `previous`) — ניתן לשחזר ידנית דרך mongosh במידת הצורך.
