const ALLOWED = new Set(["gmail_api", "microsoft_graph"]);
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export function createMailboxTokenLifecycleCoordinator({ vault, refreshService, leaseService, now = () => Date.now() }) {
  if (!vault || typeof vault.loadSecret !== "function" || typeof vault.storeSecret !== "function" ||
      !refreshService || typeof refreshService.refresh !== "function") {
    throw new TypeError("Mailbox token lifecycle dependencies are required.");
  }
  if (leaseService && (typeof leaseService.acquire !== "function" ||
      typeof leaseService.renew !== "function" || typeof leaseService.release !== "function")) {
    throw new TypeError("Mailbox refresh lease service is invalid.");
  }
  const inFlight = new Map();
  return Object.freeze({
    async ensureFresh({accountId,connectionId,provider,secretRef,clientId,clientSecret,tenant}) {
      if (!accountId || !connectionId || !secretRef || !ALLOWED.has(provider)) {
        const error=new Error("Token lifecycle input is invalid."); error.code="invalid-argument"; throw error;
      }
      const lockKey=`${accountId}/${connectionId}`;
      if(inFlight.has(lockKey)) return inFlight.get(lockKey);
      const operation=(async()=>{
        let lease;
        try {
          const load=async()=>{
            let value;
            try { value=await vault.loadSecret({secretRef}); }
            catch { const error=new Error("Mailbox credential unavailable."); error.code="reauth-required"; throw error; }
            if(!value || typeof value.accessToken!=="string" || value.accessToken.length<16) {
              const error=new Error("Mailbox credential unavailable."); error.code="reauth-required"; throw error;
            }
            return value;
          };
          let stored=await load();
          if(Number.isSafeInteger(stored.expiresAt) && stored.expiresAt>now()+REFRESH_SKEW_MS) {
            return Object.freeze({status:"active",accessToken:stored.accessToken,expiresAt:stored.expiresAt,refreshed:false});
          }
          if(leaseService) {
            try { lease=await leaseService.acquire({accountId,connectionId,ttlMs:120_000}); }
            catch { const error=new Error("Mailbox refresh coordination is unavailable."); error.code="unavailable"; throw error; }
            // Re-read under the lease: a competing instance may have refreshed after our first read.
            stored=await load();
            if(Number.isSafeInteger(stored.expiresAt) && stored.expiresAt>now()+REFRESH_SKEW_MS) {
              return Object.freeze({status:"active",accessToken:stored.accessToken,expiresAt:stored.expiresAt,refreshed:false});
            }
          }
          if(typeof stored.refreshToken!=="string" || stored.refreshToken.length<16) {
            const error=new Error("Mailbox requires reauthentication."); error.code="reauth-required"; throw error;
          }
          let fresh;
          try { fresh=await refreshService.refresh({provider,refreshToken:stored.refreshToken,clientId,clientSecret,tenant}); }
          catch(error) {
            if(error?.code==="invalid-argument") throw error;
            const e=new Error("Mailbox requires reauthentication or retry.");
            e.code=error?.code==="unavailable"?"unavailable":"reauth-required"; throw e;
          }
          if(!fresh || typeof fresh.accessToken!=="string" || fresh.accessToken.length<16 ||
             !Number.isSafeInteger(fresh.expiresInSeconds) || fresh.expiresInSeconds<1 ||
             fresh.expiresInSeconds>31_536_000 ||
             (fresh.refreshToken!=null && (typeof fresh.refreshToken!=="string" || fresh.refreshToken.length<16))) {
            const error=new Error("Mailbox provider returned invalid token material."); error.code="unavailable"; throw error;
          }
          const newExpiry=now()+fresh.expiresInSeconds*1000;
          const nextSecret={
            accessToken:fresh.accessToken,
            refreshToken:fresh.refreshToken||stored.refreshToken,
            expiresAt:newExpiry,
            scopes:fresh.scope?fresh.scope.split(" ").filter(Boolean):stored.scopes
          };
          let leaseProof;
          if(leaseService) {
            try {
              lease=await leaseService.renew({accountId,connectionId,lease,ttlMs:120_000});
              leaseProof=Object.freeze({ownerId:lease.ownerId,fencingToken:lease.fencingToken});
            } catch { const error=new Error("Mailbox refresh lease was lost."); error.code="unavailable"; throw error; }
          }
          try { await vault.storeSecret({secretRef,secretMaterial:nextSecret,expectedVersion:stored.version,leaseProof}); }
          catch { const error=new Error("Mailbox credential persistence failed."); error.code="unavailable"; throw error; }
          return Object.freeze({status:"active",accessToken:fresh.accessToken,expiresAt:newExpiry,refreshed:true});
        } finally {
          if(leaseService && lease) {
            try { await leaseService.release({accountId,connectionId,lease}); }
            catch { /* Expiry permits recovery; do not mask the primary outcome. */ }
          }
        }
      })();
      inFlight.set(lockKey,operation);
      try { return await operation; }
      finally { if(inFlight.get(lockKey)===operation) inFlight.delete(lockKey); }
    }
  });
}
