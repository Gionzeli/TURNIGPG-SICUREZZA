const REF_RE = /^mailbox\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{1,128})\/([A-Za-z0-9_-]{16,128})$/;
const VERSION_RE = /^[1-9][0-9]{0,19}$/;
function parseRef(secretRef) {
  if (typeof secretRef !== "string") throw new Error("invalid ref");
  const match = REF_RE.exec(secretRef);
  if (!match) throw new Error("invalid ref");
  return { accountId: match[1], connectionId: match[2], opaqueId: match[3] };
}
function conflict() { const error = new Error("version conflict"); error.code = "conflict"; return error; }

/**
 * Google Secret Manager + Firestore pointer CAS backend.
 * Secret payloads live only in immutable Secret Manager versions. Firestore stores
 * only the currently selected numeric version. A losing writer can leave an
 * unreferenced Secret Manager version; it must never become the active pointer.
 *
 * secretManager: Google Secret Manager client (accessSecretVersion/addSecretVersion).
 * firestore: Admin Firestore instance.
 * secretNameForRef and pointerRefForRef are trusted server-only resource mappers.
 * Pointer documents must be provisioned with {version: "1"} after an initial
 * Secret Manager version has been created. No client may write pointer documents.
 */
export function createGoogleSecretManagerTokenCasBackend({
  secretManager, firestore, secretNameForRef, pointerRefForRef
}) {
  if (!secretManager || typeof secretManager.accessSecretVersion !== "function" ||
      typeof secretManager.addSecretVersion !== "function" ||
      !firestore || typeof firestore.runTransaction !== "function" ||
      typeof secretNameForRef !== "function" || typeof pointerRefForRef !== "function") {
    throw new TypeError("Google Secret Manager and Firestore CAS dependencies are required.");
  }

  function resources(secretRef) {
    const parts = parseRef(secretRef);
    const secretName = secretNameForRef(Object.freeze(parts));
    const pointerRef = pointerRefForRef(Object.freeze(parts));
    if (typeof secretName !== "string" ||
        !/^projects\/[A-Za-z0-9.-]+\/secrets\/[A-Za-z0-9_-]+$/.test(secretName) ||
        !pointerRef || typeof pointerRef.get !== "function") {
      throw new Error("invalid trusted resource mapping");
    }
    return { secretName, pointerRef };
  }

  async function readVersion(secretName, version) {
    const [result] = await secretManager.accessSecretVersion({
      name: `${secretName}/versions/${version}`
    });
    const encoded = result?.payload?.data;
    if (!encoded) throw new Error("missing secret payload");
    const bytes = Buffer.isBuffer(encoded) ? encoded : Buffer.from(encoded);
    if (bytes.length > 32_768) throw new Error("secret payload too large");
    const payload = JSON.parse(bytes.toString("utf8"));
    return payload;
  }

  return Object.freeze({
    async readSecret({ secretRef }) {
      try {
        const { secretName, pointerRef } = resources(secretRef);\n      const parts = parseRef(secretRef);\n      let leaseRef;\n      if (leaseProof !== undefined) {\n        if (!leaseProof || typeof leaseProof.ownerId !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(leaseProof.ownerId) || !Number.isSafeInteger(leaseProof.fencingToken) || leaseProof.fencingToken < 1 || typeof leaseRefForConnection !== "function") throw new Error("invalid lease proof");\n        leaseRef = leaseRefForConnection({accountId:parts.accountId,connectionId:parts.connectionId});\n        if (!leaseRef || typeof leaseRef.get !== "function") throw new Error("invalid lease reference");\n      }
        const snapshot = await pointerRef.get();
        const version = snapshot?.data?.()?.version;
        if (!snapshot?.exists || typeof version !== "string" || !VERSION_RE.test(version)) {
          throw new Error("invalid secret pointer");
        }
        return { payload: await readVersion(secretName, version), version };
      } catch {
        throw new Error("secret backend read failed");
      }
    },

    async replaceSecret({ secretRef, payload, expectedVersion, leaseProof }) {
      if (typeof expectedVersion !== "string" || !VERSION_RE.test(expectedVersion)) {
        throw new Error("invalid expected version");
      }
      const { secretName, pointerRef } = resources(secretRef);
      let newVersion;
      try {
        const [created] = await secretManager.addSecretVersion({
          parent: secretName,
          payload: { data: Buffer.from(JSON.stringify(payload), "utf8") }
        });
        const match = /\/versions\/([1-9][0-9]{0,19})$/.exec(created?.name || "");
        if (!match) throw new Error("invalid created version");
        newVersion = match[1];
      } catch {
        throw new Error("secret version creation failed");
      }

      try {
        await firestore.runTransaction(async transaction => {
          const snapshot = await transaction.get(pointerRef);
          const current = snapshot?.data?.()?.version;
          if (!snapshot?.exists || current !== expectedVersion) throw conflict();
          transaction.update(pointerRef, { version: newVersion });
        });
        return { version: newVersion };
      } catch (error) {
        if (error?.code === "conflict") throw error;
        throw new Error("secret pointer update failed");
      }
    }
  });
}
