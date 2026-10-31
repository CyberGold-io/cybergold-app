import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import { backendRoute } from "../server/backend-client.ts";
import { withEnvironment } from "../../tests/fixtures/environment.mts";
import { fetchEconomicQuoteStream } from "./economicQuotes.ts";

test("real HTTP fixed facade forwards split ready frames before completion and propagates caller disconnect",{timeout:15000},async()=>{
  let upstreamClosed!:()=>void,ready!:()=>void;
  const closed=new Promise<void>(resolve=>{upstreamClosed=resolve;}),first=new Promise<void>(resolve=>{ready=resolve;});
  let producerCompleted=false;
  const upstream=createServer(async(request,response)=>{
    let input="";for await(const chunk of request)input+=chunk;
    assert.equal(JSON.parse(input).inputs[0].amount,"100");assert.equal(request.headers.authorization,"Bearer fixture-private");
    response.on('close',upstreamClosed);response.writeHead(200,{'content-type':'application/x-ndjson','cache-control':'no-store','x-accel-buffering':'no'});
    const frame=JSON.stringify({type:'qualified',value:{quotedOutput:'12'}})+'\n';
    response.write(frame.slice(0,17));setImmediate(()=>{if(!response.destroyed)response.write(frame.slice(17));});
    // Lifecycle remains deliberately open until the downstream caller stops.
    response.on('finish',()=>{producerCompleted=true;});
  });
  const facade=createServer(async(request,response)=>{
    const controller=new AbortController();response.on('close',()=>controller.abort());
    try{
      const init:RequestInit&{duplex:'half'}={method:request.method,headers:{'content-type':'application/json'},
        body:Readable.toWeb(request)as unknown as BodyInit,duplex:'half',signal:controller.signal};
      const result=await backendRoute('/api/economic-quotes/stream')(new Request(`http://fixture.invalid${request.url}`,init));
      response.writeHead(result.status,Object.fromEntries(result.headers));
      if(result.body)for await(const chunk of Readable.fromWeb(result.body as never))response.write(chunk);
      response.end();
    }catch{response.destroy();}
  });
  await new Promise<void>(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  await new Promise<void>(resolve=>facade.listen(0,'127.0.0.1',resolve));
  try{await withEnvironment({CYBERGOLD_BACKEND_URL:`http://127.0.0.1:${(upstream.address()as AddressInfo).port}`,CYBERGOLD_BACKEND_BEARER_TOKEN:'fixture-private'},async()=>{
    const abort=new AbortController();
    const promise=fetchEconomicQuoteStream({intent:0,inputs:[{currency:'0x0000000000000000000000000000000000000002',amount:'100'}],outputCurrency:'0x0000000000000000000000000000000000000003'},abort.signal,
      event=>{assert.equal(event.type,'qualified');if(event.type==='qualified')assert.equal(event.value.quotedOutput,'12');ready();},false,
      ((path,options)=>fetch(`http://127.0.0.1:${(facade.address()as AddressInfo).port}${path}`,options))as typeof fetch);
    const stopped=assert.rejects(promise,{name:'AbortError'});await first;assert.equal(producerCompleted,false);abort.abort();await stopped;await closed;
  });}finally{
    facade.closeAllConnections();upstream.closeAllConnections();
    await Promise.all([new Promise<void>(resolve=>facade.close(()=>resolve())),new Promise<void>(resolve=>upstream.close(()=>resolve()))]);
  }
});
