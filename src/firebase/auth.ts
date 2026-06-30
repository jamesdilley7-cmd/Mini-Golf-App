import { onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import { auth } from './config';

let cachedUid: string | null = null;
let pendingSignIn: Promise<string> | null = null;

export function ensureSignedIn(): Promise<string> {
  if (cachedUid) {
    return Promise.resolve(cachedUid);
  }
  if (!auth) {
    return Promise.reject(
      new Error('Firebase is not configured. Add your Firebase credentials to .env first.')
    );
  }
  if (pendingSignIn) {
    return pendingSignIn;
  }

  const activeAuth = auth;
  pendingSignIn = new Promise<string>((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      activeAuth,
      (user: User | null) => {
        if (user) {
          cachedUid = user.uid;
          unsubscribe();
          resolve(user.uid);
        }
      },
      (error) => {
        unsubscribe();
        reject(error);
      }
    );
    signInAnonymously(activeAuth).catch((error) => {
      unsubscribe();
      reject(error);
    });
  });

  return pendingSignIn;
}

export function getCurrentUid(): string | null {
  return cachedUid ?? auth?.currentUser?.uid ?? null;
}
