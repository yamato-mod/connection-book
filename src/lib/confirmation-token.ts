import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

type Payload={userId:string;contactId:string;email:string;expiresAt:number};
const secret=()=>{const value=process.env.MAIL_CONFIRMATION_SECRET;if(!value||value.length<32)throw new Error("MAIL_CONFIRMATION_SECRET must be at least 32 characters");return value};
const sign=(value:string)=>createHmac("sha256",secret()).update(value).digest("base64url");
export function issueConfirmationToken(payload:Payload){const encoded=Buffer.from(JSON.stringify(payload)).toString("base64url");return `${encoded}.${sign(encoded)}`}
export function verifyConfirmationToken(token:string,expected:Omit<Payload,"expiresAt">){const [encoded,signature]=token.split(".");if(!encoded||!signature)return false;const actual=sign(encoded);if(signature.length!==actual.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(actual)))return false;try{const payload=JSON.parse(Buffer.from(encoded,"base64url").toString()) as Payload;return payload.expiresAt>Date.now()&&payload.userId===expected.userId&&payload.contactId===expected.contactId&&payload.email===expected.email}catch{return false}}
