# プロ野球ペナントシミュレーター 開発引き継ぎ & 申し送り事項 (HANDOVER)

## 1. 現在のステータス
* **現在のフェーズ**: Web版（Vite + React + TS）機能実装・ローカル検証完了 ➔ Firebase Hosting へのWebデプロイ & クラウドセーブ機能（Firebase Auth + Cloud Firestore）実装・運用フェーズ
* **最終目標**: Webテスト運用完了後、Capacitor等のラッパーを用いたiOS/Androidネイティブアプリ（またはPWA）化

---

## 2. 動作・技術基盤上の重要仕様
* **セーブデータ管理 (LocalStorage & Cloud Firestore)**:
  * **未ログイン時**: ブラウザの `LocalStorage` にデータを保持。
  * **ログイン時**: Firebase Auth（Googleログイン）の `uid` に紐づく Cloud Firestore (`users/{uid}`) へ自動同期。
  * `gameState.ts` の `SCHEMA_VERSION` でデータ構造をバージョン管理しています。モデル（`Player`, `Team`, `GameState` 等）のフィールドを変更した場合は、必ず `SCHEMA_VERSION` をインクリメントしてください（パースエラー防止のため）。
* **UI & モーダル方針**:
  * モバイルアプリ化を見据え、ブラウザ標準の `window.confirm()` や `window.alert()` は使用せず、すべてアプリ内コンポーネント（`ConfirmModal.tsx` 等）で完結させています。
* **対抗ロジック・シミュレーションの純粋性**:
  * 試合ロジック（`src/match/`）はReactの描画やUI状態から完全に独立した純粋関数群です。バックグラウンド処理やWeb Worker化が容易な構造になっています。

---

## 3. Firebase 連携および Web運用に向けたチェックリスト
- [x] **Firebase Authentication の設定**:
  - Firebase Console ➔ Authentication ➔ Sign-in method で「Google」を有効化。
- [x] **Cloud Firestore の設定**:
  - Firestore データベースを作成し、以下のセキュリティルールを適用。
    ```javascript
    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {
        match /users/{userId} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
        }
      }
    }
    ```
- [x] **Hosting デプロイ設定**:
  - `firebase.json`（公開ディレクトリ: `dist`、SPAリダイレクト）および `.firebaserc` を作成済み。
  - `npm run deploy`（`predeploy` で自動ビルドして `firebase deploy --only hosting` を実行）スクリプトを設定済み。
- [x] **ビルド・動作検証**:
  - `npm run build` 時のTypeScript型エラー・Viteビルドエラーがないことの確認完了。
  - 実端末（iOS Safari / Android Chrome）での Google ログイン、クラウド同期、レスポンシブ表示の検証。

---

## 4. 将来のスマホアプリ化（iOS / Android）に向けた注意事項
1. **アプリ化のアプローチ推奨**:
   - 現状が `React 18 + Vite + Vanilla CSS` で構築されているため、**Capacitor**（`@capacitor/core`, `@capacitor/cli`）を導入して既存のWeb成果物をそのままiOS/Androidプロジェクトにバンドルするのが最も低コストかつスムーズです。
2. **CapacitorでのGoogleログイン（OAuth）対応**:
   - iOS/Androidネイティブ化にあたっては、Web用のポップアップ認証（`signInWithPopup`）から `@codetrix-studio/capacitor-google-auth` などのネイティブ用プラグインへ切り替えられるよう、認証処理をモジュール化 (`src/firebase.ts`) してあります。
3. **セーフエリア（Notch / Dynamic Island対応）**:
   - 最下部固定の「次の試合に進む」ボタンやナビゲーションバーは、スマホアプリ化時に `env(safe-area-inset-bottom)` や `padding-bottom` で端末下部エリアを保護する設計にしてください。

---

## 5. 今後のタスク (To Do)
- [ ] **Phase 1**: Firebase Auth / Firestore 連携ロジックの組込と Firebase Hosting へのWebデプロイ
- [ ] **Phase 2**: モバイル実機でのテストプレイ（Googleログイン動作、UI崩れ、スクロール・タップ感触の調整）
- [ ] **Phase 3**: Capacitor導入による iOS / Android ビルドテスト
- [ ] **Phase 4**: アプリストア（App Store / Google Play）出願用アセット作成（アイコン、スプラッシュ画面）