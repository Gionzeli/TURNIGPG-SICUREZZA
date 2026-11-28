const ID = /^[A-Za-z0-9_-]{1,128}$/;
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
/** Default-off, bounded, injected scheduler; no Firebase trigger wiring. */
export function createMailboxScheduleIngestionScheduledHandler({enabled=false,listEnabledAccountIds,compositionForAccount}) {
 if(enabled!==true) return Object.freeze({enabled:false,async run(){fail("failed-precondition","Mailbox ingestion schedule is disabled.");}});
 if(typeof listEnabledAccountIds!=="function"||typeof compositionForAccount!=="function") throw new TypeError("Enabled scheduler requires account discovery and composition factories.");
 return Object.freeze({enabled:true,async run({accountLimit=25,connectionLimit=20}={}) {
  if(!Number.isSafeInteger(accountLimit)||accountLimit<1||accountLimit>50||!Number.isSafeInteger(connectionLimit)||connectionLimit<1||connectionLimit>100) fail("invalid-argument","Scheduled ingestion batch limits are invalid.");
  const accounts=await listEnabledAccountIds({limit:accountLimit});
  if(!Array.isArray(accounts)||accounts.length>accountLimit||accounts.some(id=>typeof id!=="string"||!ID.test(id))||new Set(accounts).size!==accounts.length) fail("failed-precondition","Scheduled account list is malformed.");
  const results=[];
  for(const accountId of accounts) try {
   const composition=await compositionForAccount({accountId});
   if(!composition||composition.enabled!==true||typeof composition.run!=="function"){results.push({status:"disabled"});continue;}
   const run=await composition.run({accountId,limit:connectionLimit});
   if(!Array.isArray(run)) fail("failed-precondition","Worker summary is invalid.");
   results.push({status:"completed",connectionResults:run.length});
  } catch { results.push({status:"failed"}); }
  return Object.freeze({accountCount:accounts.length,results:Object.freeze(results)});
 }});
}
