import { toDatabaseError } from "./database-errors.js";

export function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(toDatabaseError(request.error));
  });
}

export function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(toDatabaseError(transaction.error));
    transaction.onerror = () => reject(toDatabaseError(transaction.error));
  });
}

export function abortTransaction(transaction) {
  try {
    transaction.abort();
  } catch {
    // A transaction may already be complete or aborted.
  }
}
