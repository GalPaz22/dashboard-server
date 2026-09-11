import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';
let ai;
export async function generate({stage,prompt,schema,signal}){
  const apiKey=process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY;
  if(!apiKey)throw Error('Missing Gemini configuration');
  ai??=new GoogleGenAI({apiKey});
  const model=stage==='route'?(process.env.BEAUTICS_ROUTER_MODEL||'gemini-2.5-flash-lite'):(process.env.BEAUTICS_PILOT_MODEL||'gemini-2.5-flash');
  const result=await ai.models.generateContent({model,contents:prompt,
    config:{responseMimeType:'application/json',responseJsonSchema:schema,temperature:0,maxOutputTokens:stage==='route'?600:stage==='select'?2400:1200,thinkingConfig:{thinkingBudget:0},abortSignal:signal,httpOptions:{retryOptions:{attempts:1}}}});
  return {data:JSON.parse(result.text),usage:result.usageMetadata?{inputTokens:result.usageMetadata.promptTokenCount,outputTokens:result.usageMetadata.candidatesTokenCount}:null};
}
