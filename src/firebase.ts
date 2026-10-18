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
  setDoc,
  writeBatch,
  collection,
  getDocs,
  type Firestore,
  getDocFromServer,
} from 'firebase/firestore';
import type { GameState } from './domain/gameState';
import { SCHEMA_VERSION, sanitizeGameState } from './domain/gameState';

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

// ========== 圧縮ユーティリティ（ブラウザ標準 CompressionStream 使用） ==========
// 保存時: JSON文字列 → gzip圧縮 → base64文字列
// 読込時: base64文字列 → gzip展開 → JSON文字列
// 後方互換: 旧フォーマット（非圧縮JSON文字列）も自動判定して対応

// 分割保存のチャンクサイズ上限: 800KB (Firestoreの1MB上限に対して十分な安全マージン)
const CHUNK_SIZE = 800 * 1024;

// Uint8Array → base64（8KBチャンクで高速変換）
function uint8ArrayToBase64(buf: Uint8Array): string {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < buf.length; i += chunkSize) {
    const chunk = buf.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// base64 → Uint8Array
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function compressToBase64(json: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(json);

  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(data);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const buf = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.length;
  }

  return uint8ArrayToBase64(buf);
}

async function decompressFromBase64(base64: string): Promise<string> {
  const bytes = base64ToUint8Array(base64);

  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(bytes as any);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const buf = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    buf.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(buf);
}

/** base64文字列かどうかを判定（圧縮データか非圧縮JSONかの区別用） */
function isBase64(str: string): boolean {
  // JSON文字列は必ず '{' で始まるため、それ以外は圧縮済みbase64とみなす
  return !str.trimStart().startsWith('{');
}

// ==========================================================================

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

/** loadGameStateFromCloud の返却型 */
export interface CloudLoadResult {
  state: GameState;
  /** Firestoreドキュメントの updatedAt フィールド (ISO文字列) */
  updatedAt: string;
}

/**
 * Cloud Firestore からセーブデータを取得する
 * - チャンク分割データ (isChunked: true) の場合はサブコレクション chunks から取得して結合
 * - 単一ドキュメントデータ (saveData) の場合はそのまま取得
 * - ドキュメントが存在しない場合: null を返す（新規ユーザー）
 * - バージョン不一致 / パースエラー: null を返す
 * - ネットワークエラー等: 例外を throw する（呼び出し元でキャッチしてローカルを使う）
 */
export async function loadGameStateFromCloud(uid: string): Promise<CloudLoadResult | null> {
  const userDocRef = doc(db, 'users', uid);
  // キャッシュではなく必ずサーバーから最新データを取得する
  const snap = await getDocFromServer(userDocRef);
  console.log('[Cloud Load] snap.exists:', snap.exists(), 'uid:', uid);

  if (!snap.exists()) {
    console.log('[Cloud Load] No document found (new user).');
    return null;
  }

  const data = snap.data();
  if (!data) {
    console.log('[Cloud Load] Empty document data.');
    return null;
  }

  console.log('[Cloud Load] updatedAt:', data.updatedAt, 'storedVersion:', data.version, 'isChunked:', data.isChunked);

  try {
    let rawData: string;

    if (data.isChunked && typeof data.chunkCount === 'number' && data.chunkCount > 0) {
      // 分割保存されたチャンクをサブコレクションから順番に取得して復元
      console.log(`[Cloud Load] Fetching ${data.chunkCount} chunks from subcollection...`);
      const chunkPromises = [];
      for (let i = 0; i < data.chunkCount; i++) {
        const chunkRef = doc(db, 'users', uid, 'chunks', String(i));
        chunkPromises.push(getDocFromServer(chunkRef));
      }
      const chunkSnaps = await Promise.all(chunkPromises);

      const parts: string[] = [];
      for (let i = 0; i < chunkSnaps.length; i++) {
        const cSnap = chunkSnaps[i];
        if (!cSnap.exists()) {
          console.error(`[Cloud Load] Missing chunk ${i} of ${data.chunkCount}`);
          return null;
        }
        parts.push(cSnap.data().data ?? '');
      }
      rawData = parts.join('');
      console.log(`[Cloud Load] Reassembled ${parts.length} chunks. Total raw size:`, rawData.length, 'bytes');
    } else if (data.saveData) {
      // 単一ドキュメント保存の場合
      if (typeof data.saveData === 'string') {
        rawData = data.saveData;
      } else {
        rawData = JSON.stringify(data.saveData);
      }
    } else {
      console.log('[Cloud Load] No saveData or chunks in document.');
      return null;
    }

    let json: string;
    if (isBase64(rawData)) {
      // 圧縮済みデータ → 展開
      console.log('[Cloud Load] Decompressing saveData...');
      json = await decompressFromBase64(rawData);
    } else {
      // 旧フォーマット: 非圧縮JSON文字列（後方互換）
      json = rawData;
    }

    const parsed: GameState = JSON.parse(json);

    console.log('[Cloud Load] parsed.version:', parsed.version, 'SCHEMA_VERSION:', SCHEMA_VERSION, 'year:', parsed.year, 'weekIndex:', parsed.weekIndex);

    if (parsed.version !== SCHEMA_VERSION) {
      console.warn('[Cloud Load] Version mismatch! Ignoring cloud data.');
      return null;
    }
    if (!Array.isArray(parsed.teams) || parsed.teams.length === 0) {
      console.warn('[Cloud Load] Invalid teams array. Ignoring cloud data.');
      return null;
    }
    const sanitized = sanitizeGameState(parsed);
    console.log('[Cloud Load] Successfully loaded and sanitized. year:', sanitized.year, 'weekIndex:', sanitized.weekIndex);
    return { state: sanitized, updatedAt: data.updatedAt ?? '' };
  } catch (parseErr) {
    console.error('[Cloud Load] Parse/decompress error:', parseErr);
    return null;
  }
}

/**
 * Cloud Firestore へセーブデータを保存する
 * - gzip圧縮してからBase64エンコード
 * - 800KB以下の場合は単一ドキュメントに保存
 * - 800KBを超える場合は users/{uid}/chunks/{index} に800KB単位で分割保存（writeBatchによるアトミック保存）
 * ※ エラー時は throw する（呼び出し元で try/catch してユーザーに通知）
 */
export async function saveGameStateToCloud(uid: string, state: GameState): Promise<void> {
  const userDocRef = doc(db, 'users', uid);
  const now = new Date().toISOString();

  const json = JSON.stringify(state);
  console.log('[Cloud Save] Original JSON size:', json.length, 'bytes');

  const compressed = await compressToBase64(json);
  const compLen = compressed.length;
  console.log('[Cloud Save] Compressed size:', compLen, 'bytes (ratio:', (compLen / json.length * 100).toFixed(1), '%)');

  if (compLen <= CHUNK_SIZE) {
    // 800KB以下: 単一ドキュメントとして保存
    console.log('[Cloud Save] Saving as single document. uid:', uid, 'year:', state.year, 'weekIndex:', state.weekIndex);
    await setDoc(
      userDocRef,
      {
        saveData: compressed,
        isChunked: false,
        chunkCount: 0,
        updatedAt: now,
        version: state.version,
      },
      { merge: true },
    );
  } else {
    // 800KB超過: 800KBごとのチャンクに分割してサブコレクションに保存
    const chunkCount = Math.ceil(compLen / CHUNK_SIZE);
    console.log(`[Cloud Save] Data exceeds ${CHUNK_SIZE} bytes. Splitting into ${chunkCount} chunks of 800KB...`);

    const batch = writeBatch(db);

    // 親ドキュメントにメタ情報を設定（saveData は null にして1MB上限を回避）
    batch.set(
      userDocRef,
      {
        saveData: null,
        isChunked: true,
        chunkCount,
        totalCompressedSize: compLen,
        updatedAt: now,
        version: state.version,
      },
      { merge: true },
    );

    // 各チャンクをサブコレクション users/{uid}/chunks/{index} に格納
    for (let i = 0; i < chunkCount; i++) {
      const chunkRef = doc(db, 'users', uid, 'chunks', String(i));
      const chunkStr = compressed.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      batch.set(chunkRef, {
        index: i,
        data: chunkStr,
        updatedAt: now,
      });
    }

    // アトミックに一括コミット（途中失敗によるデータ不整合を防止）
    await batch.commit();
    console.log(`[Cloud Save] Successfully saved ${chunkCount} chunks via batch.`);
  }

  console.log('[Cloud Save] Save complete.');
}

/**
 * Cloud Firestore のセーブデータを削除する（初期化用）
 * 親ドキュメントおよび chunks サブコレクションの両方を消去
 */
export async function clearGameStateFromCloud(uid: string): Promise<void> {
  try {
    const userDocRef = doc(db, 'users', uid);
    const chunksSnap = await getDocs(collection(db, 'users', uid, 'chunks'));

    const batch = writeBatch(db);
    chunksSnap.forEach((chunkDoc) => {
      batch.delete(chunkDoc.ref);
    });
    batch.delete(userDocRef);

    await batch.commit();
    console.log('[Cloud Clear] Cleared user document and all chunks.');
  } catch (err) {
    console.error('Failed to clear game state from Firestore:', err);
  }
}
