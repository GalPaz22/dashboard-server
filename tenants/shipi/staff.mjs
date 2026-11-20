import {createHmac,timingSafeEqual} from 'node:crypto';
// Staff token: "<expiresAtMs>.<hex hmac-sha256(secret, 'semantix-staff:'+expiresAtMs)>". The store's plugin issues it
// server-side (PHP) only for a signed-in user whose e-mail is on the staff list, and the shopper's browser sends it back in
// X-Semantix-Staff. The e-mail never leaves the store; this server only checks the signature and the expiry.
// The secret is the environment variable SEMANTIX_STAFF_SECRET (never part of the store config the browser can read).
export const STAFF_HEADER='X-Semantix-Staff';
export const MAX_TOKEN_AGE_MS=24*3600*1000;
const sign=(secret,exp)=>createHmac('sha256',secret).update('semantix-staff:'+exp).digest('hex');
export const issueStaffToken=(secret,ttlMs=12*3600*1000,now=Date.now())=>{const exp=now+ttlMs;return exp+'.'+sign(secret,exp);};
export function isStaffToken(token,secret=process.env.SEMANTIX_STAFF_SECRET,now=Date.now()){
 if(typeof secret!=='string'||secret.length<16||typeof token!=='string'||token.length>200)return false;
 const m=/^(\d{10,14})\.([0-9a-f]{64})$/.exec(token);if(!m)return false;
 const exp=Number(m[1]);if(!(exp>now)||exp-now>MAX_TOKEN_AGE_MS)return false;
 const want=Buffer.from(sign(secret,m[1]),'hex'),got=Buffer.from(m[2],'hex');
 return want.length===got.length&&timingSafeEqual(want,got);
}
