// One merchant's response policy. Search ranking, opening rules and time budgets are independent.
import {isSteimatzky} from './concierge.mjs';
export const STEIMATZKY_RESPONSE_POLICY = `## כללי תשובה מחייבים — סטימצקי
המטרה היא לפתור את הבקשה של הלקוח, לא להציג מוצר בכל מחיר. כללים אלה גוברים על הנחיה כללית להציע תמיד חלופה או להציג תמיד כרטיס.
1. כשהלקוח מבקש ספר מסוים, חפש קודם את הספר עצמו לפי כותר ומחבר, גם כשאינו במלאי. אם מצאת אותו, פתח בשם המדויק ובמצב המלאי שאומת. הבדל כתיב קטן אינו סיבה לומר שלא נמצא. הבחן בין לא נמצא בחיפוש, לא קיים בקטלוג, מוסתר ואזל; היעדר תוצאות לבדו אינו הוכחת חוסר מלאי.
2. בקשה בלי חלופות היא מגבלה מחייבת, גם בהודעות הבאות: אין להציע, להזכיר או להציג ספר אחר, עד שהלקוח מבקש שוב חלופות במפורש. כששואלים מתי הספר יחזור ואין מידע, אמור שאין מידע מאומת על מועד החזרה והפנה לשירות הלקוחות באתר. אל תמציא מועד, הבטחה או התראה. תשובה כזאת יכולה וצריכה להסתיים בלי כרטיס מוצר.
3. כשלא ברור מה מחפשים — למשל שם אדם שלא זוהה, קטע כותר או מילה עמומה — שאל שאלה קצרה אחת שמבררת את החסר. אין צורך לבחור מוצר לפני ההבהרה. אל תפרק שם אדם למילים כדי להציע ספרים של אנשים אחרים.
4. חלופה צריכה לשמור על האילוצים החשובים: סוג מוצר (משחק אינו ספר), מחבר או סדרה כשהם מבוקשים, יעד טיול, גיל, שפה וכרך. דמיון במילה אחת בכותר או באותו ז׳אנר רחב אינו נימוק להתאמה. מדריך לטנזניה אינו מדריך לברלין; ספר על אוקיינוסים אינו כל ספר על בעלי חיים. אם אין חלופה מתאימה, אמור זאת וסיים בלי קריאה ל-present_products.
5. הצע חלופות רק כשהלקוח פתוח להן וכשיש קשר מבוסס בתיאור או בקטגוריה. אם הסוג/המחבר/המטרה אינם מאומתים, שאל לפני ההצעה. אל תמלא מכסה ואל תציג את אותה חלופה אחרי שנדחתה.
6. לפני המלצה, קרא את המידע בכלי באותה הודעה. present_products יכיל רק מוצרים שהוחזרו מהכלים בהודעה הזאת, גלויים ובמלאי. בשאלה מבררת או בתשובת שירות סיים בלי קריאה ל-present_products ולא משפט שמוכר מוצר בלי כרטיס.
7. כתוב בקצרה ובאופן ענייני. אל תתאר מוצר כ״מדהים״, ״מתאים בדיוק״ או ״נהדר״ כשלא בדקת התאמה. אל תאמר ״אנחנו חנות ספרים ולכן אין״ — בקטלוג יש גם משחקים, צעצועים וציוד יצירה.
`;
const text = s => String(s||'').normalize('NFKC').replace(/[\u0591-\u05C7]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const saysNo = s => /(?:ולא|בלי|לא רוצה|לא מעוניי?נ(?:ת)?|לא מחפש(?:ת)?)\s*(?:ב|עוד\s+)?(?:תחליפ(?:ים)?|תחליף|חלופ(?:ה|ות))/u.test(text(s))
 || /(?:רק|דווקא)\s+(?:את\s+)?(?:הספר|הכותר|המוצר)\s+(?:הזה|המסוים|המקורי)/u.test(text(s))
 || /מתעקש.{0,65}(?:דבר מה אחר|משהו אחר|חלופ|תחליפ)/u.test(text(s));
const accepts = s => /(?:בעצם|כן|אפשר|תציע|הצע|רוצה|מעוניי?נ(?:ת)?)\s+(?:לי\s+|ב)?(?:חלופ(?:ה|ות)|תחליפ(?:ים)?|תחליף)/u.test(text(s)) && !saysNo(s);
const userText = h => h?.role==='user' ? h.text ?? h.content ?? h.message ?? (h.parts||[]).map(p=>p.text||'').join('\n') : '';
export function steimatzkyTurnPolicy(p,{message,history=[],trigger}={}){
 if(!isSteimatzky(p))return null;
 let alternativesAllowed=true;
 for(const s of [...history.map(userText),message].filter(Boolean)){
  if(saysNo(s))alternativesAllowed=false;else if(accepts(s))alternativesAllowed=true;
 }
 const query=String(trigger?.query||'').trim();
 const combined=text(query+' '+(message||''));
 const game=/\bgame\b|(?:^|\s)משחק(?:ים)?(?:\s|$)/u.test(combined);
 const guide=combined.match(/מדרי(?:ך|כי)\s+טיול(?:ים)?\s+(?:ל)?([א-ת]{3,})(?:\s|$)/u);
 const destination=guide&&!/ישראל|טיול|ילד|ספר|למטייל|מעשי|לימוד|למטפלים|ישראלי/.test(guide[1])?guide[1]:null;
 const restockQuestion=!alternativesAllowed&&/מתי|יחזור|יהיה זמין|חזרה למלאי/u.test(text(message));
 return {alternativesAllowed,query,game,destination,restockQuestion};
}
export function steimatzkyTextOnly(policy){
 return policy?.restockQuestion?'אין לי מידע מאומת על מועד החזרה של הספר למלאי. לבדיקת זמינות ומועד חזרה אפשר לפנות לשירות הלקוחות של סטימצקי באתר. אשאר עם הספר שביקשת, בלי חלופות.':null;
}
const words = s => text(s).replace(/[^\p{L}\p{N}]+/gu,' ').split(' ').filter(Boolean);
const withoutArticle = w => w.length>=4&&w[0]==='ה'?w.slice(1):w;
export function directlyNamesProduct(query,p){
 const q=words(query).map(withoutArticle),title=words(p?.title||p?.name).map(withoutArticle);
 if(q.length<2||q.length/title.length<.65)return false;
 return q.every(w=>title.includes(w)||w.length>=4&&title.some(t=>t===w||t.length===w.length+1&&t.slice(1)===w));
}
export function steimatzkyCardAllowed(p,policy){
 if(!p||p.hidden===true||(p.in_stock !== true && p.stockStatus !== 'instock'))return false;
 if(!policy)return true;
 if(!policy.alternativesAllowed&&!directlyNamesProduct(policy.query,p))return false;
 const hay=text([p.title||p.name,...(p.categories||[]),...(p.tags||[]),p.description||'',p.type||''].join(' '));
 if(policy.game&&!/משחק|\bgame\b/u.test(hay))return false;
 if(policy.destination&&!hay.includes(policy.destination))return false;
 return true;
}
