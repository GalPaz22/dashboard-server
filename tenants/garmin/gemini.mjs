import {GoogleGenAI} from '@google/genai';
let ai;
export async function generate({stage,prompt,schema,signal}){
 const apiKey=process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY;
 if(!apiKey)throw Error('Missing Gemini configuration');ai??=new GoogleGenAI({apiKey});
 const model=stage==='route'?(process.env.GARMIN_ROUTER_MODEL||'gemini-2.5-flash-lite'):(process.env.GARMIN_SEARCH_MODEL||'gemini-2.5-flash');
 const result=await ai.models.generateContent({model,contents:prompt,config:{temperature:0,responseMimeType:'application/json',responseJsonSchema:schema,maxOutputTokens:stage==='route'?600:2400,thinkingConfig:{thinkingBudget:0},abortSignal:signal,httpOptions:{timeout:30000,retryOptions:{attempts:1}}}});
 return {data:JSON.parse(result.text),usage:result.usageMetadata?{inputTokens:result.usageMetadata.promptTokenCount,outputTokens:result.usageMetadata.candidatesTokenCount}:null};
}
