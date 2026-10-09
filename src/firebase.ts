import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';
import type { GameState } from './domain/gameState';
import { SCHEMA_VERSION, buildInitialOrders } from './domain/gameState';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Firebase アプリと各サービスの初期化
export const app: FirebaseApp = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);

const googleProvider = new GoogleAuthProvider();

/** Googleログインを実行 */
export async function signInWithGoogle(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

/** ログアウトを実行 */
export async function logout(): Promise<void> {
  await fbSignOut(auth);
}

/** 認証状態の監視リスナー */
export function subscribeAuthState(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

/**
 * Cloud Firestore からセーブデータを取得する
 * 読み込み先: users/{uid} の saveData フィールド
 */
export async function loadGameStateFromCloud(uid: string): Promise<GameState | null> {
  try {
    const userDocRef = doc(db, 'users', uid);
    const snap = await getDoc(userDocRef);
    if (!snap.exists()) return null;

    const data = snap.data();
    if (!data || !data.saveData) return null;

    const parsed: GameState = typeof data.saveData === 'string'
      ? JSON.parse(data.saveData)
      : data.saveData;

    if (parsed.version !== SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.teams) || parsed.teams.length === 0) return null;
    if (!parsed.orders) {
      parsed.orders = buildInitialOrders(parsed.teams);
    }
    return parsed;
  } catch (err) {
    console.error('Failed to load game state from Firestore:', err);
    return null;
  }
}

/**
 * Cloud Firestore へセーブデータを保存する
 * 保存先: users/{uid}
 * Firestoreのネストや型制約を避けるため、JSON文字列として保存します
 */
export async function saveGameStateToCloud(uid: string, state: GameState): Promise<void> {
  try {
    const userDocRef = doc(db, 'users', uid);
    await setDoc(
      userDocRef,
      {
        saveData: JSON.stringify(state),
        updatedAt: new Date().toISOString(),
        version: state.version,
      },
      { merge: true },
    );
  } catch (err) {
    console.error('Failed to save game state to Firestore:', err);
  }
}

/**
 * Cloud Firestore のセーブデータを削除する（初期化用）
 */
export async function clearGameStateFromCloud(uid: string): Promise<void> {
  try {
    const userDocRef = doc(db, 'users', uid);
    await deleteDoc(userDocRef);
  } catch (err) {
    console.error('Failed to clear game state from Firestore:', err);
  }
}
