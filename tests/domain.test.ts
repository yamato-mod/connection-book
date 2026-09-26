import { describe, expect, it } from "vitest";
import { contactSchema, findDuplicates, mailSchema, renderTemplate } from "../src/lib/domain";

const base={name:"田中 美咲",company:"瀬戸内ベンチャーズ",role:"パートナー",email:"tanaka@example.jp",phone:"087-123-4567",address:"",website:"",notes:""};

describe("human-reviewed contact validation",()=>{
  it("requires a valid email before mail processing",()=>{expect(contactSchema.safeParse({...base,email:"OCR-error"}).success).toBe(false)});
  it("accepts corrected contact input",()=>{expect(contactSchema.safeParse(base).success).toBe(true)});
});

describe("club-wide duplicate checks",()=>{
  it("treats exact email as a strong duplicate",()=>{expect(findDuplicates({...base,email:"TANAKA@example.jp"},[base])[0]).toMatchObject({strength:"strong",reason:"email"})});
  it("warns on normalized phone",()=>{expect(findDuplicates({...base,email:"other@example.jp",phone:"0871234567"},[base])[0]).toMatchObject({strength:"possible",reason:"phone"})});
  it("warns on normalized name and company",()=>{expect(findDuplicates({...base,email:"other@example.jp",phone:"",name:"田中　美咲"},[{...base,phone:""}])[0]).toMatchObject({reason:"name_company"})});
});

describe("mail safety contract",()=>{
  const valid={contactId:"4b83d4a9-f7d3-43ad-ae39-7735f8de7549",recipientEmail:"tanaka@example.jp",subject:"御礼",body:"ありがとうございました",templateId:null,eventId:null,classification:"courtesy" as const,confirmedRecipient:true as const,confirmationToken:"12345678901234567890.token",idempotencyKey:"e249f0ee-e21a-49fe-b889-97203c38b450",duplicateOverride:false,duplicateOverrideReason:null};
  it("only accepts the courtesy classification",()=>{expect(mailSchema.safeParse({...valid,classification:"important"}).success).toBe(false)});
  it("requires explicit recipient confirmation",()=>{expect(mailSchema.safeParse({...valid,confirmedRecipient:false}).success).toBe(false)});
  it("requires an override reason after a duplicate warning",()=>{expect(mailSchema.safeParse({...valid,duplicateOverride:true}).success).toBe(false)});
  it("accepts one reviewed message",()=>{expect(mailSchema.safeParse(valid).success).toBe(true)});
});

it("renders known template variables without generating prose",()=>{expect(renderTemplate("{{recipient_name}}様\n{{sender_signature}}",{recipient_name:"田中",sender_signature:"森岡"})).toBe("田中様\n森岡")});
