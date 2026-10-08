import "server-only";
import { google } from "googleapis";
import { Readable } from "node:stream";
import { isConfiguredValue } from "@/lib/env-config";

// gmail.compose is the narrowest single Gmail scope that preserves the existing
// explicit draft workflow and also permits sending. No mailbox read/list scope is requested.
export const GMAIL_SEND_SCOPE="https://www.googleapis.com/auth/gmail.compose";
export const GOOGLE_MAIL_SCOPES=["openid","email",GMAIL_SEND_SCOPE] as const;
// drive.file は「このアプリが作ったファイルだけ」を扱える一番狭いドライブ権限。バックアップの保存に使う。
export const DRIVE_FILE_SCOPE="https://www.googleapis.com/auth/drive.file";
export const GOOGLE_ORGANIZATION_SCOPES=[...GOOGLE_MAIL_SCOPES,"https://www.googleapis.com/auth/calendar.events.owned",DRIVE_FILE_SCOPE] as const;

/** 接続時に許可されたスコープに、必要なものが入っていないか。 */
export function isGoogleConnectionScopeMissing(scopes:string[]|null|undefined,scope:string){return !(scopes??[]).includes(scope)}

/** 組織Googleアカウントのドライブ（drive.file の範囲だけ）。 */
export function organizationDrive(refreshToken:string){return google.drive({version:"v3",auth:oauth(refreshToken)})}

export function createGoogleOAuthClient(){
  const clientId=process.env.GOOGLE_CLIENT_ID,clientSecret=process.env.GOOGLE_CLIENT_SECRET,redirectUri=process.env.GOOGLE_REDIRECT_URI;
  if(!isConfiguredValue(clientId)||!isConfiguredValue(clientSecret)||!isConfiguredValue(redirectUri))throw new Error("Google OAuth client is not configured");
  return new google.auth.OAuth2(clientId,clientSecret,redirectUri);
}

function oauth(refreshToken?:string){
  const token=refreshToken??process.env.GOOGLE_REFRESH_TOKEN;
  if(!token)throw new Error("Google OAuth refresh token is not configured");
  const auth=createGoogleOAuthClient();auth.setCredentials({refresh_token:token});return auth;
}
function encodeHeader(value:string){return `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`}
export type GmailMessage={from:string;to:string;cc?:string[];bcc?:string[];subject:string;body:string;refreshToken?:string};
type GmailSendResult={data:{id?:string|null;threadId?:string|null}};
function rawMail(input:GmailMessage){const headers=[`From: ${input.from}`,`To: ${input.to}`];if(input.cc?.length)headers.push(`Cc: ${input.cc.join(", ")}`);if(input.bcc?.length)headers.push(`Bcc: ${input.bcc.join(", ")}`);headers.push(`Subject: ${encodeHeader(input.subject)}`,"MIME-Version: 1.0","Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: base64","",Buffer.from(input.body).toString("base64"));return Buffer.from(headers.join("\r\n")).toString("base64url")}
function legacyMessage(to:string,subject:string,body:string):GmailMessage{const from=process.env.GOOGLE_SHARED_GMAIL;if(!from)throw new Error("GOOGLE_SHARED_GMAIL is not configured");return{from,to,subject,body}}
export async function sendGmail(input:GmailMessage):Promise<GmailSendResult>;
export async function sendGmail(to:string,subject:string,body:string):Promise<GmailSendResult>;
export async function sendGmail(inputOrTo:GmailMessage|string,subject?:string,body?:string){const input=typeof inputOrTo==="string"?legacyMessage(inputOrTo,subject!,body!):inputOrTo;return google.gmail({version:"v1",auth:oauth(input.refreshToken)}).users.messages.send({userId:"me",requestBody:{raw:rawMail(input)}})}
export async function createGmailDraft(input:GmailMessage):Promise<GmailSendResult>;
export async function createGmailDraft(to:string,subject:string,body:string):Promise<GmailSendResult>;
export async function createGmailDraft(inputOrTo:GmailMessage|string,subject?:string,body?:string){const input=typeof inputOrTo==="string"?legacyMessage(inputOrTo,subject!,body!):inputOrTo;return google.gmail({version:"v1",auth:oauth(input.refreshToken)}).users.drafts.create({userId:"me",requestBody:{message:{raw:rawMail(input)}}})}
export function googleAuthorizationUrl(state:string,type:"organization"|"user"){return createGoogleOAuthClient().generateAuthUrl({access_type:"offline",prompt:"consent",include_granted_scopes:false,state,scope:type==="organization"?[...GOOGLE_ORGANIZATION_SCOPES]:[...GOOGLE_MAIL_SCOPES]})}
export async function exchangeGoogleAuthorizationCode(code:string){const client=createGoogleOAuthClient();const {tokens}=await client.getToken(code);client.setCredentials(tokens);const profile=await google.oauth2({version:"v2",auth:client}).userinfo.get();if(!profile.data.email||!tokens.refresh_token)throw new Error("Google did not return an email and refresh token");return{email:profile.data.email.toLowerCase(),refreshToken:tokens.refresh_token,expiresAt:tokens.expiry_date?new Date(tokens.expiry_date).toISOString():null,scopes:(tokens.scope??"").split(" ").filter(Boolean)}}
export function googleDrive(){return google.drive({version:"v3",auth:oauth()})}
export function googlePeople(){return google.people({version:"v1",auth:oauth()})}
export function googleCalendar(refreshToken?:string){return google.calendar({version:"v3",auth:oauth(refreshToken)})}

export async function uploadBusinessCard(file: Buffer, name: string, mimeType: string) {
  const rootId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootId) throw new Error("GOOGLE_DRIVE_FOLDER_ID is not configured");
  const drive=googleDrive(),now=new Date();let folderId=rootId;
  for(const segment of ["名刺",String(now.getFullYear()),String(now.getMonth()+1).padStart(2,"0")]){
    const escaped=segment.replace(/'/g,"\\'");const found=await drive.files.list({q:`name='${escaped}' and '${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,fields:"files(id,name)",pageSize:2,supportsAllDrives:true,includeItemsFromAllDrives:true});
    if(found.data.files?.length)folderId=found.data.files[0].id!;else{const created=await drive.files.create({requestBody:{name:segment,parents:[folderId],mimeType:"application/vnd.google-apps.folder"},fields:"id",supportsAllDrives:true});folderId=created.data.id!}
  }
  return drive.files.create({
    requestBody: { name, parents: [folderId] },
    media: { mimeType, body: Readable.from(file) },
    fields: "id,name,webViewLink",
    supportsAllDrives: true,
  });
}

/** 旧来の共用Google設定（環境変数）が入っているか。本番では未設定。 */
export function isLegacyGoogleConfigured(){return isConfiguredValue(process.env.GOOGLE_REFRESH_TOKEN)&&isConfiguredValue(process.env.GOOGLE_DRIVE_FOLDER_ID)}

/**
 * 名刺画像を組織Googleアカウントのドライブに保存する（drive.file 権限＝このアプリが作ったフォルダとファイルだけ）。
 * 「つながり帳 名刺/年/月」の下に置く。フォルダはアプリが作ったものを appProperties で探す。
 */
export async function uploadBusinessCardToOrganizationDrive(input:{refreshToken:string;clubId:string;file:Buffer;name:string;mimeType:string}){
  const drive=organizationDrive(input.refreshToken),now=new Date();
  const year=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric"}).format(now),month=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",month:"2-digit"}).format(now);
  const folder=async(name:string,key:string,parent?:string)=>{
    const q=`mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='tsunagariCards' and value='${key}' }`;
    const found=await drive.files.list({q,fields:"files(id)",pageSize:1});
    if(found.data.files?.[0]?.id)return found.data.files[0].id;
    const created=await drive.files.create({requestBody:{name,mimeType:"application/vnd.google-apps.folder",parents:parent?[parent]:undefined,appProperties:{tsunagariCards:key}},fields:"id"});
    if(!created.data.id)throw new Error("Drive folder was not created");
    return created.data.id;
  };
  const root=await folder("つながり帳 名刺",`${input.clubId}`);
  const yearFolder=await folder(year,`${input.clubId}/${year}`,root);
  const monthFolder=await folder(month,`${input.clubId}/${year}/${month}`,yearFolder);
  return drive.files.create({requestBody:{name:input.name,parents:[monthFolder]},media:{mimeType:input.mimeType,body:Readable.from(input.file)},fields:"id,name,webViewLink"});
}

export async function createGoogleContact(input: { name: string; company: string; role: string; email: string; phone: string; address: string; website: string }) {
  const people = googlePeople();
  const result = await people.people.createContact({
    personFields: "names,emailAddresses,phoneNumbers,organizations,addresses,urls",
    requestBody: {
      names: [{ displayName: input.name }],
      emailAddresses: input.email ? [{ value: input.email }] : [],
      phoneNumbers: input.phone ? [{ value: input.phone }] : [],
      organizations: input.company || input.role ? [{ name: input.company, title: input.role }] : [],
      addresses: input.address ? [{ formattedValue: input.address }] : [],
      urls: input.website ? [{ value: input.website }] : [],
    },
  });
  return result.data;
}

export async function findGoogleContactByEmail(email:string){
  const people=googlePeople(),readMask="names,emailAddresses";
  await people.people.searchContacts({query:"",readMask,pageSize:1});
  const result=await people.people.searchContacts({query:email,readMask,pageSize:10});
  return result.data.results?.map(x=>x.person).find(person=>person?.emailAddresses?.some(item=>item.value?.toLowerCase()===email.toLowerCase()))??null;
}

export async function createCalendarFollowup(input: { summary: string; description: string; start: string; end: string; refreshToken?: string }) {
  // 組織Googleアカウントの接続があればそのカレンダー（primary）へ。無ければ旧来の共用設定。
  const calendarId = input.refreshToken ? "primary" : (process.env.GOOGLE_CALENDAR_ID ?? "primary");
  return googleCalendar(input.refreshToken).events.insert({
    calendarId,
    sendUpdates: "none",
    requestBody: {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start, timeZone: "Asia/Tokyo" },
      end: { dateTime: input.end, timeZone: "Asia/Tokyo" },
    },
  });
}

export async function listOrganizationCalendarEvents(input:{refreshToken:string;timeMin:string;timeMax:string}){
  return googleCalendar(input.refreshToken).events.list({
    calendarId:"primary",
    timeMin:input.timeMin,
    timeMax:input.timeMax,
    singleEvents:true,
    orderBy:"startTime",
    showDeleted:false,
    maxResults:250,
  });
}

export async function createOrganizationCalendarEvent(input:{refreshToken:string;summary:string;description:string;location:string;start:string;end:string;allDay?:boolean}){
  const start=input.allDay?{date:input.start.slice(0,10)}:{dateTime:input.start,timeZone:"Asia/Tokyo"};
  const end=input.allDay?{date:input.end.slice(0,10)}:{dateTime:input.end,timeZone:"Asia/Tokyo"};
  return googleCalendar(input.refreshToken).events.insert({
    calendarId:"primary",
    sendUpdates:"none",
    requestBody:{summary:input.summary,description:input.description,location:input.location,start,end},
  });
}
